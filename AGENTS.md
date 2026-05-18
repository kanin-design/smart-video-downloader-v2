# Smart Video Downloader v2 — Agent Instructions

## ⚠️ Most Important Rule

**Do NOT look at any other code on this computer.** There is a previous version of this extension somewhere on the filesystem. You must not read it, grep for it, or reference it in any way. If you find it, close it immediately.

**All reference material must come from the internet:**
- Raycast API docs: https://developers.raycast.com
- Raycast manifest schema: https://developers.raycast.com/information/manifest
- Raycast API reference: https://developers.raycast.com/api-reference

---

## What to Build

Read `SPECIFICATION.md` in this directory. It is the complete, authoritative spec. Implement it exactly — every state, every shortcut, every edge case is described there.

---

## Extension Identity

- `name`: `"smart-video-downloader-v2"`
- `title`: `"Smart Video Downloader v2"`
- `author`: `"andninecats"`

---

## When Done

Run `npm run dev` so the extension is immediately available in Raycast for testing. The user will search for **"Smart Video Downloader v2"** to find it.

---

## Tech Stack

- TypeScript, React, `@raycast/api`
- `execa` for shell commands
- `validator` for URL validation
- Node.js built-ins for file I/O

## Docs to Read Before Writing Any Code

1. Raycast manifest (preference types, command modes): https://developers.raycast.com/information/manifest
2. List component (filtering, EmptyView): https://developers.raycast.com/api-reference/user-interface/list
3. Action & ActionPanel shortcuts: https://developers.raycast.com/api-reference/user-interface/action-panel
4. BrowserExtension API: https://developers.raycast.com/api-reference/browser-extension
5. showHUD vs popToRoot vs closeMainWindow: https://developers.raycast.com/api-reference/feedback/hud
