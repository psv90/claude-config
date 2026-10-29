// progres-bar: pasek nad promptem, który mówi, ile zadania Claude już zrobił
// i na jakim jest etapie.
// - Postęp bierze z listy zadań Claude'a (TodoWrite, TaskCreate/TaskUpdate albo
//   lista zadań aplikacji desktop, update_plan): pasek ładowania, procent,
//   „etap X z Y”, liczba ukończonych i nazwa kroku w toku.
// - Bez listy pokazuje bieżącą czynność (czyta, edytuje plik, uruchamia…),
//   liczbę kroków i czas tury.
// - Sekcja system promptu prosi Claude'a o listę zadań przy pracy z 3+ krokami,
//   żeby pasek miał z czego liczyć.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Activity, Pace, Task } from '../types'

const tasks = atom({ plugin: 'progres-bar', key: 'tasks' } as const, [])
const activity = atom({ plugin: 'progres-bar', key: 'activity' } as const, { label: '', steps: 0, startedAt: null, isWorking: false })
const NO_PACE: Pace = { startedAt: null, lastDoneAt: null, done: 0 }
const pace = atom({ plugin: 'progres-bar', key: 'pace' } as const, NO_PACE)

const BAR = 20
// Kolumny wspólne z cache-bar (LEAD_COLS, LABEL_COLS tam): segmenty obu pasków w jednej linii pionowej.
const LEAD_COLS = 13
const LABEL_COLS = 4
// Pasek nie węższy niż 5 segmentów cache-bar, także przy krótszej liście.
const MIN_CELLS = 5
// Prawa kolumna wspólna z pamięcią projektu, later, cache-barem i agentami.
const RIGHT_COLS = 16
// Pusty segment: ciemna szarość tuż jaśniejsza od tła paska (#262624), ta sama w cache-bar.
const EMPTY_SEGMENT = '#3D3D3A'

// Nazwa kroku i bieżąca czynność przycięte do `max` znaków (z wielokropkiem); czynność ustępuje pierwsza.
export function fitLine(name: string, detail: string, max: number): { name: string; detail: string } {
  const room = Math.max(8, max)
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)
  if (name.length >= room) return { name: cut(name, room), detail: '' }
  const left = room - name.length - 3
  return { name, detail: detail && left >= 6 ? cut(detail, left) : '' }
}
// Ósemki bloku, żeby pasek rósł płynnie, a nie skokami co pełny znak.
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

// Lista zadań aplikacji desktop (Code tab) i jej zamknięcie.
const PLAN_TOOL = 'mcp__ccd_turn__update_plan'
const WRAP_TOOL = 'mcp__ccd_turn__wrap_up'
const TASK_TOOLS = /^(TodoWrite|TaskCreate|TaskUpdate|mcp__ccd_turn__update_plan|mcp__ccd_turn__wrap_up)$/

const RULE =
  'Gdy zadanie ma co najmniej 3 kroki, na początku rozpisz je narzędziem listy zadań i aktualizuj status każdego kroku na bieżąco ' +
  '(in_progress przed rozpoczęciem, completed zaraz po skończeniu). Nazwy kroków pisz krótko, po polsku.'

const fileName = (p: unknown) => String(p ?? '').split(/[\\/]/).pop() ?? ''

// Krótki opis tego, co robi narzędzie.
export function labelOf(tool: string, input: Record<string, unknown>): string {
  if (/^(Read|NotebookRead)$/.test(tool)) return `czyta ${fileName(input.file_path ?? input.notebook_path)}`
  if (/^(Grep|Glob)$/.test(tool)) return 'przeszukuje pliki'
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)) return `edytuje ${fileName(input.file_path ?? input.notebook_path)}`
  if (/^(Bash|PowerShell)$/.test(tool)) {
    const cmd = String(input.command ?? '').replace(/\s+/g, ' ').trim()
    return cmd ? `uruchamia ${cmd.length > 40 ? `${cmd.slice(0, 39)}…` : cmd}` : 'uruchamia polecenie'
  }
  if (/^Web(Fetch|Search)$/.test(tool)) return 'szuka w sieci'
  if (tool === 'Agent') return `zleca agentowi: ${String(input.description ?? '')}`
  if (tool === 'Skill') return `wczytuje umiejętność ${String(input.skill ?? '')}`
  if (/^(TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet)$/.test(tool) || tool === PLAN_TOOL) return 'planuje kroki'
  if (tool === WRAP_TOOL) return 'podsumowuje'
  if (tool.startsWith('mcp__')) return `korzysta z ${tool.split('__')[1] ?? 'MCP'}`
  return tool
}

