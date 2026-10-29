/// <reference types="electron-vite/node" />
import { Worker } from 'node:worker_threads'
import workerPath from './worker?modulePath'
import { EmbeddingPool, type Embedder } from './pool'

/** Open the worker-backed embedder; worker JS network APIs are denied, without an OS sandbox. */
export function openLayaEmbedder(modelRoot: string): Promise<Embedder> {
  return EmbeddingPool.open(modelRoot, (workerData) => new Worker(workerPath, { workerData, resourceLimits: { maxOldGenerationSizeMb: 512 } }))
}
