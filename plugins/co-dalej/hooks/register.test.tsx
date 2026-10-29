import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

import { blockedLabel, blockedOf, isBlocked, pickedPrompt, isSimilar, nextIgnored, parseQuestions, projectKey, ruleWith, settle, signSvg, stripQuestions, unblockAll } from './register'

const props: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {},
}

const ANSWER = `Zrobione.

**Co dalej?**
1. Dodać eksport do CSV?
2. Zapamiętywać ostatni filtr?
3. Pokazać licznik nieprzeczytanych?`

const CWD = 'E:\\Projekty\\demo'
const P = projectKey(CWD)
const OTHER = projectKey('E:/Projekty/kalendarz')

// Folder sesji pod modem: rejestrowany przed pierwszym wywołaniem $.
function cwdHook(on: On) {
  on('session.cwd', () => ({ value: CWD }) as never)
}

test('wyciąga trzy pytania spod nagłówka', () => {
  expect(parseQuestions(ANSWER)).toEqual([
    'Dodać eksport do CSV?',
    'Zapamiętywać ostatni filtr?',
    'Pokazać licznik nieprzeczytanych?',
  ])
  expect(parseQuestions('Zwykła odpowiedź bez sekcji.')).toEqual([])
})

test('nagłówek tylko jako osobna linia, nie słowa w zdaniu', () => {
  const answer = `Dodaję sekcję „Co dalej?”, żeby mod miał przyciski.\n\nSprawdź:\n1. Pierwsza rzecz\n2. Druga rzecz\n3. Trzecia rzecz\n\n${ANSWER.split('\n').slice(2).join('\n')}`
  expect(parseQuestions(answer)).toEqual(['Dodać eksport do CSV?', 'Zapamiętywać ostatni filtr?', 'Pokazać licznik nieprzeczytanych?'])
  // Po wycięciu sekcji zostaje zdanie z „Co dalej?”, ale nie jest nagłówkiem: brak propozycji.
  expect(parseQuestions(stripQuestions(answer))).toEqual([])
  expect(stripQuestions(answer)).toContain('3. Trzecia rzecz')
})

test('usuwa ikonki z propozycji', () => {
  expect(parseQuestions('**Co dalej?**\n1. 💰 Dodać koszt w dolarach?\n2. Oznaczać testy 🧪 osobno?\n3. ⚠️ Ostrzegać przed limitem?')).toEqual([
    'Dodać koszt w dolarach?',
    'Oznaczać testy osobno?',
    'Ostrzegać przed limitem?',
  ])
})

test('wycina sekcję z odpowiedzi, zostawia resztę', () => {
  expect(stripQuestions(ANSWER)).toBe('Zrobione.')
  expect(stripQuestions(`Zrobione.\n\n---\n\n${ANSWER.split('\n').slice(2).join('\n')}\n\nPS. dopisek`)).toBe('Zrobione.\n\nPS. dopisek')
  expect(stripQuestions('Bez sekcji.')).toBe('Bez sekcji.')
})

