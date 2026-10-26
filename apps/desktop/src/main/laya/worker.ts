/**
 * Laya inference worker. Receives the verified weights (shared, read-only) and
 * vocabulary from the main process — it never touches the file system or the
 * network — and turns texts into unit-length 384-d embeddings.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { installNetworkStubs } from './networkStubs'
import { MiniLmEncoder, parseSafetensors, weightsFrom } from './bert'
import { WordPieceTokenizer } from './tokenizer'

installNetworkStubs()

type Data = { weights: SharedArrayBuffer; vocab: string; maxTokens: number }
const data = workerData as Data
const tokenizer = new WordPieceTokenizer(data.vocab)
const encoder = new MiniLmEncoder(weightsFrom(parseSafetensors(new Uint8Array(data.weights))))

parentPort?.on('message', (message: { id: number; texts: string[] }) => {
  try {
    const vectors = message.texts.map((text) => encoder.embed(tokenizer.encode(text, data.maxTokens)))
    parentPort?.postMessage({ id: message.id, vectors }, vectors.map((vector) => vector.buffer as ArrayBuffer))
  } catch (error) {
    parentPort?.postMessage({ id: message.id, error: error instanceof Error ? error.message : 'Embedding failed.' })
  }
})
