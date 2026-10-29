export type Note = { file: string; name: string; description: string; folder: string; body: string }
export type Index = Record<string, Note>

declare module 'claude-code' {
  interface PluginState {
    'pamiec-projektu': { index: Index; projects: string; project: string | null; isOpen: boolean; dismissed: string[] }
  }
}
