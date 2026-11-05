import { parentPort } from 'node:worker_threads'
import { postprocessPdf, type PdfInfo } from './postprocess'

/** One PDF per worker: it is started for a save and ended afterwards (pdf-lib keeps memory otherwise). */
parentPort?.once('message', (message: { bytes: Uint8Array; info: PdfInfo }) => {
  postprocessPdf(message.bytes, message.info).then(
    (result) => parentPort?.postMessage({ bytes: result.bytes, pages: result.pages }, [result.bytes.buffer as ArrayBuffer]),
    (error: unknown) => parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) }),
  )
})
