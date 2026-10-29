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

  it('preserves an earlier source-failure status when cached data is read again', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'intoponet-public-field-local-'))
    dirs.push(dir)
    const snapshot = publicFieldSnapshot([localRecord], fixtureTime, true)
    await writeFile(join(dir, 'public-field-snapshot.json'), JSON.stringify(snapshot))
    const field = await localModule(dir)
    globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch

    await field.refreshPublicField(fixtureTime + 1_000)
    const failure = field.publicFieldStatus()
    field.cachedPublicField(fixtureTime + 1_000)

    expect(failure.state).toBe('stale')
    expect(failure.message).toContain('Some independent public sources failed')
    expect(field.publicFieldStatus()).toEqual(failure)
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
