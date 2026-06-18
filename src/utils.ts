import { Color, environment, LocalStorage } from "@raycast/api";
import { execSync } from "child_process";
import { existsSync } from "fs";
import * as os from "os";
import * as path from "path";
import validator from "validator";
import type {
  DownloadFormat,
  ExtensionPreferences,
  YtDlpFormat,
} from "./types.js";

// ── PATH ────────────────────────────────────────────────────────────────────

export function getPath(): string {
  const current = process.env.PATH ?? "/usr/bin:/bin";
  if (current.startsWith("/opt/homebrew/bin")) return current;
  return `/opt/homebrew/bin:/usr/local/bin:${current}`;
}

export function getEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: getPath(), PYTHONUNBUFFERED: "1" };
}

const executableCache = new Map<string, string>();

export function findExecutable(name: string): string {
  const cached = executableCache.get(name);
  if (cached !== undefined) return cached;
  const quoted = "'" + name.replace(/'/g, "'\\''") + "'";
  let resolved = "";
  try {
    resolved = execSync(`which ${quoted}`, {
      encoding: "utf-8",
      env: { ...process.env, PATH: getPath() },
    }).trim();
  } catch {
    resolved = "";
  }
  // Only cache successful resolutions so a later install can be picked up.
  if (resolved) executableCache.set(name, resolved);
  return resolved;
}

// ── FILE PATHS (all lazy — never module-level) ───────────────────────────────

export function getJobsFile(): string {
  return path.join(environment.supportPath, "jobs.json");
}

export function getCookieFile(): string {
  return path.join(environment.supportPath, "yt-cookies.txt");
}

export function getLogDir(): string {
  return path.join(environment.supportPath, "logs");
}

export function resolveDownloadPath(raw: string): string {
  if (!raw) return path.join(os.homedir(), "Downloads");
  if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

// ── SHELL QUOTING ────────────────────────────────────────────────────────────

export function shq(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ── STRING UTILS ─────────────────────────────────────────────────────────────

/* eslint-disable no-control-regex */
const STRIP_INVISIBLE_RE =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g;
/* eslint-enable no-control-regex */

export function sanitizeTitle(title: string): string {
  let s = title.replace(/[:/]/g, "");
  s = s.replace(STRIP_INVISIBLE_RE, "");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > 200) {
    const cut = s.slice(0, 200);
    const lastPunct = Math.max(
      cut.lastIndexOf("."),
      cut.lastIndexOf("!"),
      cut.lastIndexOf("?"),
    );
    s = lastPunct > 0 ? cut.slice(0, lastPunct) : cut;
  }
  return s || "untitled";
}

export function truncateTitle(title: string, len = 60): string {
  if (title.length <= len) return title;
  return title.slice(0, len) + "…";
}

// yt-dlp often appends " - YouTube", " - Twitter/X", etc. to titles.
// Strip those suffixes so the list shows clean titles.
const SITE_SUFFIX_RE =
  /\s+[-–—]\s+(YouTube|Twitter|X|Vimeo|TikTok|Instagram|Reddit|Twitch|SoundCloud|Dailymotion|Facebook|Rumble|Odysee|BitChute|Bilibili|NicoNico|Niconico)[\s.]*$/i;

export function stripSiteNameSuffix(title: string): string {
  return title.replace(SITE_SUFFIX_RE, "").trim();
}

export function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(1)} KB`;
}

export function formatProgressTag(percent: number): string {
  // No padStart — Raycast tag pills use a proportional font, so leading spaces
  // render as visible whitespace inside the pill rather than column alignment.
  return `${Math.round(percent)}%`;
}

// ── URL ──────────────────────────────────────────────────────────────────────

export function isValidUrl(url: string): boolean {
  if (!url) return false;
  try {
    return validator.isURL(url, {
      require_protocol: true,
      protocols: ["http", "https"],
    });
  } catch {
    return false;
  }
}

const VIDEO_HOSTNAMES = [
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "instagram.com",
  "twitch.tv",
  "dailymotion.com",
  "reddit.com",
  "facebook.com",
  "bilibili.com",
  "nicovideo.jp",
  "streamable.com",
  "rumble.com",
  "odysee.com",
  "peertube",
];

export function isVideoUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return VIDEO_HOSTNAMES.some(
      (vh) =>
        hostname === vh || hostname.endsWith("." + vh) || hostname.includes(vh),
    );
  } catch {
    return false;
  }
}

// Phrases that strongly indicate a cookie/auth issue from yt-dlp's stderr.
// `bot` is matched with word boundaries to avoid false positives like "robot", "about".
const COOKIE_ERROR_SUBSTRINGS = [
  "Sign in",
  "sign in",
  "cookies",
  "Login required",
  "age-restricted",
  "members only",
  "Private video",
];

const BOT_DETECTION_RE = /\bbot\b/i;

export function isCookieError(message: string): boolean {
  if (BOT_DETECTION_RE.test(message)) return true;
  return COOKIE_ERROR_SUBSTRINGS.some((s) => message.includes(s));
}

// ── CODEC ────────────────────────────────────────────────────────────────────

export function getCodecPriority(vcodec: string): number {
  const v = vcodec.toLowerCase();
  if (
    v.startsWith("av01") ||
    v.startsWith("av1") ||
    v.startsWith("av02") ||
    v.startsWith("av2")
  )
    return 1;
  if (
    v.startsWith("hevc") ||
    v.startsWith("hvc1") ||
    v === "h265" ||
    v.startsWith("hev1")
  )
    return 2;
  if (
    v.startsWith("avc2") ||
    v.startsWith("avc1") ||
    v.startsWith("avc") ||
    v === "h264"
  )
    return 3;
  if (v.startsWith("vp9")) return 4;
  if (v.startsWith("vp8")) return 5;
  return 6;
}

export function getFriendlyCodecName(vcodec: string): string {
  const v = vcodec.toLowerCase();
  if (v.startsWith("av02") || v.startsWith("av2")) return "AV2";
  if (v.startsWith("av01") || v.startsWith("av1")) return "AV1";
  if (
    v.startsWith("hevc") ||
    v.startsWith("hvc1") ||
    v === "h265" ||
    v.startsWith("hev1")
  )
    return "HEVC";
  if (
    v.startsWith("avc2") ||
    v.startsWith("avc1") ||
    v.startsWith("avc") ||
    v === "h264"
  )
    return "H.264";
  if (v.startsWith("vp9")) return "VP9";
  if (v.startsWith("vp8")) return "VP8";
  return vcodec.toUpperCase();
}

export function getFriendlyAudioCodecName(acodec: string): string {
  const a = acodec.toLowerCase();
  if (a.includes("opus")) return "Opus";
  if (a.includes("aac")) return "AAC";
  if (a.includes("vorbis")) return "Vorbis";
  if (a.includes("mp3")) return "MP3";
  if (a.includes("flac")) return "FLAC";
  if (a.includes("ac3") || a.includes("eac3")) return "Dolby";
  if (a.includes("dts")) return "DTS";
  return acodec.toUpperCase();
}

// ── COLOUR ───────────────────────────────────────────────────────────────────

export function getResolutionColor(height: number): Color {
  if (height >= 2160) return Color.Purple;
  if (height >= 1080) return Color.Blue;
  if (height >= 720) return Color.Orange;
  if (height >= 480) return Color.Yellow;
  return Color.SecondaryText;
}

export function getAudioCodecColor(acodec: string): Color {
  const a = acodec.toLowerCase();
  // Green is reserved for "live/active" state across the extension (e.g. the
  // Active cookie tag and Downloaded items). Audio codecs use a neutral palette.
  if (a.includes("aac") || a.includes("he-aac") || a.includes("opus"))
    return Color.Blue;
  if (a.includes("vorbis") || a.includes("mp3")) return Color.Orange;
  if (a.includes("ac3") || a.includes("eac3") || a.includes("dts"))
    return Color.Blue;
  if (a.includes("flac")) return Color.Purple;
  return Color.PrimaryText;
}

export function getResolutionLabel(height: number): string {
  if (height >= 2160) return "4K";
  if (height >= 1440) return "1440p";
  if (height >= 1080) return "1080p";
  if (height >= 720) return "720p";
  if (height >= 480) return "480p";
  return `${height}p`;
}

// Codec colour signals efficiency tier:
//   Green  — AV1/AV2 (newest, most efficient)
//   Yellow — HEVC / VP9 (modern, good)
//   Orange — H.264 (legacy but ubiquitous)
//   SecondaryText — anything else / unknown
export function getCodecColor(vcodec: string): Color {
  const v = vcodec.toLowerCase();
  if (
    v.startsWith("av01") ||
    v.startsWith("av1") ||
    v.startsWith("av02") ||
    v.startsWith("av2")
  )
    return Color.Green;
  if (
    v.startsWith("hevc") ||
    v.startsWith("hvc1") ||
    v.startsWith("hev1") ||
    v === "h265" ||
    v.startsWith("vp9")
  )
    return Color.Yellow;
  if (
    v.startsWith("avc2") ||
    v.startsWith("avc1") ||
    v.startsWith("avc") ||
    v === "h264"
  )
    return Color.Orange;
  return Color.SecondaryText;
}

// yt-dlp returns upload_date as YYYYMMDD. Format as "MMM YYYY" (e.g. "Jan 2024").
// Returns null if the input doesn't match the expected shape.
export function formatUploadDate(raw: string | undefined): string | null {
  if (!raw || !/^\d{8}$/.test(raw)) return null;
  const y = raw.slice(0, 4);
  const m = raw.slice(4, 6);
  const d = raw.slice(6, 8);
  const dt = new Date(`${y}-${m}-${d}T00:00:00Z`);
  if (isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

// ── FORMAT OPERATIONS ────────────────────────────────────────────────────────

export function deduplicateFormats(formats: YtDlpFormat[]): YtDlpFormat[] {
  const filtered = formats.filter((f) => {
    if (!f.vcodec || f.vcodec === "none") return false;
    if (f.format_note === "storyboard") return false;
    if (["m3u8", "m3u8_native", "mhtml"].includes(f.protocol)) return false;
    if ((f.height ?? 0) < 144) return false;
    return true;
  });

  const byHeight = new Map<number, YtDlpFormat[]>();
  for (const f of filtered) {
    const h = f.height ?? 0;
    const group = byHeight.get(h) ?? [];
    group.push(f);
    byHeight.set(h, group);
  }

  const result: YtDlpFormat[] = [];
  for (const group of byHeight.values()) {
    group.sort(
      (a, b) =>
        getCodecPriority(a.vcodec ?? "") - getCodecPriority(b.vcodec ?? ""),
    );
    const seen = new Set<string>();
    for (const f of group) {
      const name = getFriendlyCodecName(f.vcodec ?? "");
      if (!seen.has(name)) {
        seen.add(name);
        result.push(f);
        if (seen.size >= 2) break;
      }
    }
  }

  result.sort((a, b) => {
    const hDiff = (b.height ?? 0) - (a.height ?? 0);
    return hDiff !== 0
      ? hDiff
      : getCodecPriority(a.vcodec ?? "") - getCodecPriority(b.vcodec ?? "");
  });

  return result;
}

export const CODEC_NAMES: Record<
  Exclude<ExtensionPreferences["preferredCodec"], "best">,
  string
> = {
  av1: "AV1",
  vp9: "VP9",
  hevc: "HEVC",
  h264: "H.264",
};

export function selectBestFormat(
  formats: YtDlpFormat[],
  maxQuality: ExtensionPreferences["maxQuality"],
  preferredCodec: ExtensionPreferences["preferredCodec"],
): YtDlpFormat | null {
  let candidates = formats; // caller must pass already-deduped formats

  if (maxQuality !== "best") {
    const cap = parseInt(maxQuality);
    candidates = candidates.filter((f) => (f.height ?? 0) <= cap);
  }

  if (candidates.length === 0) return null;

  if (preferredCodec !== "best") {
    const targetName = CODEC_NAMES[preferredCodec];
    const bestHeight = candidates[0].height ?? 0;
    const atBestHeight = candidates.filter(
      (f) =>
        (f.height ?? 0) === bestHeight &&
        getFriendlyCodecName(f.vcodec ?? "") === targetName,
    );
    if (atBestHeight.length > 0) return atBestHeight[0];
    const anyHeight = candidates.filter(
      (f) => getFriendlyCodecName(f.vcodec ?? "") === targetName,
    );
    if (anyHeight.length > 0) return anyHeight[0];
  }

  return candidates[0];
}

export function selectBestAudioFormat(
  formats: YtDlpFormat[],
): YtDlpFormat | null {
  const audio = formats.filter((f) => {
    if (!f.acodec || f.acodec === "none") return false;
    if (f.vcodec && f.vcodec !== "none") return false;
    if (["m3u8", "m3u8_native"].includes(f.protocol)) return false;
    return true;
  });

  if (audio.length === 0) return null;

  audio.sort((a, b) => {
    const sA = (a.tbr ?? 0) * 1000 + (a.filesize ?? a.filesize_approx ?? 0);
    const sB = (b.tbr ?? 0) * 1000 + (b.filesize ?? b.filesize_approx ?? 0);
    return sB - sA;
  });

  return audio[0];
}

function getFormatFileSize(f: YtDlpFormat): string | null {
  const bytes = f.filesize ?? f.filesize_approx;
  return bytes ? formatFileSize(bytes) : null;
}

export function formatActionTitle(f: YtDlpFormat): string {
  const res = f.height ? `${f.height}p` : (f.resolution ?? "Unknown");
  const codec = getFriendlyCodecName(f.vcodec ?? "");
  const size = getFormatFileSize(f);
  return size ? `${res} · ${codec} · ${size}` : `${res} · ${codec}`;
}

export function audioActionTitle(f: YtDlpFormat): string {
  const codec = getFriendlyAudioCodecName(f.acodec ?? "");
  const kbps = f.tbr ? `${Math.round(f.tbr)} kbps` : null;
  const size = getFormatFileSize(f);
  const parts = ["Audio Only", codec, kbps, size].filter(Boolean);
  return parts.join(" · ");
}

// ── FORMAT LABEL ─────────────────────────────────────────────────────────────

export function getFormatLabel(format: DownloadFormat): string {
  switch (format.type) {
    case "best":
      return "Best Quality";
    case "audio":
      return "Audio Only";
    case "headless":
      return format.label;
    case "specific": {
      const f = format.format;
      return f.height ? `${f.height}p` : f.resolution || "Video";
    }
  }
}

// ── EXPECTED STREAMS ─────────────────────────────────────────────────────────

export function getExpectedStreams(format: DownloadFormat): 1 | 2 {
  switch (format.type) {
    case "best":
      return 2;
    case "headless":
      return 2;
    case "audio":
      return 1;
    case "specific":
      return format.hasAudio ? 1 : 2;
  }
}

// ── PROGRESS ─────────────────────────────────────────────────────────────────

export function computeProgress(
  rawPercent: number,
  expectedStreams: 1 | 2,
  streamIndex: number,
): number {
  if (expectedStreams === 1) return Math.round(rawPercent * 0.88);
  return streamIndex === 0
    ? Math.round(rawPercent * 0.44)
    : Math.round(44 + rawPercent * 0.44);
}

// ── HEADLESS SELECTOR ────────────────────────────────────────────────────────

const CODEC_FILTERS: Record<
  Exclude<ExtensionPreferences["preferredCodec"], "best">,
  string
> = {
  av1: "[vcodec^=av01]",
  hevc: "[vcodec~=(hvc1|hevc|hev1)]",
  h264: "[vcodec^=avc1]",
  vp9: "[vcodec^=vp9]",
};

export function buildHeadlessSelector(
  preferredCodec: ExtensionPreferences["preferredCodec"],
  maxQuality: ExtensionPreferences["maxQuality"],
): string {
  const cap = maxQuality !== "best" ? parseInt(maxQuality) : null;
  const codecFilter =
    preferredCodec !== "best" ? CODEC_FILTERS[preferredCodec] : "";

  if (!codecFilter && !cap) return "bestvideo+bestaudio/best";
  if (!codecFilter && cap)
    return `bestvideo[height<=${cap}]+bestaudio/best[height<=${cap}]`;
  if (codecFilter && !cap)
    return `bestvideo${codecFilter}+bestaudio/bestvideo+bestaudio/best`;
  return `bestvideo${codecFilter}[height<=${cap}]+bestaudio/bestvideo[height<=${cap}]+bestaudio/best[height<=${cap}]/best`;
}

export function buildHeadlessLabel(
  preferredCodec: ExtensionPreferences["preferredCodec"],
  maxQuality: ExtensionPreferences["maxQuality"],
): string {
  const parts: string[] = [];
  if (maxQuality !== "best") {
    const cap = parseInt(maxQuality);
    parts.push(cap >= 2160 ? "4K" : `${cap}p`);
  }
  if (preferredCodec !== "best") {
    parts.push(CODEC_NAMES[preferredCodec]);
  }
  return parts.length > 0 ? parts.join(" · ") : "Best Quality";
}

// ── DEPENDENCY CHECK ─────────────────────────────────────────────────────────

const DEPS_CHECKED_KEY = "deps-checked-v1";

export async function checkDependencies(): Promise<string | null> {
  const checked = await LocalStorage.getItem<boolean>(DEPS_CHECKED_KEY);
  if (checked) return null;

  for (const dep of ["yt-dlp", "ffmpeg", "ffprobe"]) {
    const p = findExecutable(dep);
    if (!p) return dep;
  }

  await LocalStorage.setItem(DEPS_CHECKED_KEY, true);
  return null;
}

export async function markDepsInstalled(): Promise<void> {
  await LocalStorage.setItem(DEPS_CHECKED_KEY, true);
}

// ── COOKIE FILE CHECK ────────────────────────────────────────────────────────

export function cookieFileExists(): boolean {
  try {
    return existsSync(getCookieFile());
  } catch {
    return false;
  }
}

// ── PROCESS UTILS ────────────────────────────────────────────────────────────

// Anchor the pgrep/pkill pattern so e.g. `abc-123.log` cannot match `abc-1234.log`.
// The shell command that runs yt-dlp redirects to `'<logFile>' 2>&1`, so the
// path is followed by `' ` (closing quote + space) in the running command line.
// Matching the closing single-quote disambiguates the boundary even if the next
// log path differs only by a trailing-character collision.
function logFilePgrepPattern(logFile: string): string {
  return shq(logFile + "' ");
}

export function isProcessRunning(logFile: string): boolean {
  try {
    const out = execSync(
      `pgrep -f ${logFilePgrepPattern(logFile)} 2>/dev/null || true`,
      {
        encoding: "utf-8",
        env: { ...process.env, PATH: getPath() },
      },
    ).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

export function killProcessByLogFile(logFile: string): void {
  try {
    execSync(
      `pkill -TERM -f ${logFilePgrepPattern(logFile)} 2>/dev/null || true`,
      {
        env: { ...process.env, PATH: getPath() },
      },
    );
  } catch {
    // ignore
  }
}
