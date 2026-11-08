import { mkdir, mkdtemp, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publicFieldSnapshot, type SourceRecord } from '@intoponet/field-snapshot'
import { parseBrowserHostCommand } from '@intoponet/browser-api'
import { SHARED_SNAPSHOT_STALE_AFTER_MS } from './shared-public-field'
import { MAX_LOCAL_PUBLIC_FIELD_CACHE_BYTES } from './public-field-cache'

vi.mock('electron', () => ({ app: { getPath: () => process.env['INTOPONET_TEST_USER_DATA'] } }))

const dirs: string[] = []
const originalEndpoint = process.env['INTOPONET_SHARED_PUBLIC_SNAPSHOT_URL']
const originalUserData = process.env['INTOPONET_TEST_USER_DATA']
const originalFetch = globalThis.fetch
const fixtureTime = Date.parse('2026-10-23T12:34:56.000Z')
const localRecord: SourceRecord = {
  id: 'wikitop-local-fixture', kind: 'public-record', title: 'Local cached public record',
  url: 'https://example.org/local', licence: 'cc-by', attribution: 'Example Archive',
  retrievedAt: new Date(fixtureTime).toISOString(), lat: 40.7, lon: -74, radiusKm: 10,
  topics: ['civic-memory'], weight: 1, publishedAt: new Date(fixtureTime).toISOString(),
  measurement: { kind: 'declared-index', value: 1, unit: 'index', sourceId: 'example', sourceUrl: 'https://example.org/metric', transformation: 'test fixture' },
}
const localGroupRecords = [
  localRecord,
  { ...localRecord, id: 'usgs-local-fixture', title: 'Retained quake fixture', url: 'https://example.org/usgs' },
  { ...localRecord, id: 'eonet-local-fixture', title: 'Retained event fixture', url: 'https://example.org/eonet' },
]

async function localModule(dir: string) {
  process.env['INTOPONET_TEST_USER_DATA'] = dir
  delete process.env['INTOPONET_SHARED_PUBLIC_SNAPSHOT_URL']
  return import('./public-field')
}