// Lista po zmianie: TodoWrite podmienia całą, TaskCreate dokłada, TaskUpdate zmienia jedną.
export function applyTool(list: Task[], tool: string, input: Record<string, unknown>, result: unknown): Task[] {
  if (tool === 'TodoWrite') {
    const todos = (input.todos as { content: string; status: Task['status']; activeForm?: string }[] | undefined) ?? []
    return todos.map((t, i) => ({ id: `todo-${i}`, subject: t.content, active: t.activeForm ?? t.content, status: t.status }))
  }
  if (tool === PLAN_TOOL) return applyPlan(list, input)
  if (tool === WRAP_TOOL) return list.map(t => ({ ...t, status: 'completed' as const }))
  if (tool === 'TaskCreate') {
    const id = (result as { task?: { id?: string } } | undefined)?.task?.id
    if (!id) return list
    const subject = String(input.subject ?? '')
    return [...list, { id, subject, active: String(input.activeForm ?? subject), status: 'pending' }]
  }
  if (tool === 'TaskUpdate') {
    const id = String(input.taskId ?? '')
    const status = input.status as Task['status'] | 'deleted' | undefined
    if (status === 'deleted') return list.filter(t => t.id !== id)
    return list.map(t =>
      t.id === id
        ? {
            ...t,
            status: status ?? t.status,
            subject: input.subject ? String(input.subject) : t.subject,
            active: input.activeForm ? String(input.activeForm) : t.active,
          }
        : t,
    )
  }
  return list
}

// update_plan: `items` podmienia całą listę; `advance` kończy krok w toku i zaczyna
// następny oczekujący; `done` (numery od 1) kończy wskazane, `start` zaczyna jeden.
function applyPlan(list: Task[], input: Record<string, unknown>): Task[] {
  const items = input.items as { content?: string; status?: Task['status'] }[] | undefined
  if (Array.isArray(items)) {
    return items.map((t, i) => {
      const subject = String(t.content ?? '')
      return { id: `plan-${i}`, subject, active: subject, status: t.status ?? 'pending' }
    })
  }
  let next = list
  if (input.advance === true) {
    const cur = next.findIndex(t => t.status === 'in_progress')
    const after = next.findIndex((t, i) => i > cur && t.status === 'pending')
    next = next.map((t, i) =>
      i === cur ? { ...t, status: 'completed' as const } : i === after ? { ...t, status: 'in_progress' as const } : t,
    )
  }
  const done = Array.isArray(input.done) ? (input.done as number[]) : []
  if (done.length) next = next.map((t, i) => (done.includes(i + 1) ? { ...t, status: 'completed' as const } : t))
  if (typeof input.start === 'number') {
    const start = input.start - 1
    next = next.map((t, i) =>
      i === start ? { ...t, status: 'in_progress' as const } : t.status === 'in_progress' ? { ...t, status: 'pending' as const } : t,
    )
  }
  return next
}

// Pasek ładowania o szerokości `width` znaków, wypełniony w ułamku `ratio`.
export function bar(ratio: number, width = BAR): { filled: string; empty: string } {
  const eighths = Math.round(Math.min(1, Math.max(0, ratio)) * width * 8)
  const full = Math.floor(eighths / 8)
  const part = EIGHTHS[eighths % 8] ?? ''
  const filled = '█'.repeat(full) + part
  return { filled, empty: '░'.repeat(width - full - (part ? 1 : 0)) }
}

// Numer etapu: krok w toku, a bez niego pierwszy nieukończony.
export function stageOf(list: Task[]): number {
  const current = list.findIndex(t => t.status === 'in_progress')
  if (current >= 0) return current + 1
  const pending = list.findIndex(t => t.status !== 'completed')
  return pending >= 0 ? pending + 1 : list.length
}

