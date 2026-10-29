import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Synchronous seal/unseal used by the knowledge store; injectable for tests. */
export type KnowledgeCrypto = {
  seal(plain: Buffer): Buffer
  unseal(sealed: Buffer): Buffer
}

export type KeychainDecryption = string | { result: string; shouldReEncrypt?: boolean }

/** AES-256-GCM: 12-byte IV, 16-byte tag, then ciphertext. */
export function createAesGcmCrypto(key: Buffer): KnowledgeCrypto {
  if (key.length !== 32) throw new Error('Knowledge key must be 32 bytes.')
  return {
    seal(plain) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([cipher.update(plain), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), body])
    },
    unseal(sealed) {
      if (sealed.length < 28) throw new Error('Sealed knowledge data is truncated.')
      const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12))
      decipher.setAuthTag(sealed.subarray(12, 28))
      return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()])
    },
  }
}

/**
 * Load (or create once) the knowledge key, itself sealed by the OS keychain
 * (Electron safeStorage). Pass safeStorage's async encrypt/decrypt.
 */
export async function loadKnowledgeCrypto(
  dir: string,
  keychain: { encrypt(value: string): Promise<Buffer>; decrypt(sealed: Buffer): Promise<KeychainDecryption>; available(): Promise<boolean> },
  options: { relatedDataDirs?: string[] } = {},
): Promise<KnowledgeCrypto> {
  if (!(await keychain.available())) throw new Error('Secure storage is unavailable, so absorbed pages cannot be stored safely.')
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'key.seal')
  if (existsSync(path)) {
    const sealed = await readFile(path)
    const decrypted = await keychain.decrypt(sealed)
    const result = typeof decrypted === 'string' ? decrypted : decrypted.result
    const crypto = createAesGcmCrypto(Buffer.from(result, 'base64'))
    if (typeof decrypted !== 'string' && decrypted.shouldReEncrypt) {
      const temporary = `${path}.${randomBytes(12).toString('hex')}.tmp`
      try {
        await writeFile(temporary, await keychain.encrypt(result), { mode: 0o600, flag: 'wx' })
        await rename(temporary, path)
      } catch {
        await rm(temporary, { force: true }).catch(() => undefined)
        throw new Error('The knowledge key opened, but its keychain encryption could not be refreshed. Existing data was left untouched.')
      }
    }
    return crypto
  }

  const relatedDirs = [dir, ...(options.relatedDataDirs ?? [])]
  for (const dataDir of relatedDirs) {
    let entries: string[]
    try {
      entries = await readdir(dataDir)
    } catch (error) {
      if (isMissing(error)) continue
      throw error
    }
    const existingData = entries.some((name) => !(dataDir === dir && name === 'key.seal'))
    if (existingData) {
      throw new Error('Encrypted local records exist but their knowledge key is missing. Restore the original key.seal and OS keychain entry; no replacement key was created.')
    }
  }

  const key = randomBytes(32)
  await writeFile(path, await keychain.encrypt(key.toString('base64')), { mode: 0o600, flag: 'wx' })
  return createAesGcmCrypto(key)
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
