# Smart Video Downloader v2

## ⚠️ Critical: Do Not Look at Existing Code

There is a previous version of this extension elsewhere on this computer. **Do not open, read, or reference it.** Not for structure, not for patterns, not for anything. If you encounter it while searching, stop immediately.

All Raycast API knowledge must come from **online documentation only**:
- https://developers.raycast.com
- https://developers.raycast.com/information/manifest
- https://developers.raycast.com/api-reference

---

## What to Build

Implement `SPECIFICATION.md` exactly. Read it fully before writing a single line of code.

---

## Extension Name

Use these values in `package.json`:
```json
"name": "smart-video-downloader-v2",
"title": "Smart Video Downloader v2"
```

---

## When Done Programming

Run `npm run dev` — this registers the extension with Raycast so the user can immediately test it by searching **"Smart Video Downloader v2"**.

---

## Key Raycast Platform Gotchas (from the spec, §17)

- Preference type `"textfield"` not `"text"`, `"dropdown"` not `"select"`, never `"required": true`
- `List filtering={false}` when search bar is used for URL input — always include `List.EmptyView`
- Search bar must be controlled (bound `searchText` + `onSearchTextChange`) from the **very first render** including loading skeleton — never switch modes
- Use `showHUD(..., { clearRootSearch: true })` to dismiss with notification — not `popToRoot`
- Downloads must survive Raycast closing: spawn with `detached: true, stdio: "ignore"`, call `proc.unref()`
- No atomic write-then-rename for `jobs.json` — write directly to final path (Raycast 2.0 beta blocks `rename()`)
- Lazy path evaluation: never call `environment.supportPath` at module level, only inside functions
- `existsSync` is unreliable for system paths in the sandbox — use `which` via shell to detect executables
- Always prepend `/opt/homebrew/bin:/usr/local/bin` to PATH for every subprocess call
- React StrictMode double-fires effects in dev — use a `useRef` guard for one-shot logic
