import { expect, test } from 'claude-code/testing'

import { crewSvg, labelOf, lookOf, merge, pick } from './register'

type Status = 'running' | 'completed' | 'failed' | 'idle'
const a = (id: string, status: Status = 'running') => ({ id, type: 'Explore', description: 'szuka plików', status })

test('nowy agent dostaje start, znany zachowuje start i czynność', () => {
  const first = merge([], [a('x')], 1000)
  expect(first).toEqual([{ id: 'x', type: 'Explore', description: 'szuka plików', status: 'running', startedAt: 1000, endedAt: null, label: '' }])
  const withLabel = first.map(r => ({ ...r, label: 'czyta a.ts' }))
  const again = merge(withLabel, [a('x')], 5000)
  expect(again[0]?.startedAt).toBe(1000)
  expect(again[0]?.label).toBe('czyta a.ts')
})

test('skończony agent zostaje na liście na stałe', () => {
  const running = merge([], [a('x')], 0)
  const done = merge(running, [a('x', 'completed')], 10_000)
  expect(done[0]?.endedAt).toBe(10_000)
  expect(merge(done, [a('x', 'completed')], 600_000)).toEqual(done)
})

test('agent wyrzucony z listy silnika zostaje jako skończony', () => {
  const running = merge([], [a('x')], 0)
  const gone = merge(running, [], 3000)
  expect(gone[0]?.status).toBe('completed')
  expect(gone[0]?.endedAt).toBe(3000)
  expect(merge(gone, [], 900_000)).toEqual(gone)
})

test('nie pokazuje agentów skończonych przed startem paska', () => {
  expect(merge([], [a('old', 'completed')], 0)).toHaveLength(0)
})

test('pracujący pierwsi, potem ostatnio skończeni, reszta jako licznik', () => {
  let list = merge([], [a('1'), a('2'), a('3'), a('4'), a('5')], 0)
  list = merge(list, [a('1', 'completed'), a('2', 'completed'), a('3'), a('4', 'completed'), a('5')], 1000)
  list = merge(list, [a('1', 'completed'), a('2', 'completed'), a('3'), a('4', 'completed'), a('5')], 2000)
  const { shown, rest, working } = pick(list)
  expect(working).toBe(2)
  expect(shown.map(r => r.id).slice(0, 2)).toEqual(['3', '5'])
  expect(shown).toHaveLength(4)
  expect(rest).toBe(1)
})

test('robot ma kolor stanu, a ekipa liczy nadmiar', () => {
  const [run] = merge([], [a('r')], 0)
  const [done] = merge(merge([], [a('d')], 0), [a('d', 'completed')], 1)
  const [fail] = merge(merge([], [a('f')], 0), [a('f', 'failed')], 1)
  expect(lookOf(run!)).toBe('run')
  expect(lookOf(done!)).toBe('done')
  expect(lookOf(fail!)).toBe('fail')
  const six = merge([], ['1', '2', '3', '4', '5', '6'].map(id => a(id)), 0)
  const svg = crewSvg(six, 0)
  expect(svg).toContain('+3')
  expect(svg.length).toBeLessThan(131072)
  expect(crewSvg(six.slice(0, 2), 0)).not.toContain('+')
})

test('opisuje czynność agenta', () => {
  expect(labelOf('Read', { file_path: String.raw`E:\x\server.js` })).toBe('czyta server.js')
  expect(labelOf('Grep', {})).toBe('przeszukuje pliki')
  expect(labelOf('mcp__playwright__browser_click', {})).toBe('korzysta z playwright')
})
