import { createCipheriv, createDecipheriv, pbkdf2Sync } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { hasColumns } from './sqliteCopy'

/**
 * Saved passwords in Chromium's "Login Data". On macOS each password is encrypted with a key
 * derived from the browser's "… Safe Storage" Keychain item: PBKDF2-SHA1 over that secret with
 * the salt "saltysalt", 1003 rounds, 16 bytes; then AES-128-CBC with an IV of 16 spaces, after a
 * "v10" prefix. Decrypted passwords stay in memory only until they are sealed in the vault.
 */

export type EncryptedLogin = { origin: string; username: string; encrypted: Uint8Array }

function checkSchema(db: DatabaseSync): void {
  if (!hasColumns(db, 'logins', ['origin_url', 'username_value', 'password_value', 'blacklisted_by_user'])) throw new Error('This is not a Chromium passwords file.')
}

/** How many sign-ins are saved (sites marked "never save" are not sign-ins). */
export function countLogins(db: DatabaseSync): number {
  checkSchema(db)
  const row = db.prepare('SELECT COUNT(*) AS n FROM logins WHERE blacklisted_by_user = 0').get() as { n?: unknown } | undefined
  return Number(row?.n ?? 0)
}

export function readLogins(db: DatabaseSync, limit = 5_000): EncryptedLogin[] {
  checkSchema(db)
  const rows = db.prepare('SELECT origin_url, username_value, password_value FROM logins WHERE blacklisted_by_user = 0 LIMIT ?').all(limit) as Array<Record<string, unknown>>
  return rows.flatMap((row) => {
    const encrypted = row['password_value']
    if (typeof row['origin_url'] !== 'string' || !(encrypted instanceof Uint8Array)) return []
    return [{ origin: row['origin_url'], username: typeof row['username_value'] === 'string' ? row['username_value'] : '', encrypted }]
  })
}

/** The AES key from the Safe Storage secret. */
export function chromiumKey(secret: string): Buffer {
  return pbkdf2Sync(Buffer.from(secret, 'utf8'), 'saltysalt', 1003, 16, 'sha1')
}

const IV = Buffer.alloc(16, 0x20)

/** The password, '' when none is stored, or null when it cannot be opened with this key. */
export function decryptChromiumPassword(encrypted: Uint8Array, key: Buffer): string | null {
  if (encrypted.length === 0) return ''
  const data = Buffer.from(encrypted)
  if (data.length < 3 + 16 || data.subarray(0, 3).toString('latin1') !== 'v10') return null
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, IV)
    const plain = Buffer.concat([decipher.update(data.subarray(3)), decipher.final()])
    const text = plain.toString('utf8')
    // A wrong key that happens to pass the padding check gives garbage, not text.
    return Buffer.from(text, 'utf8').equals(plain) ? text : null
  } catch {
    return null
  }
}

/** For tests: encrypt as Chromium does. */
export function encryptChromiumPassword(password: string, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-cbc', key, IV)
  return Buffer.concat([Buffer.from('v10', 'latin1'), cipher.update(password, 'utf8'), cipher.final()])
}
