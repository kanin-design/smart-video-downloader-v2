import {
  Action,
  ActionPanel,
  Icon,
  LocalStorage,
  showToast,
  Toast,
} from "@raycast/api";
import { extractCookies } from "../downloader.js";

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

interface CookieSectionProps {
  onCookiesExtracted?: () => void;
  pushCookieSettings: () => void;
}

// Module-level guard prevents stacked toasts when the user hammers ⌘⇧K. The
// extractCookies mutex already prevents concurrent extractions; this just
// suppresses the redundant second toast UI.
let reExtractInFlight = false;

export function CookieSection({
  onCookiesExtracted,
  pushCookieSettings,
}: CookieSectionProps) {
  async function reExtract() {
    if (reExtractInFlight) return;
    const browser = await getLastBrowser();
    if (!browser) {
      // No configured browser — open Cookie Settings instead of nagging with a
      // toast the user can't act on.
      pushCookieSettings();
      return;
    }

    reExtractInFlight = true;
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Re-extracting cookies from ${browser}…`,
    });

    try {
      const ok = await extractCookies(browser);
      if (ok) {
        await saveLastBrowser(browser);
        toast.style = Toast.Style.Success;
        toast.title = "Cookies saved";
        toast.message = `${browser} cookies are now active`;
        onCookiesExtracted?.();
      } else {
        toast.style = Toast.Style.Failure;
        toast.title = "Could not extract cookies";
        toast.message = `Make sure you're signed in to ${browser} and try again.`;
      }
    } finally {
      reExtractInFlight = false;
    }
  }

  return (
    <ActionPanel.Section title="Cookies">
      <Action
        title="Cookie Settings"
        icon={Icon.Gear}
        onAction={pushCookieSettings}
      />
      <Action
        title="Re-Extract Cookies"
        icon={Icon.Key}
        shortcut={{ modifiers: ["cmd", "shift"], key: "k" }}
        onAction={reExtract}
      />
    </ActionPanel.Section>
  );
}
