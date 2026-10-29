export type Heavy = { label: string; tokens: number }
export type TurnRow = {
  at: number
  prompt: string
  agent: boolean
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  usd: number
  heavy: Heavy | null
}

declare module 'claude-code' {
  interface PluginState {
    rachunek: { rows: TurnRow[]; prompt: string; heavy: Heavy | null }
  }
}
