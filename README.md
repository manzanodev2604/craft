# engineering-work-guide

Skill de método de trabajo para agentes de código: normas del repositorio primero, citar `fichero:línea`, pruebas antes que código, parar ante acciones irreversibles y decir qué no se comprobó. Ver `SKILL.md`.

## Instalar

Git bash, Linux o Mac:

```bash
git clone --depth 1 https://github.com/manzanodev2604/engineering-work-guide ~/.claude/skills/engineering-work-guide
```

PowerShell:

```powershell
git clone --depth 1 https://github.com/manzanodev2604/engineering-work-guide "$HOME\.claude\skills\engineering-work-guide"
```

Actualizar: `git -C ~/.claude/skills/engineering-work-guide pull`

## Activar

Añade al `AGENTS.md` o `CLAUDE.md` del proyecto:

> Antes de empezar, lee y sigue `~/.claude/skills/engineering-work-guide/SKILL.md`; las normas de este repositorio mandan sobre ella.

## Llevar mi entorno a otra máquina

Tras instalar la skill, pide al agente:

> Prepara mi entorno siguiendo `~/.claude/skills/engineering-work-guide/entorno/LEEME.md`.

El agente comprueba la política de la empresa, detecta qué agente hay (Claude Code, Codex, Cursor, Copilot, opencode, Gemini CLI), enseña la lista de lo que va a instalar y, con tu sí, instala preferencias, plugins, skills, servidores MCP y ajustes. Contenido en `entorno/`.

Las normas de la empresa y del repositorio mandan sobre esta skill.
