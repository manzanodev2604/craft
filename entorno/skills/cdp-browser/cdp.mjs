// Raw CDP client, zero deps (Node 22+ global WebSocket/fetch/http).
// Connects to YOUR real browser: Brave first, then Chrome (remote debugging must stay enabled: brave://inspect/#remote-debugging
// or chrome://inspect/#remote-debugging). Fallback: agent Chrome launched with `start` on :9333.
// A background daemon (127.0.0.1:9334) keeps ONE browser connection open: opening a connection to a
// browser with the remote-debugging toggle costs 1-3 s, an action over the open one costs ms.
// Usage:
//   node cdp.mjs goto <url> + text [css] + click <css> + fill <css> <value> + eval <js> + shot <file.png> + tabs
//   node cdp.mjs stop                      real browser: close agent tab only; agent Chrome: close it. Daemon exits.
//   node cdp.mjs start [--headless]        launch fallback Chrome with agent profile on :9333
// Actions run in a dedicated background tab, never in the user's tabs.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// ponytail: Chrome 136+ refuses --remote-debugging-port on the default profile, so fallback uses its own.
const PROFILE = process.env.CDP_PROFILE || `${process.env.LOCALAPPDATA}/chrome-agent-profile`;
// Real browsers tried in order (user's main = Brave, then Chrome). Override with CDP_USER_DATA.
const L = process.env.LOCALAPPDATA;
const BRAVE_DATA = `${L}/BraveSoftware/Brave-Browser/User Data`, CHROME_DATA = `${L}/Google/Chrome/User Data`;
const U = process.env.CDP_USER_DATA;
const REAL = U ? [[/BraveSoftware/i.test(U) ? 'brave' : /Google.Chrome/i.test(U) ? 'chrome' : 'custom', U]]
  : [['brave', BRAVE_DATA], ['chrome', CHROME_DATA]];