// Tempo po zmianie listy: nowa lista zaczyna liczenie od nowa, a każdy przyrost
// ukończonych kroków zapisuje chwilę ukończenia.
export function nextPace(p: Pace, before: Task[], after: Task[], now: number): Pace {
  const done = after.filter(t => t.status === 'completed').length
  // Nowa lista: pierwsza w tym poleceniu albo nowe zadanie po ukończeniu poprzedniego.
  const wasFinished = before.length > 0 && before.every(t => t.status === 'completed')
  const isNewList = before.length === 0 || after.length === 0 || (wasFinished && done < after.length)
  if (isNewList) return after.length ? { startedAt: now, lastDoneAt: done ? now : null, done } : NO_PACE
  if (done > p.done) return { ...p, lastDoneAt: now, done }
  return { ...p, done }
}

// Szacowany czas do końca w ms: średni czas kroku razy kroki do zrobienia,
// minus to, co już upłynęło od ostatniego ukończenia. Bez ukończonego kroku
// nie ma z czego liczyć.
export function etaOf(p: Pace, total: number, now: number): number | null {
  if (p.startedAt === null || p.lastDoneAt === null || p.done === 0 || p.done >= total) return null
  const perStep = (p.lastDoneAt - p.startedAt) / p.done
  return Math.max(0, perStep * (total - p.done) - (now - p.lastDoneAt))
}

// Stan każdego segmentu: jeden segment na krok listy.
export function segmentsOf(list: Task[]): ('done' | 'current' | 'todo')[] {
  return list.map(t => (t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'current' : 'todo'))
}

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Robot na elektrycznym wózku jadący po torze do mety (desktop). Statyczny obraz rysowany klatkami,
// jak roboty w modzie agenci: przerysowanie paska nie zrywa animacji, bo każda klatka to nowy obrazek.
// Kolory średnie, czytelne na ciemnym i jasnym tle; robot w kolorach stanów moda agenci.
export const TRACK_W = 140
export const TRACK_H = 40
// Rozmiar w pasku (CSS px): zmniejszony, żeby wiersz nie był dużo wyższy od tekstu.
const TRACK_PX_W = 112
const TRACK_PX_H = 32
const ROBOT = { run: '#D97757', done: '#1D9E75', wait: '#888780' } as const
type Look = keyof typeof ROBOT
const INK = '#2A2A28'
const FRAME = { dark: '#55544F', mid: '#6B6A65', light: '#8F8D86', tyre: '#1F1F1D', rim: '#3A3A37', hub: '#B9B7AE' }

