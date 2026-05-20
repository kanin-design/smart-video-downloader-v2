import { getPreferenceValues, LocalStorage } from "@raycast/api";
import { execa } from "execa";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "fs";
import { spawn } from "child_process";
import * as path from "path";
import type {
  ExtensionPreferences,
  JobRecord,
  VideoMetadata,
} from "./types.js";
import {
  computeProgress,
  cookieFileExists,
  findExecutable,
  getCookieFile,
  getEnv,
  getExpectedStreams,
  getFormatLabel,
  getLogDir,
  getResolutionLabel,
  isCookieError,
  isProcessRunning,
  killProcessByLogFile,
  resolveDownloadPath,
  sanitizeTitle,
  shq,
} from "./utils.js";
import {
  addJob,
  completeJob,
  ensureLogDir,
  getJobById,
  getJobs,
  getProgress,
  isPolling,
  removeJob,
  setJobs,
  startPolling,
  stopPolling,
  updateJobMediaInfo,
  updateProgress,
} from "./store.js";

// ── Metadata fetch ───────────────────────────────────────────────────────────

function buildMetadataArgs(
  url: string,
  prefs: ExtensionPreferences,
): string[] {
  const args: string[] = [];
  if (prefs.forceIpv4) args.push("--force-ipv4");
  if (cookieFileExists()) args.push("--cookies", getCookieFile());
  args.push("--no-playlist", "--dump-json", "--format-sort=res,ext,tbr", url);
  return args;
}

export type CancelFetch = { cancel: () => void };

export function startMetadataFetch(
  url: string,
  prefs: ExtensionPreferences,
  onSuccess: (meta: VideoMetadata) => void,
  onError: (err: string, isCookie: boolean) => void,
): CancelFetch {
  const ytdlp = findExecutable("yt-dlp");
  const args = buildMetadataArgs(url, prefs);
  let cancelled = false;

  const proc = execa(ytdlp, args, { env: getEnv(), reject: false });

  (async () => {
    try {
      const result = await proc;
      if (cancelled) return;
      if ((result.exitCode ?? 1) !== 0) {
        const msg = result.stderr || result.stdout || "Unknown error";
        onError(msg, isCookieError(msg));
        return;
      }
      const meta = JSON.parse(result.stdout) as VideoMetadata;
      onSuccess(meta);
    } catch (err: unknown) {
      if (cancelled) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("killed") || msg.includes("cancel")) return;
      onError(msg, isCookieError(msg));
    }
  })();

  return {
    cancel: () => {
      cancelled = true;
      proc.kill();
    },
  };
}

// ── Log helpers ──────────────────────────────────────────────────────────────

function readLog(logFile: string): string {
  try {
    return readFileSync(logFile, "utf-8");
  } catch {
    return "";
  }
}

// ── Download spawning ────────────────────────────────────────────────────────

// Filename templates. Write the pattern as a plain string with $tag placeholders;
// fillTemplate substitutes them with whatever values you pass in. The same
// templates drive both the JS-rendered filename (view-mode) and the yt-dlp
// output template (headless), by passing different values for the same tags.
const FILENAME_TEMPLATE_WITH_UPLOADER = "$uploader — $title";
const FILENAME_TEMPLATE_TITLE_ONLY = "$title";
const ID_SUFFIX_TEMPLATE = " ($id)";

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\$(\w+)/g, (match, key) => vars[key] ?? match);
}

