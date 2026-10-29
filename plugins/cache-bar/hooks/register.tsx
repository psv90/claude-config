import { atom, read, update } from 'claude-code'
import type { Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Limit, Usage } from '../types'

const lastReplyAt = atom({ plugin: 'cache-bar', key: 'lastReplyAt' } as const, null)
const usage = atom({ plugin: 'cache-bar', key: 'usage' } as const, null)

const HANDOFF_FROM = 50
const CTX_SCOPE = 'cache-bar-ctx'
// Kolumny wspólne z progres-bar: „cache ● 59:50” i etykieta przed segmentami.
const LEAD_COLS = 13
// Prawa kolumna wspólna z pamięcią projektu, later, progres-barem i agentami.
const RIGHT_COLS = 16
// Zapas (kolumny) za ostatnim licznikiem na desktopie.
const SLACK_COLS = 6
const LABEL_COLS = 4
// Pięć segmentów po 20%: pełny ▰ w kolorze progu, połówka ▰ w tym samym kolorze
// przygaszona (co 10%), pusty ▰ szary i przygaszony (obrys ▱ świecił na biało).
const BAR_CELLS = 5
// Pusty segment: ciemna szarość tuż jaśniejsza od tła paska (#262624), ta sama w progres-bar.
const EMPTY_SEGMENT = '#3D3D3A'

const toUsage = (context: SessionContextUsage, rateLimits: SessionRateLimit[]): Usage => ({
  contextPercent: context.percent ?? null,
  contextTokens: context.tokens ?? null,
  contextWindow: context.window ?? null,
  limits: rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
})

// Progi: do 50% zielony, od 50% żółty, od 80% czerwony.
export const colorFor = (percent: number) => (percent >= 80 ? 'error' : percent >= 50 ? 'warning' : 'success')

// Tokeny w tysiącach: 124000 -> „124k”, 1000000 -> „1M”.
export const kTokens = (n: number) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}k`)

export const bar = (percent: number) => {
  const halves = Math.max(0, Math.min(BAR_CELLS * 2, Math.round((percent / 100) * BAR_CELLS * 2)))
  const full = Math.floor(halves / 2)
  const half = halves % 2
  return { filled: '▰'.repeat(full), half: '▰'.repeat(half), empty: '▰'.repeat(BAR_CELLS - full - half) }
}


const clockText = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

// Czas do resetu: „46 min”, „3 h 46 min”, a powyżej doby dni i godziny („4 d 3 h”).
export const resetText = (resetsAt: string | undefined, now: number) => {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - now
  if (!(ms > 0)) return ''
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return ` ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? ` ${hours} h ${minutes % 60} min` : ` ${hours} h`
  const days = Math.floor(hours / 24)
  return hours % 24 ? ` ${days} d ${hours % 24} h` : ` ${days} d`
}

// Termometr cache (desktop) zamiast kropki: słupek opada z odliczaniem i zmienia kolor -
// gorący czerwony w trakcie pracy, potem pomarańczowy, od połowy czasu niebieski, a zimny
// zamarza z płatkiem śniegu. Statyczny obraz w klatkach (pasek i tak przerysowuje się co sekundę).
export type Heat = 'hot' | 'warm' | 'cool' | 'cold' | 'none'
const HEAT = { hot: '#E05A4F', warm: '#E3A33A', cool: '#6AA5E8', cold: '#B5D4F4', none: '#55544F' } as const
export const THERMO_W = 26
export const THERMO_H = 30

export function heatOf(isWorking: boolean, leftRatio: number | null): Heat {
  if (isWorking) return 'hot'
  if (leftRatio === null) return 'none'
  if (leftRatio <= 0) return 'cold'
  return leftRatio > 0.5 ? 'warm' : 'cool'
}

