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
    await client.query('drop table if exists beacon_reports, beacons, beacon_usage, beacon_nonces, beacon_keys, beacon_moderation_log cascade')
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
    await registry.handle({ method: 'POST', path: '/v1/admin/review', query: new URLSearchParams(), body: { url: target, action: 'restore', reason: 'Figures checked against the source.' }, ip: 'x', authorization: 'Bearer mod-token' })
    read = await get('/v1/beacons?topic=floods')
    expect((read.body as { resources: Array<{ url: string }> }).resources.map((r) => r.url)).toContain(target)
  })

  it('holds new devices to a lower daily limit, then allows the full limit', async () => {
    const me = device()
    const statuses: number[] = []
    for (let i = 0; i <= LIMITS.publishPerNewKeyPerDay; i += 1) statuses.push((await call('POST', '/v1/beacons', me.signed('publish', { url: `https://example.org/p${i}`, title: `P${i}`, topic: 'Bulk' }), { ip: `192.0.2.${i}` })).status)
    expect(statuses.slice(0, -1).every((status) => status === 201)).toBe(true)
    expect(statuses.at(-1)).toBe(429)

    const later = Date.now() + (LIMITS.probationDays + 1) * 86_400_000
    const established = createRegistry({ query: async (sql, params) => (await client.query(sql, params)).rows, secret: 'x'.repeat(32), now: () => later })
    const at = new Date(later).toISOString()
    const after: number[] = []
    for (let i = 0; i <= LIMITS.publishPerKeyPerDay; i += 1) {
      after.push((await established.handle({ method: 'POST', path: '/v1/beacons', query: new URLSearchParams(), body: me.signed('publish', { url: `https://example.org/q${i}`, title: `Q${i}`, topic: 'Bulk' }, at), ip: `192.0.2.${100 + i}` })).status)
    }
    expect(after.slice(0, -1).every((status) => status === 201)).toBe(true)
    expect(after.at(-1)).toBe(429)
  })

  it('requires an edge address when configured, honours the pause switch and the global ceiling', async () => {
    const make = (extra: Record<string, unknown>) => createRegistry({ query: async (sql, params) => (await client.query(sql, params)).rows, secret: 'x'.repeat(32), ...extra })
    const beacon = (n: string) => ({ url: `https://example.org/g${n}`, title: `G${n}`, topic: 'Gate' })
    const post = (r: ReturnType<typeof make>, body: unknown, ip?: string) => r.handle({ method: 'POST', path: '/v1/beacons', query: new URLSearchParams(), body, ...(ip ? { ip } : {}) })

    const edgeOnly = make({ requireNetwork: true })
    expect((await post(edgeOnly, device().signed('publish', beacon('a')))).status).toBe(403)
    expect((await edgeOnly.handle({ method: 'POST', path: '/v1/reports', query: new URLSearchParams(), body: device().signed('report', { url: 'https://example.org/ga', kind: 'spam' }) })).status).toBe(403)
    expect((await post(edgeOnly, device().signed('publish', beacon('b')), '198.51.100.200')).status).toBe(201)

    const paused = make({ publishPaused: true })
    const pausedResult = await post(paused, device().signed('publish', beacon('c')), '198.51.100.201')
    expect(pausedResult.status).toBe(503)
    expect(pausedResult.headers?.['retry-after']).toBeDefined()

    await client.query(`delete from beacon_usage where subject = 'global'`)
    const ceiling = make({ globalPublishPerDay: 2 })
    const results = []
    for (const n of ['d', 'e', 'f']) results.push((await post(ceiling, device().signed('publish', beacon(n)), `198.51.100.${210 + results.length}`)).status)
    expect(results).toEqual([201, 201, 503])
  })

  it('requires a reason for moderation, logs every decision and publishes only aggregate counts', async () => {
    const admin = (method: string, path: string, body: unknown = null) => registry.handle({ method, path, query: new URLSearchParams(), body, authorization: 'Bearer mod-token' })
    const target = 'https://example.org/moderated'
    await call('POST', '/v1/beacons', device().signed('publish', { url: target, title: 'Moderated', topic: 'Mod' }))
    for (let i = 0; i < LIMITS.hideAfterReports; i += 1) await call('POST', '/v1/reports', device().signed('report', { url: target, kind: 'harmful', text: 'private detail' }))
    expect((await admin('POST', '/v1/admin/review', { url: target, action: 'remove' })).status).toBe(400)
    expect((await admin('POST', '/v1/admin/review', { url: target, action: 'remove', reason: 'Doxxing a private person.' })).status).toBe(200)
    expect((await admin('POST', '/v1/admin/review', { url: 'https://example.org/none', action: 'remove', reason: 'Nothing here at all.' })).status).toBe(404)

    const log = (await admin('GET', '/v1/admin/log')).body as { log: Array<{ url: string; action: string; actor: string }> }
    expect(log.log.filter((entry) => entry.url === target).map((entry) => `${entry.actor}:${entry.action}`)).toEqual(['moderator:remove', 'system:auto-hide'])

    const transparency = await get('/v1/transparency')
    expect(transparency.status).toBe(200)
    const text = JSON.stringify(transparency.body)
    expect(text).not.toContain(target)
    expect(text).not.toContain('private detail')
    const month = (transparency.body as { months: Array<{ moderation: Record<string, number>; reports: Record<string, number> }> }).months[0]!
    expect(month.moderation['remove']).toBeGreaterThanOrEqual(1)
    expect(month.reports['harmful']).toBeGreaterThanOrEqual(LIMITS.hideAfterReports)
  })

  it('purges records past retention and keeps live ones', async () => {
    const me = device()
    const made = await call('POST', '/v1/beacons', me.signed('publish', { url: 'https://example.org/old', title: 'Old', topic: 'Retention' }))
    const id = (made.body as { id: string }).id
    await call('POST', `/v1/beacons/${id}/withdraw`, me.signed('withdraw', { id }))
    await client.query(`update beacons set withdrawn_at = now() - interval '40 days' where id = $1`, [id])
    await client.query(`insert into beacon_usage (subject, day, action, count) values ('key:ancient', current_date - 60, 'publish', 1)`)
    const purged = await registry.purge()
    expect(purged.withdrawnBeacons).toBe(1)
    expect(purged.usage).toBeGreaterThanOrEqual(1)
    expect((await client.query('select 1 from beacons where id = $1', [id])).rowCount).toBe(0)
    expect((await client.query(`select 1 from beacons where withdrawn_at is null`)).rowCount).toBeGreaterThan(0)
  })
})