test('wiadomość bez sekcji, przyciski z wyciętych pytań', async ($, on) => {
  mock.store(on, {})
  cwdHook(on)
  let stored = ''
  on('session.append', ($, e, next) => {
    const b = e.message.content[0]
    stored = b && b.type === 'text' ? b.text : ''
    return next(e)
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.session.append({
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: ANSWER }] },
    door: 'response',
    origin: { kind: 'model', model: 'claude-opus-5-5' },
    uuid: 'u1',
  } as never)
  expect(stored).toBe('Zrobione.')
  await $.turn.complete({ answer: 'Zrobione.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ plugin: 'co-dalej', surface: 'desktop', component: 'AbovePrompt', props })
  expect((await ui.find({ key: 'q1' }))?.props.label).toBe('Dodać eksport do CSV?')
  expect(await ui.find({ key: 'q3' })).toBeDefined()
  await ui.unmount()
})

test('„inne” podmienia propozycje na trzy nowe, a pokazane liczy jako pominięte', async ($, on) => {
  mock.store(on, {})
  const time = mock.clock(on, { now: 0 })
  cwdHook(on)
  let asked = ''
  on('model.complete', ($, e) => {
    asked = e.prompt
    return {
      value: {
        isAnswered: true,
        text: '1. Dodać eksport danych do CSV?\n2. Dodać ciemny motyw?\n3. Dodać skrót do wyszukiwania?\n4. Pokazywać datę edycji?',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    } as never
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.complete({ answer: ANSWER, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ plugin: 'co-dalej', surface: 'terminal', component: 'AbovePrompt', props })
  await ui.press({ key: 'more' })
  await time.settle()
  // Eksport powtarza pokazaną propozycję, więc odpada.
  expect((await ui.find({ key: 'q1' }))?.props.label).toBe('Dodać ciemny motyw?')
  expect((await ui.find({ key: 'q3' }))?.props.label).toBe('Pokazywać datę edycji?')
  expect(asked).toContain('Zapamiętywać ostatni filtr?')
  // Po dobraniu przycisk „inne” wraca.
  expect(await ui.find({ key: 'more' })).toBeDefined()
  await ui.unmount()
})

test('rozpoznaje tę samą propozycję inaczej sformułowaną', () => {
  expect(isSimilar('Dodać eksport do CSV w widoku historii?', 'Dodać eksport historii do pliku CSV?')).toBe(true)
  expect(isSimilar('Dodać eksport do CSV w widoku historii?', 'Zapamiętywać ostatni filtr?')).toBe(false)
  expect(isSimilar('Dodać przycisk „Kopiuj” przy słówkach?', 'Dodać licznik słówek?')).toBe(false)
})

test('różne propozycje o podobnym słownictwie się nie zlewają', () => {
  expect(isSimilar('Dodać w panelu wyszukiwanie po treści zablokowanych propozycji?', 'Pokazywać w panelu też propozycje z 1 pominięciem?')).toBe(false)
  expect(isSimilar('Dodać wyszukiwarkę po dniu do osi czasu w kalendarzu?', 'Dodać w panelu wyszukiwanie po treści?')).toBe(false)
  expect(isSimilar('Eksport do CSV dodać?', 'Dodać eksport do pliku CSV?')).toBe(true)
})

test('po 2 pominięciach blokuje, a wybór zeruje licznik', () => {
  const shown = ['Dodać eksport do CSV?', 'Zapamiętywać ostatni filtr?']
  let list = nextIgnored([], shown, 'zrób coś innego', 0, P)
  expect(isBlocked(list, 'Dodać eksport do pliku CSV?', P)).toBe(false)
  list = nextIgnored(list, ['Eksport do CSV dodać?'], 'inna sprawa', 1, P)
  expect(isBlocked(list, 'Dodać eksport do pliku CSV?', P)).toBe(true)
  expect(isBlocked(list, 'Zapamiętywać ostatni filtr?', P)).toBe(false)
  // Wybór filtra (tu: własnymi słowami) usuwa go z pominiętych.
  list = nextIgnored(list, ['Zapamiętywać ostatni filtr?'], 'tak, zapamiętuj ostatni filtr', 3, P)
  expect(list.some(i => /filtr/.test(i.text))).toBe(false)
  // Pominięcia starsze niż 30 dni wygasają.
  expect(nextIgnored(list, [], 'x', 31 * 24 * 60 * 60 * 1000, P)).toEqual([])
  expect(ruleWith(['Eksport do CSV dodać?'])).toContain('- Eksport do CSV dodać?')
})

test('blokady są osobne dla każdego projektu', () => {
  let list = nextIgnored([], ['Dodać eksport do CSV?'], 'x', 0, OTHER)
  list = nextIgnored(list, ['Dodać eksport do CSV?'], 'y', 1, OTHER)
  // Zablokowane w kalendarzu, ale nie w demo.
  expect(isBlocked(list, 'Dodać eksport do CSV?', OTHER)).toBe(true)
  expect(isBlocked(list, 'Dodać eksport do CSV?', P)).toBe(false)
  // Pominięcie w demo nie dolicza się do wpisu kalendarza.
  list = nextIgnored(list, ['Dodać eksport do CSV?'], 'z', 2, P)
  expect(isBlocked(list, 'Dodać eksport do CSV?', P)).toBe(false)
  expect(blockedOf(list, OTHER)).toHaveLength(1)
  expect(blockedOf(list, P)).toHaveLength(0)
  // Wpisy sprzed podziału (bez projektu) nie blokują nigdzie.
  expect(isBlocked([{ text: 'Dodać eksport do CSV?', misses: 5, lastAt: 0 }], 'Dodać eksport do CSV?', P)).toBe(false)
  // Ścieżka z innymi ukośnikami i wielkością liter to ten sam projekt.
  expect(projectKey('e:/projekty/DEMO/')).toBe(P)
})

test('zablokowana propozycja nie pokazuje się jako przycisk', async ($, on) => {
  mock.store(on, {
    ignored: [
      { text: 'Dodać eksport do CSV?', misses: 3, lastAt: 0, project: P },
      { text: 'Zapamiętywać ostatni filtr?', misses: 3, lastAt: 0, project: OTHER },
    ],
  })
  mock.clock(on, { now: 0 })
  cwdHook(on)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.complete({ answer: ANSWER, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ plugin: 'co-dalej', surface: 'terminal', component: 'AbovePrompt', props })
  // Filtr zablokowany tylko w innym projekcie, więc tu zostaje.
  expect((await ui.find({ key: 'q1' }))?.props.label).toBe('Zapamiętywać ostatni filtr?')
  expect(await ui.find({ key: 'q3' })).toBeUndefined()
  await ui.unmount()
})

test('przycisk × blokuje propozycję od razu', async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 0 })
  cwdHook(on)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.complete({ answer: ANSWER, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ plugin: 'co-dalej', surface: 'terminal', component: 'AbovePrompt', props })
  await ui.press({ key: 'x1' })
  expect((await ui.find({ key: 'q1' }))?.props.label).toBe('Zapamiętywać ostatni filtr?')
  await ui.unmount()
  // Następnym razem ta sama propozycja się nie pokaże.
  await $.turn.complete({ answer: ANSWER, durationMs: 1000, isAborted: false, turnId: 't2', reason: 'answer' })
  const again = await $.ui.mount({ plugin: 'co-dalej', surface: 'terminal', component: 'AbovePrompt', props })
  expect((await again.find({ key: 'q1' }))?.props.label).toBe('Zapamiętywać ostatni filtr?')
  await again.unmount()
})

const paneProps: RenderPropsOf['Pane'] = {
  title: 'Zablokowane propozycje', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {},
}

// Hooki pod modem do startu sesji: rejestrowane przed pierwszym wywołaniem $.
function sessionHooks(on: On) {
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  on('command.register', () => ({ value: { command: 'co-dalej' } }) as never)
  cwdHook(on)
}
const SESSION = { cwd: CWD, surface: 'terminal', isInteractive: true } as never

const BLOCKED = [
  { text: 'Dodać eksport do CSV?', misses: 2, lastAt: 1, project: P },
  { text: 'Zapamiętywać ostatni filtr?', misses: 2, lastAt: 2, project: P },
  { text: 'Pokazać licznik nieprzeczytanych?', misses: 1, lastAt: 3, project: P },
  { text: 'Podpisać kreski dat nad osią?', misses: 2, lastAt: 4, project: OTHER },
]

// Panel otwarty na widoku zablokowanych (domyślny widok to historia).
const mountPane = async ($: Parameters<TestBody>[0]) => {
  const ui = await $.ui.mount({ plugin: 'co-dalej', surface: 'terminal', component: 'Pane', requestId: 'co-dalej-zablokowane', props: paneProps, viewport: { columns: 80, rows: 40 } })
  await ui.press({ key: 'tab-blocked' })
  return ui
}

test('historia zapisuje każdą trójkę i los każdej propozycji', async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: Date.UTC(2026, 9, 25, 12, 0) })
  cwdHook(on)
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  on('command.run', () => ({ text: 'ok' }) as never)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.complete({ answer: ANSWER, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  const band = await $.ui.mount({ plugin: 'co-dalej', surface: 'desktop', component: 'AbovePrompt', props })
  await band.press({ key: 'l3' })
  await band.press({ key: 'q1' })
  await band.unmount()
  const ui = await $.ui.mount({ plugin: 'co-dalej', surface: 'terminal', component: 'Pane', requestId: 'co-dalej-zablokowane', props: paneProps, viewport: { columns: 80, rows: 40 } })
  // Pierwsza: wybrana, druga: pominięta, trzecia: na później.
  const labels = (await ui.findAll({ type: 'Text', text: /^(wybrana|pominięta|na później|zablokowana|bez decyzji)$/ })).map(t => t.text)
  expect(labels).toEqual(['wybrana', 'pominięta', 'na później'])
  expect(await ui.find({ type: 'Text', text: /demo$/ })).toBeDefined()
  expect(settle([], () => 'wybrana')).toEqual([])
  await ui.unmount()
})

