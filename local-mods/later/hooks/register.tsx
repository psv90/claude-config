import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

import type { Groups, Note } from '../types'

const KEY = 'groups'
const count = atom({ plugin: 'later', key: 'count' } as const, 0)
const first = atom({ plugin: 'later', key: 'first' } as const, '')
const mirror = atom({ plugin: 'later', key: 'groups' } as const, {} as Groups)
// The group the pane shows; '' is the current project.
const selected = atom({ plugin: 'later', key: 'selected' } as const, '')
// The note (by its `at`) whose Usuń waits for a second press.
const confirm = atom({ plugin: 'later', key: 'confirm' } as const, '')
// Whether a Wyślij wszystkie waits for its confirmation.
const confirmAll = atom({ plugin: 'later', key: 'confirmAll' } as const, false)
// Which clear waits for its in-place confirmation: '' none, 'group' the shown group, 'all' every group.
const confirmClear = atom({ plugin: 'later', key: 'confirmClear' } as const, '' as '' | 'group' | 'all')
// The group whose prompts are being sent one per turn; '' when none.
const draining = atom({ plugin: 'later', key: 'draining' } as const, '')
// Whether the pane shows the field for naming a new group.
const addingGroup = atom({ plugin: 'later', key: 'addingGroup' } as const, false)
const PREVIEW = 40
// Blok moda wyjasnij, gdy rysuje się sam (bez propozycji co-dalej), i jego wiersz z przyciskiem.
const EXPLAIN_BLOCK = 'wyjasnij-block'
const EXPLAIN_ROW = 'wyjasnij-row'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] } | string | null | undefined

// Ikonka ołówka (desktop) w stylu ikon innych modów: płaskie kształty, średnie tony czytelne na ciemnym
// i jasnym tle. Ukośny ołówek: różowa gumka, szara skuwka, żółty korpus, drewniany czubek z grafitem.
export function pencilSvg(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">` +
    `<g transform="rotate(45 10 10)">` +
    `<rect x="7.2" y="0.8" width="5.6" height="3.4" rx="1.4" fill="#E0899B"/>` +
    `<rect x="7.2" y="3.8" width="5.6" height="1.8" fill="#8F8D86"/>` +
    `<rect x="7.2" y="5.6" width="5.6" height="9" fill="#E3A33A"/>` +
    `<rect x="9.2" y="5.6" width="1.6" height="9" fill="#C98A1E"/>` +
    `<path d="M7.2 14.6h5.6L10 19.2z" fill="#F0D9B5"/>` +
    `<path d="M9.1 17.7h1.8L10 19.2z" fill="#2A2A28"/>` +
    `</g></svg>`
  )
}

const isBoxWith = (node: unknown, key: string) => {
  const n = node as Node
  return !!n && typeof n !== 'string' && n.type === 'Box' && n.props?.key === key
}

// Drzewo bez pierwszego Boksa o kluczu `key` i ten Boks (albo null).
export function takeBox<T>(tree: T, key: string): { rest: T; taken: unknown } {
  let taken: unknown = null
  const walk = (node: Node): Node => {
    if (Array.isArray(node)) return node.map(k => walk(k as Node)) as unknown as Node
    if (!node || typeof node === 'string' || !node.children || taken) return node
    const kids: unknown[] = []
    for (const kid of node.children) {
      if (!taken && isBoxWith(kid, key)) taken = kid
      else kids.push(walk(kid as Node))
    }
    return { ...node, children: kids }
  }
  const rest = walk(tree as Node) as T
  return { rest, taken }
}

// Pierwszy Boks o kluczu `key` w drzewie (albo null).
export function findBox(tree: unknown, key: string): unknown {
  if (isBoxWith(tree, key)) return tree
  const n = tree as Node
  if (!n || typeof n === 'string') return null
  for (const kid of Array.isArray(n) ? n : (n.children ?? [])) {
    const hit = findBox(kid, key)
    if (hit) return hit
  }
  return null
}
const PANE = 'later'

