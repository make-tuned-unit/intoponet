import type { CatalogPair } from './catalog'
import type { TranslateStore } from './store'

export type WorkerRequest =
  | { id: number; type: 'init'; wasm: ArrayBuffer }
  | { id: number; type: 'load'; key: string; from: string; to: string; files: Record<string, ArrayBuffer>; gemm: string }
  | { id: number; type: 'unload'; key: string }
  | { id: number; type: 'translate'; keys: string[]; texts: string[]; html: boolean }

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type WorkerResponse = { id: number; ok: true; texts?: string[] } | { id: number; ok: false; error: string }

export type TranslateWorker = {
  postMessage(message: WorkerRequest, transfer?: ArrayBuffer[]): void
  on(event: 'message', listener: (message: WorkerResponse) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  terminate(): Promise<number>
}

/** Distribute a body of work: the engine translates, one chain of models at a time. */
export type Translator = {
  translate(route: CatalogPair[], texts: string[], html: boolean): Promise<string[]>
  close(): Promise<void>
}

const MAX_LOADED_MODELS = 4
/** A batch that takes longer than this is treated as a hung engine. Loading the engine or a model gets twice as long. */
export const ENGINE_CALL_TIMEOUT_MS = 60_000

export const pairKey = (pair: CatalogPair): string => `${pair.from}>${pair.to}@${pair.version}`

/**
 * One translation worker, started on first use and stopped after idling.
 * Models load lazily (verified from disk each time) and the least recently
 * used are unloaded beyond four.
 */
export class TranslationEngine implements Translator {
  private worker: TranslateWorker | null = null
  private starting: Promise<TranslateWorker> | null = null
  private seq = 0
  private readonly pending = new Map<number, { worker: TranslateWorker; resolve: (value: WorkerResponse & { ok: true }) => void; reject: (error: Error) => void }>()
  private loaded: string[] = []
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly store: TranslateStore,
    private readonly createWorker: () => TranslateWorker,
    private readonly idleMs = 5 * 60_000,
    private readonly callTimeoutMs = ENGINE_CALL_TIMEOUT_MS,
  ) {}

  translate(route: CatalogPair[], texts: string[], html: boolean): Promise<string[]> {
    // Serialise: the worker is single-threaded, and model loads must not interleave.
    const run = this.queue.then(() => this.run(route, texts, html))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async run(route: CatalogPair[], texts: string[], html: boolean): Promise<string[]> {
    this.touch()
    const worker = await this.start()
    for (const pair of route) await this.ensureLoaded(worker, pair)
    const response = await this.call(worker, { type: 'translate', keys: route.map(pairKey), texts, html })
    this.touch()
    if (!response.texts || response.texts.length !== texts.length) throw new Error('The engine returned an unexpected result.')
    return response.texts
  }

  private async ensureLoaded(worker: TranslateWorker, pair: CatalogPair): Promise<void> {
    const key = pairKey(pair)
    if (this.loaded.includes(key)) {
      this.loaded = [...this.loaded.filter((item) => item !== key), key]
      return
    }
    const files = await this.store.readPair(pair)
    const model = pair.files.find((file) => file.type === 'model')!
    const gemm = model.name.endsWith('intgemm8.bin') ? 'int8shiftAll' : 'int8shiftAlphaAll'
    const buffers = Object.fromEntries(Object.entries(files)) as Record<string, ArrayBuffer>
    await this.call(worker, { type: 'load', key, from: pair.from, to: pair.to, files: buffers, gemm }, Object.values(buffers))
    this.loaded.push(key)
    while (this.loaded.length > MAX_LOADED_MODELS) {
      const old = this.loaded.shift()!
      await this.call(worker, { type: 'unload', key: old }).catch(() => undefined)
    }
  }

  private start(): Promise<TranslateWorker> {
    if (this.worker) return Promise.resolve(this.worker)
    this.starting ??= (async () => {
      const wasm = await this.store.readEngine()
      const worker = this.createWorker()
      worker.on('message', (message) => this.receive(message))
      worker.on('error', (error) => this.fail(worker, error))
      worker.on('exit', () => this.fail(worker, new Error('The translation engine stopped.')))
      try {
        await this.call(worker, { type: 'init', wasm }, [wasm])
      } catch (error) {
        await worker.terminate().catch(() => 0)
        throw error
      }
      this.worker = worker
      this.loaded = []
      return worker
    })().finally(() => { this.starting = null })
    return this.starting
  }

  private call(worker: TranslateWorker, request: DistributiveOmit<WorkerRequest, 'id'>, transfer: ArrayBuffer[] = []): Promise<WorkerResponse & { ok: true }> {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      // A hung WASM call would stall every later request: stop the worker, fail what it was doing,
      // and let the next request start a fresh one.
      const limit = request.type === 'init' || request.type === 'load' ? this.callTimeoutMs * 2 : this.callTimeoutMs
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return
        this.fail(worker, new Error('The translation engine stopped responding. Try again.'))
        void worker.terminate().catch(() => 0)
      }, limit)
      timer.unref?.()
      this.pending.set(id, {
        worker,
        resolve: (value) => { clearTimeout(timer); resolve(value) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      })
      worker.postMessage({ ...request, id } as WorkerRequest, transfer)
    })
  }

  private receive(message: WorkerResponse): void {
    const waiter = this.pending.get(message.id)
    if (!waiter) return
    this.pending.delete(message.id)
    if (message.ok) waiter.resolve(message)
    else waiter.reject(new Error(message.error))
  }

  private fail(worker: TranslateWorker, error: Error): void {
    for (const [id, waiter] of this.pending) {
      if (waiter.worker !== worker) continue
      this.pending.delete(id)
      waiter.reject(error)
    }
    if (this.worker !== worker) return
    this.worker = null
    this.loaded = []
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => { void this.stop() }, this.idleMs)
    this.idleTimer.unref?.()
  }

  private async stop(): Promise<void> {
    const worker = this.worker
    this.worker = null
    this.loaded = []
    if (worker) await worker.terminate().catch(() => 0)
  }

  /** Forget a removed language's models. */
  async forget(keys: string[]): Promise<void> {
    if (!this.worker) return
    for (const key of keys.filter((key) => this.loaded.includes(key))) {
      await this.call(this.worker, { type: 'unload', key }).catch(() => undefined)
      this.loaded = this.loaded.filter((item) => item !== key)
    }
  }

  async close(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    await this.stop()
  }
}