test('panel pokazuje zablokowane tego projektu i pozwala odblokować jedną', async ($, on) => {
  mock.store(on, { ignored: BLOCKED })
  sessionHooks(on)
  await $.session.start(SESSION)
  const ui = await mountPane($)
  // Najnowsza na górze; licznik ma 1 pominięcie, a kreski dat są z innego projektu.
  expect(await ui.find({ type: 'Text', text: 'Zapamiętywać ostatni filtr?' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /licznik/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /kreski/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^ · 2$/ })).toBeDefined()
  await ui.press({ key: 'u0' })
  expect(await ui.find({ type: 'Text', text: 'Zapamiętywać ostatni filtr?' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Dodać eksport do CSV?' })).toBeDefined()
  await ui.unmount()
})

test('„Odblokuj wszystkie” wymaga potwierdzenia i nie rusza innych projektów', async ($, on) => {
  mock.store(on, { ignored: BLOCKED })
  sessionHooks(on)
  await $.session.start(SESSION)
  const ui = await mountPane($)
  await ui.press({ key: 'all' })
  expect(await ui.find({ key: 'all' })).toBeUndefined()
  await ui.press({ key: 'all-yes' })
  expect(await ui.find({ type: 'Text', text: 'demo: pusto' })).toBeDefined()
  await ui.unmount()
  // Kreski dat z kalendarza zostały zablokowane.
  expect(unblockAll(BLOCKED, P)).toEqual([BLOCKED[2], BLOCKED[3]])
})

test('pasek pokazuje przycisk z liczbą zablokowanych po kliknięciu ×', async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 0 })
  sessionHooks(on)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.session.start(SESSION)
  await $.turn.complete({ answer: ANSWER, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ plugin: 'co-dalej', surface: 'terminal', component: 'AbovePrompt', props })
  expect(await ui.find({ key: 'blocked' })).toBeUndefined()
  // „inne” w innym kolorze niż propozycje.
  expect((await ui.find({ key: 'more' }))?.props.dimColor).toBe(true)
  expect(await ui.find({ type: 'Box', props: { key: 'co-dalej-tools' } } as never)).toBeDefined()
  await ui.press({ key: 'x2' })
  expect((await ui.find({ key: 'blocked' }))?.props.label).toBe('1 zablokowana')
  expect(blockedLabel(3)).toBe('3 zablokowane')
  expect(blockedLabel(35)).toBe('35 zablokowanych')
  expect(blockedLabel(12)).toBe('12 zablokowanych')
  expect((await ui.find({ type: 'Text', text: '⊘' }))?.props.color).toBe('warning')
  await ui.unmount()
})

