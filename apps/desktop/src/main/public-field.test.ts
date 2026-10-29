import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publicFieldSnapshot, type SourceRecord } from '@intoponet/field-snapshot'
import { parseBrowserHostCommand } from '@intoponet/browser-api'

vi.mock('electron', () => ({ app: { getPath: () => process.env['INTOPONET_TEST_USER_DATA'] } }))

const dirs: string[] = []
const originalEndpoint = process.env['INTOPONET_SHARED_PUBLIC_SNAPSHOT_URL']
const originalUserData = process.env['INTOPONET_TEST_USER_DATA']
const originalFetch = globalThis.fetch

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
