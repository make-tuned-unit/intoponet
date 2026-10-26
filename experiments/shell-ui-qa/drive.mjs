// Drive the built Electron app over CDP and capture the real window
// (including the native page view) with macOS screencapture.
// Usage: node drive.mjs <scenario.mjs> <outDir>
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../..')
const scenarioPath = resolve(process.argv[2])
const outDir = resolve(process.argv[3] ?? join(import.meta.dirname, 'captures'))
mkdirSync(outDir, { recursive: true })
const port = 9333
const profile = mkdtempSync(join(process.env.QA_TMP ?? tmpdir(), 'intoponet-shell-qa-'))
const env = { ...process.env, INTOPONET_CAPTURE_ROOT: join(profile, 'Pictures', 'Intoponet') }
delete env.ELECTRON_RUN_AS_NODE
const app = spawn(join(repo, 'node_modules/.bin/electron'), [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, join(repo, 'apps/desktop/out/main/index.js')], { env, stdio: ['ignore', process.env.QA_APP_LOG ? 'pipe' : 'ignore', 'ignore'] })
if (process.env.QA_APP_LOG) app.stdout.on('data', (chunk) => process.stdout.write(`[app] ${chunk}`))
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

async function target() {
  for (let i = 0; i < 150; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
      if (page) return page
    } catch {}
    await delay(100)
  }
  throw new Error('renderer target not found')
}

const page = await target()
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r, j) => { socket.onopen = r; socket.onerror = j })
let id = 0
const pending = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  const entry = message.id && pending.get(message.id)
  if (!entry) return
  pending.delete(message.id)
  message.error ? entry.j(new Error(message.error.message)) : entry.r(message.result)
}
const send = (method, params = {}) => new Promise((r, j) => { const n = ++id; pending.set(n, { r, j }); socket.send(JSON.stringify({ id: n, method, params })) })
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed')
  return result.result.value
}
const shot = async (name) => {
  const box = await evaluate('({ x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight })')
  execFileSync('screencapture', ['-x', '-o', `-R${box.x},${box.y},${box.w},${box.h}`, join(outDir, `${name}.png`)])
  console.log('shot', name)
}
// Renderer-only capture (no native page view), immune to other windows covering the app.
const shotApp = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, 'base64'))
  console.log('shot', name)
}
const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('missing ${selector}'); el.click(); return true })()`)
const hover = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false })); return true })()`)

try {
  await send('Runtime.enable')
  const { default: scenario } = await import(scenarioPath)
  await scenario({ evaluate, shot, shotApp, click, hover, delay, send, profile })
} finally {
  socket.close()
  app.kill()
  await delay(400)
  rmSync(profile, { recursive: true, force: true })
}