const HELP = [
  '/later <prompt>            zapisz prompt w tym projekcie',
  '/later @nazwa <prompt>     zapisz w innej grupie (czat, projekt)',
  '/later                     panel z przyciskami',
  '/later list                lista tego projektu',
  '/later all                 wszystkie grupy',
  '/later run <nr>            wyślij teraz i usuń z listy',
  '/later use <nr>            wstaw do pola promptu i usuń z listy',
  '/later rm <nr>             usuń',
  'Przed run/use/rm możesz dodać @nazwa, np. /later @blog run 2',
].join('\n')

const baseName = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd

async function loadGroups($: Engine): Promise<Groups> {
  return ((await $.store.get(KEY)) as Groups | undefined) ?? {}
}

async function projectGroup($: Engine) {
  return baseName(await $.session.cwd())
}

const plural = (n: number) => {
  if (n === 1) return 'prompt'
  const last = n % 10
  const lastTwo = n % 100
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'prompty' : 'promptów'
}

const age = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

const oneLine = (text: string, width: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > width ? `${flat.slice(0, width - 1)}…` : flat
}

const listGroup = (name: string, notes: Note[], now: number, width: number) => {
  const textWidth = Math.max(20, width - 12)
  const rows = notes.map(
    (note, i) =>
      `${String(i + 1).padStart(3)}  ${oneLine(note.text, textWidth)}  ${age(now - note.at)}`,
  )
  return [`@${name} · ${notes.length}`, ...rows].join('\n')
}

async function syncCount($: Engine, groups?: Groups) {
  const all = groups ?? (await loadGroups($))
  const notes = all[await projectGroup($)] ?? []
  const n = notes.length
  const head = notes[0] ? oneLine(notes[0].text, PREVIEW) : ''
  if ((await read($, first)) !== head) {
    await update($, first, () => head)
  }
  if ((await read($, count)) !== n) {
    await update($, count, () => n)
  }
  await update($, mirror, () => all)
}

async function save($: Engine, groups: Groups) {
  for (const name of Object.keys(groups)) {
    if (groups[name].length === 0) delete groups[name]
  }
  await $.store.set(KEY, groups)
  await syncCount($, groups)
}

async function take($: Engine, group: string, at: number) {
  const groups = await loadGroups($)
  const note = (groups[group] ?? []).find(one => one.at === at)
  if (!note) return undefined
  groups[group] = groups[group].filter(one => one !== note)
  await save($, groups)
  return note
}

async function addNote($: Engine, group: string, text: string) {
  const clean = text.trim()
  if (!clean) return
  const groups = await loadGroups($)
  const list = groups[group] ?? []
  let at = await $.clock.now()
  // `at` doubles as the note's id; keep it unique within the group.
  while (list.some(one => one.at === at)) at += 1
  const chat = await currentChat($)
  groups[group] = [...list, { text: clean, at, ...(chat ? { chat } : {}) }]
  await save($, groups)
}

// The desktop app's id for this chat; absent in a plain terminal session.
async function currentChat($: Engine) {
  const id = await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')
  return id && /^local_[A-Za-z0-9-]+$/.test(id) ? id : undefined
}

// Pads a row's last text to the pane's width with no-break spaces, so the
// pointer stays on the row (and its revealed actions) across the empty end.
const fill = (text: string, width: number) => text.padEnd(Math.max(text.length, width), ' ')

// What follows ↗: the target chat's title, cut to keep the prompt readable.
const chatLabel = (title: string | undefined) => (title ? ` ${oneLine(title, 28)}` : '')

// Chat titles as the desktop app keeps them, read once per chat per load.
const titles = new Map<string, string>()

async function chatTitle($: Engine, chat: string) {
  const known = titles.get(chat)
  if (known !== undefined) return known
  let title = ''
  try {
    const appData = await $.env.get('APPDATA')
    const account = await $.env.get('CLAUDE_CODE_ACCOUNT_UUID')
    const org = await $.env.get('CLAUDE_CODE_ORGANIZATION_UUID')
    if (appData && account && org) {
      const path = `${appData}\\Claude\\claude-code-sessions\\${account}\\${org}\\${chat}.json`
      const meta = JSON.parse(String(await $.fs.read(path))) as { title?: unknown }
      if (typeof meta.title === 'string') title = meta.title.trim()
    }
  } catch {
    // A chat deleted, a file over the read limit: no title, the link still works.
  }
  titles.set(chat, title)
  return title
}

