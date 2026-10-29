import { expect, test } from 'claude-code/testing'

import { pairsIn, wordsOf } from './register'

test('rozpoznaje pary partii i liczy słowa', () => {
  expect(pairsIn(['jobs', 'jobs2', 'done', 'done2', 'STYL.md', 'jobs3'])).toEqual([
    { jobs: 'jobs', done: 'done' },
    { jobs: 'jobs2', done: 'done2' },
  ])
  expect(wordsOf({ lines: [{ en: 'You approach the half-sphere.' }, { en: 'Yes' }] })).toBe(5)
  expect(wordsOf({})).toBe(0)
})

test('/spolszcz liczy postęp z dysku i podsuwa następną partię', async ($, on) => {
  const tree: Record<string, string[]> = {
    Projekty: ['Spolszczenie Gra', 'Inne'],
    work: ['jobs', 'done', 'STYL.md'],
    jobs: ['a.json', 'b.json', 'c.json'],
    done: ['a.json'],
  }
  const last = (p: string) => p.split(/[\\/]/).pop() ?? p
  on('fs.list', ($, e) => ({ value: (tree[last((e as unknown as { path: string }).path)] ?? []).map(name => ({ name, kind: name.includes('.') ? 'file' : 'dir', size: 1, mtimeMs: 0, isLink: false })) }) as never)
  on('fs.exists', ($, e) => ({ value: !last((e as unknown as { path: string }).path).endsWith('postep.py') }) as never)
  on('fs.read', () => ({ value: JSON.stringify({ lines: [{ en: 'one two three' }] }) }) as never)
  on('ui.open', () => ({ value: { isPlaced: false } }) as never)
  const r = await $.command.run({ command: 'spolszcz', args: 'gra' } as never)
  const text = JSON.stringify(r)
  expect(text).toContain('jobs: 1/3 partii, zostało 6 słów')
})
