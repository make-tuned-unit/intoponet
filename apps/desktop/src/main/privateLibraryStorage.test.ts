import { describe, expect, it, vi } from 'vitest'
import { readSealedPrivateLibrary } from './privateLibraryStorage'

describe('readSealedPrivateLibrary', () => {
  it('reports no library only when the sealed file is absent', async () => {
    const decrypt = vi.fn()
    await expect(
      readSealedPrivateLibrary({
        encryptionAvailable: false,
        fileExists: false,
        decrypt,
      }),
    ).resolves.toEqual({ status: 'ok', payload: null })
    expect(decrypt).not.toHaveBeenCalled()
  })

  it('returns a distinct error and does not decrypt when encryption is unavailable', async () => {
    const decrypt = vi.fn()
    await expect(
      readSealedPrivateLibrary({
        encryptionAvailable: false,
        fileExists: true,
        decrypt,
      }),
    ).resolves.toEqual({ status: 'error', reason: 'encryption-unavailable' })
    expect(decrypt).not.toHaveBeenCalled()
  })

  it('preserves the unreadable sealed file state instead of treating it as empty', async () => {
    const decrypt = vi.fn().mockRejectedValue(new Error('bad ciphertext'))
    await expect(
      readSealedPrivateLibrary({
        encryptionAvailable: true,
        fileExists: true,
        decrypt,
      }),
    ).resolves.toEqual({ status: 'error', reason: 'decrypt-failed' })
    expect(decrypt).toHaveBeenCalledOnce()
  })

  it('returns decrypted data after successfully re-encrypting older ciphertext', async () => {
    const reEncrypt = vi.fn().mockResolvedValue(undefined)
    await expect(
      readSealedPrivateLibrary({
        encryptionAvailable: true,
        fileExists: true,
        decrypt: async () => ({ result: '{"bookmarks":[]}', shouldReEncrypt: true }),
        reEncrypt,
      }),
    ).resolves.toEqual({ status: 'ok', payload: '{"bookmarks":[]}' })
    expect(reEncrypt).toHaveBeenCalledWith('{"bookmarks":[]}')
  })

  it('returns a distinct error when rewriting ciphertext fails', async () => {
    const reEncrypt = vi.fn().mockRejectedValue(new Error('disk full'))
    await expect(
      readSealedPrivateLibrary({
        encryptionAvailable: true,
        fileExists: true,
        decrypt: async () => ({ result: '{"bookmarks":[]}', shouldReEncrypt: true }),
        reEncrypt,
      }),
    ).resolves.toEqual({ status: 'error', reason: 'reencrypt-failed' })
    expect(reEncrypt).toHaveBeenCalledOnce()
  })
})
