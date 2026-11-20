// Hook SessionEnd: apuntes de la sesión en <repo>/.craft/sesiones/AAAA-MM-DD-tema.md
//   Solo en repos git y en sesiones con cambios (Edit/Write) o con más de 10 mensajes del usuario.
//   Resume la transcripción y lanza en segundo plano `claude -p --model sonnet` sin herramientas;
//   la sesión se cierra sin esperar. Incluye las diferencias entre .craft/congelado/<ruta> y <ruta>.
//   node apuntes-sesion.mjs             -> SessionEnd (lee el JSON del hook por stdin)
//   node apuntes-sesion.mjs generar <resumen.txt> <repo>  -> lo que corre en segundo plano
//   node apuntes-sesion.mjs --test
// Errores: <temp>/craft-apuntes.log
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, readdirSync, statSync, appendFileSync, rmSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { tapaSecretos } from './seguridad.mjs';

const LOG = path.join(tmpdir(), 'craft-apuntes.log');
const log = m => { try { appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`); } catch {} };
const corta = (s, n) => (s = String(s ?? '')).length > n ? s.slice(0, n) + ' […]' : s;
const EDITAN = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

// Transcripción JSONL -> texto compacto, y si merece apuntes
export function resume(lineas) {
  const out = []; let humanos = 0, cambios = 0, inicio = null;
  for (const l of lineas) {
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j.isSidechain || !j.message) continue;
    inicio ??= j.timestamp;
    const c = j.message.content;
    if (j.type === 'user') {
      if (typeof c === 'string') {
        if (j.origin?.kind === 'human') humanos++;
        out.push(`USUARIO: ${corta(c, 3000)}`);
      } else for (const x of c || []) {
        if (x.type === 'text') out.push(`USUARIO: ${corta(x.text, 3000)}`);
        else if (x.type === 'tool_result' && x.is_error) out.push(`  ERROR: ${corta(typeof x.content === 'string' ? x.content : JSON.stringify(x.content), 400)}`);
      }
    } else if (j.type === 'assistant') {
      for (const x of c || []) {
        if (x.type === 'text') out.push(`AGENTE: ${corta(x.text, 2500)}`);
        else if (x.type === 'tool_use') {
          const i = x.input || {};
          if (EDITAN.has(x.name)) cambios++;
          const det = i.file_path ? `${i.file_path}${i.old_string ? `\n    antes: ${corta(i.old_string, 400)}\n    después: ${corta(i.new_string, 400)}` : ''}`
            : corta(i.command ?? i.description ?? i.prompt ?? JSON.stringify(i), 400);
          out.push(`  [${x.name}] ${det}`);
        }
      }
    }
  }
  let texto = tapaSecretos(out.join('\n'));
  if (texto.length > 200000) texto = texto.slice(0, 30000) + '\n[… parte central omitida …]\n' + texto.slice(-170000);
  return { texto, humanos, cambios, inicio, merece: cambios > 0 || humanos > 10 };
}

// Ficheros congelados durante la sesión y su diferencia con la versión actual
function congelados(repo, desde) {
  const base = path.join(repo, '.craft', 'congelado'), res = [];
  const recorre = d => { for (const f of readdirSync(d)) { const p = path.join(d, f); statSync(p).isDirectory() ? recorre(p) : res.push(p); } };
  if (existsSync(base)) recorre(base);
  return res.filter(p => !desde || statSync(p).mtimeMs >= Date.parse(desde) - 3600e3).map(p => {
    const rel = path.relative(base, p), final = path.join(repo, rel);
    if (!existsSync(final)) return `### ${rel}\n(congelado; la versión final no está en el repo, búscala en la conversación)\n${corta(readFileSync(p, 'utf8'), 4000)}`;
    let diff = '';
    try { execFileSync('git', ['diff', '--no-index', '--', p, final], { encoding: 'utf8' }); } catch (e) { diff = e.stdout || ''; }
    return `### ${rel}\n${corta(diff || '(sin cambios)', 6000)}`;
  });
}

const PROMPT = `Escribe los apuntes de una sesión de trabajo entre un ingeniero y un agente de código, a partir de su transcripción resumida. Sirven para que el ingeniero pueda explicar y defender después el trabajo, el suyo y el del agente.

Primera línea, exactamente: TEMA: <2 a 5 palabras en minúsculas separadas por guiones>
Después, en español y Markdown, solo los apartados que tengan contenido:

## Qué se hizo y por qué
Cada cambio con su fichero (y línea si consta) y la razón dada en la conversación.
## Decisiones y descartes
Qué se eligió, qué alternativas se descartaron y por qué.
## Qué se comprobó y qué no
Pruebas, comandos y resultados reales. Lo que quedó sin comprobar, dicho claramente.
## Congelado frente a final
Solo si hay sección CONGELADOS: qué cambió el ingeniero respecto a la primera versión y, para cada patrón, una regla propuesta ("Regla propuesta: …") que él aprobará o no.
## Conceptos explicados
Conceptos técnicos que se explicaron, en una o dos frases cada uno.
## Pendiente

Reglas: solo lo que está en la transcripción, sin inventar; si algo no consta, no lo pongas. Frases cortas. Sin raya larga (—). Sin datos personales de terceros.`;

