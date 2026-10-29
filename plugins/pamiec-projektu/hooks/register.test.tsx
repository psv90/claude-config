import { expect, test } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

import { brainSvg, buildIndex, factsOf, parseNote, projectIn } from './register'

const BAZA = '---\nname: baza-hub\ndescription: "Baza — centrum zakładek (Projekty/Baza/, port 3212)"\nmetadata:\n  type: project\n---\n\nStart: node server.js, port 3212.'
const CENTRUM = '---\nname: centrum-hub\ndescription: "Centrum — wszystkie projekty (Centrum/, port 3200)"\n---\n\nPodobne do Baza, ale Centrum. Centrum. Centrum.'

const props: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {},
}

test('czyta notatkę i dobiera ją do folderu projektu', () => {
  const baza = parseNote('baza-hub.md', BAZA)
  expect(baza.description).toBe('Baza — centrum zakładek (Projekty/Baza/, port 3212)')
  expect(baza.body).toBe('Start: node server.js, port 3212.')
  const idx = buildIndex(['Baza', 'Centrum', 'Nic'], [baza, parseNote('centrum-hub.md', CENTRUM)])
  expect(idx.Baza?.name).toBe('baza-hub')
  expect(idx.Centrum?.name).toBe('centrum-hub')
  expect(idx.Nic).toBeUndefined()
  expect(projectIn('E:/Clode code/VideoLiblary/Projekty/Baza/server.js', 'E:\\Clode code\\VideoLiblary\\Projekty')).toBe('Baza')
  expect(projectIn('cd "Projekty/Baza/web" && npm start', 'E:/Clode code/VideoLiblary/Projekty')).toBe('Baza')
  expect(projectIn('C:/code/app/x.js', 'E:/Clode code/VideoLiblary/Projekty')).toBeNull()
  // Folder o nic niemówiącej nazwie: notatka wskazuje go polem `folder:`.
  const pinned = parseNote('p.md', '---\nname: stary\nfolder: Stary katalog\ndescription: "Coś zupełnie innego"\n---\n\nTreść.')
  expect(buildIndex(['Stary katalog'], [baza, pinned])['Stary katalog']?.name).toBe('stary')
  expect(factsOf(baza)).toEqual({ port: '3212', start: 'node server.js', vps: '', about: 'centrum zakładek' })
  const makro = parseNote('m.md', '---\nname: makro\ndescription: "Makro — kalendarz i taśma (Projekty/Makro port 3230, VPS /makro/)"\n---\n\nUruchom `start.bat` albo `node server.js`; port 3233 to front.')
  expect(factsOf(makro)).toEqual({ port: '3230', start: 'start.bat', vps: '/makro/', about: 'kalendarz i taśma' })
})

// Na dysku jest tylko pamięć Claude'a dla E:/Clode code/VideoLiblary i jego podfolder Projekty.
function machine(on: On, root: string) {
  on('session.root', () => ({ value: root }) as never)
  on('env.get', ($, e) => ({ value: (e as unknown as { name: string }).name === 'USERPROFILE' ? 'C:/Users/olek' : '' }) as never)
  on('fs.exists', ($, e) => {
    // Silnik podaje ścieżki z ukośnikami systemu.
    const path = (e as unknown as { path: string }).path.replace(/\\/g, '/')
    return { value: path.endsWith('/projects/E--Clode-code-VideoLiblary/memory') || path === 'E:/Clode code/VideoLiblary/Projekty' } as never
  })
}

