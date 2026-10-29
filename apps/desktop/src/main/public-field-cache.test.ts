import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { publicFieldSnapshot, type SourceRecord } from '@intoponet/field-snapshot'
import { MAX_LOCAL_PUBLIC_FIELD_CACHE_BYTES, readLocalPublicFieldCache, writeLocalPublicFieldCache } from './public-field-cache'

const now = Date.parse('2026-10-23T12:34:56.000Z')
const record: SourceRecord = {
  id: 'wikitop-example', kind: 'public-record', title: 'Example public record',
  url: 'https://example.org/record', licence: 'cc-by', attribution: 'Example Archive',
  retrievedAt: new Date(now).toISOString(), lat: 40.7, lon: -74, radiusKm: 10,
  topics: ['civic-memory'], weight: 1, publishedAt: new Date(now).toISOString(),
  measurement: { kind: 'declared-index', value: 1, unit: 'index', sourceId: 'example', sourceUrl: 'https://example.org/metric', transformation: 'test fixture' },
}
const snapshot = publicFieldSnapshot([record], now, true)

const dirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'intoponet-local-public-field-cache-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

describe('local public-field cache', () => {
  it('reads a canonical snapshot and bounds actual file reads', async () => {
    const dir = await tempDir()
    const path = join(dir, 'snapshot.json')
    await writeFile(path, JSON.stringify(snapshot))
    expect(readLocalPublicFieldCache(path)).toEqual(snapshot)

    await writeFile(path, ' '.repeat(MAX_LOCAL_PUBLIC_FIELD_CACHE_BYTES + 1))
    expect(readLocalPublicFieldCache(path)).toBeNull()
  })

  it('rejects malformed cache content', async () => {
    const path = join(await tempDir(), 'snapshot.json')
    await writeFile(path, '{not-json')
    expect(readLocalPublicFieldCache(path)).toBeNull()
  })

  it('writes with private file permissions and atomically replaces the prior snapshot', async () => {
    const path = join(await tempDir(), 'nested', 'snapshot.json')
    writeLocalPublicFieldCache(path, snapshot)

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(snapshot)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await readdir(dirname(path))).toEqual(['snapshot.json'])
  })

  it('removes the temp file and preserves the last good cache when rename fails', async () => {
    const path = join(await tempDir(), 'snapshot.json')
    const previous = `${JSON.stringify(snapshot)}\nlast-good-marker`
    await writeFile(path, previous)

    expect(() => writeLocalPublicFieldCache(path, snapshot, () => { throw new Error('simulated rename failure') })).toThrow('simulated rename failure')

    expect(await readFile(path, 'utf8')).toBe(previous)
    expect(await readdir(dirname(path))).toEqual(['snapshot.json'])
  })
})
