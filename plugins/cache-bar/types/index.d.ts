export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Usage = {
  contextPercent: number | null
  contextTokens?: number | null
  contextWindow?: number | null
  limits: Limit[]
}

declare module 'claude-code' {
  interface PluginState {
    'cache-bar': { lastReplyAt: number | null; usage: Usage | null }
  }
}
