// agenci: pasek nad promptem z agentami tej sesji (subagenci, teammates, agenci
// odpaleni przez inne mody).
// - Na desktopie po lewej ekipa robotów: pracujący pomarańczowy podskakuje i mruga
//   anteną, skończony zielony się uśmiecha, przerwany czerwony ma krzyżyki zamiast oczu.
//   W terminalu zamiast robotów kręcący się znak.
// - W trakcie pracy: wiersz na agenta (typ, zadanie, bieżąca czynność, czas), pracujący
//   pierwsi, resztę miejsca biorą ostatnio skończeni.
// - Gdy nikt nie pracuje: jeden wiersz z liczbą skończonych i ostatnim z nich. Skończeni
//   zostają do końca sesji.
// - Lista z $.agent.list(), odświeżana co sekundę tylko wtedy, gdy ktoś pracuje;
//   start budzi ją hook agent.spawn.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow } from '../types'

const rows = atom({ plugin: 'agenci', key: 'rows' } as const, [])

// Kolumny wspólne z cache-bar i progres-bar: lewa kolumna ma 13 znaków.
const LEAD_COLS = 13
const TYPE_COLS = 16
const MAX_ROWS = 4
const ENDED = new Set<AgentRow['status']>(['completed', 'failed', 'killed'])

const fileName = (p: unknown) => String(p ?? '').split(/[\\/]/).pop() ?? ''

// Krótki opis tego, co agent właśnie robi.
export function labelOf(tool: string, input: Record<string, unknown>): string {
  if (/^(Read|NotebookRead)$/.test(tool)) return `czyta ${fileName(input.file_path ?? input.notebook_path)}`
  if (/^(Grep|Glob)$/.test(tool)) return 'przeszukuje pliki'
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)) return `edytuje ${fileName(input.file_path ?? input.notebook_path)}`
  if (/^(Bash|PowerShell)$/.test(tool)) {
    const cmd = String(input.command ?? '').replace(/\s+/g, ' ').trim()
    return cmd ? `uruchamia ${cmd}` : 'uruchamia polecenie'
  }
  if (/^Web(Fetch|Search)$/.test(tool)) return 'szuka w sieci'
  if (tool === 'Agent') return 'zleca agentowi'
  if (tool.startsWith('mcp__')) return `korzysta z ${tool.split('__')[1] ?? 'MCP'}`
  return tool
}

type Info = { id: string; type: string; description: string; status: AgentRow['status'] }

// Nowa lista wierszy: znane zachowują start i czynność, nowe dostają `now`,
// skończone dostają chwilę końca i zostają na liście.
export function merge(prev: AgentRow[], list: Info[], now: number): AgentRow[] {
  const byId = new Map(prev.map(r => [r.id, r]))
  const seen = new Set<string>()
  const out: AgentRow[] = []
  for (const a of list) {
    seen.add(a.id)
    const old = byId.get(a.id)
    const isEnded = ENDED.has(a.status)
    // Agent skończony, zanim go zobaczyliśmy (np. sprzed wznowienia sesji): pomijamy.
    if (!old && isEnded) continue
    out.push({
      id: a.id,
      type: a.type,
      description: a.description,
      status: a.status,
      startedAt: old?.startedAt ?? now,
      endedAt: isEnded ? (old?.endedAt ?? now) : null,
      label: isEnded ? '' : (old?.label ?? ''),
    })
  }
  // Agent, którego silnik już wyrzucił z listy: zostaje jako skończony.
  for (const r of prev) {
    if (seen.has(r.id)) continue
    out.push(r.endedAt !== null ? r : { ...r, status: 'completed', endedAt: now, label: '' })
  }
  return out
}

// Co pokazać: pracujący pierwsi, potem ostatnio skończeni; `rest` to ci, co się nie zmieścili.
export function pick(list: AgentRow[], max = MAX_ROWS): { shown: AgentRow[]; rest: number; working: number } {
  const working = list.filter(r => r.endedAt === null)
  const ended = list.filter(r => r.endedAt !== null).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  const shown = [...working, ...ended].slice(0, max)
  return { shown, rest: list.length - shown.length, working: working.length }
}

const same = (a: AgentRow[], b: AgentRow[]) => JSON.stringify(a) === JSON.stringify(b)

// Robot w kolorze stanu. Kolory średnie, czytelne na jasnym i ciemnym tle.
const COLORS = { run: '#D97757', done: '#1D9E75', fail: '#E24B4A', wait: '#888780' } as const
type Look = keyof typeof COLORS

