import { readFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { BrowserWindow, app, session } from 'electron'
import { bindPermissionOwnerLifecycle, kindsFor, originOf, SitePermissionBroker, SitePermissionStore } from '../../apps/desktop/src/main/sitePermissions'
import { rejectCertificateErrorForSession } from '../../apps/desktop/src/main/browserCertificatePolicy'

app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('disable-component-update')
app.commandLine.appendSwitch('no-default-browser-check')

const certificatePath = process.argv.find((argument) => argument.endsWith('localhost-cert.pem'))
const keyPath = process.argv.find((argument) => argument.endsWith('localhost-key.pem'))
const fixturePath = process.argv.find((argument) => argument.endsWith('fixture.html'))
const fixture = fixturePath ? readFileSync(fixturePath) : Buffer.from('')
const permissionRequests: Array<{ id: string; origin: string; kinds: string[] }> = []
const certEvents: Array<{ url: string; error: string; prevented: boolean; callbackAllow: boolean | null }> = []
const permissionCallbackResults: boolean[] = []
const systemAccessCalls: string[] = []
let requestWaiter: ((value: (typeof permissionRequests)[number]) => void) | null = null
const inMemoryStore = new SitePermissionStore(null)
let browser: BrowserWindow | null = null
let certificateBrowser: BrowserWindow | null = null
let lifecycleBrowser: BrowserWindow | null = null
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
  httpServer = createHttpServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(fixture)
  })
  httpsServer = createHttpsServer({ cert: readFileSync(certificatePath), key: readFileSync(keyPath) }, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(fixture)
  })
  const httpPort = await listen(httpServer)
  const httpsPort = await listen(httpsServer)
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
  app.on('certificate-error', (event, webContents, url, error, _certificate, callback) => {
    let allow: boolean | null = null
    const handled = rejectCertificateErrorForSession(event, webContents, browsing, (decision) => {
      allow = decision
      callback(decision)
    })
    if (handled) certEvents.push({ url, error, prevented: event.defaultPrevented, callbackAllow: allow })
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
  const permissionAllowed = firstCaptureResult.ok && afterAllowPermission === 'granted'
  const permissionResetDeniedFutureRequest = afterResetPermission === 'denied' && !afterResetCapture.ok
  const permissionBlocked = !blockedCapture.ok && afterBlockPermission === 'denied' && blockedPermissionCheck === false && blockedDecisionRetained
  const activeCaptureRemainsLiveAfterReset = activeTrackStateBeforeReset.length > 0
    && activeTrackStateBeforeReset.every((state) => state === 'live')
    && activeTrackStateAfterReset.length > 0
    && activeTrackStateAfterReset.every((state) => state === 'live')
  const passed = secureContext && permissionAllowed && permissionResetDeniedFutureRequest && activeCaptureRemainsLiveAfterReset && permissionBlocked && pendingCancelledOnNavigation && pendingCancelledOnDestroy && certDenied && certificateNavigationFailed && !certificateFixtureLoaded

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
    certificate: { events: certEvents, mainFrameFailures: certFailures, denied: certDenied, navigationFailed: certificateNavigationFailed, fixtureContentLoaded: certificateFixtureLoaded },
    conclusions: { permissionAllowed, permissionResetDeniedFutureRequest, activeCaptureRemainsLiveAfterReset, permissionBlocked, pendingCancelledOnNavigation, pendingCancelledOnDestroy, certDenied, certificateNavigationFailed, certificateFixtureNotLoaded: !certificateFixtureLoaded },
    limitations: [
      'The probe uses a temporary Electron BrowserWindow and in-memory permission store, not the packaged Intoponet UI/WebContentsView.',
      'Camera uses Chromium fake-device mode; no camera hardware or macOS camera permission prompt is invoked.',
      'The certificate is a temporary self-signed localhost certificate; this does not test expired, hostname-mismatch, public-CA, redirect, or subframe certificate matrices.',
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
  lifecycleBrowser?.destroy()
  await Promise.all([httpServer, httpsServer].filter((server): server is NonNullable<typeof server> => server !== null).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  app.quit()
})
