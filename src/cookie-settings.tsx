import {
  Action,
  ActionPanel,
  Alert,
  Color,
  confirmAlert,
  Icon,
  List,
  LocalStorage,
  showToast,
  Toast,
} from "@raycast/api";
import { existsSync, rmSync } from "fs";
import { useEffect, useState } from "react";
import {
  clearCookieStorage,
  extractCookies,
  getLastBrowser,
  LAST_EXTRACTED_AT_KEY,
  saveLastBrowser,
} from "./downloader.js";
import { getCookieFile } from "./utils.js";

const BROWSERS = [
  "Firefox",
  "Chrome",
  "Safari",
  "Brave",
  "Chromium",
  "Edge",
  "Opera",
  "Vivaldi",
  "Whale",
];

interface CookieState {
  activeBrowser: string | null;
  extractedAt: number | null;
}

interface CookieSettingsProps {
  onSuccess?: () => void;
}

export default function CookieSettings({ onSuccess }: CookieSettingsProps) {
  const [state, setState] = useState<CookieState>({
    activeBrowser: null,
    extractedAt: null,
  });
  const [isLoading, setIsLoading] = useState(true);

  async function loadState() {
    const browser = await getLastBrowser();
    const at = await LocalStorage.getItem<number>(LAST_EXTRACTED_AT_KEY);
    setState({ activeBrowser: browser, extractedAt: at ?? null });
    setIsLoading(false);
  }

  useEffect(() => {
    loadState();
  }, []);

  async function handleExtract(browser: string) {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Extracting cookies from ${browser}…`,
      message: `Make sure you're signed in to the sites you want to download from`,
    });

    const ok = await extractCookies(browser);

    if (ok) {
      await saveLastBrowser(browser);
      toast.style = Toast.Style.Success;
      toast.title = "Cookies saved";
      toast.message = `${browser} cookies are now active`;
      await loadState();
      onSuccess?.();
    } else {
      toast.style = Toast.Style.Failure;
      toast.title = "Could not extract cookies";
      toast.message = `Make sure you're signed in to ${browser} and try again.`;
    }
  }

  async function handleClear() {
    const browserName = state.activeBrowser ?? "active browser";
    const ok = await confirmAlert({
      title: "Clear saved cookies?",
      message: `${browserName} cookies will be permanently deleted. You can set up cookies again anytime from Cookie Settings.`,
      primaryAction: {
        title: "Clear",
        style: Alert.ActionStyle.Destructive,
      },
    });
    if (!ok) return;
    try {
      const file = getCookieFile();
      if (existsSync(file)) rmSync(file);
      await clearCookieStorage();
      await showToast({ style: Toast.Style.Success, title: "Cookies cleared" });
      await loadState();
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not delete cookie file",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <List navigationTitle="Cookie Settings" isLoading={isLoading}>
      {BROWSERS.map((browser) => {
        const isActive = state.activeBrowser === browser;
        const accessories: List.Item.Accessory[] = [];

        if (isActive) {
          accessories.push({ tag: { value: "Active", color: Color.Green } });
          if (state.extractedAt) {
            accessories.push({
              date: new Date(state.extractedAt),
              tooltip: "Last extracted",
            });
          }
        }

        const actionTitle = isActive
          ? `Re-Extract from ${browser}`
          : `Extract from ${browser}`;

        return (
          <List.Item
            key={browser}
            title={browser}
            icon={
              isActive
                ? { source: Icon.Globe, tintColor: Color.Green }
                : Icon.Globe
            }
            accessories={accessories}
            actions={
              <ActionPanel>
                <Action
                  title={actionTitle}
                  onAction={() => handleExtract(browser)}
                />
                {/* Manage only appears on the active browser — otherwise the
                    user could open Firefox's panel and clear Chrome's cookies
                    with no indication of what was being cleared. */}
                {isActive && (
                  <ActionPanel.Section title="Manage">
                    <Action
                      title="Clear Saved Cookies"
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      onAction={handleClear}
                    />
                  </ActionPanel.Section>
                )}
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
