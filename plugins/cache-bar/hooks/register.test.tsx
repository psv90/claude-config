import { expect, mock, test } from 'claude-code/testing'
import type { RenderPropsOf } from 'claude-code'

import { bar, colorFor, gaugeSvg, heatOf, kTokens, resetText, thermoSvg } from './register'

test('połówka segmentu co 10%, reset dalej niż doba jako dzień tygodnia', () => {
  expect(bar(50)).toEqual({ filled: '▰▰', half: '▰', empty: '▰▰' })
  expect(bar(60)).toEqual({ filled: '▰▰▰', half: '', empty: '▰▰' })
  expect(bar(0)).toEqual({ filled: '', half: '', empty: '▰▰▰▰▰' })
  const now = new Date(2026, 9, 25, 12, 0).getTime()
  expect(resetText(new Date(2026, 9, 25, 14, 30).toISOString(), now)).toBe(' 2 h 30 min')
  expect(resetText(new Date(2026, 9, 25, 15, 0).toISOString(), now)).toBe(' 3 h')
  expect(resetText(new Date(2026, 9, 25, 12, 46).toISOString(), now)).toBe(' 46 min')
  // Powyżej doby: dni i godziny do resetu.
  expect(resetText(new Date(2026, 9, 29, 15, 0).toISOString(), now)).toBe(' 4 d 3 h')
  expect(resetText(new Date(2026, 9, 27, 12, 0).toISOString(), now)).toBe(' 2 d')
})

test('progi kolorów 50% i 80%, tokeny w tysiącach', () => {
  expect(colorFor(49)).toBe('success')
  expect(colorFor(50)).toBe('warning')
  expect(colorFor(80)).toBe('error')
  expect(kTokens(124_400)).toBe('124k')
  expect(kTokens(1_000_000)).toBe('1M')
})

test('cache to kropka, która żółknie po połowie czasu', async ($, on) => {
  const time = mock.clock(on, { now: 0 })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  const fresh = await $.ui.mount({ plugin: 'cache-bar', surface: 'terminal', component: 'AbovePrompt', props })
  expect((await fresh.find({ type: 'Text', text: /^●$/ }))?.props.color).toBe('success')
  await fresh.unmount()
  await time.advance(30 * 60_000)
  const ui = await $.ui.mount({ plugin: 'cache-bar', surface: 'terminal', component: 'AbovePrompt', props })
  expect((await ui.find({ type: 'Text', text: /^●$/ }))?.props.color).toBe('warning')
  expect(await ui.find({ type: 'Text', text: /30:00/ })).toBeDefined()
  await ui.unmount()
})

test('tokeny kontekstu odsłaniane po najechaniu tylko na desktopie', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure(measure(62))
  const desk = await $.ui.mount({ plugin: 'cache-bar', surface: 'desktop', component: 'AbovePrompt', props })
  expect((await desk.find({ key: 'ctx-tokens' }))?.props).toMatchObject({ display: 'none' })
  expect(await desk.find({ type: 'Text', text: '124k' })).toBeDefined()
  await desk.unmount()
  const term = await $.ui.mount({ plugin: 'cache-bar', surface: 'terminal', component: 'AbovePrompt', props })
  expect(await term.find({ key: 'ctx-tokens' })).toBeUndefined()
  await term.unmount()
})

const props: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

const measure = (percent: number) => ({
  context: { window: 200_000, tokens: percent * 2000, percent },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 23 },
    { kind: 'seven_day', percentUsed: 71 },
  ],
  changed: ['context' as const, 'rateLimits' as const],
})

test('handoff tylko powyżej 50% kontekstu, limity widoczne', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  for (const surface of ['terminal', 'desktop'] as const) {
    await $.session.measure(measure(30))
    const low = await $.ui.mount({ plugin: 'cache-bar', surface, component: 'AbovePrompt', props })
    expect(await low.find({ key: 'handoff' })).toBeUndefined()
    expect(await low.find({ type: 'Text', text: /^5h$/ })).toBeDefined()
    expect(await low.find({ type: 'Text', text: /^  23%$/ })).toBeDefined()
    expect(await low.find({ type: 'Text', text: /^7d$/ })).toBeDefined()
    expect(await low.find({ type: 'Text', text: /^  71%$/ })).toBeDefined()
    // Kolumny wspólne z progres-bar: początek 13, etykieta 4.
    const widths = (await low.findAll({ type: 'Box' })).map(b => b.props.width).filter(w => w !== undefined)
    expect(widths).toContain(13)
    expect(widths).toContain(4)
    await low.unmount()

    await $.session.measure(measure(62))
    const high = await $.ui.mount({ plugin: 'cache-bar', surface, component: 'AbovePrompt', props })
    expect(await high.find({ key: 'handoff' })).toBeDefined()
    expect(await high.find({ type: 'Text', text: /^ctx$/ })).toBeDefined()
    expect(await high.find({ type: 'Text', text: /^  62%$/ })).toBeDefined()
    if (surface === 'terminal') {
      // Pasek z segmentów ▰ (puste szare), bez kropkowanego ░ i obrysu ▱.
      expect(await high.find({ type: 'Text', text: /^▰▰▰$/ })).toBeDefined()
      expect((await high.find({ type: 'Text', text: /^▰▰$/ }))?.props.color).toBe('#3D3D3A')
      expect(await high.find({ type: 'Text', text: /[░█]/ })).toBeUndefined()
    } else {
      // Desktop: zegary zamiast segmentów (ctx, 5h, 7d) i termometr.
      const svgs = await high.findAll({ type: 'Svg' })
      expect(svgs.map(s => String(s.props.alt))).toEqual(['cache: none', 'ctx 62%', '5h 23%', '7d 71%'])
      expect(await high.find({ type: 'Text', text: /▰/ })).toBeUndefined()
    }
    await high.unmount()
  }
})

test('termometr: gorący w pracy, stygnie z odliczaniem, zimny zamarza (tylko desktop)', async ($, on) => {
  expect(heatOf(true, 0.9)).toBe('hot')
  expect(heatOf(false, 0.8)).toBe('warm')
  expect(heatOf(false, 0.3)).toBe('cool')
  expect(heatOf(false, 0)).toBe('cold')
  expect(heatOf(false, null)).toBe('none')
  expect(thermoSvg('hot', 1, 0)).toContain('#E05A4F')
  expect(thermoSvg('cold', 0, 3)).toContain('rotate(90)')
  mock.clock(on, { now: 0 })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  const desk = await $.ui.mount({ plugin: 'cache-bar', surface: 'desktop', component: 'AbovePrompt', props })
  const [svg] = await desk.findAll({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('#E3A33A')
  await desk.unmount()
  const term = await $.ui.mount({ plugin: 'cache-bar', surface: 'terminal', component: 'AbovePrompt', props })
  expect((await term.findAll({ type: 'Svg' })).length).toBe(0)
  expect(await term.find({ type: 'Text', text: /^●$/ })).toBeDefined()
  await term.unmount()
})

test('zegar: łuk w kolorze progu, wskazówka drga, od 80% trzęsie się mocniej', () => {
  expect(gaugeSvg(23, 0)).toContain('#4EBA65')
  expect(gaugeSvg(53, 0)).toContain('#E3A33A')
  expect(gaugeSvg(84, 0)).toContain('#E05A4F')
  // Wskazówka w kolejnych klatkach w innym miejscu.
  expect(gaugeSvg(84, 0)).not.toBe(gaugeSvg(84, 1))
  expect(gaugeSvg(null, 0)).not.toContain('<line')
})
