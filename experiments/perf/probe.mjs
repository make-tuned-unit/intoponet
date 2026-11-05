// Performance probe: launches the built app with a fresh profile and measures startup, the
// news load, globe frame rate, main-thread stalls, main-process responsiveness, memory and
// idle CPU. Usage: node experiments/perf/probe.mjs [label]  → prints JSON, appends to runs.jsonl.
import { execSync } from 'node:child_process'
import { appendFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { repo, runAppCheck } from '../e2e/lib.mjs'

const label = process.argv[2] ?? 'run'
const spawnedAt = Date.now()
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

// Renderer helpers installed once: frame counter, long-task log, IPC latency sampler.
const install = `(() => {
  if (window.__perf) return true
  const p = window.__perf = { frames: [], longTasks: [], ipc: [] }
  const tick = (t) => { p.frames.push(t); if (p.frames.length > 20000) p.frames.splice(0, 10000); requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  try { new PerformanceObserver((list) => { for (const e of list.getEntries()) p.longTasks.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true }) } catch {}
  p.sampleIpc = async () => { const t = performance.now(); await window.intoponet.browserHost.getState(); p.ipc.push([t, performance.now() - t]) }
  p.ipcTimer = setInterval(() => p.sampleIpc(), 250)
  return true
})()`

const windowStats = (from, to) => `(() => {
  const p = window.__perf
  const f = p.frames.filter((t) => t >= ${from} && t <= ${to})
  const gaps = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b)
  const q = (arr, x) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * x))] : null
  const lt = p.longTasks.filter(([s]) => s >= ${from} && s <= ${to})
  const ipc = p.ipc.filter(([s]) => s >= ${from} && s <= ${to}).map(([, d]) => d).sort((a, b) => a - b)
  return {
    fps: f.length > 1 ? +((f.length - 1) / ((f[f.length - 1] - f[0]) / 1000)).toFixed(1) : 0,
    frameP95: q(gaps, 0.95) && +q(gaps, 0.95).toFixed(1),
    jank50: gaps.filter((g) => g > 50).length,
    longTasks: lt.length, longTaskMs: Math.round(lt.reduce((s, [, d]) => s + d, 0)), longestTask: Math.round(Math.max(0, ...lt.map(([, d]) => d))),
    ipcP50: q(ipc, 0.5) && +q(ipc, 0.5).toFixed(1), ipcP95: q(ipc, 0.95) && +q(ipc, 0.95).toFixed(1), ipcMax: ipc.length ? +ipc[ipc.length - 1].toFixed(1) : null,
  }
})()`

function appProcesses(profile) {
  const out = execSync(`ps -axo pid=,rss=,%cpu=,command=`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return out.split('\n').filter((line) => line.includes(profile)).map((line) => {
    const [pid, rss, cpu] = line.trim().split(/\s+/)
    return { pid: +pid, rssMb: +rss / 1024, cpu: +cpu, kind: /--type=(\w[\w-]*)/.exec(line)?.[1] ?? 'main' }
  })
}

function bundleSizes() {
  const dir = join(repo, 'apps/desktop/out/renderer/assets')
  const files = readdirSync(dir).map((f) => ({ f, kb: statSync(join(dir, f)).size / 1024 }))
  const js = files.filter((x) => x.f.endsWith('.js'))
  return { jsKb: Math.round(js.reduce((s, x) => s + x.kb, 0)), largestJs: js.sort((a, b) => b.kb - a.kb).slice(0, 3).map((x) => `${x.f} ${Math.round(x.kb)} KB`), cssKb: Math.round(files.filter((x) => x.f.endsWith('.css')).reduce((s, x) => s + x.kb, 0)) }
}

const result = await runAppCheck(async (ctx) => {
  const uiReadyMs = Date.now() - spawnedAt
  await ctx.evaluate(install)
  await ctx.send('Performance.enable')
  const nav = await ctx.evaluate(`(() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), now: Math.round(performance.now()) } })()`)
  // Startup through the news load.
  const t0 = await ctx.evaluate('performance.now()')
  await ctx.waitForNews()
  const t1 = await ctx.evaluate('performance.now()')
  const newsMs = Math.round(Date.now() - spawnedAt)
  const duringNews = await ctx.evaluate(windowStats(0, t1))
  // Highlights populated (World stories rendered).
  const worldStart = Date.now()
  await ctx.wait(`document.querySelectorAll('.world-list .world-row').length > 0`, 120_000, 'world stories')
  const worldMs = Date.now() - spawnedAt
  // Idle globe, after things settle.
  await delay(8000)
  const i0 = await ctx.evaluate('performance.now()')
  const profile = ctx.profile
  const cpuSamples = []
  for (let i = 0; i < 5; i += 1) { await delay(2000); cpuSamples.push(appProcesses(profile).reduce((s, p) => s + p.cpu, 0)) }
  const i1 = await ctx.evaluate('performance.now()')
  const idle = await ctx.evaluate(windowStats(i0, i1))
  // Dragging the globe for ~6 s.
  const d0 = await ctx.evaluate('performance.now()')
  const canvas = await ctx.evaluate(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  for (let round = 0; round < 3; round += 1) {
    await ctx.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: canvas.x - 150, y: canvas.y, button: 'left', clickCount: 1 })
    for (let s = 0; s <= 40; s += 1) { await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: canvas.x - 150 + s * 8, y: canvas.y + Math.sin(s / 6) * 40, button: 'left', buttons: 1 }); await delay(16) }
    await ctx.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: canvas.x + 170, y: canvas.y, button: 'left', clickCount: 1 })
    // Wheel zoom in and out.
    for (let s = 0; s < 12; s += 1) { await ctx.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: canvas.x, y: canvas.y, deltaX: 0, deltaY: s < 6 ? -120 : 120 }); await delay(60) }
  }
  await delay(500)
  const d1 = await ctx.evaluate('performance.now()')
  const drag = await ctx.evaluate(windowStats(d0, d1))
  const metrics = Object.fromEntries((await ctx.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
  const procs = appProcesses(profile)
  const memory = { totalRssMb: Math.round(procs.reduce((s, p) => s + p.rssMb, 0)), byKind: Object.entries(procs.reduce((acc, p) => ({ ...acc, [p.kind]: (acc[p.kind] ?? 0) + p.rssMb }), {})).map(([k, v]) => `${k} ${Math.round(v)} MB`), rendererJsHeapMb: Math.round(metrics.JSHeapUsedSize / 1048576), domNodes: metrics.Nodes }
  return JSON.stringify({ label, at: new Date().toISOString(), uiReadyMs, rendererNav: nav, newsReadyMs: newsMs, worldStoriesMs: worldMs, duringStartup: duringNews, idle: { ...idle, appCpuPct: +(cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length).toFixed(1) }, dragAndZoom: drag, memory, bundle: bundleSizes() })
}, { name: 'PERF', timeoutMs: 420_000 })

console.log(JSON.stringify(JSON.parse(result), null, 1))
appendFileSync(join(import.meta.dirname, 'runs.jsonl'), result + '\n')
