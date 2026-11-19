// Hook PreToolUse (Bash|PowerShell): lo del agente se queda en local.
//   - commit con ficheros del agente o borradores (CLAUDE.md, .claude/, .craft/...) -> se bloquea
//   - push o PR que llevaría esos ficheros -> se bloquea
//   - cualquier otro push, PR o fusión -> pide confirmación al usuario
//   - git add -A / git add . / git commit -a / --no-verify / push --force a la rama principal -> se bloquea
// Excepción por repositorio (repos personales que ya suben CLAUDE.md): git config craft.subirAgente true
// Comprobación: node git-guarda.mjs --test
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import assert from 'node:assert/strict';

const NOMBRES = new Set(['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.mcp.json']);
const CARPETAS = new Set(['.claude', '.craft']);

export function esDelAgente(ruta) {
  const partes = ruta.replace(/\\/g, '/').split('/');
  return NOMBRES.has(partes.at(-1)) || partes.slice(0, -1).some(p => CARPETAS.has(p));
}

// Trozos de una línea de comandos separados por ; && || | o salto de línea
const trozos = cmd => cmd.split(/;|&&|\|\||\||\n/).map(s => s.trim()).filter(Boolean);

export function clasifica(cmd) {
  const r = { commit: false, push: false, pr: false, addTodo: false, noVerify: false, force: false, rama: null, dir: null, añadidos: [] };
  for (const t of trozos(cmd)) {
    const cd = t.match(/^(?:cd|Set-Location|pushd)\s+["']?([^"';]+?)["']?$/i);
    if (cd) r.dir = cd[1];
    if (/^(gh\s+pr|glab\s+mr)\s+(create|merge)\b/.test(t)) r.pr = true;
    // solo trozos que son un comando git de verdad, no texto que lo menciona (echo, grep...)
    const tok = t.replace(/^(?:\w+=\S*\s+)*/, '').split(/\s+/);
    if (!/^git(\.exe)?$/.test(tok[0])) continue;
    let i = 1;
    for (; i < tok.length && tok[i].startsWith('-'); i++) {
      if (tok[i] === '-C') r.dir = tok[i + 1].replace(/^["']|["']$/g, '');
      if (tok[i] === '-C' || tok[i] === '-c') i++;
    }
    const sub = tok[i], args = tok.slice(i + 1), opts = args.filter(x => x.startsWith('-'));
    const pos = args.filter(x => !x.startsWith('-')).map(x => x.replace(/^["']|["']$/g, ''));
    if (opts.includes('--no-verify')) r.noVerify = true;
    if (sub === 'commit') {
      r.commit = true;
      if (opts.some(o => o === '--all' || /^-a\w*$/.test(o))) r.addTodo = true;
    } else if (sub === 'add') {
      if (opts.some(o => o === '-A' || o === '--all') || pos.includes('.')) r.addTodo = true;
      r.añadidos.push(...pos);
    } else if (sub === 'push') {
      r.push = true;
      if (opts.includes('--force') || opts.includes('-f')) r.force = true;
      if (pos[1]) r.rama = pos[1].split(':').at(-1);
    }
  }
  return r;
}

function git(dir, ...args) {
  try { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}
const lineas = s => s.split('\n').map(x => x.trim()).filter(Boolean);

function decide(cmd, cwd) {
  const r = clasifica(cmd);
  if (!r.commit && !r.push && !r.pr && !r.addTodo && !r.noVerify) return null;
  let dir = r.dir ? r.dir.replace(/^~|^\$HOME/, homedir()) : cwd;
  if (!/^([A-Za-z]:|\/)/.test(dir)) dir = `${cwd}/${dir}`;
  if (!git(dir, 'rev-parse', '--git-dir')) return null;

  if (r.noVerify) return ['deny', 'craft: no se saltan los hooks del repositorio (--no-verify). Arregla lo que fallan o pregunta al usuario.'];
  if (r.addTodo) return ['deny', 'craft: añade los ficheros de la tarea por su nombre (git add <ficheros>), no con -A, --all, "." ni commit -a. Así no se cuelan borradores ni ficheros del agente.'];

  const actual = git(dir, 'branch', '--show-current');
  const filtra = git(dir, 'config', '--get', 'craft.subirAgente') === 'true' ? () => false : esDelAgente;
  if (r.commit) {
    // lo ya preparado y lo que un git add del mismo comando va a meter
    const malos = [...new Set([...lineas(git(dir, 'diff', '--cached', '--name-only')), ...r.añadidos])].filter(filtra);
    if (malos.length) return ['deny', `craft: el commit lleva ficheros del agente o borradores, que se quedan en local: ${malos.join(', ')}. Sácalos con git restore --staged <fichero>. Si el usuario quiere subirlos, que haga él el commit.`];
  }
  if (r.push || r.pr) {
    const malos = [...new Set(lineas(git(dir, 'log', '--name-only', '--format=', 'HEAD', '--not', '--remotes')).filter(filtra))];
    if (malos.length) return ['deny', `craft: los commits sin subir llevan ficheros del agente o borradores: ${malos.join(', ')}. No se suben; quítalos del historial local o pregunta al usuario.`];
    const rama = r.rama || actual;
    if (r.force && /^(main|master|develop|trunk)$/.test(rama)) return ['deny', `craft: nunca push --force a ${rama}.`];
    const sinSubir = lineas(git(dir, 'log', '--oneline', 'HEAD', '--not', '--remotes')).length;
    const que = r.pr ? 'Crear o fusionar una PR/MR' : `Push de ${rama || 'la rama actual'} (${sinSubir} commit(s) sin subir${r.force ? ', CON --force' : ''})`;
    return ['ask', `craft: ${que}. Publicar solo cuando el usuario lo ha pedido para esta tarea.${/^(main|master)$/.test(rama) ? ' Ojo: es la rama principal; en un repo de equipo va por PR.' : ''}`];
  }
  return null;
}

const modo = process.argv[2];
if (modo === '--test') {
  assert.ok(esDelAgente('CLAUDE.md') && esDelAgente('src/CLAUDE.local.md') && esDelAgente('.claude/settings.json'));
  assert.ok(esDelAgente('.craft/plan.md') && esDelAgente('a\\.claude\\x') && esDelAgente('.mcp.json'));
  assert.ok(!esDelAgente('src/claude.py') && !esDelAgente('.claude-plugin/plugin.json') && !esDelAgente('docs/plan.md'));
  let c = clasifica('cd ~/repo && git add src/a.py && git commit -m "x"');
  assert.ok(c.commit && !c.addTodo && !c.push && c.dir === '~/repo');
  assert.deepEqual(clasifica('git add -f "CLAUDE.md" src/a.py && git commit -m x').añadidos, ['CLAUDE.md', 'src/a.py']);
  assert.ok(clasifica('git commit -am x').addTodo && !clasifica('git commit -m "a b"').addTodo);
  assert.ok(clasifica('git add -A').addTodo && clasifica('git add .').addTodo && !clasifica('git add ./src/a.py').addTodo);
  c = clasifica('git -c credential.helper= push origin main');
  assert.ok(c.push && c.rama === 'main' && !c.force);
  assert.ok(clasifica('git push --force origin feat/x').force && clasifica('git push -u origin HEAD:feat/y').rama === 'feat/y');
  assert.ok(clasifica('gh pr create --fill').pr && clasifica('git commit --no-verify -m x').noVerify);
  assert.ok(!clasifica('git status && git log --oneline').commit && !clasifica('echo push').push);
  assert.ok(!clasifica('grep -n "git push" f.md').push && !clasifica("sed -i 's/git add -A/x/' f").addTodo);
  assert.ok(clasifica('GIT_TRACE=1 git -C "/tmp/r" commit -m x').commit && clasifica('git -C "/tmp/r" push').dir === '/tmp/r');
  console.log('ok');
} else {
  const e = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const d = decide(String(e.tool_input?.command ?? ''), e.cwd || process.cwd());
  if (d) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d[0], permissionDecisionReason: d[1] } }));
}
