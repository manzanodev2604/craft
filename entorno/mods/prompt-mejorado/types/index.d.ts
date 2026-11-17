export type Mejoras = Readonly<Record<string, string>>

declare module 'claude-code' {
  interface PluginState {
    'prompt-mejorado': { mejoras: Mejoras }
  }
}
