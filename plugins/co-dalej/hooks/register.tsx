// co-dalej: po zakończonym zadaniu Claude kończy odpowiedź trzema pytaniami
// z propozycjami usprawnień. Mod wyciąga je z odpowiedzi i pokazuje nad
// promptem jako przyciski 1-3: wciśnięty wysyła pytanie jako prompt.
// - Propozycja pominięta 2 razy (podobna treść, nie ta sama co do słowa) znika
//   z przycisków, a model dostaje ją na liście „nie proponuj”. Wybór propozycji
//   (przyciskiem albo podobnym własnym promptem) zeruje jej licznik.
// - Blokady są osobne dla każdego projektu (folderu sesji).
// - Pominięcia wygasają po 30 dniach, żeby dobry pomysł mógł kiedyś wrócić.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Fate, Ignored, Round } from '../types'

const questions = atom({ plugin: 'co-dalej', key: 'questions' } as const, [])
// Zablokowane propozycje do panelu i potwierdzenie „Odblokuj wszystkie” w miejscu przycisku.
const blocked = atom({ plugin: 'co-dalej', key: 'blocked' } as const, [])
const isConfirmingAll = atom({ plugin: 'co-dalej', key: 'isConfirmingAll' } as const, false)
// Przycisk „inne”: szybki model szuka trzech nowych propozycji.
const isRefreshing = atom({ plugin: 'co-dalej', key: 'isRefreshing' } as const, false)
const picked = atom({ plugin: 'co-dalej', key: 'picked' } as const, [])
const history = atom({ plugin: 'co-dalej', key: 'history' } as const, [] as Round[])
const view = atom({ plugin: 'co-dalej', key: 'view' } as const, 'historia' as 'historia' | 'zablokowane')

// Historia propozycji: każda pokazana trójka z datą, projektem i losem każdej propozycji.
const HISTORY_KEY = 'history'
const HISTORY_MAX = 300

async function historyList($: EngineInterface): Promise<Round[]> {
  const v = await $.store.get(HISTORY_KEY)
  return Array.isArray(v) ? (v as Round[]) : []
}

async function saveHistory($: EngineInterface, list: Round[]) {
  const kept = list.slice(-HISTORY_MAX)
  await $.store.set(HISTORY_KEY, kept)
  await update($, history, () => kept)
}

// Nowa runda: nowo pokazane propozycje (po turze albo po „inne”).
async function startRound($: EngineInterface, qs: string[]) {
  if (qs.length === 0) return
  const at = await $.clock.now()
  await saveHistory($, [...(await historyList($)), { at, project: projectName(project), items: qs.map(text => ({ text })) }])
}

// Propozycje dobrane w tle dochodzą do ostatniej rundy.
async function extendRound($: EngineInterface, qs: string[]) {
  const list = await historyList($)
  const last = list[list.length - 1]
  if (!last || qs.length === 0) return
  await saveHistory($, [...list.slice(0, -1), { ...last, items: [...last.items, ...qs.map(text => ({ text }))] }])
}

// Los propozycji z ostatniej rundy, które jeszcze go nie mają (`fateOf` zwraca undefined: bez zmian).
export function settle(list: Round[], fateOf: (q: string) => Fate | undefined): Round[] {
  const last = list[list.length - 1]
  if (!last) return list
  const items = last.items.map(i => (i.fate ? i : { ...i, fate: fateOf(i.text) }))
  return [...list.slice(0, -1), { ...last, items }]
}

async function settleRound($: EngineInterface, fateOf: (q: string) => Fate | undefined) {
  await saveHistory($, settle(await historyList($), fateOf))
}

// Prompt wysłany przyciskiem moda: jego rozliczenie (wybrane / pominięte) już zrobione,
// więc prompt.submit - jeśli w ogóle go dostanie - nie liczy drugi raz.
let isSettled = false

