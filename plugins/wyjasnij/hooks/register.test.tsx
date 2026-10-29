import { expect, mock, test } from 'claude-code/testing'
import type { RenderPropsOf } from 'claude-code'

import { appendTo, babySvg, items, splitHuman, spans } from './register'

const props: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {},
}

test('dzieli kroki na numery, część techniczną, „po ludzku” i terminy', () => {
  // Nowy format z numerami i stary z punktami dają tę samą numerację.
  expect(items('1. Zmieniłem plik\n2. Uruchomiłem testy')).toEqual([
    { n: 1, text: 'Zmieniłem plik' },
    { n: 2, text: 'Uruchomiłem testy' },
  ])
  expect(items('• pierwszy\n• drugi\n  ciąg dalszy')).toEqual([
    { n: 1, text: 'pierwszy' },
    { n: 2, text: 'drugi ciąg dalszy' },
  ])
  expect(splitHuman('Edytowałem `register.tsx` → po ludzku: poprawiłem plik moda')).toEqual({
    tech: 'Edytowałem `register.tsx`',
    human: 'poprawiłem plik moda',
  })
  expect(splitHuman('Bez wersji ludzkiej')).toEqual({ tech: 'Bez wersji ludzkiej', human: '' })
  expect(spans('Zrobiłem `commit` i `push`.')).toEqual([
    { text: 'Zrobiłem ', isTerm: false },
    { text: 'commit', isTerm: true },
    { text: ' i ', isTerm: false },
    { text: 'push', isTerm: true },
    { text: '.', isTerm: false },
  ])
})

test('panel numeruje kroki techniczne i wyróżnia „po ludzku” oraz słówka', async ($, on) => {
  const text = [
    'PODSUMOWANIE — Poprawiłem pasek.',
    'KROKI',
    '1. Zmieniłem wygląd',
    'WERSJA TECHNICZNA',
    '1. Zmieniłem `ui.render` w `register.tsx` → po ludzku: poprawiłem to, co rysuje pasek',
    'SŁOWA DO NAUKI',
    'hook — funkcja wywoływana przy zdarzeniu — mod reaguje nią na rysowanie',
  ].join('\n')
  mock.store(on, { 'saved-explanations': [{ at: 0, project: 'demo', label: 'Ta sesja', text }] })
  on('session.cwd', () => ({ value: 'E:/Projekty/demo' }) as never)
  on('command.register', () => ({ value: { command: 'wyjasnij' } }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  await $.session.start({ cwd: 'E:/Projekty/demo', surface: 'terminal', isInteractive: true } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'wyjasnij',
      surface,
      component: 'Pane',
      requestId: 'wyjasnij',
      props: { title: 'Wyjaśnij', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
      viewport: { columns: 80, rows: 40 },
    })
    expect(await ui.find({ type: 'Text', text: /^ui\.render$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↳ po ludzku/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^hook$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^1\. $/ })).toBeDefined()
    await ui.unmount()
  }
})

test('przycisk dołącza do wiersza co-dalej, gdy ten jest w drzewie', () => {
  const tree = {
    type: 'Box',
    props: {},
    children: [
      { type: 'Text', props: {}, children: ['inny pasek'] },
      { type: 'Box', props: { key: 'co-dalej-tools' }, children: [{ type: 'Button', props: { key: 'more' } }] },
    ],
  }
  const extra = { type: 'Button', props: { key: 'explain' } }
  const merged = appendTo(tree, 'co-dalej-tools', extra) as typeof tree
  expect(merged.children[1]?.children).toEqual([{ type: 'Button', props: { key: 'more' } }, extra])
  // Oryginał nietknięty, a bez wiersza co-dalej nie ma do czego dołączyć.
  expect(tree.children[1]?.children).toHaveLength(1)
  expect(appendTo({ type: 'Box', props: {}, children: ['x'] }, 'co-dalej-tools', extra)).toBeNull()
})

test('po turze ze zmianą pliku pokazuje „Wyjaśnij”', async ($, on) => {
  mock.store(on, {})
  on('session.cwd', () => ({ value: 'E:/Projekty/demo' }) as never)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: { content: 'ok' } }) as never)
  on('turn.complete', ($, e) => ({ text: e.answer }))

  for (const surface of ['terminal', 'desktop'] as const) {
    await $.prompt.submit({ text: 'popraw plik', wait: false, origin: { kind: 'composer' } })
    const quiet = await $.ui.mount({ plugin: 'wyjasnij', surface, component: 'AbovePrompt', props }).catch(() => null)
    expect(quiet === null || (await quiet.find({ key: 'explain' })) === undefined).toBe(true)
    await quiet?.unmount()

    await $.tool.call({ tool: 'Write', file_path: 'E:/Projekty/demo/a.txt', content: 'x' } as never)
    await $.turn.complete({ answer: 'Zapisałem plik.', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
    const ui = await $.ui.mount({ plugin: 'wyjasnij', surface, component: 'AbovePrompt', props })
    expect(await ui.find({ key: 'explain' })).toBeDefined()
    await ui.unmount()
  }
})

test('ikonka robota-dziecka: smoczek i rumieńce', () => {
  expect(babySvg()).toContain('#6AA5E8')
  expect(babySvg()).toContain('#E0899B')
})
