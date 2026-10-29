// rachunek: /rachunek pokazuje, ile kosztowała rozmowa, tura po turze:
// tokeny wejścia, wyjścia, odczyt i zapis cache, szacunek w dolarach,
// najdroższa tura i najcięższy wynik narzędzia (np. odczyt całego pliku).
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Heavy, TurnRow } from '../types'

const rows = atom({ plugin: 'rachunek', key: 'rows' } as const, [])
const prompt = atom({ plugin: 'rachunek', key: 'prompt' } as const, '')
const heavy = atom({ plugin: 'rachunek', key: 'heavy' } as const, null)

// $ za MTok: [wejście, wyjście, odczyt cache]. Zapis cache 1h = 2× wejście.
const PRICES: [RegExp, number, number, number][] = [
  [/fable|mythos/, 10, 50, 0.25],
  [/opus-5-5/, 4, 20, 0.2],
  [/opus/, 5, 25, 0.5],
  [/sonnet-5/, 2, 10, 0.2],
  [/sonnet/, 3, 15, 0.3],
  [/haiku-5/, 0.1, 0.5, 0.01],
  [/haiku/, 1, 5, 0.1],
]

export function costOf(model: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number }) {
  const [, input, output, cacheRead] = PRICES.find(([re]) => re.test(model)) ?? PRICES[1]!
  return (u.input * input + u.output * output + u.cacheRead * cacheRead + u.cacheWrite * input * 2) / 1_000_000
}

const usd = (n: number) => (n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`)
const tok = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

function toolLabel(tool: string, input: Record<string, unknown>) {
  const path = String(input.file_path ?? input.path ?? input.notebook_path ?? '')
  const name = path.split(/[\\/]/).pop()
  if (name) return `${tool} ${name}`
  const cmd = String(input.command ?? input.pattern ?? input.url ?? input.query ?? '').slice(0, 40)
  return cmd ? `${tool} ${cmd}` : tool
}

export function bill(list: TurnRow[], realUsd: number | null): string {
  if (list.length === 0) return 'W tej rozmowie nie było jeszcze żadnej tury.'
  const lines = list.map((r, i) => {
    const who = r.agent ? 'agent' : `${i + 1}.`.padStart(4)
    const what = (r.agent ? '' : r.prompt).replace(/\s+/g, ' ').slice(0, 38).padEnd(38)
    const tokens = `we ${tok(r.input + r.cacheRead + r.cacheWrite)}, wy ${tok(r.output)}`
    return `${who} ${what} ${tokens.padEnd(18)} ${usd(r.usd).padStart(7)}`
  })
  const total = list.reduce((s, r) => s + r.usd, 0)
  const worst = list.reduce((a, b) => (b.usd > a.usd ? b : a))
  const heaviest = list.map(r => r.heavy).filter((h): h is Heavy => h !== null).reduce<Heavy | null>((a, b) => (a && a.tokens >= b.tokens ? a : b), null)
  const read_ = list.reduce((s, r) => s + r.cacheRead, 0)
  const all = list.reduce((s, r) => s + r.input + r.cacheRead + r.cacheWrite, 0)
  return [
    ...lines,
    '',
    `Razem ~${usd(total)}${realUsd !== null ? ` (licznik Claude Code: ${usd(realUsd)})` : ''}. Z cache przeczytano ${all ? Math.round((read_ / all) * 100) : 0}% wejścia.`,
    `Najdroższa tura: „${worst.prompt.replace(/\s+/g, ' ').slice(0, 60)}” — ${usd(worst.usd)}.`,
    heaviest ? `Najcięższy odczyt: ${heaviest.label} — ok. ${tok(heaviest.tokens)} tokenów.` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'rachunek', description: 'Koszt rozmowy tura po turze' })
    return result
  })

  on('command.run', { command: 'rachunek' }, async $ => {
    const cost = (await $.session.usage()).cost
    return { text: bill(await read($, rows), cost ? cost.usd : null) }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, prompt, () => e.text)
    await update($, heavy, () => null)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    const text = 'text' in result && typeof result.text === 'string' ? result.text : ''
    const tokens = Math.round(text.length / 3.5)
    const current = await read($, heavy)
    if (tokens > 2000 && (!current || tokens > current.tokens)) {
      const h: Heavy = { label: toolLabel(String(e.tool), e as unknown as Record<string, unknown>), tokens }
      await update($, heavy, () => h)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u) {
      const parts = {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
      }
      const row: TurnRow = {
        at: await $.clock.now(),
        prompt: e.agentId ? '' : await read($, prompt),
        agent: Boolean(e.agentId),
        model: u.model,
        ...parts,
        usd: costOf(u.model, parts),
        heavy: e.agentId ? null : await read($, heavy),
      }
      await update($, rows, list => [...list, row].slice(-300))
    }
    return next(e)
  })
}
