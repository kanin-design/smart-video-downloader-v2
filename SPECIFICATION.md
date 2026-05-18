# Smart Video Downloader — Functional Specification

## 1. Overview & Philosophy

Smart Video Downloader is a **Raycast frontend for yt-dlp**. It wraps the command-line video downloader yt-dlp (and its companion ffmpeg/ffprobe) with a native Raycast UI, persistent download state, background execution, and browser integration.

### Core Constraint (Non-Negotiable)

**Downloads must survive Raycast closing.** The user starts a download, dismisses Raycast, and the file still appears in their Downloads folder. This constraint drives the entire architecture. The download process must be completely independent of the Raycast process lifecycle.

### What It Does

The extension lets users download videos from YouTube, Vimeo, Twitter/X, TikTok, Instagram, and 1000+ other sites supported by yt-dlp. It provides three distinct download paths (paste URL, detect browser tab, instant global hotkey) plus cookie management for age-restricted or sign-in protected content.

### Target User

A power user who wants to grab videos quickly without opening a terminal or dealing with yt-dlp's complexity. They want one keypress downloads, background progress they can check later, and the ability to pick specific quality/codecs when needed.

---

## 2. Commands Overview

Four commands are exposed:

| Command | Mode | Purpose |
|---------|------|---------|
| **Download Manager** | `view` | Primary interface — paste URL, pick format, track all downloads |
| **Download Video** | `view` | Browser integration — detect video tabs, preview metadata, download |
| **Quick Download** | `view` | Headless global hotkey — download active browser tab instantly |
| **Cookie Settings** | `view` | Manage browser cookies for protected content |

---

## 3. Shared UI Components

These components are reused across multiple commands.

### Cookie Section

A reusable action panel section. Contains two actions:
1. **Cookie Manager** — Pushes the Cookie Settings view onto the navigation stack (does not open a new command, just navigates within the current one)
2. **Re-Extract Cookies** (⌘⇧K) — Re-runs cookie extraction from the last configured browser without opening a full settings screen

Appears in the following places:
- Download Manager: New video item (when metadata loaded)
- Download Manager: URL-matched completed download item
- Download Manager: "Cookies Required" empty state
- Download Video: Main action panel

Does NOT appear on general completed download list items.

### Extract Cookies Action

The standalone ⌘⇧K action. When triggered:
1. Reads the last-used browser name from persistent storage
2. If no browser is stored: shows failure toast — "No browser set up — open Cookie Settings first"
3. If browser found: shows animated toast "Re-extracting cookies from {browser}…", runs extraction, then calls back to the requesting screen so it can retry the failed operation

### Installer View

A detail view shown when dependencies (yt-dlp, ffmpeg, or ffprobe) are missing. Shown on first open only; subsequent opens skip the check if the check has previously passed.

**Content:**
- Markdown heading: `# Missing dependency: \`{executable_name}\``
- Body explains yt-dlp and ffmpeg are required, with an action to auto-install via Homebrew
- Notes installation may take up to 2 minutes and asks the user not to close Raycast
- Includes a link to brew.sh for users who do not have Homebrew

**Actions:**
- **Install with Homebrew** (↵) — Runs `brew install yt-dlp ffmpeg` using the configured Homebrew path
- While installing: shows animated toast "Installing…"; the install action is hidden to prevent double-triggering
- On success: hides toast, marks dependencies as installed in persistent storage, transitions to the ready state
- On ENOENT error (Homebrew not found): failure toast titled "Homebrew not found" with actions to open the extension's preference screen or open brew.sh
- On other errors: failure toast with the error message and an action to copy the error text

### Browser Extension Required View

A detail view shown when the Raycast browser extension is not installed. Used by both Download Video and Quick Download.

**Content:**
- Markdown heading: `# Browser Extension Required 🧩`
- Body explains the Raycast Browser Extension is required to detect video tabs
- Numbered steps: press Enter to install, add to browser, come back and try again
- Hint: "Already installed? Make sure the extension is enabled for the current browser profile."

**Actions:**
- **Install Browser Extension** (↵) — Opens `https://www.raycast.com/browser-extension`

---

## 4. Command 1: Download Manager

### Purpose

The main power-user interface. The user opens it, pastes a video URL into the search bar, sees the video thumbnail and title load in real time, then chooses a format. Downloads run in the background and show progress. Completed downloads are listed with file size, resolution, and codec info.

### Screen Type

**List view** with a search bar used for URL input. The search bar is for entering video URLs — not for filtering list items. Filtering of list items must be disabled. (See §17 for required implementation constraints around the Raycast List component when filtering is disabled.)

### What the User Sees at Each Moment

**On open, while initializing:**
The list shows a loading spinner. The dependency check and session resume run in parallel.

**Idle, nothing typed:**
An empty state is shown:
- **Icon:** Extension icon
- **Title:** "No downloads yet"
- **Description:** "YouTube, Vimeo, Twitter/X, TikTok, Instagram, and 1000+ sites"
  - If a cookies file is active on disk: append " · Cookies active" to the description

**URL typed, fetching metadata:**
The list shows a spinner. If there are existing active or completed downloads, they remain visible below.

