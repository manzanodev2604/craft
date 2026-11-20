## Skills por tarea

Muchas skills están en modo «solo nombre» (`skillOverrides: name-only`) para no cargar su descripción en cada petición. Cuando la tarea encaje con una fila, invócala por su nombre con la herramienta Skill antes de empezar, aunque no veas su descripción. Si no está instalada, sigue sin ella y dilo.

| Si la tarea... | Skill |
|---|---|
| Usa el navegador: leer, navegar, rellenar, capturas | `cdp-browser`; si falla, `claude-in-chrome` |
| Toca seguridad: autenticación, entrada de usuario, SQL, secretos, permisos, dependencias | `security-audit` |
| Diseña o pule una interfaz | `impeccable` (crítica, pulido, accesibilidad); `frontend-design:frontend-design` (diseño nuevo) |
| Diseña una API, un contrato entre módulos o una interfaz pública | `api-and-interface-design` |
| Añade logs, métricas, trazas o alertas | `observability-and-instrumentation` |
| Hace un gráfico o un panel | `dataviz` |
| Usa la API de Claude o el SDK de Anthropic | `claude-api` |
| Trabajo de oficina con texto: actas, correos, hilos, informes | `trabajo-diario` |
| Pide un fichero Word, PDF, Excel o PowerPoint | `anthropic-skills:docx`, `pdf`, `xlsx`, `pptx` |
| Decisión difícil que conviene ver desde varios ángulos | `llm-council` |
| LinkedIn: publicaciones, perfil, mensajes, comentarios | `li-post`, `li-profile`, `li-dm`, `li-comment`, `li-reply`, `li-inbox`, `li-plan`, `li-audit`, `li-carousel`, `li-repurpose`, `li-human` |
| Cambia la interfaz o el comportamiento de Claude Code (mods, hooks de plugin) | `plugin-authoring` |
| Cambia ajustes de Claude Code: permisos, hooks, variables | `update-config` |
| Revisa o simplifica un cambio | `code-review`, `simplify` |
| Arranca la aplicación para ver un cambio funcionando | `run` |

SEO (`seo-*`) está apagado (`off`): actívalo en `skillOverrides` solo si el usuario lo pide.