test('po dotknięciu pliku projektu pasek pokazuje jego notatkę', async ($, on) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  on('session.cwd', () => ({ value: 'E:/Clode code/VideoLiblary' }) as never)
  machine(on, 'E:/Clode code/VideoLiblary')
  on('fs.list', ($, e) => {
    const path = (e as unknown as { path: string }).path
    const items = path.endsWith('memory') ? ['baza-hub.md', 'MEMORY.md'] : ['Baza']
    return { value: items.map(name => ({ name, kind: name.endsWith('.md') ? 'file' : 'dir', size: 1, mtimeMs: 0, isLink: false })) } as never
  })
  on('fs.read', () => ({ value: BAZA }) as never)
  on('tool.call', () => ({ result: {} }) as never)
  on('command.register', () => ({ value: {} }) as never)
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push((e as unknown as { id: string }).id)
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', () => ({ value: undefined }) as never)

  await $.session.start({ cwd: 'E:/Clode code/VideoLiblary' } as never)
  await $.tool.call({ tool: 'Read', file_path: 'E:/Clode code/VideoLiblary/Projekty/Baza/server.js' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'pamiec-projektu', surface, component: 'AbovePrompt', props })
    // Zwinięte: nazwa i fakty, bez opisu. Nazwa w Boksie, który się nie kurczy (bez łamania na dwie linie).
    expect(await ui.find({ type: 'Text', text: /^Baza$/ })).toBeDefined()
    const nameRow = await ui.find({ type: 'Text', text: /Baza/, props: { wrap: 'truncate-end' } } as never)
    expect(nameRow).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^3212$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^node server\.js$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /centrum zakładek/ })).toBeUndefined()
    // „więcej” otwiera panel (przewijany), a pasek zostaje jednym wierszem.
    await ui.press({ key: 'more' })
    expect(opened).toContain('pamiec-projektu')
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    const pane = await $.ui.mount({
      plugin: 'pamiec-projektu',
      surface,
      component: 'Pane',
      requestId: 'pamiec-projektu',
      props: { title: 'Baza', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    } as never)
    expect(await pane.find({ type: 'Text', text: /^centrum zakładek$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^uruchom$/ })).toBeDefined()
    expect(await pane.find({ type: 'Markdown' })).toBeDefined()
    await pane.unmount()
    await ui.press({ key: 'more' })
    await ui.unmount()
  }
})

test('„ukryj” chowa pasek, a /pamiec go przywraca', async ($, on) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  on('session.cwd', () => ({ value: 'E:/Clode code/VideoLiblary/Projekty/Baza' }) as never)
  // Sesja w podfolderze projektu: pamięć znajduje się piętro wyżej.
  machine(on, 'E:/Clode code/VideoLiblary/Projekty/Baza')
  on('command.register', () => ({ value: {} }) as never)
  on('fs.list', ($, e) => {
    const path = (e as unknown as { path: string }).path
    const items = path.endsWith('memory') ? ['baza-hub.md'] : ['Baza']
    return { value: items.map(name => ({ name, kind: name.endsWith('.md') ? 'file' : 'dir', size: 1, mtimeMs: 0, isLink: false })) } as never
  })
  on('fs.read', () => ({ value: BAZA }) as never)
  await $.session.start({ cwd: 'E:/Clode code/VideoLiblary/Projekty/Baza' } as never)
  const ui = await $.ui.mount({ plugin: 'pamiec-projektu', surface: 'desktop', component: 'AbovePrompt', props })
  expect((await ui.find({ key: 'hide' }))?.props.label).toBe('ukryj')
  await ui.press({ key: 'hide' })
  await ui.unmount()
  // Ukryty: mod nic nie rysuje (pod nim w teście nie ma innego paska).
  expect(await $.ui.mount({ plugin: 'pamiec-projektu', surface: 'desktop', component: 'AbovePrompt', props }).catch(() => null)).toBeNull()
  const r = await $.command.run({ command: 'pamiec', args: '' } as never)
  expect(JSON.stringify(r)).toContain('Przywróciłem pasek: Baza')
  const back = await $.ui.mount({ plugin: 'pamiec-projektu', surface: 'desktop', component: 'AbovePrompt', props })
  expect(await back.find({ type: 'Text', text: /^Baza$/ })).toBeDefined()
  await back.unmount()
})

test('ikonka mózgu: iskierka tylko przy otwartym panelu', () => {
  expect(brainSvg(false)).toContain('#E0899B')
  expect(brainSvg(false)).not.toContain('#FFD27A')
  expect(brainSvg(true)).toContain('#FFD27A')
})
