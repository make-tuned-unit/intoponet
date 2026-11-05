// Shared harness for feature checks: launches the built app with a fresh profile,
// drives the renderer over CDP, and always shuts the app down.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const repo = resolve(import.meta.dirname, '../..')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

export class CheckFailure extends Error {}

/** Throw a readable failure when a promise to the user is not kept. */
export function expect(condition, message) {
  if (!condition) throw new CheckFailure(message)
}

async function connect(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let id = 0
  const pending = new Map()
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    const entry = message.id && pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); socket.send(JSON.stringify({ id: n, method, params })) })
  const evaluate = async (expression, { userGesture = false } = {}) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed')
    return result.result.value
  }
  return { socket, send, evaluate }
}

/**
 * Run `check(ctx)` against a freshly launched app. Returns notes from the check.
 * ctx: evaluate, send, delay, wait, click, type, press, shot, pageShot(session, label), page(urlPart),
 * main(expression), keyInPage(urlPart, keyCode, modifiers), profile, env.
 */
export async function runAppCheck(check, { port = 9400 + Math.floor(Math.random() * 400), env: extraEnv = {}, evidenceDir, name, timeoutMs = 180_000 } = {}) {
  // E2E_PROFILE: a profile kept between runs (e.g. with translation models installed); otherwise a fresh one.
  const keep = process.env.E2E_PROFILE
  if (keep) mkdirSync(keep, { recursive: true })
  const profile = keep ?? mkdtempSync(join(process.env.E2E_TMP ?? tmpdir(), 'intoponet-e2e-'))
  // Downloads go to the profile too, never the Downloads folder of the person running the checks.
  mkdirSync(join(profile, 'Downloads'), { recursive: true })
  const env = { ...process.env, INTOPONET_CAPTURE_ROOT: join(profile, 'Pictures', 'Intoponet'), INTOPONET_DOWNLOADS_DIR: join(profile, 'Downloads'), ...extraEnv }
  delete env.ELECTRON_RUN_AS_NODE
  // node_modules/.bin/electron is a launcher that starts Electron as a child: run it in its own process group and
  // stop the whole group, or Electron outlives the check (and a few runs can exhaust the Mac's memory).
  // The main process also listens for Node's inspector (localhost only), so a check can send keys the way
  // the OS does: keys sent over CDP reach the page but skip the browser's own key handling.
  const inspectPort = port + 1000
  const app = spawn(join(repo, 'node_modules/.bin/electron'), [`--remote-debugging-port=${port}`, `--inspect=127.0.0.1:${inspectPort}`, `--user-data-dir=${profile}`, (process.env.E2E_APP_MAIN ?? join(repo, 'apps/desktop/out/main/index.js'))], { env, stdio: 'ignore', detached: true })
  const stopApp = (signal) => {
    try { process.kill(-app.pid, signal) } catch { /* gone */ }
    // Anything still holding this profile (Electron's helpers re-parent sometimes).
    try { spawnSync('pkill', [signal === 'SIGKILL' ? '-9' : '-15', '-f', `--user-data-dir=${profile}`]) } catch { /* none */ }
  }
  // If this process is stopped or crashes, the app must not be left running.
  const onExit = () => stopApp('SIGKILL')
  const onSignal = (signal) => { stopApp('SIGKILL'); process.exit(signal === 'SIGINT' ? 130 : 143) }
  process.once('exit', onExit)
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  const sockets = []
  try {
    let target
    for (let i = 0; i < 200 && !target; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        target = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
      } catch { /* not up yet */ }
      if (!target) await delay(100)
    }
    if (!target) throw new CheckFailure('The app window never appeared.')
    const renderer = await connect(target.webSocketDebuggerUrl)
    sockets.push(renderer.socket)
    await renderer.send('Runtime.enable')
    const { evaluate, send } = renderer
    const wait = async (expression, ms = 60_000, label = expression) => {
      const end = Date.now() + ms
      while (Date.now() < end) {
        if (await evaluate(expression).catch(() => false)) return true
        await delay(500)
      }
      throw new CheckFailure(`Timed out waiting for: ${label}`)
    }
    const click = (selector, text) => evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => ${text === undefined ? 'true' : `(e.innerText || e.getAttribute('aria-label') || '').includes(${JSON.stringify(text)})`}); if (!el) return false; el.click(); return true })()`)
    const type = (text) => send('Input.insertText', { text })
    const press = async (key) => {
      const code = { Enter: 13, Escape: 27, Tab: 9 }[key] ?? 0
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, ...(key === 'Enter' ? { text: '\r' } : {}) })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code })
    }
    const shot = async (label) => {
      if (!evidenceDir) return
      mkdirSync(evidenceDir, { recursive: true })
      const { data } = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(evidenceDir, `${name ?? 'check'}-${label}.png`), Buffer.from(data, 'base64'))
    }
    /** Screenshot of a web page's own contents (the shell screenshot does not include native page views). */
    const pageShot = async (session, label) => {
      if (!evidenceDir) return
      mkdirSync(evidenceDir, { recursive: true })
      const { data } = await session.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(evidenceDir, `${name ?? 'check'}-${label}.png`), Buffer.from(data, 'base64'))
    }
    /** A web page's own CDP session (for selecting text, asking for permissions…). */
    const page = async (urlPart) => {
      let found
      for (let i = 0; i < 60 && !found; i += 1) {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        found = list.find((t) => t.type === 'page' && t.url.includes(urlPart))
        if (!found) await delay(250)
      }
      if (!found) throw new CheckFailure(`No page open at ${urlPart}`)
      const session = await connect(found.webSocketDebuggerUrl)
      sockets.push(session.socket)
      return session
    }
    const flyTo = async (place) => {
      await evaluate(`(() => { const i = document.querySelector('.command-input input'); i.focus(); i.select(); return true })()`)
      await type(place)
      await delay(900)
      await press('Enter')
    }
    /** Evaluates an expression in the app's main process (Node inspector); `electron` is in scope. */
    let mainSession = null
    const main = async (expression) => {
      if (!mainSession) {
        const [target] = await (await fetch(`http://127.0.0.1:${inspectPort}/json/list`)).json()
        if (!target) throw new CheckFailure('The main process inspector is not available.')
        mainSession = await connect(target.webSocketDebuggerUrl)
        sockets.push(mainSession.socket)
      }
      return mainSession.evaluate(`((electron) => (${expression}))(process.mainModule.require('electron'))`)
    }
    /**
     * A key chord typed into the web page whose address contains `urlPart`, delivered as keyboard input to
     * that page (as when it has focus). `keyCode` and `modifiers` as in webContents.sendInputEvent.
     */
    const keyInPage = (urlPart, keyCode, modifiers = []) => main(`(() => {
      const page = electron.webContents.getAllWebContents().find((c) => /^https?:/.test(c.getURL()) && c.getURL().includes(${JSON.stringify(urlPart)}))
      if (!page) return false
      for (const type of ['keyDown', 'keyUp']) page.sendInputEvent({ type, keyCode: ${JSON.stringify(keyCode)}, modifiers: ${JSON.stringify(modifiers)} })
      return true
    })()`)
    const waitForNews = () => wait(`window.intoponet.browserHost.getNewsDigest().then((raw) => !!raw && JSON.parse(raw).countries.length > 100)`, 300_000, 'the local news digest to load')
    // Every check starts from a ready interface: header, globe and launcher rendered.
    await wait(`!!document.querySelector('.topbar') && !!document.querySelector('.command-input input') && !!document.querySelector('canvas')`, 45_000, 'the app interface to load')
    let timer
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new CheckFailure(`Took longer than ${Math.round(timeoutMs / 1000)} s.`)), timeoutMs) })
    try {
      const notes = await Promise.race([check({ evaluate, send, delay, wait, click, type, press, shot, pageShot, page, main, keyInPage, flyTo, waitForNews, profile, port }), limit])
      return notes ?? ''
    } finally {
      clearTimeout(timer)
    }
  } finally {
    for (const socket of sockets) try { socket.close() } catch { /* closed */ }
    stopApp('SIGTERM')
    await delay(800)
    stopApp('SIGKILL')
    process.removeListener('exit', onExit)
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    if (!keep) try { rmSync(profile, { recursive: true, force: true }) } catch { /* temp */ }
  }
}
