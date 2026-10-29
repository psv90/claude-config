// git clean filter: commits marketplace.json without mods whose folder is in .gitignore,
// so the local marketplace keeps all mods and the repo gets only the public ones.
const { execFileSync } = require('child_process')
const ignored = src => { try { execFileSync('git', ['check-ignore', '-q', src]); return true } catch { return false } }
let s = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', d => (s += d)).on('end', () => {
  const m = JSON.parse(s)
  m.plugins = m.plugins.filter(p => !ignored(p.source))
  process.stdout.write(JSON.stringify(m, null, 2) + '\n')
})
