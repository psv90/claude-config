import { expect, mock, test } from 'claude-code/testing'

import { bill, costOf } from './register'

test('liczy koszt według cennika modelu', () => {
  const u = { input: 1000, output: 1000, cacheRead: 1_000_000, cacheWrite: 0 }
  expect(Math.round(costOf('claude-opus-5-5', u) * 1e6)).toBe(224_000)
})

test('/rachunek pokazuje tury, najdroższą i najcięższy odczyt', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {}, text: 'x'.repeat(140_000) }) as never)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [], cost: { usd: 1.23 } } }) as never)
  const usage = { input_tokens: 10, output_tokens: 500, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 5000, model: 'claude-opus-5-5' }

  await $.prompt.submit({ text: 'przeczytaj duży plik', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Read', file_path: 'E:/x/duzy.ts' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', usage })

  const r = await $.command.run({ command: 'rachunek', args: '' } as never)
  const text = JSON.stringify(r)
  expect(text).toContain('przeczytaj duży plik')
  expect(text).toContain('Read duzy.ts')
  expect(text).toContain('$1.23')
})
