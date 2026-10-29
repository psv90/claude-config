// cache-tax: podtrzymuje ciepły cache promptu w przerwach i raz zatrzymuje
// wysłanie na zimny cache, pokazując ile ono kosztuje.
// - Co `warmEveryMinutes` ciszy wysyła mały fork po transkrypcie: odczyt cache
//   odświeża jego godzinny TTL za ułamek ceny ponownego zapisu.
// - Gdy cache już wygasł, pierwsze wysłanie jest zatrzymywane z kosztem,
//   tekst wraca do pola; kolejny Enter wysyła.
// - Każde rozgrzanie i zatrzymanie trafia do dziennika: /cache-tax.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LogEntry } from '../types'

const lastReplyAt = atom({ plugin: 'cache-tax', key: 'lastReplyAt' } as const, null)
const model = atom({ plugin: 'cache-tax', key: 'model' } as const, null)
const isWorking = atom({ plugin: 'cache-tax', key: 'isWorking' } as const, false)
const warmups = atom({ plugin: 'cache-tax', key: 'warmups' } as const, 0)
const stoppedFor = atom({ plugin: 'cache-tax', key: 'stoppedFor' } as const, null)

const TTL_MS = 60 * 60_000
const LOG_KEY = 'log'
const WARM_PROMPT = '(Automatyczne podtrzymanie cache, zignoruj. Odpowiedz tylko: ok)'

// $ za MTok: [wejście, odczyt cache]. Zapis do cache 1h kosztuje 2× wejście.
const PRICES: [RegExp, number, number][] = [
  [/fable|mythos/, 10, 0.25],
  [/opus-5-5/, 4, 0.2],
  [/opus/, 5, 0.5],
  [/sonnet-5/, 2, 0.2],
  [/sonnet/, 3, 0.3],
  [/haiku-5/, 0.1, 0.01],
  [/haiku/, 1, 0.1],
]

function priceOf(id: string | null) {
  const row = PRICES.find(([match]) => id !== null && match.test(id)) ?? PRICES[1]!
  return { input: row[1], read: row[2] }
}

const usd = (n: number) => (n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`)
const kTok = (n: number) => `${Math.round(n / 1000)} tys. tokenów`

function minutesAgo(ms: number) {
  const m = Math.round(ms / 60_000)
  return m < 120 ? `${m} min` : `${Math.round(m / 60)} h`
}

async function addLog($: EngineInterface, entry: LogEntry) {
  const old = await $.store.get(LOG_KEY)
  const list = Array.isArray(old) ? (old as LogEntry[]) : []
  await $.store.set(LOG_KEY, [...list, entry].slice(-200))
}

async function contextTokens($: EngineInterface) {
  return (await $.session.usage()).context.tokens ?? 0
}

// Jedno podtrzymanie: fork czyta cały prefiks z cache i odświeża jego TTL.
async function warm($: EngineInterface, everyMs: number, maxWarmups: number) {
  const repliedAt = await read($, lastReplyAt)
  if (repliedAt === null || (await read($, isWorking))) return
  const now = await $.clock.now()
  const idle = now - repliedAt
  if (idle < everyMs || idle >= TTL_MS) return
  if ((await read($, warmups)) >= maxWarmups) return

  const tokens = await contextTokens($)
  const r = await $.model.fork({ prompt: WARM_PROMPT })
  if (!r.isAnswered) {
    await addLog($, { at: now, kind: 'warm-failed', tokens, usd: 0 })
    return
  }
  const price = priceOf(await read($, model))
  const read_ = r.usage.cache_read_input_tokens ?? 0
  const cost =
    (read_ * price.read + (r.usage.input_tokens ?? 0) * price.input + (r.usage.output_tokens ?? 0) * price.input * 5) /
    1_000_000
  await update($, lastReplyAt, () => now)
  await update($, warmups, n => n + 1)
  await addLog($, { at: now, kind: 'warm', tokens: read_ || tokens, usd: cost })
}

function logText(list: LogEntry[]) {
  if (list.length === 0) return 'Dziennik cache-tax jest pusty.'
  const fmt = (at: number) => new Date(at).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const warmed = list.filter(l => l.kind === 'warm')
  const stops = list.filter(l => l.kind === 'stop')
  const lines = list.slice(-15).map(l =>
    l.kind === 'warm'
      ? `${fmt(l.at)}  podtrzymano  ${kTok(l.tokens)}  ${usd(l.usd)}`
      : l.kind === 'stop'
        ? `${fmt(l.at)}  zatrzymano zimne wysłanie  ${kTok(l.tokens)}  ~${usd(l.usd)}`
        : `${fmt(l.at)}  podtrzymanie nie wyszło`,
  )
  const spent = warmed.reduce((s, l) => s + l.usd, 0)
  return [
    ...lines,
    '',
    `Podtrzymań: ${warmed.length} za ${usd(spent)}. Zatrzymań: ${stops.length}.`,
  ].join('\n')
}

export const register: Register = (on, options) => {
  const everyMs = Math.min(58, Math.max(5, Number(options.warmEveryMinutes ?? 50))) * 60_000
  const maxWarmups = Math.max(0, Math.round(Number(options.maxWarmups ?? 4)))

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.clock.every(60_000, () => void warm($, everyMs, maxWarmups))
    await $.command.register({ name: 'cache-tax', description: 'Dziennik podtrzymań cache i zatrzymanych zimnych wysłań' })
    return result
  })

  on('command.run', { command: 'cache-tax' }, async $ => {
    const list = await $.store.get(LOG_KEY)
    return { text: logText(Array.isArray(list) ? (list as LogEntry[]) : []) }
  })

  on('turn.start', async ($, e, next) => {
    await update($, isWorking, () => true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    const now = await $.clock.now()
    await update($, isWorking, () => false)
    await update($, lastReplyAt, () => now)
    await update($, warmups, () => 0)
    if (e.usage?.model) await update($, model, () => e.usage?.model ?? null)
    return next(e)
  })

  // Zimne wysłanie: zatrzymane raz na każdą wygasłą przerwę.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' || e.text.trimStart().startsWith('/')) return next(e)
    const repliedAt = await read($, lastReplyAt)
    if (repliedAt === null) return next(e)
    const now = await $.clock.now()
    const idle = now - repliedAt
    if (idle < TTL_MS || (await read($, stoppedFor)) === repliedAt) return next(e)

    await update($, stoppedFor, () => repliedAt)
    const tokens = await contextTokens($)
    const price = priceOf(await read($, model))
    const cost = (tokens * price.input * 2) / 1_000_000
    await addLog($, { at: now, kind: 'stop', tokens, usd: cost })
    const text = e.text
    $.clock.after(100, () => void $.prompt.fill({ text }))
    return {
      drop: `Cache wygasł ${minutesAgo(idle - TTL_MS)} temu. To wysłanie zapisze go od nowa: ${kTok(tokens)} ≈ ${usd(cost)}. Enter wyśle mimo to.`,
    }
  })
}
