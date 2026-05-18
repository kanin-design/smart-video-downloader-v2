import {
  Action,
  ActionPanel,
  BrowserExtension,
  Color,
  Detail,
  getPreferenceValues,
  Icon,
  showHUD,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserExtensionRequired } from "./components/BrowserExtensionRequired.js";
import { CookieSection } from "./components/CookieSection.js";
import {
  startMetadataFetch,
  startDownload,
  type CancelFetch,
} from "./downloader.js";
import { ensureInitialized } from "./store.js";
import type {
  ExtensionPreferences,
  JobRecord,
  TabInfo,
  VideoMetadata,
  YtDlpFormat,
} from "./types.js";
import {
  audioActionTitle,
  deduplicateFormats,
  formatActionTitle,
  formatDuration,
  formatFileSize,
  formatUploadDate,
  getAudioCodecColor,
  getCodecColor,
  getFriendlyAudioCodecName,
  getFriendlyCodecName,
  getResolutionColor,
  getResolutionLabel,
  isVideoUrl,
  selectBestAudioFormat,
  selectBestFormat,
  truncateTitle,
} from "./utils.js";
import CookieSettings from "./cookie-settings.js";

type VideoState =
  | { type: "init" }
  | { type: "loading"; tab: TabInfo }
  | { type: "noTabs" }
  | { type: "cookieError" }
  | { type: "error"; message: string }
  | {
      type: "loaded";
      tab: TabInfo;
      meta: VideoMetadata;
      allFormats: YtDlpFormat[];
      bestFormat: YtDlpFormat | null;
      audioFormat: YtDlpFormat | null;
    };

