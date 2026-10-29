/**
 * Laya inference worker. Receives the verified weights (shared, read-only) and
 * vocabulary from the main process and turns texts into unit-length embeddings.
 * JavaScript network APIs are stubbed before inference imports are evaluated;
 * worker_threads do not provide OS-level network isolation.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { installNetworkStubs } from './networkStubs'

installNetworkStubs()

type Data = { weights: SharedArrayBuffer; vocab: string; maxTokens: number }
const data = workerData as Data

async function start(): Promise<void> {
  // Install the network guards before evaluating any inference module so a
  // future module-level initializer cannot make a request before isolation.
  const [{ MiniLmEncoder, parseSafetensors, weightsFrom }, { WordPieceTokenizer }] = await Promise.all([
    import('./bert'),
    import('./tokenizer'),
  ])
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
}

void start().catch((error: unknown) => {
  throw error
})
