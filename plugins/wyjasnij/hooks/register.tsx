// wyjasnij: tłumaczy po polsku, krok po kroku, co Claude właśnie zrobił,
// i za każdym razem uczy kilku nowych słów technicznych.
// Na podstawie github.com/ruthannbravo/explain-it (MIT).
// - Po turze, która zmieniła pliki albo coś uruchomiła, nad promptem pojawia się „Wyjaśnij”.
// - Prowadzi krótki dziennik tur, więc nowa sesja może podsumować poprzednią (/wyjasnij ostatnio).
// - Każde wyjaśnienie jest zapisywane: /wyjasnij historia.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Saved, Status, Turn } from '../types'

const PANE = 'wyjasnij'
const RECAP_MODEL = 'sonnet'

const status = atom({ plugin: 'wyjasnij', key: 'status' } as const, { kind: 'idle', message: '' })
const saved = atom({ plugin: 'wyjasnij', key: 'saved' } as const, [])
const viewing = atom({ plugin: 'wyjasnij', key: 'viewing' } as const, 0)
const hasChanges = atom({ plugin: 'wyjasnij', key: 'hasChanges' } as const, false)
const hasRecap = atom({ plugin: 'wyjasnij', key: 'hasRecap' } as const, false)
const didThings = atom({ plugin: 'wyjasnij', key: 'didThings' } as const, false)
const actions = atom({ plugin: 'wyjasnij', key: 'actions' } as const, [])
const prompt = atom({ plugin: 'wyjasnij', key: 'prompt' } as const, '')
const sessionStartedAt = atom({ plugin: 'wyjasnij', key: 'sessionStartedAt' } as const, 0)
const learnedCount = atom({ plugin: 'wyjasnij', key: 'learnedCount' } as const, 0)

const LEARNED_KEY = 'learned-terms'
const SAVED_KEY = 'saved-explanations'
const JOURNAL_KEY = 'journal'

const DOING_TOOLS = /^(Bash|PowerShell|Edit|Write|NotebookEdit|MultiEdit)$/

const FORMAT = `Użyj dokładnie tych nagłówków:

PODSUMOWANIE — jedno zdanie o tym, co się zmieniło.
KROKI — lista numerowana (1., 2., 3.…), jedno krótkie zdanie na krok.
WERSJA TECHNICZNA — te same kroki, z tymi samymi numerami i w tej samej kolejności, tak jak powiedziałby je programista, z prawdziwymi terminami. Każdy krok w jednej linii, w formie: 1. zdanie techniczne → po ludzku: krótka prosta wersja. Każdy termin techniczny w zdaniu technicznym (nazwy narzędzi, poleceń, plików, funkcji i pojęć) otocz pojedynczymi grawisami, np. \`commit\`.
DLACZEGO TO WAŻNE — jedno lub dwa zdania.
CZY MUSZĘ COŚ ZROBIĆ? — jasne tak/nie, a jeśli tak, to co.
SŁOWA DO NAUKI — 2-4 prawdziwe terminy techniczne z tej pracy, które usłyszałbym od programistów. Jeden na linię: termin — co znaczy w codziennych słowach — jak go tu użyto. Wybierz najprzydatniejsze, nie najbardziej egzotyczne.

Bez emoji. Najwyżej 400 słów. Opisuj tylko to, co naprawdę się stało. Pisz po polsku, zwracaj się do mnie w formie męskiej.`

const NOW_PROMPT = `Nie jestem programistą. Wyjaśnij krok po kroku, prostym językiem, co zrobiłeś w swojej ostatniej pracy w tej rozmowie. Bez żargonu: jeśli jakieś techniczne słowo jest nieuniknione, wyjaśnij je w nawiasie codziennym porównaniem. ${FORMAT}`

