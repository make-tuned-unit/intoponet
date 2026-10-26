import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { KnowledgeCrypto } from '../knowledge/crypto'
import type { Chunk } from './retrieval'

export type DocumentVectors = {
  recordId: string
  /** Model revision the vectors were made with; others are re-embedded. */
  revision: string
  dims: number
  chunks: Chunk[]
  vectors: Float32Array[]
}

const ID = /^[a-z]+-[0-9a-f]{8,64}$/

/**
 * Sealed vector file per absorbed document (same AES-256-GCM key as the
 * knowledge store): [u32 header length][JSON header][Float32 vectors].
 */
export function encodeVectors(value: DocumentVectors): Buffer {
  const header = Buffer.from(JSON.stringify({ v: 1, recordId: value.recordId, revision: value.revision, dims: value.dims, chunks: value.chunks }), 'utf8')
  const body = Buffer.alloc(value.vectors.length * value.dims * 4)
  value.vectors.forEach((vector, row) => {
    if (vector.length !== value.dims) throw new Error('Vector has the wrong dimensions.')
    for (let i = 0; i < value.dims; i += 1) body.writeFloatLE(vector[i]!, (row * value.dims + i) * 4)
  })
  const length = Buffer.alloc(4)
  length.writeUInt32LE(header.length, 0)
  return Buffer.concat([length, header, body])
}

export function decodeVectors(buffer: Buffer): DocumentVectors {
  if (buffer.length < 4) throw new Error('Vector file is truncated.')
  const headerLength = buffer.readUInt32LE(0)
  if (4 + headerLength > buffer.length) throw new Error('Vector header is invalid.')
  const header = JSON.parse(buffer.subarray(4, 4 + headerLength).toString('utf8')) as { v?: number; recordId?: string; revision?: string; dims?: number; chunks?: Chunk[] }
  const dims = header.dims
  if (header.v !== 1 || typeof header.recordId !== 'string' || !ID.test(header.recordId) || typeof header.revision !== 'string' ||
    typeof dims !== 'number' || !Number.isInteger(dims) || dims <= 0 || !Array.isArray(header.chunks)) {
    throw new Error('Vector header is invalid.')
  }
  const body = buffer.subarray(4 + headerLength)
  if (body.length !== header.chunks.length * dims * 4) throw new Error('Vector data does not match its header.')
  const vectors = header.chunks.map((_, row) => {
    const vector = new Float32Array(dims)
    for (let i = 0; i < dims; i += 1) vector[i] = body.readFloatLE((row * dims + i) * 4)
    return vector
  })
  return { recordId: header.recordId, revision: header.revision, dims, chunks: header.chunks, vectors }
}

export class VectorStore {
  private readonly dir: string
  private readonly crypto: KnowledgeCrypto

  constructor(dir: string, crypto: KnowledgeCrypto) {
    this.dir = dir
    this.crypto = crypto
  }

  private path(recordId: string): string {
    if (!ID.test(recordId)) throw new Error('Invalid knowledge id.')
    return join(this.dir, `${recordId}.vec`)
  }

  async put(value: DocumentVectors): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const target = this.path(value.recordId)
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, this.crypto.seal(encodeVectors(value)), { mode: 0o600, flag: 'wx' })
    await rename(temporary, target)
  }

  async get(recordId: string): Promise<DocumentVectors | null> {
    const path = this.path(recordId)
    if (!existsSync(path)) return null
    try {
      return decodeVectors(this.crypto.unseal(await readFile(path)))
    } catch {
      return null
    }
  }

  async ids(): Promise<string[]> {
    if (!existsSync(this.dir)) return []
    return (await readdir(this.dir)).filter((name) => name.endsWith('.vec')).map((name) => name.slice(0, -4)).filter((id) => ID.test(id))
  }

  async remove(recordId: string): Promise<void> {
    await rm(this.path(recordId), { force: true })
  }

  async clear(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true })
  }
}
