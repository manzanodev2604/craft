# Preparar el entorno del usuario en una máquina nueva

Procedimiento para que el agente deje en otra máquina la misma configuración que el usuario usa en la suya: preferencias, plugins, skills, servidores MCP y ajustes. Se sigue **solo cuando el usuario lo pide** ("prepara mi entorno", "instala mi configuración").

## Qué hay en esta carpeta

| Fichero | Para qué |
|---|---|
| `preferencias.md` | Cómo trabaja y quiere que se le responda. Va al fichero de instrucciones de usuario del agente |
| `claude-settings.json` | Ajustes de Claude Code que se fusionan con `~/.claude/settings.json` |
| `statusline.ps1` | Línea de estado de Claude Code (necesita PowerShell 7, `pwsh`) |
| `hooks/titulo-sesion.mjs` | Hook de Claude Code: si la sesión empieza solo con `/craft`, la titula con la carpeta y después con el objetivo, nunca con el nombre de la skill (necesita `node`; comprobación: `node titulo-sesion.mjs --test`) |
| `hooks/craft-siempre.mjs` | Hook de Claude Code: carga esta guía entera al abrir la sesión (y tras compactar) y recuerda en cada mensaje que está activa, sin depender de que el modelo la elija (necesita `node`; comprobación: `node craft-siempre.mjs --test`). Con él sobra la línea en `AGENTS.md` del proyecto; en otros agentes, sigue haciendo falta |
| `hooks/leo-indice.mjs` | Hook de Claude Code: al abrir sesión en un repo git, lanza `leo-mcp index` en segundo plano para que el aviso antes de editar funcione desde el primer cambio (no bloquea; sin leo-mcp no hace nada) |
| `skills/trabajo-diario/` | Skill propia de oficina: actas que solo dan por decidido lo acordado, ponerse al día en hilos, comparar versiones de un documento y redactar según quién lo recibe; siempre citando la fuente y marcando `[FALTA]` en vez de inventar. Se carga sola |
| `skills/cdp-browser/` | Skill propia de automatización del navegador real por CDP (Windows, Node 22+) |

## Paso 0. Antes de instalar nada

1. **Normas de la empresa.** Busca política sobre herramientas de IA permitidas, extensiones, servidores MCP y datos que salen de la red. Si prohíbe algo de la lista, no se instala y se dice.
2. **Detecta el agente** y su versión: Claude Code (`claude --version`), Codex (`codex --version`), Cursor, GitHub Copilot, opencode, Gemini CLI u otro.
3. **Presenta el plan** con la tabla del paso 5 rellena (qué se instala, de dónde, qué manda fuera) y pide un sí. Instalar descarga código de internet: es una acción hacia fuera (parada 4 de `SKILL.md`).
4. Copia de seguridad de lo que vayas a sobrescribir (`settings.json` → `settings.json.bak`).

## Paso 1. Preferencias (todos los agentes)

Añade el contenido de `preferencias.md` al fichero de instrucciones **de usuario** (no al del repositorio de la empresa). Si el fichero ya existe, añade al final; no borres lo que hay.

| Agente | Fichero de usuario |
|---|---|
| Claude Code | `~/.claude/CLAUDE.md` |
| Codex | `~/.codex/AGENTS.md` |
| opencode | `~/.config/opencode/AGENTS.md` |
| Gemini CLI | `~/.gemini/GEMINI.md` |
| Cursor | Ajustes > Rules > User Rules (pegar el texto) |
| Copilot | Instrucciones personalizadas de usuario en los ajustes del editor |

Si la ruta no coincide con la versión instalada, consulta la documentación del agente antes de escribir.

## Paso 2. Plugins (Claude Code)

```bash
claude plugin marketplace add JuliusBrussee/caveman
claude plugin marketplace add DietrichGebert/ponytail
claude plugin install superpowers@claude-plugins-official
claude plugin install caveman@caveman
claude plugin install ponytail@ponytail
claude plugin install security-guidance@claude-plugins-official
claude plugin install pr-review-toolkit@claude-plugins-official
claude plugin install commit-commands@claude-plugins-official
claude plugin install frontend-design@claude-plugins-official
```

Opcional, solo si el trabajo usa Vercel: `claude plugin install vercel@claude-plugins-official`, desactivado a nivel de usuario (`"vercel@claude-plugins-official": false`) y activado solo en el `.claude/settings.local.json` de los proyectos que lo usan: son 37 skills, unos 11.000 caracteres de contexto en cada mensaje.