// Brings the desktop app to the chat through its own deep link.
async function openChat($: Engine, chat: string) {
  const url = `claude://claude.ai/epitaxy/${chat}`
  const os = await $.env.get('OS')
  const argv =
    os === 'Windows_NT'
      ? ['explorer.exe', url]
      : (await $.env.get('XDG_CURRENT_DESKTOP')) !== undefined
        ? ['xdg-open', url]
        : ['open', url]
  try {
    await $.process.run(argv, { timeoutMs: 10000 })
  } catch {
    $.ui.toast('Nie udało się otworzyć czatu')
  }
}

async function saveDraft($: Engine) {
  const { text } = await $.prompt.read()
  if (!text.trim()) {
    $.ui.toast('Pole promptu jest puste')
    return
  }
  await addNote($, await projectGroup($), text)
  await $.prompt.fill({ text: '', mode: 'replace' })
}

async function openPane($: Engine) {
  await $.ui.open({ id: PANE, title: 'Na później' })
}

async function sendFirst($: Engine) {
  const groups = await loadGroups($)
  const group = await projectGroup($)
  const [first, ...rest] = groups[group] ?? []
  if (!first) return
  groups[group] = rest
  await save($, groups)
  await $.prompt.submit({ text: first.text, asUser: true })
}

// Sends the group's prompts one turn at a time: the first now, each next one
// when the previous turn answered. A prompt leaves the list only as it is sent,
// so an error (a usage limit) or an interruption leaves the rest saved.
async function startSendAll($: Engine, group: string) {
  await update($, confirmAll, () => false)
  await update($, draining, () => group)
  await sendNextQueued($)
}

async function sendNextQueued($: Engine, isTurnEnding = false) {
  const group = await read($, draining)
  if (!group) return
  const groups = await loadGroups($)
  const [next, ...rest] = groups[group] ?? []
  if (!next) {
    await update($, draining, () => '')
    return
  }
  groups[group] = rest
  await save($, groups)
  if (rest.length === 0) await update($, draining, () => '')
  if (isTurnEnding) {
    // The ending turn still holds the session; submit once it has let go.
    $.clock.after(0, () => void $.prompt.submit({ text: next.text, asUser: true }))
    return
  }
  await $.prompt.submit({ text: next.text, asUser: true })
}

async function stopSendAll($: Engine) {
  await update($, draining, () => '')
}