**URL typed, matches a completed download:**
Show that completed download in a section titled "Downloaded" with full actions (open, re-download, delete, etc.). Do not fetch metadata, and hide the general completed list while this match view is shown. Actions on the matched item:
1. **Open File** (↵) — Opens with default application
2. **Show in Finder** (⌘⇧O) — Reveals file in Finder
3. **Copy File to Clipboard** (⌘⇧C) — Copies file reference; shows floating HUD "Copied to clipboard"
4. **Re-Download** (⌘⇧R) — Removes this entry from the completed list. Because the URL remains in the search bar, the extension immediately fetches fresh metadata so the user can download again.
5. **Remove section** (titled "Remove"):
   - **Delete File** (⌘⇧X, destructive style) — Permanently deletes the file from disk immediately with no confirmation dialog, then removes from list
   - **Remove from List** (⌘⌫) — Removes from list without deleting file
6. **Cookie Section**

**URL typed, metadata loaded for a new (non-downloaded) URL:**
A section titled "Video" appears with one item:
- **Title:** Video title (truncated to 60 characters with ellipsis)
- **Subtitle:** Video duration in MM:SS or H:MM:SS format (omit if duration unavailable)
- **Icon:** Video thumbnail loaded from URL
- **Accessories:** Yellow tag reading "Download"

Actions on the video item:
1. **Download** (↵) — Downloads the best available format respecting user preferences. If a specific best format was identified from metadata, use that format's ID. Otherwise use yt-dlp's "bestvideo+bestaudio/best" selector.
2. **Audio Only** (⌘⇧A) — Title shows: "Audio Only · {codec} · {bitrate} kbps · {fileSize}". Downloads as m4a at highest bitrate.
3. **Specific Format** section — Lists every available format, one action each, titled: `"{resolution} · {codec} · {fileSize}"` (e.g., "1080p · H.264 · 45.2 MB")
4. **Cookie Section**

After download starts, clear the search text but keep the window open.

**Metadata fetch failed — cookies/auth error:**
An empty state is shown:
- **Title:** "Cookies Required"
- **Description:**
  - If a cookies file already exists: "yt-dlp was detected as a bot — press ⌘⇧K to re-extract cookies"
  - If no cookies file: "yt-dlp was detected as a bot — browser cookies are required"
- **Actions:** Cookie Section only

**Metadata fetch failed — other error:**
An empty state is shown:
- **Title:** "Could not load video"
- **Description:** The error message text from yt-dlp

**Active downloads:**
A section titled "Downloading" shows one item per active download:
- **Title:** Video title (truncated to 60 characters)
- **Subtitle:** Format label (e.g., "Best Quality", "1080p", "Audio Only")
- **Icon:** Video thumbnail
- **Accessories:** Blue progress tag — the percentage value formatted as a 4-character left-padded string (e.g., " 45%", "100%")

Progress percentage displayed in the tag is calculated from raw yt-dlp progress:
- If `expectedStreams` is 1: `Math.round(percent × 0.88)` — leaves headroom for the post-download merge step
- If `expectedStreams` is 2 and first stream is downloading: `Math.round(percent × 0.44)`
- If `expectedStreams` is 2 and second stream is downloading: `Math.round(44 + percent × 0.44)`

`expectedStreams` is set at job creation:
- Format "best" → 2
- Format "headless" → 2
- Format "audio" → 1
- Format "specific" where the format has an audio track → 1
- Format "specific" where the format has no audio track → 2

Action on active download items:
- **Cancel Download** (⌘↵, destructive style) — Shows a confirmation alert titled "Cancel Download?" with the video title as the message body and a destructive confirm button. On confirmation: kills the running process by finding process IDs associated with the job's unique log file path and sending SIGTERM, removes the job from state, persists the change.

**Completed downloads (general list):**
Only shown when no URL-match view is active. A section titled "Downloaded" shows one item per completed download. Only jobs whose output file actually exists on disk are shown — if a user deletes a file outside the extension, it silently disappears.

Item display:
- **Title:** Video title (truncated to 60 characters)
- **Icon:** Extension icon
- **Accessories (left to right):**
  1. Resolution text from probed media info (e.g., "1080p", "4K", "Audio Only") — falls back to format label if not yet probed
  2. Actual file size read from disk
  3. Green tag reading "Downloaded" with a tooltip showing: `"{width}×{height} · {videoCodec} · {audioCodec} · {bitrateMbps} Mbps · {date}"`

Actions:
1. **Open File** (↵) — Opens with default application
2. **Show in Finder** (⌘⇧O) — Reveals file in Finder
3. **Copy File to Clipboard** (⌘⇧C) — Copies file reference; shows floating HUD "Copied to clipboard"
4. **Remove section** (titled "Remove"):
   - **Delete File** (⌘⇧X, destructive style) — Permanently deletes the file from disk immediately with no confirmation dialog, then removes from list
   - **Remove from List** (⌘⌫) — Removes from list without deleting file
   - **Clear All from List** (⌘⇧⌫) — Removes all completed downloads from the list; files stay on disk

### Functional Behavior

**1. Clipboard auto-load:**
On open, if the "Auto-load URL" preference is enabled, read the clipboard. If the clipboard content is a valid URL, auto-fill the search bar with it.

**2. URL validation:**
As the user types, validate the input. Only begin fetching metadata for valid URLs.

**3. Metadata fetching:**
Run yt-dlp with the following arguments:
- `--force-ipv4` (only if the Force IPv4 preference is enabled)
- `--cookies {path}` (only if the managed cookies file exists on disk)
- `--no-playlist` (prevent fetching entire playlists)
- `--dump-json` (output full video metadata as JSON to stdout)
- `--format-sort=res,ext,tbr` (sort formats by resolution, then extension, then bitrate)
- The URL

