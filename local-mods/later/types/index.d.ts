// `chat`: the desktop app's id (`local_…`) of the chat the prompt was saved in.
export type Note = { text: string; at: number; chat?: string }
export type Groups = Record<string, Note[]>

declare module 'claude-code' {
  interface PluginState {
    later: {
      count: number
      first: string
      groups: Groups
      selected: string
      confirm: string
      addingGroup: boolean
      confirmAll: boolean
      // Which clear waits for its in-place confirmation: '' none, 'group' the shown group, 'all' every group.
      confirmClear: '' | 'group' | 'all'
      draining: string
    }
  }
}
