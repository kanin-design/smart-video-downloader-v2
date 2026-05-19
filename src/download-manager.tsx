import {
  Action,
  ActionPanel,
  Alert,
  Clipboard,
  Color,
  confirmAlert,
  getPreferenceValues,
  Icon,
  Image,
  List,
  open,
  showHUD,
  showInFinder,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { existsSync, rmSync, statSync } from "fs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CookieSection } from "./components/CookieSection.js";
import { InstallerView } from "./components/InstallerView.js";
import {
  cancelDownload,
  startDownload,
  startMetadataFetch,
  type CancelFetch,
} from "./downloader.js";
import {
  ensureInitialized,
  getJobs,
  getProgress,
  removeJob,
  setJobs,
  subscribe,
} from "./store.js";
import type {
  CompletedJob,
  ExtensionPreferences,
  JobRecord,
  VideoMetadata,
  YtDlpFormat,
} from "./types.js";
import {
  audioActionTitle,
  checkDependencies,
  cookieFileExists,
  deduplicateFormats,
  formatActionTitle,
  formatDuration,
  formatFileSize,
  formatProgressTag,
  getResolutionColor,
  isValidUrl,
  resolveDownloadPath,
  selectBestAudioFormat,
  selectBestFormat,
  stripSiteNameSuffix,
  truncateTitle,
} from "./utils.js";
import CookieSettings from "./cookie-settings.js";

// ── Types ────────────────────────────────────────────────────────────────────

type VideoState =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "urlMatch"; job: CompletedJob }
  | {
      type: "loaded";
      meta: VideoMetadata;
      allFormats: YtDlpFormat[];
      bestFormat: YtDlpFormat | null;
      audioFormat: YtDlpFormat | null;
    }
  | { type: "cookieError" }
  | { type: "error"; message: string };

// ── Helpers ──────────────────────────────────────────────────────────────────

function getFileSizeStr(filePath: string): string {
  try {
    return formatFileSize(statSync(filePath).size);
  } catch {
    return "—";
  }
}

function completedTooltip(job: CompletedJob): string {
  const info = job.mediaInfo;
  const date = new Date(job.completedAt).toLocaleDateString();
  if (!info) return date;
  const parts = [
    info.width && info.height ? `${info.width}×${info.height}` : null,
    info.videoCodec ?? null,
    info.audioCodec ?? null,
    info.bitrateMbps != null ? `${info.bitrateMbps} Mbps` : null,
    date,
  ].filter(Boolean);
  return parts.join(" · ");
}

function isCompleted(j: JobRecord): j is CompletedJob {
  return j.completedAt != null && j.filePath != null && existsSync(j.filePath);
}

function getFaviconUrl(url: string): string {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
  } catch {
    return "extension-icon.png";
  }
}

/** Accessory list for a completed item: [size, colored-res-tag, Downloaded-tag] */
function completedAccessories(
  job: CompletedJob,
  tooltip: string,
): List.Item.Accessory[] {
  const info = job.mediaInfo;
  const resLabel = info?.resolution ?? job.formatLabel;
  const resColor = getResolutionColor(info?.height ?? 0);
  const size = getFileSizeStr(job.filePath);
  return [
    { text: size },
    { tag: { value: resLabel, color: resColor } },
    { tag: { value: "Downloaded", color: Color.Green }, tooltip },
  ];
}

// ── Component ────────────────────────────────────────────────────────────────

