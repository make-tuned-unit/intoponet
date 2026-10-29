#!/usr/bin/env node
// Launch a packaged macOS app with an isolated profile and exercise real renderer crashes over CDP.
import { spawn } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const requestedApp = process.argv[2]
if (!requestedApp) {
  console.error('Usage: node experiments/browser-runtime-verification/verify-crash-recovery.mjs /path/to/Intoponet.app')
  process.exit(2)
}

const appPath = resolve(requestedApp)
const executable = appPath.endsWith('.app')
  ? join(appPath, 'Contents', 'MacOS', 'Intoponet')
  : appPath
const profile = mkdtempSync(join(process.env.QA_TMP ?? tmpdir(), 'intoponet-runtime-'))
const nonce = randomUUID()
const route = `/renderer-crash-${nonce}`
const requestCounts = new Map()
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))

async function unusedPort() {
  const server = createNetServer()
  await new Promise((resolveListen, reject) => server.listen(0, '127.0.0.1', resolveListen).once('error', reject))
  const address = server.address()
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
  return address.port
}

async function waitFor(read, accept, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await read()
    if (accept(last)) return last
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(last)}`)
}

function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl)
  const pending = new Map()
  let sequence = 0
  const opened = new Promise((resolveOpen, rejectOpen) => {
    const timer = setTimeout(() => rejectOpen(new Error('CDP websocket open timed out')), 8_000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolveOpen() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); rejectOpen(new Error('CDP websocket failed')) }, { once: true })
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id) return
    const task = pending.get(message.id)
    if (!task) return
    pending.delete(message.id)
    if (message.error) task.reject(new Error(message.error.message))
    else task.resolve(message.result)
  })
  socket.addEventListener('close', () => {
    for (const task of pending.values()) task.reject(new Error('CDP target closed'))
    pending.clear()
  })
  return {
    opened,
    send(method, params = {}) {
      return new Promise((resolveCommand, rejectCommand) => {
        const id = ++sequence
        pending.set(id, { resolve: resolveCommand, reject: rejectCommand })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    close() { if (socket.readyState < WebSocket.CLOSING) socket.close() },
  }
}

async function main() {
  if (!appPath.endsWith('.app') && basename(appPath) !== 'Intoponet') {
    throw new Error('Pass the built Intoponet.app bundle or its Intoponet executable.')
  }
  const http = createHttpServer((request, response) => {
    if (request.url === route) {
      requestCounts.set(route, (requestCounts.get(route) ?? 0) + 1)
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end('<!doctype html><title>Crash recovery fixture</title><main>renderer crash recovery fixture</main>')
      return
    }
    response.writeHead(204).end()
  })
  await new Promise((resolveListen, rejectListen) => http.listen(0, '127.0.0.1', resolveListen).once('error', rejectListen))
  const webPort = http.address().port
  const cdpPort = await unusedPort()
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profile}`,
  ], { env, stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8_000) })
  let shell
  let shellCdp
  const report = {
    appPath,
    executable,
    isolatedProfile: profile,
    startup: 'pending',
    firstCrashAutoReload: 'pending',
    secondCrashPause: 'pending',
    manualReload: 'pending',
  }

  try {
    const debugBase = `http://127.0.0.1:${cdpPort}`
    const targets = async () => (await (await fetch(`${debugBase}/json/list`)).json())
    shell = await waitFor(async () => {
      if (child.exitCode !== null) throw new Error(`App exited ${child.exitCode} during launch. ${stderr}`)
      try {
        return (await targets()).find((item) => item.type === 'page' && /index\.html/.test(item.url)) ?? null
      } catch { return null }
    }, Boolean, 'trusted shell CDP target', 30_000)
    shellCdp = connectCdp(shell.webSocketDebuggerUrl)
    await shellCdp.opened
    await shellCdp.send('Runtime.enable')
    const evaluate = async (expression) => {
      const result = await shellCdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'renderer evaluation failed')
      return result.result.value
    }
    const startup = await waitFor(
      () => evaluate(`({ title: document.title, text: (document.querySelector('#root')?.innerText || '').trim(), bridge: !!window.intoponet?.browserHost })`),
      (state) => state.bridge && state.text.length > 0,
      'rendered shell UI and preload bridge',
    )
    report.startup = { title: startup.title, renderedTextCharacters: startup.text.length, browserHostBridge: startup.bridge }
    await evaluate(`window.__qaCrashEvents = []; window.intoponet.browserHost.subscribe((event) => { if (event.type === 'navigation-failed') window.__qaCrashEvents.push(event) })`)

    const fixtureUrl = `http://127.0.0.1:${webPort}${route}`
    await evaluate(`window.intoponet.browserHost.navigate(${JSON.stringify(fixtureUrl)})`)
    await waitFor(() => requestCounts.get(route) ?? 0, (count) => count >= 1, 'initial test page request')

    const pageFor = async (excludeId = null) => waitFor(
      async () => (await targets()).find((item) => item.type === 'page' && item.url === fixtureUrl && item.id !== excludeId) ?? null,
      Boolean,
      `browser page target for ${fixtureUrl}`,
    )
    const crash = async (target) => {
      const cdp = connectCdp(target.webSocketDebuggerUrl)
      await cdp.opened
      await cdp.send('Page.enable')
      // Chromium closes this target as part of Page.crash; the response may be lost.
      void cdp.send('Page.crash').catch(() => undefined)
      await delay(250)
      cdp.close()
    }

    let page = await pageFor()
    const firstId = page.id
    await crash(page)
    await waitFor(() => requestCounts.get(route) ?? 0, (count) => count === 2, 'single automatic reload after first renderer crash')
    page = await pageFor(firstId)
    report.firstCrashAutoReload = { previousTargetId: firstId, replacementTargetId: page.id, pageRequests: requestCounts.get(route) }

    const secondId = page.id
    await crash(page)
    await waitFor(
      () => evaluate(`window.__qaCrashEvents.some((event) => event.reason.includes('paused after repeated crashes'))`),
      Boolean,
      'visible repeated-crash pause event',
    )
    await delay(1_500)
    if (requestCounts.get(route) !== 2) throw new Error(`Repeated crash triggered an automatic reload (${requestCounts.get(route)} page requests).`)
    report.secondCrashPause = { crashedTargetId: secondId, automaticReloadsAfterPause: 0 }

    await evaluate('window.intoponet.browserHost.reload()')
    await waitFor(() => requestCounts.get(route) ?? 0, (count) => count === 3, 'manual reload after crash pause')
    const recovered = await waitFor(
      () => evaluate('window.intoponet.browserHost.getState()'),
      (state) => state.url === fixtureUrl,
      'manual reload navigation commit',
    )
    report.manualReload = { restoredUrl: recovered.url, pageRequests: requestCounts.get(route) }
    report.result = 'passed'
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    report.result = 'failed'
    report.error = error instanceof Error ? error.message : String(error)
    report.stderrTail = stderr
    console.error(JSON.stringify(report, null, 2))
    process.exitCode = 1
  } finally {
    shellCdp?.close()
    await new Promise((resolveClose) => http.close(() => resolveClose()))
    child.kill('SIGTERM')
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      delay(4_000).then(() => { child.kill('SIGKILL') }),
    ])
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
})
