import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { signingText, type SignedRequest } from '@intoponet/beacon-core'
import { createRegistry, LIMITS, type RegistryRequest } from './registry.ts'

/** Runs against a real Postgres when BEACON_TEST_DATABASE_URL is set (it is wiped). */
const url = process.env['BEACON_TEST_DATABASE_URL']
const suite = url ? describe : describe.skip

const device = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publisherKey = publicKey.export({ format: 'jwk' }).x as string
  return {
    publisherKey,
    signed: <T>(kind: SignedRequest<T>['kind'], body: T, at = new Date().toISOString()): SignedRequest<T> => {
      const nonce = randomBytes(16).toString('base64url')
      const signature = sign(null, Buffer.from(signingText(kind, body, publisherKey, at, nonce)), privateKey).toString('base64url')
      return { kind, body, publisherKey, at, nonce, signature }
    },
  }
}

suite('beacon registry (Postgres)', () => {
  const client = new pg.Client({ connectionString: url })
  const registry = createRegistry({ query: async (sql, params) => (await client.query(sql, params)).rows, secret: 'x'.repeat(32), adminToken: 'mod-token' })
  const call = (method: string, path: string, body: unknown = null, extra: Partial<RegistryRequest> = {}) =>
    registry.handle({ method, path, query: new URLSearchParams(path.split('?')[1] ?? ''), body, ip: '203.0.113.7', ...extra, ...(path.includes('?') ? {} : {}) }).then((r) => r)
  const get = (path: string) => registry.handle({ method: 'GET', path: path.split('?')[0]!, query: new URLSearchParams(path.split('?')[1] ?? ''), body: null, ip: '203.0.113.7' })

  beforeAll(async () => {
    await client.connect()
    await client.query('drop table if exists beacon_reports, beacons, beacon_usage, beacon_nonces cascade')
    await client.query(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
  })
  afterAll(async () => { await client.end() })

  it('publishes only the approved fields and refuses tampering, replays and duplicates', async () => {
    const me = device()
    const beacon = { url: 'https://reliefweb.int/report/fiji?utm_source=x', title: 'Fiji flood report', topic: 'Floods', place: { label: 'Suva', lat: -18.1416, lon: 178.4419 } }
    const request = me.signed('publish', beacon)
    const ok = await call('POST', '/v1/beacons', request)
    expect(ok.status).toBe(201)
    expect((ok.body as { beacon: unknown }).beacon).toEqual({ url: 'https://reliefweb.int/report/fiji', title: 'Fiji flood report', topic: 'Floods', place: { label: 'Suva', lat: -18.1, lon: 178.4 } })
    expect((await call('POST', '/v1/beacons', request)).status).toBe(409) // replayed nonce
    const tampered = { ...me.signed('publish', beacon), body: { ...beacon, title: 'Changed' } }
    expect((await call('POST', '/v1/beacons', tampered)).status).toBe(401)
    expect((await call('POST', '/v1/beacons', me.signed('publish', beacon))).status).toBe(409) // one per page per device
    expect((await call('POST', '/v1/beacons', me.signed('publish', beacon, '2020-01-01T00:00:00Z'))).status).toBe(400) // stale
    expect((await call('POST', '/v1/beacons', me.signed('publish', { ...beacon, history: ['x'] }))).status).toBe(422)
  })

  it('reads aggregates with diminishing returns, bucketed counts and no keys', async () => {
    for (let i = 0; i < 6; i += 1) await call('POST', '/v1/beacons', device().signed('publish', { url: 'https://reliefweb.int/report/fiji', title: 'Fiji flood report', topic: 'Floods', place: { label: 'Suva', lat: -18.1, lon: 178.4 } }), { ip: `198.51.100.${i}` })
    await call('POST', '/v1/beacons', device().signed('publish', { url: 'https://example.org/one', title: 'Global piece', topic: 'Floods' }))
    const read = await get('/v1/beacons?topic=floods')
    const resources = (read.body as { resources: Array<Record<string, unknown>> }).resources
    expect(resources[0]).toMatchObject({ url: 'https://reliefweb.int/report/fiji', publishers: 'several', prominence: 3 })
    expect(JSON.stringify(read.body)).not.toMatch(/publisher_key|publisherKey/)
    expect(resources[1]).toMatchObject({ url: 'https://example.org/one', publishers: 'a few', prominence: 1 })
  })

  it('lets the same device withdraw, and nobody else', async () => {
    const me = device()
    const made = await call('POST', '/v1/beacons', me.signed('publish', { url: 'https://example.org/mine', title: 'Mine', topic: 'Misc' }))
    const id = (made.body as { id: string }).id
    expect((await call('POST', `/v1/beacons/${id}/withdraw`, device().signed('withdraw', { id }))).status).toBe(404)
    expect((await call('POST', `/v1/beacons/${id}/withdraw`, me.signed('withdraw', { id }))).status).toBe(200)
    const read = await get('/v1/beacons?topic=misc')
    expect((read.body as { resources: unknown[] }).resources).toEqual([])
  })

  it('shows contests publicly and hides after three independent reports until reviewed', async () => {
    const target = 'https://example.org/one'
    await call('POST', '/v1/reports', device().signed('report', { url: target, kind: 'contest', text: 'The flood figures are from 2019, not this year.' }))
    let read = await get('/v1/beacons?topic=floods')
    expect((read.body as { resources: Array<{ url: string; contested: unknown }> }).resources.find((r) => r.url === target)?.contested).toEqual({ count: 1, notes: ['The flood figures are from 2019, not this year.'] })
    for (let i = 0; i < LIMITS.hideAfterReports; i += 1) await call('POST', '/v1/reports', device().signed('report', { url: target, kind: 'spam' }))
    read = await get('/v1/beacons?topic=floods')
    expect((read.body as { resources: Array<{ url: string }> }).resources.map((r) => r.url)).not.toContain(target)
    expect((await call('GET', '/v1/admin/queue')).status).toBe(401)
    const queue = await registry.handle({ method: 'GET', path: '/v1/admin/queue', query: new URLSearchParams(), body: null, ip: 'x', authorization: 'Bearer mod-token' })
    expect(JSON.stringify(queue.body)).toContain(target)
    await registry.handle({ method: 'POST', path: '/v1/admin/review', query: new URLSearchParams(), body: { url: target, action: 'restore' }, ip: 'x', authorization: 'Bearer mod-token' })
    read = await get('/v1/beacons?topic=floods')
    expect((read.body as { resources: Array<{ url: string }> }).resources.map((r) => r.url)).toContain(target)
  })

  it('rate-limits each device per day', async () => {
    const me = device()
    const statuses: number[] = []
    for (let i = 0; i <= LIMITS.publishPerKeyPerDay; i += 1) statuses.push((await call('POST', '/v1/beacons', me.signed('publish', { url: `https://example.org/n${i}`, title: `N${i}`, topic: 'Bulk' }), { ip: `192.0.2.${i}` })).status)
    expect(statuses.at(-1)).toBe(429)
    expect(statuses.slice(0, -1).every((status) => status === 201)).toBe(true)
  })
})
