import { contextBridge, ipcRenderer } from 'electron'

export type LayaJob = {
  modelBytes: ArrayBuffer
  vocab: string
  maxTokens: number
  texts: string[]
  canaryHttpUrl: string
  canaryWebSocketUrl: string
  canaryStunUrl: string
  canaryTurnTcpUrl: string
}

export type BoundaryEvidence = {
  preloadSandboxed: boolean
  preloadContextIsolated: boolean
  rendererHasRequire: boolean
  rendererHasProcess: boolean
  rendererHasFetch: boolean
  rendererHasWebRTC: boolean
  fetchOutcome: 'blocked' | 'fulfilled' | 'unexpected-error'
  websocketOutcome: 'blocked' | 'opened' | 'unexpected-error'
  imageOutcome: 'blocked' | 'loaded' | 'unexpected-error'
  frameLoadEvent: 'fired' | 'error' | 'timeout'
  workerOutcome: 'blocked' | 'created' | 'unexpected-error'
  serviceWorkerOutcome: 'blocked' | 'registered' | 'unexpected-error'
  fileReadOutcome: 'blocked' | 'readable' | 'unexpected-error'
  navigationOutcome: 'blocked' | 'navigated' | 'unexpected-error'
  webRequestHttpOutcome: 'blocked' | 'opened' | 'unexpected-error'
  webRequestWebSocketOutcome: 'blocked' | 'opened' | 'unexpected-error'
  webRtcStunAttempted: boolean
  webRtcIceGatheringState: string
}

contextBridge.exposeInMainWorld('layaSandbox', {
  runtime: Object.freeze({
    sandboxed: process.sandboxed === true,
    contextIsolated: process.contextIsolated === true,
  }),
  getJob: (): Promise<LayaJob> => ipcRenderer.invoke('laya-sandbox:get-job'),
  submitVectors: (vectors: number[][], evidence: BoundaryEvidence): Promise<void> =>
    ipcRenderer.invoke('laya-sandbox:submit-vectors', vectors, evidence),
  reportFailure: (message: string): Promise<void> => ipcRenderer.invoke('laya-sandbox:failure', message.slice(0, 500)),
})