Cada skill visible cuesta contexto en todos los mensajes, se use o no. Las que solo quieras invocar a mano con `/nombre` van en `skillOverrides` como `"user-invocable-only"`; `/skill-doctor` muestra cuánto cuesta cada una y cuáles no se usan nunca.

| Plugin | Qué aporta | Hooks / red |
|---|---|---|
| superpowers | Método: brainstorming, planes, TDD, depuración sistemática, revisión | Hook al arrancar sesión |
| caveman | Respuestas telegráficas, menos tokens | Hooks al arrancar y en cada mensaje (necesita `node`) |
| ponytail | Construir lo mínimo (la escalera de `preferencias.md`) | Hooks al arrancar y en cada mensaje (necesita `node`) |
| security-guidance | Avisos de seguridad al editar | Hook en edición |
| pr-review-toolkit | Agentes de revisión de PR | No |
| commit-commands | `/commit`, `/commit-push-pr` | No |
| frontend-design | Diseño de interfaces con criterio | No |

**Otros agentes:** superpowers tiene instalación para Codex, opencode y otros (sigue su README en `github.com/obra/superpowers`). Caveman y ponytail no hacen falta fuera de Claude Code: sus reglas ya están en `preferencias.md`.

## Paso 3. Ajustes (Claude Code)

1. Fusiona `claude-settings.json` con `~/.claude/settings.json`: las claves del fichero ganan, las demás se conservan. No copies permisos ni modos que salten confirmaciones; en una máquina de empresa los decide el usuario.
2. El hook de título ya va en `claude-settings.json` y apunta a la skill instalada en `~/.claude/skills/craft`; si la skill está en otra ruta, ajusta `hooks.UserPromptSubmit`.
3. Copia `statusline.ps1` a `~/.claude/statusline.ps1` y pon en `statusLine.command` la **ruta absoluta** (Windows no expande `~` ahí). Sin `pwsh`, quita `statusLine`.

## Paso 4. Skills

Skills públicas, con la CLI `skills` (instala para varios agentes; confirma las opciones con `npx skills add --help`):

```bash
npx skills add anthropics/skills --skill frontend-design -g
npx skills add pbakaus/impeccable -g
npx skills add vercel-labs/agent-skills --skill web-design-guidelines -g
npx skills add wshobson/agents --skill tailwind-design-system -g
npx skills add vercel-labs/skills --skill find-skills -g
```

Skills de ingeniería de terceros, con descripción completa (sin `skillOverrides`) para que el agente las cargue solo cuando la tarea lo pide:

```bash
npx skills add https://github.com/cloudflare/security-audit-skill -s security-audit -g -a claude-code -y --copy
npx skills add addyosmani/agent-skills -s api-and-interface-design -g -a claude-code -y --copy
npx skills add addyosmani/agent-skills -s observability-and-instrumentation -g -a claude-code -y --copy
```

| Skill | Cuándo la carga | Aviso |
|---|---|---|
| `security-audit` (Cloudflare, MIT) | Preguntas o revisiones de seguridad; el flujo completo de 6 fases solo si se pide una auditoría entera | El flujo completo lanza muchos subagentes. En Windows nativo sus validadores fallan ("OS no-follow ... unavailable"); la revisión funciona, la validación del informe no. En WSL, Linux o macOS va entera |
| `api-and-interface-design` (addyosmani, MIT) | Diseñar endpoints, contratos entre módulos o interfaces públicas | Ninguno |
| `observability-and-instrumentation` (addyosmani, MIT) | Añadir logs, métricas, trazas o alertas, o diagnosticar producción | Ninguno |

Una skill por llamada: con `-s a,b` la CLI listó las skills y no instaló ninguna. `--copy` deja ficheros reales en `~/.claude/skills` en vez de enlaces.

Skill propia `trabajo-diario` (cualquier sistema): enlázala igual que `cdp-browser`. PowerShell: `New-Item -ItemType Junction -Path "$HOME\.claude\skills\trabajo-diario" -Target "$HOME\.claude\skills\craft\entorno\skills\trabajo-diario"`; en Linux o macOS, `ln -s`.