test('„+ później” zapisuje propozycję komendą /later i zdejmuje ją z przycisków', async ($, on) => {
  mock.store(on, {})
  cwdHook(on)
  const ran: string[] = []
  on('command.run', ($, e) => {
    ran.push(`${e.command} ${e.args}`)
    return { text: 'ok' } as never
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.complete({ answer: ANSWER, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ plugin: 'co-dalej', surface: 'desktop', component: 'AbovePrompt', props })
  expect(await ui.find({ type: 'Box', props: { key: 'co-dalej-block' } } as never)).toBeDefined()
  await ui.press({ key: 'l2' })
  expect(ran).toEqual(['later Zapamiętywać ostatni filtr?'])
  expect((await ui.find({ key: 'q2' }))?.props.label).toBe('Pokazać licznik nieprzeczytanych?')
  await ui.unmount()
})

test('zaznaczone kółkiem propozycje idą jednym promptem i liczą się jako wybrane', async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 0 })
  cwdHook(on)
  const sent: string[] = []
  on('prompt.submit', ($, e) => {
    sent.push(e.text)
    return { text: e.text } as never
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  // Dwie rundy: za każdym razem zaznaczone 1 i 3, pominięta 2.
  for (const turnId of ['t1', 't2']) {
    await $.turn.complete({ answer: ANSWER, durationMs: 1000, isAborted: false, turnId, reason: 'answer' })
    const ui = await $.ui.mount({ plugin: 'co-dalej', surface: 'desktop', component: 'AbovePrompt', props })
    expect(await ui.find({ key: 'send-picked' })).toBeUndefined()
    await ui.press({ key: 'p1' })
    await ui.press({ key: 'p3' })
    expect((await ui.find({ key: 'p1' }))?.props.label).toBe('●')
    expect((await ui.find({ key: 'p2' }))?.props.label).toBe('○')
    expect((await ui.find({ key: 'send-picked' }))?.props.label).toBe('wyślij zaznaczone (2)')
    await ui.press({ key: 'send-picked' })
    await ui.unmount()
  }
  expect(sent[0]).toBe('Wprowadź te zmiany:\n1. Dodać eksport do CSV?\n2. Pokazać licznik nieprzeczytanych?')
  // Po dwóch pominięciach blokuje się tylko niezaznaczona 2; zaznaczone zostają na przyciskach.
  await $.turn.complete({ answer: ANSWER, durationMs: 1000, isAborted: false, turnId: 't3', reason: 'answer' })
  const ui = await $.ui.mount({ plugin: 'co-dalej', surface: 'desktop', component: 'AbovePrompt', props })
  expect((await ui.find({ key: 'q1' }))?.props.label).toBe('Dodać eksport do CSV?')
  expect((await ui.find({ key: 'q2' }))?.props.label).toBe('Pokazać licznik nieprzeczytanych?')
  expect(pickedPrompt(['Jedna?'])).toBe('Jedna?')
  // Tekst z pola promptu na początku, propozycje jako dodatek.
  expect(pickedPrompt(['Jedna?'], 'popraw kolor')).toBe('popraw kolor\n\nDodatkowo: Jedna?')
  expect(pickedPrompt(['A?', 'B?'], ' popraw kolor ')).toBe('popraw kolor\n\nDodatkowo wprowadź te zmiany:\n1. A?\n2. B?')
  await ui.unmount()
})

test('kliknięta propozycja jedzie razem z tekstem wpisanym w polu promptu', async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 0 })
  cwdHook(on)
  const sent: string[] = []
  const fills: string[] = []
  on('prompt.read', () => ({ value: { text: 'zmień też tytuł', cursor: 15 } }) as never)
  on('prompt.fill', ($, e) => {
    fills.push((e as unknown as { text: string }).text)
    return { isFilled: true } as never
  })
  on('prompt.submit', ($, e) => {
    sent.push(e.text)
    return { text: e.text } as never
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.complete({ answer: ANSWER, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ plugin: 'co-dalej', surface: 'desktop', component: 'AbovePrompt', props })
  await ui.press({ key: 'q2' })
  expect(sent).toEqual(['zmień też tytuł\n\nDodatkowo: Zapamiętywać ostatni filtr?'])
  expect(fills).toEqual([''])
  await ui.unmount()
})

