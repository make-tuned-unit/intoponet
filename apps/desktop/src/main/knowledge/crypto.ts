import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Synchronous seal/unseal used by the knowledge store; injectable for tests. */
export type KnowledgeCrypto = {
  seal(plain: Buffer): Buffer
  unseal(sealed: Buffer): Buffer
}

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
  keychain: { encrypt(value: string): Promise<Buffer>; decrypt(sealed: Buffer): Promise<string>; available(): Promise<boolean> },
): Promise<KnowledgeCrypto> {
  if (!(await keychain.available())) throw new Error('Secure storage is unavailable, so absorbed pages cannot be stored safely.')
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'key.seal')
  if (existsSync(path)) {
    return createAesGcmCrypto(Buffer.from(await keychain.decrypt(await readFile(path)), 'base64'))
  }
  const key = randomBytes(32)
  await writeFile(path, await keychain.encrypt(key.toString('base64')), { mode: 0o600, flag: 'wx' })
  return createAesGcmCrypto(key)
}
