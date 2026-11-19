// Raw CDP client, zero deps (Node 22+ global WebSocket/fetch/http).
// Connects to YOUR real browser: Brave first, then Chrome (remote debugging must stay enabled: brave://inspect/#remote-debugging
// or chrome://inspect/#remote-debugging). Fallback: agent Chrome launched with `start` on :9333.
// A background daemon (127.0.0.1:9334) keeps ONE browser connection open: opening a connection to a
// browser with the remote-debugging toggle costs 1-3 s, an action over the open one costs ms.
// Usage:
//   node cdp.mjs goto <url> + text [css] + click <css> + fill <css> <value> + eval <js> + shot <file.png> + tabs
//   node cdp.mjs stop                      real browser: close agent tab only; agent Chrome: close it. Daemon exits.
//   node cdp.mjs start [--headless]        launch fallback Chrome with agent profile on :9333
//   node cdp.mjs paths                     where it looks for Brave/Chrome on this OS (Windows, macOS, Linux)
// Actions run in a dedicated background tab, never in the user's tabs.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, chmodSync, lstatSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PORT = process.env.CDP_PORT || 9333;
const BASE = `http://127.0.0.1:${PORT}`;
const DAEMON = `http://127.0.0.1:${process.env.CDP_DAEMON_PORT || 9334}`;
// Daemon stays connected: each new connection makes the browser show its "Allow remote debugging?" prompt
// (auto-accepted, but visible ~1 s), so connect once per browser start. CDP_IDLE_MIN=N to drop it after N idle min.
const IDLE_MS = (+(process.env.CDP_IDLE_MIN ?? 0)) * 60 * 1000;
const tokenFile = port => join(tmpdir(), 'cdp-browser', `token-${port}`);
const onExit = code => process.exit(code);
const idleTimer = () => IDLE_MS && setTimeout(() => onExit(0), IDLE_MS);
// Windows, macOS and Linux. CDP_PLATFORM only fakes the platform for the path logic (tests); real behavior follows the OS.
const OS = process.env.CDP_PLATFORM || process.platform, WIN = OS === 'win32';
const APPDATA = WIN ? process.env.LOCALAPPDATA : OS === 'darwin' ? `${homedir()}/Library/Application Support` : process.env.XDG_CONFIG_HOME || `${homedir()}/.config`;
const CHROME = process.env.CHROME || (WIN ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : OS === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
// ponytail: Chrome 136+ refuses --remote-debugging-port on the default profile, so fallback uses its own.
const PROFILE = process.env.CDP_PROFILE || `${APPDATA}/chrome-agent-profile`;
// Real browsers tried in order (user's main = Brave, then Chrome). Override with CDP_USER_DATA.
const BRAVE_DATA = `${APPDATA}/BraveSoftware/Brave-Browser${WIN ? '/User Data' : ''}`;
const CHROME_DATA = WIN ? `${APPDATA}/Google/Chrome/User Data` : OS === 'darwin' ? `${APPDATA}/Google/Chrome` : `${APPDATA}/google-chrome`;
// process names for "is it running?" (pgrep -x matches the process name exactly, never this script's own arguments)
const PROC = { brave: OS === 'darwin' ? 'Brave Browser' : 'brave', chrome: OS === 'darwin' ? 'Google Chrome' : 'chrome' };
const U = process.env.CDP_USER_DATA;
const REAL = U ? [[/BraveSoftware/i.test(U) ? 'brave' : /Google.Chrome/i.test(U) ? 'chrome' : 'custom', U]]
  : [['brave', BRAVE_DATA], ['chrome', CHROME_DATA]];
// Login-wall heuristic: URL path/host typical of sign-in pages. ponytail: regex, add patterns as sites need.
const LOGIN = /\/(login|signin|sign-in|sign_in|uas\/login|authwall|checkpoint|auth|sso|accounts\/login)(\/|\?|#|$)|\/\/(accounts\.google\.com|login\.|signin\.|auth\.)/i;
// state files: %TEMP% is per user on Windows; /tmp is shared on POSIX, so there they go to a private ~/.cache/cdp-browser
const STATE = process.platform === 'win32' ? tmpdir() : join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'cdp-browser');
if (process.platform !== 'win32') mkdirSync(STATE, { recursive: true, mode: 0o700 });
const ROUTE_FILE = join(STATE, 'cdp-route.json'); // { last: { who: route }, hosts: { host: 'chrome' } }
// Each Claude session gets its own agent tab + command queue, so parallel sessions don't collide.
const WHO = (process.env.CDP_SESSION || process.env.CLAUDE_CODE_SESSION_ID || 'default').replace(/[^\w-]/g, '_');
const tabFile = who => join(STATE, `cdp-agent-tab-${who}`);
const LOG = openSync(join(STATE, 'cdp-allow.log'), 'a'); // auto-allow helper output
const sleep = ms => new Promise(r => setTimeout(r, ms));
const args = process.argv.slice(2);

// paths: where it looks for each browser on this OS (CDP_PLATFORM=darwin|linux to see another OS's)
if (args[0] === 'paths') { console.log(JSON.stringify({ OS, BRAVE_DATA, CHROME_DATA, CHROME, PROFILE, PROC })); process.exit(0); }
if (args[0] === 'start') {
  if (await fetch(`${BASE}/json/version`).then(() => true, () => false)) { // never hijack an already-running Chrome
    console.log(`already running on ${BASE} (reusing it)`); process.exit(0);
  }
  const flags = [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check'];
  if (args.includes('--headless')) flags.push('--headless=new');
  spawn(CHROME, flags, { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${BASE}/json/version`).then(() => true, () => false)) { console.log(`ready ${BASE} profile=${PROFILE}`); process.exit(0); }
    await sleep(100);
  }
  console.error('chrome did not open CDP port'); process.exit(1);
}

// Browsers keep the remote-debugging toggle in "Local State" and read it at startup only. Turn it on there while the
// browser is closed (no window, no focus); if it is running, a hidden watcher does it right after the browser exits.
const running = n => WIN ? spawnSync('tasklist', ['/FI', `IMAGENAME eq ${n}.exe`, '/NH'], { encoding: 'utf8', windowsHide: true }).stdout.includes(`${n}.exe`)
  : spawnSync('pgrep', ['-x', PROC[n]], { stdio: 'ignore' }).status === 0;
function arm(name, dir) {
  const f = `${dir}/Local State`;
  let st; try { st = JSON.parse(readFileSync(f, 'utf8')); } catch { return 'no Local State'; }
  if (st.devtools?.remote_debugging?.['user-enabled'] === true) return 'already on';
  if (running(name)) {
    if (WIN) spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
      `Wait-Process -Name ${name} -ErrorAction SilentlyContinue; & '${process.execPath}' '${fileURLToPath(import.meta.url)}' arm ${name}`],
      { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else spawn('sh', ['-c', 'while pgrep -x "$1" >/dev/null; do sleep 2; done; exec "$2" "$3" arm "$4"', 'sh',
      PROC[name], process.execPath, fileURLToPath(import.meta.url), name], { detached: true, stdio: 'ignore' }).unref();
    return 'armed: will switch on when it closes';
  }
  st.devtools = { ...st.devtools, remote_debugging: { ...st.devtools?.remote_debugging, 'user-enabled': true } };
  writeFileSync(f, JSON.stringify(st)); return 'switched on';
}
if (args[0] === 'arm') { const r = REAL.find(([n]) => n === args[1]); console.log(r ? arm(...r) : 'unknown browser'); process.exit(0); }

if (args[0] === 'serve') await serve();
else await client();

// ---------- client: route to a daemon (spawn if missing), retry login walls in Chrome ----------
// Routes: 'default' = daemon :9334 (Brave → Chrome auto), 'chrome' = daemon :9335 pinned to real Chrome.
// Sticky: a host that hit a login wall in Brave but works in Chrome is remembered; follow-up commands
// without goto go to the browser used last, so a goto + later text/click stay in the same tab.
async function client() {
  const explicit = U || process.env.CDP_MODE; // manual override → single daemon, no routing
  const ROUTES = {
    default: { port: process.env.CDP_DAEMON_PORT || 9334, env: {} },
    chrome: { port: 9335, env: { CDP_USER_DATA: CHROME_DATA, CDP_DAEMON_PORT: '9335' } },
  };
  const callRoute = async (name, isStop) => {
    const url = `http://127.0.0.1:${ROUTES[name].port}`;
    // async: missing token file (daemon still booting) → rejected promise, not a sync throw
    const call = async () => fetch(url, { method: 'POST', body: JSON.stringify({ who: WHO, argv: args }),
      headers: { 'x-cdp-token': readFileSync(tokenFile(ROUTES[name].port), 'utf8') } }).then(r => r.json())
      .then(j => j.err === 'forbidden' ? null : j); // stale token read while a new daemon boots → keep polling
    let res = await call().catch(() => null);
    if (res?.retry) { res = null; await sleep(300); } // daemon quit to switch to the preferred browser
    if (res || isStop) return res;
    spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve'],
      { detached: true, stdio: 'ignore', env: { ...process.env, ...ROUTES[name].env } }).unref();
    for (let i = 0; i < 300 && !res; i++) { await sleep(100); res = await call().catch(() => null); } // 30 s: covers allow prompt
    return res || { err: 'ERR daemon did not start', code: 1 };
  };
  const print = r => { if (r?.out) console.log(r.out); if (r?.err) console.error(r.err); };

  if (args[0] === 'stop') {
    const outs = await Promise.all((explicit ? ['default'] : ['default', 'chrome']).map(n => callRoute(n, true)));
    outs.forEach(print); if (!outs.some(Boolean)) console.log('not running'); return;
  }

  let state = { last: {}, hosts: {} };
  try { state = { ...state, ...JSON.parse(readFileSync(ROUTE_FILE, 'utf8')) }; } catch {}
  if (typeof state.last !== 'object') state.last = {}; // old single-session format
  const gi = args.indexOf('goto'), ii = args.indexOf('in');
  let host = null; try { if (gi >= 0) host = new URL(args[gi + 1]).host; } catch {}
  let route = explicit ? 'default' : host ? (state.hosts[host] || 'default')
    : ii >= 0 ? 'default' : (ROUTES[state.last[WHO]] ? state.last[WHO] : 'default'); // `in`: look in Brave first

  let res = await callRoute(route);
  if (!explicit && res.notFound && route === 'default' && res.mode === 'brave') { // user tab not in Brave → try Chrome
    const alt = await callRoute('chrome'); if (!alt.notFound && !alt.err) { res = alt; route = 'chrome'; } // Chrome closed → keep Brave's answer
  }
  if (route === 'chrome' && /no browser/.test(res.err || '')) { route = 'default'; res = await callRoute(route); } // stale Chrome route → back to Brave
  if (res.notFound && ii >= 0) { // the user has it open nowhere → open it ourselves in the preferred browser
    const vis = args[ii + 2] === 'visible';
    args.splice(ii + 2, vis ? 1 : 0, vis ? 'open-visible' : 'open');
    route = 'default'; res = await callRoute(route);
  }
  if (!explicit && res.loginWall && res.mode === 'brave') {
    const alt = await callRoute('chrome');
    if (alt.code === 0 && !alt.loginWall) {
      console.log(`(login wall in Brave for ${host} → using Chrome, remembered)`);
      res = alt; route = 'chrome'; if (host) state.hosts[host] = 'chrome';
    }
  }
  if (!explicit) { // re-read: another session may have written meanwhile
    let cur = {}; try { cur = JSON.parse(readFileSync(ROUTE_FILE, 'utf8')); } catch {}
    const last = typeof cur.last === 'object' ? cur.last : {};
    writeFileSync(ROUTE_FILE, JSON.stringify({ hosts: { ...cur.hosts, ...state.hosts }, last: { ...last, [WHO]: route } }));
  }
  print(res);
  process.exitCode = res.code;
}

// ---------- daemon: one browser connection, many commands ----------
async function serve() {
  const STARTED = Date.now();
  const DPORT = new URL(DAEMON).port, TOKEN = randomBytes(32).toString('hex'), TF = tokenFile(DPORT);
  // Bind FIRST: two sessions racing to spawn a daemon → the loser exits here, before touching the browser
  // (no 2nd prompt) or the token file. Requests wait until the browser is connected.
  let boot; const booted = new Promise(r => boot = r);
  const server = createServer(async (req, res) => { await booted; handle(req, res); });
  await new Promise(ok => { server.once('error', () => process.exit(0)); server.listen(DPORT, '127.0.0.1', ok); });
  rmSync(TF, { force: true }); // stale secret of a dead daemon
  const open = url => new Promise((ok, ko) => {
    const w = new WebSocket(url); w.onopen = () => ok(w); w.onerror = () => ko(new Error(`connect failed ${url}`));
  });
  let ws, real = false, mode = 'agent';
  const HERE = dirname(fileURLToPath(import.meta.url));
  const connectReal = async (name, dir) => {
    // browser writes port + path here when remote debugging is enabled (file may be stale → connect fails)
    const [port, path] = readFileSync(`${dir}/DevToolsActivePort`, 'utf8').split('\n').map(s => s.trim());
    // auto-allow the browser's "Allow remote debugging?" prompt, only during this connect (CDP_NO_AUTOALLOW=1 to ask the user)
    // Windows only (UI Automation). macOS/Linux: the user accepts the prompt once per daemon start.
    if (!WIN) appendFileSync(LOG, `[${new Date().toISOString()}] ${OS}: no auto-allow, accept "Allow remote debugging?" in ${name}\n`);
    const helper = process.env.CDP_NO_AUTOALLOW || !WIN ? null : spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      join(HERE, 'allow.ps1')], { stdio: ['ignore', LOG, LOG], windowsHide: true });
    // once connected the browser shows "automated test software is controlling..." in every window; started now
    // (PowerShell + UIA take ~1.5 s to load) so it is already watching and closes it at once, focus untouched
    const dismiss = name === 'custom' || !WIN ? null : spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      join(HERE, 'dismiss.ps1'), '-Browser', name], { stdio: ['ignore', LOG, LOG], windowsHide: true });
    try { ws = await open(`ws://127.0.0.1:${port}${path}`); real = true; mode = name; }
    catch (e) { dismiss?.kill(); throw e; }
    finally { helper?.kill(); }
  };
  // Order Brave → Chrome. Remote debugging stays ON in the browser (switching it needs a focused window, so
  // we never touch it); a closed browser or one with the toggle off is skipped.
  const why = []; // reason each real browser failed, for the "no browser" error
  if (process.env.CDP_MODE !== 'agent') {
    for (const [name, dir] of REAL) if (name !== 'custom') appendFileSync(LOG, `[${new Date().toISOString()}] arm ${name}: ${arm(name, dir)}
`);
    for (const [name, dir] of REAL) { try { await connectReal(name, dir); break; } catch (e) { why.push(`${name}: ${e.code === 'ENOENT' ? 'not running or toggle off' : `${e.message} (port open but connection refused: "Allow remote debugging?" prompt not accepted?)`}`); } }
  }
  let bootErr = null;
  if (!ws) try { ws = await open((await fetch(`${BASE}/json/version`).then(r => r.json())).webSocketDebuggerUrl); }
  catch { bootErr = `ERR no browser [${why.join('; ') || 'agent mode'}]: enable brave://inspect/#remote-debugging in Brave (or chrome://inspect/#remote-debugging in Chrome), or run \`start\``; }

  let id = 0; const pending = new Map(), listeners = new Set();
  // every CDP call times out: a hung or throttled tab gives a clear error instead of silence
  const send = (method, params = {}, sessionId, ms = 30000) => new Promise((ok, ko) => {
    const i = ++id, t = setTimeout(() => { pending.delete(i); ko(new Error(`timeout ${ms / 1000}s in ${method} (tab hung? try \`reload\`)`)); }, ms);
    pending.set(i, m => { clearTimeout(t); m.error ? ko(new Error(m.error.message)) : ok(m.result); });
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  if (ws) {
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.method) return listeners.forEach(f => f(m)); pending.get(m.id)?.(m); pending.delete(m.id); };
    // screencast (used by `wake`) stalls unless every frame is acked
    listeners.add(m => m.method === 'Page.screencastFrame' && send('Page.screencastFrameAck', { sessionId: m.params.sessionId }, m.sessionId).catch(() => {}));
    ws.onclose = () => process.exit(0); // browser gone or toggle off → next client call respawns
  }
  const tabs = new Map(); // who (Claude session) → { tab, session }
  const apps = new Map(); // `in` site we had to open ourselves → { id, hidden }; shared by sessions, never closed by us
  const viewport = sid => send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sid).catch(() => {});
  // Open `a` for `in`: hidden tab first (invisible); if it fails to load, a normal background tab (visible in the tab
  // strip, focus untouched). The site's session stays in that tab for later `in` calls.
  const openApp = async (a, visible) => {
    const url = /^[a-z]+:\/\//i.test(a) ? a : `https://${a}`;
    const tryOpen = async hidden => {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank', ...(hidden ? { hidden: true } : { background: true }) });
      const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true });
      try {
        if (hidden) await viewport(s);
        const nav = await send('Page.navigate', { url }, s);
        if (nav.errorText) throw new Error(nav.errorText);
        for (const t0 = Date.now(); ; await sleep(100)) {
          const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, s).catch(() => null);
          if (r?.result?.value && r.result.value !== 'loading') break;
          if (Date.now() - t0 > 20000) throw new Error('load timeout');
        }
        return targetId;
      } catch (e) { await send('Target.closeTarget', { targetId }).catch(() => {}); throw e; }
      finally { send('Target.detachFromTarget', { sessionId: s }).catch(() => {}); }
    };
    let id, note;
    if (!visible) try { id = await tryOpen(true); note = 'opened in hidden tab'; } catch (e) { note = `hidden tab failed (${e.message}) → opened in normal tab`; }
    if (!id) { id = await tryOpen(false); note ??= 'opened in normal tab'; }
    apps.set(a, { id, hidden: note === 'opened in hidden tab' });
    return { targetId: id, title: `(${note})`, url };
  };
  const closeTabs = () => Promise.all([...tabs.values()].map(s => send('Target.closeTarget', { targetId: s.tab }).catch(() => {})));
  const ensureTab = async who => {
    const pages = (await send('Target.getTargets')).targetInfos.filter(t => t.type === 'page');
    const s = tabs.get(who) || {};
    if (!s.tab) try { s.tab = readFileSync(tabFile(who), 'utf8'); } catch {}
    if (!s.tab || !(await send('Target.getTargetInfo', { targetId: s.tab }).catch(() => null))) { // gone, or first run
      // hidden: not in any tab strip or window (a background tab opens a new window when the browser has none);
      // lives as long as this connection
      s.tab = (await send('Target.createTarget', { url: 'about:blank', hidden: true })).targetId;
      writeFileSync(tabFile(who), s.tab); s.session = null;
    }
    if (!s.session) {
      s.session = (await send('Target.attachToTarget', { targetId: s.tab, flatten: true })).sessionId;
      // hidden tabs have a 0x0 viewport; give pages a normal desktop size
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, s.session).catch(() => {});
    }
    tabs.set(who, s);
    return { pages, tab: s.tab, sid: s.session };
  };

  // Download behavior is browser-wide (one folder for every client). Two owners at once would steal each other's
  // downloads (Playwright sets it on connect; the CLI `download` sets and resets it), so they take turns.
  const DL_WAIT = +process.env.CDP_DL_WAIT || 25000;
  let dlOwner = null;
  const dlTake = async who => {
    for (const t = Date.now(); dlOwner && dlOwner !== who; await sleep(100))
      if (Date.now() - t > DL_WAIT) throw new Error(`descargas ocupadas: otro cliente (${dlOwner}) está conectado; reintentar cuando acabe`);
    dlOwner = who;
  };
  const dlFree = who => { if (dlOwner === who) dlOwner = null; };

  async function run(argv, who) {
    const lines = [];
    if (argv[0] === 'stop') { // close THIS session's tab; release the browser only when no session is left
      const s = tabs.get(who); tabs.delete(who); rmSync(tabFile(who), { force: true });
      if (s) await send('Target.closeTarget', { targetId: s.tab }).catch(() => {});
      if (real || tabs.size) return { out: 'agent tab closed', code: 0 }; // real: stay connected (no new prompt next time)
      else { await send('Browser.close').catch(() => {}); lines.push('stopped'); } // graceful: flushes cookies
      setTimeout(() => onExit(0), 100);
      return { out: lines.join('\n'), code: 0 };
    }
    const { pages, tab, sid: own } = await ensureTab(who);
    let sid = own; // `in` swaps this to a user tab for the rest of the call
    // `frame` puts the rest of the call inside an iframe: OOPIF -> sid = its own session; same-process -> ctx = an isolated
    // world in it. Real mouse input always goes to the tab (top) with the iframe's offset added.
    let ctx = null, fr = null; // fr = { top: tab session, id: frameId } while inside a frame
    const page = (method, params, ms) => send(method, params, sid, ms);
    const NAV = /Inspected target navigated or closed|Execution context was destroyed|Cannot find context/;
    const js = async (expr, tries = 3) => {
      try {
        const r = await page('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, ...(ctx ? { contextId: ctx } : {}) });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      } catch (e) { // page navigated mid-eval (redirect after goto, SPA reload): let the new document load, then rerun
        if (!NAV.test(e.message) || tries <= 1) throw e;
        for (const t = Date.now(); Date.now() - t < 15000; await sleep(100)) {
          const s = await page('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true, ...(ctx ? { contextId: ctx } : {}) }).catch(() => null);
          if (s?.result?.value && s.result.value !== 'loading') break;
        }
        return js(expr, tries - 1);
      }
    };
    const q = s => JSON.stringify(s);
    // ponytail: poll readyState, no event subscriptions; SPA route waits need an explicit "wait <css>".
    const waitFor = async (cond, ms = 15000) => {
      for (const t = Date.now(); Date.now() - t < ms; await sleep(50))
        if (await js(cond).catch(() => false)) return;
      throw new Error(`timeout: ${cond}`);
    };
    // ---- elements: light DOM, then open shadow roots (in the page), then CLOSED shadow roots (only CDP sees them) ----
    const DEEP = `((s)=>{const f=r=>{const e=r.querySelector(s);if(e)return e;for(const h of r.querySelectorAll('*'))if(h.shadowRoot){const x=f(h.shadowRoot);if(x)return x}return null};return f(document)})`;
    const find = async (css, closed = true) => { // -> { o: objectId } of the first match, or null
      const r = await page('Runtime.evaluate', { expression: `${DEEP}(${q(css)})`, ...(ctx ? { contextId: ctx } : {}) });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      if (r.result.subtype === 'node') return { o: r.result.objectId };
      if (!closed) return null;
      try {
        const { root } = await page('DOM.getDocument', { depth: -1, pierce: true });
        // start at this frame's document (same-process frame: inside its owner); never descend into other frames
        const findDoc = n => (n.frameId === fr.id && n.contentDocument) ? n.contentDocument
          : [...(n.children || []), ...(n.shadowRoots || []), ...(n.contentDocument ? [n.contentDocument] : [])].reduce((x, c) => x || findDoc(c), null);
        const doc = fr && ctx ? findDoc(root) : root;
        if (!doc) return null;
        const shadows = [], walk = n => { for (const c of n.shadowRoots || []) { shadows.push(c); walk(c); } for (const c of n.children || []) walk(c); };
        walk(doc);
        for (const sr of shadows) {
          const { nodeId } = await page('DOM.querySelector', { nodeId: sr.nodeId, selector: css }).catch(() => ({}));
          if (nodeId) return { o: (await page('DOM.resolveNode', { nodeId, ...(ctx ? { executionContextId: ctx } : {}) })).object.objectId };
        }
        return null;
      } finally { await page('DOM.disable').catch(() => {}); } // DOM agent off again: no DOM events flowing to us
    };
    const need = async (css, ms = 15000) => { // wait for the element, return { o: objectId }
      for (let t = Date.now(), last = 0; ; await sleep(50)) {
        const deep = Date.now() - last > 1000; if (deep) last = Date.now(); // the CDP walk (closed roots) is heavier: once a second
        const o = await find(css, deep).catch(e => { if (NAV.test(e.message)) return null; throw e; });
        if (o) return o;
        if (Date.now() - t > ms) throw new Error(`timeout: no element ${css}`);
      }
    };
    const on = async (el, fn, ms) => { // run fn (this = the element; el = css, or what find/need returned) and return its value
      const objectId = (typeof el === 'string' ? await need(el, ms) : el).o;
      const r = await page('Runtime.callFunctionOn', { objectId, functionDeclaration: fn, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const realClick = async css => { // trusted mouse click at the element's centre (scrolled into view first)
      // wait until it stops moving (menus animate in: a click mid-animation misses), max 2 s
      let [x, y] = await on(css, `async function(){const e=this;e.scrollIntoView({block:'center'});let p='',t=Date.now();for(;;){const b=e.getBoundingClientRect(),k=[b.x,b.y,b.width,b.height].join();if(k===p||Date.now()-t>2000)return [b.x+b.width/2,b.y+b.height/2];p=k;await new Promise(r=>setTimeout(r,60))}}`);
      let target = sid;
      if (fr && !fr.oop) { // same-process frame: add the iframe's position in the tab and click on the tab (an OOPIF takes input in its own session, frame coords)
        // shortcut: one level of frames (the iframe's owner must be in the tab's document); nested frames need a walk up
        const { backendNodeId } = await send('DOM.getFrameOwner', { frameId: fr.id }, fr.top);
        await send('DOM.scrollIntoViewIfNeeded', { backendNodeId }, fr.top).catch(() => {});
        const { model } = await send('DOM.getBoxModel', { backendNodeId }, fr.top);
        await send('DOM.disable', {}, fr.top).catch(() => {});
        x += model.content[0]; y += model.content[1]; target = fr.top;
      }
      const p = { x, y, button: 'left', clickCount: 1 };
      await send('Input.dispatchMouseEvent', { ...p, type: 'mouseMoved', button: 'none' }, target);
      await send('Input.dispatchMouseEvent', { ...p, type: 'mousePressed' }, target);
      await send('Input.dispatchMouseEvent', { ...p, type: 'mouseReleased' }, target);
    };
    const steps = []; let cur = [];
    for (const a of argv) a === '+' ? (steps.push(cur), cur = []) : cur.push(a);
    steps.push(cur);
    const detach = [];
    try {
      for (const step of steps) { const [cmd, a, b] = step;
        const t0 = performance.now(); let out;
        switch (cmd) {
          case 'goto': await page('Page.navigate', { url: a }); await sleep(50);
            await waitFor(`document.readyState!=='loading'`); out = await js('document.title');
            { const final = await js('location.href'); // landed on a login page we didn't ask for → stop, client may retry elsewhere
              if (LOGIN.test(final) && !LOGIN.test(a)) {
                lines.push(`[goto ${(performance.now() - t0).toFixed(0)}ms] LOGIN WALL in ${mode}: ${final}`);
                return { out: lines.join('\n'), code: 0, mode, loginWall: true };
              } }
            break;
          case 'in': { // act in the user's existing tab whose URL contains `a` (for single-session apps like WhatsApp Web).
            // None open anywhere → the client resends with b='open' (hidden tab; normal background tab if that fails)
            // or b='open-visible' (user asked `in <site> visible`: normal tab straight away).
            let t = pages.find(p => p.url.includes(a)), app = apps.get(a);
            if (!t && app && await send('Target.getTargetInfo', { targetId: app.id }).catch(() => null)) {
              if (app.hidden && b === 'visible') { // asked for a visible tab: drop our hidden one first (single-session sites)
                await send('Target.closeTarget', { targetId: app.id }).catch(() => {}); apps.delete(a);
              } else t = { targetId: app.id, title: app.hidden ? '(hidden tab)' : '(our normal tab)', url: a };
            }
            if (!t && !String(b).startsWith('open')) return { out: lines.join('\n'), err: `ERR no tab in ${mode} with URL containing "${a}"`, code: 1, mode, notFound: true };
            if (!t) t = await openApp(a, b === 'open-visible');
            sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId; ctx = null; fr = null;
            if (apps.get(a)?.hidden && apps.get(a).id === t.targetId) await viewport(sid);
            detach.push(sid); out = `${t.title} | ${t.url}`; break;
          }
          case 'frame': { // frame <url part>: the rest of the call runs inside the first iframe whose URL contains it
            const top = fr ? fr.top : sid;
            let oop, kids; // the iframe may still be loading right after goto: retry up to 5 s
            for (const t0 = Date.now(); ; await sleep(100)) {
              const { targetInfos } = await send('Target.getTargets');
              const { frameTree } = await send('Page.getFrameTree', {}, top);
              kids = []; (function w(t) { for (const c of t.childFrames || []) { kids.push(c.frame); w(c); } })(frameTree);
              // an OOPIF is not in the tab's frame tree: it is an 'iframe' target whose parent frame is the tab or one of its frames
              const ids = new Set([frameTree.frame.id, ...kids.map(f => f.id)]);
              oop = targetInfos.find(t => t.type === 'iframe' && t.url.includes(a) && ids.has(t.parentFrameId));
              if (oop || kids.some(k => k.url.includes(a)) || Date.now() - t0 > 5000) break;
            }
            if (oop) { // other process: its own session
              sid = (await send('Target.attachToTarget', { targetId: oop.targetId, flatten: true })).sessionId; detach.push(sid);
              ctx = null; fr = { top, id: oop.targetId, oop: true }; out = `frame (other process) ${oop.url}`; break;
            }
            const f = kids.find(k => k.url.includes(a));
            if (!f) throw new Error(`no frame with URL containing "${a}"`);
            sid = top; fr = { top, id: f.id };
            ctx = (await send('Page.createIsolatedWorld', { frameId: f.id, worldName: 'cdp-browser' }, top)).executionContextId;
            out = `frame ${f.url}`; break;
          }
          case 'close': { // close the user's tabs whose URL contains `a` (only when the user asks)
            const ts = pages.filter(p => p.url.includes(a) && p.targetId !== tab);
            for (const t of ts) await send('Target.closeTarget', { targetId: t.targetId });
            out = `closed ${ts.length}`; break;
          }
          case 'wait': if (/^\d+$/.test(a)) throw new Error(`wait takes a css selector, not ms ("${a}"); optional timeout: wait <css> <ms>`);
            await need(a, +b || 15000); out = 'ok'; break;
          case 'text': { const o = await find(a || 'body'); // textContent: hidden tabs may not render innerText
            out = o ? await on(o, `function(){return (this.innerText&&this.innerText.trim()?this.innerText:this.textContent).slice(0,4000)}`) : 'NOT FOUND'; break; }
          case 'click': out = await on(a, `function(){this.click();return 'clicked'}`); break;
          case 'fill': await on(a, `function(){this.focus();this.value=''}`);
            await page('Input.insertText', { text: b }); out = 'filled'; break; // insertText fires real input events (React-safe)
          case 'eval': out = await js(a); break;
          case 'press': await realClick(a); out = 'pressed'; break; // real mouse click on an element (UIs that ignore el.click(), e.g. WhatsApp chat rows)
          case 'hover': await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: +a, y: +b }); out = 'hovered'; break;
          case 'mouse': { // real click at viewport coords (for UIs that ignore synthetic el.click())
            const p = { x: +a, y: +b, button: 'left', clickCount: 1 };
            await page('Input.dispatchMouseEvent', { ...p, type: 'mouseMoved', button: 'none' });
            await page('Input.dispatchMouseEvent', { ...p, type: 'mousePressed' });
            await page('Input.dispatchMouseEvent', { ...p, type: 'mouseReleased' }); out = 'clicked'; break;
          }
          case 'shot': { // hidden tab doesn't paint: snapshot its live DOM (MHTML, exact state) and render that in a
            // throwaway headless Chrome (no window, no focus, temp profile = none of the user's cookies)
            const { data } = await page('Page.captureSnapshot', { format: 'mhtml' });
            const dir = mkdtempSync(join(tmpdir(), 'cdp-shot-')), m = join(dir, 'page.mhtml'), file = resolve(a);
            writeFileSync(m, data); rmSync(file, { force: true });
            const vw = await js('[innerWidth||1280, innerHeight||800]').catch(() => [1280, 800]);
            await new Promise(ok => { const c = spawn(CHROME, ['--headless=new', `--user-data-dir=${dir}`, '--no-first-run',
              '--hide-scrollbars', `--window-size=${vw[0] || 1280},${vw[1] || 800}`, `--screenshot=${file}`, pathToFileURL(m).href],
              { stdio: 'ignore', windowsHide: true }); const t = setTimeout(() => c.kill(), 30000); c.on('exit', () => { clearTimeout(t); ok(); }); });
            rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
            if (!existsSync(file)) throw new Error('screenshot failed'); out = file; break; }
          case 'cdp': out = await page(a, b ? JSON.parse(b) : {}); break; // raw CDP on the current tab: cdp Page.reload '{"ignoreCache":true}'
          case 'wake': { // background/hidden tab: emulate focus + keep frames coming so rAF, lazy lists and timers run as if visible.
            // Lasts while this call is attached: chain the reads after it in the same call.
            await page('Emulation.setFocusEmulationEnabled', { enabled: true });
            await page('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
            await page('Page.enable');
            await page('Page.startScreencast', { format: 'jpeg', quality: 1, maxWidth: 64, maxHeight: 64 });
            await sleep(+a || 500); // let the page paint what it skipped
            out = await js(`JSON.stringify({visibility:document.visibilityState,focus:document.hasFocus()})`); break;
          }
          case 'reload': await page('Page.reload', { ignoreCache: true }, 10000); await sleep(300);
            await waitFor(`document.readyState==='complete'`, 30000); out = await js('document.title'); break;
          case 'upload': { // real file pick on <input type=file> (css a), files = rest of the step; fires change like a user pick
            const paths = step.slice(2).map(f => resolve(f));
            if (!paths.length) throw new Error('upload <css> <file...>');
            for (const f of paths) if (!existsSync(f)) throw new Error(`no such file ${f}`);
            const el = await need(a);
            if (await on(el, `function(){return this.tagName==='INPUT'&&this.type==='file'}`)) {
              await page('DOM.setFileInputFiles', { objectId: el.o, files: paths });
            } else { // a button that opens the OS file picker (WhatsApp "Documento"): intercept the picker, never shown
              await page('Page.enable'); await page('Page.setInterceptFileChooserDialog', { enabled: true });
              try {
                const chooser = new Promise((ok, ko) => {
                  const f = m => { if (m.method === 'Page.fileChooserOpened' && m.sessionId === sid) { listeners.delete(f); ok(m.params); } };
                  listeners.add(f); setTimeout(() => { listeners.delete(f); ko(new Error(`no file picker opened by ${a}`)); }, 10000).unref();
                }); chooser.catch(() => {});
                await realClick(a); // real input: the picker needs a user gesture
                const { backendNodeId } = await chooser;
                await page('DOM.setFileInputFiles', { backendNodeId, files: paths });
              } finally { await page('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {}); }
            }
            out = `uploaded ${paths.length}: ${paths.join(', ')}`; break;
          }
          case 'save': { // save <url|css> <file>: fetch inside the page (its cookies; blob: URLs too) and write to disk in one step
            const src = /^(https?|blob|data):/.test(a) ? a : await on(a, `function(){return this.href||this.src||this.currentSrc}`);
            if (!src) throw new Error(`no url for ${a}`);
            const b64 = await js(`fetch(${q(src)}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.blob()}).then(b=>new Promise(ok=>{const f=new FileReader();f.onload=()=>ok(f.result.split(',')[1]);f.readAsDataURL(b)}))`);
            const file = resolve(b); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, Buffer.from(b64, 'base64'));
            out = `${file} (${statSync(file).size} bytes)`; break;
          }
          case 'download': { // download <css> [dir]: click a download button, file lands in dir (default ~/Downloads); browser default restored after
            const dir = resolve(b || join(homedir(), 'Downloads')); mkdirSync(dir, { recursive: true });
            let guid, name, retries = 0; const done = new Promise((ok, ko) => {
              const f = m => {
                if (m.method === 'Browser.downloadWillBegin' && !guid) { guid = m.params.guid; name = m.params.suggestedFilename; }
                if (m.method === 'Browser.downloadProgress' && m.params.guid === guid && m.params.state !== 'inProgress') {
                  listeners.delete(f); m.params.state === 'completed' ? ok() : ko(new Error(`download ${m.params.state}`));
                } };
              listeners.add(f);
              setTimeout(() => { if (!guid) { listeners.delete(f); ko(new Error('click started no download in 15s')); } }, 15000).unref();
              setTimeout(() => { listeners.delete(f); ko(new Error('download timeout 120s')); }, 120000).unref();
            });
            done.catch(() => {}); // a failed click must not leave an unhandled rejection (would kill the daemon)
            // allowAndName: saved as <guid>, renamed below without overwriting (two WhatsApp photos can share a name)
            const me = `cli ${who}`; await dlTake(me);
            try {
            await send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: dir, eventsEnabled: true });
              // real click (apps like WhatsApp ignore el.click()). WhatsApp's first click on a document often only
              // fetches it into the app: no browser download. Click again (max 2 more, 1 s apart) while the
              // button is still there and nothing started; a busy/cancel state has another title, so it is not hit.
              await realClick(a);
              for (let i = 0; i < 2 && !guid; i++) {
                if (await Promise.race([done.then(() => true, () => true), sleep(1000).then(() => false)]) || guid) break;
                if (await find(a, false)) { await realClick(a); retries++; }
              }
              await done;
            } finally { await send('Browser.setDownloadBehavior', { behavior: 'default' }).catch(() => {}); dlFree(me); }
            const ext = extname(name), base = name.slice(0, name.length - ext.length);
            let file = join(dir, name); for (let n = 1; existsSync(file); n++) file = join(dir, `${base} (${n})${ext}`);
            renameSync(join(dir, guid), file);
            out = `${file} (${statSync(file).size} bytes${retries ? `, ${retries + 1} clicks` : ''})`; break;
          }
          case 'tabs': out = `${mode.toUpperCase()}${real ? ' (real session)' : ' (agent profile)'}\n`
            + pages.map(t => `${t.targetId === tab ? '*' : ' '} ${t.title} | ${t.url}`).join('\n'); break;
          default: throw new Error(`unknown cmd ${cmd}`);
        }
        lines.push(`[${cmd} ${(performance.now() - t0).toFixed(0)}ms] ${typeof out === 'string' ? out : JSON.stringify(out)}`);
      }
      return { out: lines.join('\n'), code: 0, mode };
    } catch (e) { return { out: lines.join('\n'), err: `ERR ${e.message}`, code: 1, mode }; }
    finally { for (const s of detach) send('Target.detachFromTarget', { sessionId: s }).catch(() => {}); }
  }

  // fresh secret per daemon start. %TEMP% ACL can be broad (sandbox groups, LOCAL SERVICE), so lock the
  // file to the current user + SYSTEM before writing the secret into it.
  // Lock the DIRECTORY first so the token file is born private (no window where another account can open it).
  mkdirSync(dirname(TF), { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const acl = spawnSync('icacls', [dirname(TF), '/inheritance:r', '/grant:r',
      `${process.env.USERNAME}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true });
    if (acl.status !== 0) { console.error('icacls failed'); process.exit(1); } // never write the secret to a readable place
  } else { // /tmp is shared: the folder must be ours (not pre-created by another user) and private
    const st = lstatSync(dirname(TF)); // lstat: a symlink planted in /tmp is refused, not followed
    if (st.uid !== process.getuid() || !st.isDirectory()) { console.error(`${dirname(TF)} is not ours: refusing to write the token`); process.exit(1); }
    chmodSync(dirname(TF), 0o700);
  }
  rmSync(TF, { force: true }); writeFileSync(TF, TOKEN, { mode: 0o600 });
  let idle = idleTimer();
  const queues = new Map(); // per session: serialized within a session (one tab), parallel across sessions

  // ---------- CDP relay: Playwright/Puppeteer over THIS connection (no new "Allow remote debugging?" prompt) ----------
  // ws://127.0.0.1:<daemon port>/cdp with header x-cdp-token (same token and checks as the CLI). Each client gets its own
  // browser-level session (Target.attachToBrowserTarget), so its auto-attach, download settings and child sessions are
  // separate from the daemon's and from other clients'. Browser.close/crash are refused: a client never closes the user's browser.
  let relayN = 0;
  server.on('upgrade', async (req, sock) => {
    const tok = String(req.headers['x-cdp-token'] || '');
    if (!ws || req.url !== '/cdp' || req.headers.origin || req.headers.host !== `127.0.0.1:${DPORT}` || !req.headers['sec-websocket-key']
      || tok.length !== TOKEN.length || !timingSafeEqual(Buffer.from(tok), Buffer.from(TOKEN))) { sock.destroy(); return; }
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sock.setNoDelay(true);
    const frame = (op, data) => { // server frames are never masked
      const n = data.length, h = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : Buffer.alloc(10);
      if (n >= 65536) { h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
      if (!sock.destroyed) sock.write(Buffer.concat([h, data]));
    };
    const out = m => frame(1, Buffer.from(JSON.stringify(m)));
    let root, closed = false, dl = false; const mine = new Set(); // root browser session + child sessions of this client
    const me = `relay ${++relayN}`;
    const dead = new Set(); // tabs that did not answer when the client came in: hidden from it (see below)
    const fwd = m => { // browser event → this client, if it belongs to one of its sessions
      if (dead.has(m.params?.targetInfo?.targetId) && /^Target\.(attachedToTarget|targetCreated|targetInfoChanged)$/.test(m.method)) {
        if (m.method === 'Target.attachedToTarget' && (m.sessionId === root || mine.has(m.sessionId)))
          send('Target.detachFromTarget', { sessionId: m.params.sessionId }).catch(() => {});
        return;
      }
      if (m.method === 'Target.attachedToTarget' && (m.sessionId === root || mine.has(m.sessionId))) mine.add(m.params.sessionId);
      if (m.method === 'Target.detachedFromTarget') mine.delete(m.params.sessionId);
      if (m.sessionId === root) { const { sessionId, ...rest } = m; out(rest); } else if (mine.has(m.sessionId)) out(m);
    };
    const bye = () => {
      if (closed) return; closed = true; listeners.delete(fwd); sock.destroy();
      if (root) send('Target.detachFromTarget', { sessionId: root }).catch(() => {}); // children go with it
      // Playwright sets allowAndName (GUID file names, its temp folder) on the user's default context and never undoes it;
      // it outlives the session, so the user's own downloads would land as "<guid>.tmp". Restore Brave's normal behavior.
      if (dl) send('Browser.setDownloadBehavior', { behavior: 'default' }).catch(() => {}).finally(() => dlFree(me));
      else if (dlOwner === me) dlFree(me); // left while its turn was being granted
      appendFileSync(LOG, `[${new Date().toISOString()}] relay: client gone\n`);
    };
    try { root = (await send('Target.attachToBrowserTarget')).sessionId; } catch { bye(); return; }
    // Playwright waits for EVERY tab to answer on connect: one hung tab (busy renderer) blocks it for good. Probe all
    // tabs in parallel (1.5 s each) and hide the ones that do not answer from this client.
    try {
      const { targetInfos } = await send('Target.getTargets');
      await Promise.all(targetInfos.filter(t => t.type === 'page').map(async t => {
        let s;
        try {
          s = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true }, undefined, 1500)).sessionId;
          await send('Runtime.evaluate', { expression: '1' }, s, 1500);
        } catch { dead.add(t.targetId); }
        if (s) send('Target.detachFromTarget', { sessionId: s }).catch(() => {});
      }));
      if (dead.size) appendFileSync(LOG, `[${new Date().toISOString()}] relay: hiding ${dead.size} unresponsive tab(s)
`);
    } catch {}
    listeners.add(fwd);
    appendFileSync(LOG, `[${new Date().toISOString()}] relay: client in\n`);
    const onMsg = txt => {
      let m; try { m = JSON.parse(txt); } catch { return; }
      if (/^Browser\.(close|crash|crashGpuProcess)$/.test(m.method)) return out({ id: m.id, result: {}, ...(m.sessionId ? { sessionId: m.sessionId } : {}) });
      if (m.method === 'Browser.setDownloadBehavior' && !dl) { // wait for the turn (another client may own downloads)
        dlTake(me).then(() => { if (closed) return dlFree(me); dl = true; onMsg(txt); },
          e => out({ id: m.id, error: { code: -32000, message: e.message }, ...(m.sessionId ? { sessionId: m.sessionId } : {}) }));
        return;
      }
      const sid = m.sessionId || root, i = ++id;
      if (m.method === 'Target.getTargets') { // keep hidden tabs hidden here too
        pending.set(i, r => { if (r.result) r.result.targetInfos = r.result.targetInfos.filter(t => !dead.has(t.targetId)); const { id: _, sessionId, ...rest } = r; out({ id: m.id, ...rest, ...(m.sessionId ? { sessionId: m.sessionId } : {}) }); });
        ws.send(JSON.stringify({ ...m, id: i, sessionId: sid })); return;
      }
      if (sid !== root && !mine.has(sid)) return out({ id: m.id, error: { code: -32001, message: `Session with given id not found.` }, sessionId: m.sessionId });
      pending.set(i, r => {
        if (m.method === 'Target.attachToTarget' && r.result?.sessionId) mine.add(r.result.sessionId);
        const { id: _, sessionId, ...rest } = r; out({ id: m.id, ...rest, ...(m.sessionId ? { sessionId: m.sessionId } : {}) });
      });
      ws.send(JSON.stringify({ ...m, id: i, sessionId: sid }));
    };
    let buf = Buffer.alloc(0), parts = [];
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      for (;;) { // client frames: always masked; text may come fragmented
        if (buf.length < 2) return;
        const fin = buf[0] & 0x80, op = buf[0] & 15; let n = buf[1] & 127, o = 2;
        if (n === 126) { if (buf.length < 4) return; n = buf.readUInt16BE(2); o = 4; }
        else if (n === 127) { if (buf.length < 10) return; n = Number(buf.readBigUInt64BE(2)); o = 10; }
        if (buf.length < o + 4 + n) return;
        const mask = buf.subarray(o, o + 4), data = Buffer.from(buf.subarray(o + 4, o + 4 + n));
        for (let k = 0; k < n; k++) data[k] ^= mask[k & 3];
        buf = buf.subarray(o + 4 + n);
        if (op === 8) { frame(8, Buffer.alloc(0)); bye(); return; }
        if (op === 9) { frame(10, data); continue; }
        if (op === 1 || op === 0) { parts.push(data); if (fin) { onMsg(Buffer.concat(parts).toString('utf8')); parts = []; } }
      }
    });
    sock.on('close', bye); sock.on('error', bye);
  });

  boot();
  function handle(req, res) {
    // Security: only our CLI may drive the browser. Reject web pages (Origin/Host: CSRF + DNS rebinding;
    // the custom token header also forces a CORS preflight we never answer) and anyone without the token.
    const tok = String(req.headers['x-cdp-token'] || '');
    if (req.method !== 'POST' || req.headers.origin || req.headers.host !== `127.0.0.1:${DPORT}`
      || tok.length !== TOKEN.length || !timingSafeEqual(Buffer.from(tok), Buffer.from(TOKEN))) {
      res.statusCode = 403; res.end('{"err":"forbidden","code":1}'); req.destroy(); return;
    }
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      let who, argv;
      try { ({ who, argv } = JSON.parse(body)); } catch {}
      if (!Array.isArray(argv)) { res.end('{"err":"ERR bad request","code":1}'); return; }
      who = String(who || 'default').replace(/[^\w-]/g, '_');
      clearTimeout(idle); idle = idleTimer();
      // preferred browser (REAL[0], Brave) came back after we fell back → quit, client respawns and picks it
      if (mode !== REAL[0][0] && process.env.CDP_MODE !== 'agent') try {
        if (statSync(`${REAL[0][1]}/DevToolsActivePort`).mtimeMs > STARTED) {
          res.end('{"retry":true}');
          closeTabs(); // don't leave our tabs behind
          setTimeout(() => onExit(0), 150); return;
        }
      } catch {}
      const q = (queues.get(who) || Promise.resolve()).then(async () => {
        const r = bootErr ? { err: bootErr, code: 1 } : await run(argv, who).catch(e => ({ err: `ERR ${e.message}`, code: 1 }));
        res.end(JSON.stringify(r));
        if (bootErr) setTimeout(() => process.exit(1), 100); // no browser: report once, then exit so next call retries
      });
      queues.set(who, q);
    });
  }
}
