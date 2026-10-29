import { expect, mock, test } from 'claude-code/testing'
import type { Engine, On } from 'claude-code'

import { findBox, pencilSvg, takeBox } from './register'


const SURFACES = ['terminal', 'desktop'] as const

const HERE = 'local_here-1'
const OTHER = 'local_other-2'

const setup = (
  on: On,
  entries?: Record<string, unknown>,
  openPane = true,
  mockStore = true,
  env: Record<string, string> = {},
) => {
  if (mockStore) mock.store(on, entries)
  mock.env(on, { CLAUDE_CODE_HOST_SESSION_ID: HERE, OS: 'Windows_NT', ...env })
  const clock = mock.clock(on, { now: 10 * 60000 })
  on('session.cwd', () => ({ value: 'E:\\Clode code\\Skillsy' }))
  if (openPane) on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }))
  return clock
}

const run = ($: Engine, args: string) => $.command.run({ command: 'later', args })

const band = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: 'later', surface, component: 'AbovePrompt', props: { hasSurvey: false } })

const pane = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({
    plugin: 'later',
    surface,
    component: 'Pane',
    requestId: 'later',
    props: {
      title: 'Na później',
      isFocused: true,
      bodyColumns: 60,
      placement: 'dock',
    } as never,
  })

const recordSubmits = (on: On) => {
  const sent: string[] = []
  on('prompt.submit', (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  return sent
}

const recordFills = (on: On) => {
  const fills: string[] = []
  on('prompt.fill', (_$, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  return fills
}

test('komenda: dodaje prompt do grupy projektu i listuje go', async ($, on) => {
  setup(on)
  expect((await run($, 'napisz testy')).text).toContain('@Skillsy jako #1')
  const list = (await run($, 'list')).text ?? ''
  expect(list).toContain('@Skillsy · 1')
  expect(list).toContain('napisz testy')
})

test('komenda: bare /later otwiera panel', async ($, on) => {
  setup(on, undefined, false)
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  expect((await run($, '')).text).toContain('Panel')
  expect(opened).toEqual(['later'])
})

test('komenda: @grupa trafia do osobnej listy, all pokazuje obie', async ($, on) => {
  setup(on)
  await run($, 'lokalny')
  await run($, '@blog post o modach')
  expect((await run($, 'list')).text).not.toContain('post o modach')
  const all = (await run($, 'all')).text ?? ''
  expect(all).toContain('@Skillsy · 1')
  expect(all).toContain('@blog · 1')
})

test('komenda: run wysyła prompt i zdejmuje go z listy', async ($, on) => {
  const clock = setup(on, { groups: { Skillsy: [{ text: 'zrób refaktor', at: 0 }] } })
  const sent = recordSubmits(on)
  expect((await run($, 'run 1')).text).toContain('Wysyłam #1')
  await clock.advance(1)
  expect(sent).toEqual(['zrób refaktor'])
  expect((await run($, 'list')).text).toContain('pusto')
})

for (const surface of SURFACES) {
  test(`pasek: bez promptów tylko Zapisz i Lista (${surface})`, async ($, on) => {
    setup(on)
    const ui = await band($, surface)
    expect(await ui.find({ key: 'save-draft' })).toBeDefined()
    expect(await ui.find({ key: 'open-list' })).toBeDefined()
    expect(await ui.find({ key: 'send-next' })).toBeUndefined()
  })

  test(`pasek: Zapisz na później bierze tekst z pola i je czyści (${surface})`, async ($, on) => {
    setup(on)
    on('prompt.read', () => ({ value: { text: 'mój szkic', cursor: 9 } }))
    const fills = recordFills(on)
    const ui = await band($, surface)
    await ui.press({ key: 'save-draft' })
    expect(fills).toEqual([''])
    expect((await run($, 'list')).text).toContain('mój szkic')
    // Bez napisu „N na później”: liczba stoi w nawiasie przy „lista”.
    expect(await ui.find({ type: 'Text', text: /na później$/ })).toBeUndefined()
    expect((await ui.find({ key: 'open-list' }))?.props.label).toBe('lista (1)')
  })

  test(`pasek: Wyślij następny wysyła pierwszy prompt (${surface})`, async ($, on) => {
    setup(on)
    const sent = recordSubmits(on)
    await run($, 'pierwszy')
    await run($, 'drugi')
    const ui = await band($, surface)
    expect((await ui.find({ key: 'send-next' }))?.props.label).toBe('pierwszy')
    await ui.press({ key: 'send-next' })
    expect(sent).toEqual(['pierwszy'])
    expect((await ui.find({ key: 'send-next' }))?.props.label).toBe('drugi')
  })

  test(`panel: Wyślij, Edytuj i Usuń z potwierdzeniem (${surface})`, async ($, on) => {
    setup(on)
    const sent = recordSubmits(on)
    const fills = recordFills(on)
    await run($, 'alfa')
    await run($, 'beta')
    await run($, 'gamma')
    const ui = await pane($, surface)
    const keys = (await ui.findAll({ type: 'Button' })).map(one => one.key)
    // Row buttons end in the note's numeric id; send-all and send-next do not.
    const at = (prefix: string, i: number) =>
      keys.filter(k => k !== undefined && new RegExp(`^${prefix}\\d+$`).test(k))[i] as string

    const rm = at('rm-', 2)
    const id = rm.slice('rm-'.length)
    await ui.press({ key: rm })
    expect(await ui.find({ type: 'Text', text: /Usunąć #3\?/ })).toBeDefined()
    await ui.press({ key: `rmno-${id}` })
    expect((await run($, 'list')).text).toContain('gamma')
    await ui.press({ key: rm })
    await ui.press({ key: `rmyes-${id}` })
    expect((await run($, 'list')).text).not.toContain('gamma')

    await ui.press({ key: at('edit-', 1) })
    expect(fills).toEqual(['beta'])

    await ui.press({ key: at('send-', 0) })
    expect(sent).toEqual(['alfa'])
    expect(await ui.find({ type: 'Text', text: /pusto/ })).toBeDefined()
  })

  test(`panel: nowa grupa i nowy prompt z pola (${surface})`, async ($, on) => {
    setup(on)
    const ui = await pane($, surface)
    expect(await ui.find({ key: 'new-group' })).toBeUndefined()
    await ui.press({ key: 'add-group' })
    await ui.input({ key: 'new-group', text: '@blog' })
    expect(await ui.find({ key: 'new-group' })).toBeUndefined()
    await ui.input({ key: 'new-note', text: 'post o modach' })
    expect((await run($, '@blog list')).text).toContain('post o modach')
    expect((await run($, 'list')).text).toContain('pusto')
    await ui.select({ key: 'group', value: 'Skillsy' })
    await ui.input({ key: 'new-note', text: 'lokalny' })
    expect((await run($, 'list')).text).toContain('lokalny')
  })
}

const endTurn = ($: Engine, reason: 'answer' | 'error' | 'aborted', agentId?: string) =>
  $.turn.complete({
    reason,
    answer: '',
    durationMs: 1,
    isAborted: reason === 'aborted',
    turnId: 't',
    ...(agentId ? { agentId } : {}),
  } as never)

for (const surface of SURFACES) {
  test(`Wyślij wszystkie: potwierdzenie, potem po jednym na turę (${surface})`, async ($, on) => {
    const clock = setup(on)
    const sent = recordSubmits(on)
    on('turn.complete', () => ({ text: '' }))
    await run($, 'a')
    await run($, 'b')
    await run($, 'c')
    const ui = await band($, surface)

    await ui.press({ key: 'send-all' })
    expect(sent).toEqual([])
    expect((await ui.find({ type: 'Text', text: /Wysłać 3 prompty po kolei\?/ }))).toBeDefined()
    await ui.press({ key: 'send-all-no' })
    expect(await ui.find({ key: 'send-all' })).toBeDefined()

    await ui.press({ key: 'send-all' })
    await ui.press({ key: 'send-all-yes' })
    expect(sent).toEqual(['a'])
    expect(await ui.find({ key: 'send-all-stop' })).toBeDefined()

    await endTurn($, 'answer', 'sub-agent')
    await clock.advance(1)
    expect(sent).toEqual(['a'])

    await endTurn($, 'answer')
    await clock.advance(1)
    expect(sent).toEqual(['a', 'b'])
    await endTurn($, 'answer')
    await clock.advance(1)
    expect(sent).toEqual(['a', 'b', 'c'])
    expect((await run($, 'list')).text).toContain('pusto')
    expect(await ui.find({ key: 'send-all-stop' })).toBeUndefined()

    await endTurn($, 'answer')
    await clock.advance(1)
    expect(sent).toEqual(['a', 'b', 'c'])
  })

  test(`Wyślij wszystkie: błąd tury zatrzymuje kolejkę, reszta zostaje (${surface})`, async ($, on) => {
    setup(on)
    const sent = recordSubmits(on)
    on('turn.complete', () => ({ text: '' }))
    await run($, 'a')
    await run($, 'b')
    await run($, 'c')
    const ui = await pane($, surface)
    await ui.press({ key: 'send-all' })
    await ui.press({ key: 'send-all-yes' })
    expect(sent).toEqual(['a'])

    await endTurn($, 'error')
    expect(sent).toEqual(['a'])
    const list = (await run($, 'list')).text ?? ''
    expect(list).toContain('b')
    expect(list).toContain('c')
    expect(await ui.find({ key: 'send-all' })).toBeDefined()
  })
}

test('Wyślij wszystkie: przy jednym prompcie przycisku nie ma', async ($, on) => {
  setup(on)
  await run($, 'tylko jeden')
  const ui = await band($, 'desktop')
  expect(await ui.find({ key: 'send-all' })).toBeUndefined()
})

test('zapisany prompt pamięta czat, w którym powstał', async ($, on) => {
  const stored: Record<string, unknown> = {}
  setup(on, undefined, true, false)
  on('store.get', (_$, e) => ({ value: stored[e.key] }))
  on('store.set', (_$, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  await run($, 'zapamiętaj czat')
  expect(stored.groups).toMatchObject({ Skillsy: [{ text: 'zapamiętaj czat', chat: HERE }] })
})

for (const surface of SURFACES) {
  test(`panel: klik w prompt z innego czatu otwiera ten czat (${surface})`, async ($, on) => {
    setup(on, {
      groups: {
        Skillsy: [
          { text: 'z innego czatu', at: 1, chat: OTHER },
          { text: 'z tego czatu', at: 2, chat: HERE },
          { text: 'bez czatu', at: 3 },
        ],
      },
    })
    const opened: string[][] = []
    on('process.run', (_$, e) => {
      opened.push([...e.argv])
      return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
    })
    await run($, 'x')
    await run($, 'rm 4')
    const ui = await pane($, surface)
    expect(await ui.find({ key: 'open-2' })).toBeUndefined()
    expect(await ui.find({ key: 'open-3' })).toBeUndefined()
    await ui.press({ key: 'open-1' })
    expect(opened).toEqual([
      ['explorer.exe', `claude://claude.ai/epitaxy/${OTHER}`],
    ])
  })
}

test('panel: obok ↗ widać tytuł czatu z pliku aplikacji', async ($, on) => {
  setup(on, { groups: { Skillsy: [{ text: 'z innego czatu', at: 1, chat: OTHER }] } }, true, true, {
    APPDATA: 'C:\\Users\\x\\AppData\\Roaming',
    CLAUDE_CODE_ACCOUNT_UUID: 'acc',
    CLAUDE_CODE_ORGANIZATION_UUID: 'org',
  })
  const paths: string[] = []
  on('fs.read', (_$, e) => {
    paths.push(e.path)
    return { value: JSON.stringify({ sessionId: OTHER, title: 'Wreckfest wyścigowy tracker' }) } as never
  })
  await run($, 'x')
  await run($, 'rm 2')
  const ui = await pane($, 'desktop')
  expect(await ui.find({ type: 'Text', text: / Wreckfest wyścigowy tracker/ })).toBeDefined()
  expect(paths).toEqual([`C:\\Users\\x\\AppData\\Roaming\\Claude\\claude-code-sessions\\acc\\org\\${OTHER}.json`])
})

for (const surface of SURFACES) {
  test(`panel: krótki prompt wypełnia wiersz do przycisków (${surface})`, async ($, on) => {
    setup(on)
    await run($, 'ppp')
    const ui = await pane($, surface)
    const row = await ui.find({ type: 'Text', text: /^ppp/ })
    // bodyColumns 60 minus marker, age and gaps (8): the hover strip reaches the actions.
    expect(row?.text).toBe('ppp'.padEnd(52, '\u00a0'))
  })
}

for (const surface of SURFACES) {
  test(`panel: link ↗ należy do strefy najechania wiersza (${surface})`, async ($, on) => {
    setup(on, { groups: { Skillsy: [{ text: 'z innego czatu', at: 7, chat: OTHER }] } })
    await run($, 'x')
    await run($, 'rm 2')
    const ui = await pane($, surface)
    const link = await ui.find({ key: 'open-7' })
    expect(link).toBeDefined()
    expect(JSON.stringify(await ui.drawn())).toContain('"scope":"row-7"')
    expect(await ui.find({ key: 'rm-7' })).toBeDefined()
  })
}

for (const surface of SURFACES) {
  test(`panel: „usuń wszystkie” czyści wszystkie grupy po potwierdzeniu (${surface})`, async ($, on) => {
    setup(on, { groups: { Skillsy: [{ text: 'inna grupa', at: 7 }] } })
    await run($, 'pierwszy')
    await run($, 'drugi')
    const ui = await pane($, surface)
    await ui.press({ key: 'clear' })
    // Potwierdzenie w miejscu przycisku, z liczbą ze wszystkich grup.
    expect(await ui.find({ key: 'clear' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /Usunąć wszystkie/ }))?.text).toBe('Usunąć wszystkie 3 ze wszystkich grup?')
    await ui.press({ key: 'clear-no' })
    expect((await run($, 'all')).text).toContain('inna grupa')
    await ui.press({ key: 'clear' })
    await ui.press({ key: 'clear-yes' })
    expect((await run($, 'all')).text).toBe('Brak zapisanych promptów. Dodaj: /later <prompt>')
    // Pusta kolejka: przycisku nie ma.
    expect(await ui.find({ key: 'clear' })).toBeUndefined()
  })
}

for (const surface of SURFACES) {
  test(`panel: „wyczyść grupę” usuwa tylko pokazaną grupę (${surface})`, async ($, on) => {
    setup(on, { groups: { Inna: [{ text: 'inna grupa', at: 7 }] } })
    await run($, 'pierwszy')
    await run($, 'drugi')
    const ui = await pane($, surface)
    await ui.press({ key: 'clear-group' })
    expect((await ui.find({ type: 'Text', text: /^Usunąć 2 z @/ }))?.text).toMatch(/^Usunąć 2 z @.+\?$/)
    await ui.press({ key: 'clear-yes' })
    const all = (await run($, 'all')).text
    expect(all).toContain('inna grupa')
    expect(all).not.toContain('pierwszy')
  })
}

test('samotny przycisk „wyjaśnij” trafia do wiersza later', () => {
  const row = { type: 'Box', props: { key: 'wyjasnij-row' }, children: [{ type: 'Button', props: { key: 'explain' } }] }
  const block = { type: 'Box', props: { key: 'wyjasnij-block' }, children: [row, { type: 'Box', props: { key: 'wyjasnij-gap' } }] }
  const tree = { type: 'Box', props: {}, children: [{ type: 'Text', props: {}, children: ['cache'] }, block] }
  const { rest, taken } = takeBox(tree, 'wyjasnij-block')
  expect(taken).toBe(block)
  expect(JSON.stringify(rest)).not.toContain('wyjasnij')
  expect(findBox(taken, 'wyjasnij-row')).toBe(row)
  expect(takeBox(null, 'x')).toEqual({ rest: null, taken: null })
})

test('ikonka ołówka: gumka, korpus i grafit', () => {
  expect(pencilSvg()).toContain('#E0899B')
  expect(pencilSvg()).toContain('#E3A33A')
  expect(pencilSvg()).toContain('#2A2A28')
})
