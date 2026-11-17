---
name: trabajo-diario
description: Use for everyday office work with text the user pastes or points to, such as turning a meeting transcript or notes into minutes, action items or a follow-up, catching up on a long email or chat thread, comparing two versions of a document, or drafting an email, status report, proposal or presentation for a given audience. Spanish triggers include acta, reunión, transcripción, hilo, correo, me han metido en este hilo, qué tengo que hacer yo, ponme al día, qué ha cambiado, versión anterior, redacta, informe, presentación para dirección. Not for code, data pipelines or repository work.
---

# Trabajo diario

Cuatro tareas de oficina con IA y las reglas que evitan sus fallos típicos. Dos reglas valen para todas:

- **Cita la fuente.** Cada decisión, fecha, cifra o petición lleva el fragmento literal de donde sale (transcripción, correo, apartado del documento). Así el usuario lo comprueba en segundos.
- **No rellenes huecos.** Si falta un dato, escribe `[FALTA: qué dato y a quién pedirlo]`. Un documento con un número inventado es peor que uno con un hueco marcado.

Si el material no está en la conversación, búscalo con las herramientas que haya (correo, Drive, ficheros) antes de pedirlo.

## 1. Acta de una reunión

Entrada: transcripción o notas.

1. **Decisiones**: solo lo que alguien acordó y nadie discutió después. Cita el fragmento.
2. **Tareas**: responsable y fecha solo si se dijeron y se aceptaron. Un "igual lo tenemos para el viernes" sin confirmar no es una tarea con fecha: va a pendientes.
3. **Pendientes para la próxima reunión**: lo propuesto sin cerrar, las preguntas sin respuesta y las fechas al aire, cada uno con su fragmento.
4. Si una tarea no tiene responsable claro, dilo; no se lo asignes a nadie.

## 2. Ponerse al día en un hilo largo

Entrada: hilo de correo o chat.

1. **Qué me piden a mí**, con quién lo pide y para cuándo, primero.
2. **Decisión vigente**: la última que nadie ha contradicho, con el mensaje de donde sale. Si el hilo no llega a decidir, dilo.
3. **Qué ha cambiado** respecto al planteamiento inicial, en una línea por cambio.
4. Fechas y cifras, cada una con su mensaje.

## 3. Qué ha cambiado entre dos versiones

Entrada: versión anterior y nueva de un documento.

Por cada cambio: apartado, cómo era, cómo queda, qué implica y si conviene revisarlo (por qué). Ordena por importancia, no por posición. Ignora cambios de formato salvo que alteren el sentido. Al final, lo que no se puede comparar (tablas como imagen, anexos que faltan).

## 4. Redactar para alguien

Entrada: ideas o notas del usuario y a quién va dirigido.

1. **El contenido lo decide el usuario.** Si de las notas no se deduce qué quiere decir, pregunta antes de redactar; no decidas por él.
2. **Según quién lo recibe:**
   - Dirección: qué cambia, cuánto cuesta, qué riesgo hay y qué decisión se pide, en ese orden y al principio.
   - Equipo técnico: detalle, supuestos y cómo se comprueba.
   - Alguien que no conoce el proyecto: primero para qué sirve, después cómo funciona.
3. Correos: breves, una petición clara por correo, en el tono que pida. Nunca los envíes: deja el borrador.
4. Si una tabla o un gráfico lo explica mejor, propónlo con los datos reales; no inventes datos para que el gráfico quede bien.

## Automatizar una tarea que se repite

Si la misma tarea se repite (cada semana el mismo fichero con los mismos pasos), propón automatizarla: pide un ejemplo de entrada, otro de cómo debe quedar y las reglas. Haz el script, compruébalo con ese ejemplo y después con una variación. Solo compensa si se repite a menudo; para una vez, hazla y ya.
