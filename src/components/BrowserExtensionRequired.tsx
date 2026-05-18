import { Action, ActionPanel, Detail, Icon, open } from "@raycast/api";

interface Props {
  onRetry?: () => void;
}

export function BrowserExtensionRequired({ onRetry }: Props = {}) {
  const markdown = [
    "# Browser Extension Required",
    "",
    "The **Raycast Browser Extension** is required to detect video tabs.",
    "",
    "1. Press **Enter** to open the Raycast Browser Extension page",
    "2. Add it to your browser",
    "3. Come back and try again",
    "",
    "> Already installed? Make sure the extension is enabled for the current browser profile.",
  ].join("\n");

  return (
    <Detail
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action
            title="Install Browser Extension"
            icon={Icon.Globe}
            onAction={() => open("https://www.raycast.com/browser-extension")}
          />
          {onRetry && (
            <Action
              title="Try Again"
              icon={Icon.ArrowClockwise}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
              onAction={onRetry}
            />
          )}
        </ActionPanel>
      }
    />
  );
}
