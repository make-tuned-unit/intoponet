/// <reference types="electron-vite/node" />
import { readFileSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import workerPath from './worker?modulePath'
// Mozilla's glue (MPL-2.0) ships byte for byte as a file of its own, out/main/vendor/bergamot-translator.js
// (electron.vite.config.ts names it), not as text inside Intoponet's code. This is the path to that copy.
import gluePath from './vendor/bergamot-translator.js?asset'
import { TranslationEngine, type TranslateWorker } from './engine'
import type { TranslateStore } from './store'

/** The real engine: one network-less worker running bergamot-translator. The worker never opens a file, so the glue is read here. */
export function openTranslationEngine(store: TranslateStore): TranslationEngine {
  return new TranslationEngine(store, () => new Worker(workerPath, {
    workerData: { glue: readFileSync(gluePath, 'utf8') },
    resourceLimits: { maxOldGenerationSizeMb: 256 },
  }) as unknown as TranslateWorker)
}
