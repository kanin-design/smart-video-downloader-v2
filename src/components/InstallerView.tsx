import {
  Action,
  ActionPanel,
  Detail,
  getPreferenceValues,
  Icon,
  open,
  openExtensionPreferences,
  showToast,
  Toast,
} from "@raycast/api";
import { execa } from "execa";
import { useState } from "react";
import { getEnv, markDepsInstalled } from "../utils.js";
import type { ExtensionPreferences } from "../types.js";

interface Props {
  missingDep: string;
  onInstalled: () => void;
}

export function InstallerView({ missingDep, onInstalled }: Props) {
  const prefs = getPreferenceValues<ExtensionPreferences>();
  const [isInstalling, setIsInstalling] = useState(false);

  async function install() {
    setIsInstalling(true);
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Installing…",
      message: "This may take up to 2 minutes — please don't close Raycast",
    });

    try {
      await execa(prefs.homebrewPath, ["install", "yt-dlp", "ffmpeg"], {
        env: getEnv(),
      });
      await markDepsInstalled();
      toast.style = Toast.Style.Success;
      toast.title = "Installed";
      toast.message = "yt-dlp and ffmpeg are ready";
      onInstalled();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ENOENT") || msg.includes("not found")) {
        toast.style = Toast.Style.Failure;
        toast.title = "Homebrew not found";
        toast.message = "Install Homebrew first, then try again";
        toast.primaryAction = {
          title: "Open Preferences",
          onAction: () => openExtensionPreferences(),
        };
        toast.secondaryAction = {
          title: "Open brew.sh",
          onAction: async () => {
            const { open } = await import("@raycast/api");
            await open("https://brew.sh");
          },
        };
      } else {
        toast.style = Toast.Style.Failure;
        toast.title = "Installation failed";
        toast.message = msg;
        toast.primaryAction = {
          title: "Copy Error",
          onAction: async () => {
            const { Clipboard } = await import("@raycast/api");
            await Clipboard.copy(msg);
          },
        };
      }
    }
  }

  const markdown = [
    `# Setup required`,
    "",
    "Smart Video Downloader uses **yt-dlp** and **ffmpeg** under the hood — currently missing: **`" +
      missingDep +
      "`**.",
    "",
    "Installation runs via Homebrew and may take up to 2 minutes. Please don't close Raycast while it's working.",
    "",
    "Don't have Homebrew? Press **⌘⇧H** or use the secondary action to open [brew.sh](https://brew.sh), then update the Homebrew Executable in this extension's preferences.",
  ].join("\n");

  return (
    <Detail
      markdown={markdown}
      actions={
        <ActionPanel>
          {isInstalling ? (
            // Disabled placeholder so the action panel isn't empty mid-install.
            // The Toast remains visible to convey progress.
            <Action title="Installing…" onAction={() => {}} />
          ) : (
            <Action
              title="Install with Homebrew"
              icon={Icon.Download}
              onAction={install}
            />
          )}
          <Action
            title="Get Homebrew"
            icon={Icon.Globe}
            shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
            onAction={() => open("https://brew.sh")}
          />
        </ActionPanel>
      }
    />
  );
}
