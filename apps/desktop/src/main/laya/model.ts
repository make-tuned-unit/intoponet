import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The one model Laya uses, pinned to an exact Hugging Face commit and
 * verified by SHA-256. Apache-2.0. Downloaded only after the user enables Laya.
 */
export const LAYA_MODEL = {
  id: 'sentence-transformers/all-MiniLM-L6-v2',
  revision: '1110a243fdf4706b3f48f1d95db1a4f5529b4d41',
  licence: 'Apache-2.0',
  dimensions: 384,
  maxTokens: 256,
  files: [
    { name: 'model.safetensors', bytes: 90_868_376, sha256: '53aa51172d142c89d9012cce15ae4d6cc0ca6895895114379cacb4fab128d9db' },
    { name: 'vocab.txt', bytes: 231_508, sha256: '07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3' },
  ],
} as const

export type ModelFile = (typeof LAYA_MODEL.files)[number]

export const modelSizeBytes = (): number => LAYA_MODEL.files.reduce((sum, file) => sum + file.bytes, 0)

export function modelDir(root: string): string {
  return join(root, 'models', LAYA_MODEL.id.replace('/', '__'), LAYA_MODEL.revision)
}

export function fileUrl(file: ModelFile): string {
  return `https://huggingface.co/${LAYA_MODEL.id}/resolve/${LAYA_MODEL.revision}/${file.name}`
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** True when every file is present with the pinned size and hash. */
export async function verifyModel(root: string, onVerify?: (file: string) => void): Promise<boolean> {
  for (const file of LAYA_MODEL.files) {
    const path = join(modelDir(root), file.name)
    if (!existsSync(path)) return false
    if ((await stat(path)).size !== file.bytes) return false
    onVerify?.(file.name)
    if ((await sha256File(path)) !== file.sha256) return false
  }
  return true
}

export function modelPresent(root: string): boolean {
  return LAYA_MODEL.files.every((file) => existsSync(join(modelDir(root), file.name)))
}

/**
 * Download every pinned file (skipping ones already verified), checking size
 * and SHA-256 before it is moved into place. A mismatch deletes the partial
 * file and throws; nothing unverified is ever loaded.
 */
export async function downloadModel(
  root: string,
  fetchImpl: typeof fetch,
  onProgress: (progress: { file: string; receivedBytes: number; totalBytes: number }) => void,
  onVerify: (file: string) => void,
  files: ReadonlyArray<{ name: string; bytes: number; sha256: string }> = LAYA_MODEL.files,
): Promise<void> {
  const dir = modelDir(root)
  await mkdir(dir, { recursive: true })
  for (const file of files) {
    const target = join(dir, file.name)
    if (existsSync(target) && (await stat(target)).size === file.bytes && (await sha256File(target)) === file.sha256) continue
    const partial = `${target}.part`
    await rm(partial, { force: true })
    const response = await fetchImpl(fileUrl(file as ModelFile), { redirect: 'follow', signal: AbortSignal.timeout(10 * 60_000) })
    if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status}).`)
    const hash = createHash('sha256')
    const chunks: Buffer[] = []
    let received = 0
    const reader = response.body.getReader()
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      const chunk = Buffer.from(next.value)
      received += chunk.byteLength
      if (received > file.bytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error('Model download was larger than expected, so it was discarded.')
      }
      hash.update(chunk)
      chunks.push(chunk)
      onProgress({ file: file.name, receivedBytes: received, totalBytes: file.bytes })
    }
    onVerify(file.name)
    if (received !== file.bytes || hash.digest('hex') !== file.sha256) {
      throw new Error('The downloaded model did not match its pinned fingerprint, so it was discarded.')
    }
    await writeFile(partial, Buffer.concat(chunks), { mode: 0o600 })
    await rename(partial, target)
  }
}

export async function deleteModel(root: string): Promise<void> {
  await rm(join(root, 'models'), { recursive: true, force: true })
}
