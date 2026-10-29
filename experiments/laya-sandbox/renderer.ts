import { MiniLmEncoder, parseSafetensors, weightsFrom } from '../../apps/desktop/src/main/laya/bert'
import { WordPieceTokenizer } from '../../apps/desktop/src/main/laya/tokenizer'
import type { BoundaryEvidence, LayaJob } from './preload'

declare global {
  interface Window {
    layaSandbox: {
      runtime: { sandboxed: boolean; contextIsolated: boolean }
      getJob(): Promise<LayaJob>
      submitVectors(vectors: number[][], evidence: BoundaryEvidence): Promise<void>
      reportFailure(message: string): Promise<void>
    }
  }
}

const status = document.getElementById('status')!
const timed = async (promise: Promise<unknown>, limitMs = 1500): Promise<'blocked' | 'fulfilled' | 'unexpected-error'> => {
  return await Promise.race([
    promise.then(() => 'fulfilled' as const, () => 'blocked' as const),
    new Promise<'unexpected-error'>((resolve) => setTimeout(() => resolve('unexpected-error'), limitMs)),
  ])
}

async function run(): Promise<void> {
  const job = await window.layaSandbox.getJob()
  const tokenizer = new WordPieceTokenizer(job.vocab)
  const model = new MiniLmEncoder(weightsFrom(parseSafetensors(new Uint8Array(job.modelBytes))))
  const vectors = job.texts.map((text) => Array.from(model.embed(tokenizer.encode(text, job.maxTokens))))

  const fetchOutcome = await timed(fetch(job.canaryHttpUrl, { mode: 'no-cors' }))

  const socketOutcome = await new Promise<BoundaryEvidence['websocketOutcome']>((resolve) => {
    try {
      const socket = new WebSocket(job.canaryWebSocketUrl)
      const timer = setTimeout(() => { socket.close(); resolve('unexpected-error') }, 1500)
      socket.addEventListener('open', () => { clearTimeout(timer); socket.close(); resolve('opened') }, { once: true })
      socket.addEventListener('error', () => { clearTimeout(timer); resolve('blocked') }, { once: true })
    } catch {
      resolve('blocked')
    }
  })

  const imageOutcome = await new Promise<BoundaryEvidence['imageOutcome']>((resolve) => {
    try {
      const image = new Image()
      const timer = setTimeout(() => resolve('unexpected-error'), 1500)
      image.onload = () => { clearTimeout(timer); resolve('loaded') }
      image.onerror = () => { clearTimeout(timer); resolve('blocked') }
      image.src = job.canaryHttpUrl
    } catch {
      resolve('blocked')
    }
  })

  const frameLoadEvent = await new Promise<BoundaryEvidence['frameLoadEvent']>((resolve) => {
    try {
      const frame = document.createElement('iframe')
      const timer = setTimeout(() => { frame.remove(); resolve('timeout') }, 1500)
      frame.onload = () => {
        clearTimeout(timer)
        frame.remove()
        // Browsers can fire load on an empty frame after CSP blocks its target.
        // This records event delivery only; main-process CSP and canary evidence
        // determine whether a request reached the network.
        resolve('fired')
      }
      frame.onerror = () => { clearTimeout(timer); frame.remove(); resolve('error') }
      frame.src = job.canaryHttpUrl
      document.body.append(frame)
    } catch {
      resolve('error')
    }
  })

  let workerOutcome: BoundaryEvidence['workerOutcome'] = 'blocked'
  try {
    const worker = new Worker(URL.createObjectURL(new Blob(['postMessage("unexpected")'])))
    workerOutcome = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve('unexpected-error' as const), 1500)
      worker.onmessage = () => { clearTimeout(timer); resolve('created' as const) }
      worker.onerror = () => { clearTimeout(timer); resolve('blocked' as const) }
    })
    worker.terminate()
  } catch { /* CSP denial may reject construction in this Chromium version. */ }

  let serviceWorkerOutcome: BoundaryEvidence['serviceWorkerOutcome'] = 'blocked'
  if ('serviceWorker' in navigator) {
    const outcome = await timed(navigator.serviceWorker.register(job.canaryHttpUrl))
    serviceWorkerOutcome = outcome === 'fulfilled' ? 'registered' : outcome
  }

  let fileReadOutcome: BoundaryEvidence['fileReadOutcome'] = 'blocked'
  const fileOutcome = await timed(fetch('file:///etc/hosts'))
  fileReadOutcome = fileOutcome === 'fulfilled' ? 'readable' : fileOutcome

  let webRtcStunAttempted = false
  let webRtcIceGatheringState = 'unavailable'
  if (typeof RTCPeerConnection === 'function') {
    webRtcStunAttempted = true
    try {
      const peer = new RTCPeerConnection({ iceServers: [
        { urls: job.canaryStunUrl },
        { urls: job.canaryTurnTcpUrl, username: 'laya-canary', credential: 'local-test-only' },
      ] })
      peer.createDataChannel('laya-canary')
      const gathered = new Promise<void>((resolve) => {
        if (peer.iceGatheringState === 'complete') return resolve()
        peer.addEventListener('icegatheringstatechange', () => {
          if (peer.iceGatheringState === 'complete') resolve()
        })
      })
      await peer.setLocalDescription(await peer.createOffer())
      await Promise.race([gathered, new Promise<void>((resolve) => setTimeout(resolve, 2000))])
      webRtcIceGatheringState = peer.iceGatheringState
      peer.close()
    } catch (error) {
      webRtcIceGatheringState = `error:${error instanceof Error ? error.name : 'unknown'}`
    }
  }

  let navigationOutcome: BoundaryEvidence['navigationOutcome'] = 'blocked'
  const initialUrl = location.href
  try {
    location.assign(job.canaryHttpUrl)
    await new Promise((resolve) => setTimeout(resolve, 250))
    if (location.href !== initialUrl) navigationOutcome = 'navigated'
  } catch {
    navigationOutcome = 'blocked'
  }

  const evidence: BoundaryEvidence = {
    preloadSandboxed: window.layaSandbox.runtime.sandboxed,
    preloadContextIsolated: window.layaSandbox.runtime.contextIsolated,
    rendererHasRequire: typeof (globalThis as { require?: unknown }).require !== 'undefined',
    rendererHasProcess: typeof (globalThis as { process?: unknown }).process !== 'undefined',
    rendererHasFetch: typeof fetch === 'function',
    rendererHasWebRTC: typeof RTCPeerConnection === 'function',
    fetchOutcome: fetchOutcome === 'fulfilled' ? 'fulfilled' : fetchOutcome,
    websocketOutcome: socketOutcome,
    imageOutcome,
    frameLoadEvent,
    workerOutcome,
    serviceWorkerOutcome,
    fileReadOutcome,
    navigationOutcome,
    webRequestHttpOutcome: 'unexpected-error',
    webRequestWebSocketOutcome: 'unexpected-error',
    webRtcStunAttempted,
    webRtcIceGatheringState,
  }

  status.textContent = `Local BERT inference returned ${vectors.length} vectors.`
  await window.layaSandbox.submitVectors(vectors, evidence)
}

void run().catch(async (error: unknown) => {
  status.textContent = 'The sandbox experiment failed.'
  await window.layaSandbox.reportFailure(error instanceof Error ? error.message : 'Unknown renderer failure.')
})
