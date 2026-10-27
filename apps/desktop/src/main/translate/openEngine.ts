/// <reference types="electron-vite/node" />
import { Worker } from 'node:worker_threads'
import workerPath from './worker?modulePath'
import { TranslationEngine, type TranslateWorker } from './engine'
import type { TranslateStore } from './store'

/** The real engine: one network-less worker running bergamot-translator. */
export function openTranslationEngine(store: TranslateStore): TranslationEngine {
  return new TranslationEngine(store, () => new Worker(workerPath, { resourceLimits: { maxOldGenerationSizeMb: 256 } }) as unknown as TranslateWorker)
}
