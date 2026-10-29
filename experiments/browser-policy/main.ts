import { readFileSync, readdirSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { BrowserWindow, app, session } from 'electron'
import { bindPermissionOwnerLifecycle, kindsFor, originOf, SitePermissionBroker, SitePermissionStore } from '../../apps/desktop/src/main/sitePermissions'
import { rejectCertificateErrorForSession } from '../../apps/desktop/src/main/browserCertificatePolicy'
import { reserveDownloadPath } from '../../apps/desktop/src/main/downloadReservation'
import { bindPopupCloseWithOwner, nestedPopupDecision, popupDecision, popupWindowOptions, PopupLimiter } from '../../apps/desktop/src/main/popups'

app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('disable-component-update')
app.commandLine.appendSwitch('no-default-browser-check')

const certificatePath = process.argv.find((argument) => argument.endsWith('localhost-cert.pem'))
const keyPath = process.argv.find((argument) => argument.endsWith('localhost-key.pem'))
const fixturePath = process.argv.find((argument) => argument.endsWith('fixture.html'))
const downloadsDirectory = process.argv.at(-1)
const fixture = fixturePath ? readFileSync(fixturePath) : Buffer.from('')
const permissionRequests: Array<{ id: string; origin: string; kinds: string[] }> = []
const certEvents: Array<{ url: string; error: string; isMainFrame: boolean; prevented: boolean; callbackAllow: boolean | null }> = []
const permissionCallbackResults: boolean[] = []
const systemAccessCalls: string[] = []
let requestWaiter: ((value: (typeof permissionRequests)[number]) => void) | null = null
const inMemoryStore = new SitePermissionStore(null)
let browser: BrowserWindow | null = null
let certificateBrowser: BrowserWindow | null = null
let subframeBrowser: BrowserWindow | null = null
let privatePopupOpener: BrowserWindow | null = null
let burstPopupOpener: BrowserWindow | null = null
let lifecycleBrowser: BrowserWindow | null = null
const popupWindows: BrowserWindow[] = []
const popupTabs: BrowserWindow[] = []
const popupAttempts: Array<{ owner: string; action: string; url: string }> = []
const nestedPopupTabs: BrowserWindow[] = []
const nestedPopupAttempts: Array<{ owner: string; action: string; url: string }> = []
let httpServer: ReturnType<typeof createHttpServer> | null = null
let httpsServer: ReturnType<typeof createHttpsServer> | null = null

function nextPermissionRequest(): Promise<(typeof permissionRequests)[number]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for Electron permission request')), 10_000)
    requestWaiter = (request) => { clearTimeout(timer); resolve(request) }
  })
}

function report(status: string, results: Record<string, unknown>): void {
  console.log('Browser policy native probe report:')
  console.log(JSON.stringify({ status, results }, null, 2))
}

function installPopupPolicy(opener: BrowserWindow, owner: string, isPrivate: boolean): void {
  const limiter = new PopupLimiter()
  opener.webContents.setWindowOpenHandler(({ url, disposition, features }) => {
    const plan = popupDecision({ url, disposition, features }, limiter, opener.webContents.id)
    popupAttempts.push({ owner, action: plan.action, url })
    if (plan.action === 'deny') return { action: 'deny' }
    if (plan.action === 'tab') {
      const tab = new BrowserWindow({
        show: false,
        webPreferences: { partition: isPrivate ? 'browser-policy-private-probe' : 'browser-policy-native-probe', sandbox: true, nodeIntegration: false, contextIsolation: true },
      })
      popupTabs.push(tab)
      void tab.loadURL(url).catch(() => undefined)
      return { action: 'deny' }
    }
    return { action: 'allow', overrideBrowserWindowOptions: popupWindowOptions(plan) }
  })
  opener.webContents.on('did-create-window', (child) => {
    popupWindows.push(child)
    bindPopupCloseWithOwner(child, opener.webContents)
    const childContentsId = child.webContents.id
    child.webContents.setWindowOpenHandler(({ url, disposition, features }) => {
      const plan = nestedPopupDecision({ url, disposition, features }, limiter, childContentsId)
      nestedPopupAttempts.push({ owner, action: plan.action, url })
      if (plan.action === 'deny') return { action: 'deny' }
      const nestedTab = new BrowserWindow({
        show: false,
        webPreferences: { partition: isPrivate ? 'browser-policy-private-probe' : 'browser-policy-native-probe', sandbox: true, nodeIntegration: false, contextIsolation: true },
      })
      nestedPopupTabs.push(nestedTab)
      void nestedTab.loadURL(url).catch(() => undefined)
      return { action: 'deny' }
    })
    child.webContents.once('destroyed', () => limiter.forget(childContentsId))
  })
}

