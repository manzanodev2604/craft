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
| `wait` | css [ms] | polls up to ms (default 15000). Not a sleep: `wait 2000` is an error |
| `text` | [css] | innerText (textContent fallback), max 4000 chars, default `body`. Prefer narrow selectors to save tokens |
| `click` | css | waits for element, then `el.click()` |
| `fill` | css value | `Input.insertText` → real input events (React-safe) |
| `eval` | js | returns JSON value; promises awaited |
| `shot` | file.png | ~1.2 s. Hidden tabs don't paint, so it snapshots the live DOM (MHTML, current state) and renders it in a throwaway headless Chrome (no window, temp profile). Viewport 1280x800; canvas/video content may be missing |
| `tabs` | — | lists the user's open pages (read-only) |
| `wake` | [ms] | background/hidden tab: focus emulation + lifecycle `active` + screencast, so `visibilityState` is `visible`, rAF and timers run and lazy lists (WhatsApp chat) paint. Lasts for the rest of THIS call: chain reads after it. Without it a hidden tab freezes rAF and throttles timers (a 1.5 s `setTimeout` took 12.7 s). Risk: an open WhatsApp chat counts as seen (read receipts) |
| `reload` | — | `Page.reload` + wait `complete`. For a hung tab (use with `in <site>` only when the user asked) |
| `upload` | css file... | css = `<input type=file>` → `DOM.setFileInputFiles`. css = a button that opens the OS file picker (WhatsApp "Documento") → real click with the picker intercepted (never shown) and files handed to it. Never inject files with JS `DataTransfer` |
| `press` | css | real mouse click at the element centre, after it stops moving (animated menus). Use where `click` (el.click()) does nothing, e.g. WhatsApp chat rows |
| `save` | url\|css file | fetch inside the page (its cookies, `blob:` URLs too) and write the file to disk in one step. css → element's href/src |
| `download` | css [dir] | real click on a download button; if no download starts in 1 s it clicks again (max 3 clicks: WhatsApp's first click often only fetches the file). Never overwrites: an existing name gets " (1)", " (2)"... (WhatsApp: `[title="Descargar \"<file>\""]`) and wait until the browser finishes; file lands in dir (default `~/Downloads`). Sets the browser's download folder only during the call, then restores the default |
| `cdp` | Method [json] | raw CDP on the current tab, e.g. `cdp Page.reload '{"ignoreCache":true}'` |

`eval`/`text`/etc. rerun up to 2 times if the page navigates mid-call (redirect after `goto`). Every CDP call times out after 30 s with "ERR timeout 30s in <Method> (tab hung? try reload)": nothing hangs silently.
| `in` | url-substring | run the REST of the call in the user's existing tab whose URL contains it (Brave first, then Chrome). Not open anywhere → opens `https://<arg>` itself: hidden tab first; if that fails to load, a normal background tab (visible in the tab strip, focus untouched); output says which. The opened tab is reused by later `in` calls. `in <site> visible` → normal tab straight away: use it when the site loads but misbehaves hidden (blank, stuck, asks to keep the tab visible). For single-session web apps (WhatsApp Web, etc.) where opening a second tab would steal the session. Read-only by default: `text`/`eval`/`wait` only; ask the user before `click`/`fill` there |

## Rules
- WhatsApp Web scripts now run on Playwright: `node ~/Desktop/hands/wa.mjs abrir|enviar|descargar|check ...` (the `wa-*.sh` names still work and call it; old Bash versions in `hands/viejo/`).
- Iframes from the CLI: `frame <url part>` moves the rest of the call into the first iframe whose URL contains it (same-process or cross-process); `in <tab>` resets it. Closed shadow DOM: CLI selectors fall back to a CDP pierce search on their own; in Playwright use `cerrado(page, css)` from `pw.mjs`. Network listening and traces: Playwright via `pw.mjs` (page.on('response'), context.tracing). Traces of WhatsApp hold chat screenshots: delete after use.
- Downloads are browser-wide: the CLI `download` and each relay client take a turn (waits up to 25 s, `CDP_DL_WAIT`), else `descargas ocupadas`. The relay hides tabs that do not answer within 1.5 s (a hung tab used to block `connectOverCDP`).
- NEVER close, kill (`taskkill`, `Stop-Process`) or restart the user's Brave, and never open a second WhatsApp Web tab: the user's only WhatsApp session lives in that tab, a kill loses their tabs (it happened on 18/11/2026) and a second tab deactivates theirs ("WhatsApp is open in another window"). Need a fresh state? Use `reload` on the tab. Test "browser closed" cases with an agent-mode daemon (`CDP_MODE=agent`, own port), not with the real Brave.
- WhatsApp orders (`hands/wa.mjs`) take turns through `~/.hands-wa.lock` (waits up to 2 min) and refuse to switch chats while the user has WhatsApp in front (`WA_AUNQUE_MIRE=1` to override): run them, don't drive the WhatsApp tab directly from another script at the same time.
- Windows, macOS, Linux: `node cdp.mjs paths` shows where it looks for each browser. Auto-accepting "Allow remote debugging?" is Windows only; elsewhere the user accepts it once per daemon start.
- Tests: `cd ~/Desktop/hands && npm test` (offline, ~4 s: wa-sel.js against a saved WhatsApp page + relay against a throwaway headless Brave; run after changing cdp.mjs or wa-sel.js). `npm run test:vivo` SENDS to the notes chat (~40 s): only when asked or after a WhatsApp change.
- Playwright/Puppeteer on the user's real Brave: connect through the daemon relay, NEVER directly to the browser (each direct connection = new "Allow remote debugging?" prompt; Brave crashed right after those prompts on 18/11/2026). `import { conectar } from '~/Desktop/hands/pw.mjs'` → `{ browser, page }` (relay `ws://127.0.0.1:9334/cdp`, header `x-cdp-token` from the token file). Each client gets its own browser session; `Browser.close` is refused, so `browser.close()` only disconnects. Wake background tabs (`despertar(page)`, done by `conectar`) or every Playwright click waits ~1.5 s.
- WhatsApp Web, send files (only on explicit request): `~/Desktop/hands/wa-enviar.sh "<chat title>" file...` (~2 s, tested 5/5): opens the chat with a real click, Adjuntar → Documento with the picker intercepted, sends, then waits until each file shows Enviado/Entregado/Leído; exit 1 if any fails. Limits: documents 100 MB, photos/videos 16 MB. Drag-and-drop (`Input.dispatchDragEvent`) does NOT work in WhatsApp.
- WhatsApp Web, download (`~/Desktop/hands/wa-descargar.sh "<chat>" <dir> name...`): documents ("Descargar <name>") and PDFs ("Ver <name>" → preview → Descargar → Cerrar), newest message with that name, ~1.3 s/file plus the scroll search. Photos/videos: `WA_TIPO=foto wa-descargar.sh "<chat>" <dir> [n]` = last n, through the viewer (WhatsApp recompresses photos: JPEG, not the original bytes). Never overwrites: same name → "name (1).ext". Exit 1 if not found (~15-25 s).
- WhatsApp Web selectors live in `~/Desktop/hands/wa-sel.js` (data-testid → icon name → es/en text, language-independent). If a wa-*.sh script fails, run `~/Desktop/hands/wa-check.sh` first: it says which element no longer resolves.
- WhatsApp Web: do NOT set `Emulation.setLocaleOverride` / `Network.setUserAgentOverride` and reload: on 18/11/2026 it hung the tab (Runtime.evaluate and Page.navigate timed out) until the user reloaded it by hand.
- WhatsApp Web, open a chat: `wa-abrir.sh "<exact title>"`: real click in the list; if not among the rendered rows (only ~9 render), it uses the search box and clears it after. Send/download scripts call it. Photos/videos are sent with `WA_TIPO=foto wa-enviar.sh ...` (menu "Fotos y videos").
- WhatsApp Web, read a chat: always `wake` first. Without it only ~10 rows render and scrolling up loads nothing; with it history loads (23 → 61 rows after 5 scrolls).
- WhatsApp Web: read the chat list with `CDP in web.whatsapp.com + eval ...` on `[aria-label="Lista de chats"] [role=row]` (use textContent; the tab is hidden). Never open a chat (marks it read) or send anything without explicit user request.
- This is the user's real, logged-in browser. Ask before submitting forms, sending messages, purchasing, posting or deleting anything.
- Never show anything to the user or take focus: no new windows, no visible tabs, no `Target.activateTarget`/`bringToFront`. Never close the user's browser or their tabs. Never `taskkill` Brave or Chrome. Run `CDP stop` when a browsing task is finished.
- Security: the daemon only obeys requests carrying the per-start secret in `%TEMP%\cdp-browser\token-<port>` (dir ACL: user + SYSTEM only) and rejects web pages (Origin/Host checks). Any other program connecting to the browser triggers the browser's own "Allow remote debugging?" prompt, which only gets auto-accepted while this daemon connects. Residual: a malicious program already running as this Windows user can still read the token or run this CLI.
- Errors print `ERR <message>` with exit code 1. `text` with a missing selector prints `NOT FOUND`.

## Cómo quiere el usuario que se trabaje (de sus sesiones, 19/11/2026)

- Enviar en su nombre: borrador primero y su visto bueno; después enviar sin volver a parar. Comprobar el título del chat antes de escribir; no repetir un mensaje al mismo contacto; solo los chats del tema. WhatsApp: `node ~/Desktop/hands/wa.mjs` (turno, no molestar, deja la pestaña como estaba), no JS propio.
- Compras: preparar la cesta; el pago y los inicios de sesión los hace él.
- Si una web no funciona en pestaña de fondo (anti-robot, audios, clics que no registran), abrir una pestaña visible normal (`Target.createTarget`, sin robar foco) en vez de rendirse. Enseñarle lo encontrado si lo pide. No cerrar pestañas suyas.
- No dejar tareas a medias ni pedirle lo que la herramienta puede hacer sola.
