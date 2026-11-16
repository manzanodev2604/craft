// SessionStart: si la sesión abre en un repo git, lanza `leo-mcp index` en segundo plano.
// Así el aviso antes de editar (que nunca construye índice) funciona desde el primer cambio.
// No espera ni falla: sin leo-mcp o fuera de un repo, no hace nada.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let cwd = process.cwd();
try { cwd = JSON.parse(readFileSync(0, 'utf8')).cwd || cwd; } catch {}

if (existsSync(join(cwd, '.git'))) {
  const p = spawn('leo-mcp', ['index', cwd], { detached: true, stdio: 'ignore', windowsHide: true });
  p.on('error', () => {});
  p.unref();
}