function buildOutputPath(
  prefs: ExtensionPreferences,
  format: JobRecord["format"],
  title: string,
  videoId: string,
  uploader?: string,
): string {
  const dir = resolveDownloadPath(prefs.downloadPath);
  const ext = format.type === "audio" ? "m4a" : "mp4";
  const isHeadless = format.type === "headless";

  // Headless passes literal yt-dlp tokens that get resolved at download time.
  // View-mode passes sanitized real strings.
  const vars: Record<string, string> = isHeadless
    ? { uploader: "%(uploader)s", title: "%(title)s", id: "%(id)s" }
    : {
        uploader: uploader ? sanitizeTitle(uploader) : "",
        title: sanitizeTitle(title),
        id: videoId,
      };

  // Include uploader if the pref is on AND a value is actually available.
  // Headless mode always has a value (the yt-dlp placeholder is non-empty).
  const includeUploader =
    prefs.prefixUploaderInFilename && (isHeadless || !!vars.uploader);
  const stemTemplate = includeUploader
    ? FILENAME_TEMPLATE_WITH_UPLOADER
    : FILENAME_TEMPLATE_TITLE_ONLY;
  const fullTemplate = prefs.includeIdInFilename
    ? stemTemplate + ID_SUFFIX_TEMPLATE
    : stemTemplate;

  return path.join(dir, `${fillTemplate(fullTemplate, vars)}.${ext}`);
}

function buildYtdlpArgs(job: JobRecord, prefs: ExtensionPreferences): string[] {
  const ytdlp = findExecutable("yt-dlp");
  const ffmpeg = findExecutable("ffmpeg");
  if (!ytdlp)
    throw new Error(
      "yt-dlp is not installed — open Download Manager to install it",
    );
  if (!ffmpeg)
    throw new Error(
      "ffmpeg is not installed — open Download Manager to install it",
    );
  const outputPath = buildOutputPath(
    prefs,
    job.format,
    job.title,
    job.id.slice(0, job.id.lastIndexOf("-")),
    job.uploader,
  );

  const base = [
    ytdlp,
    "--progress",
    "--newline",
    "--print",
    "after_move:filepath",
    "--ffmpeg-location",
    ffmpeg,
  ];

  if (prefs.forceIpv4) base.push("--force-ipv4");
  if (cookieFileExists()) base.push("--cookies", getCookieFile());
  base.push("-o", outputPath);

  switch (job.format.type) {
    case "best":
      base.push(
        "--format",
        "bestvideo+bestaudio/best",
        "--merge-output-format",
        "mp4",
      );
      break;
    case "headless":
      base.push(
        "--format",
        job.format.selector,
        "--merge-output-format",
        "mp4",
      );
      break;
    case "audio":
      base.push("--format", "bestaudio", "-x", "--audio-format", "m4a");
      break;
    case "specific":
      if (job.format.hasAudio) {
        base.push(
          "--format",
          job.format.format.format_id,
          "--merge-output-format",
          "mp4",
        );
      } else {
        base.push(
          "--format",
          `${job.format.format.format_id}+bestaudio`,
          "--merge-output-format",
          "mp4",
        );
      }
      break;
  }

  base.push(job.url);
  return base;
}

