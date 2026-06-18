import { Clipboard, getPreferenceValues, showHUD } from "@raycast/api";
import { getActiveTabUrl } from "./active-url.js";
import { startDownload } from "./downloader.js";
import { ensureInitialized } from "./store.js";
import type { ExtensionPreferences, JobRecord } from "./types.js";
import {
  buildHeadlessLabel,
  buildHeadlessSelector,
  isVideoUrl,
} from "./utils.js";

export default async function QuickDownload() {
  const prefs = getPreferenceValues<ExtensionPreferences>();

  await ensureInitialized();

  // 1. Try the frontmost browser tab
  let url: string | null = null;
  try {
    url = await getActiveTabUrl();
  } catch {
    await showHUD(
      "❌ Allow Raycast to control your browser in System Settings → Privacy → Automation",
      {
        clearRootSearch: true,
      },
    );
    return;
  }

  // 2. Fall back to clipboard if no browser is in front
  if (!url) {
    try {
      const clip = await Clipboard.readText();
      if (clip && isVideoUrl(clip)) url = clip;
    } catch {
      /* ignore */
    }
  }

  if (!url || !isVideoUrl(url)) {
    await showHUD("❌ No video found", { clearRootSearch: true });
    return;
  }

  const selector = buildHeadlessSelector(
    prefs.preferredCodec,
    prefs.maxQuality,
  );
  const label = buildHeadlessLabel(prefs.preferredCodec, prefs.maxQuality);
  const format: JobRecord["format"] = { type: "headless", selector, label };

  const urlId = String(
    Math.abs(
      url
        .split("")
        .reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0),
    ),
  );

  let job: JobRecord;
  try {
    let videoTitle = url;
    try {
      videoTitle = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      /* keep raw URL if parsing fails */
    }
    job = startDownload(url, urlId, videoTitle, "", format, prefs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await showHUD(`❌ ${msg}`, { clearRootSearch: true });
    return;
  }

  if (job.completedAt) {
    await showHUD("✓ Already downloaded — open Download Manager to find it", {
      clearRootSearch: true,
    });
  } else {
    await showHUD(`⬇ Downloading…`, { clearRootSearch: true });
  }
}