Must set `PYTHONUNBUFFERED="1"` in the environment and use the enhanced PATH.

If the user types a new URL before the previous fetch completes, cancel the previous fetch. Errors from cancellation must be silently ignored. Other errors must be shown (cookies error or generic error depending on error type).

**Cookie error detection:** If the error message from yt-dlp contains any of the following strings, treat it as a cookie/auth error: `"Sign in"`, `"sign in"`, `"bot"`, `"cookies"`, `"Login required"`, `"age"`, `"members only"`, `"Private video"`.

**4. Format deduplication:**
yt-dlp returns hundreds of format variants. Filter and deduplicate to useful choices:
- Keep only formats with an actual video codec (vcodec is not "none" and not empty)
- Exclude: storyboards (format_note is "storyboard"), HLS/mhtml streams (protocol is "m3u8", "m3u8_native", or "mhtml")
- Exclude resolutions below 144p
- Group remaining formats by resolution height
- For each height: sort by codec priority (AV1/AV2=1, HEVC=2, H.264=3, VP9=4, VP8=5, other=6)
- Iterate sorted formats for each height. Track which "friendly" codec names have been seen. Add the format if its friendly codec name hasn't been seen yet. Stop after adding 2 formats per height.
- Result: up to 2 codec variants per resolution height, best quality first

**5. Best quality selection:**
1. Start with all deduplicated video formats
2. Filter by max quality cap if set (height ≤ cap)
3. If a preferred codec is set:
   - Find the best-resolution format with that codec within the cap. If found, use it.
   - If not found at best resolution, try any resolution within cap. If found, use it.
4. If no preference match: return the first format in the sorted list (already AV1 > HEVC > H.264 > VP9)

**6. Audio-only selection:**
- Filter for formats with an audio codec but no video codec, excluding HLS
- Sort descending by `(tbr × 1000) + filesize_in_bytes` (higher total bandwidth + size = better quality)
- Use top result

**7. Deduplication guard:**
If an active download already exists for the same URL, starting another download for that URL is silently ignored.

**8. Cookie retry:**
When cookies are successfully extracted (either through the Cookie Manager pushed view or the quick Re-Extract action), the metadata fetch must automatically retry with fresh cookies.

---

## 5. Command 2: Download Video

### Purpose

Detects video tabs currently open in the browser and presents the focused one with full metadata — thumbnail, title, duration, estimated file size, available resolutions, and codec. No URL copying needed.

### Screen Type

**Detail view** with markdown content on the left and a metadata sidebar on the right.

### Visual Layout

```
┌─────────────────────────────────────────────┐
│ ## Video Title Goes Here                    │
│                                             │
│ *youtube.com  ·  12:34*                     │
│                                             │
│ <img src="thumbnail_url" height="180" />    │
├─────────────────────────────────────────────┤
│ Selected Format (≤1080p, H.264)             │
│ [1080p] [H.264]                             │
│ ─────────────────────────────────────────── │
│ Est. size: 45.2 MB                          │
│ Duration: 12:34                             │
│ Source: youtube.com                         │
│ ─────────────────────────────────────────── │
│ All Qualities                               │
│ [4K] [1080p] [720p] [Audio]                 │
└─────────────────────────────────────────────┘
```

### Markdown Content by State

**Loading:** Heading with the tab's page title, italicized subtitle "Fetching video info…"

**No video tabs:** Heading "No Video Tabs Found", subtitle prompting user to open a video on a supported site.

**Cookies required:** Heading "Cookies Required", subtitle prompting user to open Actions to set up cookies.

**Error (unsupported/other):** Heading "Not Supported", italicized error message text.

**Video loaded:** Heading with video title, italicized subtitle of `"{hostname} · {duration}"`, embedded thumbnail image at height 180px.

### Metadata Sidebar (when video loaded)

**Tag list titled "Selected Format"** — shows the chosen format's attributes:
- The title of this tag list includes any active constraints in parentheses, e.g., "Selected Format (≤1080p, H.264)" or just "Selected Format" if no constraints
- Resolution tag with color (4K=purple, 1440p/1080p=blue, 720p=green, 480p=yellow, ≤360p=gray)
- Video codec tag in secondary text color
- Audio codec tag with color (AAC/HE-AAC/Opus=green, Vorbis/MP3=orange, Dolby/DTS=blue, FLAC=purple)

**Separator**

**Labels:**
- "Est. size" — estimated file size (video stream size + best audio stream size combined)
- "Duration" — formatted as MM:SS or H:MM:SS
- "Source" — hostname as a clickable link to the tab URL (e.g., "youtube.com")

**Separator**

**Tag list titled "All Qualities"** — all available heights at or above 480p (up to 6 shown), each colored by resolution. Followed by an "Audio" tag colored by the best audio codec.

### Actions

1. **Download** (↵) — Best quality respecting preferences
2. **Audio Only** (⌘⇧A)
3. **Specific Format** section — All available formats
4. **Other Video Tabs** section — Other browser tabs identified as video tabs. Selecting one switches the metadata view to fetch that tab's video info.
5. **Cookie Section**

### Functional Behavior

**1. Tab detection:**
Poll the browser extension API every 2 seconds to get all open tabs. A URL is considered a video URL if its hostname (with `www.` stripped) exactly matches, ends with, or contains any of: `youtube.com`, `youtu.be`, `vimeo.com`, `twitter.com`, `x.com`, `tiktok.com`, `instagram.com`, `twitch.tv`, `dailymotion.com`, `reddit.com`, `facebook.com`, `bilibili.com`, `nicovideo.jp`, `streamable.com`, `rumble.com`, `odysee.com`, `peertube`.

