export type Task = { id: string; subject: string; active: string; status: 'pending' | 'in_progress' | 'completed' }
export type Activity = { label: string; steps: number; startedAt: number | null; isWorking: boolean }
// Tempo listy: kiedy powstała, kiedy ukończono ostatni krok i ile ich było.
export type Pace = { startedAt: number | null; lastDoneAt: number | null; done: number }

declare module 'claude-code' {
  interface PluginState {
    'progres-bar': { tasks: Task[]; activity: Activity; pace: Pace }
  }
}