export function thermoSvg(heat: Heat, leftRatio: number, frame: number): string {
  const c = HEAT[heat]
  const level = heat === 'hot' ? 1 : heat === 'cold' || heat === 'none' ? 0 : Math.min(1, Math.max(0.08, leftRatio))
  const h = 18 * level
  const column = h > 0 ? `<rect x="9.5" y="${(22 - h).toFixed(1)}" width="3" height="${(h + 1).toFixed(1)}" rx="1.5" fill="${c}"/>` : ''
  const waves =
    heat === 'hot'
      ? `<path d="M4 ${frame % 2 ? 5 : 7}q-1 2 0 4M18 ${frame % 2 ? 7 : 5}q1 2 0 4" stroke="${c}" stroke-width=".9" fill="none" stroke-linecap="round"/>`
      : ''
  const flake =
    heat === 'cold'
      ? `<g transform="translate(21 6) rotate(${(frame * 30) % 360})"><path d="M0-4.5v9M-3.9-2.25l7.8 4.5M-3.9 2.25l7.8-4.5" stroke="${c}" stroke-width="1.1" stroke-linecap="round"/></g>`
      : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${THERMO_W}" height="${THERMO_H}" viewBox="0 0 ${THERMO_W} ${THERMO_H}">` +
    `<rect x="8" y="2" width="6" height="20" rx="3" fill="#1F1F1D" stroke="#6B6A65" stroke-width=".8"/>` +
    `${column}<circle cx="11" cy="24" r="4.5" fill="${c}" stroke="#6B6A65" stroke-width=".8"/>` +
    `<path d="M16 9h2M16 13h2M16 17h2" stroke="#55544F" stroke-width=".8"/>${waves}${flake}</svg>`
  )
}

// Zegar limitu (desktop) zamiast segmentów: łuk w kolorze progu i wskazówka, która lekko drga,
// a od 80% trzęsie się przy czerwonym polu. Statyczny obraz w klatkach, jak termometr.
export const GAUGE_W = 36
export const GAUGE_H = 24
// Rozmiar w pasku (CSS px).
const GAUGE_PX_W = 30
const GAUGE_PX_H = 20
const GAUGE_COLOR: Record<string, string> = { success: '#4EBA65', warning: '#E3A33A', error: '#E05A4F' }

// Punkt na łuku dla ułamka 0..1: od lewej (0) przez górę do prawej (1), środek (18, 20), promień 14.
function arcPoint(f: number, r = 14) {
  const a = Math.PI * Math.min(1, Math.max(0, f))
  return { x: 18 - r * Math.cos(a), y: 20 - r * Math.sin(a) }
}

export function gaugeSvg(percent: number | null, frame: number): string {
  const track = `<path d="M4 20 A14 14 0 0 1 32 20" stroke="#3D3D3A" stroke-width="4" fill="none" stroke-linecap="round"/>`
  if (percent === null) {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${GAUGE_W}" height="${GAUGE_H}" viewBox="0 0 ${GAUGE_W} ${GAUGE_H}">` +
      `${track}<circle cx="18" cy="20" r="2" fill="#55544F"/></svg>`
    )
  }
  const f = percent / 100
  const c = GAUGE_COLOR[colorFor(percent)]!
  const end = arcPoint(f)
  const fill = f > 0.005 ? `<path d="M4 20 A14 14 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}" stroke="${c}" stroke-width="4" fill="none" stroke-linecap="round"/>` : ''
  // Drganie wskazówki: delikatne w normie, wyraźne od 80%.
  const jitter = percent >= 80 ? (frame % 2 === 0 ? -0.035 : 0.035) : [0, 0.012, 0, -0.012][frame % 4]!
  const tip = arcPoint(f + jitter, 11.5)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${GAUGE_W}" height="${GAUGE_H}" viewBox="0 0 ${GAUGE_W} ${GAUGE_H}">` +
    `${track}${fill}<line x1="18" y1="20" x2="${tip.x.toFixed(2)}" y2="${tip.y.toFixed(2)}" stroke="#F5F4EF" stroke-width="1.4" stroke-linecap="round"/>` +
    `<circle cx="18" cy="20" r="2" fill="#F5F4EF"/></svg>`
  )
}

const LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: '$' }

export const register: Register = (on, options) => {
  const ttlMs = options.cacheTtl === '5m' ? 5 * 60_000 : 60 * 60_000

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const current = await $.session.usage()
    await update($, usage, () => toUsage(current.context, current.rateLimits))
    // Odliczanie cache: przerysowanie co sekundę.
    $.clock.every(1000, () => $.ui.invalidate('ui.render'))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    const now = await $.clock.now()
    await update($, lastReplyAt, () => now)
    return next(e)
  })

  // Fork po transkrypcie (np. podtrzymanie z cache-tax) też odświeża cache.
  on('model.fork', async ($, e, next) => {
    const result = await next(e)
    const reply = 'value' in result ? result.value : undefined
    if (reply?.isAnswered && reply.usage.cache_read_input_tokens > 0) {
      const now = await $.clock.now()
      await update($, lastReplyAt, () => now)
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => toUsage(e.context, e.rateLimits))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text, Svg } = $.ui.resolve(e)
    const now = await $.clock.now()
    const repliedAt = await read($, lastReplyAt)
    const current = await read($, usage)
    const leftRatio = repliedAt === null ? null : (repliedAt + ttlMs - now) / ttlMs
    const heat = heatOf(e.props.isWorking, leftRatio)
    // Desktop: termometr zamiast kropki (stała szerokość, więc nic się nie przesuwa).
    const thermo =
      e.surface === 'desktop' ? (
        <Svg source={thermoSvg(heat, leftRatio ?? 0, Math.floor(now / 1000))} alt={`cache: ${heat}`} width={20} height={23} />
      ) : null

    // Segmenty: pełne w kolorze, połówka w tym samym kolorze przygaszona, puste wyciszone.
    const segments = (percent: number | null, color: string) => {
      if (percent === null) return <Text color={EMPTY_SEGMENT}>{'▰'.repeat(BAR_CELLS)}</Text>
      const s = bar(percent)
      return (
        <Text>
          <Text color={color}>{s.filled}</Text>
          <Text color={color} dimColor>
            {s.half}
          </Text>
          <Text color={EMPTY_SEGMENT}>{s.empty}</Text>
        </Text>
      )
    }

    // Cache: znak (kropka w terminalu, termometr na desktopie) niesie kolor, czas zostaje zwykłym tekstem.
    let mark = <Text dimColor>○</Text>
    let label = <Text dimColor> --:--</Text>
    if (e.props.isWorking) {
      mark = <Text color="success">●</Text>
      label = <Text dimColor> teraz</Text>
    } else if (repliedAt !== null) {
      const left = repliedAt + ttlMs - now
      const usedPercent = 100 - (left / ttlMs) * 100
      mark = <Text color={left > 0 ? colorFor(usedPercent) : 'error'}>{left > 0 ? '●' : '○'}</Text>
      label = (
        <Text bold={left > 0} dimColor={!(left > 0)}>
          {' '}
          {left > 0 ? clockText(left).padStart(5) : 'zimny'}
        </Text>
      )
    }
    const cache = (
      <Box flexDirection="row" alignItems="center">
        <Text dimColor>cache </Text>
        {thermo ?? mark}
        {label}
      </Box>
    )

    const ctx = current?.contextPercent ?? null
    const tokens = current?.contextTokens ?? null
    const window = current?.contextWindow ?? null
    const limits: Limit[] = current?.limits ?? []
    const canHover = e.surface === 'desktop'

    // Etykieta wyciszona w kolumnie o stałej szerokości, kolor tylko na segmentach, liczba zwykła.
    // Te same szerokości (LEAD_COLS, LABEL_COLS) ma progres-bar, więc segmenty obu pasków stoją w jednej linii pionowej.
    // Desktop: zegar ze wskazówką zamiast segmentów; terminal: segmenty.
    const meter = (key: string, label: string, percent: number | null, tail = '') => (
      <Box key={key} flexDirection="row" flexShrink={0} alignItems="center">
        <Box width={LABEL_COLS} flexShrink={0}>
          <Text dimColor>{label}</Text>
        </Box>
        {e.surface === 'desktop' ? (
          <Svg source={gaugeSvg(percent, Math.floor(now / 1000))} alt={`${label} ${percent === null ? '--' : Math.round(percent)}%`} width={GAUGE_PX_W} height={GAUGE_PX_H} />
        ) : null}
        <Text>
          {e.surface === 'desktop' ? null : segments(percent, colorFor(percent ?? 0))}
          {percent === null ? (
            <Text dimColor>  --%</Text>
          ) : (
            <Text bold> {String(Math.round(percent)).padStart(3)}%</Text>
          )}
          {tail ? <Text dimColor>{tail}</Text> : null}
        </Text>
      </Box>
    )

    const separator = (key: string) => (
      <Text key={key} color="#55544F">
        │
      </Text>
    )

    const below = await next(e).catch(() => null)
    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" gap={2} alignItems="center">
          <Box width={LEAD_COLS} flexShrink={0}>
            {cache}
          </Box>
          {/* Środek (liczniki) zajmuje resztę wiersza i w razie ciasnoty ucina się z prawej, zamiast
              wypychać prawą kolumnę poza pasek. Między wskaźnikami wyciszone pionowe separatory. */}
          <Box flexDirection="row" gap={2} alignItems="center" flexGrow={1} flexShrink={1} minWidth={0} height={1} overflow="hidden">
            {separator('sep-cache')}
            {/* Najechanie na ctx odsłania tokeny przy prawej krawędzi, w miejscu pustego odstępu: nic się nie przesuwa. */}
            <Box key="ctx-meter" flexShrink={0} {...(canHover ? { hover: { scope: CTX_SCOPE } } : {})}>
              {meter('ctx', 'ctx', ctx)}
            </Box>
            {limits.flatMap(limit => [
              separator(`sep-${limit.kind}`),
              meter(limit.kind, LIMIT_LABELS[limit.kind] ?? limit.kind, limit.percentUsed, resetText(limit.resetsAt, now)),
            ])}
            {/* Zapas za ostatnim licznikiem: desktop rysuje tekst i zegary szerzej, niż liczy kolumny,
                więc bez niego koniec („2 d 19 h”) wypadał poza ucięty środek wiersza. */}
            {e.surface === 'desktop' ? <Box key="slack" width={SLACK_COLS} flexShrink={0} /> : null}
            <Box flexGrow={1} />
            {canHover && tokens !== null && window !== null ? (
              <Box key="ctx-tokens" display="none" hover={{ scope: CTX_SCOPE, display: 'flex' }}>
                <Text>
                  <Text bold>{kTokens(tokens)}</Text>
                  <Text dimColor> / {kTokens(window)}</Text>
                </Text>
              </Box>
            ) : null}
          </Box>
          {/* Wspólna prawa kolumna pasków (16, dosunięta do prawej). */}
          <Box width={RIGHT_COLS} flexShrink={0} justifyContent="flex-end">
          {ctx !== null && ctx >= HANDOFF_FROM ? (
            <Button
              key="handoff"
              label="handoff"
              hotkey="h"
              plain
              dimColor
              // Prompt z pluginu nie jest rozwijany w slash-komendę, więc komenda idzie przez $.command.run.
              onPress={() =>
                void $.command
                  .run({ command: 'session-handoff:handoff' })
                  .catch(err => $.ui.toast(`handoff: ${err instanceof Error ? err.message : String(err)}`))
              }
            />
          ) : null}
          </Box>
        </Box>
      </Box>
    )
  })
}
