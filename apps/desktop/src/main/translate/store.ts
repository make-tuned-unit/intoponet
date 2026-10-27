import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { attachmentUrl, CATALOG, type Catalog, type CatalogFile, type CatalogPair } from './catalog'

type Pinned = { name: string; bytes: number; sha256: string; location: string }

/**
 * Where translation files live: userData/translate/{engine,models}/…, one
 * folder per pinned version. Nothing here is personal data.
 */
export class TranslateStore {
  constructor(
    readonly root: string,
    private readonly fetchImpl: typeof fetch,
    private readonly catalog: Catalog = CATALOG,
  ) {}

  enginePath(): string {
    return join(this.root, 'engine', this.catalog.engine.version, this.catalog.engine.file.name)
  }

  pairDir(pair: CatalogPair): string {
    return join(this.root, 'models', `${pair.from}_${pair.to}`, pair.version)
  }

  /** Fast presence check (sizes only); hashes are checked on every load. */
  async hasEngine(): Promise<boolean> {
    return sizeMatches(this.enginePath(), this.catalog.engine.file.bytes)
  }

  async hasPair(pair: CatalogPair): Promise<boolean> {
    for (const file of pair.files) if (!(await sizeMatches(join(this.pairDir(pair), file.name), file.bytes))) return false
    return true
  }

  async downloadEngine(onBytes: (bytes: number) => void): Promise<void> {
    await this.download(this.catalog.engine.file, this.enginePath(), onBytes)
  }

  async downloadPair(pair: CatalogPair, onBytes: (bytes: number) => void): Promise<void> {
    for (const file of pair.files) await this.download(file, join(this.pairDir(pair), file.name), onBytes)
  }

  async removePair(pair: CatalogPair): Promise<void> {
    await rm(join(this.root, 'models', `${pair.from}_${pair.to}`), { recursive: true, force: true })
  }

  async removeEngine(): Promise<void> {
    await rm(join(this.root, 'engine'), { recursive: true, force: true })
  }

  /** Read the engine binary, refusing it unless it matches the pinned hash. */
  async readEngine(): Promise<ArrayBuffer> {
    return readVerified(this.enginePath(), this.catalog.engine.file)
  }

  async readPair(pair: CatalogPair): Promise<Partial<Record<CatalogFile['type'], ArrayBuffer>>> {
    const out: Partial<Record<CatalogFile['type'], ArrayBuffer>> = {}
    for (const file of pair.files) out[file.type] = await readVerified(join(this.pairDir(pair), file.name), file)
    return out
  }

  /**
   * Stream one pinned file to disk, hashing as it arrives. The partial file is
   * renamed into place only when size and SHA-256 both match; otherwise it is
   * deleted. A file already present with the right hash is skipped.
   */
  private async download(file: Pinned, target: string, onBytes: (bytes: number) => void): Promise<void> {
    if (await sizeMatches(target, file.bytes)) {
      if ((await hashFile(target)) === file.sha256) {
        onBytes(file.bytes)
        return
      }
    }
    await mkdir(join(target, '..'), { recursive: true })
    const partial = `${target}.part`
    await rm(partial, { force: true })
    const response = await this.fetchImpl(attachmentUrl(file.location, this.catalog), {
      redirect: 'follow',
      signal: AbortSignal.timeout(10 * 60_000),
    })
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}).`)
    const hash = createHash('sha256')
    const out = createWriteStream(partial, { mode: 0o600 })
    let received = 0
    try {
      const reader = response.body.getReader()
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        const chunk = Buffer.from(next.value)
        received += chunk.byteLength
        if (received > file.bytes) {
          await reader.cancel().catch(() => undefined)
          throw new Error('A download was larger than expected, so it was discarded.')
        }
        hash.update(chunk)
        if (!out.write(chunk)) await new Promise<void>((resolve) => out.once('drain', () => resolve()))
        onBytes(chunk.byteLength)
      }
      await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())))
      if (received !== file.bytes || hash.digest('hex') !== file.sha256) {
        throw new Error('A downloaded file did not match its pinned fingerprint, so it was discarded.')
      }
      await rename(partial, target)
    } catch (error) {
      out.destroy()
      await rm(partial, { force: true })
      throw error
    }
  }
}

async function sizeMatches(path: string, bytes: number): Promise<boolean> {
  if (!existsSync(path)) return false
  return (await stat(path)).size === bytes
}

async function hashFile(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function readVerified(path: string, file: { bytes: number; sha256: string }): Promise<ArrayBuffer> {
  const data = await readFile(path)
  if (data.byteLength !== file.bytes || createHash('sha256').update(data).digest('hex') !== file.sha256) {
    throw new Error('A translation file on disk did not match its pinned fingerprint. Remove and add the language again.')
  }
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}
