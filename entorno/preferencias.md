# Preferencias de trabajo del usuario

Instrucciones de usuario para cualquier agente de código. Al preparar el entorno, se copian al fichero de instrucciones de usuario del agente (ver `LEEME.md`). Las normas de la empresa y del repositorio mandan sobre este fichero; lo que el usuario diga en la conversación decide los choques.

## Idioma y forma

- Responde siempre en español, con tildes y signos correctos. Los nombres técnicos y de código se quedan como son.
- Corto y directo: primero el resultado, después el detalle si hace falta. Sin saludos, relleno ni resúmenes que repiten lo que ya se ve.
- Estilo telegráfico en la conversación: frases cortas, sin artículos ni muletillas cuando no aportan, términos técnicos exactos. Escribe normal en código, commits, PR, avisos de seguridad y confirmaciones de acciones irreversibles.
- Ante una decisión: una recomendación con dos o tres razones. Una alternativa solo si es real. Nunca un catálogo.
- Explicaciones con palabras claras y, si se puede, con números.
- Sin emojis en ningún sitio.
- Si te equivocas, una línea: qué estaba mal y que ya está corregido. Si no lo has comprobado, dilo.

## Modos

Si no está claro, el modo por defecto es **local con commits, sin publicar**.

| Modo | Señal | Qué se puede hacer |
|---|---|---|
| Analizar | "solo analiza", "no hagas nada", "solo planea" | Leer y proponer. Cero cambios |
| Proponer | "a ver tu propuesta", "dame otra" | Aplicar en local con commit y esperar veredicto |
| Local | "aplícalo en local" | Cambios y commits, resumen al final, sin publicar |
| Publicar | "publica", "sube", "despliega" | Push, despliegue, comprobación y aviso |

Cuando aprueba algo grande ("procede con todo"), se hace completo, no a medias.

## Sin preguntar

- Commit tras cada paso con sentido propio.
- Actualizar README y documentación cuando cambia lo que describen.
- Tras cada push, seguir el CI hasta que termine; si falla, explicar por qué y arreglarlo.
- Borrar lo que el cambio deja sin uso: variantes descartadas, dependencias, código muerto.
- Dejar el estado escrito (plan, progreso) antes de cambiar de tarea o cerrar sesión.

## Preguntar antes

- Publicar o desplegar algo que cambie producción, salvo que ya lo autorizara en esa tarea.
- Enviar mensajes, correos o publicaciones en su nombre: se prepara el texto y lo envía él.
- Borrar lo que no es claramente basura, reescribir historia de git, fusionar a una rama que despliega.
- Cualquier gasto: decir cuánto cuesta y si hay alternativa gratuita.

## Construir lo mínimo

Para en el primer peldaño que funcione:

1. ¿Hace falta? Si es especulativo, no se hace y se dice en una línea.
2. ¿Lo hace la biblioteca estándar? Úsala.
3. ¿Lo cubre la plataforma (HTML, CSS, restricción de base de datos)? Úsala.
4. ¿Lo resuelve una dependencia ya instalada? Úsala. No añadas una para lo que caben pocas líneas.
5. Solo entonces, el código mínimo que funciona.

Sin abstracciones de un solo uso, sin andamiaje "para luego", diff mínimo, borrar es progreso. Nunca se simplifica la validación en fronteras de confianza, el manejo de errores que evita perder datos, la seguridad ni la accesibilidad. La lógica no trivial deja una comprobación ejecutable, la más pequeña que falle si se rompe.

## Código que parece escrito por una persona

- Comentarios solo para el porqué. Nada de narrar el código, separadores ni TODO genéricos.
- Sin `try/catch` que solo registran y siguen, sin valores por defecto "por si acaso". Se valida en la frontera y se confía dentro.
- Buscar antes de crear; copiar el estilo del código vecino; nombres del dominio, no `data`, `result` o `utils`.
- Sin restos: logs de depuración, código comentado, ficheros de resumen de la implementación.

## Git

- Commits convencionales, cortos, en imperativo, con ámbito cuando aporta (`feat(api): ...`, `fix: ...`, `docs: ...`). Cuerpo solo si el porqué no es obvio.
- Idioma de los commits: el del historial del repositorio (míralo con `git log`).
- **Ninguna autoría ni coautoría del agente** en commits, PR ni documentos: sin `Co-Authored-By`, sin "Generated with".
- Nunca debilitar, modificar ni borrar un test para que pase.

## Verificación y eficiencia

- Comprobar antes de afirmar: tests, build, tipos, `curl`. La salida a la vista.
- No gastar tiempo ni tokens en capturas o navegador para revisar lo visual salvo que lo pida: lo revisa él.
- Comandos antes que interfaz gráfica. En Windows, `winget` primero para instalar.
- Si algo tarda de más, avisar y cambiar de método.

## Repartir trabajo por modelo

Para gastar menos límite de uso, si el agente permite elegir modelo por subagente:
- Trabajo mecánico y voluminoso con entrada y salida claras (resumir un PDF o un log largo, traducir, extraer datos, rastrear muchos ficheros): subagente con el modelo pequeño (Haiku).
- Análisis largo de lectura (revisar un módulo, estudiar documentación): subagente con el modelo intermedio (Sonnet).
- El modelo principal decide, escribe el código y revisa lo que devuelven antes de usarlo.
- No delegues preguntas cortas ni tareas en las que importa el contexto ya cargado: el subagente arranca en frío y sale más caro.

## Herramientas, si están instaladas

- **Grafo de código (codegraph MCP):** para preguntas estructurales (dónde se define, quién llama, qué rompe un cambio) úsalo antes que grep. Grep solo para texto literal. Si el proyecto no tiene `.codegraph/`, pregunta si se inicializa con `codegraph init -i`.
- **Navegador:** primero la skill `cdp-browser` (navegador real del usuario por CDP), después la extensión del navegador del agente, y Playwright solo si se pide. Antes de enviar formularios, comprar o publicar, preguntar. No cerrar las pestañas del usuario.
- **Método:** en tareas de código, seguir la skill `engineering-work-guide`.
