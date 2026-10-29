import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateWorker, WorkerLike } from './pool'

const mockFingerprints = vi.hoisted(() => [
  { name: 'model.safetensors', bytes: 10, sha256: '5ce63db4d2593c6138b83552cc6b6d92c09331a780f2fa813383f9d8566ce7dd' },
  { name: 'vocab.txt', bytes: 30, sha256: 'be0e9bfc8cb3bf3139cf05377f5a34b1b8f94878d89cc28d67a464412c10e027' },
])
const fsReadControl = vi.hoisted(() => ({
  holdModelRead: false,
  onModelRead: (): void => undefined,
  releaseModelRead: (): void => undefined,
}))

vi.mock('./model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./model')>()
  return {
    ...actual,
    LAYA_MODEL: { ...actual.LAYA_MODEL, files: mockFingerprints, maxTokens: 32 },
    modelDir: (root: string) => root,
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const readFile = async (...args: Parameters<typeof actual.readFile>) => {
    if (fsReadControl.holdModelRead && String(args[0]).endsWith('model.safetensors')) {
      fsReadControl.holdModelRead = false
      fsReadControl.onModelRead()
      await new Promise<void>((resolve) => { fsReadControl.releaseModelRead = resolve })
    }
    return actual.readFile(...args)
  }
  return { ...actual, readFile: readFile as typeof actual.readFile }
})

const modelBytes = Buffer.from('weights-ok')
const vocabBytes = Buffer.from('[PAD]\n[UNK]\n[CLS]\n[SEP]\nhello\n')

function createMockWorker() {
  let onMessage: ((message: unknown) => void) | undefined
  const worker: WorkerLike = {
    on(event, listener) {
      if (event === 'message') onMessage = listener as (message: unknown) => void
      return worker
    },
    postMessage(message) {
      const request = message as { id: number }
      onMessage?.({ id: request.id, vectors: [new Float32Array([1, 2])] })
    },
    terminate: vi.fn(async () => 0),
  }
  return worker
}

describe('EmbeddingPool model use-time integrity', () => {
  let root: string
  let workers: ReturnType<typeof vi.fn<CreateWorker>>

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'laya-pool-model-'))
    await writeFile(path.join(root, 'model.safetensors'), modelBytes)
    await writeFile(path.join(root, 'vocab.txt'), vocabBytes)
    workers = vi.fn<CreateWorker>()
    fsReadControl.holdModelRead = false
    fsReadControl.onModelRead = () => undefined
    fsReadControl.releaseModelRead = () => undefined
  })

  afterEach(async () => rm(root, { recursive: true, force: true }))

  it('rejects a tampered vocabulary before a pool or worker can use it', async () => {
    const { EmbeddingPool } = await import('./pool')
    await writeFile(path.join(root, 'vocab.txt'), 'tampered vocab')
    const createWorker: CreateWorker = workers
    await expect(EmbeddingPool.open(root, createWorker, { size: 1 })).rejects.toThrow(/vocabulary.*SHA-256/)
    expect(workers).not.toHaveBeenCalled()
  })

  it('revalidates the exact model buffer immediately before creating workers', async () => {
    const { EmbeddingPool } = await import('./pool')
    const createWorker: CreateWorker = workers
    const pool = await EmbeddingPool.open(root, createWorker, { size: 1 })
    // Simulate a local model file replacement after LayaService's earlier verification.
    await writeFile(path.join(root, 'model.safetensors'), 'tampered model')
    await expect(pool.embed(['hello'])).rejects.toThrow(/model.*SHA-256/)
    expect(workers).not.toHaveBeenCalled()
    await pool.close()
  })

  it('shares only verified model bytes and decodes only verified vocabulary', async () => {
    const { EmbeddingPool } = await import('./pool')
    const worker = createMockWorker()
    const createWorker: CreateWorker = workers.mockReturnValue(worker)
    const pool = await EmbeddingPool.open(root, createWorker, { size: 1, idleMs: 60_000 })
    expect(pool.countTokens('hello')).toBe(1)
    const [vector] = await pool.embed(['hello'])
    expect(vector).toEqual(new Float32Array([1, 2]))
    const workerData = workers.mock.calls[0]![0] as { weights: SharedArrayBuffer; vocab: string }
    expect(Buffer.from(workerData.weights)).toEqual(modelBytes)
    expect(workerData.vocab).toBe(vocabBytes.toString('utf8'))
    await pool.close()
  })

  it('cancels a delayed model load on close and allows a later explicit embed to restart', async () => {
    const { EmbeddingPool } = await import('./pool')
    let signalReadStarted: () => void = () => undefined
    const readStarted = new Promise<void>((resolve) => { signalReadStarted = resolve })
    fsReadControl.holdModelRead = true
    fsReadControl.onModelRead = signalReadStarted
    const pool = await EmbeddingPool.open(root, workers, { size: 1 })
    const interruptedEmbed = pool.embed(['hello'])
    await readStarted
    await pool.close()
    fsReadControl.releaseModelRead()
    await expect(interruptedEmbed).rejects.toThrow('Laya stopped.')
    expect(workers).not.toHaveBeenCalled()

    workers.mockImplementation(() => createMockWorker())
    const [vector] = await pool.embed(['hello'])
    expect(vector).toEqual(new Float32Array([1, 2]))
    expect(workers).toHaveBeenCalledTimes(1)
    await pool.close()
  })

  it('reopens after its idle timer closes the pool', async () => {
    const { EmbeddingPool } = await import('./pool')
    const created: WorkerLike[] = []
    workers.mockImplementation(() => {
      const worker = createMockWorker()
      created.push(worker)
      return worker
    })
    const pool = await EmbeddingPool.open(root, workers, { size: 1, idleMs: 5 })
    await pool.embed(['hello'])
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(created[0]!.terminate).toHaveBeenCalledOnce()
    await pool.embed(['hello'])
    expect(workers).toHaveBeenCalledTimes(2)
    await pool.close()
  })
})
