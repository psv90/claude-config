import { expect, mock, test } from 'claude-code/testing'
import type { RenderPropsOf } from 'claude-code'

import { applyTool, bar, etaOf, fitLine, labelOf, nextPace, stageOf, trackSvg } from './register'

const props: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {},
}

test('opisuje czynności i śledzi listę zadań', () => {
  expect(labelOf('Edit', { file_path: String.raw`E:\Projekty\Baza\server.js` })).toBe('edytuje server.js')
  expect(labelOf('Bash', { command: 'npm test', description: 'Run the tests' })).toBe('uruchamia npm test')
  const created = applyTool([], 'TaskCreate', { subject: 'Napisz testy', activeForm: 'Piszę testy' }, { task: { id: '1', subject: 'Napisz testy' } })
  expect(created).toEqual([{ id: '1', subject: 'Napisz testy', active: 'Piszę testy', status: 'pending' }])
  expect(applyTool(created, 'TaskUpdate', { taskId: '1', status: 'completed' }, {})[0]?.status).toBe('completed')
  expect(applyTool(created, 'TaskUpdate', { taskId: '1', status: 'deleted' }, {})).toEqual([])
})

test('śledzi listę update_plan z aplikacji desktop', () => {
  const plan = 'mcp__ccd_turn__update_plan'
  let list = applyTool([], plan, {
    items: [
      { content: 'Plan', status: 'in_progress' },
      { content: 'Kod', status: 'pending' },
      { content: 'Testy', status: 'pending' },
      { content: 'Docs', status: 'pending' },
      { content: 'Wydanie', status: 'pending' },
    ],
  }, {})
  expect(stageOf(list)).toBe(1)
  list = applyTool(list, plan, { advance: true }, {})
  expect(list.map(t => t.status)).toEqual(['completed', 'in_progress', 'pending', 'pending', 'pending'])
  expect(stageOf(list)).toBe(2)
  list = applyTool(list, plan, { done: [2, 3], start: 5 }, {})
  expect(list.map(t => t.status)).toEqual(['completed', 'completed', 'completed', 'pending', 'in_progress'])
  expect(stageOf(list)).toBe(5)
  list = applyTool(list, 'mcp__ccd_turn__wrap_up', { recap: 'ok' }, {})
  expect(list.every(t => t.status === 'completed')).toBe(true)
  expect(labelOf(plan, {})).toBe('planuje kroki')
})

test('pasek ładowania rośnie płynnie', () => {
  expect(bar(0, 10)).toEqual({ filled: '', empty: '░'.repeat(10) })
  expect(bar(1, 10)).toEqual({ filled: '█'.repeat(10), empty: '' })
  expect(bar(0.4, 10)).toEqual({ filled: '████', empty: '░'.repeat(6) })
  expect(bar(0.25, 10)).toEqual({ filled: '██▌', empty: '░'.repeat(7) })
})

test('szacuje czas do końca z tempa ukończonych kroków', () => {
  const plan = 'mcp__ccd_turn__update_plan'
  const items = ['A', 'B', 'C', 'D', 'E'].map((content, i) => ({ content, status: i === 0 ? 'in_progress' : 'pending' }))
  const empty = { startedAt: null, lastDoneAt: null, done: 0 }
  const l0 = applyTool([], plan, { items }, {})
  let p = nextPace(empty, [], l0, 0)
  expect(etaOf(p, 5, 10_000)).toBeNull()
  // Dwa kroki po minucie: zostały 3, czyli około 3 minuty.
  const l2 = applyTool(applyTool(l0, plan, { advance: true }, {}), plan, { advance: true }, {})
  p = nextPace(p, l0, l2, 120_000)
  expect(p).toEqual({ startedAt: 0, lastDoneAt: 120_000, done: 2 })
  expect(etaOf(p, 5, 120_000)).toBe(180_000)
  // Upływ czasu bez postępu zmniejsza szacunek, ale nie poniżej zera.
  expect(etaOf(p, 5, 150_000)).toBe(150_000)
  expect(etaOf(p, 5, 999_000)).toBe(0)
  // Ponowne wysłanie tej samej listy nie zeruje tempa, nowa po ukończonej już tak.
  expect(nextPace(p, l2, l2, 130_000)).toEqual(p)
  const finished = applyTool(l2, 'mcp__ccd_turn__wrap_up', {}, {})
  expect(nextPace(p, finished, l0, 200_000)).toEqual({ startedAt: 200_000, lastDoneAt: null, done: 0 })
})

