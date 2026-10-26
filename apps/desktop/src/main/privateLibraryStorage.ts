import type { PrivateLibraryReadResult } from '@intoponet/browser-api'

export type DecryptedPrivateLibrary = {
  result: string
  shouldReEncrypt: boolean
}

export async function readSealedPrivateLibrary(input: {
  encryptionAvailable: boolean
  fileExists: boolean
  decrypt: () => Promise<DecryptedPrivateLibrary>
  reEncrypt?: (payload: string) => Promise<void>
}): Promise<PrivateLibraryReadResult> {
  if (!input.fileExists) return { status: 'ok', payload: null }
  if (!input.encryptionAvailable) {
    return { status: 'error', reason: 'encryption-unavailable' }
  }
  try {
    const decrypted = await input.decrypt()
    if (decrypted.shouldReEncrypt && input.reEncrypt) {
      try {
        await input.reEncrypt(decrypted.result)
      } catch {
        return { status: 'error', reason: 'reencrypt-failed' }
      }
    }
    return { status: 'ok', payload: decrypted.result }
  } catch {
    return { status: 'error', reason: 'decrypt-failed' }
  }
}