export default function DownloadManager() {
  const prefs = getPreferenceValues<ExtensionPreferences>();
  const { push } = useNavigation();

  // All hooks before any early return
  const [searchText, setSearchText] = useState("");
  const [phase, setPhase] = useState<"init" | "needsInstall" | "ready">("init");
  const [missingDep, setMissingDep] = useState<string | null>(null);
  const [videoState, setVideoState] = useState<VideoState>({ type: "idle" });
  const [jobs, setLocalJobs] = useState<JobRecord[]>([]);
  const [refetchCount, setRefetchCount] = useState(0);
  const fetchRef = useRef<CancelFetch | null>(null);

  // Initialize: run dep check and store init in parallel
  useEffect(() => {
    Promise.all([checkDependencies(), ensureInitialized()]).then(
      async ([missing]) => {
        if (missing) {
          setMissingDep(missing);
          setPhase("needsInstall");
          return;
        }
        if (prefs.autoLoadUrlFromClipboard) {
          try {
            const text = await Clipboard.readText();
            if (text && isValidUrl(text)) setSearchText(text);
          } catch {
            /* ignore */
          }
        }
        setLocalJobs([...getJobs()]);
        setPhase("ready");
      },
    );
  }, []);

  // Subscribe to store changes
  useEffect(() => {
    return subscribe(() => setLocalJobs([...getJobs()]));
  }, []);

  // Handle URL changes and metadata fetching
  useEffect(() => {
    if (phase !== "ready") return;

    fetchRef.current?.cancel();
    fetchRef.current = null;

    if (!searchText || !isValidUrl(searchText)) {
      setVideoState({ type: "idle" });
      return;
    }

    // Check for URL match in completed jobs
    const match = getJobs().find(
      (j): j is CompletedJob => j.url === searchText && isCompleted(j),
    );
    if (match) {
      setVideoState({ type: "urlMatch", job: match });
      return;
    }

    // Fetch metadata
    setVideoState({ type: "loading" });
    fetchRef.current = startMetadataFetch(
      searchText,
      prefs,
      (meta) => {
        const allFormats = deduplicateFormats(meta.formats);
        const bestFormat = selectBestFormat(
          allFormats,
          prefs.maxQuality,
          prefs.preferredCodec,
        );
        const audioFormat = selectBestAudioFormat(meta.formats);
        setVideoState({
          type: "loaded",
          meta,
          allFormats,
          bestFormat,
          audioFormat,
        });
      },
      (msg, isCookie) => {
        if (isCookie) {
          setVideoState({ type: "cookieError" });
          // Only fire the toast when the EmptyView won't be visible (i.e. when
          // active or completed items already populate the list and would
          // otherwise hide the EmptyView). Two surfaces for the same problem
          // is a double signal; the EmptyView alone is enough when it shows.
          const itemsVisible =
            getJobs().some((j) => !j.completedAt) ||
            getJobs().some(
              (j) => j.completedAt && j.filePath && existsSync(j.filePath),
            );
          if (itemsVisible) {
            showToast({
              style: Toast.Style.Failure,
              title: "Cookies Required",
              message: "Press ⌘⇧K to re-extract cookies",
            });
          }
        } else {
          setVideoState({ type: "error", message: msg });
        }
      },
    );

    return () => {
      fetchRef.current?.cancel();
      fetchRef.current = null;
    };
  }, [searchText, phase, refetchCount]);

  // Cookie retry callback
  const onCookiesExtracted = useCallback(
    () => setRefetchCount((c) => c + 1),
    [],
  );
  function pushCookieSettings() {
    push(<CookieSettings onSuccess={onCookiesExtracted} />);
  }

  // ── Installer phase ────────────────────────────────────────────────────────
  if (phase === "needsInstall" && missingDep) {
    return (
      <InstallerView
        missingDep={missingDep}
        onInstalled={() => {
          setMissingDep(null);
          setLocalJobs([...getJobs()]);
          setPhase("ready");
        }}
      />
    );
  }

  // ── Derived state ──────────────────────────────────────────────────────────
  const activeJobs = jobs.filter((j) => !j.completedAt);
  const completedJobs = useMemo<CompletedJob[]>(
    () =>
      jobs.filter(isCompleted).sort((a, b) => b.completedAt - a.completedAt), // newest first
    [jobs],
  );
  const isUrlMatch = videoState.type === "urlMatch";
  const isLoadingMeta = videoState.type === "loading";

  // ── Actions factories ──────────────────────────────────────────────────────

  function completedItemActions(job: CompletedJob, isMatchItem = false) {
    return (
      <ActionPanel>
        <Action
          title="Open File"
          icon={Icon.Document}
          onAction={() => open(job.filePath)}
        />
        <Action
          title="Show in Finder"
          icon={Icon.Finder}
          shortcut={{ modifiers: ["cmd", "shift"], key: "o" }}
          onAction={() => showInFinder(job.filePath)}
        />
        <Action
          title="Copy File to Clipboard"
          icon={Icon.Clipboard}
          shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          onAction={async () => {
            await Clipboard.copy({ file: job.filePath });
            await showHUD("Copied to clipboard");
          }}
        />
        {isMatchItem && (
          <Action
            title="Re-Download"
            icon={Icon.Download}
            shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
            onAction={() => {
              // Lock the UI into loading before removing the job — otherwise
              // the store subscription may re-render once in urlMatch state
              // (jobs still contains the match) before the refetch effect fires.
              setVideoState({ type: "loading" });
              showToast({
                style: Toast.Style.Animated,
                title: "Fetching fresh metadata…",
              });
              removeJob(job.id);
              setRefetchCount((c) => c + 1);
            }}
          />
        )}
        <ActionPanel.Section title="Remove">
          <Action
            title="Delete File"
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            shortcut={{ modifiers: ["cmd", "shift"], key: "x" }}
            onAction={() => {
              try {
                rmSync(job.filePath);
              } catch {
                /* ignore */
              }
              removeJob(job.id);
            }}
          />
          <Action
            title="Remove from List"
            icon={Icon.XMarkCircle}
            shortcut={{ modifiers: ["cmd"], key: "delete" }}
            onAction={() => removeJob(job.id)}
          />
          {!isMatchItem && (
            <Action
              title="Clear All from List"
              icon={Icon.Trash}
              style={Action.Style.Destructive}
              shortcut={{ modifiers: ["cmd", "shift"], key: "delete" }}
              onAction={() => {
                setJobs(getJobs().filter((j) => !j.completedAt));
              }}
            />
          )}
        </ActionPanel.Section>
        {isMatchItem && (
          <CookieSection
            onCookiesExtracted={onCookiesExtracted}
            pushCookieSettings={pushCookieSettings}
          />
        )}
      </ActionPanel>
    );
  }

  function videoItemActions(
    meta: VideoMetadata,
    bestFormat: YtDlpFormat | null,
    audioFormat: YtDlpFormat | null,
    allFormats: YtDlpFormat[],
  ) {
    async function doDownload(format: JobRecord["format"]) {
      try {
        startDownload(
          searchText,
          meta.id || "video",
          meta.title,
          meta.thumbnail,
          format,
          prefs,
          meta.uploader,
        );
        setSearchText("");
      } catch (err) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Could not start download",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const downloadFormat: JobRecord["format"] = bestFormat
      ? {
          type: "specific",
          format: bestFormat,
          hasAudio: !!(bestFormat.acodec && bestFormat.acodec !== "none"),
        }
      : { type: "best" };

    return (
      <ActionPanel>
        <Action
          title="Download"
          icon={Icon.Download}
          onAction={() => doDownload(downloadFormat)}
        />
        {audioFormat && (
          <Action
            title={audioActionTitle(audioFormat)}
            icon={Icon.Music}
            shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
            onAction={() => doDownload({ type: "audio" })}
          />
        )}
        {allFormats.length > 0 && (
          <ActionPanel.Section title="Specific Format">
            {allFormats.map((f) => (
              <Action
                key={f.format_id}
                title={formatActionTitle(f)}
                icon={Icon.Download}
                onAction={() =>
                  doDownload({
                    type: "specific",
                    format: f,
                    hasAudio: !!(f.acodec && f.acodec !== "none"),
                  })
                }
              />
            ))}
          </ActionPanel.Section>
        )}
        <CookieSection
          onCookiesExtracted={onCookiesExtracted}
          pushCookieSettings={pushCookieSettings}
        />
      </ActionPanel>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  // The List's `isLoading` prop already shows a header spinner during loading,
  // so we deliberately do NOT render a separate "Loading…" EmptyView for that
  // state — the spinner is enough and avoids a static-icon-next-to-spinner look.

  function renderEmptyView() {
    if (videoState.type === "cookieError") {
      const hasCookies = cookieFileExists();
      const desc = hasCookies
        ? "This site blocked the download — your cookies may have expired. Press ⌘⇧K to re-connect."
        : "This site requires sign-in cookies. Open Cookie Settings to connect your browser.";
      return (
        <List.EmptyView
          icon={Icon.Lock}
          title="Cookies Required"
          description={desc}
          actions={
            <ActionPanel>
              <CookieSection
                onCookiesExtracted={onCookiesExtracted}
                pushCookieSettings={pushCookieSettings}
              />
            </ActionPanel>
          }
        />
      );
    }
    if (videoState.type === "error") {
      return (
        <List.EmptyView
          icon={Icon.XMarkCircle}
          title="Could not load video"
          description={videoState.message.split("\n")[0]}
        />
      );
    }
    // Idle / loading — when loading the list spinner covers feedback; the
    // idle copy under it is fine to keep in view.
    const hasCookies = cookieFileExists();
    const title = hasCookies
      ? "No downloads yet · Cookies active"
      : "No downloads yet";
    return (
      <List.EmptyView
        icon={{ source: "extension-icon.png" }}
        title={title}
        description="Paste a video URL to download. Your history will appear here."
      />
    );
  }

  // ── Section renderers (named to avoid IIFE-in-JSX reconciliation cost) ────

  function renderUrlMatchSection(job: CompletedJob) {
    const tooltip = completedTooltip(job);
    return (
      <List.Section title="Downloaded">
        <List.Item
          key={job.id}
          title={truncateTitle(stripSiteNameSuffix(job.title))}
          icon={{
            source: getFaviconUrl(job.url),
            fallback: "extension-icon.png",
            mask: Image.Mask.Circle,
          }}
          accessories={completedAccessories(job, tooltip)}
          actions={completedItemActions(job, true)}
        />
      </List.Section>
    );
  }

  function renderLoadedVideoSection(
    meta: VideoMetadata,
    allFormats: YtDlpFormat[],
    bestFormat: YtDlpFormat | null,
    audioFormat: YtDlpFormat | null,
  ) {
    const dur = meta.duration ? formatDuration(meta.duration) : undefined;
    return (
      <List.Section title="Video">
        <List.Item
          title={truncateTitle(meta.title)}
          subtitle={dur}
          icon={{
            source: meta.thumbnail,
            fallback: Icon.Video,
            mask: Image.Mask.RoundedRectangle,
          }}
          actions={videoItemActions(meta, bestFormat, audioFormat, allFormats)}
        />
      </List.Section>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <List
      filtering={false}
      isLoading={phase === "init" || isLoadingMeta}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Paste a video URL…"
    >
      {/* Always render EmptyView — Raycast shows it only when no items exist */}
      {renderEmptyView()}

      {/* URL-matched completed download */}
      {videoState.type === "urlMatch" && renderUrlMatchSection(videoState.job)}

      {/* Loaded metadata — video item */}
      {videoState.type === "loaded" &&
        renderLoadedVideoSection(
          videoState.meta,
          videoState.allFormats,
          videoState.bestFormat,
          videoState.audioFormat,
        )}

      {/* Active downloads */}
      {activeJobs.length > 0 && (
        <List.Section title="Downloading">
          {activeJobs.map((job) => {
            const prog = getProgress(job.id);
            const pct = prog?.percent ?? 0;
            const speed = prog?.speed ?? "";
            const tag = formatProgressTag(pct);
            const accessories: List.Item.Accessory[] = [];
            if (speed) accessories.push({ text: speed });
            accessories.push({ tag: { value: tag, color: Color.Blue } });
            return (
              <List.Item
                key={job.id}
                title={truncateTitle(job.title)}
                subtitle={job.formatLabel}
                icon={{
                  source: job.thumbnail || "extension-icon.png",
                  fallback: Icon.Video,
                  mask: Image.Mask.RoundedRectangle,
                }}
                accessories={accessories}
                actions={
                  <ActionPanel>
                    {/* Cancel as the primary destructive action — confirmAlert
                        prevents accidental triggering on bare Enter, and this
                        matches the only intent worth having on an in-progress
                        item. Open Downloads Folder moves to ⌘⇧F. */}
                    <Action
                      title="Cancel Download"
                      icon={Icon.XMarkCircle}
                      style={Action.Style.Destructive}
                      onAction={async () => {
                        const ok = await confirmAlert({
                          title: "Stop Download?",
                          message: job.title,
                          primaryAction: {
                            title: "Stop Download",
                            style: Alert.ActionStyle.Destructive,
                          },
                        });
                        if (ok) cancelDownload(job.id);
                      }}
                    />
                    <Action
                      title="Open Downloads Folder"
                      icon={Icon.Folder}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
                      onAction={() =>
                        open(resolveDownloadPath(prefs.downloadPath))
                      }
                    />
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      )}

      {/* General completed list — hidden when URL-match is active */}
      {!isUrlMatch && completedJobs.length > 0 && (
        <List.Section title="Downloaded">
          {completedJobs.map((job) => {
            const tooltip = completedTooltip(job);
            return (
              <List.Item
                key={job.id}
                title={truncateTitle(stripSiteNameSuffix(job.title))}
                icon={{
                  source: getFaviconUrl(job.url),
                  fallback: "extension-icon.png",
                  mask: Image.Mask.Circle,
                }}
                accessories={completedAccessories(job, tooltip)}
                actions={completedItemActions(job, false)}
              />
            );
          })}
        </List.Section>
      )}
    </List>
  );
}
