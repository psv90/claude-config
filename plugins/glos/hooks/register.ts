// glos: po turze dłuższej niż `minSeconds` czyta na głos krótkie streszczenie
// odpowiedzi, żeby można było odejść od komputera. Mówi polski głos Windowsa
// (Microsoft Paulina) przez System.Speech; długą odpowiedź najpierw streszcza Haiku.
// /glos włącza i wyłącza czytanie we wszystkich sesjach.
import type { EngineInterface, Register } from 'claude-code'

const OFF_KEY = 'wylaczony'
const SHORT = 300

// Tekst do mówienia: bez Markdownu, kodu, linków i ścieżek.
export function speakable(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_#>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const SAY = [
  '[Console]::InputEncoding = [Text.Encoding]::UTF8',
  '$t = [Console]::In.ReadToEnd()',
  'Add-Type -AssemblyName System.Speech',
  '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  "try { $s.SelectVoice('Microsoft Paulina Desktop') } catch {}",
  '$s.Speak($t)',
].join('; ')

async function say($: EngineInterface, text: string) {
  await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', SAY], { stdin: text, timeoutMs: 180_000 })
}

async function summarize($: EngineInterface, answer: string) {
  const plain = speakable(answer)
  if (plain.length <= SHORT) return plain
  const r = await $.model.complete({
    model: 'haiku',
    prompt:
      'Streść poniższą odpowiedź w jednym lub dwóch zdaniach po polsku, do przeczytania na głos: co zostało zrobione i czy czeka na mnie decyzja. ' +
      'Zwracaj się do mnie w formie męskiej. Bez nazw plików, ścieżek, kodu i liczb, które źle brzmią czytane. Tylko te zdania.\n\n' +
      answer.slice(0, 8000),
  })
  return r.isAnswered ? speakable(r.text) : plain.slice(0, SHORT)
}

export const register: Register = (on, options) => {
  const minMs = Math.max(0, Number(options.minSeconds ?? 120)) * 1000

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'glos', description: 'Włącza lub wyłącza czytanie odpowiedzi po długiej turze' })
    return result
  })

  on('command.run', { command: 'glos' }, async $ => {
    const isOff = Boolean(await $.store.get(OFF_KEY))
    await $.store.set(OFF_KEY, !isOff)
    return { text: isOff ? 'Czytanie odpowiedzi włączone.' : 'Czytanie odpowiedzi wyłączone.' }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || e.isAborted || e.durationMs < minMs || !e.answer.trim()) return result
    if (await $.store.get(OFF_KEY)) return result
    const answer = e.answer
    // Poza turą: mówienie trwa dłużej, niż hook może czekać.
    $.clock.after(0, () => {
      void (async () => {
        const text = await summarize($, answer)
        if (text) await say($, text)
      })()
    })
    return result
  })
}
