import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publicFieldSnapshot, type SourceRecord } from '@intoponet/field-snapshot'
import { MAX_SHARED_SNAPSHOT_BYTES, MAX_SHARED_SNAPSHOT_FUTURE_SKEW_MS, SHARED_SNAPSHOT_STALE_AFTER_MS, SharedPublicSnapshotClient, type SharedSnapshotManifest } from './shared-public-field'

const evaluatedAt = Date.parse('2026-10-23T12:34:56.000Z')
const source: SourceRecord = {
  id: 'shared-public-record-1',
  kind: 'public-record',
  title: 'Shared public record',
  url: 'https://example.org/records/1',
  licence: 'cc-by',
  attribution: 'Example Archive',
  retrievedAt: new Date(evaluatedAt).toISOString(),
  lat: 40.7,
  lon: -74,
  radiusKm: 10,
  topics: ['civic-memory'],
  weight: 1,
  publishedAt: new Date(evaluatedAt).toISOString(),
  measurement: {
    kind: 'declared-index', value: 1, unit: 'index', sourceId: 'example-index',
    sourceUrl: 'https://example.org/metrics', transformation: 'published test fixture',
  },
}

const snapshot = publicFieldSnapshot([source], evaluatedAt, true)
const artifactBytes = `${JSON.stringify(snapshot)}\n`
const manifest: SharedSnapshotManifest = {
  schema: 'intoponet.shared-public-snapshot-latest.v1',
  snapshotId: snapshot.id,
  sha256: createHash('sha256').update(artifactBytes).digest('hex'),
  evaluationTime: snapshot.createdAt,
  snapshotPath: `/snapshots/${snapshot.id}`,
}

function client(cachePath: string, fetchImpl: typeof fetch, now: () => number) {
  return new SharedPublicSnapshotClient({ endpoint: 'https://snapshots.example', cachePath, fetchImpl, now })
}

function goodFetch(recorded?: Array<{ url: string; init?: RequestInit }>): typeof fetch {
  return (async (input, init) => {
    const url = String(input)
    recorded?.push({ url, ...(init ? { init } : {}) })
    if (url === 'https://snapshots.example/latest') return new Response(`${JSON.stringify(manifest)}\n`, { headers: { 'content-type': 'application/json' } })
    if (url === `https://snapshots.example${manifest.snapshotPath}`) return new Response(artifactBytes, { headers: { 'content-type': 'application/json' } })
    return new Response('', { status: 404 })
  }) as typeof fetch
}

const dirs: string[] = []
async function tempCache(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'intoponet-shared-field-'))
  dirs.push(dir)
  return join(dir, 'shared-cache.json')
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

