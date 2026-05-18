import { BrowserExtension, getPreferenceValues, showHUD } from "@raycast/api";
import { startDownload } from "./downloader.js";
import { ensureInitialized } from "./store.js";
import type { ExtensionPreferences, JobRecord, TabInfo } from "./types.js";
import {
  buildHeadlessLabel,
  buildHeadlessSelector,
  isVideoUrl,
} from "./utils.js";

export default async function QuickDownload() {
  const prefs = getPreferenceValues<ExtensionPreferences>();

  await ensureInitialized();

  let tabs: TabInfo[];
  try {
    tabs = (await BrowserExtension.getTabs()) as TabInfo[];
  } catch {
    await showHUD("❌ Raycast Browser Extension not installed", {
      clearRootSearch: true,
    });
    return;
  }

  const activeTab = tabs.find((t) => t.active) ?? tabs[0];

  if (!activeTab || !isVideoUrl(activeTab.url)) {
    await showHUD("❌ No video found in active tab", { clearRootSearch: true });
    return;
  }

  const selector = buildHeadlessSelector(
    prefs.preferredCodec,
    prefs.maxQuality,
  );
  const label = buildHeadlessLabel(prefs.preferredCodec, prefs.maxQuality);
  const format: JobRecord["format"] = { type: "headless", selector, label };

  const tabId = String(
    Math.abs(
      activeTab.url
        .split("")
        .reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0),
    ),
  );
  const title = activeTab.title || "Video";
  const thumbnail = activeTab.favicon || "";

  let job: JobRecord;
  try {
    job = startDownload(activeTab.url, tabId, title, thumbnail, format, prefs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await showHUD(`❌ ${msg}`, { clearRootSearch: true });
    return;
  }

  const displayTitle = title.length > 40 ? title.slice(0, 40) + "…" : title;
  if (job.completedAt) {
    await showHUD("✓ Already downloaded — open Download Manager to find it", {
      clearRootSearch: true,
    });
  } else {
    await showHUD(`⬇ Downloading "${displayTitle}"`, { clearRootSearch: true });
  }
}