export function nombre(salida, fecha) {
  const tema = (salida.match(/^TEMA:\s*(.+)$/m)?.[1] || 'sesion').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'sesion';
  return `${fecha}-${tema}`;
}

function generar(fichero, repo) {
  const { texto, inicio } = JSON.parse(readFileSync(fichero, 'utf8'));
  const cong = congelados(repo, inicio);
  const entrada = `${PROMPT}\n\n=== TRANSCRIPCIÓN ===\n${texto}${cong.length ? `\n\n=== CONGELADOS ===\n${cong.join('\n\n')}` : ''}`;
  const salida = execFileSync('claude', ['-p', '--model', 'sonnet', '--tools', '', '--no-session-persistence'],
    { input: entrada, encoding: 'utf8', maxBuffer: 20e6, timeout: 600e3, env: { ...process.env, CRAFT_APUNTES: '1' }, windowsHide: true });
  if (!/^TEMA:/.test(salida.trim())) throw new Error(`salida inesperada de claude -p: ${corta(salida.trim(), 200)}`);
  const dir = path.join(repo, '.craft', 'sesiones'); mkdirSync(dir, { recursive: true });
  const n = nombre(salida, (inicio || new Date().toISOString()).slice(0, 10));
  let f = path.join(dir, `${n}.md`);
  for (let i = 2; existsSync(f); i++) f = path.join(dir, `${n}-${i}.md`);
  writeFileSync(f, salida.replace(/^TEMA:.*\r?\n+/m, '').trim() + '\n');
  log(`ok ${f}`);
}

const modo = process.argv[2];
if (modo === '--test') {
  const L = o => JSON.stringify(o);
  const u = t => L({ type: 'user', origin: { kind: 'human' }, message: { content: t } });
  const ed = L({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'a.py', old_string: 'x', new_string: 'y' } }] } });
  let r = resume([u('hola'), L({ type: 'assistant', message: { content: [{ type: 'text', text: 'vale' }, { type: 'thinking', thinking: 'no' }] } })]);
  assert.ok(!r.merece && r.humanos === 1 && r.texto.includes('AGENTE: vale') && !r.texto.includes('no'));
  r = resume([u('cambia'), ed]);
  assert.ok(r.merece && r.cambios === 1 && r.texto.includes('[Edit] a.py') && r.texto.includes('después: y'));
  assert.ok(resume([u('token ghp_' + 'a'.repeat(36))]).texto.includes('token [SECRETO]'));
  assert.ok(resume(Array.from({ length: 11 }, () => u('x'))).merece);
  assert.ok(!resume([u('x'), L({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'tool_use', name: 'Write', input: {} }] } })]).merece);
  assert.equal(nombre('TEMA: Hooks de Seguridad\n\n## x', '2026-11-20'), '2026-11-20-hooks-de-seguridad');
  assert.equal(nombre('sin tema', '2026-11-20'), '2026-11-20-sesion');
  console.log('ok');
} else if (modo === 'generar') {
  try { generar(process.argv[3], process.argv[4]); } catch (e) { log(`error ${process.argv[4]}: ${e.message}`); }
  finally { rmSync(path.dirname(process.argv[3]), { recursive: true, force: true }); } // también si falla
} else if (!process.env.CRAFT_APUNTES) {
  try {
    const e = JSON.parse(readFileSync(0, 'utf8') || '{}');
    let repo = '';
    try { repo = execFileSync('git', ['-C', e.cwd || '.', 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
    if (repo && e.transcript_path && existsSync(e.transcript_path)) {
      const r = resume(readFileSync(e.transcript_path, 'utf8').split('\n'));
      if (r.merece) {
        // carpeta privada (0700) y fichero 0600: el resumen lleva la conversación y /tmp puede ser compartido
        const f = path.join(mkdtempSync(path.join(tmpdir(), 'craft-apuntes-')), 'resumen.json');
        writeFileSync(f, JSON.stringify({ texto: r.texto, inicio: r.inicio }), { mode: 0o600, flag: 'wx' });
        spawn(process.execPath, [fileURLToPath(import.meta.url), 'generar', f, repo],
          { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, CRAFT_APUNTES: '1' } }).unref();
      }
    }
  } catch (err) { log(`error hook: ${err.message}`); }
}
