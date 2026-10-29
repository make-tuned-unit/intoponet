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
const siteRedirect = 'redirect.intoponet.test'
const unreachable = 'unreachable.intoponet.test'
const adHost = 'ads.intoponet.test'
const trackerHost = 'track.intoponet.test'
const hostMap = [siteA, siteB, siteRedirect, adHost, trackerHost]
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
  let serverRequests = { ad: 0, tracker: 0, serviceWorker: 0, noWebContentsId: 0 }
  const edgeRequests: Array<{
    path: string
    webContentsId?: number
    initiatorOrigin?: string
    resourceType: string
    routedToTab: boolean
    routedTopLevelUrl: string | null
    decision: 'block' | 'allow' | 'unrouted'
  }> = []
  const server = createServer((request, response) => {
    const host = request.headers.host?.split(':')[0] ?? ''
    if (host === siteRedirect && request.url === '/redirect-to-b') {
      response.writeHead(302, { location: `http://${siteB}:${port}/page` })
      response.end()
      return
    }
    if (host === siteRedirect && request.url === '/redirect-unreachable') {
      response.writeHead(302, { location: `http://${unreachable}:${port}/unreachable` })
      response.end()
      return
    }
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
    if (host === trackerHost && request.url === '/sw-tracker.js') {
      serverRequests.serviceWorker += 1
      response.writeHead(200, {
        'content-type': 'text/javascript',
        'access-control-allow-origin': '*',
      })
      response.end('window.serviceWorkerTrackerLoaded = true')
      return
    }
    if (host === adHost && request.url === '/no-webcontents.js') {
      serverRequests.noWebContentsId += 1
      response.writeHead(200, { 'content-type': 'text/javascript' })
      response.end('window.unattributedRequestLoaded = true')
      return
    }
    if (host === 'localhost' && request.url === '/sw-page') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(`<!doctype html><html><body><script>
        (async () => {
          try {
            await navigator.serviceWorker.register('/sw.js')
            await navigator.serviceWorker.ready
            if (!navigator.serviceWorker.controller) await new Promise((resolve) => {
              navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })
            })
            navigator.serviceWorker.controller.postMessage('fetch-tracker')
            window.serviceWorkerReady = true
          } catch (error) { window.serviceWorkerError = String(error) }
        })()
      </script></body></html>`)
      return
    }
    if (host === 'localhost' && request.url === '/sw.js') {
      response.writeHead(200, { 'content-type': 'text/javascript', 'service-worker-allowed': '/' })
      response.end(`
        self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()))
        self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
        self.addEventListener('message', (event) => {
          if (event.data === 'fetch-tracker') event.waitUntil(fetch('http://${trackerHost}:${port}/sw-tracker.js', { mode: 'no-cors' }))
        })
      `)
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
    const pathname = new URL(details.url).pathname
    let edgeRequest: (typeof edgeRequests)[number] | undefined
    if (pathname === '/sw-tracker.js' || pathname === '/no-webcontents.js') {
      edgeRequest = {
        path: pathname,
        webContentsId: details.webContentsId,
        initiatorOrigin: details.initiatorOrigin,
        resourceType: details.resourceType,
        routedToTab: tabs.some((tab) => tab.view.webContents.id === details.webContentsId),
        routedTopLevelUrl: null,
        decision: 'unrouted',
      }
      edgeRequests.push(edgeRequest)
    }
    const routed = routeProtectionRequest(protection, contexts, details, tabs)
    if (edgeRequest) {
      edgeRequest.decision = routed?.decision.action ?? 'unrouted'
      edgeRequest.routedTopLevelUrl = routed?.topLevelUrl ?? null
    }
    if (routed?.decision.action === 'block') {
      const origin = routed.webContentsId === -1
        ? routed.topLevelUrl
        : contexts.topLevelUrl(routed.webContentsId)
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
    const contents = view.webContents
    contents.on('did-navigate', (_event, url) => {
      tab.url = url
      contexts.commitNavigation(contents.id, url)
    })
    contents.on('did-fail-load', (_event, _code, _description, failedUrl, isMainFrame) => {
      if (isMainFrame) contexts.failNavigation(contents.id, failedUrl, contents.getURL() || tab.url)
    })
    return tab
  }

  const tabA = makeTab(siteA)
  const tabB = makeTab(siteB)
  const tabRedirect = makeTab(siteRedirect)
  protection.setSiteEnabled(new URL(tabA.url).origin, 'default', false)

  try {
    await Promise.all([
      Promise.all([tabA.view.webContents.loadURL(tabA.url), waitForPage(tabA.view.webContents)]),
      Promise.all([tabB.view.webContents.loadURL(tabB.url), waitForPage(tabB.view.webContents)]),
      Promise.all([
        tabRedirect.view.webContents.loadURL(`http://${siteRedirect}:${port}/redirect-to-b`),
        waitForPage(tabRedirect.view.webContents),
      ]),
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

    const redirectState = {
      finalUrl: tabRedirect.view.webContents.getURL(),
      topLevelContext: contexts.topLevelUrl(tabRedirect.view.webContents.id),
      counters: contexts.counters(tabRedirect.view.webContents.id),
      page: await tabRedirect.view.webContents.executeJavaScript(
        '({ adLoaded: window.adLoaded === true, trackerLoaded: window.trackerLoaded === true })',
      ),
    }

    const failedNavigationUrl = `http://${siteRedirect}:${port}/redirect-unreachable`
    const waitForFailure = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for failed main-frame navigation.')), 10_000)
      tabRedirect.view.webContents.once('did-fail-load', (_event, _code, _description, failedUrl, isMainFrame) => {
        if (isMainFrame) {
          clearTimeout(timeout)
          resolve(failedUrl)
        }
      })
    })
    await tabRedirect.view.webContents.loadURL(failedNavigationUrl).catch(() => undefined)
    const failedUrl = await waitForFailure
    const failedNavigationState = {
      failedUrl,
      restoredContext: contexts.topLevelUrl(tabRedirect.view.webContents.id),
      counters: contexts.counters(tabRedirect.view.webContents.id),
    }

    const serviceWorkerTab = makeTab('localhost')
    serviceWorkerTab.url = `http://localhost:${port}/sw-page`
    await Promise.all([
      serviceWorkerTab.view.webContents.loadURL(serviceWorkerTab.url),
      waitForPage(serviceWorkerTab.view.webContents),
    ])
    await waitForJavaScript(serviceWorkerTab.view.webContents, 'window.serviceWorkerReady === true')
    await waitForCondition(
      () => edgeRequests.some((request) => request.path === '/sw-tracker.js'),
      'service worker request interception',
    )

    await browsingSession.fetch(`http://${adHost}:${port}/no-webcontents.js`).catch(() => undefined)
    await waitForCondition(
      () => edgeRequests.some((request) => request.path === '/no-webcontents.js'),
      'main-process request interception without a WebContents',
    )
    const edgeCoverage = {
      requests: edgeRequests,
      serviceWorkerTrackerBlockedBeforeDownload:
        edgeRequests.find((request) => request.path === '/sw-tracker.js')?.decision === 'block' &&
        serverRequests.serviceWorker === 0,
      unattributedSessionFetchBlockedBeforeDownload:
        edgeRequests.find((request) => request.path === '/no-webcontents.js')?.decision === 'block' &&
        serverRequests.noWebContentsId === 0,
      serviceWorkerInitiatorUsedForExceptionScope:
        edgeRequests.find((request) => request.path === '/sw-tracker.js')?.routedTopLevelUrl === `http://localhost:${port}/`,
    }
    const evidence = {
      probe: 'protection-native-v2',
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      siteOrigins: [new URL(tabA.url).origin, new URL(tabB.url).origin],
      pageState,
      serverRequests,
      blockedOrigins: [...blockedOrigins].sort(),
      topLevelContexts: origins,
      counters: counts,
      redirectState,
      failedNavigationState,
      edgeCoverage,
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
      (counts[1]?.blockedTrackers ?? 0) >= 1 &&
      redirectState.finalUrl === tabB.url &&
      redirectState.topLevelContext === tabB.url &&
      redirectState.page.adLoaded === false &&
      redirectState.page.trackerLoaded === false &&
      failedNavigationState.restoredContext === tabB.url &&
      edgeCoverage.serviceWorkerTrackerBlockedBeforeDownload &&
      edgeCoverage.unattributedSessionFetchBlockedBeforeDownload &&
      edgeCoverage.serviceWorkerInitiatorUsedForExceptionScope &&
      edgeRequests.some((request) => request.path === '/no-webcontents.js' &&
        !request.routedToTab && (request.webContentsId === undefined || request.webContentsId < 0))
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

async function waitForJavaScript(webContents: WebContents, expression: string): Promise<void> {
  await waitForCondition(async () => await webContents.executeJavaScript(expression) === true, expression)
}

async function waitForCondition(
  check: () => boolean | Promise<boolean>,
  label: string,
): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${label}.`)
}

void main().catch((error: unknown) => {
  console.error(error)
  app.exit(1)
})
