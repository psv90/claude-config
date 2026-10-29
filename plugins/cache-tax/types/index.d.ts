export type LogEntry = { at: number; kind: 'warm' | 'stop' | 'warm-failed'; tokens: number; usd: number }

declare module 'claude-code' {
  interface PluginState {
    'cache-tax': {
      lastReplyAt: number | null
      model: string | null
      isWorking: boolean
      warmups: number
      stoppedFor: number | null
    }
  }
}
