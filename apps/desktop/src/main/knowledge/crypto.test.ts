import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadKnowledgeCrypto } from './crypto'

let dir = ''
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'knowledge-crypto-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const available = async () => true

describe('loadKnowledgeCrypto', () => {
  it('creates a key only for an empty new store', async () => {
    const keychain = {
      available,
      encrypt: vi.fn(async (value: string) => Buffer.from(`wrapped:${value}`)),
      decrypt: vi.fn(async () => { throw new Error('unexpected decrypt') }),
    }
    const crypto = await loadKnowledgeCrypto(dir, keychain)
    expect((await readdir(dir)).sort()).toEqual(['key.seal'])
    const cleartext = Buffer.from('private record')
    expect(crypto.unseal(crypto.seal(cleartext))).toEqual(cleartext)
  })

  it('refuses to mint a new key when encrypted files exist but key.seal is missing', async () => {
    const recordPath = join(dir, 'kn-12345678.bin')
    const originalBytes = randomBytes(64)
    await writeFile(recordPath, originalBytes)
    const keychain = {
      available,
      encrypt: vi.fn(async (value: string) => Buffer.from(`wrapped:${value}`)),
      decrypt: vi.fn(async () => { throw new Error('unexpected decrypt') }),
    }

    await expect(loadKnowledgeCrypto(dir, keychain)).rejects.toThrow(/key is missing/i)
    await expect(readFile(recordPath)).resolves.toEqual(originalBytes)
    await expect(readdir(dir)).resolves.toEqual(['kn-12345678.bin'])
    expect(keychain.encrypt).not.toHaveBeenCalled()
  })

  it('refreshes keychain encryption atomically when safeStorage requests re-encryption', async () => {
    const originalKey = randomBytes(32)
    const oldSealed = Buffer.from('old wrapped key')
    await writeFile(join(dir, 'key.seal'), oldSealed)
    const keychain = {
      available,
      encrypt: vi.fn(async (value: string) => Buffer.from(`new:${value}`)),
      decrypt: vi.fn(async () => ({ result: originalKey.toString('base64'), shouldReEncrypt: true })),
    }

    const crypto = await loadKnowledgeCrypto(dir, keychain)
    expect(await readFile(join(dir, 'key.seal'))).toEqual(Buffer.from(`new:${originalKey.toString('base64')}`))
    const payload = Buffer.from('rotated key can still open records')
    expect(crypto.unseal(crypto.seal(payload))).toEqual(payload)
  })

  it('keeps the original wrapped key and refuses use if rotation rewrite fails', async () => {
    const originalKey = randomBytes(32)
    const oldSealed = Buffer.from('old wrapped key')
    await writeFile(join(dir, 'key.seal'), oldSealed)
    const keychain = {
      available,
      encrypt: vi.fn(async () => { throw new Error('keychain unavailable during rotation') }),
      decrypt: vi.fn(async () => ({ result: originalKey.toString('base64'), shouldReEncrypt: true })),
    }

    await expect(loadKnowledgeCrypto(dir, keychain)).rejects.toThrow(/encryption could not be refreshed/i)
    await expect(readFile(join(dir, 'key.seal'))).resolves.toEqual(oldSealed)
  })
})