const RECAP_PROMPT = `Nie jestem programistą. Poniżej jest dziennik tego, co Claude zrobił dla mnie we wcześniejszej sesji: o co prosiłem, jakie pliki zmienił, jakie polecenia uruchomił i co mi napisał na końcu. Podsumuj tę sesję krok po kroku, prostym językiem. Bez żargonu: jeśli techniczne słowo jest nieuniknione, wyjaśnij je w nawiasie codziennym porównaniem. ${FORMAT}`

// Jeden akcent na cały panel: numery i terminy w kolorze Claude'a, nagłówki zwykłe pogrubione.
const STYLE = [
  { match: /PODSUMOWANIE/i, color: 'claude' },
  { match: /KROKI/i, color: 'claude' },
  { match: /TECHNICZN/i, color: 'claude' },
  { match: /DLACZEGO/i, color: 'claude' },
  { match: /CZY MUSZĘ/i, color: 'claude' },
  { match: /SŁOWA/i, color: 'claude' },
  { match: /./, color: 'claude' },
]

// Dzieli wyjaśnienie na sekcje z nagłówkami.
function sections(text: string) {
  const out: { title: string; body: string }[] = []
  for (const line of text.split('\n')) {
    const clean = line.replace(/[*#]/g, '').trim()
    const head = clean.match(/^([A-ZĄĆĘŁŃÓŚŹŻ][A-ZĄĆĘŁŃÓŚŹŻ '"?,]{3,}?)\s*(?:[—:-]\s*(.*))?$/)
    if (head && STYLE.slice(0, -1).some(s => s.match.test(head[1]!))) {
      out.push({ title: head[1]!.trim(), body: head[2] ?? '' })
    } else if (out.length && clean) {
      const last = out[out.length - 1]!
      last.body = last.body ? `${last.body}\n${clean}` : clean
    }
  }
  return out.length ? out : [{ title: 'Co się stało', body: text }]
}

// Wyciąga terminy z sekcji SŁOWA DO NAUKI.
function newTerms(text: string) {
  const words = sections(text).find(s => /SŁOWA/i.test(s.title))
  if (!words) return []
  return words.body
    .split('\n')
    .map(l => (l.replace(/^[-•\d.\s]+/, '').split(/\s[—–-]\s/)[0] ?? '').replace(/`/g, '').trim())
    .filter(t => t.length > 0 && t.length < 40)
}

// Ikonka robota-dziecka (desktop) w stylu robotów z innych modów: duża okrągła głowa, wielkie oczy
// z błyskiem, rumieńce, smoczek i loczek na antenie; małe ciałko. Średnie tony, czytelne na ciemnym tle.
export function babySvg(): string {
  const c = '#E8956F'
  const ink = '#2A2A28'
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="20" viewBox="0 0 18 20">` +
    `<path d="M9 3.2V1.6q0-1.2 1.2-1.1" stroke="${c}" stroke-width="1" fill="none" stroke-linecap="round"/>` +
    `<rect x="2" y="3" width="14" height="10.5" rx="5" fill="${c}"/>` +
    `<circle cx="6.4" cy="7.8" r="1.9" fill="${ink}"/><circle cx="11.6" cy="7.8" r="1.9" fill="${ink}"/>` +
    `<circle cx="7" cy="7.1" r=".6" fill="#FFFFFF"/><circle cx="12.2" cy="7.1" r=".6" fill="#FFFFFF"/>` +
    `<circle cx="4.2" cy="10.6" r="1" fill="#E0899B" opacity=".9"/><circle cx="13.8" cy="10.6" r="1" fill="#E0899B" opacity=".9"/>` +
    `<circle cx="9" cy="11.4" r="1.4" fill="#6AA5E8"/><rect x="8.3" y="10.7" width="1.4" height="1.4" rx=".4" fill="#B5D4F4"/>` +
    `<rect x="5.5" y="13.8" width="7" height="5" rx="2" fill="${c}" opacity=".85"/>` +
    `<rect x="3.6" y="14.6" width="1.6" height="3" rx=".8" fill="${c}"/><rect x="12.8" y="14.6" width="1.6" height="3" rx=".8" fill="${c}"/>` +
    `</svg>`
  )
}

// Wiersz moda co-dalej („inne / zablokowane”), do którego dołącza przycisk „wyjaśnij”.
const TOOLS_ROW = 'co-dalej-tools'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] } | string | null | undefined

// Kopia drzewa z `extra` dopisanym na końcu Boksa o kluczu `key`; null, gdy takiego Boksa nie ma.
export function appendTo<T>(tree: T, key: string, extra: unknown): T | null {
  const walk = (node: Node): Node | null => {
    if (!node || typeof node === 'string') return null
    if (node.type === 'Box' && node.props?.key === key) {
      return { ...node, children: [...(node.children ?? []), extra] }
    }
    const kids = node.children ?? []
    for (let i = 0; i < kids.length; i++) {
      const hit = walk(kids[i] as Node)
      if (hit) return { ...node, children: kids.map((k, j) => (j === i ? hit : k)) }
    }
    return null
  }
  return walk(tree as Node) as T | null
}

// Linie sekcji jako punkty listy: numer (z „1.” albo kolejny dla „•”) i tekst.
// Linie bez znacznika doklejają się do poprzedniego punktu.
export function items(body: string): { n: number; text: string }[] {
  const out: { n: number; text: string }[] = []
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*(?:(\d+)[.)]|[•\-–])\s*(.*)$/)
    if (m) out.push({ n: m[1] ? Number(m[1]) : out.length + 1, text: m[2]!.trim() })
    else if (out.length && line.trim()) out[out.length - 1]!.text += ` ${line.trim()}`
    else if (line.trim()) out.push({ n: out.length + 1, text: line.trim() })
  }
  return out
}

// Krok techniczny: część dla programisty i część „po ludzku”.
export function splitHuman(text: string): { tech: string; human: string } {
  const [tech, ...rest] = text.split(/\s*(?:→|->)\s*po ludzku:\s*/i)
  return { tech: (tech ?? '').trim(), human: rest.join(' ').trim() }
}

// Fragmenty tekstu: terminy w `grawisach` osobno, żeby je wyróżnić.
export function spans(text: string): { text: string; isTerm: boolean }[] {
  return text
    .split(/(`[^`]+`)/)
    .filter(Boolean)
    .map(part => (/^`[^`]+`$/.test(part) ? { text: part.slice(1, -1), isTerm: true } : { text: part, isTerm: false }))
}

function listOf<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function projectName(cwd: string) {
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd
}

function when(at: number) {
  return new Date(at).toLocaleString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

async function learnedTerms($: EngineInterface): Promise<string[]> {
  return listOf<unknown>(await $.store.get(LEARNED_KEY)).filter((t): t is string => typeof t === 'string')
}

function withLearned(base: string, learned: string[]) {
  if (learned.length === 0) return base
  return `${base}

Terminy, które już znam (używaj ich swobodnie bez definiowania i nie wybieraj ich do SŁOWA DO NAUKI): ${learned.join(', ')}.`
}

// Tury ostatniej wcześniejszej sesji, od najstarszej.
async function previousSession($: EngineInterface) {
  const started = await read($, sessionStartedAt)
  const journal = listOf<Turn>(await $.store.get(JOURNAL_KEY)).filter(t => t.session !== started)
  if (journal.length === 0) return []
  const last = journal[journal.length - 1]!.session
  return journal.filter(t => t.session === last)
}

function logOf(turns: Turn[]) {
  return turns
    .map(
      (t, i) =>
        `--- Tura ${i + 1} (${when(t.at)}, projekt: ${t.project})\nPoprosiłem: ${t.prompt}\nCo zrobił Claude:\n${t.actions.map(a => `- ${a}`).join('\n')}\nOdpowiedź Claude'a: ${t.answer}`,
    )
    .join('\n\n')
}

// Pisze wyjaśnienie, zapisuje je i pokazuje w panelu.
async function explain($: EngineInterface, mode: 'now' | 'last') {
  await update($, hasChanges, () => false)
  await update($, hasRecap, () => false)
  await update($, status, () => ({ kind: 'writing', message: '' }) as Status)
  const opened = $.ui.open({ id: PANE, title: 'Wyjaśnij' })

  const learned = await learnedTerms($)
  let label = 'Ta sesja'
  let project = projectName(await $.session.cwd())
  let r
  if (mode === 'last') {
    const turns = await previousSession($)
    if (turns.length === 0) {
      await update($, status, () => ({
        kind: 'failed',
        message: 'Nie ma jeszcze zapisanej wcześniejszej sesji. Dziennik prowadzę od teraz, więc następnym razem będzie co podsumować.',
      }) as Status)
      return
    }
    label = `Podsumowanie z ${when(turns[0]!.at)}`
    project = turns[turns.length - 1]!.project
    r = await $.model.complete({ model: RECAP_MODEL, prompt: `${withLearned(RECAP_PROMPT, learned)}\n\n${logOf(turns)}` })
  } else {
    r = await $.model.fork({ prompt: withLearned(NOW_PROMPT, learned) })
  }
  if (!(await opened).isPlaced) $.ui.toast('Wyjaśnienie gotowe — poszerz okno albo wpisz /wyjasnij historia')

  if (!r.isAnswered) {
    await update($, status, () => ({ kind: 'failed', message: `Nie udało się wyjaśnić (${r.reason}). Spróbuj jeszcze raz.` }) as Status)
    return
  }

  const entry: Saved = { at: Date.now(), project, label, text: r.text }
  const all = [...listOf<Saved>(await $.store.get(SAVED_KEY)), entry].slice(-50)
  await $.store.set(SAVED_KEY, all)
  await update($, saved, () => all)
  await update($, viewing, () => all.length - 1)
  await update($, status, () => ({ kind: 'idle', message: '' }) as Status)

  const known = new Set(learned.map(t => t.toLowerCase()))
  const added = newTerms(r.text).filter(t => !known.has(t.toLowerCase()))
  if (added.length) {
    const terms = [...learned, ...added].slice(-300)
    await $.store.set(LEARNED_KEY, terms)
    await update($, learnedCount, () => terms.length)
  }
}

function start($: EngineInterface, mode: 'now' | 'last') {
  explain($, mode).catch(err =>
    update($, status, () => ({ kind: 'failed', message: `Nie udało się wyjaśnić (${String(err)}). Spróbuj jeszcze raz.` }) as Status),
  )
}

async function showHistory($: EngineInterface) {
  const all = await read($, saved)
  await update($, viewing, () => Math.max(0, all.length - 1))
  await update($, status, () => ({ kind: 'idle', message: '' }) as Status)
  await $.ui.open({ id: PANE, title: 'Wyjaśnij' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await update($, sessionStartedAt, () => Date.now())
    const learned = await learnedTerms($)
    await update($, learnedCount, () => learned.length)
    const all = listOf<Saved>(await $.store.get(SAVED_KEY))
    await update($, saved, () => all)
    await update($, hasRecap, () => false)
    if ((await previousSession($)).length > 0) await update($, hasRecap, () => true)
    await $.command.register({
      name: 'wyjasnij',
      description: 'Wyjaśnia po ludzku pracę Claude’a. „ostatnio” podsumowuje poprzednią sesję, „historia” otwiera zapisane',
    })
    return result
  })

  on('command.run', { command: 'wyjasnij' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'historia') {
      await showHistory($)
      return { text: 'Otworzyłem zapisane wyjaśnienia.' }
    }
    const mode = arg === 'ostatnio' ? 'last' : 'now'
    start($, mode)
    return { text: mode === 'last' ? 'Podsumowuję poprzednią sesję w panelu bocznym.' : 'Wyjaśniam w panelu bocznym.' }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, didThings, () => false)
    await update($, hasChanges, () => false)
    await update($, hasRecap, () => false)
    await update($, actions, () => [])
    await update($, prompt, () => e.text.slice(0, 500))
    return next(e)
  })

  // Tylko główna rozmowa; subagenci raportują przez nią.
  on('tool.call', async ($, e, next) => {
    if (!e.agentId && DOING_TOOLS.test(String(e.tool))) {
      await update($, didThings, () => true)
      const input = e as unknown as { command?: unknown; file_path?: unknown; notebook_path?: unknown }
      const what = /^(Bash|PowerShell)$/.test(String(e.tool))
        ? `Uruchomił polecenie: ${String(input.command ?? '').slice(0, 200)}`
        : `Zmienił plik: ${String(input.file_path ?? input.notebook_path ?? '')}`
      await update($, actions, list => [...list, what].slice(-40))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || !(await read($, didThings))) return result
    await update($, hasChanges, () => true)
    const turn: Turn = {
      at: Date.now(),
      session: await read($, sessionStartedAt),
      project: projectName(await $.session.cwd()),
      prompt: await read($, prompt),
      actions: await read($, actions),
      answer: result.text.slice(0, 1500),
    }
    const journal = [...listOf<Turn>(await $.store.get(JOURNAL_KEY)), turn].slice(-200)
    await $.store.set(JOURNAL_KEY, journal)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.isWorking) return next(e)
    const changes = await read($, hasChanges)
    const recap = !changes && (await read($, hasRecap))
    if (!changes && !recap) return next(e)
    const { Box, Button, Svg } = $.ui.resolve(e)
    const below = await next(e).catch(() => null)
    const press = () => start($, changes ? 'now' : 'last')
    const button = changes ? (
      <Button key="explain" label="wyjaśnij, co się stało" hotkey="e" plain dimColor onPress={press} />
    ) : (
      <Button key="recap" label="podsumuj poprzednią sesję" hotkey="r" plain dimColor onPress={press} />
    )
    // Gdy co-dalej pokazuje wiersz „inne / zablokowane”, przycisk dołącza do niego zamiast zajmować własny wiersz.
    // Desktop: przed przyciskiem mały robot-dziecko (ten sam styl co roboty w innych modach).
    // Ikonka jedzie razem z przyciskiem do wiersza co-dalej albo later.
    const explainer = (
      <Box key="wyjasnij-item" flexDirection="row" gap={1} alignItems="center">
        {e.surface === 'desktop' ? <Svg source={babySvg()} alt="wyjaśnij" width={18} height={20} /> : null}
        {button}
      </Box>
    )
    const merged = below ? appendTo(below, TOOLS_ROW, explainer) : null
    if (merged) return merged
    return (
      <Box flexDirection="column">
        {below}
        {/* Blok „wyjasnij-block”: later przenosi go na górę, obok swojej kolejki (jak blok co-dalej). */}
        <Box key="wyjasnij-block" flexDirection="column">
        {/* Wiersz zaczyna się od ikonki robota (nie od natywnego przycisku), więc bez ujemnego marginesu:
            z nim ikonka wychodziła poza lewą krawędź paska. */}
        <Box key="wyjasnij-row" flexDirection="row" gap={2} alignItems="center">
          {explainer}
          <Box {...(e.surface === 'desktop' ? { display: 'none' as const, hover: { display: 'flex' as const } } : {})}>
            <Button
              key="dismiss"
              label="×"
              plain
              dimColor
              onPress={() => (changes ? update($, hasChanges, () => false) : update($, hasRecap, () => false))}
            />
          </Box>
        </Box>
        {/* Pusta linia pod przyciskiem, jak pod propozycjami co-dalej (gdy przycisk dołącza do co-dalej, pustą linię daje tamten). */}
        <Box key="wyjasnij-gap" height={1} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const s = await read($, status)
    const all = await read($, saved)
    const i = Math.min(await read($, viewing), all.length - 1)
    const shown = all[i]
    const width = (e.viewport?.columns ?? 40) - 6

    // Tekst z terminami w `grawisach`: termin pogrubiony, w kolorze Claude'a.
    const rich = (text: string, key: string) =>
      spans(text).map((s, k) =>
        s.isTerm ? (
          <Text key={`${key}-${k}`} bold color="claude">
            {s.text}
          </Text>
        ) : (
          s.text
        ),
      )

    // Treść sekcji: listy numerowane, „po ludzku” i słówka wyróżnione.
    const bodyOf = (title: string, body: string, look: { color: string }) => {
      if (/KROKI/i.test(title)) {
        return items(body).map((it, k) => (
          <Text key={`k${k}`}>
            <Text bold color={look.color}>{it.n}. </Text>
            {rich(it.text, `k${k}`)}
          </Text>
        ))
      }
      if (/TECHNICZN/i.test(title)) {
        return items(body).map((it, k) => {
          const { tech, human } = splitHuman(it.text)
          return (
            <Box key={`t${k}`} flexDirection="column" marginBottom={1}>
              <Text>
                <Text bold color={look.color}>{it.n}. </Text>
                {rich(tech, `t${k}`)}
              </Text>
              {human && (
                <Text>
                  <Text dimColor>{'   ↳ po ludzku  '}</Text>
                  {human}
                </Text>
              )}
            </Box>
          )
        })
      }
      if (/SŁOWA/i.test(title)) {
        return items(body).map((it, k) => {
          const [term = '', ...rest] = it.text.replace(/`/g, '').split(/\s[—–-]\s/)
          return (
            <Box key={`w${k}`} flexDirection="column" marginBottom={1}>
              <Text bold color="claude">
                {term.trim()}
              </Text>
              {rest.length ? <Text>{rest.join(' - ')}</Text> : null}
            </Box>
          )
        })
      }
      return <Text>{rich(body, 'b')}</Text>
    }
    const rule = '─'.repeat(Math.max(10, Math.min(e.surface === 'terminal' ? 40 : 22, width)))

    if (s.kind !== 'idle' || !shown) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text dimColor>
            {s.kind === 'writing'
              ? 'Tłumaczę na ludzki…'
              : s.kind === 'failed'
                ? s.message
                : 'Nic jeszcze nie wyjaśniono. /wyjasnij albo /wyjasnij ostatnio.'}
          </Text>
          {all.length > 0 && <Button key="history" label="Zapisane wyjaśnienia" onPress={() => void showHistory($)} />}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>{shown.label}</Text>
        <Box marginBottom={1}>
          <Text dimColor>
            {shown.project} · {when(shown.at)} · {i + 1}/{all.length} · {await read($, learnedCount)} słówek
          </Text>
        </Box>
        {sections(shown.text).map(({ title, body }, n) => {
          const look = STYLE.find(st => st.match.test(title)) ?? STYLE[STYLE.length - 1]!
          return (
            <Box key={`s${n}`} flexDirection="column">
              {n > 0 && <Text dimColor>{rule}</Text>}
              <Text bold>{title}</Text>
              <Box flexDirection="column" marginBottom={1}>
                {bodyOf(title, body, look)}
              </Box>
            </Box>
          )
        })}
        <Box flexDirection="row" gap={2}>
          {i > 0 && <Button key="older" plain dimColor label="◀ starsze" onPress={() => update($, viewing, v => Math.max(0, v - 1))} />}
          {i < all.length - 1 && (
            <Button key="newer" plain dimColor label="nowsze ▶" onPress={() => update($, viewing, v => Math.min(all.length - 1, v + 1))} />
          )}
          <Box flexGrow={1} />
          <Button key="again" plain label="wyjaśnij najnowsze" onPress={() => start($, 'now')} />
        </Box>
      </Box>
    )
  })
}
