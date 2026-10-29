import { expect, mock, test } from 'claude-code/testing'

import { speakable } from './register'

test('czyści tekst z Markdownu i kodu', () => {
  expect(speakable('**Gotowe.** Zmieniłem `app.js`, zob. [plik](a/b.ts).\n```js\nx()\n```')).toBe('Gotowe. Zmieniłem , zob. plik.')
})

test('po długiej turze mówi, po krótkiej milczy', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  const said: string[] = []
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('process.run', ($, e) => (said.push((e as unknown as { init?: { stdin?: string } }).init?.stdin ?? ''), { value: { exitCode: 0, stdout: '', stderr: '' } }) as never)

  await $.turn.complete({ answer: 'Krótko.', durationMs: 5_000, isAborted: false, turnId: 'a', reason: 'answer' })
  await clock.advance(1)
  expect(said.length).toBe(0)

  await $.turn.complete({ answer: 'Zbudowałem **cały** panel.', durationMs: 300_000, isAborted: false, turnId: 'b', reason: 'answer' })
  await clock.advance(1)
  expect(said).toEqual(['Zbudowałem cały panel.'])
})
