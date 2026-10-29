import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyModelBuffer } from './model'

describe('point-of-use model buffer fingerprints', () => {
  const bytes = Buffer.from('small test model bytes')
  const fingerprint = {
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }

  it('accepts the exact expected buffer without reading a file again', () => {
    expect(verifyModelBuffer(fingerprint, bytes)).toBe(true)
  })

  it('rejects a size mismatch and same-size content tampering', () => {
    expect(verifyModelBuffer(fingerprint, Buffer.from('short'))).toBe(false)
    expect(verifyModelBuffer(fingerprint, Buffer.from('different test model bytes'))).toBe(false)
  })
})
