// Hook UserPromptSubmit de Claude Code: si la sesión empieza solo con /engineering-work-guide,
// el título no sale de la skill sino de la carpeta y, en el siguiente mensaje, del objetivo.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const SKILL = /^\/(?:[\w-]+:)?engineering-work-guide(?:\s+([\s\S]*))?$/;

function resumen(texto) {
  const linea = texto.split('\n')
    .filter(l => !/^<\/?pasted_content/.test(l.trim()))
    .map(l => l.trim()).find(Boolean) ?? '';
  const limpia = linea.replace(/\s+/g, ' ');
  if (limpia.length <= 60) return limpia;
  const corte = limpia.slice(0, 60);
  return corte.slice(0, corte.lastIndexOf(' ') > 30 ? corte.lastIndexOf(' ') : 60);
}

// Devuelve [título o null, estado nuevo]. Estado: { visto, pendiente }.
export function decidir(prompt, cwd, estado) {
  const nuevo = { visto: true, pendiente: false };
  const m = prompt.trim().match(SKILL);
  if (!estado.visto && m) {
    if (m[1]?.trim()) return [resumen(m[1]), nuevo];
    return [cwd.split(/[\\/]/).filter(Boolean).pop() || 'sesión', { visto: true, pendiente: true }];
  }
  if (estado.pendiente && !m && resumen(prompt)) return [resumen(prompt), nuevo];
  return [null, { ...nuevo, pendiente: estado.pendiente && !!m }];
}

if (process.argv[2] === '--test') {
  const c = 'C:\\repos\\api-pagos';
  let [t, e] = decidir('/engineering-work-guide', c, {});
  assert.ok(t === 'api-pagos' && e.pendiente, 'solo skill -> carpeta');
  [t, e] = decidir('Arregla el cálculo de IVA en facturas', c, e);
  assert.ok(t === 'Arregla el cálculo de IVA en facturas' && !e.pendiente, 'luego objetivo');
  [t] = decidir('otra cosa', c, e);
  assert.ok(t === null, 'no vuelve a renombrar');
  [t] = decidir('/engineering-work-guide migrar tabla de pedidos', c, {});
  assert.ok(t === 'migrar tabla de pedidos', 'con argumentos -> argumentos');
  [t] = decidir('/engineering-work-guide', c, { visto: true });
  assert.ok(t === null, 'a mitad de sesión no toca el título');
  console.log('ok');
} else {
  const entrada = JSON.parse(readFileSync(0, 'utf8'));
  // ponytail: un fichero por sesión en tmp, sin limpieza; el sistema vacía tmp
  const dir = join(tmpdir(), 'titulo-sesion');
  const fichero = join(dir, `${entrada.session_id}.json`);
  const estado = existsSync(fichero) ? JSON.parse(readFileSync(fichero, 'utf8')) : {};
  const [titulo, nuevo] = decidir(entrada.prompt ?? '', entrada.cwd ?? '', estado);
  mkdirSync(dir, { recursive: true });
  writeFileSync(fichero, JSON.stringify(nuevo));
  if (titulo) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', sessionTitle: titulo },
    }));
  }
}
