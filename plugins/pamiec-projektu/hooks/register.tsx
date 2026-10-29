// pamiec-projektu: gdy sesja startuje w folderze projektu albo Claude dotyka
// plików pod <folder z projektami>\<nazwa>\, pasek nad promptem pokazuje notatkę
// o tym projekcie z pamięci (opis jednym zdaniem; „więcej” rozwija całość: port,
// jak uruchomić, pułapki). Notatkę dobiera po polu `folder:` w jej nagłówku albo
// po tym, która najczęściej wspomina folder projektu.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Index, Note } from '../types'

type Options = { projekty: string; pamiec: string }

const PANE = 'pamiec-projektu'
// Prawa kolumna wspólna z later, cache-bar, progres-bar i agenci.
const RIGHT_COLS = 16

// Ikonka mózgu (desktop) w stylu robotów z innych modów: płaskie kształty, średnie tony czytelne
// na ciemnym i jasnym tle, ciemne „zakręty”. Przy otwartym panelu nad mózgiem świeci iskierka.
export function brainSvg(isOpen: boolean): string {
  const lobe = '#E0899B'
  const fold = '#2A2A28'
  const spark = isOpen
    ? `<path d="M19 1.5l.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9z" fill="#FFD27A"/>`
    : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="20" viewBox="0 0 22 20">` +
    // Dwie półkule, pień mózgu i zakręty.
    `<path d="M10.6 3.2c-1.6-1.4-4.4-1-5.3.9-1.9.1-3.2 1.9-2.7 3.7-1.4 1-1.4 3.3.1 4.3-.3 1.9 1.3 3.5 3.2 3.2 1 1.4 3.2 1.6 4.7.4z" fill="${lobe}"/>` +
    `<path d="M11.4 3.2c1.6-1.4 4.4-1 5.3.9 1.9.1 3.2 1.9 2.7 3.7 1.4 1 1.4 3.3-.1 4.3.3 1.9-1.3 3.5-3.2 3.2-1 1.4-3.2 1.6-4.7.4z" fill="${lobe}"/>` +
    `<rect x="9.8" y="15.2" width="2.4" height="3.6" rx="1.1" fill="#C26A7D"/>` +
    `<path d="M11 3.4v12.2" stroke="${fold}" stroke-width=".9" stroke-linecap="round"/>` +
    // Zakręty: faliste linie w poprzek półkul, przesunięte względem siebie (nie układają się w twarz).
    `<path d="M3.8 7.6q1-1 2 0t2 0t1.8-.2M4.2 11.4q1 .9 2 0t2 0t1.6.3M6 14.4q.8-.8 1.7 0t1.6-.1" stroke="${fold}" stroke-width=".85" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M12.4 6.4q1 .9 2 0t2 0t1.8.3M12.6 10q1-1 2 0t2 0t1.6-.2M12.8 13.6q.9.8 1.8 0t1.7.1" stroke="${fold}" stroke-width=".85" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `${spark}</svg>`
  )
}

const index = atom({ plugin: 'pamiec-projektu', key: 'index' } as const, {})
const projects = atom({ plugin: 'pamiec-projektu', key: 'projects' } as const, '')
const project = atom({ plugin: 'pamiec-projektu', key: 'project' } as const, null)
const isOpen = atom({ plugin: 'pamiec-projektu', key: 'isOpen' } as const, false)
const dismissed = atom({ plugin: 'pamiec-projektu', key: 'dismissed' } as const, [])

export function parseNote(file: string, text: string): Note {
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/)
  const head = fm?.[1] ?? ''
  const field = (k: string) => head.match(new RegExp(`^${k}:\\s*"?(.*?)"?\\s*$`, 'm'))?.[1] ?? ''
  return {
    file,
    name: field('name'),
    description: field('description'),
    folder: field('folder'),
    body: (fm ? text.slice(fm[0].length) : text).trim(),
  }
}

const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')

// Projekt -> notatka: ta, która wskazuje folder polem `folder:` (dla folderów, których
// nazwa nic nie mówi), ta, której nazwa pasuje do folderu, albo która najczęściej
// go wspomina. Notatki-centralki (wspominające wiele folderów) ważą mniej.
export function buildIndex(folders: string[], notes: Note[]): Index {
  const spread = new Map(notes.map(n => [n, folders.filter(f => plain(`${n.description}\n${n.body}`).includes(plain(f))).length]))
  const out: Index = {}
  for (const folder of folders) {
    const pinned = notes.find(n => n.folder && plain(n.folder) === plain(folder))
    if (pinned) {
      out[folder] = pinned
      continue
    }
    const needle = plain(folder)
    const words = needle.split(/[^a-z0-9]+/).filter(w => w.length >= 4)
    let best: Note | null = null
    let bestScore = 1
    for (const n of notes) {
      const hay = plain(`${n.description}\n${n.body}`)
      let score = hay.split(needle).length - 1
      if (plain(n.description).includes(needle)) score += 5
      if (words.length && words.every(w => plain(n.name).includes(w.slice(0, 5)))) score += 10
      score /= Math.max(1, (spread.get(n) ?? 0) / 4)
      if (score > bestScore) {
        best = n
        bestScore = score
      }
    }
    if (best) out[folder] = best
  }
  return out
}

