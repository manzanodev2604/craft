import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Mejoras } from '../types'

const mejoras = atom({ plugin: 'prompt-mejorado', key: 'mejoras' } as const, {} as Mejoras)

const SISTEMA = `Reescribe el mensaje que un usuario ha enviado a un agente de programación como un prompt claro y completo.
- Mismo idioma que el original.
- Conserva la intención exacta. No añadas requisitos, datos ni decisiones que el usuario no haya dado.
- Ordena en: objetivo; contexto que se deduce del mensaje; restricciones; cómo saber que está bien.
- Lo que falte y cambie el resultado, márcalo como [FALTA: qué].
- Máximo 120 palabras. Devuelve solo el prompt, sin comillas ni explicación.`

const MAX_GUARDADAS = 30

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    const isUsers = e.origin.kind === 'composer' && !e.command && !e.isMeta
    if (!isUsers || e.text.trim().length < 15) return result

    // Sin await: el turno no espera a Haiku; la fila se redibuja cuando llega.
    void $.model
      .complete({ model: 'haiku', system: SISTEMA, prompt: e.text, effort: 'low', maxTokens: 400, timeoutMs: 30000 })
      .then(async r => {
        if (!r.isAnswered) {
          $.ui.log(`prompt-mejorado: sin respuesta (${r.reason})`, { to: 'debug' })
          return
        }
        await update($, mejoras, prev => {
          const keys = Object.keys(prev).slice(-(MAX_GUARDADAS - 1))
          return Object.fromEntries([...keys.map(k => [k, prev[k] ?? '']), [e.text, r.text.trim()]])
        })
      })
    return result
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const row = await next(e)
    const mejora = (await read($, mejoras))[e.props.text]
    if (!mejora) return row
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {row}
        <Box paddingLeft={2}>
          <Text color="gray" dimColor>{`↳ ${mejora}`}</Text>
        </Box>
      </Box>
    )
  })
}
