# Preparar el entorno del usuario en una máquina nueva

Procedimiento para que el agente deje en otra máquina la misma configuración que el usuario usa en la suya: preferencias, plugins, skills, servidores MCP y ajustes. Se sigue **solo cuando el usuario lo pide** ("prepara mi entorno", "instala mi configuración").

## Qué hay en esta carpeta

| Fichero | Para qué |
|---|---|
| `preferencias.md` | Cómo trabaja y quiere que se le responda. Va al fichero de instrucciones de usuario del agente |
| `claude-settings.json` | Ajustes de Claude Code que se fusionan con `~/.claude/settings.json` |
| `statusline.ps1` | Línea de estado de Claude Code (necesita PowerShell 7, `pwsh`): contexto sobre la ventana de autocompactado (`$CTX_SIZE`, 300.000, igual que `modelSettings.autoCompactWindow`; si cambias uno, cambia el otro), uso de 5 horas con tiempo restante y hora local del reinicio, y uso de 7 días |
| `hooks/titulo-sesion.mjs` | Hook de Claude Code: si la sesión empieza solo con `/craft`, la titula con la carpeta y después con el objetivo, nunca con el nombre de la skill (necesita `node`; comprobación: `node titulo-sesion.mjs --test`) |
| `hooks/craft-siempre.mjs` | Hook de Claude Code: carga esta guía entera al abrir la sesión (y tras compactar) y recuerda en cada mensaje que está activa, sin depender de que el modelo la elija (necesita `node`; comprobación: `node craft-siempre.mjs --test`). En otros agentes, sin hooks, hace falta la línea de activación en su fichero de instrucciones de usuario (ver `README.md`), nunca en el del repositorio |
| `skills-por-tarea.md` | Mapa tarea → skill que `craft-siempre.mjs` añade a la guía al abrir sesión. Permite dejar casi todas las skills en `"name-only"` (sin descripción en cada petición) sin que el agente deje de saber cuándo usarlas. Al instalar o quitar una skill, actualiza su fila |
| `hooks/leo-indice.mjs` | Hook de Claude Code: al abrir sesión en un repo git, lanza `leo-mcp index` en segundo plano para que el aviso antes de editar funcione desde el primer cambio (no bloquea; sin leo-mcp no hace nada) |
| `hooks/git-guarda.mjs` | Hook de Claude Code antes de cada comando: bloquea commits y push que lleven ficheros del agente o borradores (`CLAUDE.md`, `AGENTS.md`, `.mcp.json`, `.claude/`, `.craft/`), `git add -A`/`.`, `--no-verify` y `push --force` a la rama principal; pide confirmación en todo push, PR o fusión. Excepción por repo: `git config craft.subirAgente true`. Comprobación: `node git-guarda.mjs --test`. Ver `references/equipo-y-git.md` |
| `git-ignore-global` | Se añade a `~/.config/git/ignore`: lo mismo queda fuera de `git status` en cualquier repo sin tocar su `.gitignore` |
| `skills/trabajo-diario/` | Skill propia de oficina: actas que solo dan por decidido lo acordado, ponerse al día en hilos, comparar versiones de un documento y redactar según quién lo recibe; siempre citando la fuente y marcando `[FALTA]` en vez de inventar. Se carga sola |
| `mods/prompt-mejorado/` | Mod de Claude Code: tras cada mensaje del usuario, Haiku lo reescribe como prompt claro (objetivo, contexto, restricciones, cómo saber que está bien; `[FALTA]` en lo que no se dijo) y lo muestra en gris debajo. Solo se ve: el modelo trabaja con el texto original. Una llamada a Haiku por mensaje de 15 caracteres o más |
| `skills/cdp-browser/` | Skill propia de automatización del navegador real por CDP (Windows, Node 22+). Las reglas de WhatsApp usan los scripts de `~/Desktop/hands` (repositorio privado del usuario, no incluido en craft): sin él, esas reglas no aplican |

## Paso 0. Antes de instalar nada

1. **Normas de la empresa.** Busca política sobre herramientas de IA permitidas, extensiones, servidores MCP y datos que salen de la red. Si prohíbe algo de la lista, no se instala y se dice.
2. **Detecta el agente** y su versión: Claude Code (`claude --version`), Codex (`codex --version`), Cursor, GitHub Copilot, opencode, Gemini CLI u otro.
3. **Presenta el plan** con la tabla del paso 5 rellena (qué se instala, de dónde, qué manda fuera) y pide un sí. Instalar descarga código de internet: es una acción hacia fuera (parada 4 de `SKILL.md`).
4. Copia de seguridad de lo que vayas a sobrescribir (`settings.json` → `settings.json.bak`).

## Paso 0b. Programas (Windows)

Con `winget`. Instala lo imprescindible; lo probable, solo si el trabajo lo pide. Antes, el paso 0: si la empresa no permite un agente que envía código fuera (red cerrada, datos de clientes, defensa), no se instala Claude Code ni nada que llame a servicios externos sin su permiso.