afterEach(async () => {
  vi.resetModules()
  vi.restoreAllMocks()
  globalThis.fetch = originalFetch
  if (originalEndpoint === undefined) delete process.env['INTOPONET_SHARED_PUBLIC_SNAPSHOT_URL']
  else process.env['INTOPONET_SHARED_PUBLIC_SNAPSHOT_URL'] = originalEndpoint
  if (originalUserData === undefined) delete process.env['INTOPONET_TEST_USER_DATA']
  else process.env['INTOPONET_TEST_USER_DATA'] = originalUserData
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('public field shared-source mode', () => {
  it('parses the read-only public-field status command', () => {
    expect(parseBrowserHostCommand({ type: 'get-public-field-status' })).toEqual({ type: 'get-public-field-status' })
  })

  it('does not poll local sources or fall back to a local aggregate when the configured shared endpoint is unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'intoponet-public-field-configured-'))
    dirs.push(dir)
    process.env['INTOPONET_TEST_USER_DATA'] = dir
    process.env['INTOPONET_SHARED_PUBLIC_SNAPSHOT_URL'] = 'https://snapshots.example'
    const localTime = '2026-10-23T12:34:56.000Z'
    const localSource: SourceRecord = {
      id: 'local-public-record', kind: 'public-record', title: 'Old local public record',
      url: 'https://example.org/local', licence: 'cc-by', attribution: 'Example Archive',
      retrievedAt: localTime, lat: 40.7, lon: -74, radiusKm: 10, topics: ['civic-memory'], weight: 1,
      publishedAt: localTime,
      measurement: { kind: 'declared-index', value: 1, unit: 'index', sourceId: 'fixture', sourceUrl: 'https://example.org/metric', transformation: 'fixture' },
    }
    const oldLocalSnapshot = publicFieldSnapshot([localSource], Date.parse(localTime), true)
    await writeFile(join(dir, 'public-field-snapshot.json'), JSON.stringify(oldLocalSnapshot))
    const requested: string[] = []
    globalThis.fetch = (async (input) => {
      requested.push(String(input))
      return new Response('', { status: 503 })
    }) as typeof fetch
    const publicField = await import('./public-field')

    const snapshot = await publicField.refreshPublicField(Date.parse('2026-10-23T12:35:00.000Z'))

    expect(snapshot).toBeNull()
    expect(oldLocalSnapshot).toBeTruthy()
    expect(requested).toEqual(['https://snapshots.example/latest'])
    expect(publicField.publicFieldStatus()).toMatchObject({ mode: 'shared', state: 'error', evaluationTime: null })
  })
})

describe('local public-field cache status', () => {
  it.each([
    ['corrupt', '{not-json'],
    ['oversized', 'x'.repeat(MAX_LOCAL_PUBLIC_FIELD_CACHE_BYTES + 1)],
  ])('does not load a %s local cache', async (_label, contents) => {
    const dir = await mkdtemp(join(tmpdir(), 'intoponet-public-field-local-'))
    dirs.push(dir)
    await writeFile(join(dir, 'public-field-snapshot.json'), contents)
    const field = await localModule(dir)

    expect(field.cachedPublicField()).toBeNull()
    expect(field.publicFieldStatus()).toMatchObject({ mode: 'local', state: 'error' })
  })

  it('marks an old local disk cache stale while keeping the record available', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'intoponet-public-field-local-'))
    dirs.push(dir)
    const snapshot = publicFieldSnapshot([localRecord], fixtureTime, true)
    await writeFile(join(dir, 'public-field-snapshot.json'), JSON.stringify(snapshot))
    const field = await localModule(dir)

    const cached = field.cachedPublicField(fixtureTime + SHARED_SNAPSHOT_STALE_AFTER_MS + 1)

    expect(cached).not.toBeNull()
    expect(JSON.parse(cached!).id).toBe(snapshot.id)
    expect(field.publicFieldStatus()).toMatchObject({ state: 'stale', evaluationTime: snapshot.createdAt })
    expect(field.publicFieldStatus().message).toContain('older than 2 hours')
  })

  it('shows the age of retained records when source failures regenerate the snapshot time', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'intoponet-public-field-local-'))
    dirs.push(dir)
    const snapshot = publicFieldSnapshot(localGroupRecords, fixtureTime, true)
    await writeFile(join(dir, 'public-field-snapshot.json'), JSON.stringify(snapshot))
    const field = await localModule(dir)
    globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch
    const now = fixtureTime + 4 * 60 * 60 * 1_000

    const refreshed = await field.refreshPublicField(now)
    const status = field.publicFieldStatus()

    expect(refreshed?.createdAt).toBe(new Date(now).toISOString())
    expect(refreshed?.sources.every((record) => record.retrievedAt === new Date(fixtureTime).toISOString())).toBe(true)
    expect(status.sourceHealth).toMatchObject({
      reading: { state: 'failed', lastCheckedAt: new Date(now).toISOString(), latestRecordRetrievedAt: new Date(fixtureTime).toISOString(), recordCount: 1 },
      usgs: { state: 'failed', latestRecordRetrievedAt: new Date(fixtureTime).toISOString(), recordCount: 1 },
      eonet: { state: 'failed', latestRecordRetrievedAt: new Date(fixtureTime).toISOString(), recordCount: 1 },
    })
  })

  it('marks Wikipedia intentionally not due while daily USGS and EONET checks continue', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'intoponet-public-field-local-'))
    dirs.push(dir)
    const field = await localModule(dir)
    const now = Date.parse('2026-10-23T12:34:56.000Z')
    const checkedUrls: string[] = []
    const topPayload = { items: [{ articles: [{ article: 'Kehlsteinhaus', views: 120_000, rank: 1 }] }] }
    const pagePayload = { query: { pages: [{ title: 'Kehlsteinhaus', coordinates: [{ lat: 47.6115, lon: 13.0421, primary: true, globe: 'earth' }] }] } }
    globalThis.fetch = (async (input) => {
      const url = String(input)
      checkedUrls.push(url)
      if (url.startsWith('https://wikimedia.org/api/rest_v1/metrics/pageviews/top/')) return new Response(JSON.stringify(topPayload))
      if (url.startsWith('https://en.wikipedia.org/w/api.php')) return new Response(JSON.stringify(pagePayload))
      if (url.includes('earthquake.usgs.gov')) return new Response(JSON.stringify({ features: [] }))
      if (url.includes('eonet.gsfc.nasa.gov')) return new Response(JSON.stringify({ events: [] }))
      return new Response('', { status: 404 })
    }) as typeof fetch

    const first = await field.refreshPublicField(now)
    const firstReadingCheck = field.publicFieldStatus().sourceHealth?.reading.lastCheckedAt
    expect(first?.sources.some((record) => record.id.startsWith('wikitop-'))).toBe(true)
    expect(firstReadingCheck).toBe(new Date(now).toISOString())
    checkedUrls.length = 0

    const second = await field.refreshPublicField(now + 20 * 60 * 1_000)
    const readingStatus = field.publicFieldStatus().sourceHealth?.reading

    expect(second).not.toBeNull()
    expect(readingStatus).toMatchObject({ state: 'not-due', lastCheckedAt: firstReadingCheck, latestRecordRetrievedAt: new Date(now).toISOString(), recordCount: 1 })
    expect(checkedUrls).toEqual([
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson',
      'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=200',
    ])
  })

  it.each(['http-failure', 'oversized-response'])('retains records and failure status after %s when cached data is read again', async (failureKind) => {
    const dir = await mkdtemp(join(tmpdir(), 'intoponet-public-field-local-'))
    dirs.push(dir)
    const snapshot = publicFieldSnapshot([localRecord], fixtureTime, true)
    await writeFile(join(dir, 'public-field-snapshot.json'), JSON.stringify(snapshot))
    const field = await localModule(dir)
    globalThis.fetch = (async () => failureKind === 'http-failure'
      ? new Response('', { status: 503 })
      : new Response('{}', { headers: { 'content-length': String(6 * 1024 * 1024) } })) as typeof fetch

    const retained = await field.refreshPublicField(fixtureTime + 1_000)
    expect(retained?.sources[0]?.retrievedAt).toBe(localRecord.retrievedAt)
    const failure = field.publicFieldStatus()
    field.cachedPublicField(fixtureTime + 1_000)

    expect(failure.state).toBe('stale')
    expect(failure.message).toContain('Some independent public sources failed')
    expect(field.publicFieldStatus()).toEqual(failure)
  })

  it('refreshes again on waking or coming back online only when a source failed or the field is a refresh old', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'intoponet-public-field-local-'))
    dirs.push(dir)
    const field = await localModule(dir)
    let online = false
    const requested: string[] = []
    globalThis.fetch = (async (input) => {
      const url = String(input)
      requested.push(url)
      if (!online) throw new TypeError('fetch failed')
      if (url.startsWith('https://wikimedia.org/api/rest_v1/metrics/pageviews/top/')) return new Response(JSON.stringify({ items: [{ articles: [{ article: 'Kehlsteinhaus', views: 120_000, rank: 1 }] }] }))
      if (url.startsWith('https://en.wikipedia.org/w/api.php')) return new Response(JSON.stringify({ query: { pages: [{ title: 'Kehlsteinhaus', coordinates: [{ lat: 47.6115, lon: 13.0421, primary: true, globe: 'earth' }] }] } }))
      if (url.includes('earthquake.usgs.gov')) return new Response(JSON.stringify({ features: [] }))
      if (url.includes('eonet.gsfc.nasa.gov')) return new Response(JSON.stringify({ events: [] }))
      return new Response('', { status: 404 })
    }) as typeof fetch
    const statuses: string[] = []
    /** A refresh started after `from` (statuses seen) has finished. */
    const settled = async (from: number): Promise<void> => {
      await vi.waitFor(() => {
        expect(statuses.slice(from)).toContain('fetching')
        expect(statuses.at(-1)).not.toBe('fetching')
      })
    }
    expect(field.retryPublicField()).toBe(false)
    const stop = field.startPublicFieldRefresh(() => undefined, (status) => statuses.push(status.state))
    try {
      // Offline at the first refresh: nothing is fetched again for 20 minutes, unless the Mac wakes or comes back online.
      await settled(0)
      expect(field.publicFieldStatus().state).toBe('error')
      online = true
      requested.length = 0
      const before = statuses.length
      expect(field.retryPublicField()).toBe(true)
      await settled(before)
      expect(requested.some((url) => url.includes('earthquake.usgs.gov'))).toBe(true)
      expect(field.publicFieldStatus().state).not.toBe('error')
      // Everything fresh: waking again fetches nothing, until a refresh interval has gone by (asleep, the tick stood still).
      requested.length = 0
      expect(field.retryPublicField()).toBe(false)
      expect(requested).toEqual([])
      expect(field.retryPublicField(Date.now() + 20 * 60 * 1_000)).toBe(true)
    } finally {
      stop()
    }
    expect(field.retryPublicField(Date.now() + 60 * 60 * 1_000)).toBe(false)
  })

  it('reports an atomic-write failure and removes its temp file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'intoponet-public-field-local-'))
    dirs.push(dir)
    const cachePath = join(dir, 'public-field-snapshot.json')
    await writeFile(cachePath, JSON.stringify(publicFieldSnapshot([localRecord], fixtureTime, true)))
    const field = await localModule(dir)
    expect(field.cachedPublicField()).not.toBeNull()
    await unlink(cachePath)
    await mkdir(cachePath)
    globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch

    const result = await field.refreshPublicField(fixtureTime + 1_000)
    const status = field.publicFieldStatus()
    field.cachedPublicField(fixtureTime + 1_000)

    expect(result).not.toBeNull()
    expect(status).toMatchObject({ state: 'error' })
    expect(status.message).toContain('local cache could not be written')
    expect(field.publicFieldStatus()).toEqual(status)
    expect(await readdir(dir)).toEqual(['public-field-snapshot.json'])
  })
})
