export type Pair = { jobs: string; done: string; total: number; finished: number; wordsLeft: number | null; next: string | null }
export type Progress = { name: string; dir: string; pairs: Pair[]; summary: string; hasStyle: boolean; isCounting: boolean }

declare module 'claude-code' {
  interface PluginState {
    spolszczacz: { progress: Progress | null }
  }
}
