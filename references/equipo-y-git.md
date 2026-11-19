# Equipo y git

Cómo trabajar en un repositorio compartido: qué se queda en local, qué se sube, cómo se prepara una pull request (PR; en GitLab, merge request o MR) y cómo se revisa. Cada apartado da el valor por defecto, la señal para cambiarlo, cómo verificar y los riesgos que señalar siempre.

**Las normas del repositorio mandan** (`CONTRIBUTING.md`, plantilla de PR, nombres de rama, estilo de commits, merge o rebase). Esta guía cubre lo que no digan.

## Índice

1. Lo que nunca sale del ordenador
2. Una rama por tarea
3. Qué entra en cada commit
4. Cuándo se sube
5. La pull request
6. Revisión: recibir y dar
7. Mantenerse al día y conflictos
8. Lo que no se hace nunca en un repo compartido

---

## 1. Lo que nunca sale del ordenador

**Por defecto:** todo lo del agente y todo borrador se queda en local:
1. Ficheros del agente: `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.mcp.json`, la carpeta `.claude/`.
2. Planes, progreso, notas, estimaciones, informes y borradores de la tarea: en `.craft/` en la raíz del repositorio.
3. Secretos, `.env`, datos reales, salidas generadas y ficheros temporales.

`.craft/` y lo de los puntos 1 y 2 están en el ignorado global de git del usuario (`~/.config/git/ignore`), no en el `.gitignore` del equipo: así no hace falta tocar el repositorio de nadie. El hook `git-guarda.mjs` bloquea además cualquier commit o push que los lleve.

Por qué: el equipo no ha pedido esos ficheros. Un `CLAUDE.md` subido cambia cómo trabaja el agente de cada compañero, un borrador subido parece una decisión y un plan viejo engaña.

**Cambiar si:** el usuario pide expresamente subir uno de esos ficheros (por ejemplo, el equipo acuerda un `AGENTS.md` común). Entonces hace él el commit; el agente prepara el fichero y lo dice.

**Verificar:** `git status --ignored` muestra `.craft/` como ignorada, y `git diff --staged --name-only` antes de cada commit no lleva ninguno.

**Señalar siempre:** cualquier fichero del agente que ya esté en el historial del repositorio (alguien lo subió antes); no lo borres, pregunta.

## 2. Una rama por tarea

**Por defecto:**
1. Antes de empezar: `git switch main && git pull --ff-only` (o la rama base que digan las normas).
2. Rama nueva con el nombre que pidan las normas; si no dicen nada, `tipo/ticket-descripcion-corta` (`feat/123-exportar-csv`, `fix/124-fecha-utc`).
3. Una tarea, una rama. Si aparece otra cosa por el camino, se anota en «Pendiente» y va en otra rama.
4. Nunca se trabaja ni se hace commit directamente en `main`, `master` o `develop`.

Por qué: una rama con una sola cosa se revisa rápido y se puede descartar sin arrastrar nada.

**Cambiar si:** el repositorio es solo del usuario y no usa ramas (por ejemplo, sus propios proyectos personales).

**Verificar:** `git branch --show-current` no es la rama principal antes del primer commit.

## 3. Qué entra en cada commit

**Por defecto:**
1. Añade los ficheros por su nombre: `git add src/a.py tests/test_a.py`. Nunca `git add -A`, `git add .` ni `git commit -a`: son la vía por la que se cuelan borradores, ficheros del agente y cambios ajenos a la tarea.
2. Antes de cada commit, lee `git diff --staged` entero. Cada línea tiene que ser de la tarea; un cambio de formato o una limpieza no pedida va fuera o en su propio commit.
3. Commits pequeños, uno por unidad del ciclo, que compilen y pasen las pruebas.
4. Mensaje con el formato de las normas o, si no hay, el de los commits recientes (`git log --oneline -20`). Di qué cambia y por qué; sin autoría ni coautoría del agente.

**Verificar:** `git show --stat HEAD` lista solo ficheros de la tarea.

**Señalar siempre:** cambios del working tree que no son de la tarea y se han quedado sin commit (pueden ser del usuario: no los toques).