test('dobiera brakujące propozycje do trzech', async ($, on) => {
  mock.store(on, { ignored: [{ text: 'Dodać eksport do CSV?', misses: 2, lastAt: 0, project: P }] })
  const time = mock.clock(on, { now: 0 })
  cwdHook(on)
  let asked = ''
  on('model.complete', ($, e) => {
    asked = e.prompt
    return {
      value: {
        isAnswered: true,
        text: '1. Dodać eksport danych do pliku CSV?\n2. Dodać sortowanie listy po dacie?\n3. Zapamiętywać ostatni filtr na stałe?\n4. Pokazać podgląd przed wysłaniem?',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    } as never
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.complete({ answer: ANSWER, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ plugin: 'co-dalej', surface: 'terminal', component: 'AbovePrompt', props })
  await time.settle()
  // Zablokowany eksport odpada (także w wersji od modelu), filtr się powtarza, więc wchodzi sortowanie.
  expect((await ui.find({ key: 'q1' }))?.props.label).toBe('Zapamiętywać ostatni filtr?')
  expect((await ui.find({ key: 'q2' }))?.props.label).toBe('Pokazać licznik nieprzeczytanych?')
  expect((await ui.find({ key: 'q3' }))?.props.label).toBe('Dodać sortowanie listy po dacie?')
  expect(asked).toContain('Dodać eksport do CSV?')
  await ui.unmount()
})

test('reguła trafia do system promptu', async ($, on) => {
  mock.store(on, {})
  cwdHook(on)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'x', scope: 'shared' as const }] }))
  const r = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  expect(r.sections.at(-1)?.id).toBe('co-dalej:pytania')
  // Reguła mówi wprost, że sekcja jest obowiązkowa, choć mod wycina ją z historii.
  expect(r.sections.at(-1)?.text).toContain('nie wzoruj się na historii')
})