// Strip every character that would break the AppleScript string literal or
// the single-line `osascript -e '...'` shell wrapping:
//   - Backslash, ASCII quotes, curly quotes (would close or escape the AS string)
//   - C0 control chars (\x00-\x1f) and DEL (\x7f)
//   - Unicode line/paragraph separators (U+2028, U+2029), NEL (U+0085) — JS
//     treats them as line terminators in strings and they break a single-line
//     `osascript -e '<one line>'` invocation.
/* eslint-disable no-control-regex */
const NOTIF_TITLE_STRIP_RE =
  /[\\"'\u201c\u201d\x00-\x1f\x7f\u0085\u2028\u2029]/g;
/* eslint-enable no-control-regex */

function buildShellCommand(
  job: JobRecord,
  prefs: ExtensionPreferences,
): string {
  const args = buildYtdlpArgs(job, prefs);
  const quotedArgs = args.map(shq).join(" ");
  const logFile = shq(job.logFile);
  const notifTitle = job.title.replace(NOTIF_TITLE_STRIP_RE, "").slice(0, 100);

  // PATH is supplied via `env: getEnv()` on spawn — no need to re-export here.
  return [
    `${quotedArgs} >> ${logFile} 2>&1`,
    `_code=$?`,
    `echo "YTDLP_EXIT:$_code" >> ${logFile}`,
    `if [ $_code -eq 0 ]; then`,
    `  osascript -e 'display notification "${notifTitle}" with title "Download complete"' 2>/dev/null || true`,
    `else`,
    `  osascript -e 'display notification "${notifTitle}" with title "Download failed"' 2>/dev/null || true`,
    `fi`,
  ].join("\n");
}

function spawnDownload(
  job: JobRecord,
  prefs: ExtensionPreferences,
): void {
  try {
    ensureLogDir();
    mkdirSync(path.dirname(job.logFile), { recursive: true });
  } catch (err) {
    throw new Error(
      `Could not create log directory: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const shellCmd = buildShellCommand(job, prefs);
  const proc = spawn("/bin/sh", ["-c", shellCmd], {
    detached: true,
    stdio: "ignore",
    env: getEnv(),
  });
  proc.unref();
  beginPolling(job.id);
}

// ── Log polling ──────────────────────────────────────────────────────────────

function findOutputPath(lines: string[]): string | null {
  for (const l of lines) {
    const t = l.trim();
    if (
      t.startsWith("/") &&
      !t.startsWith("/dev") &&
      !/\.(part|ytdl|tmp)$/.test(t)
    ) {
      return t;
    }
  }
  return null;
}

function pollTick(jobId: string): void {
  const job = getJobById(jobId);
  if (!job || job.completedAt) {
    stopPolling(jobId);
    return;
  }

  const content = readLog(job.logFile);
  const lines = content.split("\n");

  // 1. Completion checks first so a sentinel/output line found alongside merge
  //    output still finalises immediately rather than waiting another tick.
  let exitCode: number | null = null;
  for (const l of lines) {
    const m = l.match(/YTDLP_EXIT:(\d+)/);
    if (m) {
      exitCode = parseInt(m[1]);
      break;
    }
  }

  const outputPath = findOutputPath(lines);

  if (outputPath && existsSync(outputPath)) {
    completeJob(jobId, outputPath);
    probeMediaInfoAsync(jobId, outputPath);
    return;
  }
  if (exitCode !== null) {
    removeJob(jobId);
    return;
  }

  // 2. Merge phase → pin to 99%.
  const inMerge = lines.some(
    (l) =>
      l.includes("[Merger]") ||
      l.includes("[ExtractAudio]") ||
      l.includes("[ffmpeg]"),
  );
  if (inMerge) {
    const prev = getProgress(jobId);
    updateProgress(jobId, {
      percent: 99,
      rawPercent: 100,
      speed: "",
      streamIndex: prev?.streamIndex ?? 0,
    });
    return;
  }

  // 3. Parse progress (scan lines in reverse for latest).
  const prev = getProgress(jobId);
  let currentStreamIndex = prev?.streamIndex ?? 0;
  const lastRawPercent = prev?.rawPercent ?? 0;
  let lastSpeed = prev?.speed ?? "";

  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    const pm = l.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
    if (pm) {
      const rawPercent = parseFloat(pm[1]);
      if (rawPercent < 5 && lastRawPercent > 80) {
        currentStreamIndex = Math.min(
          currentStreamIndex + 1,
          job.expectedStreams - 1,
        );
      }
      const speedMatch = l.match(/at\s+([\d.]+\s*\w+\/s)/);
      if (speedMatch) lastSpeed = speedMatch[1];
      const displayPercent = computeProgress(
        rawPercent,
        job.expectedStreams,
        currentStreamIndex,
      );
      updateProgress(jobId, {
        percent: displayPercent,
        rawPercent,
        speed: lastSpeed,
        streamIndex: currentStreamIndex,
      });
      break;
    }
  }
}

function beginPolling(jobId: string): void {
  if (isPolling(jobId)) return;
  startPolling(jobId, () => pollTick(jobId));
}

// ── Cancel ───────────────────────────────────────────────────────────────────

export function cancelDownload(jobId: string): void {
  const job = getJobById(jobId);
  if (!job) return;
  killProcessByLogFile(job.logFile);
  removeJob(jobId);
}

// ── Media info probing ────────────────────────────────────────────────────────

async function probeMediaInfoAsync(
  jobId: string,
  filePath: string,
): Promise<void> {
  try {
    const ffprobe = findExecutable("ffprobe");
    if (!ffprobe) return;

    const result = await execa(
      ffprobe,
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        filePath,
      ],
      { env: getEnv(), reject: false },
    );
    if ((result.exitCode ?? 1) !== 0) return;

    interface FfprobeStream {
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
    }
    interface FfprobeFormat {
      bit_rate?: string;
      duration?: string;
    }
    const data: { streams?: FfprobeStream[]; format?: FfprobeFormat } =
      JSON.parse(result.stdout);
    const streams = data.streams ?? [];
    const fmt = data.format ?? {};

    const videoStream = streams.find((s) => s.codec_type === "video");
    const audioStream = streams.find((s) => s.codec_type === "audio");
    const height = videoStream?.height;
    const width = videoStream?.width;

    const resolution = height ? getResolutionLabel(height) : "Audio Only";

    updateJobMediaInfo(jobId, {
      resolution,
      width,
      height,
      videoCodec: videoStream?.codec_name,
      audioCodec: audioStream?.codec_name,
      bitrateMbps: fmt.bit_rate
        ? Math.round(parseInt(fmt.bit_rate) / 1000) / 1000
        : undefined,
      durationSecs: fmt.duration
        ? Math.round(parseFloat(fmt.duration))
        : undefined,
    });
  } catch {
    // non-fatal
  }
}

// ── Resume downloads ──────────────────────────────────────────────────────────

export async function resumeDownloads(): Promise<void> {
  let current = getJobs();

  // Prune completed jobs whose output file no longer exists
  current = current.filter(
    (j) => !(j.completedAt && j.filePath && !existsSync(j.filePath)),
  );

  // Deduplicate completed jobs with same output path — keep most recent
  const seenPaths = new Map<string, JobRecord>();
  for (const job of current) {
    if (!job.filePath || !job.completedAt) continue;
    const ex = seenPaths.get(job.filePath);
    if (!ex || job.completedAt > (ex.completedAt ?? 0))
      seenPaths.set(job.filePath, job);
  }
  current = current.filter((j) => {
    if (!j.filePath || !j.completedAt) return true;
    return seenPaths.get(j.filePath) === j;
  });

  const updated: JobRecord[] = [];

  for (const job of current) {
    if (job.completedAt) {
      updated.push(job);
      continue;
    }

    if (!existsSync(job.logFile)) continue; // ghost — discard

    const content = readLog(job.logFile);
    const lines = content.split("\n");

    const hasSentinel = lines.some((l) => /YTDLP_EXIT:\d+/.test(l));
    const outputLine = findOutputPath(lines);
    const outputExists = outputLine && existsSync(outputLine);

    if (hasSentinel || outputExists) {
      const filePath = outputExists ? outputLine : job.filePath;
      if (filePath) {
        updated.push({ ...job, filePath, completedAt: Date.now() });
        probeMediaInfoAsync(job.id, filePath);
      }
    } else if (isProcessRunning(job.logFile)) {
      // Re-seed rawPercent and streamIndex from log so progress is correct after resume
      let streamIndex = 0;
      let lastTransPct = 0;
      let rawPercent = 0;
      for (const l of lines) {
        const m = l.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (m) {
          const pct = parseFloat(m[1]);
          if (pct < 5 && lastTransPct > 80) {
            streamIndex = Math.min(streamIndex + 1, job.expectedStreams - 1);
          }
          lastTransPct = pct;
          rawPercent = pct;
        }
      }
      updateProgress(job.id, {
        percent: computeProgress(rawPercent, job.expectedStreams, streamIndex),
        rawPercent,
        speed: "",
        streamIndex,
      });
      updated.push(job);
      beginPolling(job.id);
    } else {
      const prefs = getPreferenceValues<ExtensionPreferences>();
      try {
        spawnDownload(job, prefs);
        updated.push(job);
      } catch {
        // Spawn failed (e.g. missing executable) — drop job to avoid perpetual retry
      }
    }
  }

  setJobs(updated);
}

// ── Cookie extraction ─────────────────────────────────────────────────────────

// Module-level mutex prevents two concurrent extractions from racing on the
// shared cookie file (rapid ⌘⇧K presses, or two commands extracting at once).
let extractCookiesPromise: Promise<boolean> | null = null;

export function extractCookies(browser: string): Promise<boolean> {
  if (extractCookiesPromise) return extractCookiesPromise;
  extractCookiesPromise = (async () => {
    try {
      return await doExtractCookies(browser);
    } finally {
      extractCookiesPromise = null;
    }
  })();
  return extractCookiesPromise;
}

async function doExtractCookies(browser: string): Promise<boolean> {
  const ytdlp = findExecutable("yt-dlp");
  const cookiePath = getCookieFile();

  // Remove any existing cookie file so a failed extraction cannot return a false
  // positive by finding the old file still on disk.
  try {
    if (existsSync(cookiePath)) unlinkSync(cookiePath);
  } catch {
    // ignore — if we can't delete the old file, the size check below still catches staleness
  }

  try {
    await execa(
      ytdlp,
      [
        "--cookies-from-browser",
        browser.toLowerCase(),
        "--cookies",
        cookiePath,
      ],
      { env: getEnv(), reject: false },
    );

    if (existsSync(cookiePath) && statSync(cookiePath).size > 100) return true;
    return false;
  } catch {
    return false;
  }
}

// ── Cookie storage ────────────────────────────────────────────────────────────

const LAST_BROWSER_KEY = "last-cookie-browser";
export const LAST_EXTRACTED_AT_KEY = "last-cookie-extracted-at";

export async function getLastBrowser(): Promise<string | null> {
  return (await LocalStorage.getItem<string>(LAST_BROWSER_KEY)) ?? null;
}

export async function saveLastBrowser(browser: string): Promise<void> {
  await LocalStorage.setItem(LAST_BROWSER_KEY, browser);
  await LocalStorage.setItem(LAST_EXTRACTED_AT_KEY, Date.now());
}

export async function clearCookieStorage(): Promise<void> {
  await LocalStorage.removeItem(LAST_BROWSER_KEY);
  await LocalStorage.removeItem(LAST_EXTRACTED_AT_KEY);
}

// ── Create / start a download ─────────────────────────────────────────────────

function createJob(
  url: string,
  videoId: string,
  title: string,
  thumbnail: string,
  format: JobRecord["format"],
  uploader?: string,
): JobRecord {
  const id = `${videoId}-${Date.now()}`;
  return {
    id,
    url,
    format,
    logFile: path.join(getLogDir(), `${id}.log`),
    title,
    uploader,
    thumbnail,
    formatLabel: getFormatLabel(format),
    expectedStreams: getExpectedStreams(format),
  };
}

export function startDownload(
  url: string,
  videoId: string,
  title: string,
  thumbnail: string,
  format: JobRecord["format"],
  prefs: ExtensionPreferences,
  uploader?: string,
): JobRecord {
  const existing = getJobs().find(
    (j) =>
      j.url === url &&
      (!j.completedAt || (j.filePath != null && existsSync(j.filePath))),
  );
  if (existing) return existing;
  const job = createJob(url, videoId, title, thumbnail, format, uploader);
  addJob(job);
  try {
    spawnDownload(job, prefs);
  } catch (err) {
    removeJob(job.id);
    throw err;
  }
  return job;
}
