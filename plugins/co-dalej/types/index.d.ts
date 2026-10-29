export type Questions = string[]
/**
 * Propozycja, którą użytkownik pominął: ile razy, kiedy ostatnio i w którym
 * projekcie (ścieżka folderu sesji; brak = wpis sprzed podziału na projekty).
 */
export type Ignored = { text: string; misses: number; lastAt: number; project?: string }

/** Co się stało z propozycją; brak = jeszcze nic (przyciski wciąż na ekranie). */
export type Fate = 'wybrana' | 'pominieta' | 'zablokowana' | 'pozniej'
/** Jedna pokazana trójka propozycji: kiedy, w którym projekcie i los każdej z nich. */
export type Round = { at: number; project: string; items: { text: string; fate?: Fate }[] }

declare module 'claude-code' {
  interface PluginState {
    'co-dalej': {
      questions: Questions
      blocked: Ignored[]
      isConfirmingAll: boolean
      isRefreshing: boolean
      // Propozycje zaznaczone kółkiem ○/● do wysłania razem.
      picked: Questions
      // Historia pokazanych propozycji (najnowsze na końcu) i widok panelu.
      history: Round[]
      view: 'historia' | 'zablokowane'
    }
  }
}
