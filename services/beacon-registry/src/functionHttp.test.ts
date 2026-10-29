import { describe, expect, it } from 'vitest'
import { MAX_REGISTRY_BODY_BYTES, readLimitedJsonBody } from './functionHttp.ts'

function requestFrom(stream: ReadableStream<Uint8Array>, headers: Record<string, string> = {}): Request {
  return new Request('https://beacons.example/v1/beacons', {
    method: 'POST',
    headers,
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
}

describe('Neon Function streaming body boundary', () => {
  it('accepts a valid body exactly at the byte cap', async () => {
    const text = JSON.stringify({ value: 'a'.repeat(MAX_REGISTRY_BODY_BYTES - 12) })
    expect(Buffer.byteLength(text)).toBe(MAX_REGISTRY_BODY_BYTES)
    const result = await readLimitedJsonBody(new Request('https://beacons.example/v1/beacons', { method: 'POST', body: text }))
    expect(result).toEqual({ ok: true, body: { value: 'a'.repeat(MAX_REGISTRY_BODY_BYTES - 12) } })
  })

  it('counts UTF-8 bytes across streamed chunks rather than JS characters', async () => {
    const encoder = new TextEncoder()
    const chunks = [encoder.encode('{"value":"'), encoder.encode('é'.repeat(8_190)), encoder.encode('"}')]
    expect(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)).toBeGreaterThan(MAX_REGISTRY_BODY_BYTES)
    expect(chunks.map((chunk) => new TextDecoder().decode(chunk)).join('').length).toBeLessThan(MAX_REGISTRY_BODY_BYTES)
    let index = 0
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++]!)
        else controller.close()
      },
      cancel() { cancelled = true },
    })
    const result = await readLimitedJsonBody(requestFrom(stream))
    expect(result).toEqual({ ok: false, status: 413, error: 'Request body exceeds 16384 bytes.' })
    expect(cancelled).toBe(true)
  })

  it('uses Content-Length only as an early rejection, then enforces streamed bytes too', async () => {
    const body = 'x'.repeat(MAX_REGISTRY_BODY_BYTES + 1)
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
    const early = await readLimitedJsonBody(requestFrom(stream, { 'content-length': String(Buffer.byteLength(body)) }))
    expect(early).toMatchObject({ ok: false, status: 413 })
    expect(cancelled).toBe(true)

    const actual = await readLimitedJsonBody(new Request('https://beacons.example/v1/beacons', {
      method: 'POST', body: JSON.stringify({ value: body }),
    }))
    expect(actual).toMatchObject({ ok: false, status: 413 })
  })

  it('rejects malformed JSON and invalid UTF-8', async () => {
    const malformed = await readLimitedJsonBody(new Request('https://beacons.example/v1/beacons', { method: 'POST', body: '{' }))
    expect(malformed).toEqual({ ok: false, status: 400, error: 'Body must be JSON.' })

    const invalidUtf8 = await readLimitedJsonBody(requestFrom(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0x22, 0xff, 0x22]))
        controller.close()
      },
    })))
    expect(invalidUtf8).toEqual({ ok: false, status: 400, error: 'Body must be UTF-8 JSON.' })
  })
})
