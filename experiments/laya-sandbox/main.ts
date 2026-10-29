import { app, BrowserWindow, ipcMain, protocol, session } from 'electron'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { createSocket } from 'node:dgram'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { LAYA_MODEL, modelDir } from '../../apps/desktop/src/main/laya/model'
import type { BoundaryEvidence } from './preload'

const scheme = 'laya-sandbox'
const origin = `${scheme}://app`
const userDataArg = app.commandLine.getSwitchValue('user-data-dir')
if (!userDataArg) throw new Error('The runner must pass an isolated --user-data-dir.')
app.setPath('userData', resolve(userDataArg))
protocol.registerSchemesAsPrivileged([{
  scheme,
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}])

const experimentRoot = resolve(__dirname)
let canaryHttpUrl = ''
let canaryWebSocketUrl = ''
const appFiles = new Map([
  [`${origin}/index.html`, join(experimentRoot, 'index.html')],
  [`${origin}/renderer.js`, join(experimentRoot, 'renderer.js')],
  [`${origin}/broker-probe.html`, join(experimentRoot, 'broker-probe.html')],
])
const blockEvents: Array<{ scheme: string; host: string }> = []
const cspDenials = new Set<string>()
const failures: string[] = []
let windowRef: BrowserWindow | undefined
let canaryHttpHits = 0
let canaryWebSocketHits = 0
let canaryStunDatagrams = 0
let canaryTurnTcpConnections = 0
let modelVerified = false
let brokerProbeResults: { http: string; websocket: string } | null = null
let navigationAttemptsBlocked = 0

const contentSecurityPolicy = "default-src 'none'; script-src 'self'; connect-src 'none'; img-src 'none'; media-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

function badRequest(message: string): never {
  throw new Error(message)
}

function isExperimentFrame(event: Electron.IpcMainInvokeEvent): boolean {
  return Boolean(windowRef && event.sender === windowRef.webContents && event.senderFrame === windowRef.webContents.mainFrame && event.senderFrame.url === `${origin}/index.html`)
}

function recordFailure(message: string): void {
  failures.push(message.slice(0, 500))
  console.error(`Laya sandbox failure: ${message}`)
}

const HTTP_CANARY = createServer((_request, response) => {
  canaryHttpHits += 1
  response.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' })
  response.end('canary')
})
HTTP_CANARY.on('upgrade', (_request, socket) => {
  canaryWebSocketHits += 1
  socket.destroy()
})
const STUN_CANARY = createSocket('udp4')
STUN_CANARY.on('message', () => { canaryStunDatagrams += 1 })
const TURN_TCP_CANARY = createNetServer((socket) => {
  canaryTurnTcpConnections += 1
  socket.on('data', () => socket.destroy())
  socket.setTimeout(2_000, () => socket.destroy())
})

function waitListening(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolvePort((server.address() as { port: number }).port)
    })
  })
}

function waitUdpListening(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    STUN_CANARY.once('error', reject)
    STUN_CANARY.bind(0, '127.0.0.1', () => {
      STUN_CANARY.removeListener('error', reject)
      resolvePort((STUN_CANARY.address() as { port: number }).port)
    })
  })
}

function waitTcpListening(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    TURN_TCP_CANARY.once('error', reject)
    TURN_TCP_CANARY.listen(0, '127.0.0.1', () => {
      TURN_TCP_CANARY.removeListener('error', reject)
      resolvePort((TURN_TCP_CANARY.address() as { port: number }).port)
    })
  })
}

async function verifyPinnedModel(root: string): Promise<{ modelBytes: ArrayBuffer; vocab: string }> {
  const dir = modelDir(root)
  const model = LAYA_MODEL.files.find((file) => file.name === 'model.safetensors')!
  const vocabFile = LAYA_MODEL.files.find((file) => file.name === 'vocab.txt')!
  const modelPath = join(dir, model.name)
  const vocabPath = join(dir, vocabFile.name)
  const [modelFileBytes, vocabFileBytes] = await Promise.all([readFile(modelPath), readFile(vocabPath)])
  const modelBytes = new Uint8Array(modelFileBytes.byteLength)
  modelBytes.set(modelFileBytes)
  const vocab = vocabFileBytes.toString('utf8')
  if (modelBytes.byteLength !== model.bytes || createHash('sha256').update(modelBytes).digest('hex') !== model.sha256) throw new Error('Pinned model bytes do not match the expected size and fingerprint.')
  if (vocabFileBytes.byteLength !== vocabFile.bytes || createHash('sha256').update(vocabFileBytes).digest('hex') !== vocabFile.sha256) throw new Error('Pinned vocabulary bytes do not match the expected size and fingerprint.')
  if (!Buffer.from(vocab, 'utf8').equals(vocabFileBytes)) throw new Error('Pinned vocabulary is not valid UTF-8.')
  modelVerified = true
  return { modelBytes: modelBytes.buffer, vocab }
}

