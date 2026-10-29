import { readFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import { join } from 'node:path'
import { LAYA_MODEL, modelDir, verifyModelBuffer } from './model'
import { WordPieceTokenizer } from './tokenizer'

/** What Laya needs from an embedding backend (the real one is a worker pool). */
export type Embedder = {
  embed(texts: string[]): Promise<Float32Array[]>
  countTokens(text: string): number
  close(): Promise<void>
}

export type WorkerLike = {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  terminate(): Promise<number>
}

export type CreateWorker = (workerData: { weights: SharedArrayBuffer; vocab: string; maxTokens: number }) => WorkerLike

/**
 * A small pool of inference workers sharing one read-only copy of the weights
 * (SharedArrayBuffer). Workers start on first use and stop after idling, so
 * memory is only held while Laya is working.
 */
export class EmbeddingPool implements Embedder {
  private readonly root: string
  private readonly createWorker: CreateWorker
  private readonly size: number
  private readonly idleMs: number
  private tokenizer: WordPieceTokenizer
  private vocab: string
  private workers: WorkerLike[] = []
  private starting: { generation: number; promise: Promise<void> } | null = null
  private generation = 0
  private next = 0
  private seq = 0
  private readonly pending = new Map<number, { resolve: (vectors: Float32Array[]) => void; reject: (error: Error) => void }>()
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  private constructor(root: string, vocab: string, createWorker: CreateWorker, size: number, idleMs: number) {
    this.root = root
    this.vocab = vocab
    this.tokenizer = new WordPieceTokenizer(vocab)
    this.createWorker = createWorker
    this.size = size
    this.idleMs = idleMs
  }

  static async open(root: string, createWorker: CreateWorker, options: { size?: number; idleMs?: number } = {}): Promise<EmbeddingPool> {
    const file = LAYA_MODEL.files.find((candidate) => candidate.name === 'vocab.txt')
    if (!file) throw new Error('Pinned Laya vocabulary fingerprint is missing.')
    const vocabBytes = await readFile(join(modelDir(root), file.name))
    if (!verifyModelBuffer(file, vocabBytes)) throw new Error('The Laya vocabulary failed its pinned size and SHA-256 check.')
    const vocab = vocabBytes.toString('utf8')
    const size = options.size ?? Math.max(1, Math.min(3, cpus().length - 2))
    return new EmbeddingPool(root, vocab, createWorker, size, options.idleMs ?? 120_000)
  }

  countTokens(text: string): number {
    return this.tokenizer.countTokens(text)
  }

  private async start(): Promise<void> {
    for (;;) {
      const generation = this.generation
      if (this.workers.length) return
      const current = this.starting
      if (current) {
        if (current.generation === generation) {
          await current.promise
          if (generation !== this.generation) throw new Error('Laya stopped.')
          return
        }
        await current.promise.catch(() => undefined)
        if (generation !== this.generation) throw new Error('Laya stopped.')
        continue
      }

      const promise = this.startGeneration(generation).finally(() => {
        if (this.starting?.promise === promise) this.starting = null
      })
      this.starting = { generation, promise }
      await promise
      if (generation !== this.generation) throw new Error('Laya stopped.')
      return
    }
  }

  private async startGeneration(generation: number): Promise<void> {
    const file = LAYA_MODEL.files.find((candidate) => candidate.name === 'model.safetensors')
    if (!file) throw new Error('Pinned Laya model fingerprint is missing.')
    const modelBytes = await readFile(join(modelDir(this.root), file.name))
    if (!verifyModelBuffer(file, modelBytes)) throw new Error('The Laya model failed its pinned size and SHA-256 check.')
    if (generation !== this.generation) throw new Error('Laya stopped.')
    const weights = new SharedArrayBuffer(modelBytes.byteLength)
    new Uint8Array(weights).set(modelBytes)
    for (let i = 0; i < this.size; i += 1) {
      const worker = this.createWorker({ weights, vocab: this.vocab, maxTokens: LAYA_MODEL.maxTokens })
      worker.on('message', (message) => this.receive(message))
      worker.on('error', (error) => this.failAll(error))
      worker.on('exit', () => { this.workers = this.workers.filter((item) => item !== worker) })
      this.workers.push(worker)
    }
  }

  private receive(message: unknown): void {
    const value = message as { id?: number; vectors?: Float32Array[]; error?: string }
    if (typeof value.id !== 'number') return
    const job = this.pending.get(value.id)
    if (!job) return
    this.pending.delete(value.id)
    if (value.error || !Array.isArray(value.vectors)) job.reject(new Error(value.error ?? 'Embedding failed.'))
    else job.resolve(value.vectors.map((vector) => (vector instanceof Float32Array ? vector : new Float32Array(vector as ArrayLike<number>))))
    this.armIdle()
  }

  private failAll(error: Error): void {
    for (const job of this.pending.values()) job.reject(error)
    this.pending.clear()
  }

  private armIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.pending.size) return
    this.idleTimer = setTimeout(() => void this.close(), this.idleMs)
    this.idleTimer.unref?.()
  }

  /** Embed texts; work is split across workers, order is preserved. */
  async embed(texts: string[]): Promise<Float32Array[]> {
    if (!texts.length) return []
    const generation = this.generation
    await this.start()
    if (generation !== this.generation || !this.workers.length) throw new Error('Laya stopped.')
    if (this.idleTimer) clearTimeout(this.idleTimer)
    const per = Math.ceil(texts.length / this.workers.length)
    const parts: Promise<Float32Array[]>[] = []
    for (let start = 0; start < texts.length; start += per) {
      const slice = texts.slice(start, start + per)
      const worker = this.workers[this.next++ % this.workers.length]!
      const id = ++this.seq
      parts.push(new Promise<Float32Array[]>((resolve, reject) => {
        this.pending.set(id, { resolve, reject })
        worker.postMessage({ id, texts: slice })
      }))
    }
    return (await Promise.all(parts)).flat()
  }

  async close(): Promise<void> {
    this.generation += 1
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    const workers = this.workers
    this.workers = []
    this.failAll(new Error('Laya stopped.'))
    await Promise.all(workers.map((worker) => worker.terminate().catch(() => 0)))
  }
}