Skill propia `cdp-browser` (solo Windows con Brave o Chrome): enlaza, no copies, para que `git pull` de esta skill la actualice también. PowerShell: `New-Item -ItemType Junction -Path "$HOME\.claude\skills\cdp-browser" -Target "$HOME\.claude\skills\craft\entorno\skills\cdp-browser"`. Usa la sesión real del navegador del usuario; en una máquina de empresa, pregunta antes si se instala.

Consejo de asesores (`llm-council`): cinco asesores con enfoques opuestos, revisión anónima entre ellos y un veredicto. Sin licencia en su repo: se clona, no se copia a esta skill.

```bash
git clone --depth 1 https://github.com/aiwithremy/claude-skills-llm-council ~/.claude/skills/llm-council
```

Va en `skillOverrides` como `"name-only"` (ya está en `claude-settings.json`): su descripción se dispara con "¿cuál elijo?" y cada consulta lanza 11 subagentes. Se usa diciendo "pásalo por el consejo", solo en decisiones caras de revertir.

No se llevan por defecto (personales, no de trabajo): skills de LinkedIn (`li-*`) y de SEO (`seo-*`). Solo si el usuario las pide.

## Paso 5. Servidores MCP

| Servidor | Instalación | Manda datos fuera |
|---|---|---|
| **leo-mcp** (grafo de llamadas con `fichero:línea`, `impact`, `guard`, `get_context`) | Ver abajo | No: sin LLM ni claves, índice en la caché del usuario |
| codegraph (alternativa, solo si leo-mcp no se puede usar) | `npm i -g @colbymchenry/codegraph` y `claude mcp add --scope user codegraph -- codegraph serve --mcp`; en cada repo, `codegraph init -i` | No, índice local |
| pencil (diseño `.pen`) | Solo si se instala la app Pencil; la app registra su propio MCP | Según la app |

Un solo servidor de grafo: leo-mcp o codegraph, nunca los dos (duplican herramientas y contexto).

**leo-mcp, a nivel de usuario** (no escribe nada en los repositorios de la empresa):
1. `uv tool install leo-mcp` (sin uv: `pip install leo-mcp`, Python 3.11 o superior). Comprueba con `leo-mcp doctor`.
2. Claude Code: `claude mcp add --scope user leo-mcp -- leo-mcp`. No uses `leo-mcp init` dentro de un repositorio de la empresa: escribe `.mcp.json` y `.claude/settings.json` en él.
3. Aviso antes de editar (hook `PreToolUse`, nunca bloquea): ejecuta `leo-mcp init --client claude` en una carpeta temporal vacía, copia la entrada `hooks.PreToolUse` que imprime (`matcher: "Edit|Write"`, comando `<python> -m leo_code.guard_hook`) a `~/.claude/settings.json` y borra la carpeta. Calla en repos sin índice.
4. Otros agentes: registra el comando `leo-mcp` como servidor MCP stdio en la configuración **de usuario** del agente.
5. Índice: lo crea solo el hook `leo-indice.mjs` al abrir sesión (en otros agentes, `leo-mcp index` la primera vez en cada repo). Va a la caché del usuario, no al repo.

## Paso 6. Verificar e informar

1. Reinicia el agente y comprueba: `claude plugin list`, `claude mcp list`, y que la sesión arranca con los hooks de caveman y ponytail sin error.
2. Pide una tarea trivial y mira que responde en español, corto, y que un commit sale sin coautoría.
3. Auditoría de la configuración con AgentShield, una vez y solo en modo estático (sin `--opus`, que manda datos fuera; sin `--fix` ni `--sandbox`, que tocan o ejecutan la configuración). Versión fija en una carpeta aparte: `npm i --ignore-scripts ecc-agentshield@1.6.0` y `npx agentshield scan --path <copia>`. La 1.6.0 falla con un enlace (junction) dentro de `~/.claude` (`EISDIR`): escanea una copia hecha con `cp -rL` de `settings.json`, `CLAUDE.md`, `agents/` y `skills/`. Casi todo lo que marca es la plantilla "Missing prompt defense" en cada `.md`; lo que importa son los apartados `permissions`, `hooks`, `mcp` y `secrets`. Una máquina de empresa debería salir con lista `deny` (secretos, `.env`, `git push --force`) y sin `defaultMode` que salte confirmaciones.
4. Informe: qué se instaló, qué no y por qué (política, agente sin soporte, falta `node` o `pwsh`), y qué choca con las normas de la empresa.
