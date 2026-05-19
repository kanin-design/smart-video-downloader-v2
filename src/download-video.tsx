import {
  Action,
  ActionPanel,
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
import { getActiveTabUrl } from "./active-url.js";
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
  selectBestAudioFormat,
  selectBestFormat,
  truncateTitle,
} from "./utils.js";
import CookieSettings from "./cookie-settings.js";

type VideoState =
  | { type: "init" }
  | { type: "loading"; url: string }
  | { type: "noVideo" }
  | { type: "cookieError" }
  | { type: "error"; message: string }
  | {
      type: "loaded";
      url: string;
      meta: VideoMetadata;
      allFormats: YtDlpFormat[];
      bestFormat: YtDlpFormat | null;
      audioFormat: YtDlpFormat | null;
    };

export default function DownloadVideo() {
  const prefs = getPreferenceValues<ExtensionPreferences>();
  const { push } = useNavigation();

  const [videoState, setVideoState] = useState<VideoState>({ type: "init" });
  const [url, setUrl] = useState<string | null>(null);
  const [refetchCount, setRefetchCount] = useState(0);
  const fetchRef = useRef<CancelFetch | null>(null);

  // On mount: get the URL from the frontmost browser tab — once
  useEffect(() => {
    async function start() {
      await ensureInitialized();
      let activeUrl: string | null = null;
      try {
        activeUrl = await getActiveTabUrl();
      } catch {
        setVideoState({
          type: "error",
          message:
            "Allow Raycast to control your browser in System Settings → Privacy → Automation",
        });
        return;
      }
      if (!activeUrl) {
        setVideoState({ type: "noVideo" });
        return;
      }
      setUrl(activeUrl);
    }
    start();
  }, []);

  // Fetch metadata whenever we have a URL (or cookies are re-extracted)
  useEffect(() => {
    if (!url) return;

    fetchRef.current?.cancel();
    setVideoState({ type: "loading", url });

    fetchRef.current = startMetadataFetch(
      url,
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
          url,
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
  }, [url, refetchCount]);

  const onCookiesExtracted = useCallback(
    () => setRefetchCount((c) => c + 1),
    [],
  );

  function pushCookieSettings() {
    push(<CookieSettings onSuccess={onCookiesExtracted} />);
  }

  async function doDownload(
    format: JobRecord["format"],
    meta: VideoMetadata,
    currentUrl: string,
  ) {
    try {
      startDownload(
        currentUrl,
        meta.id,
        meta.title,
        meta.thumbnail,
        format,
        prefs,
        meta.uploader,
      );
      showHUD(`⬇ Downloading "${truncateTitle(meta.title, 40)}"`, {
        clearRootSearch: true,
      });
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not start download",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Markdown ───────────────────────────────────────────────────────────────

  let markdown = "";

  if (videoState.type === "init") {
    markdown = `# Loading…`;
  } else if (videoState.type === "noVideo") {
    markdown = `# No Video Found\n\n*Open a video in your browser, then run this command.*`;
  } else if (videoState.type === "loading") {
    markdown = `# Loading…\n\n*Fetching video metadata…*`;
  } else if (videoState.type === "cookieError") {
    markdown = `# Cookies Required\n\n*Open the Actions menu to set up cookies for this site.*`;
  } else if (videoState.type === "error") {
    markdown = `# Could not load video\n\n*${videoState.message.replace(/\n/g, "  \n")}*`;
  } else if (videoState.type === "loaded") {
    const { meta } = videoState;
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

  // ── Actions ────────────────────────────────────────────────────────────────

  const cookieSection = (
    <CookieSection
      onCookiesExtracted={onCookiesExtracted}
      pushCookieSettings={pushCookieSettings}
    />
  );

  function buildActions(): React.ReactNode {
    if (videoState.type !== "loaded") {
      return (
        <ActionPanel>
          {videoState.type === "cookieError" ? cookieSection : null}
          {cookieSection}
        </ActionPanel>
      );
    }

    const {
      meta,
      allFormats,
      bestFormat,
      audioFormat,
      url: currentUrl,
    } = videoState;

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
          onAction={() => doDownload(formatType, meta, currentUrl)}
        />
        {audioFormat && (
          <Action
            title={audioActionTitle(audioFormat)}
            icon={Icon.Music}
            shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
            onAction={() => doDownload({ type: "audio" }, meta, currentUrl)}
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
                    currentUrl,
                  );
                }}
              />
            ))}
          </ActionPanel.Section>
        )}
        {cookieSection}
      </ActionPanel>
    );
  }

  // ── Metadata sidebar ───────────────────────────────────────────────────────

  function renderLoadedMetadata(s: Extract<VideoState, { type: "loaded" }>) {
    const { meta, bestFormat, audioFormat, allFormats, url: currentUrl } = s;

    const codecLabels: Record<
      Exclude<ExtensionPreferences["preferredCodec"], "best">,
      string
    > = { av1: "AV1", vp9: "VP9", hevc: "HEVC", h264: "H.264" };
    const constraintParts: string[] = [];
    if (prefs.maxQuality !== "best")
      constraintParts.push(
        `≤${prefs.maxQuality === "2160" ? "4K" : prefs.maxQuality + "p"}`,
      );
    if (prefs.preferredCodec !== "best")
      constraintParts.push(codecLabels[prefs.preferredCodec]);
    const selectedLabel =
      constraintParts.length > 0
        ? `Selected Format (${constraintParts.join(", ")})`
        : "Selected Format";

    const estVideoSize = bestFormat?.filesize ?? bestFormat?.filesize_approx;
    const estAudioSize = audioFormat?.filesize ?? audioFormat?.filesize_approx;
    const estSize =
      estVideoSize && estAudioSize
        ? formatFileSize(estVideoSize + estAudioSize)
        : estVideoSize
          ? formatFileSize(estVideoSize)
          : "—";

    let hostname = currentUrl;
    try {
      hostname = new URL(currentUrl).hostname.replace(/^www\./, "");
    } catch {
      /* leave as raw URL */
    }

    const uploadedLabel = formatUploadDate(meta.upload_date);

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
        <Detail.Metadata.Link
          title="Source"
          target={currentUrl}
          text={hostname}
        />
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