Filter for video tabs only. Sort so the active tab comes first. On initial load, focus the first tab (index 0). On subsequent polls, if a different tab has become active, auto-jump focus to it.

**2. Browser extension missing:**
If the browser extension API throws an error, show the Browser Extension Required view. Never show raw error messages.

**3. Metadata fetch:**
Same process as Download Manager. Same cookie args, same cancel-on-new-url behavior.

**4. HUD on download:**
After a download starts, show a floating notification: `"⬇ Downloading "{title}""` and close the window.

**5. Cookie retry:**
After extraction succeeds, trigger a fresh metadata fetch automatically.

---

## 6. Command 3: Quick Download

### Purpose

Fastest path. The user assigns a global keyboard shortcut. When triggered, it silently downloads the active browser tab in the best quality matching their preferences, shows a brief notification, and closes. No UI is ever meaningfully visible.

### Behavior

1. User triggers the global shortcut
2. Extension detects the active browser tab
3. If the active tab is a video URL: HUD shows `"⬇ Downloading "{title}""` and Raycast closes
4. If the active tab is not a video URL: HUD shows `"❌ No video found in active tab"` and Raycast closes

### Error States

- **Browser extension not installed:** Show the Browser Extension Required view (the window stays open so the user can act on it)
- **Not a video URL:** Show error HUD and close

### Functional Behavior

**1. Single-execution guard:**
The tab detection and download logic must execute exactly once per command invocation. Guard against React's development-mode double-invocation of effects.

**2. Resume pending downloads:**
Before starting the new download, reconcile any downloads that were pending from previous sessions (see Section 8.2).

**3. Tab detection:**
Get all browser tabs and find the active one. Check if it is a video URL. If not, show error HUD and stop.

**4. Headless format selection:**
No metadata is fetched. Translate the user's preferences directly into a yt-dlp format selector string (see Section 9 for the exact building rules).

**5. Synthetic video object:**
Since no metadata is fetched, create a minimal video record using the browser tab's information: the tab's page title as the video title, the tab's ID as the video ID, the tab's favicon as the thumbnail.

**6. Download:**
Start the download using the tab URL, the synthetic video object, and the headless format. The filename will be set at download time using yt-dlp's own `%(title)s` template (the real video title from the website) rather than the browser tab title, which may be truncated or decorated.

---

## 7. Command 4: Cookie Settings

### Purpose

Manages browser cookies for age-restricted or sign-in protected content.

### Screen Type

**List view** with navigation title "Cookie Settings".

### Browser List

9 browsers: Firefox, Chrome, Safari, Brave, Chromium, Edge, Opera, Vivaldi, Whale. Each shown with a globe icon.

The browser that was most recently used for extraction shows:
- Green "Active" tag
- Date accessory showing when extraction last ran (tooltip: "Last extracted")

### Actions Per Browser

- If this browser is not active: "Extract from {Browser}"
- If this browser is already active: "Re-Extract from {Browser}"

### Manage Section

Only shown when a browser is active (cookies are set up). Contains:
- **Clear Saved Cookies** — Deletes the cookies file from disk and removes the stored browser name and timestamp from persistent storage

### Functional Behavior

**1. Extraction process:**
Run yt-dlp with `--cookies-from-browser {browser}` and `--cookies {output_path}` and no URL argument. yt-dlp will exit with a non-zero code because no URL was given — this is expected and should not be treated as an error. What matters is whether the cookies file was created.

After the command exits, check if the output file exists on disk and is larger than 100 bytes. If yes, extraction succeeded. Store the browser name and the current timestamp in persistent storage.

**2. Toast feedback during extraction:**
- Start: Animated toast — title "Extracting cookies from {browser}…", message "Make sure you are signed in to the site in that browser"
- Success: Change toast to success — title "Cookies saved", message "{browser} cookies are active — press Esc to go back". Wait 1.5 seconds before notifying the requesting screen, so the "Active" tag is visible to the user before the parent screen refreshes.
- Failure: Change toast to failure — title "Could not extract cookies", message "Make sure you are signed in to the site in {browser} and try again."

**3. Integration:**
When the cookies file exists on disk, every yt-dlp invocation (both metadata fetches and downloads) automatically passes `--cookies {path}`. The Download Manager shows cookie status in its idle empty state description.

**4. Re-extraction shortcut:**
The ⌘⇧K action is available from any download screen. It reads the stored browser name and re-runs extraction without opening the full Cookie Settings screen.

---

## 8. Core System Behaviors

### 8.1 Background Download Survival

Downloads must survive Raycast closing. This means:

**Process spawning:**
- Spawn yt-dlp as a fully detached process — the parent process must release all references to the child so Raycast's exit does not kill it
- Never pipe stdout or stderr from the child process — piping creates a reference that keeps the child tied to the parent
- Instead, use a shell wrapper script that handles all output redirection

**Shell wrapper structure:**
The shell script does four things in order:
1. Runs yt-dlp with all arguments, redirecting all output (stdout AND stderr) to a log file by appending (`>> {logfile} 2>&1`)
2. Captures the shell exit code immediately after yt-dlp exits
3. Appends a completion sentinel line to the log file: `YTDLP_EXIT:{exit_code}`
4. Fires a macOS notification using `osascript`:
   - On success (exit code 0): notification with title "Downloaded ✓" and the video title as the body
   - On failure: notification with title "Download failed" and the video title as the body