async function waitForCondition(condition: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!condition() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25))
  if (!condition()) throw new Error(message)
}

function listen(server: ReturnType<typeof createHttpServer> | ReturnType<typeof createHttpsServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('Could not resolve local fixture port'))
      resolve(address.port)
    })
  })
}

async function run(): Promise<void> {
  if (!certificatePath || !keyPath) throw new Error('Temporary self-signed certificate and key paths are required')
  await app.whenReady()
  let httpsPort = 0
  httpServer = createHttpServer((request, response) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname
    if (path === '/download') {
      const payload = new URL(request.url || '/', 'http://localhost').searchParams.get('payload') ?? ''
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="same-name.txt"', 'cache-control': 'no-store' })
      response.end(payload)
      return
    }
    if (path === '/redirect-to-self-signed') {
      response.writeHead(302, { location: `https://localhost:${httpsPort}/fixture?redirect=1`, 'cache-control': 'no-store' })
      response.end()
      return
    }
    if (path === '/parent-with-untrusted-iframe') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(`<html data-intoponet-probe="browser-policy-parent"><body><h1>HTTP parent stayed usable</h1><iframe src="https://localhost:${httpsPort}/fixture?subframe=1"></iframe></body></html>`)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(fixture)
  })
  httpsServer = createHttpsServer({ cert: readFileSync(certificatePath), key: readFileSync(keyPath) }, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(fixture)
  })
  const httpPort = await listen(httpServer)
  httpsPort = await listen(httpsServer)
  const browsing = session.fromPartition('browser-policy-native-probe')
  const broker = new SitePermissionBroker({
    store: () => inMemoryStore,
    emit: (event) => {
      if (event.type !== 'request') return
      const request = { id: event.request.id, origin: event.request.origin, kinds: event.request.kinds }
      permissionRequests.push(request)
      requestWaiter?.(request)
      requestWaiter = null
    },
    // Mirrors the production adapter decision without asking macOS for a real device grant.
    systemAccess: async (kind) => { systemAccessCalls.push(kind); return true },
    timeoutMs: 5_000,
  })

  browsing.setPermissionRequestHandler((contents, permission, callback, details) => {
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes ?? []
    broker.request({
      origin: originOf(details.requestingUrl || contents.getURL()),
      kinds: kindsFor(permission, mediaTypes),
      isPrivate: false,
      owner: contents.id,
    }, (granted) => { permissionCallbackResults.push(granted); callback(granted) })
  })
  browsing.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    const mediaType = (details as { mediaType?: string }).mediaType
    return broker.check(originOf(requestingOrigin), kindsFor(permission, mediaType === 'video' ? ['video'] : mediaType === 'audio' ? ['audio'] : []), false) === true
  })
  const nativeDownloadResults: Array<{ filename: string; state: string; bytes: number; expectedPayloadMatched: boolean }> = []
  browsing.on('will-download', (_event, item) => {
    if (!downloadsDirectory) { item.cancel(); return }
    const reservation = reserveDownloadPath(downloadsDirectory, item.getFilename())
    try {
      item.setSavePath(reservation.path)
    } catch {
      item.cancel()
      reservation.cleanupIfEmpty()
      return
    }
    item.once('done', (_download, state) => {
      if (state !== 'completed') reservation.cleanupIfEmpty()
      const bytes = state === 'completed' ? readFileSync(reservation.path) : Buffer.alloc(0)
      const expectedPayload = new URL(item.getURL()).searchParams.get('payload')
      nativeDownloadResults.push({ filename: reservation.filename, state, bytes: bytes.length, expectedPayloadMatched: bytes.toString() === expectedPayload })
    })
  })
  app.on('certificate-error', (event, webContents, url, error, _certificate, callback, isMainFrame) => {
    let allow: boolean | null = null
    const handled = rejectCertificateErrorForSession(event, webContents, browsing, (decision) => {
      allow = decision
      callback(decision)
    })
    if (handled) certEvents.push({ url, error, isMainFrame, prevented: event.defaultPrevented, callbackAllow: allow })
  })

  browser = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: 'browser-policy-native-probe',
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  })
  installPopupPolicy(browser, 'public', false)
  const webContents = browser.webContents
  bindPermissionOwnerLifecycle(webContents, (owner) => broker.dropOwner(owner))
  await webContents.loadURL('http://localhost:' + httpPort + '/fixture')
  const originA = 'http://localhost:' + httpPort
  const secureContext = await webContents.executeJavaScript('window.isSecureContext') as boolean
  const initialCameraPermission = await webContents.executeJavaScript('window.queryCameraPermission()') as string

  const firstRequest = nextPermissionRequest()
  const firstCapture = webContents.executeJavaScript('window.captureFakeCamera()') as Promise<{ ok: boolean; name?: string; tracks?: string[] }>
  const allowRequest = await firstRequest
  await broker.decide(allowRequest.id, 'allow')
  const firstCaptureResult = await firstCapture
  const afterAllowPermission = await webContents.executeJavaScript('window.queryCameraPermission()') as string
  const activeTrackStateBeforeReset = await webContents.executeJavaScript('window.probeStream.getVideoTracks().map((track) => track.readyState)') as string[]
  broker.reset(originA, false, 'camera')
  const activeTrackStateAfterReset = await webContents.executeJavaScript('window.probeStream.getVideoTracks().map((track) => track.readyState)') as string[]
  const afterResetPermission = await webContents.executeJavaScript('window.queryCameraPermission()') as string
  await webContents.executeJavaScript('window.stopProbeTracks()')
  const postResetPromptPromise = nextPermissionRequest()
  const afterResetCapturePromise = webContents.executeJavaScript('window.captureFakeCamera()') as Promise<{ ok: boolean; name?: string }>
  const postResetPrompt = await postResetPromptPromise
  await broker.decide(postResetPrompt.id, 'dismiss')
  const afterResetCapture = await afterResetCapturePromise

  await webContents.loadURL('http://127.0.0.1:' + httpPort + '/fixture')
  const originB = 'http://127.0.0.1:' + httpPort
  const blockRequestPromise = nextPermissionRequest()
  const blockedCapturePromise = webContents.executeJavaScript('window.captureFakeCamera()') as Promise<{ ok: boolean; name?: string }>
  const blockRequest = await blockRequestPromise
  await broker.decide(blockRequest.id, 'block')
  const blockedCapture = await blockedCapturePromise
  const afterBlockPermission = await webContents.executeJavaScript('window.queryCameraPermission()') as string
  const blockedPermissionCheck = broker.check(originB, ['camera'], false)
  const blockedDecisionRetained = inMemoryStore.get(originB).camera === 'block'

  broker.reset(originB, false, 'camera')
  let navigationCancellation: boolean | null = null
  broker.request({ origin: originB, kinds: ['camera'], isPrivate: false, owner: webContents.id }, (granted) => {
    navigationCancellation = granted
    permissionCallbackResults.push(granted)
  })
  const pendingBeforeNavigation = broker.list().length
  const pendingNavigationRequest = permissionRequests[permissionRequests.length - 1]
  await webContents.loadURL('http://localhost:' + httpPort + '/fixture?owner-lifecycle')
  const pendingAfterNavigation = broker.list().length
  const pendingCancelledOnNavigation = navigationCancellation === false && pendingBeforeNavigation === 1 && pendingAfterNavigation === 0

  broker.reset(originB, false, 'camera')
  lifecycleBrowser = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: 'browser-policy-native-probe',
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  })
  const lifecycleContents = lifecycleBrowser.webContents
  bindPermissionOwnerLifecycle(lifecycleContents, (owner) => broker.dropOwner(owner))
  let destroyCancellation: boolean | null = null
  broker.request({ origin: originB, kinds: ['camera'], isPrivate: false, owner: lifecycleContents.id }, (granted) => {
    destroyCancellation = granted
    permissionCallbackResults.push(granted)
  })
  const pendingBeforeDestroy = broker.list().length
  const destroyed = new Promise<void>((resolve) => lifecycleContents.once('destroyed', () => resolve()))
  lifecycleBrowser.destroy()
  await destroyed
  const pendingAfterDestroy = broker.list().length
  const pendingCancelledOnDestroy = destroyCancellation === false && pendingBeforeDestroy === 1 && pendingAfterDestroy === 0

  const certFailures: Array<{ errorCode: number; description: string; validatedURL: string }> = []
  certificateBrowser = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: 'browser-policy-native-probe',
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  })
  const certificateContents = certificateBrowser.webContents
  const failedLoad = new Promise<void>((resolve) => {
    const listener = (_event: Electron.Event, errorCode: number, description: string, validatedURL: string, isMainFrame: boolean) => {
      if (!isMainFrame) return
      certFailures.push({ errorCode, description, validatedURL })
      certificateContents.removeListener('did-fail-load', listener)
      resolve()
    }
    certificateContents.on('did-fail-load', listener)
  })
  await certificateContents.loadURL('https://localhost:' + httpsPort + '/fixture').catch(() => undefined)
  let failedLoadTimer: ReturnType<typeof setTimeout>
  await Promise.race([failedLoad, new Promise((_, reject) => { failedLoadTimer = setTimeout(() => reject(new Error('Timed out waiting for certificate navigation failure')), 10_000) })])
  clearTimeout(failedLoadTimer!)
  const certificateFixtureLoaded = await certificateContents.executeJavaScript("document.documentElement.getAttribute('data-intoponet-probe')")
    .then((marker) => marker === 'browser-policy-v1')
    .catch(() => false)
  const certDenied = certEvents.length > 0 && certEvents.every((item) => item.callbackAllow === false && item.prevented)
  const certificateNavigationFailed = certFailures.length > 0 && certFailures.every((item) => item.errorCode <= -200 && item.errorCode >= -219)

  const redirectFailureRows: Array<{ errorCode: number; description: string; validatedURL: string }> = []
  const redirectFailed = new Promise<void>((resolve) => {
    const listener = (_event: Electron.Event, errorCode: number, description: string, validatedURL: string, isMainFrame: boolean) => {
      if (!isMainFrame) return
      redirectFailureRows.push({ errorCode, description, validatedURL })
      certificateContents.removeListener('did-fail-load', listener)
      resolve()
    }
    certificateContents.on('did-fail-load', listener)
  })
  const redirectStart = certEvents.length
  await certificateContents.loadURL(`http://localhost:${httpPort}/redirect-to-self-signed`).catch(() => undefined)
  await Promise.race([redirectFailed, new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for redirected certificate failure')), 10_000))])
  const redirectEvents = certEvents.slice(redirectStart)
  const redirectDenied = redirectEvents.length > 0 && redirectEvents.every((item) => item.url.includes('redirect=1') && item.isMainFrame && item.callbackAllow === false && item.prevented)
  const redirectNavigationFailed = redirectFailureRows.length > 0 && redirectFailureRows.every((item) => item.errorCode <= -200 && item.errorCode >= -219 && item.validatedURL.includes('redirect=1'))

  subframeBrowser = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: 'browser-policy-native-probe',
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  })
  const subframeContents = subframeBrowser.webContents
  const subframeStart = certEvents.length
  await subframeContents.loadURL(`http://localhost:${httpPort}/parent-with-untrusted-iframe`)
  const parentMarker = await subframeContents.executeJavaScript("document.documentElement.getAttribute('data-intoponet-probe')") as string | null
  const parentTitle = await subframeContents.executeJavaScript("document.querySelector('h1')?.textContent") as string | null
  const waitForSubframeCertificateEvent = async (): Promise<void> => {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline && !certEvents.slice(subframeStart).some((item) => item.url.includes('subframe=1'))) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    if (!certEvents.slice(subframeStart).some((item) => item.url.includes('subframe=1'))) throw new Error('Timed out waiting for untrusted iframe certificate failure')
  }
  await waitForSubframeCertificateEvent()
  const subframeEvents = certEvents.slice(subframeStart)
  const iframeCertificateDenied = subframeEvents.length > 0 && subframeEvents.every((item) => item.url.includes('subframe=1') && !item.isMainFrame && item.callbackAllow === false && item.prevented)
  const parentRemainedUsable = parentMarker === 'browser-policy-parent' && parentTitle === 'HTTP parent stayed usable' && subframeContents.getURL().startsWith(`http://localhost:${httpPort}/parent-with-untrusted-iframe`)
  if (!downloadsDirectory) throw new Error('Temporary downloads directory argument is required')
  const startDownloadResults = nativeDownloadResults.length
  webContents.downloadURL(`http://localhost:${httpPort}/download?payload=${encodeURIComponent('first unique download payload')}`)
  webContents.downloadURL(`http://localhost:${httpPort}/download?payload=${encodeURIComponent('second unique download payload')}`)
  const downloadDeadline = Date.now() + 15_000
  while (nativeDownloadResults.length - startDownloadResults < 2 && Date.now() < downloadDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  const downloads = nativeDownloadResults.slice(startDownloadResults)
  const downloadNamesDistinct = downloads.length === 2 && new Set(downloads.map((item) => item.filename)).size === 2
  const downloadPayloadsIntact = downloads.length === 2 && downloads.every((item) => item.state === 'completed' && item.expectedPayloadMatched)
  const temporaryDownloadFiles = readdirSync(downloadsDirectory).sort()

  const publicSession = webContents.session
  const publicPopupCountBeforeUnsupported = popupWindows.length + popupTabs.length
  const publicAttemptStart = popupAttempts.length
  await webContents.executeJavaScript(`(() => { const link = document.createElement('a'); link.href = 'http://localhost:${httpPort}/fixture?popup-tab=1'; link.target = '_blank'; document.body.append(link); link.click(); link.remove() })()`, true)
  await waitForCondition(() => popupTabs.length >= 1, 'Timed out waiting for native public new-tab popup plan')
  const publicTabUsesOpenerSession = popupTabs[0]!.webContents.session === publicSession
  const publicNewTabPlanObserved = popupAttempts.slice(publicAttemptStart).some((attempt) => attempt.owner === 'public' && attempt.action === 'tab')
  await webContents.executeJavaScript("(() => { const link = document.createElement('a'); link.href = 'file:///tmp/intoponet-popup-probe-denied'; link.target = '_blank'; document.body.append(link); link.click(); link.remove() })()", true)
  await new Promise((resolve) => setTimeout(resolve, 250))
  const unsupportedSchemeDecisionDenied = popupDecision({ url: 'file:///tmp/intoponet-popup-probe-denied', disposition: 'new-window', features: '' }, new PopupLimiter(), 900).action === 'deny'
  const unsupportedPopupObservedByHandler = popupAttempts.some((attempt) => attempt.owner === 'public' && attempt.url.startsWith('file:'))
  const unsupportedPopupCreatedNoWindow = popupWindows.length + popupTabs.length === publicPopupCountBeforeUnsupported + 1

  privatePopupOpener = new BrowserWindow({
    show: false,
    webPreferences: { partition: 'browser-policy-private-probe', sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true },
  })
  installPopupPolicy(privatePopupOpener, 'private', true)
  await privatePopupOpener.loadURL(`http://localhost:${httpPort}/fixture?private-popup-opener`)
  const privateSession = privatePopupOpener.webContents.session
  const privateAttemptStart = popupAttempts.length
  await privatePopupOpener.webContents.executeJavaScript(`(() => { window.open('http://localhost:${httpPort}/fixture?popup-sized=1', 'signin', 'width=640,height=480'); return true })()`, true)
  await waitForCondition(() => popupWindows.length >= 1, 'Timed out waiting for sized native popup')
  const privatePopup = popupWindows[0]!
  await waitForCondition(() => privatePopup.webContents.getURL().includes('popup-sized=1'), 'Sized popup did not navigate to the local child fixture')
  const privatePopupUsesOpenerSession = privatePopup.webContents.session === privateSession
  const privatePopupKeepsOpener = await privatePopup.webContents.executeJavaScript('window.opener !== null') as boolean
  const privatePopupHasNoNode = await privatePopup.webContents.executeJavaScript("typeof process === 'undefined'") as boolean
  const privatePopupPlanObserved = popupAttempts.slice(privateAttemptStart).some((attempt) => attempt.owner === 'private' && attempt.action === 'window')
  const nestedBurstStart = nestedPopupAttempts.length
  await privatePopup.webContents.executeJavaScript(`(() => { for (let i = 0; i < 4; i++) window.open('http://localhost:${httpPort}/fixture?nested-burst=' + i, 'nested' + i, 'width=400,height=300') })()`, true)
  await waitForCondition(() => nestedPopupAttempts.length - nestedBurstStart >= 4, 'Timed out waiting for nested popup burst decisions')
  await waitForCondition(() => nestedPopupTabs.filter((tab) => tab.webContents.getURL().includes('nested-burst=')).length === 3, 'Timed out waiting for nested private tabs')
  const nestedBurstDecisions = nestedPopupAttempts.slice(nestedBurstStart).map((attempt) => attempt.action)
  const nestedBurstLimitBlockedFourth = nestedBurstDecisions.filter((action) => action === 'tab').length === 3 && nestedBurstDecisions.filter((action) => action === 'deny').length === 1
  const nestedTabsUsePrivateSession = nestedPopupTabs.length === 3 && nestedPopupTabs.every((tab) => tab.webContents.session === privateSession)
  const nestedUnsupportedSchemeDenied = nestedPopupDecision({ url: 'mailto:blocked@example.test', disposition: 'new-window', features: '' }, new PopupLimiter(), 991).action === 'deny'
  const nestedAboutBlankDenied = nestedPopupDecision({ url: 'about:blank', disposition: 'new-window', features: '' }, new PopupLimiter(), 992).action === 'deny'
  const rootAboutBlankStillWindow = popupDecision({ url: 'about:blank', disposition: 'new-window', features: '' }, new PopupLimiter(), 993).action === 'window'
  let beforeUnloadAttempts = 0
  privatePopup.webContents.on('will-prevent-unload', () => { beforeUnloadAttempts += 1 })
  await privatePopup.webContents.executeJavaScript("window.addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = '' }); window.__intoponetBeforeUnloadInstalled = true")
  const beforeUnloadHandlerInstalled = await privatePopup.webContents.executeJavaScript("window.__intoponetBeforeUnloadInstalled === true") as boolean
  privatePopup.close()
  await new Promise((resolve) => setTimeout(resolve, 200))
  const popupCloseVetoedByBeforeUnload = beforeUnloadAttempts > 0 && !privatePopup.isDestroyed()
  const privateTabAttemptStart = popupAttempts.length
  await privatePopupOpener.webContents.executeJavaScript(`(() => { const link = document.createElement('a'); link.href = 'http://localhost:${httpPort}/fixture?private-popup-tab=1'; link.target = '_blank'; document.body.append(link); link.click(); link.remove() })()`, true)
  await waitForCondition(() => popupTabs.length >= 2, 'Timed out waiting for private new-tab plan')
  const privateTabUsesPrivateSession = popupTabs[1]!.webContents.session === privateSession
  const privateNewTabPlanObserved = popupAttempts.slice(privateTabAttemptStart).some((attempt) => attempt.owner === 'private' && attempt.action === 'tab')
  burstPopupOpener = new BrowserWindow({
    show: false,
    webPreferences: { partition: 'browser-policy-private-probe', sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true },
  })
  installPopupPolicy(burstPopupOpener, 'burst', true)
  await burstPopupOpener.loadURL(`http://localhost:${httpPort}/fixture?private-burst-opener`)
  const burstStart = popupAttempts.length
  await burstPopupOpener.webContents.executeJavaScript(`(() => { for (let i = 0; i < 4; i++) window.open('http://localhost:${httpPort}/fixture?burst=' + i, 'burst' + i, 'width=400,height=300') })()`, true)
  await waitForCondition(() => popupAttempts.length - burstStart >= 4, 'Timed out waiting for popup burst decisions')
  const burstDecisions = popupAttempts.slice(burstStart).map((attempt) => attempt.action)
  await waitForCondition(() => popupWindows.filter((child) => child.webContents.getURL().includes('burst=')).length === 3, 'Timed out waiting for three allowed burst popups')
  const burstLimitBlockedFourth = burstDecisions.filter((action) => action === 'window').length === 3 && burstDecisions.filter((action) => action === 'deny').length === 1
  const burstChildren = popupWindows.filter((child) => child.webContents.getURL().includes('burst='))
  const burstChildrenClosed = burstChildren.map((child) => new Promise<void>((resolve) => child.once('closed', () => resolve())))
  burstPopupOpener.destroy()
  await Promise.all(burstChildrenClosed)
  const burstChildrenClosedWithOpener = burstChildren.length === 3 && burstChildren.every((child) => child.isDestroyed())
  const privateChildrenBeforeClose = popupWindows.filter((child) => !child.isDestroyed() && child.webContents.session === privateSession)
  const privateChildrenClosed = privateChildrenBeforeClose.map((child) => new Promise<void>((resolve) => child.once('closed', () => resolve())))
  const beforeUnloadAttemptsBeforeOwnerDestroy = beforeUnloadAttempts
  privatePopupOpener.destroy()
  await new Promise((resolve) => setTimeout(resolve, 200))
  const ownerDestroyTriggeredBeforeUnload = beforeUnloadAttempts > beforeUnloadAttemptsBeforeOwnerDestroy
  const ownerDestroyVetoedByBeforeUnload = ownerDestroyTriggeredBeforeUnload && !privatePopup.isDestroyed()
  if (!privatePopup.isDestroyed()) privatePopup.destroy()
  await Promise.all(privateChildrenClosed)
  const childrenClosedWithOpener = privateChildrenBeforeClose.length === 1 && !ownerDestroyVetoedByBeforeUnload && privateChildrenBeforeClose.every((child) => child.isDestroyed())
  const permissionAllowed = firstCaptureResult.ok && afterAllowPermission === 'granted'
  const permissionResetDeniedFutureRequest = afterResetPermission === 'denied' && !afterResetCapture.ok
  const permissionBlocked = !blockedCapture.ok && afterBlockPermission === 'denied' && blockedPermissionCheck === false && blockedDecisionRetained
  const activeCaptureRemainsLiveAfterReset = activeTrackStateBeforeReset.length > 0
    && activeTrackStateBeforeReset.every((state) => state === 'live')
    && activeTrackStateAfterReset.length > 0
    && activeTrackStateAfterReset.every((state) => state === 'live')
  const passed = secureContext && permissionAllowed && permissionResetDeniedFutureRequest && activeCaptureRemainsLiveAfterReset && permissionBlocked && pendingCancelledOnNavigation && pendingCancelledOnDestroy && certDenied && certificateNavigationFailed && !certificateFixtureLoaded && redirectDenied && redirectNavigationFailed && iframeCertificateDenied && parentRemainedUsable && downloadNamesDistinct && downloadPayloadsIntact && publicNewTabPlanObserved && publicTabUsesOpenerSession && unsupportedSchemeDecisionDenied && unsupportedPopupCreatedNoWindow && privatePopupPlanObserved && privatePopupUsesOpenerSession && privatePopupKeepsOpener && privatePopupHasNoNode && beforeUnloadHandlerInstalled && popupCloseVetoedByBeforeUnload && !ownerDestroyVetoedByBeforeUnload && privateNewTabPlanObserved && privateTabUsesPrivateSession && burstLimitBlockedFourth && burstChildrenClosedWithOpener && childrenClosedWithOpener && nestedBurstLimitBlockedFourth && nestedTabsUsePrivateSession && nestedUnsupportedSchemeDenied && nestedAboutBlankDenied && rootAboutBlankStillWindow

  report(passed ? 'passed' : 'failed', {
    runtime: { electronVersion: process.versions.electron, chromiumVersion: process.versions.chrome, platform: process.platform, architecture: process.arch },
    fixture: { httpOrigin: originA, alternateLoopbackOrigin: originB, selfSignedTlsHost: 'localhost', serverBindings: ['127.0.0.1'] },
    permission: {
      secureContext,
      initialCameraPermission,
      firstRequest: { origin: allowRequest.origin, kinds: allowRequest.kinds },
      firstCaptureResult,
      permissionCallbackResults,
      afterAllowPermission,
      permissionReset: {
        queryStateAfterReset: afterResetPermission,
        activeTrackStateBeforeReset,
        activeTrackStateAfterReset,
        activeCaptureRemainsLiveAfterReset,
        subsequentPrompt: { origin: postResetPrompt.origin, kinds: postResetPrompt.kinds, decision: 'dismiss' },
        subsequentCapture: afterResetCapture,
      },
      blockedOrigin: originB,
      blockedCapture,
      afterBlockPermission,
      blockedPermissionCheck,
      blockedDecisionRetained,
      ownerLifecycle: {
        requestOrigin: pendingNavigationRequest?.origin ?? null,
        pendingBeforeNavigation,
        pendingAfterNavigation,
        callbackGranted: navigationCancellation,
        cancelledOnMainFrameNavigation: pendingCancelledOnNavigation,
        pendingBeforeDestroy,
        pendingAfterDestroy,
        destroyCallbackGranted: destroyCancellation,
        cancelledOnWebContentsDestroyed: pendingCancelledOnDestroy,
      },
      systemAccessCalls,
      requests: permissionRequests.map(({ origin, kinds }) => ({ origin, kinds })),
    },
    certificate: {
      events: certEvents,
      mainFrameFailures: certFailures,
      denied: certDenied,
      navigationFailed: certificateNavigationFailed,
      fixtureContentLoaded: certificateFixtureLoaded,
      redirectedTopLevel: { events: redirectEvents, failures: redirectFailureRows, denied: redirectDenied, navigationFailed: redirectNavigationFailed },
      untrustedIframe: { events: subframeEvents, parentMarker, parentTitle, parentRemainedUsable, denied: iframeCertificateDenied },
    },
    download: { results: downloads, distinctReservedFilenames: downloadNamesDistinct, payloadsIntact: downloadPayloadsIntact, temporaryDirectoryContains: temporaryDownloadFiles },
    popup: {
      attempts: popupAttempts,
      publicNewTabPlanObserved,
      publicTabUsesOpenerSession,
      unsupportedSchemeDecisionDenied,
      unsupportedPopupObservedByHandler,
      unsupportedPopupCreatedNoWindow,
      privatePopupPlanObserved,
      privatePopupUsesOpenerSession,
      privatePopupKeepsOpener,
      privatePopupHasNoNode,
      beforeUnloadHandlerInstalled,
      popupCloseVetoedByBeforeUnload,
      ownerDestroyTriggeredBeforeUnload,
      ownerDestroyVetoedByBeforeUnload,
      privateNewTabPlanObserved,
      privateTabUsesPrivateSession,
      burstDecisions,
      burstLimitBlockedFourth,
      burstChildrenClosedWithOpener,
      privateChildCountBeforeOpenerClose: privateChildrenBeforeClose.length,
      childrenClosedWithOpener,
      nestedBurstAttempts: nestedPopupAttempts.slice(nestedBurstStart),
      nestedBurstLimitBlockedFourth,
      nestedTabCount: nestedPopupTabs.length,
      nestedTabsUsePrivateSession,
      nestedUnsupportedSchemeDenied,
      nestedAboutBlankDenied,
      rootAboutBlankStillWindow,
    },
    conclusions: { permissionAllowed, permissionResetDeniedFutureRequest, activeCaptureRemainsLiveAfterReset, permissionBlocked, pendingCancelledOnNavigation, pendingCancelledOnDestroy, certDenied, certificateNavigationFailed, certificateFixtureNotLoaded: !certificateFixtureLoaded, redirectDenied, redirectNavigationFailed, iframeCertificateDenied, parentRemainedUsable, downloadNamesDistinct, downloadPayloadsIntact, publicNewTabPlanObserved, publicTabUsesOpenerSession, unsupportedSchemeDecisionDenied, unsupportedPopupCreatedNoWindow, privatePopupPlanObserved, privatePopupUsesOpenerSession, privatePopupKeepsOpener, privatePopupHasNoNode, privateNewTabPlanObserved, privateTabUsesPrivateSession, burstLimitBlockedFourth, burstChildrenClosedWithOpener, childrenClosedWithOpener, nestedBurstLimitBlockedFourth, nestedTabsUsePrivateSession, nestedUnsupportedSchemeDenied, nestedAboutBlankDenied, rootAboutBlankStillWindow },
    limitations: [
      'The probe uses a temporary Electron BrowserWindow and in-memory permission store, not the packaged Intoponet UI/WebContentsView.',
      'Camera uses Chromium fake-device mode; no camera hardware or macOS camera permission prompt is invoked.',
      'The temporary self-signed localhost certificate was rejected for a direct navigation, an HTTP redirect target, and an HTTPS iframe. Expired certificates, hostname mismatch, public-CA trust, and other certificate errors remain untested.',
      'Two same-name HTTP downloads were written to a runner-owned temporary directory; this is not a test against the user Downloads directory or a packaged release.',
      'Popup behavior was exercised in temporary BrowserWindows with the production planner/limiter/options/lifetime helpers; tabs use BrowserWindow stand-ins rather than the production WebContentsView tab UI.',
      'Nested popup behavior uses the production nested policy helper with BrowserWindow stand-ins for tabs; no external page or packaged tab UI was used.',
      'This probe does not test OS permission grant/revocation behavior, persistent permission-file storage, renderer process crashes, private-session cleanup, or cross-platform behavior.',
    ],
  })
  if (!passed) process.exitCode = 1
}

void run().catch((error) => {
  report('failed', { error: error instanceof Error ? error.message : 'Unknown probe error' })
  process.exitCode = 1
}).finally(async () => {
  browser?.destroy()
  certificateBrowser?.destroy()
  subframeBrowser?.destroy()
  privatePopupOpener?.destroy()
  burstPopupOpener?.destroy()
  for (const child of [...popupWindows, ...popupTabs, ...nestedPopupTabs]) if (!child.isDestroyed()) child.destroy()
  lifecycleBrowser?.destroy()
  await Promise.all([httpServer, httpsServer].filter((server): server is NonNullable<typeof server> => server !== null).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  app.quit()
})