function validateVectors(value: unknown): value is number[][] {
  if (!Array.isArray(value) || value.length !== 2) return false
  return value.every((vector) => Array.isArray(vector) && vector.length === LAYA_MODEL.dimensions && vector.every((n) => typeof n === 'number' && Number.isFinite(n)))
}

function validateEvidence(value: unknown): value is BoundaryEvidence {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const allowed = {
    fetchOutcome: ['blocked', 'fulfilled', 'unexpected-error'],
    websocketOutcome: ['blocked', 'opened', 'unexpected-error'],
    imageOutcome: ['blocked', 'loaded', 'unexpected-error'],
    frameLoadEvent: ['fired', 'error', 'timeout'],
    workerOutcome: ['blocked', 'created', 'unexpected-error'],
    serviceWorkerOutcome: ['blocked', 'registered', 'unexpected-error'],
    fileReadOutcome: ['blocked', 'readable', 'unexpected-error'],
    navigationOutcome: ['blocked', 'navigated', 'unexpected-error'],
    webRequestHttpOutcome: ['blocked', 'opened', 'unexpected-error'],
    webRequestWebSocketOutcome: ['blocked', 'opened', 'unexpected-error'],
  } as const
  for (const [key, values] of Object.entries(allowed)) if (!values.includes(record[key] as never)) return false
  for (const key of ['preloadSandboxed', 'preloadContextIsolated', 'rendererHasRequire', 'rendererHasProcess', 'rendererHasFetch', 'rendererHasWebRTC', 'webRtcStunAttempted']) {
    if (typeof record[key] !== 'boolean') return false
  }
  return typeof record.webRtcIceGatheringState === 'string' && record.webRtcIceGatheringState.length < 80
}

function finish(evidence?: BoundaryEvidence, vectors?: number[][]): void {
  const report = {
    timestamp: new Date().toISOString(),
    experiment: 'laya-sandbox',
    status: failures.length === 0 && evidence && vectors ? 'completed' : 'failed',
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    model: {
      id: LAYA_MODEL.id,
      revision: LAYA_MODEL.revision,
      verifiedFromPinnedHashes: modelVerified,
      files: LAYA_MODEL.files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })),
    },
    renderer: {
      sandboxed: evidence?.preloadSandboxed ?? false,
      contextIsolated: evidence?.preloadContextIsolated ?? false,
      sessionPersistent: windowRef?.webContents.session.isPersistent(),
      userDataDirectoryIsolated: app.getPath('userData') === resolve(userDataArg),
      webRtcIpPolicy: windowRef?.webContents.getWebRTCIPHandlingPolicy(),
      evidence: evidence ?? null,
    },
    vectors: vectors?.map((vector) => ({ dimensions: vector.length, norm: Math.sqrt(vector.reduce((sum, n) => sum + n * n, 0)) })) ?? null,
    networkCanary: {
      webRequestBlockedRequests: blockEvents,
      cspDenials: [...cspDenials],
      navigationAttemptsBlocked,
      httpRequestsObserved: canaryHttpHits,
      websocketUpgradesObserved: canaryWebSocketHits,
      webRtcStunUdpPacketsObserved: canaryStunDatagrams,
      webRtcTurnTcpConnectionsObserved: canaryTurnTcpConnections,
      mainProcessPositiveControl: 'one HTTP GET was deliberately issued by Node fetch before renderer probes',
      brokerProbe: brokerProbeResults,
    },
    conclusions: {
      nodeAndFilesystemBridge: evidence ? (evidence.preloadSandboxed && evidence.preloadContextIsolated && !evidence.rendererHasRequire && !evidence.rendererHasProcess && evidence.fileReadOutcome === 'blocked') : false,
      chromiumNetworkBrokerHttpWebSocket: Boolean(evidence && evidence.webRequestHttpOutcome === 'blocked' && evidence.webRequestWebSocketOutcome === 'blocked' && blockEvents.some((entry) => entry.scheme === 'http:' && entry.host.startsWith('127.0.0.1:')) && blockEvents.some((entry) => entry.scheme === 'ws:' && entry.host.startsWith('127.0.0.1:')) && canaryHttpHits === 1 && canaryWebSocketHits === 0),
      restrictiveCspImageFrameWorker: ['img-src', 'frame-src', 'worker-src', "connect-src 'none'"].every((directive) => [...cspDenials].some((message) => message.includes(directive))),
      topLevelNavigationDenied: navigationAttemptsBlocked > 0 && evidence?.navigationOutcome === 'blocked',
      webRtcTransportDenied: false,
      completeEgressDenialProven: false,
      strictIsolationAccepted: false,
      strictIsolationBlocker: canaryTurnTcpConnections > 0
        ? 'RTCPeerConnection exists and created a TCP connection to the loopback TURN canary under disable_non_proxied_udp.'
        : 'RTCPeerConnection remains available and Electron session controls did not establish an all-transport deny; no OS network deny was applied.',
    },
    failures,
  }
  console.log(`Laya sandbox experiment report:\n${JSON.stringify(report, null, 2)}`)
  setTimeout(() => app.quit(), 50)
}