**Shell quoting:**
All variable values passed into the shell script (executable paths, argument values, video titles) must be single-quoted with any internal single quotes escaped using the `'\''` pattern. This prevents filenames with spaces, parentheses, or special characters from breaking the shell command.

**Log file path detection:**
yt-dlp is invoked with `--print after_move:filepath` which causes yt-dlp to print the final output file path to stdout after the file is moved to its destination. Because stdout is redirected to the log file, this path appears in the log as a line starting with `/` (an absolute path). The log parser treats any line beginning with `/` as the final file path and uses it as the completion signal. The exit sentinel line is a secondary signal — either signal alone is sufficient to detect completion.

**Log directory:**
Log files are stored at `{supportPath}/logs/{jobId}.log`. The log directory must be created immediately before the first log file is written to it, not at extension load time.

### 8.1a yt-dlp Download Arguments

**Common base arguments (all format types):**
- `--progress`
- `--newline`
- `--print after_move:filepath`
- `--ffmpeg-location {ffmpeg_path}`
- `--cookies {path}` (only if cookies file exists)
- `-o {output_path}`

**Format-specific arguments appended after the base:**
- **Best quality:** `--format "bestvideo+bestaudio/best" --merge-output-format mp4`
- **Headless:** `--format "{prebuilt_selector_string}" --merge-output-format mp4`
- **Audio only:** `--format "bestaudio" -x --audio-format m4a`
- **Specific format with audio track:** `--format "{format_id}" --merge-output-format mp4`
- **Specific format without audio track:** `--format "{format_id}+bestaudio" --merge-output-format mp4`

**Output path construction:**
- Extension: `mp4` for all video downloads, `m4a` for audio-only
- For most downloads: `{downloadFolder}/{sanitizedTitle}.{ext}` or `{downloadFolder}/{sanitizedTitle} ({videoId}).{ext}` if the "Include ID" preference is on
- For headless downloads: use `%(title)s` in place of the sanitized title so yt-dlp substitutes the real video title at download time (the browser tab title is often different)

### 8.2 Resume on Open

When any command opens, it must reconcile downloads that were active before Raycast was last closed:

1. **Load** the job list from `{supportPath}/jobs.json`
2. **Migrate legacy data:** If `jobs.json` doesn't exist but there is data in persistent storage under the old key, parse that data, save it to `jobs.json`, and delete the old persistent storage entry
3. **Prune** completed jobs whose output files no longer exist on disk
4. **Deduplicate** completed jobs that share the same output file path — keep the most recent one and discard the rest (handles legacy duplicate records)
5. For each job that is not yet completed:
   - If the log file does not exist on disk: discard the job (ghost entry)
   - If the log contains an exit sentinel OR the output file already exists: mark the job as completed; run media info probing in the background
   - If a process is currently running that references this log file path: resume polling progress from that process
   - If no process is running and the job is not yet complete: restart yt-dlp — it will automatically resume from any `.part` file left on disk

This reconciliation must run exactly once per process, regardless of how many commands are open simultaneously.

### 8.3 Progress Tracking

The log file for each active download is read approximately every 500ms.

**Parsing rules:**
- **Progress line:** A line matching `[download] {number}% of ... at {speed}` — extract the percentage and the speed string. The progress regex is: `\[download\]\s+(\d+(?:\.\d+)?)%`
- **Stream transition:** When the extracted percentage drops from above 80% to below 5%, a new stream has started downloading. Increment the stream index.
- **Merge phase:** A line containing `[Merger]`, `[ExtractAudio]`, or `[ffmpeg]` means yt-dlp is in the merge/convert phase. Show 99% during this phase.
- **File path:** A line starting with `/` is the final output path (see 8.1).
- **Exit sentinel:** A line matching `YTDLP_EXIT:{number}` — extract the exit code.

Progress is considered complete when either the file path is detected and the file exists on disk, or the exit code is found.

### 8.4 Format Selection

**Video format filtering:**
- Keep only formats with an actual video codec (not "none")
- Exclude: storyboards, HLS streams, resolutions below 144p
- Group by resolution height
- For each height: sort by codec priority (AV1/AV2=1, HEVC=2, H.264=3, VP9=4, VP8=5, other=6)
- Iterate sorted formats for each height. Track friendly codec names already selected. Keep up to 2 formats per height with different friendly names.

**Best format selection:**
1. Take all deduplicated video formats
2. Apply max quality cap: filter to formats where height ≤ cap
3. If preferred codec is set: try preferred codec at best available height → try preferred codec at any height within cap → fall back to first in sorted list
4. No preference: return first format (already sorted by codec priority)

**Codec priority:**
AV1/AV2 (best) > HEVC > H.264 > VP9 > VP8 > everything else

**Friendly codec names (for deduplication and display):**
- AV1: vcodec starts with "av01" or "av1"
- AV2: vcodec starts with "av02" or "av2"
- HEVC: vcodec starts with "avc2", "hevc", "hvc1", or equals "h265"
- H.264: vcodec starts with "avc1", "avc", or equals "h264"
- VP9: vcodec starts with "vp9"
- VP8: vcodec starts with "vp8"

### 8.5 Audio Format Selection

- Filter: has audio codec, no video codec, not HLS
- Sort descending by `(tbr × 1000) + filesize_bytes`
- Use the top result