export function lookOf(r: AgentRow): Look {
  if (r.endedAt !== null) return r.status === 'completed' ? 'done' : 'fail'
  return r.status === 'running' || r.status === 'pending' ? 'run' : 'wait'
}

const ROBOT_W = 22
const ROBOT_H = 30
const ROBOTS = 4

function robot(look: Look, x: number, frame: number): string {
  const c = COLORS[look]
  const ink = '#2A2A28'
  // Pracujący podskakuje co sekundę, każdy w swoim takcie; co czwartą klatkę mruga.
  const dy = look === 'run' && frame % 2 === 1 ? -2 : 0
  const blink = look === 'run' && frame % 4 === 3
  const light = look === 'run' ? (frame % 2 === 0 ? '#FFD27A' : c) : c
  let eyes: string
  if (look === 'done') eyes = `<path d="M6 15.5q2-3 4 0M12 15.5q2-3 4 0" stroke="${ink}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
  else if (look === 'fail') eyes = `<path d="M6.5 12.5l3 3m0-3l-3 3M12.5 12.5l3 3m0-3l-3 3" stroke="${ink}" stroke-width="1.5" stroke-linecap="round"/>`
  else if (blink) eyes = `<path d="M6.5 14.5h3M12.5 14.5h3" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>`
  else if (look === 'wait') eyes = `<path d="M6.5 14.5h3M12.5 14.5h3" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="15.5" r="1.2" fill="${ink}"/><circle cx="14" cy="15.5" r="1.2" fill="${ink}"/>`
  else eyes = `<circle cx="8" cy="14.5" r="2" fill="${ink}"/><circle cx="14" cy="14.5" r="2" fill="${ink}"/><circle cx="8.7" cy="13.8" r=".6" fill="#fff"/><circle cx="14.7" cy="13.8" r=".6" fill="#fff"/>`
  return (
    `<g transform="translate(${x} ${dy})">` +
    `<line x1="11" y1="3.5" x2="11" y2="8" stroke="${c}" stroke-width="1.5"/>` +
    `<circle cx="11" cy="3" r="2.2" fill="${light}"/>` +
    `<rect x="1" y="12" width="2" height="5" rx="1" fill="${c}"/><rect x="19" y="12" width="2" height="5" rx="1" fill="${c}"/>` +
    `<rect x="2.5" y="8" width="17" height="13" rx="4" fill="${c}"/>` +
    eyes +
    `<rect x="6" y="22" width="10" height="7" rx="2" fill="${c}" opacity=".75"/>` +
    `</g>`
  )
}

// Ekipa robotów: do 4, przy większej liczbie 3 roboty i „+N”.
export function crewSvg(list: AgentRow[], frame: number): string {
  const many = list.length > ROBOTS
  const drawn = list.slice(0, many ? ROBOTS - 1 : ROBOTS)
  const body = drawn.map((r, i) => robot(lookOf(r), i * (ROBOT_W + 2), frame + i)).join('')
  const more = many
    ? `<text x="${drawn.length * (ROBOT_W + 2) + 2}" y="20" font-family="system-ui,sans-serif" font-size="11" font-weight="600" fill="#888780">+${list.length - drawn.length}</text>`
    : ''
  const w = ROBOTS * (ROBOT_W + 2)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ROBOT_H}" viewBox="0 0 ${w} ${ROBOT_H}">${body}${more}</svg>`
}

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const cut = (s: string, n: number) => (n <= 0 ? '' : s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)

const SPIN = ['◐', '◓', '◑', '◒']

