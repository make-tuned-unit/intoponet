// CPU-profiles the main process for the first N seconds of a fresh start and prints the
// heaviest functions by self time. Usage: node experiments/perf/main-profile.mjs [seconds]
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repo } from '../e2e/lib.mjs'

const seconds = Number(process.argv[2] ?? 150)
const profile = mkdtempSync(join(tmpdir(), 'intoponet-prof-'))
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const app = spawn(join(repo, 'node_modules/.bin/electron'), ['--inspect=9239', `--user-data-dir=${profile}`, join(repo, 'apps/desktop/out/main/index.js')], { env, stdio: 'ignore', detached: true })
const stop = () => { try { process.kill(-app.pid, 'SIGKILL') } catch {} ; spawnSync('pkill', ['-9', '-f', `--user-data-dir=${profile}`]) }
process.on('exit', stop)
let target
for (let i = 0; i < 100 && !target; i++) { try { target = (await (await fetch('http://127.0.0.1:9239/json/list')).json())[0] } catch {} ; if (!target) await new Promise((r) => setTimeout(r, 100)) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })) })
await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 1000 }); await send('Profiler.start')
await new Promise((r) => setTimeout(r, seconds * 1000))
const { profile: cpu } = await send('Profiler.stop')
writeFileSync(join(import.meta.dirname, 'main.cpuprofile'), JSON.stringify(cpu))
const dt = new Map(); cpu.samples.forEach((s, i) => dt.set(s, (dt.get(s) ?? 0) + (cpu.timeDeltas[i] ?? 0)))
const byId = new Map(cpu.nodes.map((n) => [n.id, n]))
const self = new Map()
for (const [nid, us] of dt) { const n = byId.get(nid); const f = n.callFrame; const key = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`; self.set(key, (self.get(key) ?? 0) + us) }
const total = [...self.values()].reduce((a, b) => a + b, 0)
const idle = [...self.entries()].filter(([k]) => /\(idle\)|\(program\)|\(garbage collector\)/.test(k))
console.log(`profiled ${seconds}s; busy ${(total - idle.reduce((s, [, v]) => s + v, 0)) / 1e6 | 0}s`, idle.map(([k, v]) => `${k.split(' ')[0]} ${(v / 1e6).toFixed(1)}s`).join(', '))
for (const [k, v] of [...self.entries()].filter(([k]) => !/\(idle\)|\(program\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`${(v / 1e6).toFixed(2)}s  ${k}`)
stop(); process.exit(0)