Audio action title format: `"Audio Only · {friendlyCodec} · {bitrate} kbps · {fileSize}"`

### 8.6 File Management

**Download folder:** Configured by user preference, default `~/Downloads`

**Title sanitization** (applied to video titles before use as filenames):
1. Remove all colon characters
2. Remove all control characters (Unicode code point below 32)
3. Collapse consecutive whitespace to a single space
4. Trim leading and trailing whitespace
5. If the result is 200 characters or shorter, use it as-is
6. If longer than 200 characters: truncate to 200, then find the last occurrence of `.`, `!`, or `?` before the cutoff and trim to that position
7. If the result is empty after all steps: use "untitled"

### 8.7 Dependency Check

On first open, check whether yt-dlp, ffmpeg, and ffprobe are available. Check by running `which {name}` via a shell command with the enhanced PATH. Do not check by looking for files at known paths — the sandbox makes file-existence checks for system paths unreliable.

On success, store a flag in persistent storage so the check is skipped on all subsequent opens.

If any dependency is missing, show the Installer view for the first missing one.

### 8.8 Media Info Enrichment

After a download completes, run ffprobe on the output file in the background (without blocking the UI):

**Arguments:** `-v quiet -print_format json -show_streams -show_format {filePath}`

**Extract from the JSON output:**
- Resolution category: height ≥ 2160 → "4K", ≥ 1440 → "1440p", ≥ 1080 → "1080p", ≥ 720 → "720p", ≥ 480 → "480p", any lower → "{height}p". If no video stream: "Audio Only".
- Width and height in pixels
- Video codec name (from video stream)
- Audio codec name (from audio stream)
- Bitrate in Mbps, rounded to 3 decimal places: `Math.round(bit_rate / 1000) / 1000`
- Duration in whole seconds: `Math.round(parseFloat(duration))`

Once probed, update the job record in memory and persist the change. The media info replaces the format label in the completed item accessories.

---

## 9. Data Transformations

### Format Label (for active download subtitle)

The human-readable label shown while a download is in progress:
- Format "best" → "Best Quality"
- Format "audio" → "Audio Only"
- Format "headless" → use the `label` field stored in the job (e.g., "1080p · H.264" or "Best Quality")
- Format "specific" → derive from the format's height field if available (e.g., "1080p"), otherwise use the resolution string

### Headless Format Selector

For Quick Download, translate preferences into a yt-dlp format selector string without fetching metadata:

**Codec filter strings:**
- AV1: `[vcodec^=av01]`
- HEVC: `[vcodec~=(hvc1|hevc|hev1)]`
- H.264: `[vcodec^=avc1]`
- VP9: `[vcodec^=vp9]`

**Building the selector (all cases):**

*No codec preference, no quality cap:*
`bestvideo+bestaudio/best`

*No codec preference, with quality cap:*
`bestvideo[height<={cap}]+bestaudio/best[height<={cap}]`

*With codec preference, no quality cap:*
`bestvideo{codecFilter}+bestaudio/bestvideo+bestaudio/best`

*With codec preference and quality cap:*
`bestvideo{codecFilter}[height<={cap}]+bestaudio/bestvideo[height<={cap}]+bestaudio/best[height<={cap}]/best`

The fallback chain always ends with `best` (no constraints) as a last resort.

### Headless Label

Human-readable label stored on the job for display during download:
- If max quality cap is set and cap ≥ 2160: add "4K", else add "{cap}p"
- If preferred codec is set: add the codec's display name (AV1, HEVC, H.264, VP9)
- Join non-empty parts with " · "
- If no constraints apply: "Best Quality"

---

## 10. State Sharing Architecture

All commands (Download Manager, Download Video, Quick Download) run inside the same Node.js process. This means download state can be shared across commands using a shared module — a singleton — rather than re-reading from disk each time.

**The shared module holds:**
- The in-memory job list (loaded from disk once on open, kept current as jobs change)
- A progress map (in-memory only, never persisted — maps job ID to current percent, speed, and stream index)
- A set of active poll handles (one per running download)
- A set of registered listener callbacks (for notifying the UI of state changes)

**Pub-sub pattern:**
UI components register a callback when they mount and unregister it when they unmount. Whenever download state changes (job added, progress updated, job completed, job removed), the shared module calls all registered callbacks. Each callback causes its component to re-render and pick up the latest state.

The subscribe function returns an unsubscribe function, which components call in their cleanup phase.

**Read vs. write:**
All reads from the in-memory job list are synchronous. After initial load from disk, the in-memory list is always current. Writes (adding, completing, or removing jobs) happen in-memory first, then asynchronously persist to disk. Listeners are notified after the in-memory update, before the disk write completes.

**What is persisted:**
- The job list is persisted to `{supportPath}/jobs.json` on every change
- Progress is never persisted (it is rebuilt from log file polling on resume)

**Storage:** Write the job list as JSON directly to the final file path. Do not use an atomic write-then-rename pattern — this is blocked in some environments. Create the file's parent directory recursively before writing if it might not exist.

---

## 11. User Preferences

Seven preferences in the extension manifest:

| Preference | Key | Type | Default | Description |
|------------|-----|------|---------|-------------|
| Download Folder | `downloadPath` | directory | `~/Downloads` | Where downloaded files are saved |
| Auto-load URL | `autoLoadUrlFromClipboard` | checkbox | on | Paste clipboard URL on Download Manager open |
| Force IPv4 | `forceIpv4` | checkbox | on | Force IPv4 connections (fixes broken IPv6 routing) |
| Preferred Video Codec | `preferredCodec` | dropdown | `best` | Values: `best`, `av1`, `vp9`, `hevc`, `h264` |
| Max Quality | `maxQuality` | dropdown | `best` | Values: `best`, `2160`, `1440`, `1080`, `720`, `480` |
| Include ID in Filename | `includeIdInFilename` | checkbox | off | Appends `(videoId)` to the filename |
| Homebrew Path | `homebrewPath` | textfield | `/opt/homebrew/bin/brew` | Used for one-time dependency installation |

---

## 12. Keyboard Shortcuts

| Shortcut | Action | Available on |
|----------|--------|-------------|
| ↵ | Download best quality | Download Manager (video item), Download Video |
| ⌘⇧A | Audio Only | Download Manager (video item), Download Video |
| ⌘↵ | Cancel Download (confirm required) | Download Manager (active downloads) |
| ⌘⇧O | Show in Finder | Download Manager (completed items, URL-match item) |
| ⌘⇧C | Copy File to Clipboard | Download Manager (completed items, URL-match item) |
| ⌘⇧R | Re-Download | Download Manager (URL-match item only) |
| ⌘⇧X | Delete File (no confirm) | Download Manager (completed items, URL-match item) |
| ⌘⌫ | Remove from List | Download Manager (completed items, URL-match item) |
| ⌘⇧⌫ | Clear All from List | Download Manager (completed list items only) |
| ⌘⇧K | Re-Extract Cookies | Download Manager, Download Video |

**Note:** ⌘⇧D was previously used for Delete but conflicts with users who assign that combination as a global hotkey for the Quick Download command. It was replaced with ⌘⇧X. Avoid shortcut combinations that users commonly assign as global launch hotkeys.

---

## 13. Data Model

### Job Record

One record per download, persisted in the job list:

| Field | Type | Description |
|-------|------|-------------|
| id | string | `{videoId}-{timestamp}` |
| url | string | Source URL |
| format | DownloadFormat | See Format Types below |
| logFile | string | Absolute path to yt-dlp output log |
| title | string | Sanitized video title |
| thumbnail | string | Thumbnail URL |
| formatLabel | string | Human-readable format description |
| expectedStreams | 1 or 2 | Determines progress calculation |
| filePath | string? | Set on completion — absolute path to output file |
| completedAt | number? | Unix timestamp (ms) when download finished |
| mediaInfo | MediaInfo? | Set asynchronously after completion via ffprobe |

### MediaInfo

| Field | Type | Description |
|-------|------|-------------|
| resolution | string | "4K", "1080p", "Audio Only", etc. |
| width | number? | Pixels |
| height | number? | Pixels |
| videoCodec | string? | Raw codec name from ffprobe |
| audioCodec | string? | Raw codec name from ffprobe |
| bitrateMbps | number? | Total bitrate, 3 decimal places |
| durationSecs | number? | Whole seconds |

### Format Types

- **best** — Use yt-dlp's bestvideo+bestaudio/best selector
- **audio** — Audio-only m4a download
- **specific** — A specific format chosen by the user from the metadata format list (carries the format object)
- **headless** — A pre-built selector string for Quick Download (carries the selector string and a human-readable label)

### Video (from yt-dlp metadata)

| Field | Description |
|-------|-------------|
| id | Video ID |
| title | Raw title (will be sanitized before use) |
| thumbnail | Thumbnail URL |
| duration | Duration in seconds |
| live_status | Live stream status string |
| formats | Array of Format objects |

### Format (from yt-dlp metadata)

| Field | Description |
|-------|-------------|
| format_id | yt-dlp's unique ID for this format |
| vcodec | Video codec string, or "none" |
| acodec | Audio codec string, or "none" |
| ext | Container extension |
| video_ext | Video extension |
| protocol | "https", "m3u8", etc. |
| filesize | Exact file size in bytes (may be absent) |
| filesize_approx | Approximate file size in bytes (may be absent) |
| resolution | String like "1920x1080" |
| tbr | Total bitrate in kbps |
| height | Height in pixels |
| format_note | Extra note, e.g., "storyboard" |

---

## 14. File Locations

All runtime files live inside the extension's support path — a directory the extension owns and can write to. On the stable Raycast build this is inside `~/Library/Application Support/com.raycast.macos/extensions/{extension-id}/`. On the Raycast 2.0 beta it is inside `~/Library/Application Support/com.raycast-x.macos/extensions/{extension-id}/`.

| File | Purpose |
|------|---------|
| `jobs.json` | Persistent job list |
| `logs/{jobId}.log` | Raw yt-dlp output, one file per download |
| `yt-cookies.txt` | Extracted browser cookies (when active) |

---

## 15. Error States & Edge Cases

### E1: Missing Dependencies
Detected via `which` shell command with enhanced PATH on first open. Show Installer view. Cache success in persistent storage. Handle "Homebrew not found" as a distinct case from general install failure.

### E2: Browser Extension Not Installed
The browser extension API throws an error when not installed. Catch it and show the Browser Extension Required view. Never surface raw error messages.

### E3: Cookies Required / Bot Detection
yt-dlp errors containing any of the cookie-detection strings. Show "Cookies Required" state. Distinguish between "no cookies configured" (user needs to set up) and "cookies stale" (already configured, need re-extraction).