**Imprescindibles** (craft y desarrollo en Python):

```
winget install -e --id Git.Git
winget install -e --id GitHub.cli
winget install -e --id Python.Python.3.12
winget install -e --id astral-sh.uv
winget install -e --id OpenJS.NodeJS.22
winget install -e --id Microsoft.PowerShell
winget install -e --id BurntSushi.ripgrep.MSVC
winget install -e --id Microsoft.VisualStudioCode
winget install -e --id Brave.Brave
wsl --install
winget install -e --id Docker.DockerDesktop
code --install-extension ms-python.python
code --install-extension ms-python.vscode-pylance
code --install-extension ms-toolsai.jupyter
code --install-extension eamodio.gitlens
```

Si el repositorio está en GitLab, `glab` (`winget install -e --id GLab.GLab`) en lugar de `gh`. Si la empresa usa Chrome, `Google.Chrome` en lugar de Brave. leo-mcp va en el paso 5.

**Probables** (según el proyecto):

| Programa | Cuándo | Instalación |
|---|---|---|
| Ollama | Modelos de pesos abiertos en local | `winget install -e --id Ollama.Ollama` |
| DBeaver Community | Bases de datos SQL | `winget install -e --id DBeaver.DBeaver.Community` |
| Remote SSH y Dev Containers | Trabajo en servidores o contenedores | `code --install-extension ms-vscode-remote.remote-ssh` y `ms-vscode-remote.remote-containers` |
| REST Client | Probar APIs | `code --install-extension humao.rest-client` |
| k6 | Pruebas de carga de un servicio (ver `references/verificacion.md`, apartado 9) | `winget install -e --id GrafanaLabs.k6` |

**No instalar sin permiso** en el equipo de la empresa: herramientas de captura de red, gestores de máquinas virtuales y otros agentes de IA además del permitido.

## Paso 0c. Identidad de git y cuentas