// Wyślij wszystkie, its in-place confirmation, or the running queue's Stop.
async function sendAllControls(
  $: Engine,
  e: Parameters<Engine['ui']['resolve']>[0],
  group: string,
  n: number,
) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const active = await read($, draining)
  if (active) {
    return (
      <Box gap={1}>
        <Text dimColor>wysyłam @{active} po kolei…</Text>
        <Button key="send-all-stop" plain label="stop" onPress={() => stopSendAll($)} />
      </Box>
    )
  }
  if (n < 2) return null
  if (await read($, confirmAll)) {
    return (
      <Box gap={1}>
        <Text color="warning">
          Wysłać {n} {plural(n)} po kolei?
        </Text>
        <Button key="send-all-yes" label="Wyślij" variant="primary" onPress={() => startSendAll($, group)} />
        <Button key="send-all-no" label="Anuluj" onPress={() => update($, confirmAll, () => false)} />
      </Box>
    )
  }
  return (
    <Box gap={1}>
      <Text dimColor>»</Text>
      <Button key="send-all" plain dimColor label={`wyślij wszystkie (${n})`} onPress={() => update($, confirmAll, () => true)} />
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'later',
      description: 'Notatnik promptów na później: panel z przyciskami',
      argumentHint: '[prompt | list | all | run|use|rm <nr> | @grupa ...]',
    })
    const result = await next(e)
    await syncCount($)
    // A queue from before a restart or reload does not resume by itself.
    await update($, draining, () => '')
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && (await read($, draining))) {
      if (e.reason === 'answer') {
        await sendNextQueued($, true)
      } else {
        // A limit, an error or Escape: stop, the unsent prompts stay listed.
        await stopSendAll($)
      }
    }
    return result
  })

  on('command.run', { command: 'later' }, async ($, e) => {
    const width = e.presentation?.columns ?? 80
    const now = await $.clock.now()
    const groups = await loadGroups($)

    let rest = e.args.trim()
    let group = await projectGroup($)
    const tag = rest.match(/^@(\S+)\s*/)
    if (tag) {
      group = tag[1]
      rest = rest.slice(tag[0].length)
    }

    if (rest === 'help' || rest === '?') {
      return { text: HELP }
    }

    if (rest === '' && !tag) {
      await openPane($)
      return { text: 'Panel „Na później” otwarty.' }
    }

    if (rest === 'list' || rest === '') {
      const notes = groups[group] ?? []
      if (notes.length === 0) {
        return { text: `@${group}: pusto. Dodaj: /later <prompt>` }
      }
      return { text: listGroup(group, notes, now, width) }
    }

    if (rest === 'all') {
      const names = Object.keys(groups)
      if (names.length === 0) {
        return { text: 'Brak zapisanych promptów. Dodaj: /later <prompt>' }
      }
      return {
        text: names.map(name => listGroup(name, groups[name], now, width)).join('\n\n'),
      }
    }

    const action = rest.match(/^(run|use|rm)\s+(\d+)\s*$/)
    if (action) {
      const [, verb, raw] = action
      const notes = groups[group] ?? []
      const index = Number(raw) - 1
      const note = notes[index]
      if (!note) {
        return { text: `@${group}: nie ma promptu nr ${raw} (jest ${notes.length}).` }
      }
      groups[group] = notes.filter((_, i) => i !== index)
      await save($, groups)

      if (verb === 'rm') {
        return { text: `Usunięto #${raw} z @${group}.` }
      }
      if (verb === 'use') {
        await $.prompt.fill({ text: note.text, mode: 'replace' })
        return { text: `#${raw} z @${group} jest w polu promptu.` }
      }
      // A command hook holds the turn; submit once it has let go.
      $.clock.after(0, () => void $.prompt.submit({ text: note.text, asUser: true }))
      return { text: `Wysyłam #${raw} z @${group}.` }
    }

    await addNote($, group, rest)
    const n = (await loadGroups($))[group]?.length ?? 0
    return { text: `Zapisano w @${group} jako #${n}. Razem: ${n} ${plural(n)}.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const n = await read($, count)
    const head = await read($, first)
    const { Box, Button, Text, Svg } = $.ui.resolve(e)
    const sendAll = await sendAllControls($, e, await projectGroup($), n)
    // Desktop: ikonka ołówka na początku wiersza, w stylu ikon innych modów.
    const pencil = e.surface === 'desktop' ? <Svg source={pencilSvg()} alt="na później" width={20} height={20} /> : null
    // Later jest wysoko na liście modów, więc dostaje pasek pozostałych i stawia siebie nad nim.
    // Samotny przycisk „wyjaśnij” (gdy nie ma propozycji co-dalej) wyjmuje z niego do swojego wiersza.
    const { rest, taken } = takeBox(await next(e).catch(() => null), EXPLAIN_BLOCK)
    const explain = findBox(taken, EXPLAIN_ROW)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2} alignItems="center">
          {explain}
          {n > 0 && (
            <Box flexShrink={1} gap={1}>
              <Text color="success">▸</Text>
              <Button key="send-next" plain label={head} onPress={() => sendFirst($)} />
            </Box>
          )}
          <Box flexGrow={1} />
          {sendAll}
          {/* Subtelne znaki przed przyciskami, wyciszone jak same przyciski (desktop nie barwi tekstu w przycisku). */}
          {/* Ołówek (desktop) stoi przy „zapisz na później” zamiast znaku „+”; terminal zostaje przy „+”. */}
          <Box gap={1} alignItems="center">
            {pencil ?? <Text dimColor>+</Text>}
            <Button key="save-draft" plain dimColor label="zapisz na później" onPress={() => saveDraft($)} />
          </Box>
          {/* Wspólna prawa kolumna pasków (16, dosunięta do prawej): „lista (N)” kończy się w jednej linii
              z ostatnimi elementami pozostałych pasków. Liczba w nawiasie, także (0). */}
          <Box width={16} flexShrink={0} justifyContent="flex-end" gap={1}>
            <Text dimColor>≡</Text>
            <Button key="open-list" plain dimColor label={`lista (${n})`} onPress={() => openPane($)} />
          </Box>
        </Box>
        {rest}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Select, Text } = $.ui.resolve(e)
    const project = await projectGroup($)
    const groups = await read($, mirror)
    const group = (await read($, selected)) || project
    const pending = await read($, confirm)
    const isAddingGroup = await read($, addingGroup)
    const clearing = await read($, confirmClear)
    const total = Object.values(groups).reduce((sum, list) => sum + list.length, 0)
    const notes = groups[group] ?? []
    const now = await $.clock.now()
    const width = Math.max(16, (e.props.bodyColumns ?? 60) - 8)
    const names = [...new Set([project, group, ...Object.keys(groups)])]
    // Desktop reveals a row's actions under the pointer; the terminal has no pointer.
    const canHover = e.surface === 'desktop'
    const here = await currentChat($)
    const elsewhere = [...new Set(notes.map(note => note.chat).filter(chat => chat && chat !== here))] as string[]
    const titleOf = new Map(await Promise.all(elsewhere.map(async chat => [chat, await chatTitle($, chat)] as const)))
    const sendAll = await sendAllControls($, e, group, notes.length)

    const actions = (note: Note, i: number) => {
      const id = String(note.at)
      const isConfirming = pending === id
      const place = !canHover
        ? { paddingLeft: 9 }
        : isConfirming
          ? { position: 'absolute' as const, right: 0, top: 0 }
          : {
              position: 'absolute' as const,
              right: 0,
              top: 0,
              display: 'none' as const,
              hover: { scope: `row-${id}`, display: 'flex' as const },
            }

      if (isConfirming) {
        return (
          <Box key={`acts-${id}`} gap={1} {...place}>
            <Text mono color="warning">
              Usunąć #{i + 1}?
            </Text>
            <Button
              key={`rmyes-${id}`}
              label="Usuń"
              variant="primary"
              onPress={async () => {
                await update($, confirm, () => '')
                await take($, group, note.at)
              }}
            />
            <Button key={`rmno-${id}`} label="Anuluj" onPress={() => update($, confirm, () => '')} />
          </Box>
        )
      }

      return (
        <Box key={`acts-${id}`} gap={1} {...place}>
          <Button
            key={`send-${id}`}
            label="Wyślij"
            variant="primary"
            onPress={async () => {
              const taken = await take($, group, note.at)
              if (taken) await $.prompt.submit({ text: taken.text, asUser: true })
            }}
          />
          <Button
            key={`edit-${id}`}
            label="Edytuj"
            onPress={async () => {
              const taken = await take($, group, note.at)
              if (taken) await $.prompt.fill({ text: taken.text, mode: 'replace' })
            }}
          />
          <Button key={`rm-${id}`} label="Usuń" dimColor onPress={() => update($, confirm, () => id)} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box gap={2} alignItems="center">
          <Select
            key="group"
            value={group}
            options={names.map(name => ({ value: name, label: `@${name}` }))}
            onSelect={value => update($, selected, () => (value === project ? '' : value))}
          />
          <Text mono dimColor tabular>
            {notes.length} w kolejce
          </Text>
          <Box flexGrow={1} />
          {/* „wyczyść grupę” usuwa prompty z pokazanej grupy, „usuń wszystkie” ze wszystkich grup;
              potwierdzenie pojawia się w miejscu obu przycisków. */}
          {clearing ? (
            <Box key="clear-confirm" gap={1}>
              <Text mono color="warning">
                {clearing === 'group' ? `Usunąć ${notes.length} z @${group}?` : `Usunąć wszystkie ${total} ze wszystkich grup?`}
              </Text>
              <Button
                key="clear-yes"
                label="Usuń"
                variant="primary"
                onPress={async () => {
                  await update($, confirmClear, () => '')
                  if (clearing === 'group') {
                    const all = await loadGroups($)
                    delete all[group]
                    await save($, all)
                  } else {
                    await update($, selected, () => '')
                    await save($, {})
                  }
                }}
              />
              <Button key="clear-no" label="Anuluj" onPress={() => update($, confirmClear, () => '')} />
            </Box>
          ) : (
            <Box gap={2}>
              {notes.length > 0 && (
                <Button
                  key="clear-group"
                  plain
                  dimColor
                  label={`wyczyść @${group}`}
                  onPress={() => update($, confirmClear, () => 'group' as const)}
                />
              )}
              {total > 0 && (
                <Button key="clear" plain dimColor label="usuń wszystkie" onPress={() => update($, confirmClear, () => 'all' as const)} />
              )}
            </Box>
          )}
          <Button
            key="add-group"
            label={isAddingGroup ? 'Anuluj' : '+ grupa'}
            plain
            dimColor
            onPress={() => update($, addingGroup, value => !value)}
          />
        </Box>

        {sendAll}

        {isAddingGroup && (
          <Input
            key="new-group"
            label="@"
            placeholder="nazwa nowej grupy, np. blog"
            submitLabel="utwórz"
            autoFocus
            onSubmit={async value => {
              const name = value.trim().replace(/^@/, '')
              if (!name) return
              await update($, selected, () => (name === project ? '' : name))
              await update($, addingGroup, () => false)
            }}
          />
        )}

        <Box flexDirection="column">
          {notes.length === 0 && (
            <Text mono dimColor>
              · pusto
            </Text>
          )}
          {notes.map((note, i) => {
            const id = String(note.at)
            const isNext = i === 0
            return (
              <Box key={`row-${id}`} flexDirection="column" position="relative" hover={{ scope: `row-${id}` }}>
                <Box gap={2}>
                  <Text mono color={isNext ? 'success' : 'inactive'}>
                    {isNext ? '▸' : '·'}
                  </Text>
                  <Text mono dimColor tabular>
                    {age(now - note.at).padStart(3)}
                  </Text>
                  {note.chat && note.chat !== here ? (
                    <Button
                      key={`open-${id}`}
                      plain
                      // The row's hover group: the pointer on this link keeps its actions shown.
                      hover={{ scope: `row-${id}` }}
                      onPress={() => openChat($, note.chat as string)}
                    >
                      <Text mono wrap="truncate-end" dimColor={!isNext} hover={{ scope: `row-${id}`, dimColor: false }}>
                        {oneLine(note.text, width - 3 - chatLabel(titleOf.get(note.chat)).length)}
                      </Text>
                      <Text mono color="success">
                        {'  '}↗
                      </Text>
                      <Text mono dimColor hover={{ scope: `row-${id}`, dimColor: false }}>
                        {fill(
                          chatLabel(titleOf.get(note.chat)),
                          width - 3 - oneLine(note.text, width - 3 - chatLabel(titleOf.get(note.chat)).length).length,
                        )}
                      </Text>
                    </Button>
                  ) : (
                    <Text mono wrap="truncate-end" dimColor={!isNext} hover={{ scope: `row-${id}`, dimColor: false }}>
                      {fill(oneLine(note.text, width), width)}
                    </Text>
                  )}
                </Box>
                {actions(note, i)}
              </Box>
            )
          })}
        </Box>

        <Input
          key="new-note"
          label="›"
          placeholder={`nowy prompt do @${group}`}
          submitLabel="zapisz"
          autoFocus
          onSubmit={value => addNote($, group, value)}
        />
      </Box>
    )
  })
}
