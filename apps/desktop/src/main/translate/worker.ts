/**
 * Translation worker. Runs Mozilla's bergamot-translator (Marian NMT compiled
 * to WebAssembly) on verified bytes handed over by the main process. It has no
 * network (stubbed before the engine loads) and never touches the file system.
 *
 * The engine's JavaScript glue (vendor/bergamot-translator.js, MPL-2.0) is not
 * compiled into this file: it ships unchanged as a file of its own, and the
 * main process reads it and hands its text over as workerData (openEngine.ts).
 */
import { parentPort, workerData } from 'node:worker_threads'
import { runInThisContext } from 'node:vm'
import { installNetworkStubs } from '../laya/networkStubs'
import type { WorkerRequest, WorkerResponse } from './engine'

installNetworkStubs()

type Vector<T> = { size(): number; get(index: number): T; push_back(value: T): void; delete(): void }
type Bergamot = {
  AlignedMemory: new (bytes: number, alignment: number) => { getByteArrayView(): Uint8Array; delete(): void }
  AlignedMemoryList: new () => Vector<unknown>
  TranslationModel: new (from: string, to: string, config: string, model: unknown, lex: unknown, vocabs: unknown, quality: null) => { delete(): void }
  BlockingService: new (options: { cacheSize: number }) => {
    translate(model: unknown, messages: unknown, options: unknown): Vector<{ getTranslatedText(): string }>
    translateViaPivoting(first: unknown, second: unknown, messages: unknown, options: unknown): Vector<{ getTranslatedText(): string }>
  }
  VectorString: new () => Vector<string>
  VectorResponseOptions: new () => Vector<{ qualityScores: boolean; alignment: boolean; html: boolean }>
}

const ALIGNMENT: Record<string, number> = { model: 256, lex: 64, vocab: 64, srcvocab: 64, trgvocab: 64 }

const glue = (workerData as { glue?: unknown } | null)?.glue
if (typeof glue !== 'string' || !glue) throw new Error('The translation engine glue was not handed to the worker.')

const loadBergamot = runInThisContext(`${glue}\n;loadBergamot`, { filename: 'bergamot-translator.js' }) as (module: Record<string, unknown>) => Bergamot

let bergamot: Bergamot | null = null
let service: InstanceType<Bergamot['BlockingService']> | null = null
const models = new Map<string, { delete(): void }>()

function init(wasm: ArrayBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const module = loadBergamot({
      INITIAL_MEMORY: 41_943_040,
      wasmBinary: wasm,
      print: () => undefined,
      printErr: () => undefined,
      onAbort: () => reject(new Error('The translation engine failed to start.')),
      onRuntimeInitialized: () => {
        void Promise.resolve().then(() => {
          bergamot = module
          service = new module.BlockingService({ cacheSize: 0 })
          resolve()
        })
      },
    })
  })
}

function config(gemm: string): string {
  const entries: Record<string, string> = {
    'beam-size': '1',
    normalize: '1.0',
    'word-penalty': '0',
    'max-length-break': '128',
    'mini-batch-words': '1024',
    workspace: '128',
    'max-length-factor': '2.0',
    'skip-cost': 'true',
    'cpu-threads': '0',
    quiet: 'true',
    'quiet-translation': 'true',
    'gemm-precision': gemm,
    alignment: 'soft',
  }
  const indent = '            '
  return `\n${Object.entries(entries).map(([key, value]) => `${indent}${key}: ${value}\n`).join('')}${indent}`
}

function load(key: string, from: string, to: string, files: Record<string, ArrayBuffer>, gemm: string): void {
  if (!bergamot) throw new Error('Engine not started.')
  if (models.has(key)) return
  const memory: Record<string, InstanceType<Bergamot['AlignedMemory']>> = {}
  for (const [type, buffer] of Object.entries(files)) {
    const alignment = ALIGNMENT[type]
    if (!alignment) throw new Error(`Unknown model file: ${type}`)
    const aligned = new bergamot.AlignedMemory(buffer.byteLength, alignment)
    aligned.getByteArrayView().set(new Uint8Array(buffer))
    memory[type] = aligned
  }
  const vocabs = new bergamot.AlignedMemoryList()
  if (memory['vocab']) vocabs.push_back(memory['vocab'])
  else if (memory['srcvocab'] && memory['trgvocab']) {
    vocabs.push_back(memory['srcvocab'])
    vocabs.push_back(memory['trgvocab'])
  } else throw new Error('Model vocabulary missing.')
  models.set(key, new bergamot.TranslationModel(from, to, config(gemm), memory['model'], memory['lex'] ?? null, vocabs, null))
}

function translate(keys: string[], texts: string[], html: boolean): string[] {
  if (!bergamot || !service) throw new Error('Engine not started.')
  const chain = keys.map((key) => {
    const model = models.get(key)
    if (!model) throw new Error('Model not loaded.')
    return model
  })
  const messages = new bergamot.VectorString()
  const options = new bergamot.VectorResponseOptions()
  // Empty inputs break the engine; translate only non-empty ones.
  const live: number[] = []
  texts.forEach((text, index) => {
    if (!text.trim()) return
    live.push(index)
    messages.push_back(text)
    options.push_back({ qualityScores: false, alignment: true, html })
  })
  const out = texts.slice()
  try {
    if (!live.length) return out
    const responses = chain.length === 1
      ? service.translate(chain[0], messages, options)
      : service.translateViaPivoting(chain[0], chain[1], messages, options)
    try {
      live.forEach((textIndex, i) => { out[textIndex] = responses.get(i).getTranslatedText() })
    } finally {
      responses.delete()
    }
    return out
  } finally {
    messages.delete()
    options.delete()
  }
}

parentPort?.on('message', (message: WorkerRequest) => {
  const reply = (response: WorkerResponse): void => parentPort?.postMessage(response)
  void (async () => {
    try {
      switch (message.type) {
        case 'init':
          await init(message.wasm)
          reply({ id: message.id, ok: true })
          break
        case 'load':
          load(message.key, message.from, message.to, message.files, message.gemm)
          reply({ id: message.id, ok: true })
          break
        case 'unload':
          models.get(message.key)?.delete()
          models.delete(message.key)
          reply({ id: message.id, ok: true })
          break
        case 'translate':
          reply({ id: message.id, ok: true, texts: translate(message.keys, message.texts, message.html) })
          break
      }
    } catch (error) {
      reply({ id: message.id, ok: false, error: error instanceof Error ? error.message : 'Translation failed.' })
    }
  })()
})