Los commits del trabajo van con la identidad de la empresa, nunca con la cuenta personal.
1. Pregunta al usuario su nombre y su correo de la empresa; no los supongas.
2. `git config --global user.name "<nombre>"` y `git config --global user.email "<correo de la empresa>"`. Si en la máquina conviven repos personales, ponlos solo en esos repos con `git config` local.
3. Ajustes de equipo: `git config --global pull.ff only`, `git config --global fetch.prune true` (borra las referencias de ramas ya eliminadas del remoto) y `git config --global init.defaultBranch main`.
4. Acceso al servidor de la empresa (GitHub, GitLab u otro): lo inicia el usuario, no el agente, porque pide credenciales. Sugiere `! gh auth login` o `! glab auth login` según el servidor. Sin cuentas personales en esa máquina.
5. Comprueba: `git config --global --get user.email` y `gh auth status` (o `glab auth status`).

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
claude plugin install security-guidance@claude-plugins-official
claude plugin install frontend-design@claude-plugins-official
```

Mods propios de craft (marketplace local en `entorno/mods`):

```
claude plugin marketplace add ~/.claude/skills/craft/entorno/mods
claude plugin install prompt-mejorado@craft-mods --scope user
```

Opcional, solo si el trabajo usa Vercel: `claude plugin install vercel@claude-plugins-official`, desactivado a nivel de usuario (`"vercel@claude-plugins-official": false`) y activado solo en el `.claude/settings.local.json` de los proyectos que lo usan: son 37 skills, unos 11.000 caracteres de contexto en cada mensaje.

Cada skill visible cuesta contexto en todos los mensajes, se use o no. Las que solo quieras invocar a mano con `/nombre` van en `skillOverrides` como `"user-invocable-only"`; `/skill-doctor` muestra cuánto cuesta cada una y cuáles no se usan nunca.

| Plugin | Qué aporta | Hooks / red |
|---|---|---|
| security-guidance | Avisos de seguridad al editar | Hook en edición |
| frontend-design | Diseño de interfaces con criterio | No |

**Sin superpowers, caveman ni ponytail** (quitados el 20/11/2026): sumaban 91 skills y 9 agentes a cada petición y se usaban muy poco. Su método ya está en craft y su estilo en `preferencias.md` («Idioma y forma» y la escalera de lo mínimo).

## Paso 3. Ajustes (Claude Code)

1. Fusiona `claude-settings.json` con `~/.claude/settings.json`: las claves del fichero ganan, las demás se conservan. No copies permisos ni modos que salten confirmaciones; en una máquina de empresa los decide el usuario.
2. Ignorado global de git: `mkdir -p ~/.config/git && cat entorno/git-ignore-global >> ~/.config/git/ignore` (si `git config --global core.excludesFile` apunta a otro fichero, añádelo a ese). Comprueba con `git check-ignore -v .craft/x` dentro de cualquier repo.
3. El hook de título y `git-guarda` ya van en `claude-settings.json` y apuntan a la skill instalada en `~/.claude/skills/craft`; si la skill está en otra ruta, ajusta las rutas de `hooks`.
4. Copia `statusline.ps1` a `~/.claude/statusline.ps1` y pon en `statusLine.command` la **ruta absoluta** (Windows no expande `~` ahí). Sin `pwsh`, quita `statusLine`.

## Paso 4. Skills

Skills públicas, con la CLI `skills` (instala para varios agentes; confirma las opciones con `npx skills add --help`):

```bash
npx skills add anthropics/skills --skill frontend-design -g
npx skills add pbakaus/impeccable -g
```

Skills de ingeniería de terceros, en `skillOverrides` como `"name-only"` (ya en `claude-settings.json`): el agente sabe cuándo invocarlas por el mapa `skills-por-tarea.md`, que el hook de craft carga al abrir sesión:

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

No se llevan (sin uso en 30 días al medirlo el 20/11/2026; cada skill, agente o plugin instalado suma tokens a cada petición): `pr-review-toolkit` (el `/code-review` integrado lo cubre), `commit-commands`, `find-skills`, `tailwind-design-system`, `web-design-guidelines`. Tampoco se llevan por defecto (personales, no de trabajo): skills de LinkedIn (`li-*`) y de SEO (`seo-*`). Solo si el usuario las pide.

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

## Paso 5b. Escritorio (Windows)

El usuario quiere el escritorio limpio: solo accesos directos a carpetas de `Documentos`, ningún fichero suelto. Estructura:

| Acceso directo | Carpeta | Contenido |
|---|---|---|
| Proyectos | `Documentos\Proyectos` | `Activos`, `En pausa` y `Archivo`; cada repositorio en una de ellas |
| Programas | `Documentos\Programas` | Instaladores por categoría: `Desarrollo`, `Navegadores`, `Productividad`, `Utilidades`, `Multimedia`, `Fuentes` |
| Documentación | `Documentos\Documentación` | Contrato, acuerdos y documentos de la empresa |

Crea lo que falte, sin tocar lo que ya exista (`New-Item -Force` sobre una carpeta no borra nada):

```powershell
$doc = [Environment]::GetFolderPath('MyDocuments'); $esc = [Environment]::GetFolderPath('Desktop'); $sh = New-Object -ComObject WScript.Shell
$carpetas = @{ 'Proyectos' = 'Activos','En pausa','Archivo'; 'Programas' = 'Desarrollo','Navegadores','Productividad','Utilidades','Multimedia','Fuentes'; 'Documentación' = @() }
foreach ($c in $carpetas.Keys) {
  foreach ($s in $carpetas[$c]) { New-Item -ItemType Directory -Force (Join-Path $doc "$c\$s") | Out-Null }
  New-Item -ItemType Directory -Force (Join-Path $doc $c) | Out-Null
  $l = Join-Path $esc "$c.lnk"
  if (-not (Test-Path $l)) { $a = $sh.CreateShortcut($l); $a.TargetPath = Join-Path $doc $c; $a.Save() }
}
```

Si el escritorio ya tiene ficheros, propón a qué carpeta va cada uno y pide un sí antes de moverlos. Los instaladores que se descarguen durante el paso 0b, a su categoría de `Programas`.

## Paso 6. Verificar e informar

1. Reinicia el agente y comprueba: `claude plugin list`, `claude mcp list`, y que la sesión arranca con el hook de craft sin error.
2. Pide una tarea trivial y mira que responde en español, corto, y que un commit sale sin coautoría.
3. Comprueba la protección de git: `node ~/.claude/skills/craft/entorno/hooks/git-guarda.mjs --test` da `ok`, y en un repositorio de prueba `git check-ignore -v .craft/x` muestra el ignorado global.
4. Auditoría de la configuración con AgentShield, una vez y solo en modo estático (sin `--opus`, que manda datos fuera; sin `--fix` ni `--sandbox`, que tocan o ejecutan la configuración). Versión fija en una carpeta aparte: `npm i --ignore-scripts ecc-agentshield@1.6.0` y `npx agentshield scan --path <copia>`. La 1.6.0 falla con un enlace (junction) dentro de `~/.claude` (`EISDIR`): escanea una copia hecha con `cp -rL` de `settings.json`, `CLAUDE.md`, `agents/` y `skills/`. Casi todo lo que marca es la plantilla "Missing prompt defense" en cada `.md`; lo que importa son los apartados `permissions`, `hooks`, `mcp` y `secrets`. Una máquina de empresa debería salir con lista `deny` (secretos, `.env`, `git push --force`) y sin `defaultMode` que salte confirmaciones.
5. Informe: qué se instaló, qué no y por qué (política, agente sin soporte, falta `node` o `pwsh`), y qué choca con las normas de la empresa.
