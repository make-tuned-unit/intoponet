import { createServer, type Server } from 'node:http'
import {
  app,
  BrowserWindow,
  session,
  WebContentsView,
  type WebContents,
} from 'electron'
import { LocalProtectionEngine, ProtectionPageContextStore } from '@intoponet/protection-engine'
import { routeProtectionRequest, type ProtectionTab } from '../../apps/desktop/src/main/protectionRequest'

const siteA = 'site-a.intoponet.test'
const siteB = 'site-b.intoponet.test'
const adHost = 'ads.intoponet.test'
const trackerHost = 'track.intoponet.test'
const hostMap = [siteA, siteB, adHost, trackerHost]
  .map((hostname) => `MAP ${hostname} 127.0.0.1`)
  .concat('EXCLUDE localhost')
  .join(', ')

app.commandLine.appendSwitch('host-resolver-rules', hostMap)
app.commandLine.appendSwitch('no-proxy-server')

type Tab = ProtectionTab & { view: WebContentsView }

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not bind fixture server.')
  return address.port
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

function waitForPage(webContents: WebContents): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for page load.')), 10_000)
    webContents.once('did-finish-load', () => {
      clearTimeout(timeout)
      resolve()
    })
    webContents.once('did-fail-load', (_event, _code, description) => {
      clearTimeout(timeout)
      reject(new Error(`Fixture page failed: ${description}`))
    })
  })
}

async function main(): Promise<void> {
  let serverRequests = { ad: 0, tracker: 0 }
  const server = createServer((request, response) => {
    const host = request.headers.host?.split(':')[0] ?? ''
    if (host === adHost && request.url === '/ad.js') {
      serverRequests.ad += 1
      response.writeHead(200, { 'content-type': 'text/javascript' })
      response.end('window.adLoaded = true')
      return
    }
    if (host === trackerHost && request.url === '/tracker.js') {
      serverRequests.tracker += 1
      response.writeHead(200, { 'content-type': 'text/javascript' })
      response.end('window.trackerLoaded = true')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><html><body>
      <script src="http://${adHost}:${port}/ad.js"></script>
      <script src="http://${trackerHost}:${port}/tracker.js"></script>
      <script>window.pageDone = true</script>
    </body></html>`)
  })
  const port = await listen(server)
  await app.whenReady()

  const browsingSession = session.fromPartition('protection-native-probe')
  const protection = new LocalProtectionEngine()
  const contexts = new ProtectionPageContextStore()
  const tabs: Tab[] = []
  const blockedOrigins = new Set<string>()
  const probeWindow = new BrowserWindow({ show: false, width: 800, height: 600 })

  browsingSession.webRequest.onBeforeRequest((details, callback) => {
    const routed = routeProtectionRequest(protection, contexts, details, tabs)
    if (routed?.decision.action === 'block') {
      const origin = contexts.topLevelUrl(routed.webContentsId)
      if (origin) blockedOrigins.add(new URL(origin).origin)
      callback({ cancel: true })
      return
    }
    callback({})
  })

  const makeTab = (hostname: string): Tab => {
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: browsingSession,
      },
    })
    probeWindow.contentView.addChildView(view)
    view.setBounds({ x: tabs.length * 400, y: 0, width: 400, height: 600 })
    const tab: Tab = {
      url: `http://${hostname}:${port}/page`,
      view,
    }
    tabs.push(tab)
    return tab
  }

  const tabA = makeTab(siteA)
  const tabB = makeTab(siteB)
  protection.setSiteEnabled(new URL(tabA.url).origin, 'default', false)

  try {
    await Promise.all([
      Promise.all([tabA.view.webContents.loadURL(tabA.url), waitForPage(tabA.view.webContents)]),
      Promise.all([tabB.view.webContents.loadURL(tabB.url), waitForPage(tabB.view.webContents)]),
    ])

    const pageState = await Promise.all(
      [tabA, tabB].map((tab) =>
        tab.view.webContents.executeJavaScript(
          '({ adLoaded: window.adLoaded === true, trackerLoaded: window.trackerLoaded === true, pageDone: window.pageDone === true })',
        ),
      ),
    )
    const counts = [tabA, tabB].map((tab) => contexts.counters(tab.view.webContents.id))
    const origins = [tabA, tabB].map((tab) => contexts.topLevelUrl(tab.view.webContents.id))
    const evidence = {
      probe: 'protection-native-v1',
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      siteOrigins: [new URL(tabA.url).origin, new URL(tabB.url).origin],
      pageState,
      serverRequests,
      blockedOrigins: [...blockedOrigins].sort(),
      topLevelContexts: origins,
      counters: counts,
    }
    const passed =
      pageState[0]?.adLoaded === true &&
      pageState[0]?.trackerLoaded === true &&
      pageState[1]?.adLoaded !== true &&
      pageState[1]?.trackerLoaded !== true &&
      serverRequests.ad === 1 &&
      serverRequests.tracker === 1 &&
      blockedOrigins.has(new URL(tabB.url).origin) &&
      counts[0]?.blockedAds === 0 &&
      counts[0]?.blockedTrackers === 0 &&
      (counts[1]?.blockedAds ?? 0) >= 1 &&
      (counts[1]?.blockedTrackers ?? 0) >= 1
    console.log(JSON.stringify({ ...evidence, passed }, null, 2))
    if (!passed) process.exitCode = 1
  } finally {
    for (const tab of tabs) {
      contexts.remove(tab.view.webContents.id)
    }
    if (!probeWindow.isDestroyed()) probeWindow.destroy()
    await closeServer(server)
    app.quit()
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  app.exit(1)
})