// Odświeża listę; stan zapisuje tylko przy zmianie.
async function refresh($: EngineInterface): Promise<void> {
  const list = await $.agent.list().catch(() => [] as Info[])
  const now = await $.clock.now()
  const before = await read($, rows)
  const after = merge(before, list, now)
  if (!same(before, after)) await update($, rows, () => after)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    // Co sekundę: lista, czas pracy i klatka robotów, tylko gdy ktoś pracuje.
    $.clock.every(1000, () => {
      void (async () => {
        if (!(await read($, rows)).some(r => r.endedAt === null)) return
        await refresh($)
        $.ui.invalidate('ui.render')
      })()
    })
    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    await refresh($).catch(() => undefined)
    return result
  })

  // Czynność agenta: ostatnie narzędzie, które wywołał w swojej pętli.
  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      const label = labelOf(String(e.tool), e as unknown as Record<string, unknown>)
      // Błąd paska nigdy nie zatrzymuje narzędzia agenta.
      await (async () => {
        const list = await read($, rows)
        if (list.some(r => r.id === id && r.label !== label)) {
          await update($, rows, l => l.map(r => (r.id === id ? { ...r, label } : r)))
        }
      })().catch(() => undefined)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, rows)
    if (e.props.hasSurvey || list.length === 0) return next(e)

    const { Box, Text, Svg } = $.ui.resolve(e)
    const below = await next(e).catch(() => null)
    const now = await $.clock.now()
    const frame = Math.floor(now / 1000)
    const isTerminal = e.surface === 'terminal'
    const { shown, rest, working } = pick(list)
    const cols = e.props.bodyColumns ?? 100
    // Desktop nie ucina tekstu w wierszu, więc opis przycinamy sami do miejsca po kolumnach.
    const room = cols - LEAD_COLS - 2 - TYPE_COLS - 6 - 2 * 3 - 2

    const lead = isTerminal ? (
      <Text>
        <Text dimColor>agenci </Text>
        <Text bold>{String(working).padStart(2)}</Text>
      </Text>
    ) : (
      <Svg
        source={crewSvg(pick(list, list.length).shown, frame)}
        alt={`agenci: ${working} pracuje, ${list.length - working} skończonych`}
        width={ROBOTS * (ROBOT_W + 2)}
        height={ROBOT_H}
      />
    )

    const mark = (r: AgentRow) => {
      const look = lookOf(r)
      if (look === 'done') return <Text color="success">✓ </Text>
      if (look === 'fail') return <Text color="error">✗ </Text>
      if (look === 'wait') return <Text dimColor>● </Text>
      return <Text color="claude">{isTerminal ? SPIN[frame % SPIN.length] : '●'} </Text>
    }

    // Nikt nie pracuje: jeden wiersz z podsumowaniem.
    if (working === 0) {
      const last = shown[0]!
      const failed = list.filter(r => lookOf(r) === 'fail').length
      const head = `${list.length} ${list.length === 1 ? 'skończony' : 'skończonych'}${failed ? `, ${failed} z błędem` : ''}`
      const lastText = cut(last.description || last.type, room - head.length)
      return (
        <Box flexDirection="column">
          {below}
          <Box flexDirection="row" gap={3} alignItems="center">
            <Box width={LEAD_COLS} flexShrink={0}>
              {lead}
            </Box>
            <Box flexGrow={1} flexShrink={1} minWidth={0} height={1} overflow="hidden">
              <Text wrap="truncate-end">
                <Text>{head}</Text>
                <Text dimColor> · ostatni </Text>
                {mark(last)}
                <Text dimColor>{lastText}</Text>
              </Text>
            </Box>
            {/* Wspólna prawa kolumna pasków (16, dosunięta do prawej); zwykły tekst o kolumnę od krawędzi, bo natywne przyciski w innych paskach mają z prawej własny odstęp. */}
            <Box width={16} flexShrink={0} justifyContent="flex-end" paddingRight={1}>
              <Text dimColor>{clock((last.endedAt ?? now) - last.startedAt)}</Text>
            </Box>
          </Box>
        </Box>
      )
    }

    const row = (r: AgentRow) => {
      const isEnded = r.endedAt !== null
      const time = clock((r.endedAt ?? now) - r.startedAt)
      const task = r.description || r.type
      const detail = isEnded ? (r.status === 'completed' ? 'gotowe' : r.status === 'killed' ? 'zatrzymany' : 'błąd') : r.status === 'idle' ? 'czeka' : r.label
      const taskText = cut(task, room)
      const detailText = detail ? cut(detail, room - taskText.length - 3) : ''
      return (
        <Box key={r.id} flexDirection="row" gap={3}>
          <Box width={TYPE_COLS} flexShrink={0}>
            <Text>
              {mark(r)}
              <Text dimColor>{cut(r.type, TYPE_COLS - 2)}</Text>
            </Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0} height={1} overflow="hidden">
            <Text wrap="truncate-end">
              <Text dimColor={isEnded}>{taskText}</Text>
              <Text dimColor>{detailText ? ` · ${detailText}` : ''}</Text>
            </Text>
          </Box>
          <Box width={16} flexShrink={0} justifyContent="flex-end" paddingRight={1}>
            <Text bold={!isEnded} dimColor={isEnded}>
              {time}
            </Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" gap={3}>
          <Box width={LEAD_COLS} flexShrink={0}>
            {lead}
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
            {shown.map(row)}
            {rest > 0 ? <Text dimColor>+{rest} wcześniej</Text> : null}
          </Box>
        </Box>
      </Box>
    )
  })
}