export default function DownloadVideo() {
  const prefs = getPreferenceValues<ExtensionPreferences>();
  const { push } = useNavigation();

  const [browserRequired, setBrowserRequired] = useState(false);
  const [videoState, setVideoState] = useState<VideoState>({ type: "init" });
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [selectedTabUrl, setSelectedTabUrl] = useState<string | null>(null);
  const [refetchCount, setRefetchCount] = useState(0);

  const fetchRef = useRef<CancelFetch | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Always-current ref so the metadata effect reads latest tabs without needing
  // tabs in its dep array (which would cause a refetch on every 2s poll).
  const tabsRef = useRef<TabInfo[]>([]);
  tabsRef.current = tabs;

  // Poll tabs every 2 seconds
  useEffect(() => {
    async function init() {
      await ensureInitialized();
    }
    init();

    async function pollTabs() {
      let allTabs: TabInfo[];
      try {
        allTabs = (await BrowserExtension.getTabs()) as TabInfo[];
      } catch {
        setBrowserRequired(true);
        return;
      }

      const videoTabs = allTabs.filter((t) => isVideoUrl(t.url));
      videoTabs.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));

      setTabs(videoTabs);

      if (videoTabs.length === 0) {
        setVideoState({ type: "noTabs" });
        return;
      }

      const activeTab = videoTabs.find((t) => t.active) ?? videoTabs[0];

      setSelectedTabUrl((prev) => {
        // Auto-jump only on first load; after that the user controls selection
        if (prev === null) return activeTab.url;
        return prev;
      });
    }

    pollTabs();
    pollRef.current = setInterval(pollTabs, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Fetch metadata when selected tab changes or cookies are re-extracted
  useEffect(() => {
    if (!selectedTabUrl) return;
    const tab = tabsRef.current.find((t) => t.url === selectedTabUrl);
    if (!tab) return;

    fetchRef.current?.cancel();
    setVideoState({ type: "loading", tab });

    fetchRef.current = startMetadataFetch(
      tab.url,
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
          tab,
          meta,
          allFormats,
          bestFormat,
          audioFormat,
        });
      },
      (msg, isCookie) => {
        setVideoState(
          isCookie ? { type: "cookieError" } : { type: "error", message: msg },
        );
      },
    );

    return () => {
      fetchRef.current?.cancel();
    };
  }, [selectedTabUrl, refetchCount]);

  const onCookiesExtracted = useCallback(
    () => setRefetchCount((c) => c + 1),
    [],
  );

  function pushCookieSettings() {
    push(<CookieSettings onSuccess={onCookiesExtracted} />);
  }

  if (browserRequired)
    return (
      <BrowserExtensionRequired onRetry={() => setBrowserRequired(false)} />
    );

  async function doDownload(
    format: JobRecord["format"],
    meta: VideoMetadata,
    tab: TabInfo,
  ) {
    try {
      startDownload(
        tab.url,
        meta.id,
        meta.title,
        meta.thumbnail,
        format,
        prefs,
        meta.uploader,
      );
      const title = truncateTitle(meta.title, 40);
      showHUD(`⬇ Downloading "${title}"`, { clearRootSearch: true });
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not start download",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const codecLabels: Record<
    Exclude<ExtensionPreferences["preferredCodec"], "best">,
    string
  > = { av1: "AV1", vp9: "VP9", hevc: "HEVC", h264: "H.264" };
  const constraintLabel = (() => {
    const parts: string[] = [];
    if (prefs.maxQuality !== "best")
      parts.push(
        `≤${prefs.maxQuality === "2160" ? "4K" : prefs.maxQuality + "p"}`,
      );
    if (prefs.preferredCodec !== "best")
      parts.push(codecLabels[prefs.preferredCodec]);
    return parts.length > 0 ? ` (${parts.join(", ")})` : "";
  })();

  // Build markdown based on state
  let markdown = "";

  if (videoState.type === "init") {
    markdown = `# Loading…\n\n*Detecting video tabs…*`;
  } else if (videoState.type === "noTabs") {
    markdown = `# No Video Tabs Found\n\n*Open a video on YouTube, Vimeo, Twitter/X, TikTok, or another supported site.*`;
  } else if (videoState.type === "loading") {
    const tab = videoState.tab;
    markdown = `# ${tab.title || "Loading…"}\n\n*Fetching video metadata…*`;
  } else if (videoState.type === "cookieError") {
    markdown = `# Cookies Required\n\n*Open the Actions menu to set up cookies for this site.*`;
  } else if (videoState.type === "error") {
    markdown = `# Could not load video\n\n*${videoState.message.replace(/\n/g, "  \n")}*`;
  } else if (videoState.type === "loaded") {
    const { meta } = videoState;
    // Subtitle: uploader · date · duration — drop missing pieces silently
    // rather than showing placeholders.
    const dur = meta.duration ? formatDuration(meta.duration) : null;
    const dateLabel = formatUploadDate(meta.upload_date);
    const subtitleParts: string[] = [];
    if (meta.uploader) subtitleParts.push(`**${meta.uploader}**`);
    if (dateLabel) subtitleParts.push(dateLabel);
    if (dur) subtitleParts.push(dur);
    const sections = [`# ${meta.title}`];
    if (subtitleParts.length > 0) sections.push(subtitleParts.join(" · "));
    sections.push(`<img src="${meta.thumbnail}" height="180" />`);
    markdown = sections.join("\n\n");
  }

  // Actions
  const cookieSection = (
    <CookieSection
      onCookiesExtracted={onCookiesExtracted}
      pushCookieSettings={pushCookieSettings}
    />
  );

  const otherTabsSection = (() => {
    const others = tabs.filter((t) => t.url !== selectedTabUrl);
    if (others.length === 0) return null;
    return (
      <ActionPanel.Section title="Other Video Tabs">
        {others.map((t) => (
          <Action
            key={t.url}
            title={truncateTitle(t.title || t.url, 50)}
            icon={Icon.Globe}
            onAction={() => setSelectedTabUrl(t.url)}
          />
        ))}
      </ActionPanel.Section>
    );
  })();

  function buildActions(): React.ReactNode {
    if (videoState.type !== "loaded") {
      // Other Video Tabs is useful even in error/loading/cookie states so the
      // user can switch to a working tab without restarting the command. In a
      // cookieError, however, the cookie section IS the remediation and should
      // come first.
      if (videoState.type === "cookieError") {
        return (
          <ActionPanel>
            {cookieSection}
            {otherTabsSection}
          </ActionPanel>
        );
      }
      return (
        <ActionPanel>
          {otherTabsSection}
          {cookieSection}
        </ActionPanel>
      );
    }

    const { meta, tab, allFormats, bestFormat, audioFormat } = videoState;

    const formatType: JobRecord["format"] = bestFormat
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
          onAction={() => doDownload(formatType, meta, tab)}
        />
        {audioFormat && (
          <Action
            title={audioActionTitle(audioFormat)}
            icon={Icon.Music}
            shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
            onAction={() => doDownload({ type: "audio" }, meta, tab)}
          />
        )}
        {allFormats.length > 0 && (
          <ActionPanel.Section title="Specific Format">
            {allFormats.map((f) => (
              <Action
                key={f.format_id}
                title={formatActionTitle(f)}
                icon={Icon.Download}
                onAction={() => {
                  const hasAudio = !!(f.acodec && f.acodec !== "none");
                  doDownload(
                    { type: "specific", format: f, hasAudio },
                    meta,
                    tab,
                  );
                }}
              />
            ))}
          </ActionPanel.Section>
        )}
        {otherTabsSection}
        {cookieSection}
      </ActionPanel>
    );
  }

  function renderLoadedMetadata(s: Extract<VideoState, { type: "loaded" }>) {
    const { meta, bestFormat, audioFormat, allFormats, tab } = s;
    const selectedLabel = `Selected Format${constraintLabel}`;
    const estVideoSize = bestFormat?.filesize ?? bestFormat?.filesize_approx;
    const estAudioSize = audioFormat?.filesize ?? audioFormat?.filesize_approx;
    const estSize =
      estVideoSize && estAudioSize
        ? formatFileSize(estVideoSize + estAudioSize)
        : estVideoSize
          ? formatFileSize(estVideoSize)
          : "—";
    let hostname = tab.url;
    try {
      hostname = new URL(tab.url).hostname.replace(/^www\./, "");
    } catch {
      // leave fallback as the raw URL
    }
    const uploadedLabel = formatUploadDate(meta.upload_date);
    // Deduplicate by height — allFormats may have AV1 + H.264 for the same
    // resolution, which would otherwise render duplicate "1080p" tags here.
    const uniqueByHeight = [
      ...new Map(
        allFormats
          .filter((f) => (f.height ?? 0) >= 480)
          .map((f) => [f.height ?? 0, f]),
      ).values(),
    ].slice(0, 6);

    return (
      <Detail.Metadata>
        <Detail.Metadata.TagList title={selectedLabel}>
          {bestFormat ? (
            <>
              <Detail.Metadata.TagList.Item
                text={getResolutionLabel(bestFormat.height ?? 0)}
                color={getResolutionColor(bestFormat.height ?? 0)}
              />
              <Detail.Metadata.TagList.Item
                text={getFriendlyCodecName(bestFormat.vcodec ?? "")}
                color={getCodecColor(bestFormat.vcodec ?? "")}
              />
              {bestFormat.acodec && bestFormat.acodec !== "none" && (
                <Detail.Metadata.TagList.Item
                  text={getFriendlyAudioCodecName(bestFormat.acodec)}
                  color={getAudioCodecColor(bestFormat.acodec)}
                />
              )}
            </>
          ) : (
            <Detail.Metadata.TagList.Item text="Best" color={Color.Blue} />
          )}
        </Detail.Metadata.TagList>
        <Detail.Metadata.Separator />
        <Detail.Metadata.Label title="Download size" text={estSize} />
        {/* Duration is shown in the markdown subtitle — omit here to avoid
            redundancy. Uploaded carries higher signal for the download decision. */}
        {uploadedLabel && (
          <Detail.Metadata.Label title="Uploaded" text={uploadedLabel} />
        )}
        {meta.channel_url && meta.uploader ? (
          <Detail.Metadata.Link
            title="Channel"
            target={meta.channel_url}
            text={meta.uploader}
          />
        ) : meta.uploader ? (
          <Detail.Metadata.Label title="Channel" text={meta.uploader} />
        ) : null}
        <Detail.Metadata.Link title="Source" target={tab.url} text={hostname} />
        <Detail.Metadata.Separator />
        <Detail.Metadata.TagList title="Also Available">
          {uniqueByHeight.map((f) => (
            <Detail.Metadata.TagList.Item
              key={f.format_id}
              text={getResolutionLabel(f.height ?? 0)}
              color={getResolutionColor(f.height ?? 0)}
            />
          ))}
          {audioFormat && (
            <Detail.Metadata.TagList.Item
              text="Audio"
              color={Color.SecondaryText}
            />
          )}
        </Detail.Metadata.TagList>
      </Detail.Metadata>
    );
  }

  return (
    <Detail
      isLoading={videoState.type === "init" || videoState.type === "loading"}
      markdown={markdown}
      actions={buildActions()}
      metadata={
        videoState.type === "loaded"
          ? renderLoadedMetadata(videoState)
          : undefined
      }
    />
  );
}
