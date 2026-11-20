// Hook de seguridad de craft. Dos modos:
//   (sin argumento) PreToolUse Bash|PowerShell:
//     - borrar (rm, del, Remove-Item, rmdir...) fuera de la carpeta del proyecto y de la temporal -> pide confirmación
//     - borrar la raíz de una unidad o la carpeta personal -> se bloquea
//     - un secreto escrito tal cual en el comando (token de GitHub, clave de API, clave privada, usuario:clave@ en URL) -> se bloquea
//     - cerrar un navegador (taskkill, Stop-Process, kill... sobre brave, chrome, msedge, firefox) -> se bloquea
//   mensaje  UserPromptSubmit: si el mensaje del usuario lleva un secreto, no se envía y se avisa.
// No ve lo que borra un script (python, node) ni un kill por PID: eso queda a criterio del agente.
// Comprobación: node seguridad.mjs --test
import { readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const SECRETOS = [
  [/x-access-token:(?!\$)[^@\s"']{8,}@/, 'token en una URL de git (x-access-token:)'],
  [/https?:\/\/[^\s/:@"']+:(?!\$)[^\s/@"']{8,}@/, 'usuario y clave en una URL'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, 'token de GitHub (github_pat_)'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'token de GitHub (ghp_/gho_/ghs_...)'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'clave de API de Anthropic'],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/, 'clave de API (sk-...)'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'clave de acceso de AWS'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, 'token de Slack'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'clave de API de Google'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clave privada'],
];
export const buscaSecreto = txt => SECRETOS.find(([re]) => re.test(txt))?.[1] ?? null;

const NAVEGADOR = /\b(brave|chrome|msedge|firefox)(\.exe)?\b/i;
const MATAR = /\b(taskkill|Stop-Process|spps|kill|pkill|killall|wmic)\b/i;

const BORRAR = new Set(['rm', 'del', 'erase', 'rd', 'rmdir', 'ri', 'remove-item', 'unlink', 'shred']);
const PARAM_CON_VALOR = new Set(['-include', '-exclude', '-filter', '-credential', '-stream']);
const trozos = cmd => cmd.split(/;|&&|\|\||\||\n/).map(s => s.trim()).filter(Boolean);
const tokens = t => (t.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(x => x.replace(/^["']|["']$/g, ''));

// Rutas que borra cada trozo, y directorio tras los cd del mismo comando
export function borrados(cmd, cwd) {
  const res = [];
  let dir = cwd;
  for (const t of trozos(cmd)) {
    const tok = tokens(t);
    const orden = (tok[0] || '').toLowerCase().replace(/\.exe$/, '');
    if (/^(cd|set-location|pushd|sl)$/.test(orden) && tok[1]) { dir = resuelve(tok[1], dir); continue; }
    if (!BORRAR.has(orden)) continue;
    for (let i = 1; i < tok.length; i++) {
      const a = tok[i], al = a.toLowerCase();
      if (PARAM_CON_VALOR.has(al)) { i++; continue; }
      if (al === '-path' || al === '-literalpath') continue;
      if (a.startsWith('-') || /^\/[a-z]$/i.test(a) || a === '--') continue; // -rf, -Recurse, /s /q
      res.push(resuelve(a, dir));
    }
  }
  return res;
}

function resuelve(p, base) {
  let r = p
    .replace(/^~(?=$|[\\/])/, homedir())
    .replace(/^(\$HOME|\$env:USERPROFILE|%USERPROFILE%)(?=$|[\\/])/i, homedir())
    .replace(/^(\$env:TEMP|%TEMP%|\$TMPDIR)(?=$|[\\/])/i, tmpdir())
    .replace(/^\/([a-z])(?=$|\/)/i, '$1:'); // /c/Users -> c:/Users (Git Bash)
  if (/[$%]/.test(r)) return null; // variable sin resolver: no se sabe qué borra
  r = r.replace(/[*?[].*$/, '') || '.'; // comodín: vale lo que hay antes
  return path.resolve(base, r);
}

const norm = p => path.resolve(p).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
const dentro = (p, raiz) => { const a = norm(p), b = norm(raiz); return a === b || a.startsWith(b + '/'); };

export function decide(cmd, cwd, proyecto) {
  const secreto = buscaSecreto(cmd);
  if (secreto) return ['deny', `craft: el comando lleva un secreto escrito tal cual (${secreto}). Queda en el historial y en la transcripción. Usa una variable de entorno o el gestor de credenciales (gh auth git-credential) y dile al usuario que revoque ese secreto si ya se ha usado.`];

  // orden de cerrar al principio de un comando, y navegador en la misma tubería (Get-Process chrome | Stop-Process)
  const tuberias = cmd.split(/;|&&|\|\||\n/);
  if (tuberias.some(t => NAVEGADOR.test(t) && t.split('|').some(c => MATAR.test(tokens(c.trim())[0] || ''))))
    return ['deny', 'craft: no se cierra el navegador del usuario (se pierden sus pestañas). Si hace falta, pídeselo a él.'];

  const raices = [tmpdir()];
  const p = norm(proyecto || cwd);
  if (p !== norm(homedir()) && !/^[a-z]:$/.test(p) && p !== '') raices.push(proyecto || cwd);
  const fuera = [];
  for (const r of borrados(cmd, cwd)) {
    if (r === null) { fuera.push('(ruta con variable sin resolver)'); continue; }
    if (/^[a-z]:$|^$/.test(norm(r)) || norm(r) === norm(homedir()))
      return ['deny', `craft: nunca se borra ${r}.`];
    if (!raices.some(x => dentro(r, x))) fuera.push(r);
  }
  if (fuera.length) return ['ask', `craft: borrar fuera de la carpeta del proyecto: ${fuera.join(', ')}. Confirma solo si lo has pedido tú.`];
  return null;
}

const modo = process.argv[2];
if (modo === '--test') {
  const H = homedir(), P = path.join(H, 'Desktop', 'proy');
  const d = (c, cwd = P) => decide(c, cwd, P)?.[0] ?? null;
  // borrados
  assert.equal(d('rm -rf build dist'), null);
  assert.equal(d('Remove-Item -Recurse -Force .\\out'), null);
  assert.equal(d(`rm "${path.join(tmpdir(), 'x.txt')}"`), null);
  assert.equal(d('rm -f $TMPDIR/a'), null);
  assert.equal(d('rm ~/Downloads/koralya.pem'), 'ask');
  assert.equal(d('del /f /q C:\\Users\\x\\Downloads\\a.pem'), 'ask');
  assert.equal(d('Remove-Item -LiteralPath "$env:USERPROFILE\\Downloads\\*.pem"'), 'ask');
  assert.equal(d('cd .. && rm -rf otra'), 'ask');
  assert.equal(d('rm ../otra/a.txt'), 'ask');
  assert.equal(d('rm -rf /c/Users/x/Documents'), 'ask');
  assert.equal(d('rm "$CARPETA/a"'), 'ask');
  assert.equal(d('rm -rf ~'), 'deny');
  assert.equal(d('Remove-Item C:\\ -Recurse'), 'deny');
  assert.equal(decide('rm -rf build', H, H)?.[0], 'ask'); // proyecto = carpeta personal: no cuenta como carpeta de trabajo
  assert.equal(d('Remove-Item -Include *.log -Path .\\logs -Recurse'), null);
  assert.equal(d('grep -rn "rm -rf" .'), null);
  assert.equal(d('echo del'), null);
  // navegadores
  assert.equal(d('taskkill /F /IM brave.exe'), 'deny');
  assert.equal(d('Get-Process chrome | Stop-Process -Force'), 'deny');
  assert.equal(d('pkill -f msedge'), 'deny');
  assert.equal(d('taskkill /IM chromedriver.exe /F'), null);
  assert.equal(d('Get-Process brave'), null);
  assert.equal(d('echo "bloquea cerrar el navegador (taskkill, kill sobre Brave o Chrome)" > notas.md'), null);
  assert.equal(d('Stop-Process -Name brave'), 'deny');
  assert.equal(d('cd x && wmic process where name="chrome.exe" delete'), 'deny');
  // secretos
  assert.equal(d('git push https://x-access-token:ghs_abcdefghijklmnopqrstuvwxyz0123456789@github.com/a/b.git'), 'deny');
  assert.equal(d('git push https://x-access-token:$GH_TOKEN@github.com/a/b.git'), null);
  assert.equal(d('curl -H "Authorization: token github_pat_11ABCDEFG0123456789_abcdefghij" https://api.github.com'), 'deny');
  assert.equal(d('export ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz'), 'deny');
  assert.equal(d('grep -rn "github_pat_" .'), null);
  assert.equal(d('git clone https://github.com/a/b.git'), null);
  assert.ok(buscaSecreto('mi token es ghp_' + 'a'.repeat(36)) && !buscaSecreto('usa sk-ant- como prefijo'));
  console.log('ok');
} else if (modo === 'mensaje') {
  const e = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const s = buscaSecreto(String(e.prompt ?? ''));
  if (s) console.log(JSON.stringify({ decision: 'block', reason: `craft: el mensaje lleva un secreto (${s}) y no se ha enviado. Guárdalo en una variable de entorno o en el gestor de credenciales y vuelve a escribir el mensaje sin él. Si ya lo has pegado en otro sitio, revócalo.` }));
} else {
  const e = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const cwd = e.cwd || process.cwd();
  const d = decide(String(e.tool_input?.command ?? ''), cwd, process.env.CLAUDE_PROJECT_DIR || cwd);
  if (d) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d[0], permissionDecisionReason: d[1] } }));
}