// Prompt z kilku zaznaczonych propozycji; jedna idzie tak, jak jest. Tekst wpisany w polu
// promptu idzie na początku, a propozycje po nim jako dodatek.
export function pickedPrompt(list: string[], draft = ''): string {
  const own = draft.trim()
  if (!own) {
    if (list.length === 1) return list[0]!
    return `Wprowadź te zmiany:\n${list.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
  }
  if (list.length === 1) return `${own}\n\nDodatkowo: ${list[0]}`
  return `${own}\n\nDodatkowo wprowadź te zmiany:\n${list.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
}

// Wysyła wybrane propozycje (jedną kliknięciem w tekst albo kilka zaznaczonych): wybrane
// znikają z listy pominięć, niewybrane dostają +1, przyciski się czyszczą.
async function sendPicked($: EngineInterface, chosen: string[]) {
  if (chosen.length === 0) return
  await ensureProject($)
  const shown = await read($, questions)
  const now = await $.clock.now()
  const list = (await ignoredList($)).filter(i => !(inProject(i, project) && chosen.some(q => isSimilar(i.text, q))))
  await saveIgnored($, nextIgnored(list, shown.filter(q => !chosen.includes(q)), '', now, project))
  await settleRound($, q => (chosen.includes(q) ? 'wybrana' : shown.includes(q) ? 'pominieta' : undefined))
  generation++
  await update($, questions, () => [])
  await update($, picked, () => [])
  // Tekst już wpisany w polu promptu jedzie razem z propozycjami, a pole się czyści.
  const draft = await $.prompt
    .read()
    .then(r => r.text)
    .catch(() => '')
  if (draft.trim()) await $.prompt.fill({ text: '', mode: 'replace' }).catch(() => undefined)
  isSettled = true
  await $.prompt.submit({ text: pickedPrompt(chosen, draft), asUser: true })
}

const HEADING = 'Co dalej?'
// Wiersz „inne / zablokowane”: inne mody (wyjasnij) dokładają tu swoje przyciski zamiast własnego wiersza.
const TOOLS_ROW = 'co-dalej-tools'
// Cały blok propozycji: later stawia go na górze obok swojej kolejki.
const BLOCK = 'co-dalej-block'

// „1 zablokowana”, „3 zablokowane”, „35 zablokowanych” (propozycja: rodzaj żeński).
export function blockedLabel(n: number): string {
  const last = n % 10
  const lastTwo = n % 100
  if (n === 1) return '1 zablokowana'
  return `${n} ${last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'zablokowane' : 'zablokowanych'}`
}
const PANE = 'co-dalej-zablokowane'
const IGNORED_KEY = 'ignored'
const MAX_MISSES = 2
const FORGET_AFTER = 30 * 24 * 60 * 60 * 1000

const RULE = `Gdy kończysz zadanie, które zmieniło pliki, uruchomiło coś albo zbudowało coś dla użytkownika, zakończ odpowiedź sekcją:

**${HEADING}**
1. <pytanie>
2. <pytanie>
3. <pytanie>

To obowiązkowe zakończenie każdej takiej odpowiedzi, także krótkiej i także wtedy, gdy styl odpowiedzi każe kończyć zwięźle. Mod interfejsu wycina tę sekcję z zapisanej wiadomości i pokazuje ją jako przyciski, dlatego we wcześniejszych wiadomościach w historii rozmowy jej nie widać - to nie znaczy, że jej tam nie było; dodawaj ją za każdym razem, nie wzoruj się na historii. Zawsze dokładnie trzy pozycje, nigdy mniej. Każde pytanie to jedna konkretna propozycja usprawnienia tego, co właśnie powstało, zadana tak, by wystarczyło odpowiedzieć „tak” (np. „Dodać eksport do CSV w widoku historii?”). Jedno zdanie, najwyżej 90 znaków, po polsku, bez ikonek i emoji, bez powtarzania tego, co już zrobione. Pomiń tę sekcję przy zwykłych pytaniach, wyjaśnieniach i gdy zadanie nie jest skończone. Nie proponuj ponownie tego, co już padło w tej rozmowie w sekcji „${HEADING}”, a użytkownik tego nie wybrał.`

// Reguła z listą propozycji zablokowanych w tym projekcie.
export function ruleWith(blocked: string[]): string {
  if (blocked.length === 0) return RULE
  return `${RULE}\n\nUżytkownik kilka razy pominął te propozycje, więc nie proponuj ich ani niczego bardzo podobnego:\n${blocked.map(b => `- ${b}`).join('\n')}`
}

// Słowa zbyt ogólne, żeby świadczyły o tej samej propozycji („Dodać…”, „Pokazywać…”).
const GENERIC = new Set([
  'dodac', 'pokaz', 'zmien', 'ustaw', 'zrobi', 'przyc', 'moze', 'ktory', 'ktora', 'ktore', 'kiedy', 'gdzie', 'jesli',
  'zamia', 'tylko', 'takze', 'wszys', 'kazdy', 'kazde', 'kazda',
  'dla', 'nie', 'czy', 'jak', 'sie', 'juz', 'tak', 'pod', 'nad', 'tez', 'przy', 'oraz', 'albo', 'jako', 'przez', 'bez', 'ich',
])

// Słowa znaczące: bez wielkich liter, polskich znaków i końcówek (pierwsze 5 liter).
function stems(text: string): Set<string> {
  const plain = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l')
  return new Set(
    plain
      .split(/[^a-z0-9]+/)
      .filter(w => w.length >= 3)
      .map(w => w.slice(0, 5))
      .filter(s => !GENERIC.has(s)),
  )
}

// Ta sama propozycja inaczej sformułowana: co najmniej połowa słów znaczących
// dłuższej z nich wspólna (i nie mniej niż dwa), żeby dwie różne propozycje
// o podobnym słownictwie, np. obie „w panelu”, nie zlewały się w jedną.
export function isSimilar(a: string, b: string): boolean {
  const sa = stems(a)
  const sb = stems(b)
  if (sa.size === 0 || sb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase()
  let common = 0
  for (const s of sa) if (sb.has(s)) common++
  return common >= Math.min(2, sa.size, sb.size) && common / Math.max(sa.size, sb.size) >= 0.5
}

// Klucz projektu: pełna ścieżka folderu sesji, bez różnic w ukośnikach i wielkości liter.
export function projectKey(cwd: string): string {
  return cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function projectName(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd
}

// Wpis należy do projektu. Wpisy sprzed podziału (bez projektu) nie należą do żadnego.
const inProject = (i: Ignored, project: string) => i.project === project

// Licznik po kolejnym prompcie: wybrana propozycja wypada, pominięte dostają +1.
// Wpisy innych projektów zostają nietknięte (poza wygasaniem).
export function nextIgnored(list: Ignored[], shown: string[], prompt: string, now: number, project: string): Ignored[] {
  const fresh = list.filter(i => now - i.lastAt < FORGET_AFTER)
  const picked = shown.filter(q => isSimilar(q, prompt))
  let out = fresh.filter(
    i => !inProject(i, project) || (!picked.some(q => isSimilar(q, i.text)) && !isSimilar(i.text, prompt)),
  )
  for (const q of shown) {
    if (picked.includes(q)) continue
    const at = out.findIndex(i => inProject(i, project) && isSimilar(i.text, q))
    out =
      at >= 0
        ? out.map((i, n) => (n === at ? { text: q, misses: i.misses + 1, lastAt: now, project } : i))
        : [...out, { text: q, misses: 1, lastAt: now, project }]
  }
  return out.slice(-200)
}

// Przycisk „×”: propozycja od razu dostaje pełną liczbę pominięć.
export function blockNow(list: Ignored[], q: string, now: number, project: string): Ignored[] {
  const rest = list.filter(i => !(inProject(i, project) && isSimilar(i.text, q)))
  return [...rest, { text: q, misses: MAX_MISSES, lastAt: now, project }].slice(-200)
}

export function isBlocked(list: Ignored[], q: string, project: string): boolean {
  return list.some(i => inProject(i, project) && i.misses >= MAX_MISSES && isSimilar(i.text, q))
}

// Odblokowanie zeruje propozycję całkiem: znów może wrócić i znów zbierać pominięcia.
export function unblock(list: Ignored[], text: string, project: string): Ignored[] {
  return list.filter(i => !(inProject(i, project) && i.text === text))
}

export function unblockAll(list: Ignored[], project: string): Ignored[] {
  return list.filter(i => !(inProject(i, project) && i.misses >= MAX_MISSES))
}

export function blockedOf(list: Ignored[], project: string): Ignored[] {
  return list.filter(i => inProject(i, project) && i.misses >= MAX_MISSES).sort((a, b) => b.lastAt - a.lastAt)
}

async function ignoredList($: EngineInterface): Promise<Ignored[]> {
  const v = await $.store.get(IGNORED_KEY)
  return Array.isArray(v) ? (v as Ignored[]) : []
}

async function currentProject($: EngineInterface): Promise<string> {
  return projectKey(await $.session.cwd())
}

// Zapis listy pominięć i odświeżenie panelu jednym ruchem.
async function saveIgnored($: EngineInterface, list: Ignored[]) {
  await $.store.set(IGNORED_KEY, list)
  await update($, blocked, () => blockedOf(list, project))
}

// Prośba do szybkiego modelu o brakujące propozycje, gdy po odfiltrowaniu
// zablokowanych (albo gdy model dał mniej) zostało mniej niż trzy.
export function refillPrompt(answer: string, have: string[], avoid: string[], count: number): string {
  return [
    `Poniżej koniec odpowiedzi asystenta po zakończonym zadaniu. Zaproponuj ${count} nowe, konkretne usprawnienia tego, co powstało.`,
    'Każda propozycja to jedno pytanie po polsku, na które wystarczy odpowiedzieć „tak”, najwyżej 90 znaków, bez długich myślników, bez ikonek i emoji.',
    have.length ? `Nie powtarzaj tych (już pokazane):\n${have.map(q => `- ${q}`).join('\n')}` : '',
    avoid.length ? `Nie proponuj tych ani niczego bardzo podobnego (użytkownik je odrzucił):\n${avoid.map(q => `- ${q}`).join('\n')}` : '',
    `Odpowiedz wyłącznie listą numerowaną od 1 do ${count}, bez wstępu.`,
    `Odpowiedź asystenta:\n"""\n${answer.slice(-4000)}\n"""`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

// Numerowane linie odpowiedzi modelu dobierającego propozycje.
export function parseList(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.match(/^\s*\d+[.)]\s+(.+?)\s*$/)?.[1])
    .filter((q): q is string => q !== undefined)
    .map(clean)
    .filter(Boolean)
}

// Numer tury z propozycjami: spóźnione dobranie po nowym prompcie jest odrzucane.
let generation = 0
// Projekt tej sesji, ustalany przy pierwszym użyciu.
let project = ''

async function refill($: EngineInterface, answer: string, have: string[], ignored: Ignored[], round: number) {
  const missing = 3 - have.length
  const avoid = blockedOf(ignored, project).map(i => i.text).slice(0, 20)
  try {
    const r = await $.model.complete({ model: 'haiku', prompt: refillPrompt(answer, have, avoid, missing + 2) })
    if (!r.isAnswered || round !== generation) return
    const extra: string[] = []
    for (const q of parseList(r.text)) {
      if (extra.length >= missing) break
      if (q.length > 120 || isBlocked(ignored, q, project)) continue
      if ([...have, ...extra].some(x => isSimilar(x, q))) continue
      extra.push(q)
    }
    if (extra.length && round === generation) {
      await update($, questions, l => [...l, ...extra].slice(0, 3))
      await extendRound($, extra)
    }
  } catch {
    // Bez dobrania zostają te, które są.
  }
}

// Ostatnia odpowiedź z propozycjami: kontekst dla „inne”.
let lastAnswer = ''

// „inne”: pokazane liczą się jako pominięte, a szybki model daje trzy nowe,
// różne od pokazanych i zablokowanych. Stare zostają, gdy nic nowego nie przyszło.
async function another($: EngineInterface) {
  if (await read($, isRefreshing)) return
  await ensureProject($)
  const shown = await read($, questions)
  const now = await $.clock.now()
  const ignored = nextIgnored(await ignoredList($), shown, '', now, project)
  await saveIgnored($, ignored)
  const round = ++generation
  await update($, isRefreshing, () => true)
  try {
    const avoid = blockedOf(ignored, project).map(i => i.text).slice(0, 20)
    const r = await $.model.complete({ model: 'haiku', prompt: refillPrompt(lastAnswer, shown, avoid, 5) })
    if (!r.isAnswered || round !== generation) return
    const fresh: string[] = []
    for (const q of parseList(r.text)) {
      if (fresh.length >= 3) break
      if (q.length > 120 || isBlocked(ignored, q, project)) continue
      if ([...shown, ...fresh].some(x => isSimilar(x, q))) continue
      fresh.push(q)
    }
    if (fresh.length) {
      await settleRound($, q => (shown.includes(q) ? 'pominieta' : undefined))
      await update($, questions, () => fresh)
      await startRound($, fresh)
    }
  } catch {
    // Bez nowych zostają stare.
  } finally {
    await update($, isRefreshing, () => false)
  }
}

// „+ później”: propozycja trafia do kolejki moda later (jego komendą /later <tekst>) i znika z przycisków,
// bez liczenia jej jako pominiętej.
async function saveForLater($: EngineInterface, q: string) {
  try {
    await $.command.run({ command: 'later', args: q })
    await update($, questions, l => l.filter(x => x !== q))
    await settleRound($, x => (x === q ? 'pozniej' : undefined))
  } catch {
    $.ui.toast('Nie udało się zapisać na później (mod later wyłączony?)')
  }
}

async function ensureProject($: EngineInterface) {
  if (!project) project = await currentProject($)
}

async function openPane($: EngineInterface, shown: 'historia' | 'zablokowane' = 'historia') {
  await ensureProject($)
  const list = await ignoredList($)
  await update($, blocked, () => blockedOf(list, project))
  const rounds = await historyList($)
  await update($, history, () => rounds)
  await update($, isConfirmingAll, () => false)
  await update($, view, () => shown)
  await $.ui.open({ id: PANE, title: `Co dalej · ${projectName(project)}` })
}

function when(at: number) {
  return new Date(at).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })
}

function whenTime(at: number) {
  return new Date(at).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// Znak i kolor losu propozycji w historii.
export const FATES: Record<Fate | 'brak', { mark: string; color?: string; label: string }> = {
  wybrana: { mark: '✓', color: 'success', label: 'wybrana' },
  pominieta: { mark: '·', label: 'pominięta' },
  zablokowana: { mark: '⊘', color: 'warning', label: 'zablokowana' },
  pozniej: { mark: '↗', color: 'suggestion', label: 'na później' },
  brak: { mark: '○', label: 'bez decyzji' },
}

// Drogowskaz z pytajnikami (desktop). Statyczny obraz rysowany klatkami (2 na sekundę), jak roboty
// w agentach i progres-barze: przerysowanie paska nie zrywa animacji. Strzałka na propozycję:
// pomarańczowa z białym pytajnikiem, zaznaczona zielona z ptaszkiem, pozostałe wtedy przygasają.
export const SIGN_W = 36
export const SIGN_H = 62
// Rozmiar w pasku (CSS px): mniej więcej wysokość czterech wierszy propozycji.
const SIGN_PX_W = 44
const SIGN_PX_H = 75
const SIGN = { orange: '#D97757', green: '#4EBA65', post: '#6B6A65' }
const WAVE = [-1, 0, 1, 0]

export function signSvg(count: number, picked: number[], frame: number): string {
  const sway = WAVE[frame % 4]! * 2
  const any = picked.length > 0
  const arrows = Array.from({ length: Math.min(3, Math.max(1, count)) }, (_, i) => {
    const y = 5 + i * 15
    const isPicked = picked.includes(i)
    const dx = isPicked || !any ? (WAVE[(frame + i) % 4]! + 1) * 1.2 : 0
    const tilt = WAVE[(frame + i) % 4]! * 10
    const fill = isPicked ? SIGN.green : SIGN.orange
    const mark = isPicked
      ? `<text x="32" y="${y + 7.6}" font-family="system-ui,sans-serif" font-size="8.5" font-weight="700" text-anchor="middle" fill="#173404">✓</text>`
      : `<text x="32" y="${y + 7.6}" font-family="Georgia,serif" font-size="8.5" font-weight="700" text-anchor="middle" fill="#FFFFFF" transform="rotate(${tilt} 32 ${y + 6})">?</text>`
    return (
      `<g transform="translate(${dx.toFixed(1)} 0)"${any && !isPicked ? ' opacity=".55"' : ''}>` +
      `<path d="M23 ${y}h17l4.5 4.5L40 ${y + 9}H23z" fill="${fill}"/>${mark}</g>`
    )
  }).join('')
  // Sam słup ze strzałkami; viewBox zaczyna się od x=14, żeby z lewej nie zostawało puste miejsce.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIGN_W}" height="${SIGN_H}" viewBox="14 0 ${SIGN_W} ${SIGN_H}">` +
    `<g transform="rotate(${sway} 22 62)"><rect x="20" y="3" width="2.5" height="57" rx="1" fill="${SIGN.post}"/>${arrows}</g>` +
    `<ellipse cx="21.5" cy="60.5" rx="7" ry="1.3" fill="#3A3A37"/></svg>`
  )
}

// Pytanie na przycisk: bez gwiazdek markdownu i bez ikonek/emoji.
export function clean(q: string): string {
  return q
    .replace(/\*\*/g, '')
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍⃣]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// Ostatnia linia, która jest samym nagłówkiem „Co dalej?” (z ** albo ##), a nie
// zdaniem, w którym te słowa padają; -1, gdy jej nie ma.
function headingLine(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.replace(/[*#_\s:]/g, '') === HEADING.replace(/\s/g, '')) return i
  }
  return -1
}

// Trzy pozycje listy numerowanej tuż pod nagłówkiem „Co dalej?”.
export function parseQuestions(answer: string): string[] {
  const lines = answer.split('\n')
  const at = headingLine(lines)
  if (at < 0) return []
  const out: string[] = []
  for (const line of lines.slice(at + 1)) {
    if (!line.trim()) continue
    const q = line.match(/^\s*([1-3])[.)]\s+(.+?)\s*$/)?.[2]
    if (q === undefined) break
    out.push(q)
  }
  return out.map(clean).filter(Boolean).slice(0, 3)
}

// Odpowiedź bez sekcji „Co dalej?”: od linii z nagłówkiem po ostatnią pozycję
// listy (z pustymi liniami wokół). Tekst po liście zostaje.
export function stripQuestions(text: string): string {
  const lines = text.split('\n')
  let start = headingLine(lines)
  if (start < 0) return text
  let end = start + 1
  while (end < lines.length && (!lines[end]!.trim() || /^\s*\d[.)]\s/.test(lines[end]!))) end++
  // Nie zostawiać pustych linii ani poziomej kreski tuż nad wyciętą sekcją.
  while (start > 0 && /^\s*(-{3,}|\*{3,})?\s*$/.test(lines[start - 1]!)) start--
  const before = lines.slice(0, start).join('\n').trimEnd()
  const after = lines.slice(end).join('\n').trim()
  return after ? `${before}\n\n${after}` : before
}

export const register: Register = on => {
  // Pytania wycięte z odpowiedzi w tej turze (wiadomość ich już nie ma).
  let cut: string[] = []
  // Lista „nie proponuj” jest ustalana raz na sesję: zmiana system promptu
  // w trakcie rozmowy unieważniłaby cache całej rozmowy. W tej sesji model
  // pilnuje się sam (reguła), a mod i tak ukrywa zablokowane przyciski.
  let rule: string | undefined

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    project = projectKey(e.cwd)
    await $.command.register({
      name: 'co-dalej',
      description: 'Historia propozycji „Co dalej?” (albo „zablokowane”: lista zablokowanych w tym projekcie)',
    })
    const list = await ignoredList($)
    await update($, blocked, () => blockedOf(list, project))
    // Klatki drogowskazu: dwa razy na sekundę, tylko gdy propozycje są na ekranie.
    $.clock.every(500, () => {
      void (async () => {
        if ((await read($, questions)).length) $.ui.invalidate('ui.render')
      })()
    })
    return result
  })

  on('command.run', { command: 'co-dalej' }, async ($, e) => {
    const isBlockedView = /^zablok/i.test(e.args.trim())
    await openPane($, isBlockedView ? 'zablokowane' : 'historia')
    return { text: isBlockedView ? 'Otworzyłem listę zablokowanych propozycji.' : 'Otworzyłem historię propozycji.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    if (rule === undefined) {
      await ensureProject($)
      const texts = blockedOf(await ignoredList($), project).map(i => i.text)
      rule = ruleWith(texts.slice(0, 20))
    }
    return { sections: [...sections, { id: 'co-dalej:pytania', text: rule, scope: 'session' as const }] }
  })

  on('prompt.submit', async ($, e, next) => {
    // Liczą się tylko prompty użytkownika: nie wstawki w trakcie tury
    // i nie prompty innych modów (np. podtrzymanie cache'u).
    const origin = e.origin as { kind?: string; asUser?: boolean } | undefined
    const isFromPerson = !e.turnId && (origin?.kind !== 'plugin' || origin.asUser === true)
    if (isSettled) {
      isSettled = false
      return next(e)
    }
    const shown = await read($, questions)
    if (shown.length && isFromPerson) {
      await ensureProject($)
      const now = await $.clock.now()
      await saveIgnored($, nextIgnored(await ignoredList($), shown, e.text, now, project))
      // Własny prompt podobny do propozycji liczy się jako jej wybór (jak w liście pominięć).
      await settleRound($, q => (!shown.includes(q) ? undefined : isSimilar(q, e.text) ? 'wybrana' : 'pominieta'))
    }
    generation++
    cut = []
    await update($, questions, () => [])
    await update($, picked, () => [])
    return next(e)
  })

  // Sekcja „Co dalej?” trafia tylko na przyciski nad promptem, nie do wiadomości.
  on('session.append', async ($, e, next) => {
    if (e.agentId || e.door !== 'response' || e.message.role !== 'assistant') return next(e)
    let found: string[] = []
    const content = e.message.content.map(block => {
      if (block.type !== 'text') return block
      const qs = parseQuestions(block.text)
      if (qs.length === 0) return block
      found = qs
      return { ...block, text: stripQuestions(block.text) }
    })
    if (found.length === 0) return next(e)
    cut = found
    return next({ ...e, message: { ...e.message, content } })
  })

  on('turn.complete', async ($, e, next) => {
    // Gdy własny prompt moda nie przeszedł przez prompt.submit, flaga nie może zjeść następnego promptu.
    if (!e.agentId) isSettled = false
    if (!e.agentId && !e.isAborted) {
      await ensureProject($)
      const round = ++generation
      const ignored = await ignoredList($)
      // Wycięte z zapisanej wiadomości mają pierwszeństwo: `e.answer` może już nie mieć sekcji.
      const parsed = cut.length ? cut : parseQuestions(e.answer)
      cut = []
      if (parsed.length) lastAnswer = e.answer
      const found = parsed.filter(q => !isBlocked(ignored, q, project))
      await update($, questions, () => found)
      await startRound($, found)
      // Zawsze trzy: brakujące dobiera w tle szybki model, nie opóźniając tury.
      if (parsed.length > 0 && found.length < 3) void refill($, e.answer, found, ignored, round)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, questions)
    if (e.props.hasSurvey || e.props.isWorking || list.length === 0) return next(e)

    const { Box, Button, Text, Svg } = $.ui.resolve(e)
    const below = await next(e).catch(() => null)
    const count = (await read($, blocked)).length
    const refreshing = await read($, isRefreshing)
    // Zaznaczone tylko spośród tych, które są na ekranie (np. po „inne” stare wypadają).
    const chosen = (await read($, picked)).filter(q => list.includes(q))
    // Na desktopie × wychodzi nad wierszem dopiero po najechaniu; terminal nie ma kursora, więc tam jest stale, wyciszony.
    const canHover = e.surface === 'desktop'
    return (
      <Box flexDirection="column">
        {below}
        {/* Blok BLOCK z propozycjami; na desktopie z lewej drogowskaz z pytajnikami i robotem. */}
        <Box key={BLOCK} flexDirection="column">
        <Box flexDirection="row" gap={1} alignItems="center">
        {canHover ? (
          <Svg
            source={signSvg(
              list.length,
              list.flatMap((q, i) => (chosen.includes(q) ? [i] : [])),
              Math.floor((await $.clock.now().catch(() => 0)) / 500),
            )}
            alt={chosen.length ? `zaznaczone: ${chosen.length}` : 'propozycje: co dalej?'}
            width={SIGN_PX_W}
            height={SIGN_PX_H}
          />
        ) : null}
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
        {list.map((q, i) => (
          // Desktop dokłada natywnemu przyciskowi wcięcie z lewej; ujemny margines o jedną kolumnę
          // wyrównuje propozycje do lewej krawędzi pozostałych pasków.
          <Box key={`row${i + 1}`} flexDirection="row" gap={1} marginLeft={canHover ? -1 : 0}>
            {/* Kółko zaznacza propozycję do wysłania razem z innymi; kliknięcie w tekst wysyła od razu. */}
            <Button
              key={`p${i + 1}`}
              plain
              dimColor={!chosen.includes(q)}
              label={chosen.includes(q) ? '●' : '○'}
              onPress={() => update($, picked, l => (l.includes(q) ? l.filter(x => x !== q) : [...l, q]))}
            />
            <Box flexGrow={1} flexShrink={1}>
              <Button
                key={`q${i + 1}`}
                hotkey={String(i + 1)}
                plain
                label={q}
                onPress={() => void sendPicked($, [q])}
              />
            </Box>
            {/* „+ później” i × na końcu wiersza, odsłaniane najechaniem na ten wiersz; w miejscu pustego
                odstępu, więc nic się nie przesuwa (pozycja absolutna lądowała na desktopie w złym miejscu). */}
            <Box flexShrink={0} gap={2} {...(canHover ? { display: 'none' as const, hover: { display: 'flex' as const } } : {})}>
              <Button
                key={`l${i + 1}`}
                plain
                dimColor
                label="+ później"
                onPress={() => void saveForLater($, q)}
              />
              <Button
                key={`x${i + 1}`}
                plain
                dimColor
                label="×"
                onPress={async () => {
                  await ensureProject($)
                  const now = await $.clock.now()
                  await saveIgnored($, blockNow(await ignoredList($), q, now, project))
                  await update($, questions, l => l.filter(x => x !== q))
                  await settleRound($, x => (x === q ? 'zablokowana' : undefined))
                }}
              />
            </Box>
          </Box>
        ))}
        {/* Wiersz narzędzi, wyrównany jak propozycje: „4 inne” z numerkiem jak 1-3, zablokowane z żółtym ⊘
            (desktop nie barwi tekstu w przycisku). Klucz TOOLS_ROW: tu wyjasnij dokłada swój przycisk. */}
        <Box key={TOOLS_ROW} flexDirection="row" gap={3} alignItems="center" marginLeft={canHover ? -1 : 0}>
          {chosen.length > 0 && (
            <Button
              key="send-picked"
              hotkey="5"
              plain
              label={`wyślij zaznaczone (${chosen.length})`}
              onPress={() => void sendPicked($, list.filter(q => chosen.includes(q)))}
            />
          )}
          {refreshing ? (
            <Text dimColor>szukam innych…</Text>
          ) : (
            <Button key="more" hotkey="4" plain dimColor label="inne" onPress={() => void another($)} />
          )}
          {count > 0 && (
            <Box flexDirection="row" gap={1}>
              <Text color="warning">⊘</Text>
              <Button key="blocked" plain dimColor label={blockedLabel(count)} onPress={() => void openPane($, 'zablokowane')} />
            </Box>
          )}
        </Box>
        </Box>
        </Box>
        {/* Pusta linia oddzielająca propozycje od pasków pod nimi. */}
        <Box key="co-dalej-gap" height={1} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, blocked)
    const isConfirming = await read($, isConfirmingAll)
    const name = projectName(project)
    const shown = await read($, view)
    const rounds = await read($, history)

    // Przełącznik widoków: aktywny pełną jasnością, drugi wyciszony.
    const tabs = (
      <Box key="tabs" flexDirection="row" gap={3} marginBottom={1}>
        <Button key="tab-history" plain dimColor={shown !== 'historia'} label="historia" onPress={() => update($, view, () => 'historia' as const)} />
        <Button
          key="tab-blocked"
          plain
          dimColor={shown !== 'zablokowane'}
          label={`zablokowane (${list.length})`}
          onPress={() => update($, view, () => 'zablokowane' as const)}
        />
      </Box>
    )

    if (shown === 'historia') {
      const latest = [...rounds].reverse().slice(0, 40)
      return (
        <Box flexDirection="column" paddingX={1}>
          {tabs}
          {latest.length === 0 ? <Text dimColor>pusto</Text> : null}
          {latest.map((r, n) => (
            <Box key={`h${r.at}-${n}`} flexDirection="column" marginBottom={1}>
              <Text dimColor>
                {whenTime(r.at)} · {r.project}
              </Text>
              {r.items.map((item, k) => {
                const f = FATES[item.fate ?? 'brak']
                return (
                  <Box key={`h${r.at}-${n}-${k}`} flexDirection="row" gap={1}>
                    <Box width={2} flexShrink={0}>
                      <Text color={f.color} dimColor={!f.color}>
                        {f.mark}
                      </Text>
                    </Box>
                    <Box flexGrow={1} flexShrink={1}>
                      <Text wrap="wrap">{item.text}</Text>
                    </Box>
                    <Box flexShrink={0}>
                      <Text dimColor>{f.label}</Text>
                    </Box>
                  </Box>
                )
              })}
            </Box>
          ))}
        </Box>
      )
    }

    if (list.length === 0) {
      return (
        <Box flexDirection="column" paddingX={1}>
          {tabs}
          <Text dimColor>{name}: pusto</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        {tabs}
        <Box marginBottom={1}>
          <Text>
            <Text bold>{name}</Text>
            <Text dimColor> · {list.length}</Text>
          </Text>
        </Box>
        {list.map((item, i) => (
          <Box key={`b${i}`} flexDirection="row" gap={2} marginBottom={1}>
            <Text dimColor>{when(item.lastAt).padEnd(7)}</Text>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="wrap">{item.text}</Text>
            </Box>
            <Box flexShrink={0} {...(e.surface === 'desktop' ? { display: 'none' as const, hover: { display: 'flex' as const } } : {})}>
              <Button
                key={`u${i}`}
                plain
                label="Odblokuj"
                onPress={async () => saveIgnored($, unblock(await ignoredList($), item.text, project))}
              />
            </Box>
          </Box>
        ))}
        {/* Odblokowanie wszystkiego potwierdzane w miejscu tego samego przycisku. */}
        {isConfirming ? (
          <Box flexDirection="row" gap={1}>
            <Text color="warning">Odblokować wszystkie {list.length}?</Text>
            <Button
              key="all-yes"
              label="Tak"
              onPress={async () => {
                await saveIgnored($, unblockAll(await ignoredList($), project))
                await update($, isConfirmingAll, () => false)
              }}
            />
            <Button key="all-no" plain label="Anuluj" onPress={() => update($, isConfirmingAll, () => false)} />
          </Box>
        ) : (
          list.length > 1 && (
            <Button key="all" plain dimColor label="Odblokuj wszystkie" onPress={() => update($, isConfirmingAll, () => true)} />
          )
        )}
      </Box>
    )
  })
}
