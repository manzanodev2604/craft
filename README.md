# craft

Skill de método de trabajo para agentes de código: normas del repositorio primero, citar `fichero:línea`, pruebas antes que código, parar ante acciones irreversibles, lo del agente y los borradores nunca se suben, y decir qué no se comprobó. Ver `SKILL.md`.

## Primera vez en un equipo

1. **Lee antes la política de la empresa** sobre herramientas de IA y repositorios públicos. Si no permite un agente que envía código fuera o clonar de GitHub, para aquí y pregunta.
2. **Requisitos mínimos:** `git`, `node` (22 o superior, para los hooks) y el agente instalado. En Windows, si falta alguno:

   ```powershell
   winget install -e --id Git.Git; winget install -e --id OpenJS.NodeJS.22
   ```

3. **Clona la skill.** Git Bash, Linux o Mac:

   ```bash
   git clone --depth 1 https://github.com/manzanodev2604/craft ~/.claude/skills/craft
   ```

   PowerShell:

   ```powershell
   git clone --depth 1 https://github.com/manzanodev2604/craft "$HOME\.claude\skills\craft"
   ```

4. **Abre el agente en cualquier carpeta que no sea un repositorio de la empresa** (por ejemplo, la carpeta personal) y pídele:

   > Prepara mi entorno siguiendo `~/.claude/skills/craft/entorno/LEEME.md`.

   El agente lee la política de la empresa, detecta qué agente hay (Claude Code, Codex, Cursor, Copilot, opencode, Gemini CLI), te enseña la lista de lo que va a instalar y, con tu sí, instala programas, identidad de git, preferencias, plugins, skills, servidores MCP, hooks y ajustes. Al final reinicia, comprueba e informa de lo que no pudo hacer.
5. **Reinicia el agente.** Desde ese momento, en Claude Code craft se carga sola en cada sesión (hook `craft-siempre.mjs`) y el hook `git-guarda.mjs` impide subir ficheros del agente o borradores. No hace falta activarla en cada proyecto.

## En otros agentes

Sin hooks, craft no se carga sola. Añade esta línea al fichero de instrucciones **de usuario** del agente (por ejemplo, `~/.codex/AGENTS.md`), nunca al del repositorio, que no se sube:

> Antes de empezar, lee y sigue `~/.claude/skills/craft/SKILL.md`; las normas de este repositorio mandan sobre ella.

## Actualizar

`git -C ~/.claude/skills/craft pull`. Los hooks y las referencias se aplican en la siguiente sesión; si cambió `entorno/claude-settings.json`, pide al agente que vuelva a fusionarlo (paso 3 de `entorno/LEEME.md`).

## Qué no incluye

Lo privado del usuario no está en este repositorio: memorias del agente, scripts de WhatsApp (`~/Desktop/hands`), credenciales y cuentas. Las cuentas (git, GitHub o GitLab de la empresa) se configuran en la máquina, en el paso 0c de `entorno/LEEME.md`.

Las normas de la empresa y del repositorio mandan sobre esta skill.