### E4: Invalid URL Entered
Show idle empty state. Do not attempt metadata fetch.

### E5: Video URL But Unsupported Site
Show yt-dlp's error message in the "Could not load video" state.

### E6: Global Hotkey Conflicts
Global hotkeys registered in Raycast preferences override in-command action shortcuts. There is no way to prevent this from inside the extension. Design in-command shortcuts conservatively — avoid combinations users commonly assign as global launch hotkeys (⌘⇧D, ⌘⇧Q, etc.).

---

## 16. Visual Design Guidelines

### Color Coding

**Resolution tags:**
- 4K → Purple
- 1440p / 1080p → Blue
- 720p → Green
- 480p → Yellow
- ≤360p → SecondaryText (gray)

**Codec tags (audio):**
- AAC / HE-AAC / Opus → Green
- Vorbis / MP3 → Orange
- Dolby / DTS → Blue
- FLAC → Purple

**State tags:**
- Downloading progress → Blue
- Downloaded / completed → Green
- Pending download (video item) → Yellow

### Typography

- Titles truncated at 60 characters with an ellipsis character (…)
- Durations: `MM:SS` for under one hour, `H:MM:SS` for one hour and over — no leading zero on hours
- File sizes: `{n} KB` (1 decimal), `{n} MB` (1 decimal), `{n} GB` (2 decimals)

### Icons

- Video preview items: Video thumbnail loaded from URL
- Completed items: Extension icon
- Download actions: Download icon
- Audio actions: Music icon
- Cookie actions: Key icon
- Open file: Play icon
- Show in Finder: Finder icon
- Copy: Clipboard icon
- Delete: Trash icon
- Remove / dismiss: XMarkCircle icon

---

## 17. Raycast Platform Constraints

These are real platform facts — not implementation style preferences. An agent building this extension must understand all of them to avoid subtle bugs.

### List filtering and the empty state

The Raycast List component has built-in client-side filtering of list items. When the search bar is used for URL input rather than filtering, this must be explicitly disabled. When filtering is disabled and no list items are rendered, Raycast shows an uncontrollable "No results" overlay. The correct fix is to always render a `List.EmptyView` component — Raycast only shows it when no list items exist, so it will naturally appear or hide as needed. The EmptyView content should reflect the current UI state.

### Search bar controlled mode

The List search bar has two modes: uncontrolled (Raycast manages the value) and controlled (the extension manages the value via props). Switching modes after the first render causes a platform warning. To avoid this, pass both the search bar value and its change handler on every render — including during loading phases — so the component stays in controlled mode from the very first mount.

### Window dismissal: use showHUD, not popToRoot

- `showHUD(message, { clearRootSearch: true })` — correct for "work done, dismiss with notification". Closes the window, clears the root search bar, shows a brief floating notification.
- `popToRoot()` — navigates to the root view first, creating a visible flash before the window closes.
- `closeMainWindow({ clearRootSearch: true })` — closes directly but requires a separate notification call.

The Download Manager must not dismiss at all when a download starts. It should only clear the search bar text.

### Preference types in the extension manifest

The extension manifest uses strict type names. Using wrong types shows a blank onboarding screen with no explanation.
- Text input fields: type must be `"textfield"` (not `"text"` or `"input"`)
- Dropdown/select fields: type must be `"dropdown"` (not `"select"`)
- Checkboxes: type must be `"checkbox"` and must include a `"label"` field
- Never set `"required": true` on any preference — this triggers a mandatory onboarding screen

Run `npx @raycast/api@latest validate` after any manifest change.

### System executable paths cannot be checked by file existence

Raycast extensions run in an App Sandbox. Checking whether a file exists at a system path (e.g., `/opt/homebrew/bin/yt-dlp`) returns false even when the file is present. To detect whether an executable is available, run `which {name}` via a shell command with the enhanced PATH.

### PATH is not inherited from the shell

Raycast extensions do not inherit the user's shell PATH. Every subprocess invocation must pass an enhanced PATH that prepends `/opt/homebrew/bin:/usr/local/bin` to the current process PATH.

### File writes: no atomic rename in Raycast 2.0 beta

The Raycast 2.0 beta blocks the rename syscall inside the support path. An atomic write-then-rename pattern fails on the rename step even though the write succeeded. Write directly to the final destination path instead.

### Support path directory may not be pre-created

Before writing any file to the support path, create the parent directory recursively. The Raycast 2.0 beta may not pre-create this directory.

### Directory creation must be lazy (at first use)

Create directories at the point when the extension first needs them, not at module initialization time. Creating them at module load time may use incorrect path values if the Raycast runtime has not finished injecting context variables.

### React StrictMode double-fires effects in development

In development mode, React mounts components, runs effects, unmounts them, mounts again, and runs effects a second time. Effects that must run only once need an explicit ref-based guard set on first execution and checked before proceeding.

### LocalStorage is asynchronous

All reads from and writes to the persistent key-value storage API are asynchronous. A write that is not awaited before a subsequent state change may be silently lost. Always await storage operations before triggering any UI update.

### Browser extension API throws when extension is not installed

Calling the browser extension API to get tabs throws an exception if the user has not installed the Raycast browser extension. This must be caught. Show the Browser Extension Required view.

### Global hotkeys override in-command shortcuts

Keyboard shortcuts registered as global launch hotkeys take effect system-wide, including when the user is inside another command's action panel. Design in-command shortcuts defensively.

---

*End of Specification*
