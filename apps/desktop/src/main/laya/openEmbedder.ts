/// <reference types="electron-vite/node" />
import { Worker } from 'node:worker_threads'
import workerPath from './worker?modulePath'
import { EmbeddingPool, type Embedder } from './pool'

/** Open the real embedder: a pool of network-less inference workers. */
export function openLayaEmbedder(modelRoot: string): Promise<Embedder> {
  return EmbeddingPool.open(modelRoot, (workerData) => new Worker(workerPath, { workerData, resourceLimits: { maxOldGenerationSizeMb: 512 } }))
}