function chair(frame: number, isOn: boolean, isMoving: boolean): string {
  const angle = isMoving ? (frame * 36) % 360 : 0
  const casterAngle = isMoving ? (frame * 90) % 360 : 0
  const led = isOn ? (frame % 2 === 0 ? '#4EBA65' : '#2B6B3A') : FRAME.mid
  const spokes = [0, 72, 144, 216, 288]
    .map(a => {
      const r = ((a - 90) * Math.PI) / 180
      return `<line x1="0" y1="0" x2="${(3.8 * Math.cos(r)).toFixed(2)}" y2="${(3.8 * Math.sin(r)).toFixed(2)}"/>`
    })
    .join('')
  return (
    // Oparcie z zagłówkiem, siedzisko z poduszką, podłokietnik, akumulator z diodą, podnóżek z widelcem.
    `<path d="M5.5 20 L4.6 7.5 Q4.5 5 7 5" stroke="${FRAME.mid}" stroke-width="2.2" fill="none" stroke-linecap="round"/>` +
    `<rect x="3.2" y="1.8" width="6" height="3.6" rx="1.6" fill="${FRAME.dark}"/>` +
    `<rect x="5" y="17.6" width="15.5" height="3.2" rx="1.5" fill="${FRAME.dark}"/>` +
    `<rect x="7" y="16.6" width="12" height="1.6" rx=".8" fill="${FRAME.mid}"/>` +
    `<path d="M8 13 h10.5" stroke="${FRAME.mid}" stroke-width="1.6" stroke-linecap="round"/>` +
    `<path d="M8.5 13 v4" stroke="${FRAME.mid}" stroke-width="1.1"/>` +
    `<rect x="8" y="21.2" width="11" height="4.8" rx="1.4" fill="#3D3D3A" stroke="${FRAME.mid}" stroke-width=".6"/>` +
    `<circle cx="10.5" cy="23.6" r=".9" fill="${led}"/>` +
    `<path d="M19.5 20.5 L23 26.2" stroke="${FRAME.mid}" stroke-width="1.4" stroke-linecap="round"/>` +
    `<path d="M22.4 26.6 h4.4" stroke="${FRAME.light}" stroke-width="1.8" stroke-linecap="round"/>` +
    `<path d="M19 21.5 h3.2 v3.6" stroke="${FRAME.mid}" stroke-width="1.1" fill="none"/>` +
    // Koło napędowe: opona, felga, 5 ramion obróconych o kąt klatki.
    `<g transform="translate(9.5 27)"><circle r="6.4" fill="${FRAME.tyre}"/><circle r="6.4" fill="none" stroke="${FRAME.rim}" stroke-width="2.4"/>` +
    `<circle r="4.2" fill="${FRAME.dark}"/><g transform="rotate(${angle})" stroke="${FRAME.light}" stroke-width="1.1" stroke-linecap="round">${spokes}</g>` +
    `<circle r="1.3" fill="${FRAME.hub}"/></g>` +
    // Przednie kółko.
    `<g transform="translate(22.2 30.4) rotate(${casterAngle})"><circle r="2.2" fill="${FRAME.tyre}" stroke="${FRAME.rim}" stroke-width="1.2"/>` +
    `<circle r=".9" fill="${FRAME.light}"/><line x1="0" y1="-1.6" x2="0" y2="-.6" stroke="${FRAME.hub}" stroke-width=".6"/></g>`
  )
}

function rider(look: Look, frame: number): string {
  const c = ROBOT[look]
  const isRun = look === 'run'
  const blink = isRun && frame % 8 === 7
  const light = isRun && frame % 2 === 0 ? '#FFD27A' : c
  let eyes: string
  if (look === 'done') eyes = `<path d="M13.5 5.4q1 1.2 2 0M16 5.4q1 1.2 2 0" stroke="${INK}" stroke-width=".9" fill="none" stroke-linecap="round"/>`
  else if (look === 'wait' || blink) eyes = `<path d="M13.6 5.6h1.8M16.1 5.6h1.8" stroke="${INK}" stroke-width="1"/>`
  else eyes = `<circle cx="14.5" cy="5.1" r="1.1" fill="${INK}"/><circle cx="17" cy="5.1" r="1.1" fill="${INK}"/>`
  // Ręka: w jeździe na joysticku (joystick lekko się kiwa), na mecie macha uniesiona.
  const arm =
    look === 'done'
      ? `<g transform="rotate(${frame % 2 === 0 ? -150 : -118} 15 14)"><line x1="15" y1="14" x2="15" y2="22" stroke="${c}" stroke-width="2" stroke-linecap="round"/></g>`
      : `<line x1="12.5" y1="12.5" x2="18" y2="12.8" stroke="${c}" stroke-width="2" stroke-linecap="round"/>` +
        `<g transform="rotate(${isRun ? (frame % 2 === 0 ? 10 : 20) : 0} 19 12.6)"><line x1="19" y1="12.6" x2="19.6" y2="9.8" stroke="${FRAME.hub}" stroke-width="1.1" stroke-linecap="round"/>` +
        `<circle cx="19.7" cy="9.6" r="1.25" fill="#E3A33A"/></g>`
  return (
    `<rect x="8" y="9.5" width="9" height="8.5" rx="2.5" fill="${c}"/>` +
    `<path d="M11 17.6h8.6l2.4 6" stroke="${c}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<line x1="12.5" y1="1.6" x2="12.5" y2="-.4" stroke="${c}" stroke-width="1.2"/><circle cx="12.5" cy="-.5" r="1.3" fill="${light}"/>` +
    `<rect x="7.5" y="1.2" width="11" height="7.8" rx="3" fill="${c}"/>${eyes}${arm}`
  )
}

