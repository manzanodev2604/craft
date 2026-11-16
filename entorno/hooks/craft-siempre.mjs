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

const modo = process.argv[2];
if (modo === '--test') {
  const g = guia('---\nname: craft\n---\n\n# Craft\nhola', '/x');
  assert.ok(g.includes('# Craft\nhola') && !g.includes('name: craft') && g.includes('/x'));
  console.log('ok');
} else if (modo === 'sesion') {
  console.log(guia(readFileSync(join(dir, 'SKILL.md'), 'utf8'), dir));
} else if (modo === 'mensaje') {
  console.log(RECORDATORIO);
}
