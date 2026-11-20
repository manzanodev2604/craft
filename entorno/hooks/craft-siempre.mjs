// Hace que craft se aplique sin depender de que el modelo la elija por su descripción.
//   node craft-siempre.mjs sesion  -> SessionStart: la guía entera, una vez (y tras compactar)
//   node craft-siempre.mjs mensaje -> UserPromptSubmit: recordatorio de una línea
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function guia(texto, ruta) {
  const cuerpo = texto.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
  return `<craft>\nGuía de trabajo activa en toda la sesión (skill craft, ${ruta}). ` +
    `Aplícala en cualquier tarea sobre código o datos; en preguntas generales no hace falta. ` +
    `Las rutas references/ son relativas a esa carpeta.\n\n${cuerpo}\n</craft>`;
}

const RECORDATORIO = 'craft activa: si este mensaje es trabajo sobre código o datos, sigue su ciclo y sus paradas.';

const modo = process.env.CRAFT_APUNTES ? '' : process.argv[2]; // apuntes-sesion.mjs: claude -p sin guía
if (modo === '--test') {
  const g = guia('---\nname: craft\n---\n\n# Craft\nhola', '/x');
  assert.ok(g.includes('# Craft\nhola') && !g.includes('name: craft') && g.includes('/x'));
  console.log('ok');
} else if (modo === 'sesion') {
  // mapa tarea -> skill: con las skills en modo solo nombre, el agente sabe cuál invocar
  let mapa = '';
  try { mapa = '\n\n' + readFileSync(join(dir, 'entorno', 'skills-por-tarea.md'), 'utf8').trim(); } catch {}
  console.log(guia(readFileSync(join(dir, 'SKILL.md'), 'utf8') + mapa, dir));
} else if (modo === 'mensaje') {
  const hoy = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  console.log(`Hoy es ${hoy}. ${RECORDATORIO}`);
} else if (modo === 'escrito') {
  // PostToolUse Write|Edit: raya larga en un texto para personas
  const e = JSON.parse(readFileSync(0, 'utf8') || '{}'), i = e.tool_input || {};
  const texto = String(i.content ?? i.new_string ?? '');
  if (/\.(md|mdx|txt|html?|rst|tex)$/i.test(i.file_path || '') && texto.includes('—'))
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `craft: ${i.file_path} lleva raya larga (—). El usuario no la usa: cámbiala por coma, dos puntos, paréntesis o punto.` } }));
}