// Cały tor: szary tor, zielona część przebyta, meta z flagą i robot w miejscu odpowiadającym postępowi.
export function trackSvg(ratio: number, look: Look, frame: number): string {
  const r = Math.min(1, Math.max(0, ratio))
  const x = 2 + r * 94
  const hum = look === 'run' && frame % 2 === 1 ? -0.35 : 0
  const flagTip = frame % 2 === 0 ? 'M0 0h10l-2.5 3.5L10 7H0z' : 'M0 0h10l-1.5 3.5L9 8H0z'
  const z = look === 'wait' ? `<text x="${(x + 23).toFixed(1)}" y="${frame % 2 === 0 ? 7 : 5}" font-family="system-ui,sans-serif" font-size="5" fill="${FRAME.hub}">z</text>` : ''
  const body =
    `<g transform="translate(${x.toFixed(1)} ${(3.5 + hum).toFixed(2)})"${look === 'wait' ? ' opacity=".65"' : ''}>` +
    `${rider(look, frame)}${chair(frame, look !== 'wait', look === 'run')}</g>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TRACK_W}" height="${TRACK_H}" viewBox="0 0 ${TRACK_W} ${TRACK_H}">` +
    `<line x1="2" y1="36.5" x2="122" y2="36.5" stroke="#3D3D3A" stroke-width="2" stroke-linecap="round"/>` +
    (r > 0 ? `<line x1="2" y1="36.5" x2="${(2 + r * 120).toFixed(1)}" y2="36.5" stroke="#4EBA65" stroke-width="2" stroke-linecap="round"/>` : '') +
    `<g transform="translate(126 9)"><line x1="0" y1="0" x2="0" y2="27.5" stroke="${FRAME.hub}" stroke-width="1.5"/><path d="${flagTip}" fill="#4EBA65"/></g>` +
    `${body}${z}</svg>`
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // Czas tury i klatki robota na wózku: dwa razy na sekundę, tylko wtedy, gdy Claude pracuje.
    $.clock.every(500, () => {
      void (async () => {
        if ((await read($, activity)).isWorking) $.ui.invalidate('ui.render')
      })()
    })
    return result
  })

  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    return { sections: [...sections, { id: 'progres-bar:lista-zadan', text: RULE, scope: 'session' as const }] }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.turnId) {
      await update($, tasks, () => [])
      await update($, pace, () => NO_PACE)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, activity, () => ({ label: 'myśli', steps: 0, startedAt: now, isWorking: true }))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const label = labelOf(tool, input)
    await update($, activity, a => ({ ...a, label, steps: a.steps + 1 }))
    const result = await next(e)
    if (TASK_TOOLS.test(tool) && !('deny' in result && result.deny)) {
      const value = 'result' in result ? result.result : undefined
      const now = await $.clock.now()
      let before: Task[] = []
      let after: Task[] = []
      await update($, tasks, list => {
        before = list
        after = applyTool(list, tool, input, value)
        return after
      })
      await update($, pace, p => nextPace(p, before, after, now))
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) await update($, activity, a => ({ ...a, label: '', isWorking: false }))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, tasks)
    const a = await read($, activity)
    if (e.props.hasSurvey || (!a.isWorking && list.length === 0)) return next(e)

    const { Box, Text, Svg } = $.ui.resolve(e)
    const below = await next(e).catch(() => null)
    const now = await $.clock.now()
    const frame = Math.floor(now / 500)
    const elapsed = a.startedAt !== null && a.isWorking ? ` · ${clock(now - a.startedAt)}` : ''

    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          {below}
          <Box flexDirection="row" gap={2}>
            <Box flexGrow={1} flexShrink={1} minWidth={0} height={1} overflow="hidden">
              <Text dimColor wrap="truncate-end">
                ▸ {a.label || 'pracuje'}
              </Text>
            </Box>
            <Text dimColor>
              krok {a.steps}  {elapsed.replace(' · ', '')}
            </Text>
          </Box>
        </Box>
      )
    }

    const done = list.filter(t => t.status === 'completed').length
    const current = list.find(t => t.status === 'in_progress')
    const isFinished = done === list.length
    const name = isFinished ? 'gotowe' : current ? current.active : a.isWorking ? a.label : 'wstrzymane'
    // Szacunek pokazuje się dopiero po pierwszym ukończonym kroku i tylko w trakcie pracy.
    const eta = a.isWorking ? etaOf(await read($, pace), list.length, now) : null
    const width = String(list.length).length
    const kinds = segmentsOf(list)
    // Segmenty jak w cache-bar, na każdej powierzchni: zrobione ▰ zielone (kolor `success` motywu),
    // krok w toku ▰ zielony przygaszony, reszta ▰ szara i przygaszona.
    const segments = (
      <Text>
        <Text color="success">{'▰'.repeat(kinds.filter(k => k === 'done').length)}</Text>
        <Text color="success" dimColor>
          {'▰'.repeat(kinds.filter(k => k === 'current').length)}
        </Text>
        <Text color={EMPTY_SEGMENT}>{'▰'.repeat(kinds.filter(k => k === 'todo').length)}</Text>
      </Text>
    )
    // Jeden wiersz w kolumnach cache-bar: „praca 4:12” pod „cache ● 59:50”, „krok” pod „ctx”,
    // segmenty pod segmentami (co najmniej 5 miejsc, jak w cache-bar), dalej krok w toku i szacunek.
    const time = a.startedAt !== null && a.isWorking ? clock(now - a.startedAt) : ''
    // Desktop nie ucina tekstu w wierszu (łamał go na dwie linie), więc opis kroku przycinamy sami
    // do miejsca, które zostaje po kolumnach, liczbie, szacunku i odstępach.
    // Tor z robotem zajmuje na desktopie około 14 kolumn.
    const barCols = e.surface === 'desktop' ? 14 : LABEL_COLS + Math.max(MIN_CELLS, list.length)
    const used = LEAD_COLS + barCols + 2 + 2 * width + 3 * 3 + RIGHT_COLS + 3
    const fitted = fitLine(name, current && a.isWorking && a.label && a.label !== name ? a.label : '', (e.props.bodyColumns ?? 100) - used - 2)
    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" gap={3} alignItems="center">
          <Box width={LEAD_COLS} flexShrink={0}>
            <Text>
              <Text dimColor>praca </Text>
              {time ? <Text bold>{time.padStart(5)}</Text> : <Text dimColor>--:--</Text>}
            </Text>
          </Box>
          <Box flexDirection="row" flexShrink={0} alignItems="center">
            {e.surface === 'desktop' ? (
              // Desktop: robot na elektrycznym wózku jedzie po torze; jego miejsce to postęp listy.
              <Svg
                source={trackSvg(done / list.length, isFinished ? 'done' : a.isWorking ? 'run' : 'wait', frame)}
                alt={`krok ${isFinished ? list.length : stageOf(list)} z ${list.length}`}
                width={TRACK_PX_W}
                height={TRACK_PX_H}
              />
            ) : (
              <Box flexDirection="row">
                <Box width={LABEL_COLS} flexShrink={0}>
                  <Text dimColor>krok</Text>
                </Box>
                {/* Terminal: segmenty ▰ jak w cache-bar; krótszą listę dopełniają spacje. */}
                <Text>
                  {segments}
                  {list.length < MIN_CELLS ? ' '.repeat(MIN_CELLS - list.length) : ''}
                </Text>
              </Box>
            )}
            <Text>
              <Text bold> {String(isFinished ? list.length : stageOf(list)).padStart(width)}</Text>
              <Text dimColor>/{list.length}</Text>
            </Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0} height={1} overflow="hidden">
            <Text wrap="truncate-end">
              {isFinished ? <Text color="success">✓ </Text> : null}
              {fitted.name}
              <Text dimColor>{fitted.detail ? ` · ${fitted.detail}` : ''}</Text>
            </Text>
          </Box>
          {/* Wspólna prawa kolumna pasków (16, dosunięta do prawej): szacunek czasu do końca. */}
          <Box width={RIGHT_COLS} flexShrink={0} justifyContent="flex-end" paddingRight={1}>
            {eta !== null ? <Text dimColor>{eta < 1000 ? 'zaraz' : `~${clock(eta)}`}</Text> : null}
          </Box>
        </Box>
      </Box>
    )
  })
}