async function main(): Promise<void> {
  await app.whenReady()
  const httpPort = await waitListening(HTTP_CANARY)
  const stunPort = await waitUdpListening()
  const turnPort = await waitTcpListening()

  // Positive control proves the loopback canary is listening before the renderer guard is exercised.
  const positive = await fetch(`http://127.0.0.1:${httpPort}/positive-control`)
  if (!positive.ok || canaryHttpHits !== 1) throw new Error('HTTP canary positive control failed.')
  canaryHttpUrl = `http://127.0.0.1:${httpPort}/renderer-http`
  canaryWebSocketUrl = `ws://127.0.0.1:${httpPort}/renderer-websocket`

  const partition = `laya-sandbox-experiment-${Date.now()}`
  const layaSession = session.fromPartition(partition, { cache: false })
  layaSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  layaSession.setPermissionCheckHandler(() => false)
  layaSession.setDevicePermissionHandler(() => false)
  layaSession.webRequest.onBeforeRequest((details, callback) => {
    if (appFiles.has(details.url)) return callback({ cancel: false })
    try {
      const parsed = new URL(details.url)
      blockEvents.push({ scheme: parsed.protocol, host: parsed.host })
    } catch {
      blockEvents.push({ scheme: 'invalid:', host: '' })
    }
    callback({ cancel: true })
  })

  await layaSession.protocol.handle(scheme, async (request) => {
    const target = appFiles.get(request.url)
    if (!target) return new Response('Not found', { status: 404 })
    const bytes = await readFile(target)
    const mime = target.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8'
    const csp = request.url === `${origin}/broker-probe.html`
      ? `default-src 'none'; script-src 'self'; connect-src http://127.0.0.1:${httpPort} ws://127.0.0.1:${httpPort}; img-src 'none'; media-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
      : contentSecurityPolicy
    return new Response(bytes, { headers: { 'content-type': mime, 'content-security-policy': csp, 'x-content-type-options': 'nosniff' } })
  })

  const modelRootArg = process.argv.find((arg) => arg.startsWith('--model-root='))?.slice('--model-root='.length)
  if (!modelRootArg || !isAbsolute(modelRootArg)) throw new Error('Pass an explicit absolute --model-root=/path for the pinned local model.')
  const modelRoot = resolve(modelRootArg)
  const model = await verifyPinnedModel(modelRoot)

  const preloadPath = join(experimentRoot, 'preload.cjs')
  windowRef = new BrowserWindow({
    show: false,
    width: 640,
    height: 480,
    webPreferences: {
      preload: preloadPath,
      session: layaSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  })
  windowRef.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
  windowRef.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  windowRef.webContents.on('will-navigate', (event, url) => {
    if (url !== `${origin}/index.html`) {
      navigationAttemptsBlocked += 1
      event.preventDefault()
    }
  })
  windowRef.webContents.on('will-attach-webview', (event) => event.preventDefault())
  windowRef.webContents.on('render-process-gone', (_event, details) => recordFailure(`Renderer exited: ${details.reason}`))
  windowRef.webContents.on('console-message', (event) => {
    const { message, level } = event as unknown as { message: string; level: string }
    if (message.includes('violates the following Content Security Policy directive')) cspDenials.add(message.slice(0, 300))
    if (level === 'error' || level === 'warning') console.error(`Renderer console: ${message}`)
  })

  ipcMain.handle('laya-sandbox:get-job', (event) => {
    if (!isExperimentFrame(event)) return badRequest('Unexpected renderer requested the model job.')
    return {
      ...model,
      maxTokens: LAYA_MODEL.maxTokens,
      texts: ['This sentence stays on this device.', 'Local inference has no network endpoint.'],
      canaryHttpUrl,
      canaryWebSocketUrl,
      canaryStunUrl: `stun:127.0.0.1:${stunPort}`,
      canaryTurnTcpUrl: `turn:127.0.0.1:${turnPort}?transport=tcp`,
    }
  })
  ipcMain.handle('laya-sandbox:submit-vectors', (event, vectors: unknown, evidence: unknown) => {
    if (!isExperimentFrame(event)) return badRequest('Unexpected renderer submitted results.')
    if (!validateVectors(vectors)) return badRequest('Renderer returned an invalid vector shape.')
    if (!validateEvidence(evidence)) return badRequest('Renderer returned malformed boundary evidence.')
    if (!evidence.preloadSandboxed || !evidence.preloadContextIsolated) recordFailure('Preload did not confirm sandbox and context isolation.')
    void runWebRequestProbe(layaSession, httpPort).then((results) => {
      brokerProbeResults = results
      const updatedEvidence = { ...evidence, webRequestHttpOutcome: results.http as BoundaryEvidence['webRequestHttpOutcome'], webRequestWebSocketOutcome: results.websocket as BoundaryEvidence['webRequestWebSocketOutcome'] }
      finish(updatedEvidence, vectors)
    }).catch((error: unknown) => {
      recordFailure(`WebRequest probe failed: ${error instanceof Error ? error.message : 'unknown'}`)
      finish(evidence, vectors)
    })
  })
  ipcMain.handle('laya-sandbox:failure', (event, message: unknown) => {
    if (!isExperimentFrame(event)) return badRequest('Unexpected renderer reported failure.')
    recordFailure(typeof message === 'string' ? message : 'Renderer reported an invalid failure.')
    finish()
  })

  windowRef.webContents.on('did-fail-load', (_event, code, description, url) => {
    // A navigation probe is expected to fail after will-navigate cancels it.
    // Only a failure of the fixed app document is a startup failure.
    if (url.startsWith(`${origin}/`)) {
      recordFailure(`Initial load failed (${code}): ${description} ${url}`)
      finish()
    }
  })
  await windowRef.loadURL(`${origin}/index.html`)
}

async function runWebRequestProbe(layaSession: Electron.Session, httpPort: number): Promise<{ http: string; websocket: string }> {
  const probeWindow = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    webPreferences: { session: layaSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, webSecurity: true },
  })
  try {
    await probeWindow.loadURL(`${origin}/broker-probe.html`)
    return await probeWindow.webContents.executeJavaScript(`(async () => {
      const http = await Promise.race([
        fetch(${JSON.stringify(canaryHttpUrl)}).then(() => 'opened', () => 'blocked'),
        new Promise((resolve) => setTimeout(() => resolve('unexpected-error'), 1500))
      ]);
      const websocket = await new Promise((resolve) => {
        try {
          const socket = new WebSocket(${JSON.stringify(canaryWebSocketUrl)});
          const timer = setTimeout(() => { socket.close(); resolve('unexpected-error'); }, 1500);
          socket.addEventListener('open', () => { clearTimeout(timer); socket.close(); resolve('opened'); }, { once: true });
          socket.addEventListener('error', () => { clearTimeout(timer); resolve('blocked'); }, { once: true });
        } catch { resolve('blocked'); }
      });
      return { http, websocket };
    })()`)
  } finally {
    probeWindow.destroy()
  }
}

void main().catch((error: unknown) => {
  recordFailure(error instanceof Error ? error.stack ?? error.message : 'Unknown main-process error.')
  finish()
})

app.on('before-quit', () => {
  HTTP_CANARY.close()
  STUN_CANARY.close()
  TURN_TCP_CANARY.close()
})