// Login-wall heuristic: URL path/host typical of sign-in pages. ponytail: regex, add patterns as sites need.
const LOGIN = /\/(login|signin|sign-in|sign_in|uas\/login|authwall|checkpoint|auth|sso|accounts\/login)(\/|\?|#|$)|\/\/(accounts\.google\.com|login\.|signin\.|auth\.)/i;
const ROUTE_FILE = join(tmpdir(), 'cdp-route.json'); // { last: { who: route }, hosts: { host: 'chrome' } }
// Each Claude session gets its own agent tab + command queue, so parallel sessions don't collide.
const WHO = (process.env.CDP_SESSION || process.env.CLAUDE_CODE_SESSION_ID || 'default').replace(/[^\w-]/g, '_');
const tabFile = who => join(tmpdir(), `cdp-agent-tab-${who}`);
const LOG = openSync(join(tmpdir(), 'cdp-allow.log'), 'a'); // auto-allow helper output
const sleep = ms => new Promise(r => setTimeout(r, ms));
const args = process.argv.slice(2);

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
const running = n => spawnSync('tasklist', ['/FI', `IMAGENAME eq ${n}.exe`, '/NH'], { encoding: 'utf8', windowsHide: true }).stdout.includes(`${n}.exe`);
function arm(name, dir) {
  const f = `${dir}/Local State`;
  let st; try { st = JSON.parse(readFileSync(f, 'utf8')); } catch { return 'no Local State'; }
  if (st.devtools?.remote_debugging?.['user-enabled'] === true) return 'already on';
  if (running(name)) {
    spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
      `Wait-Process -Name ${name} -ErrorAction SilentlyContinue; & '${process.execPath}' '${fileURLToPath(import.meta.url)}' arm ${name}`],
      { detached: true, stdio: 'ignore', windowsHide: true }).unref();
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
    const helper = process.env.CDP_NO_AUTOALLOW ? null : spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      join(HERE, 'allow.ps1')], { stdio: ['ignore', LOG, LOG], windowsHide: true });
    // once connected the browser shows "automated test software is controlling..." in every window; started now
    // (PowerShell + UIA take ~1.5 s to load) so it is already watching and closes it at once, focus untouched
    const dismiss = name === 'custom' ? null : spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      join(HERE, 'dismiss.ps1'), '-Browser', name], { stdio: ['ignore', LOG, LOG], windowsHide: true });
    try { ws = await open(`ws://127.0.0.1:${port}${path}`); real = true; mode = name; }
    catch (e) { dismiss?.kill(); throw e; }
    finally { helper?.kill(); }
  };
  // Order Brave → Chrome. Remote debugging stays ON in the browser (switching it needs a focused window, so
  // we never touch it); a closed browser or one with the toggle off is skipped.
  if (process.env.CDP_MODE !== 'agent') {
    for (const [name, dir] of REAL) if (name !== 'custom') appendFileSync(LOG, `[${new Date().toISOString()}] arm ${name}: ${arm(name, dir)}
`);
    for (const [name, dir] of REAL) { try { await connectReal(name, dir); break; } catch {} }
  }
  let bootErr = null;
  if (!ws) try { ws = await open((await fetch(`${BASE}/json/version`).then(r => r.json())).webSocketDebuggerUrl); }
  catch { bootErr = 'ERR no browser: enable brave://inspect/#remote-debugging in Brave (or chrome://inspect/#remote-debugging in Chrome), or run `start`'; }

  let id = 0; const pending = new Map();
  const send = (method, params = {}, sessionId) => new Promise((ok, ko) => {
    const i = ++id; pending.set(i, m => m.error ? ko(new Error(m.error.message)) : ok(m.result));
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  if (ws) {
    ws.onmessage = e => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); };
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
    const page = (method, params) => send(method, params, sid);
    const js = async expr => {
      const r = await page('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const q = s => JSON.stringify(s);
    // ponytail: poll readyState, no event subscriptions; SPA route waits need an explicit "wait <css>".
    const waitFor = async (cond, ms = 15000) => {
      for (const t = Date.now(); Date.now() - t < ms; await sleep(50))
        if (await js(cond).catch(() => false)) return;
      throw new Error(`timeout: ${cond}`);
    };
    const steps = []; let cur = [];
    for (const a of argv) a === '+' ? (steps.push(cur), cur = []) : cur.push(a);
    steps.push(cur);
    const detach = [];
    try {
      for (const [cmd, a, b] of steps) {
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
            sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
            if (apps.get(a)?.hidden && apps.get(a).id === t.targetId) await viewport(sid);
            detach.push(sid); out = `${t.title} | ${t.url}`; break;
          }
          case 'close': { // close the user's tabs whose URL contains `a` (only when the user asks)
            const ts = pages.filter(p => p.url.includes(a) && p.targetId !== tab);
            for (const t of ts) await send('Target.closeTarget', { targetId: t.targetId });
            out = `closed ${ts.length}`; break;
          }
          case 'wait': await waitFor(`!!document.querySelector(${q(a)})`); out = 'ok'; break;
          case 'text': out = await js(`(e=>e?(e.innerText.trim()?e.innerText:e.textContent):'NOT FOUND')(document.querySelector(${q(a || 'body')})).slice(0,4000)`); break; // textContent: hidden tabs may not render innerText
          case 'click': await waitFor(`!!document.querySelector(${q(a)})`); out = await js(`document.querySelector(${q(a)}).click(),'clicked'`); break;
          case 'fill': await waitFor(`!!document.querySelector(${q(a)})`);
            await js(`(()=>{const e=document.querySelector(${q(a)});e.focus();e.value='';})()`);
            await page('Input.insertText', { text: b }); out = 'filled'; break; // insertText fires real input events (React-safe)
          case 'eval': out = await js(a); break;
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
  mkdirSync(dirname(TF), { recursive: true });
  const acl = spawnSync('icacls', [dirname(TF), '/inheritance:r', '/grant:r',
    `${process.env.USERNAME}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true });
  if (acl.status !== 0) { console.error('icacls failed'); process.exit(1); } // never write the secret to a readable place
  rmSync(TF, { force: true }); writeFileSync(TF, TOKEN);
  let idle = idleTimer();
  const queues = new Map(); // per session: serialized within a session (one tab), parallel across sessions
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
