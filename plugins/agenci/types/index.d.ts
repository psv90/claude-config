// Jeden agent na pasku: dane z $.agent.list() plus to, co mod dopisał sam.
export type AgentRow = {
  id: string
  type: string
  description: string
  status: 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'
  startedAt: number
  endedAt: number | null
  label: string
}

declare module 'claude-code' {
  interface PluginState {
    agenci: { rows: AgentRow[] }
  }
}