// Kluczowe fakty z notatki: port (najpierw z opisu), polecenie startu (pierwsze
// polecenie w `grawisach` albo po „start:”), ścieżka na VPS-ie i opis bez nawiasu
// z folderem i portem.
const COMMAND = /^(start\.bat|node |npm |npx |pnpm |yarn |bun |python|py |electron|uvicorn |\.\\|powershell )/i
export function factsOf(note: Note): { port: string; start: string; vps: string; about: string } {
  const all = `${note.description}\n${note.body}`
  const port = (note.description.match(/port\w*\s*:?\s*(\d{4,5})/i) ?? all.match(/port\w*\s*:?\s*(\d{4,5})/i))?.[1] ?? ''
  const spans = [...note.body.matchAll(/`([^`\n]+)`/g)].map(m => m[1]!.trim())
  const start =
    spans.find(s => COMMAND.test(s)) ?? note.body.match(/\bstart\s*:\s*(.+?)(?=,|\.\s|\.$|\n|$)/im)?.[1]?.trim() ?? ''
  const vps = all.match(/VPS\s+(\/[\w-]+\/)/)?.[1] ?? ''
  const about = note.description
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/^[^—–]+?\s[—–]\s/, '')
    .trim()
  return { port, start, vps, about: about || note.description }
}

// Nazwa projektu ze ścieżki: segment po nazwie folderu z projektami (także w ścieżce względnej).
export function projectIn(path: string, projectsDir: string): string | null {
  const name = projectsDir.split(/[\\/]/).filter(Boolean).pop()
  if (!name) return null
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return path.match(new RegExp(`${esc}[\\\\/]+([^\\\\/"'\`]+)`, 'i'))?.[1]?.trim() ?? null
}

// Najbliższy folder (od korzenia sesji w górę), dla którego Claude prowadzi pamięć:
// <config>/projects/<ścieżka, w której znaki inne niż litery i cyfry to „-”>/memory.
export async function findMemory($: EngineInterface): Promise<{ base: string; memory: string } | null> {
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${home}/.claude`
  for (let dir = await $.session.root(); ; ) {
    const memory = `${config}/projects/${dir.replace(/[^a-zA-Z0-9]/g, '-')}/memory`
    if (await $.fs.exists(memory)) return { base: dir, memory }
    const up = dir.replace(/[\\/][^\\/]*[\\/]?$/, '')
    if (!up || up === dir) return null
    dir = up
  }
}

// Foldery z opcji moda; puste: pamięć z findMemory i jej podfolder Projekty (bez niego sam ten folder).
async function load($: EngineInterface, options: Options) {
  const found = options.pamiec ? null : await findMemory($)
  const memory = options.pamiec || found?.memory
  if (!memory) return
  const base = found?.base ?? (await $.session.root())
  const dir = options.projekty || ((await $.fs.exists(`${base}/Projekty`)) ? `${base}/Projekty` : base)
  const folders = (await $.fs.list(dir)).filter(e => e.kind === 'dir').map(e => e.name)
  const notes: Note[] = []
  for (const f of await $.fs.list(memory)) {
    if (!f.name.endsWith('.md') || f.name === 'MEMORY.md') continue
    const text = await $.fs.read(`${memory}/${f.name}`).catch(() => '')
    if (text) notes.push(parseNote(f.name, text.replace(/\r\n/g, '\n')))
  }
  const built = buildIndex(folders, notes)
  await update($, projects, () => dir)
  await update($, index, () => built)
}

async function show($: EngineInterface, name: string | null) {
  if (!name || name === (await read($, project))) return
  if (!(await read($, index))[name]) return
  await update($, project, () => name)
  await update($, isOpen, () => false)
}

export const register: Register = (on, options) => {
  const opts: Options = { projekty: String(options.projekty ?? ''), pamiec: String(options.pamiec ?? '') }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'pamiec', description: 'Przywraca ukryty pasek pamięci projektu' })
    await load($, opts)
    await show($, projectIn(await $.session.cwd(), await read($, projects)))
    return result
  })

  // /pamiec: przywraca wszystkie ukryte paski tej sesji.
  on('command.run', { command: 'pamiec' }, async $ => {
    const hidden = await read($, dismissed)
    if (hidden.length === 0) return { text: 'Pasek pamięci projektu nie jest ukryty.' }
    await update($, dismissed, () => [])
    return { text: `Przywróciłem pasek: ${hidden.join(', ')}.` }
  })

  on('tool.call', async ($, e, next) => {
    if (!e.agentId) {
      const input = e as unknown as { file_path?: unknown; path?: unknown; notebook_path?: unknown; command?: unknown }
      const path = String(input.file_path ?? input.notebook_path ?? input.path ?? input.command ?? '')
      await show($, projectIn(path, await read($, projects)))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const name = await read($, project)
    const note = name ? (await read($, index))[name] : undefined
    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    // Kreskę oddzielającą rysuje later pod blokiem co-dalej / wyjasnij.
    if (!name || !note || e.props.hasSurvey || (await read($, dismissed)).includes(name)) return next(e)

    // Rozwinięta karta jest w panelu obok (przewijanym); pasek zostaje jednym wierszem.
    const open = await read($, isOpen)
    const toggle = async () => {
      if (open) {
        await update($, isOpen, () => false)
        await $.ui.close({ id: PANE }).catch(() => undefined)
        return
      }
      await update($, isOpen, () => true)
      const placed = await $.ui.open({ id: PANE, title: name })
      if (!placed.isPlaced) {
        await update($, isOpen, () => false)
        $.ui.toast('Za mało miejsca na panel: poszerz okno')
      }
    }
    const below = await next(e).catch(() => null)
    const f = factsOf(note)
    const facts: [string, string][] = [
      ['port', f.port],
      ['start', f.start],
      ['VPS', f.vps],
    ].filter((p): p is [string, string] => Boolean(p[1]))

    // Pasek: nazwa i kluczowe fakty (bez faktów: opis). Karta etykieta → wartość jest w panelu.
    const header = (
      <Box key="pamiec-row" flexDirection="row" gap={3} alignItems="center">
        {/* Nazwa i fakty nigdy się nie łamią ani nie kurczą; ustępuje tylko opis, obcinany z końca.
            Na desktopie przed nazwą ikonka mózgu (przy otwartym panelu z iskierką), w terminalu kropka. */}
        <Box flexShrink={0} flexDirection="row" alignItems="center" gap={1}>
          {e.surface === 'desktop' ? <Svg source={brainSvg(open)} alt="pamięć projektu" width={22} height={20} /> : null}
          <Text wrap="truncate-end">
            {open && e.surface !== 'desktop' ? <Text color="claude">● </Text> : null}
            <Text bold>{name}</Text>
          </Text>
        </Box>
        {facts.length
          ? facts.map(([k, v]) => (
              <Box key={`f-${k}`} flexShrink={0}>
                <Text wrap="truncate-end">
                  <Text dimColor>{k} </Text>
                  <Text mono>{v}</Text>
                </Text>
              </Box>
            ))
          : null}
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          {!facts.length ? (
            <Text dimColor wrap="truncate-end">
              {f.about}
            </Text>
          ) : null}
        </Box>
        {/* „ukryj” chowa pasek tego projektu do końca sesji (notatki nie rusza; /pamiec go przywraca).
            Na desktopie wychodzi dopiero po najechaniu, przed „więcej” (bez pozycji absolutnej). */}
        <Box flexShrink={0} gap={1} {...(e.surface === 'desktop' ? { display: 'none' as const, hover: { display: 'flex' as const } } : {})}>
          <Text dimColor>–</Text>
          <Button key="hide" label="ukryj" plain dimColor onPress={() => update($, dismissed, list => [...list, name])} />
        </Box>
        {/* Wspólna prawa kolumna pasków (RIGHT_COLS, dosunięta do prawej): ostatnie elementy wszystkich pasków
            kończą się w jednej linii. Znak przed przyciskiem, bo desktop nie barwi tekstu w przycisku. */}
        <Box width={RIGHT_COLS} flexShrink={0} justifyContent="flex-end" gap={1}>
          <Text dimColor>{open ? '▴' : '▾'}</Text>
          <Button key="more" label={open ? 'zwiń' : 'więcej'} plain dimColor onPress={() => void toggle()} />
        </Box>
      </Box>
    )

    // Pamięć projektu jest pierwsza na liście modów (najbardziej zewnętrzna), więc rysuje się nad wszystkimi.
    return (
      <Box flexDirection="column">
        {header}
        {below}
      </Box>
    )
  })

  // Panel z kartą notatki: etykieta → wartość, a pod nią cała notatka. Panel przewija się sam,
  // więc długa notatka nie rozpycha paska nad promptem.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const name = await read($, project)
    const note = name ? (await read($, index))[name] : undefined
    if (!name || !note) {
      return (
        <Box paddingX={1}>
          <Text dimColor>brak notatki</Text>
        </Box>
      )
    }
    const f = factsOf(note)
    const row = (label: string, value: unknown) => (
      <Box key={`r-${label}`} flexDirection="row" gap={2}>
        <Box width={8} flexShrink={0}>
          <Text dimColor>{label}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          {value}
        </Box>
      </Box>
    )
    return (
      <Box key="card" flexDirection="column" paddingX={1}>
        {row('opis', <Text>{f.about}</Text>)}
        {f.start ? row('uruchom', <Text mono>{f.start}</Text>) : null}
        {f.port ? row('port', <Text mono>{f.port}</Text>) : null}
        {f.vps ? row('VPS', <Text mono>{f.vps}</Text>) : null}
        <Box marginTop={1}>
          <Markdown key="note" text={note.body} />
        </Box>
      </Box>
    )
  })
}
