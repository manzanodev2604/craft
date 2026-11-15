---
name: cdp-browser
description: Fast, low-token web automation via raw Chrome DevTools Protocol from Bash, using the user's REAL browser session (Brave first, then Chrome; cookies, logins). ~110 ms per call, plain-text output, invisible to the user (hidden tab, never takes focus). Use for navigating pages, reading text, clicking, filling forms, running JS or taking screenshots. Default browser tool; prefer over claude-in-chrome and Playwright MCP.
---

# cdp-browser

Script: `~/.claude/skills/cdp-browser/cdp.mjs` (Node 22+, zero deps). Below, `CDP` = `node ~/.claude/skills/cdp-browser/cdp.mjs`.

## Connection (automatic)

1. **Real browser (default), in order Brave → Chrome.** Remote debugging (`brave://inspect/#remote-debugging`, `chrome://inspect/#remote-debugging`) stays permanently ON by the user's choice. The script keeps it on invisibly via the browser's `Local State` pref `devtools.remote_debugging.user-enabled` (read at startup): set directly while the browser is closed, or by a hidden watcher that sets it right after the browser exits (`CDP arm brave|chrome`; log in `%TEMP%\cdp-allow.log`). Never toggle it through the browser UI (needs a focused window). The browser writes `DevToolsActivePort` in its User Data dir (`%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data`, `%LOCALAPPDATA%\Google\Chrome\User Data`); the script connects to the first that answers → user's own cookies and logins. The browser's "Allow remote debugging?" prompt is auto-accepted by `allow.ps1` (UI Automation), launched only while the daemon connects and killed right after (log: `%TEMP%\cdp-allow.log`; disable with `CDP_NO_AUTOALLOW=1`). While connected the browser shows "automated test software is controlling..." in every window; `dismiss.ps1` closes it (~0.4 s, posted click on its close button, focus untouched), once per connection. Override dir with `CDP_USER_DATA`.
2. **Fallback:** agent Chrome on :9333 (`CDP start`, profile `%LOCALAPPDATA%\chrome-agent-profile`; this one IS a visible window, only on explicit request). Force with `CDP_MODE=agent`.
3. `ERR no browser` → both browsers closed, or the toggle is off in a browser that has not been restarted since: tell the user; never open windows or toggle it via UI.

**Invisible by design:** all actions run in a HIDDEN tab (`Target.createTarget hidden:true`): not in any tab strip, never opens a window, never takes focus. One hidden tab PER CLAUDE SESSION (keyed by `CLAUDE_CODE_SESSION_ID`, override `CDP_SESSION=<name>`, e.g. for parallel subagents), never the user's tabs. Several sessions can run at once: each has its own tab and command queue. `CDP tabs` shows which browser (BRAVE/CHROME/AGENT) and the user's tabs.

A background daemon (`127.0.0.1:9334`) holds ONE browser connection and stays connected while the browser runs (each new connection shows the prompt ~1 s, so it connects once per browser start; `CDP_IDLE_MIN=N` to drop it after N idle min). Cold start ~2 s, then every call ~110-380 ms. Never open extra connections to the browser outside this script, and never kill the daemon process: other sessions may be using it.

Browser switching is automatic: Brave closed → next call reconnects to Chrome; Brave reopened → next call drops Chrome and returns to Brave.

Login-wall fallback is automatic: if a `goto` in Brave lands on a sign-in page (URL heuristic `LOGIN` in cdp.mjs), the command stops there (later steps are NOT run on the login page) and reruns in real Chrome via a second daemon (:9335); output starts with `(login wall in Brave for <host> → using Chrome, remembered)`. That host then goes straight to Chrome; commands without `goto` go to the browser used last, so follow-ups hit the same tab. Routing state: `%TEMP%\cdp-route.json` (delete it after the user logs in to that site in Brave). If both browsers show a login wall, output contains `LOGIN WALL in <browser>`: tell the user to log in; never type credentials yourself.

## Use

Chain actions with `+` in ONE call (one connection, cheapest):
```
CDP goto https://site.com + wait "#main" + text "#main"
CDP fill "#email" "a@b.c" + click "button[type=submit]" + wait ".dashboard" + text h1
CDP eval "[...document.querySelectorAll('a')].map(a=>a.href).slice(0,20)"
CDP shot C:/path/shot.png      # Read the png only if a visual check is needed
CDP stop                       # closes this session's hidden tab (stays connected). AGENT: closes that Chrome when last session stops
```

| cmd | args | notes |
|---|---|---|
| `goto` | url | waits for `readyState != loading`; SPA → add `wait <css>` |
| `wait` | css | polls up to 15 s |
| `text` | [css] | innerText (textContent fallback), max 4000 chars, default `body`. Prefer narrow selectors to save tokens |
| `click` | css | waits for element, then `el.click()` |
| `fill` | css value | `Input.insertText` → real input events (React-safe) |
| `eval` | js | returns JSON value; promises awaited |
| `shot` | file.png | ~1.2 s. Hidden tabs don't paint, so it snapshots the live DOM (MHTML, current state) and renders it in a throwaway headless Chrome (no window, temp profile). Viewport 1280x800; canvas/video content may be missing |
| `tabs` | — | lists the user's open pages (read-only) |
| `in` | url-substring | run the REST of the call in the user's existing tab whose URL contains it (Brave first, then Chrome). For single-session web apps (WhatsApp Web, etc.) where opening a second tab would steal the session. Read-only by default: `text`/`eval`/`wait` only; ask the user before `click`/`fill` there |

## Rules
- WhatsApp Web: read the chat list with `CDP in web.whatsapp.com + eval ...` on `[aria-label="Lista de chats"] [role=row]` (use textContent; the tab is hidden). Never open a chat (marks it read) or send anything without explicit user request.
- This is the user's real, logged-in browser. Ask before submitting forms, sending messages, purchasing, posting or deleting anything.
- Never show anything to the user or take focus: no new windows, no visible tabs, no `Target.activateTarget`/`bringToFront`. Never close the user's browser or their tabs. Never `taskkill` Brave or Chrome. Run `CDP stop` when a browsing task is finished.
- Security: the daemon only obeys requests carrying the per-start secret in `%TEMP%\cdp-browser\token-<port>` (dir ACL: user + SYSTEM only) and rejects web pages (Origin/Host checks). Any other program connecting to the browser triggers the browser's own "Allow remote debugging?" prompt, which only gets auto-accepted while this daemon connects. Residual: a malicious program already running as this Windows user can still read the token or run this CLI.
- Errors print `ERR <message>` with exit code 1. `text` with a missing selector prints `NOT FOUND`.
