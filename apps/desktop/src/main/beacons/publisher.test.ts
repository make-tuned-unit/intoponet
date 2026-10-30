import { describe, expect, it } from 'vitest'
import { createPublicKey, verify } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { signingText, type SignedRequest } from '@intoponet/beacon-core'
import { BeaconPublisher, normalizeRegistry } from './publisher'
import { DEFAULT_BEACON_REGISTRY, RETIRED_BEACON_REGISTRIES } from './defaults'
import { writeFileSync } from 'node:fs'

const box = { available: () => true, seal: (text: string) => Buffer.from(`sealed:${text}`), open: (sealed: Buffer) => sealed.toString().replace(/^sealed:/, '') }

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'beacons-'))
  const sent: Array<{ url: string; body: SignedRequest<unknown> }> = []
  const fetchImpl = (async (url: string, init: { body?: string }) => {
    const body = init.body ? JSON.parse(init.body) as SignedRequest<unknown> : null
    if (body) sent.push({ url, body })
    const path = new URL(url).pathname
    const payload = path === '/v1/beacons' && body ? { id: 'b-1', beacon: body.body } : path.endsWith('/withdraw') ? { withdrawn: 'b-1' } : { resources: [] }
    return new Response(JSON.stringify(payload), { status: path === '/v1/beacons' && body ? 201 : 200 })
  }) as unknown as typeof fetch
  const files = { key: join(dir, 'key.sealed'), settings: join(dir, 'settings.json'), published: join(dir, 'published.json') }
  return { dir, sent, files, publisher: new BeaconPublisher({ files, box, fetchImpl }) }
}

describe('beacon publisher', () => {
  it('replaces a saved retired registry with the current default, but keeps other choices', () => {
    const { files } = setup()
    const make = () => new BeaconPublisher({ files, box, fetchImpl: fetch, defaultRegistry: DEFAULT_BEACON_REGISTRY })
    writeFileSync(files.settings, JSON.stringify({ registry: `${RETIRED_BEACON_REGISTRIES[0]}/` }))
    expect(make().registry()).toBe(DEFAULT_BEACON_REGISTRY)
    writeFileSync(files.settings, JSON.stringify({ registry: 'https://mirror.example.org/registry' }))
    expect(make().registry()).toBe('https://mirror.example.org/registry')
    writeFileSync(files.settings, JSON.stringify({ registry: '' }))
    expect(make().registry()).toBe('')
  })

  it('only accepts https registries (or localhost)', () => {
    expect(normalizeRegistry('https://beacons.example.org/')).toBe('https://beacons.example.org')
    expect(normalizeRegistry('http://localhost:8787')).toBe('http://localhost:8787')
    expect(normalizeRegistry('http://beacons.example.org')).toBeNull()
    expect(normalizeRegistry('https://u:p@x.org')).toBeNull()
  })
  it('previews exactly what is sent, and sends nothing without a registry', async () => {
    const { publisher, sent } = setup()
    expect(publisher.preview({ url: 'https://a.test/x?utm_source=y#z', title: 'A', topic: 'T' })).toEqual({ ok: true, payload: { url: 'https://a.test/x', title: 'A', topic: 'T' }, json: JSON.stringify({ url: 'https://a.test/x', title: 'A', topic: 'T' }, null, 2) })
    await expect(publisher.publish({ url: 'https://a.test/x', title: 'A', topic: 'T' })).rejects.toThrow(/No beacon registry/)
    expect(sent).toEqual([])
  })
  it('signs the validated payload with a sealed anonymous key, records it, and withdraws it', async () => {
    const { publisher, sent, files } = setup()
    publisher.setRegistry('http://localhost:8787')
    const record = await publisher.publish({ url: 'https://a.test/x?fbclid=1', title: 'A', topic: 'T', note: 'Good', place: { label: 'Suva', lat: -18.14, lon: 178.44 } })
    expect(record).toMatchObject({ id: 'b-1', url: 'https://a.test/x', title: 'A', registry: 'http://localhost:8787' })
    const request = sent[0]!.body
    expect(request.body).toEqual({ url: 'https://a.test/x', title: 'A', topic: 'T', note: 'Good', place: { label: 'Suva', lat: -18.1, lon: 178.4 } })
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: request.publisherKey }, format: 'jwk' })
    expect(verify(null, Buffer.from(signingText('publish', request.body, request.publisherKey, request.at, request.nonce)), key, Buffer.from(request.signature, 'base64url'))).toBe(true)
    expect(readFileSync(files.key, 'utf8')).toMatch(/^sealed:-----BEGIN PRIVATE KEY-----/)
    expect(publisher.state().published).toHaveLength(1)
    await publisher.withdraw('b-1')
    expect(sent[1]!.url).toBe('http://localhost:8787/v1/beacons/b-1/withdraw')
    expect(sent[1]!.body.publisherKey).toBe(request.publisherKey)
    expect(publisher.state().published).toEqual([])
  })
  it('refuses to sign when on-device encryption is unavailable', async () => {
    const { files } = setup()
    const publisher = new BeaconPublisher({ files, box: { ...box, available: () => false } })
    publisher.setRegistry('https://beacons.example.org')
    await expect(publisher.publish({ url: 'https://a.test/x', title: 'A', topic: 'T' })).rejects.toThrow(/encryption is unavailable/)
  })
})