## 4. Cuándo se sube

**Por defecto:** se trabaja en local con commits. Push, PR y fusiones **solo cuando el usuario lo pide para esta tarea** ("sube", "abre la PR"); un permiso no vale para la siguiente. El hook `git-guarda.mjs` pide confirmación en cada push, PR o fusión.

Antes de subir:
1. Suite completa en verde y la lista de la parada 5 hecha.
2. `git log --oneline origin/main..HEAD` y `git diff --stat origin/main...HEAD`: solo los commits y ficheros de la tarea.
3. Ni un fichero del apartado 1.

Primera subida de la rama: `git push -u origin <rama>`. Nunca a la rama principal.

**Verificar:** tras el push, el CI de la rama; si falla, explica por qué y arréglalo antes de pedir revisión.

## 5. La pull request

**Por defecto:**
1. Pequeña: una sola cosa, idealmente menos de 400 líneas cambiadas. Si crece, se parte en varias PR encadenadas.
2. Se abre como borrador (`gh pr create --draft`) hasta que el CI esté en verde y te hayas revisado el diff completo en la web, como lo verá el revisor.
3. Usa la plantilla del repositorio. Si no hay, la descripción lleva:
   1. **Qué y por qué**, con el enlace al ticket.
   2. **Cómo probarlo**: comandos y resultado esperado.
   3. **Riesgos y lo no comprobado** (lo mismo que el informe final).
   4. Capturas si cambia algo visible.
4. Revisores: los que digan las normas o `CODEOWNERS`; si no, pregunta al usuario a quién.
5. Pasa de borrador a lista solo cuando el usuario lo diga.

Por qué: una PR pequeña y bien descrita se revisa en minutos; una grande se aprueba sin leer.

**Verificar:** el diff de la PR coincide con lo que dice la descripción, sin ficheros de más.

## 6. Revisión: recibir y dar

**Recibir:**
1. Responde a cada comentario: arreglado (con el commit), o por qué no, con argumentos. No ignores ninguno.
2. Durante la revisión, los cambios van en commits nuevos, no reescribiendo los ya revisados, salvo que las normas pidan otra cosa. Por qué: el revisor ve solo lo nuevo.
3. Quien abrió el hilo lo marca como resuelto, no tú, salvo que las normas digan otra cosa.
4. Si un comentario es técnicamente dudoso, compruébalo antes de cambiar nada.

**Dar** (si el usuario pide revisar la PR de otro):
1. Lee la descripción y el ticket antes del código.
2. Distingue bloqueante, sugerencia y duda. Pregunta antes de afirmar; cita `fichero:línea`.
3. Prepara los comentarios como borrador para el usuario; publicarlos es una acción hacia fuera (parada 4).

## 7. Mantenerse al día y conflictos

**Por defecto:** trae los cambios de la rama principal con lo que digan las normas (merge o rebase). Si no dicen nada: rebase mientras la rama no está subida; merge una vez subida y compartida.

Conflictos:
1. Entiende los dos lados antes de resolver: `git log -p` del fichero en ambas ramas.
2. Si el conflicto toca código de otra persona y no está claro cuál vale, pregunta; no elijas a ciegas.
3. Tras resolver, pasa la suite completa.

**Señalar siempre:** cualquier resolución de conflicto que cambie el comportamiento de código ajeno.

## 8. Lo que no se hace nunca en un repo compartido

1. Push a la rama principal o a la rama de otra persona.
2. `push --force` en una rama compartida. En tu propia rama, solo `--force-with-lease` y con permiso.
3. Reescribir historia ya subida (rebase, amend, reset) sin permiso.
4. Fusionar tu propia PR sin la aprobación que pidan las normas.
5. Saltarse hooks o CI (`--no-verify`, desactivar comprobaciones).
6. Borrar ramas, etiquetas o releases de otros.
7. Subir ficheros del agente, borradores o secretos (apartado 1).

Por qué: todo esto afecta al trabajo de otras personas y casi nada se deshace sin coordinar con ellas.