test('po zakończonej turze pokazuje przyciski 1-3', async ($, on) => {
  mock.store(on, {})
  cwdHook(on)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.complete({ answer: ANSWER, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'co-dalej', surface, component: 'AbovePrompt', props })
    expect((await ui.find({ key: 'q1' }))?.props.label).toBe('Dodać eksport do CSV?')
    expect(await ui.find({ key: 'q3' })).toBeDefined()
    await ui.unmount()
  }
})

test('drogowskaz: strzałka na propozycję, zaznaczona zielona, robot macha po zaznaczeniu', () => {
  const idle = signSvg(3, [], 0)
  expect(idle.match(/<path d="M23 [^"]*" fill="#D97757"/g)?.length).toBe(3)
  expect(idle).toContain('>?</text>')
  const picked = signSvg(3, [1], 0)
  expect(picked).toContain('#4EBA65')
  expect(picked).toContain('>✓</text>')
  expect(picked).toContain('opacity=".55"')
  // Bez robota na wózku: sam drogowskaz.
  expect(picked).not.toContain('#1D9E75')
  expect(picked).not.toContain('#55544F')
  expect(signSvg(2, [], 0).match(/<path d="M23 /g)?.length).toBe(2)
})

test('drogowskaz tylko na desktopie', async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 0 })
  cwdHook(on)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.complete({ answer: ANSWER, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  const desk = await $.ui.mount({ plugin: 'co-dalej', surface: 'desktop', component: 'AbovePrompt', props })
  expect((await desk.findAll({ type: 'Svg' })).length).toBe(1)
  await desk.unmount()
  const term = await $.ui.mount({ plugin: 'co-dalej', surface: 'terminal', component: 'AbovePrompt', props })
  expect((await term.findAll({ type: 'Svg' })).length).toBe(0)
  await term.unmount()
})