describe('shared public snapshot client', () => {
  it('gives clients with different clocks the same verified artifact and evaluation time', async () => {
    const one = client(await tempCache(), goodFetch(), () => Date.parse('2026-10-23T12:35:00.000Z'))
    const two = client(await tempCache(), goodFetch(), () => Date.parse('2036-12-31T23:59:00.000Z'))

    const [a, b] = await Promise.all([one.refresh(), two.refresh()])

    expect(a.snapshot).toEqual(b.snapshot)
    expect(a.snapshot?.id).toBe(snapshot.id)
    expect(a.snapshot?.createdAt).toBe(manifest.evaluationTime)
    expect(a.snapshot?.sources[0]?.attribution).toBe('Example Archive')
    expect(a.status.state).toBe('fresh')
    expect(b.status.state).toBe('stale')
  })

  it('ages a successfully fetched artifact to stale without requiring another refresh', async () => {
    let now = evaluatedAt + 1_000
    const service = client(await tempCache(), goodFetch(), () => now)

    expect((await service.refresh()).status.state).toBe('fresh')
    now = evaluatedAt + SHARED_SNAPSHOT_STALE_AFTER_MS + 1

    const status = service.status()

    expect(status.state).toBe('stale')
    expect(status.message).toContain('older than 2 hours')
  })

  it('keeps a verified artifact but reports an error when the device clock moves back beyond tolerance', async () => {
    let now = evaluatedAt + 1_000
    const service = client(await tempCache(), goodFetch(), () => now)
    expect((await service.refresh()).status.state).toBe('fresh')

    now = evaluatedAt - MAX_SHARED_SNAPSHOT_FUTURE_SKEW_MS - 1
    const status = service.status()
    const retained = service.cached()

    expect(status.state).toBe('error')
    expect(status.message).toContain('device clock is more than five minutes behind')
    expect(retained.snapshot).toEqual(snapshot)
    expect(retained.status.state).toBe('error')

    now = evaluatedAt + 1_000
    expect(service.status().state).toBe('fresh')
  })

  it('sends only bounded, credential-free GETs to the two fixed shared endpoints', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const service = client(await tempCache(), goodFetch(calls), () => evaluatedAt + 1_000)
    await service.refresh()

    expect(calls.map((call) => call.url)).toEqual([
      'https://snapshots.example/latest',
      `https://snapshots.example${manifest.snapshotPath}`,
    ])
    for (const call of calls) {
      expect(call.init).toMatchObject({ method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' })
      expect(call.init?.body).toBeUndefined()
      expect(call.init?.signal).toBeDefined()
    }
  })

  it('fails closed when an artifact is tampered after the latest manifest was produced', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input) === 'https://snapshots.example/latest') return new Response(`${JSON.stringify(manifest)}\n`)
      return new Response(artifactBytes.replace('Shared public record', 'Tampered public record'))
    }
    const service = client(await tempCache(), fetchImpl, () => evaluatedAt + 1_000)

    const result = await service.refresh()

    expect(result.snapshot).toBeNull()
    expect(result.status.state).toBe('error')
    expect(result.status.message).toContain('digest does not match')
  })

  it('keeps a compatible verified shared cache when the shared source becomes unavailable', async () => {
    const cachePath = await tempCache()
    const first = client(cachePath, goodFetch(), () => evaluatedAt + 1_000)
    expect((await first.refresh()).snapshot?.id).toBe(snapshot.id)
    const offline: typeof fetch = async () => new Response('', { status: 503 })
    const second = client(cachePath, offline, () => evaluatedAt + 60_000)

    const result = await second.refresh()

    expect(result.snapshot).toEqual(snapshot)
    expect(result.status.state).toBe('error')
    expect(result.status.message).toContain('last verified shared snapshot')
    const saved = JSON.parse(await readFile(cachePath, 'utf8')) as { schema: string }
    expect(saved.schema).toBe('intoponet.shared-public-snapshot-cache.v1')
  })

  it('removes the temporary cache file when the atomic rename fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'intoponet-shared-field-'))
    dirs.push(directory)
    const cachePath = join(directory, 'cache-target')
    await mkdir(cachePath)
    const service = client(cachePath, goodFetch(), () => evaluatedAt + 1_000)

    const result = await service.refresh()

    expect(result.snapshot?.id).toBe(snapshot.id)
    expect(result.status.state).toBe('error')
    expect(result.status.message).toContain('could not be cached')
    expect(await readdir(directory)).toEqual(['cache-target'])
  })

  it('marks retained shared cache stale when its artifact evaluation time is over 2 hours old', async () => {
    const cachePath = await tempCache()
    const first = client(cachePath, goodFetch(), () => evaluatedAt + 1_000)
    await first.refresh()
    const offline: typeof fetch = async () => new Response('', { status: 503 })
    const second = client(cachePath, offline, () => evaluatedAt + 25 * 60 * 60 * 1000)

    const result = await second.refresh()

    expect(result.snapshot?.id).toBe(snapshot.id)
    expect(result.status.state).toBe('stale')
    expect(result.status.message).toContain('which is stale')
  })

  it('rejects a canonical artifact whose evaluation time is unreasonably far in the future', async () => {
    const futureAt = evaluatedAt + 24 * 60 * 60 * 1000
    const futureSnapshot = publicFieldSnapshot([source], futureAt, true)
    const futureBytes = `${JSON.stringify(futureSnapshot)}\n`
    const futureManifest: SharedSnapshotManifest = {
      schema: 'intoponet.shared-public-snapshot-latest.v1',
      snapshotId: futureSnapshot.id,
      sha256: createHash('sha256').update(futureBytes).digest('hex'),
      evaluationTime: futureSnapshot.createdAt,
      snapshotPath: `/snapshots/${futureSnapshot.id}`,
    }
    const fetchImpl: typeof fetch = async (input) => String(input) === 'https://snapshots.example/latest'
      ? new Response(`${JSON.stringify(futureManifest)}\n`)
      : new Response(futureBytes)
    const service = client(await tempCache(), fetchImpl, () => evaluatedAt)

    const result = await service.refresh()

    expect(result.snapshot).toBeNull()
    expect(result.status.state).toBe('error')
    expect(result.status.message).toContain('unreasonably far in the future')
  })

  it('does not reuse a verified cache after the configured shared origin changes', async () => {
    const cachePath = await tempCache()
    await client(cachePath, goodFetch(), () => evaluatedAt + 1_000).refresh()
    const offline: typeof fetch = async () => new Response('', { status: 503 })
    const changedOrigin = new SharedPublicSnapshotClient({
      endpoint: 'https://other-snapshots.example', cachePath, fetchImpl: offline, now: () => evaluatedAt + 2_000,
    })

    const result = await changedOrigin.refresh()

    expect(result.snapshot).toBeNull()
    expect(result.status.state).toBe('error')
  })

  it.each([
    'http://snapshots.example',
    'https://user:password@snapshots.example',
    'https://snapshots.example/deploy',
    'https://snapshots.example?token=secret',
  ])('rejects an unsafe configured URL (%s) without falling back', async (endpoint) => {
    const fetchImpl = vi.fn(async () => new Response(`${JSON.stringify(manifest)}\n`)) as unknown as typeof fetch
    const service = new SharedPublicSnapshotClient({ endpoint, cachePath: await tempCache(), fetchImpl, now: () => evaluatedAt })

    const result = await service.refresh()

    expect(result.snapshot).toBeNull()
    expect(result.status.state).toBe('invalid-configuration')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects an artifact larger than the byte cap before parsing it', async () => {
    const fetchImpl: typeof fetch = async (input) => String(input) === 'https://snapshots.example/latest'
      ? new Response(`${JSON.stringify(manifest)}\n`)
      : new Response(' '.repeat(MAX_SHARED_SNAPSHOT_BYTES + 1), { headers: { 'content-length': String(MAX_SHARED_SNAPSHOT_BYTES + 1) } })
    const service = client(await tempCache(), fetchImpl, () => evaluatedAt + 1_000)

    const result = await service.refresh()

    expect(result.snapshot).toBeNull()
    expect(result.status.state).toBe('error')
    expect(result.status.message).toContain('byte limit')
  })
})
