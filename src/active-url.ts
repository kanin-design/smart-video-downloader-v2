import { runAppleScript } from "@raycast/utils";

// Chromium-based browsers share the same scripting interface.
// Adding a new browser is just adding its name here.
const CHROMIUM_APPS = [
  "Google Chrome",
  "Google Chrome Beta",
  "Google Chrome Canary",
  "Brave Browser",
  "Arc",
  "Microsoft Edge",
  "Microsoft Edge Beta",
  "Chromium",
  "Opera",
  "Vivaldi",
];

const SAFARI_APPS = ["Safari", "Safari Technology Preview"];

const JXA_SCRIPT = `
function run() {
  var chromiumApps = ${JSON.stringify(CHROMIUM_APPS)};
  for (var i = 0; i < chromiumApps.length; i++) {
    try {
      var app = Application(chromiumApps[i]);
      if (app.running()) {
        var url = app.windows[0].activeTab.url();
        if (url) return url;
      }
    } catch(e) {}
  }
  var safariApps = ${JSON.stringify(SAFARI_APPS)};
  for (var j = 0; j < safariApps.length; j++) {
    try {
      var sApp = Application(safariApps[j]);
      if (sApp.running()) {
        var sUrl = sApp.windows[0].currentTab.url();
        if (sUrl) return sUrl;
      }
    } catch(e) {}
  }
  return "";
}
`;

// Returns the active tab URL from whichever supported browser is running,
// or null if none found. macOS will prompt for Automation permission once
// per browser on first use.
export async function getActiveTabUrl(): Promise<string | null> {
  const url = (
    await runAppleScript(JXA_SCRIPT, { language: "JavaScript" })
  ).trim();
  return url || null;
}
