import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { createRegistryHttpHandler } from './http.ts'
import type { RegistryRequest, RegistryResponse } from './registry.ts'

describe('standalone registry HTTP boundary', () => {
  const captured: RegistryRequest[] = []
  let server: Server
  let origin = ''

  beforeAll(async () => {
    const registry = {
      async handle(value: RegistryRequest): Promise<RegistryResponse> {
        captured.push(value)
        return { status: 200, body: { ip: value.ip ?? null, body: value.body } }
      },
    }
    server = createServer(createRegistryHttpHandler(registry))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test HTTP server did not bind.')
    origin = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  beforeEach(() => { captured.length = 0 })

  it('uses the direct socket peer and ignores spoofed forwarding headers', async () => {
    const response = await fetch(`${origin}/v1/health`, {
      headers: { 'x-forwarded-for': '198.51.100.42, 203.0.113.17' },
    })
    const body = await response.json() as { ip: string | null }
    expect(response.status).toBe(200)
    expect(body.ip).toMatch(/^(::ffff:)?127\.0\.0\.1$/)
    expect(body.ip).not.toBe('198.51.100.42')
    expect(captured[0]?.ip).toBe(body.ip)
  })

  it('measures incoming JSON in bytes, not Unicode characters', async () => {
    const body = JSON.stringify({ value: 'é'.repeat(8_190) })
    expect(body.length).toBeLessThan(16_384)
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(16_384)
    const response = await fetch(`${origin}/v1/beacons`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    expect(response.status).toBe(413)
    expect(captured).toHaveLength(0)
  })

  it('caps chunked bodies while streaming and still returns 413', async () => {
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const outgoing = httpRequest(`${origin}/v1/beacons`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
      }, (incoming) => {
        const chunks: Buffer[] = []
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
        incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
      })
      outgoing.on('error', reject)
      outgoing.write('{"value":"')
      outgoing.write('a'.repeat(8_000))
      outgoing.write('b'.repeat(8_000))
      outgoing.write('c'.repeat(8_000))
      outgoing.end('"}')
    })
    expect(response.status).toBe(413)
    expect(response.body).toContain('16384 bytes')
    expect(captured).toHaveLength(0)
  })

  it('rejects malformed or invalid UTF-8 JSON before reaching the registry', async () => {
    const malformed = await fetch(`${origin}/v1/beacons`, { method: 'POST', body: '{', headers: { 'content-type': 'application/json' } })
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({ error: 'Body must be JSON.' })

    const invalidUtf8 = await new Promise<number>((resolve, reject) => {
      const outgoing = httpRequest(`${origin}/v1/beacons`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (incoming) => {
        incoming.resume()
        incoming.on('end', () => resolve(incoming.statusCode ?? 0))
      })
      outgoing.on('error', reject)
      outgoing.end(Buffer.from([0x22, 0xff, 0x22]))
    })
    expect(invalidUtf8).toBe(400)
    expect(captured).toHaveLength(0)
  })

  it('accepts a valid body exactly at the byte limit', async () => {
    const body = JSON.stringify({ value: 'a'.repeat(16_372) })
    expect(Buffer.byteLength(body, 'utf8')).toBe(16_384)
    const response = await fetch(`${origin}/v1/beacons`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    expect(response.status).toBe(200)
    expect(captured[0]?.body).toEqual({ value: 'a'.repeat(16_372) })
  })
})
