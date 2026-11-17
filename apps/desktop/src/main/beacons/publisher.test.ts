import { describe, expect, it } from 'vitest'
import { createPublicKey, verify } from 'node:crypto'
import { mkdtempSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { signingText, type SignedRequest } from '@intoponet/beacon-core'
import { BeaconPublisher, normalizeRegistry } from './publisher'
import { DEFAULT_BEACON_REGISTRY, RETIRED_BEACON_REGISTRIES } from './defaults'
import { writeFileSync } from 'node:fs'

const box = { available: () => true, seal: (text: string) => Buffer.from(`sealed:${text}`), open: (sealed: Buffer) => sealed.toString().replace(/^sealed:/, '') }

function setup(options: { fetchImpl?: typeof fetch } = {}) {
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
  return { dir, sent, files, publisher: new BeaconPublisher({ files, box, fetchImpl: options.fetchImpl ?? fetchImpl }) }
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
    await publisher.setRegistry('http://localhost:8787')
    const record = await publisher.publish({ url: 'https://a.test/x?fbclid=1', title: 'A', topic: 'T', note: 'Good', place: { label: 'Suva', lat: -18.14, lon: 178.44 } })
    expect(record).toMatchObject({ id: 'b-1', url: 'https://a.test/x', title: 'A', registry: 'http://localhost:8787' })
    const request = sent[0]!.body
    expect(request.body).toEqual({ url: 'https://a.test/x', title: 'A', topic: 'T', note: 'Good', place: { label: 'Suva', lat: -18.1, lon: 178.4 } })
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: request.publisherKey }, format: 'jwk' })
    expect(verify(null, Buffer.from(signingText('publish', request.body, request.publisherKey, request.at, request.nonce)), key, Buffer.from(request.signature, 'base64url'))).toBe(true)
    expect(readFileSync(files.key, 'utf8')).toMatch(/^sealed:-----BEGIN PRIVATE KEY-----/)
    expect((await publisher.state()).published).toHaveLength(1)
    await publisher.withdraw('b-1')
    expect(sent[1]!.url).toBe('http://localhost:8787/v1/beacons/b-1/withdraw')
    expect(sent[1]!.body.publisherKey).toBe(request.publisherKey)
    expect((await publisher.state()).published).toEqual([])
  })
  it('refuses to sign when on-device encryption is unavailable', async () => {
    const { files } = setup()
    const publisher = new BeaconPublisher({ files, box: { ...box, available: () => false } })
    await publisher.setRegistry('https://beacons.example.org')
    await expect(publisher.publish({ url: 'https://a.test/x', title: 'A', topic: 'T' })).rejects.toThrow(/encryption is unavailable/)
  })

  it('never replaces a key the Keychain will not unlock, and tries again later', async () => {
    const { files, sent } = setup()
    const fetchImpl = (async (url: string, init: { body?: string }) => {
      if (init.body) sent.push({ url, body: JSON.parse(init.body) as SignedRequest<unknown> })
      return new Response(JSON.stringify({ id: 'b-1' }), { status: 201 })
    }) as unknown as typeof fetch
    // Publish once with a working Keychain, so a key exists.
    const first = new BeaconPublisher({ files, box, fetchImpl })
    await first.setRegistry('http://localhost:8787')
    await first.publish({ url: 'https://a.test/x', title: 'A', topic: 'T' })
    const sealedKey = readFileSync(files.key)
    const publisherKey = sent[0]!.body.publisherKey

    // Next session: the Keychain refuses (access denied or locked).
    let allow = false
    const denied = { ...box, open: async (sealed: Buffer) => { if (!allow) throw new Error('User canceled'); return box.open(sealed) } }
    const second = new BeaconPublisher({ files, box: denied, fetchImpl })
    await expect(second.withdraw('b-1')).rejects.toThrow(/Keychain did not unlock/)
    await expect(second.publish({ url: 'https://a.test/y', title: 'B', topic: 'T' })).rejects.toThrow(/left as it is/)
    expect(readFileSync(files.key)).toEqual(sealedKey)
    expect(sent).toHaveLength(1)

    // Once access is allowed, the same key withdraws the beacon.
    allow = true
    await second.withdraw('b-1')
    expect(sent[1]!.body.publisherKey).toBe(publisherKey)
    expect(readFileSync(files.key)).toEqual(sealedKey)
  })

  it('makes a key only when there is none, and reports other read errors', async () => {
    const { files } = setup()
    mkdirSync(files.key, { recursive: true })
    const publisher = new BeaconPublisher({ files, box, fetchImpl: (async () => new Response('{"id":"b-1"}', { status: 201 })) as unknown as typeof fetch })
    await publisher.setRegistry('http://localhost:8787')
    await expect(publisher.publish({ url: 'https://a.test/x', title: 'A', topic: 'T' })).rejects.toThrow(/could not be read/)
  })

  it('works with async Keychain calls', async () => {
    const { files, sent } = setup()
    const asyncBox = { available: async () => true, seal: async (text: string) => box.seal(text), open: async (sealed: Buffer) => box.open(sealed) }
    const fetchImpl = (async (url: string, init: { body?: string }) => {
      if (init.body) sent.push({ url, body: JSON.parse(init.body) as SignedRequest<unknown> })
      return new Response(JSON.stringify({ id: 'b-1' }), { status: 201 })
    }) as unknown as typeof fetch
    const publisher = new BeaconPublisher({ files, box: asyncBox, fetchImpl })
    await publisher.setRegistry('http://localhost:8787')
    // Two at once share one new key.
    await Promise.all([
      publisher.publish({ url: 'https://a.test/x', title: 'A', topic: 'T' }),
      publisher.report('https://a.test/x', 'spam'),
    ])
    expect(sent[0]!.body.publisherKey).toBe(sent[1]!.body.publisherKey)
    expect((await publisher.state()).canSign).toBe(true)
  })

  it('tolerates a damaged published list and checks registry answers', async () => {
    const { files } = setup()
    writeFileSync(files.published, JSON.stringify({ not: 'a list' }))
    let answer: unknown = { id: 'b-2' }
    let raw: string | null = null
    const fetchImpl = (async () => new Response(raw ?? JSON.stringify(answer), { status: 200 })) as unknown as typeof fetch
    const publisher = new BeaconPublisher({ files, box, fetchImpl })
    await publisher.setRegistry('http://localhost:8787')
    expect((await publisher.state()).published).toEqual([])
    await publisher.publish({ url: 'https://a.test/x', title: 'A', topic: 'T' })
    expect((await publisher.state()).published.map((item) => item.id)).toEqual(['b-2'])

    answer = { id: { evil: true } }
    await expect(publisher.publish({ url: 'https://a.test/y', title: 'B', topic: 'T' })).rejects.toThrow(/unexpected answer/)

    const good = { url: 'https://a.test/x', title: 'A', topic: 'T', places: [{ label: 'Suva', lat: -18.1, lon: 178.4 }, { label: 'Nowhere', lat: 'x' }], publishers: '1', prominence: 1, firstAt: '2026-01-01T00:00:00.000Z', lastAt: '2026-01-01T00:00:00.000Z', contested: null }
    answer = { resources: [good, { url: 'javascript:alert(1)', title: 'x' }, 'junk'] }
    expect(await publisher.read()).toEqual([{ ...good, places: [{ label: 'Suva', lat: -18.1, lon: 178.4 }] }])
    answer = { resources: 'nope' }
    expect(await publisher.read()).toEqual([])

    // An oversized answer is not read into memory.
    raw = JSON.stringify({ resources: [{ ...good, title: 'x'.repeat(2 * 1024 * 1024) }] })
    expect(await publisher.read()).toEqual([])
  })

  it('finds the beacons near a place without telling the registry which place', async () => {
    const { files } = setup()
    const resource = (url: string, topic: string, lat: number, lon: number) => ({ url, title: url, topic, places: [{ label: 'Somewhere', lat, lon }], publishers: '1', prominence: 1, firstAt: '2026-01-01T00:00:00.000Z', lastAt: '2026-01-01T00:00:00.000Z', contested: null })
    const ottawa = resource('https://a.test/ottawa', 'Rivers', 45.4, -75.7)
    const suva = resource('https://a.test/suva', 'Harbours', -18.1, 178.4)
    const asked: string[] = []
    let fail = false
    let time = 1_000_000
    const fetchImpl = (async (url: string) => {
      asked.push(url)
      if (fail) throw new TypeError('fetch failed')
      return new Response(JSON.stringify({ resources: [ottawa, suva] }), { status: 200 })
    }) as unknown as typeof fetch
    const publisher = new BeaconPublisher({ files, box, fetchImpl, now: () => time })
    await publisher.setRegistry('http://localhost:8787')

    // Canada, then Fiji, then Canada for one topic: one request, and no place or topic in it.
    expect((await publisher.read({ bbox: [39.4, -83.7, 51.4, -67.7] })).map((item) => item.url)).toEqual([ottawa.url])
    expect((await publisher.read({ bbox: [-24.1, 170.4, -12.1, 186.4] })).map((item) => item.url)).toEqual([suva.url])
    expect(await publisher.read({ bbox: [39.4, -83.7, 51.4, -67.7], topic: 'harbours' })).toEqual([])
    expect((await publisher.read({ bbox: [39.4, -83.7, 51.4, -67.7], topic: 'RIVERS' })).map((item) => item.url)).toEqual([ottawa.url])
    expect(asked).toEqual(['http://localhost:8787/v1/beacons?limit=100'])
    for (const url of asked) expect(url).not.toMatch(/bbox|cell|topic|39\.4|83\.7|170\.4/)

    // Two looks at once share the request; the list is asked for again only after ten minutes.
    time += 10 * 60_000 + 1
    await Promise.all([publisher.read({ bbox: [0, 0, 1, 1] }), publisher.read({ bbox: [2, 2, 3, 3] })])
    expect(asked).toHaveLength(2)

    // A failed request is reported and not kept: the next look asks again.
    time += 10 * 60_000 + 1
    fail = true
    await expect(publisher.read({ bbox: [0, 0, 1, 1] })).rejects.toThrow()
    fail = false
    expect((await publisher.read({ bbox: [39.4, -83.7, 51.4, -67.7] })).map((item) => item.url)).toEqual([ottawa.url])
    expect(asked).toHaveLength(4)

    // Another registry is asked afresh.
    await publisher.setRegistry('http://localhost:8788')
    await publisher.read({ bbox: [0, 0, 1, 1] })
    expect(asked.at(-1)).toBe('http://localhost:8788/v1/beacons?limit=100')

    // With the registry address cleared (Settings › Beacons), looking at a place asks nobody, even though a
    // list fetched earlier is still within its ten minutes.
    const before = asked.length
    expect((await publisher.setRegistry('')).registry).toBe('')
    await expect(publisher.read({ bbox: [39.4, -83.7, 51.4, -67.7] })).rejects.toThrow(/No beacon registry/)
    await expect(publisher.read()).rejects.toThrow(/No beacon registry/)
    expect(asked).toHaveLength(before)
  })
})
