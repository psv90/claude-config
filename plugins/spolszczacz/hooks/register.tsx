// spolszczacz: /spolszcz <projekt> otwiera panel z postępem tłumaczenia gry.
// Rozpoznaje układ partii z Esoteric Ebb: work/jobs*/<id>.json → work/done*/<id>.json
// (ten sam przyrostek), liczy partie i słowa, a jeśli projekt ma tools/postep.py,
// pokazuje jego linię RAZEM. „Następna partia” wysyła prompt, który wznawia pracę
// od pierwszej nieprzetłumaczonej partii.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Pair, Progress } from '../types'

const PANE = 'spolszczacz'
const ROOT = 'E:\\Clode code\\VideoLiblary\\Projekty'
const progress = atom({ plugin: 'spolszczacz', key: 'progress' } as const, null)

const join = (...parts: string[]) => parts.join('\\')
const isTranslation = (name: string) => /^(spolszczenie|tłumaczenie|tlumaczenie)/i.test(name)

export function wordsOf(job: unknown): number {
  const lines = (job as { lines?: { en?: unknown }[] })?.lines ?? []
  return lines.reduce((n, l) => n + (String(l.en ?? '').match(/\S+/g)?.length ?? 0), 0)
}

// Pary katalogów jobs*/done* o tym samym przyrostku.
export function pairsIn(names: string[]) {
  return names
    .filter(n => /^jobs/.test(n))
    .map(jobs => ({ jobs, done: `done${jobs.slice(4)}` }))
    .filter(p => names.includes(p.done))
}

async function projects($: EngineInterface) {
  const list = await $.fs.list(ROOT)
  return list.filter(e => e.kind === 'dir' && isTranslation(e.name)).map(e => e.name)
}

async function jsonNames($: EngineInterface, dir: string) {
  if (!(await $.fs.exists(dir))) return []
  return (await $.fs.list(dir)).filter(e => e.name.endsWith('.json')).map(e => e.name.slice(0, -5)).sort()
}

async function measure($: EngineInterface, name: string) {
  const dir = join(ROOT, name)
  const work = join(dir, 'work')
  const names = (await $.fs.exists(work)) ? (await $.fs.list(work)).map(e => e.name) : []
  const pairs: Pair[] = []
  for (const p of pairsIn(names)) {
    const jobs = await jsonNames($, join(work, p.jobs))
    const done = new Set(await jsonNames($, join(work, p.done)))
    const left = jobs.filter(j => !done.has(j))
    pairs.push({ ...p, total: jobs.length, finished: jobs.length - left.length, wordsLeft: null, next: left[0] ?? null })
  }
  const hasStyle = await $.fs.exists(join(work, 'STYL.md'))
  const base: Progress = { name, dir, pairs, summary: '', hasStyle, isCounting: true }
  await update($, progress, () => base)

  // Linia RAZEM z własnego skryptu projektu, jeśli jest.
  let summary = ''
  if (await $.fs.exists(join(dir, 'tools', 'postep.py'))) {
    const r = await $.process.run(['python', join(dir, 'tools', 'postep.py')], { cwd: dir, timeoutMs: 120_000 }).catch(() => null)
    summary = r?.stdout.split('\n').find(l => /RAZEM/.test(l))?.trim() ?? ''
  }

  // Słowa w nieprzetłumaczonych partiach.
  const counted: Pair[] = []
  for (const p of pairs) {
    const jobs = await jsonNames($, join(work, p.jobs))
    const done = new Set(await jsonNames($, join(work, p.done)))
    let words = 0
    for (const j of jobs.filter(x => !done.has(x))) {
      const text = await $.fs.read(join(work, p.jobs, `${j}.json`)).catch(() => '')
      try {
        words += wordsOf(JSON.parse(text))
      } catch {
        // uszkodzona partia: liczymy bez niej
      }
    }
    counted.push({ ...p, wordsLeft: words })
  }
  const final: Progress = { ...base, pairs: counted, summary, isCounting: false }
  await update($, progress, () => final)
}

function nextPrompt(p: Progress) {
  const pair = p.pairs.find(x => x.next)
  if (!pair) return null
  return (
    `${p.name}: przetłumacz następną partię „${pair.next}” — z work\\${pair.jobs}\\${pair.next}.json do work\\${pair.done}\\${pair.next}.json, ` +
    `w tym samym formacie co już gotowe partie w work\\${pair.done}. ` +
    (p.hasStyle ? 'Najpierw przeczytaj work\\STYL.md i trzymaj się glosariusza i rejestrów. ' : '') +
    'Po zapisaniu sprawdź partię skryptami kontrolnymi projektu, jeśli są, i powiedz, ile zostało.'
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'spolszcz',
      description: 'Postęp tłumaczenia gry i wznowienie od następnej partii',
      argumentHint: '[projekt]',
    })
    return result
  })

  on('command.run', { command: 'spolszcz' }, async ($, e) => {
    const all = await projects($)
    const asked = e.args.trim().toLowerCase()
    const name = asked ? all.find(n => n.toLowerCase().includes(asked)) : undefined
    if (!name) {
      return { text: `${asked ? `Nie znalazłem „${asked}”. ` : ''}Projekty tłumaczeń: ${all.join(', ')}.\nUżycie: /spolszcz ebb` }
    }
    const { isPlaced } = await $.ui.open({ id: PANE, title: name })
    await measure($, name)
    if (isPlaced) return { text: `Otworzyłem postęp: ${name}.` }
    const p = await read($, progress)
    const lines = (p?.pairs ?? []).map(x => `${x.jobs}: ${x.finished}/${x.total} partii, zostało ${x.wordsLeft ?? '?'} słów`)
    return { text: [name, p?.summary ?? '', ...lines].filter(Boolean).join('\n') }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const p = await read($, progress)
    if (!p) return <Text dimColor>/spolszcz &lt;projekt&gt;</Text>

    const width = Math.max(10, Math.min(30, (e.viewport?.columns ?? 40) - 20))
    const prompt = nextPrompt(p)
    return (
      <Box flexDirection="column" paddingX={1}>
        {p.summary ? <Text>{p.summary}</Text> : null}
        {p.pairs.length === 0 ? <Text dimColor>Brak partii w work\jobs*</Text> : null}
        {p.pairs.map(x => {
          const pct = x.total ? x.finished / x.total : 0
          const filled = Math.round(pct * width)
          return (
            <Box key={`pair-${x.jobs}`} flexDirection="column" marginBottom={1}>
              <Text>
                {x.jobs} <Text color={pct >= 1 ? 'green' : 'yellow'}>{'█'.repeat(filled)}</Text>
                <Text dimColor>{'░'.repeat(width - filled)}</Text> {x.finished}/{x.total}
              </Text>
              <Text dimColor>
                {x.wordsLeft === null ? 'liczę słowa…' : `zostało ${x.wordsLeft.toLocaleString('pl-PL')} słów`}
                {x.next ? ` · następna: ${x.next}` : ' · gotowe'}
              </Text>
            </Box>
          )
        })}
        <Box gap={2}>
          {prompt ? (
            <Button key="next" label="następna partia" hotkey="n" onPress={() => void $.prompt.submit({ text: prompt, asUser: true })} />
          ) : null}
          <Button key="refresh" label="odśwież" plain onPress={() => void measure($, p.name)} />
        </Box>
      </Box>
    )
  })
}
