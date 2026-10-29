import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const MIN = 60_000
const usage = { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 200_000, cache_creation_input_tokens: 0 }

function beneath(on: On, forks: string[]) {
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, tokens: 200_000, percent: 20 }, rateLimits: [] } }) as never)
  on('model.fork', ($, e) => (forks.push(e.prompt), { value: { isAnswered: true, text: 'ok', usage } }) as never)
  on('prompt.fill', () => ({ value: { isFilled: true } }) as never)
  on('turn.start', () => ({ turnId: 't' }) as never)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
}

const turn = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' as const, usage: { ...usage, model: 'claude-opus-5-5' } }
const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })

test('raz zatrzymuje zimne wysłanie z kosztem, drugie przepuszcza', { options: { maxWarmups: 0 } }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, {})
  beneath(on, [])
  await $.session.start({ cwd: '/tmp' } as never)
  await $.turn.complete(turn)

  await clock.advance(30 * MIN)
  expect(await $.prompt.submit(typed('ciepło'))).toEqual({ text: 'ciepło' })

  await $.turn.complete(turn)
  await clock.advance(61 * MIN)
  const stopped = await $.prompt.submit(typed('zimno'))
  expect(stopped.drop).toContain('$1.60')
  expect(await $.prompt.submit(typed('zimno'))).toEqual({ text: 'zimno' })
})

test('podtrzymuje cache po 50 min ciszy, najwyżej maxWarmups razy', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, {})
  const forks: string[] = []
  beneath(on, forks)
  await $.session.start({ cwd: '/tmp' } as never)
  await $.turn.complete(turn)

  await clock.advance(49 * MIN)
  expect(forks.length).toBe(0)
  await clock.advance(2 * MIN)
  expect(forks.length).toBe(1)
  await clock.advance(300 * MIN)
  expect(forks.length).toBe(4)
})
