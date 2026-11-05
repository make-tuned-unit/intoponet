import { Worker } from 'node:worker_threads'
import workerPath from './postWorker?modulePath'
import type { PdfInfo } from './postprocess'

/** Runs the metadata and compression pass off the main thread. Returns null if it fails or takes too long. */
export function postprocessOffThread(bytes: Uint8Array, info: PdfInfo, timeoutMs = 60_000): Promise<{ bytes: Uint8Array; pages: number } | null> {
  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(workerPath, { resourceLimits: { maxOldGenerationSizeMb: 2048 } })
    } catch {
      resolve(null)
      return
    }
    let settled = false
    const finish = (value: { bytes: Uint8Array; pages: number } | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    worker.once('message', (message: { bytes?: Uint8Array; pages?: number; error?: string }) =>
      finish(message.bytes && typeof message.pages === 'number' ? { bytes: message.bytes, pages: message.pages } : null))
    worker.once('error', () => finish(null))
    worker.once('exit', () => finish(null))
    const copy = new Uint8Array(bytes)
    worker.postMessage({ bytes: copy, info }, [copy.buffer])
  })
}