test('pasek pokazuje szacowany czas po pierwszym kroku', async ($, on) => {
  const time = mock.clock(on, { now: 0 })
  on('turn.start', () => ({ turnId: 't' }) as never)
  on('tool.call', () => ({ result: {} }) as never)
  await $.turn.start({ turnId: 't' } as never)
  const plan = 'mcp__ccd_turn__update_plan'
  await $.tool.call({ tool: plan, items: [
    { content: 'Plan', status: 'in_progress' },
    { content: 'Kod', status: 'pending' },
    { content: 'Testy', status: 'pending' },
  ] } as never)
  const ui = await $.ui.mount({ plugin: 'progres-bar', surface: 'terminal', component: 'AbovePrompt', props })
  expect(await ui.find({ type: 'Text', text: /~\d/ })).toBeUndefined()
  await time.advance(90_000)
  await $.tool.call({ tool: plan, advance: true } as never)
  expect(await ui.find({ type: 'Text', text: /~3:00/ })).toBeDefined()
  await ui.unmount()
})

test('pasek pokazuje etap 2 z 3, procent i krok w toku', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('turn.start', () => ({ turnId: 't' }) as never)
  on('tool.call', () => ({ result: {} }) as never)
  await $.turn.start({ turnId: 't' } as never)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Plan', status: 'completed', activeForm: 'Planuję' },
      { content: 'Kod', status: 'in_progress', activeForm: 'Piszę kod' },
      { content: 'Testy', status: 'pending', activeForm: 'Testuję' },
    ],
  } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'E:/x/app.js', old_string: 'a', new_string: 'b' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'progres-bar', surface, component: 'AbovePrompt', props })
    const widths = (await ui.findAll({ type: 'Box' })).map(b => b.props.width).filter(w => w !== undefined)
    if (surface === 'terminal') {
      // Segment na krok, jak w cache-bar: zrobiony zielony, w toku zielony przygaszony, do zrobienia szary ▰.
      const filled = await ui.findAll({ type: 'Text', text: /^▰$/ })
      expect(filled.map(t => [t.props.color, t.props.dimColor ?? false])).toEqual([
        ['success', false],
        ['success', true],
        ['#3D3D3A', false],
      ])
      expect(await ui.find({ type: 'Text', text: /[█░▱]/ })).toBeUndefined()
      expect((await ui.findAll({ type: 'Svg' })).length).toBe(0)
      // Kolumny jak w cache-bar (13, 4) i wspólna prawa kolumna pasków.
      expect(widths).toEqual([13, 4, 16])
      expect(await ui.find({ type: 'Text', text: /^krok$/ })).toBeDefined()
    } else {
      // Desktop: tor z robotem na wózku zamiast segmentów; robot po 1 z 3 kroków, w kolorze pracy.
      const [svg] = await ui.findAll({ type: 'Svg' })
      const source = String(svg?.props.source)
      expect(source).toContain('#D97757')
      expect(source).toContain('translate(33.3 ')
      expect(svg?.props.alt).toBe('krok 2 z 3')
      expect(widths).toEqual([13, 16])
    }
    expect(await ui.find({ type: 'Text', text: /^ 2$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\/3$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Piszę kod/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /edytuje app\.js/ })).toBeDefined()
    await ui.unmount()
  }
})

test('opis kroku mieści się w jednej linii', () => {
  expect(fitLine('Piszę testy', 'edytuje app.test.js', 40)).toEqual({ name: 'Piszę testy', detail: 'edytuje app.test.js' })
  // Czynność ustępuje pierwsza, potem nazwa kroku dostaje wielokropek.
  expect(fitLine('Piszę testy', 'uruchamia cd "/e/Clode code/VideoLiblary/Projekty"', 30)).toEqual({ name: 'Piszę testy', detail: 'uruchamia cd "/…' })
  expect(fitLine('Bardzo długa nazwa kroku na liście', 'x', 12)).toEqual({ name: 'Bardzo dług…', detail: '' })
})

test('robot na wózku: koło obraca się między klatkami, meta i czekanie mają swój wygląd', () => {
  const a = trackSvg(0.5, 'run', 0)
  const b = trackSvg(0.5, 'run', 1)
  expect(a).toContain('rotate(0)')
  expect(b).toContain('rotate(36)')
  // Na mecie robot zielony z uniesioną ręką, w czekaniu szary z „z”.
  expect(trackSvg(1, 'done', 0)).toContain('#1D9E75')
  expect(trackSvg(1, 'done', 0)).toContain('rotate(-150 15 14)')
  expect(trackSvg(0.2, 'wait', 0)).toContain('>z</text>')
  expect(trackSvg(0.2, 'wait', 0)).not.toContain('#FFD27A')
})
