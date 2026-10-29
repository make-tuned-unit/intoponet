import { describe, expect, it } from 'vitest'
import { aggregateSnapshot, assertAttributable, bandsFromSnapshot, dedupeSources } from './aggregate'
import { demoFieldSnapshot, syntheticRegistry } from './fixtures'
import type { SourceRecord } from './types'
import { rawTotal } from './topography'
import { snapshotIdentity } from './identity'
import { hitsFromGeosearch, parseFieldSnapshot, publicFieldSnapshot, recordsFromHits, viewsFromPayload, weightFromViews, wikipediaPageviewsUrl } from './wikipedia'

const publicSource: SourceRecord = {
  id: 'open-archive',
  kind: 'public-record',
  title: 'Example archive record',
  url: 'https://example.org/archive',
  licence: 'cc-by',
  attribution: 'Example Archive',
  retrievedAt: '2026-10-23T00:00:00.000Z',
  lat: 40.7,
  lon: -74,
  radiusKm: 200,
  topics: ['civic-memory'],
  weight: 1,
  publishedAt: '2024-01-01T00:00:00.000Z',
  measurement: {
    kind: 'declared-index',
    value: 1,
    unit: 'index',
    sourceId: 'example-index',
    sourceUrl: 'https://example.org/metrics',
    transformation: 'fixture test input',
  },
}

describe('field snapshot', () => {
  it('rejects a source that has no attribution', () => {
    expect(() => assertAttributable({ ...publicSource, attribution: ' ' })).toThrow('attribution')
  })

  it('requires a typed measurement and provenance URL', () => {
    expect(() => assertAttributable({
      ...publicSource,
      measurement: { ...publicSource.measurement, unit: ' ' },
    })).toThrow('typed measurement')
    expect(() => assertAttributable({
      ...publicSource,
      measurement: { ...publicSource.measurement, sourceUrl: 'javascript:alert(1)' },
    })).toThrow('HTTP or HTTPS')
  })

  it('dedupes the same original URL and keeps amplitude bounded', () => {
    const snapshot = aggregateSnapshot([publicSource, { ...publicSource, id: 'copy' }])
    expect(dedupeSources([publicSource, publicSource])).toHaveLength(1)
    expect(snapshot.sources).toHaveLength(1)
    expect(snapshot.bands[0]?.amplitude).toBeGreaterThan(0)
    expect(snapshot.bands[0]?.amplitude).toBeLessThanOrEqual(1)
    expect(snapshot.bands[0]?.sourceType).toBe('public-aggregate')
    expect(snapshot.coverageNote).toContain('Public records only')
  })

  it('assigns stable content identities for reordered inputs and duplicate URL winners', () => {
    const now = Date.parse('2026-10-23T00:00:00.000Z')
    const duplicateA = { ...publicSource, id: 'z-copy', title: 'Zulu copy', weight: 2, url: 'https://EXAMPLE.org/archive' }
    const duplicateB = { ...publicSource, id: 'a-copy', title: 'Alpha copy', weight: 4 }
    const second = { ...publicSource, id: 'second', url: 'https://other.example/record', title: 'Second record' }
    const input = [duplicateA, second, duplicateB]
    const snapshot = aggregateSnapshot(input, now)
    const reordered = aggregateSnapshot([...input].reverse(), now)

    expect(snapshot.id).toMatch(/^snapshot-v1-[a-f0-9]{64}$/)
    expect(snapshotIdentity(snapshot)).toBe(snapshot.id)
    expect(reordered).toEqual(snapshot)
    expect(snapshot.sources.map((source) => source.id)).toEqual(['a-copy', 'second'])
  })

  it('canonicalizes URL host case without merging case-sensitive path variants', () => {
    const upperPath = { ...publicSource, id: 'upper-path', url: 'https://example.org/A' }
    const lowerPath = { ...publicSource, id: 'lower-path', url: 'https://example.org/a' }
    const hostCaseCopy = { ...publicSource, id: 'host-case-copy', url: 'HTTPS://EXAMPLE.ORG/A#section' }
    expect(dedupeSources([upperPath, lowerPath, hostCaseCopy]).map((source) => source.id))
      .toEqual(['host-case-copy', 'lower-path'])
  })

  it('changes identity when content or explicit evaluation time changes', () => {
    const now = Date.parse('2026-10-23T00:00:00.000Z')
    const original = aggregateSnapshot([publicSource], now)
    const changedContent = aggregateSnapshot([{ ...publicSource, title: 'Different title' }], now)
    const changedTime = aggregateSnapshot([publicSource], now + 1_000)
    expect(changedContent.id).not.toBe(original.id)
    expect(changedTime.id).not.toBe(original.id)
  })

  it('rejects invalid evaluation timestamps instead of generating a wall-clock identity', () => {
    expect(() => aggregateSnapshot([publicSource], Number.NaN)).toThrow('valid timestamp')
    expect(() => aggregateSnapshot([publicSource], Number.POSITIVE_INFINITY)).toThrow('valid timestamp')
  })

  it('includes public coverage metadata in the content identity', () => {
    const now = Date.parse('2026-10-23T00:00:00.000Z')
    const withoutCoverageCheck = publicFieldSnapshot([publicSource], now, false)
    const withCoverageCheck = publicFieldSnapshot([publicSource], now, true)
    expect(withCoverageCheck.coverageNote).not.toBe(withoutCoverageCheck.coverageNote)
    expect(withCoverageCheck.id).not.toBe(withoutCoverageCheck.id)
  })

  it('publishes the demo field as a synthetic snapshot', () => {
    const snapshot = demoFieldSnapshot()
    expect(snapshot.schema).toBe('intoponet.field-snapshot.v2')
    expect(snapshot.algorithm).toBe('log1p-separated-v3')
    expect(snapshot.sources).toHaveLength(syntheticRegistry.length)
    expect(snapshot.bands.every((band) => band.sourceType === 'synthetic')).toBe(true)
    expect(snapshot.coverageNote).toContain('Synthetic')
    const bands = bandsFromSnapshot(snapshot)
    expect(bands[0]?.centerline).toHaveLength(3)
    expect(bands[0]?.sourceType).toBe('synthetic')
  })

  it('scores a repeated publisher below an independent one and keeps a distant place quieter', () => {
    const now = Date.parse('2026-10-23T00:00:00.000Z')
    const primary = {
      ...publicSource,
      topics: ['open-knowledge'],
      url: 'https://example.org/a',
      weight: 4,
    }
    const repeat = { ...primary, id: 'repeat', url: 'https://example.org/b' }
    const independent = { ...primary, id: 'other', url: 'https://archive.example/c' }
    const far = {
      ...primary,
      id: 'far',
      url: 'https://far.example/d',
      lat: -33.9,
      lon: 18.4,
    }
    expect(rawTotal([primary, repeat], now)).toBeLessThan(rawTotal([primary, independent], now))
    expect(rawTotal([far], now)).toBeLessThan(rawTotal([primary], now))
  })

  it('keeps different measurement kinds in separate cells and field bands', () => {
    const wiki = {
      ...publicSource,
      id: 'wiki-one',
      url: 'https://shared.example/wiki',
      topics: ['open-knowledge'],
      lat: 40.7,
      lon: -74,
      measurement: {
        kind: 'wikimedia-pageviews' as const,
        value: 1000,
        unit: 'pageviews',
        sourceId: 'wikimedia-pageviews-en',
        sourceUrl: 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article',
        transformation: 'bounded-log10-pageviews-v1',
      },
    }
    const quake = {
      ...publicSource,
      id: 'usgs-one',
      url: 'https://shared.example/quake',
      topics: ['open-knowledge'],
      lat: 40.7,
      lon: -74,
      weight: 2,
      measurement: {
        kind: 'usgs-earthquake-magnitude' as const,
        value: 6.1,
        unit: 'magnitude',
        sourceId: 'usgs-comcat-m45-week',
        sourceUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson',
        transformation: 'bounded-linear-magnitude-v1',
        scale: 'ml',
      },
    }
    const wikiPeer = {
      ...wiki,
      id: 'wiki-two',
      url: 'https://shared.example/wiki-peer',
    }
    const snapshot = aggregateSnapshot([wiki, quake], Date.parse('2026-10-23T00:00:00.000Z'))
    expect(snapshot.bands).toHaveLength(2)
    expect(new Set(snapshot.bands.map((band) => band.id)).size).toBe(2)
    expect(snapshot.bands.map((band) => band.measurement.kind).sort()).toEqual([
      'usgs-earthquake-magnitude',
      'wikimedia-pageviews',
    ])
    const wikiSolo = aggregateSnapshot([wiki], Date.parse('2026-10-23T00:00:00.000Z'))
    const quakeSolo = aggregateSnapshot([quake], Date.parse('2026-10-23T00:00:00.000Z'))
    expect(snapshot.bands.find((band) => band.measurement.kind === 'wikimedia-pageviews')?.amplitude)
      .toBe(wikiSolo.bands[0]?.amplitude)
    expect(snapshot.bands.find((band) => band.measurement.kind === 'usgs-earthquake-magnitude')?.amplitude)
      .toBe(quakeSolo.bands[0]?.amplitude)
    expect(snapshot.bands.find((band) => band.measurement.kind === 'wikimedia-pageviews')?.id)
      .toBe(wikiSolo.bands[0]?.id)
    expect(snapshot.bands.find((band) => band.measurement.kind === 'usgs-earthquake-magnitude')?.id)
      .toBe(quakeSolo.bands[0]?.id)
    const grouped = aggregateSnapshot([wiki, quake, wikiPeer], Date.parse('2026-10-23T00:00:00.000Z'))
    expect(grouped.bands.map((band) => band.id)).toEqual(
      expect.arrayContaining(snapshot.bands.map((band) => band.id)),
    )
    expect(grouped.bands.find((band) => band.measurement.kind === 'wikimedia-pageviews')?.sourceIds.sort())
      .toEqual(['wiki-one', 'wiki-two'])

    const reordered = aggregateSnapshot([wikiPeer, wiki, quake], Date.parse('2026-10-23T00:00:00.000Z'))
    const groupSummary = (bands: typeof snapshot.bands) =>
      bands
        .map((band) => ({
          id: band.id,
          kind: band.measurement.kind,
          sourceIds: [...band.sourceIds].sort(),
        }))
        .sort((left, right) => left.id.localeCompare(right.id))
    expect(groupSummary(reordered.bands)).toEqual(groupSummary(grouped.bands))

    const fieldBands = bandsFromSnapshot(snapshot)
    expect(fieldBands).toHaveLength(2)
    expect(fieldBands.map((band) => band.category)).toContain(
      'measurement:usgs-earthquake-magnitude|magnitude|ml|',
    )
    expect(fieldBands.map((band) => band.category)).toContain(
      'measurement:wikimedia-pageviews|pageviews||',
    )
    expect(() => rawTotal([wiki, quake], Date.parse('2026-10-23T00:00:00.000Z')))
      .toThrow('different measurement groups')
  })

  it('keeps delimiter-containing and legacy measurement identities distinct and stable', () => {
    const legacy = (
      id: string,
      url: string,
      unit: string,
      scale: string,
    ): SourceRecord => ({
      ...publicSource,
      id,
      url,
      measurement: {
        ...publicSource.measurement,
        kind: 'legacy-untyped',
        value: null,
        unit,
        scale,
      },
    })
    // These two tuples collided under a delimiter-joined key:
    // legacy-untyped|u|x|s|legacy-shared.
    const first = legacy('legacy-shared', 'https://legacy.example/one', 'u|x', 's')
    const delimiterCollision = legacy('legacy-shared', 'https://legacy.example/two', 'u', 'x|s')
    const distinctLegacyIdentity = legacy('legacy-other', 'https://legacy.example/three', 'u|x', 's')
    const sources = [first, delimiterCollision, distinctLegacyIdentity]
    const snapshot = aggregateSnapshot(sources)
    const reordered = aggregateSnapshot([...sources].reverse())

    expect(snapshot.bands).toHaveLength(3)
    expect(new Set(snapshot.bands.map((band) => band.id)).size).toBe(3)
    expect(snapshot.bands.map((band) => band.id).sort()).toEqual(
      reordered.bands.map((band) => band.id).sort(),
    )
  })

  it('migrates v1 wiki and USGS weights without restoring a generic mixed score', () => {
    const legacy = {
      schema: 'intoponet.field-snapshot.v1',
      id: 'legacy-public',
      algorithm: 'log1p-v1',
      createdAt: '2026-10-23T00:00:00.000Z',
      coverageNote: 'Wikipedia and USGS. Not the whole web, not a measure of importance.',
      sources: [
        {
          id: 'wiki-1', kind: 'public-record', title: 'Wiki page',
          url: 'https://en.wikipedia.org/wiki/Wiki_page', licence: 'cc-by-sa',
          attribution: 'Wikipedia contributors', retrievedAt: '2026-10-23T00:00:00.000Z',
          lat: 40.7, lon: -74, radiusKm: 10, topics: ['open-knowledge'],
          weight: 1.5, publishedAt: '2026-10-23T00:00:00.000Z',
        },
        {
          id: 'usgs-1', kind: 'public-record', title: 'Earthquake',
          url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us1', licence: 'public-domain',
          attribution: 'USGS', retrievedAt: '2026-10-23T00:00:00.000Z',
          lat: 40.7, lon: -74, radiusKm: 50, topics: ['open-knowledge'],
          weight: 1.5, publishedAt: '2026-10-23T00:00:00.000Z',
        },
      ],
    }
    const migrated = parseFieldSnapshot(JSON.stringify(legacy))
    expect(migrated?.schema).toBe('intoponet.field-snapshot.v2')
    expect(migrated?.id).toMatch(/^snapshot-v1-[a-f0-9]{64}$/)
    expect(migrated?.sources.map((source) => source.measurement.kind)).toEqual([
      'legacy-earthquake-weight',
      'legacy-pageviews-weight',
    ])
    expect(migrated?.sources.every((source) => source.measurement.value === null)).toBe(true)
    expect(migrated?.sources.every((source) => source.measurement.unit === 'unknown')).toBe(true)
    const migratedWiki = migrated?.sources.find((source) => source.measurement.kind === 'legacy-pageviews-weight')
    expect(migratedWiki?.measurement.transformation).toContain('raw pageview count')
    expect(migratedWiki?.weight).toBe(1.5)
    expect(migrated?.bands).toHaveLength(2)
  })

  it('rejects an untyped source in a v2 snapshot', () => {
    const snapshot = aggregateSnapshot([publicSource])
    const serialized = JSON.parse(JSON.stringify(snapshot)) as {
      sources: Array<Record<string, unknown>>
    }
    delete serialized.sources[0]?.['measurement']
    expect(parseFieldSnapshot(JSON.stringify(serialized))).toBeNull()
  })

  it('recomputes current identities on parse and reflects content tampering', () => {
    const snapshot = aggregateSnapshot([publicSource], Date.parse('2026-10-23T00:00:00.000Z'))
    const roundTrip = parseFieldSnapshot(JSON.stringify(snapshot))
    expect(roundTrip).toEqual(snapshot)

    const forgedId = { ...snapshot, id: 'public-2026-10-23T00' }
    expect(parseFieldSnapshot(JSON.stringify(forgedId))?.id).toBe(snapshot.id)

    const alteredSource = {
      ...snapshot,
      sources: snapshot.sources.map((source) => ({ ...source, title: 'Tampered title' })),
    }
    const parsedTampering = parseFieldSnapshot(JSON.stringify(alteredSource))
    expect(parsedTampering?.id).not.toBe(snapshot.id)
    expect(parsedTampering?.sources[0]?.title).toBe('Tampered title')
  })

  it('migrates prior v2 aggregation identities and computation to v3', () => {
    const current = aggregateSnapshot([publicSource], Date.parse('2026-10-23T00:00:00.000Z'))
    const previous = { ...current, algorithm: 'log1p-separated-v2' as const, id: 'snapshot-1' }
    const migrated = parseFieldSnapshot(JSON.stringify(previous))
    expect(migrated?.algorithm).toBe('log1p-separated-v3')
    expect(migrated?.id).not.toBe(previous.id)
    expect(migrated?.id).toMatch(/^snapshot-v1-[a-f0-9]{64}$/)
  })

  it('rejects invalid current-format evaluation timestamps', () => {
    const snapshot = aggregateSnapshot([publicSource], Date.parse('2026-10-23T00:00:00.000Z'))
    expect(parseFieldSnapshot(JSON.stringify({ ...snapshot, createdAt: 'not a timestamp' }))).toBeNull()
    expect(parseFieldSnapshot(JSON.stringify({ ...snapshot, createdAt: '' }))).toBeNull()
  })

  it('lays the corridor through the sources and keeps city waves finer', () => {
    const west = {
      ...publicSource,
      id: 'west',
      url: 'https://a.example/west',
      topics: ['open-knowledge'],
      lat: 40.7,
      lon: -74,
    }
    const east = {
      ...publicSource,
      id: 'east',
      url: 'https://b.example/east',
      topics: ['open-knowledge'],
      lat: 41.2,
      lon: -73.2,
    }
    const related = {
      ...publicSource,
      id: 'related',
      url: 'https://c.example/related',
      topics: ['civic-memory'],
      lat: 40.9,
      lon: -73.6,
    }
    const snapshot = aggregateSnapshot([west, east, related])
    const earth = bandsFromSnapshot(snapshot, 'earth')
    const region = bandsFromSnapshot(snapshot, 'region')
    const corridor = earth.find((band) =>
      band.topicIds[0] === 'open-knowledge' && band.category?.startsWith('measurement:'),
    )
    const lons = corridor?.centerline.map((point) => point.lon) ?? []
    expect(Math.min(...lons)).toBeLessThan(-73.5)
    expect(Math.max(...lons)).toBeGreaterThan(-73.4)
    const earthWave = earth.find((band) => band.category?.startsWith('measurement:'))?.wavelengthKm ?? 0
    const cityWave = bandsFromSnapshot(snapshot, 'city').find((band) => band.category?.startsWith('measurement:'))?.wavelengthKm ?? 0
    expect(cityWave).toBeLessThan(earthWave)
    const overlap = region.find((band) => band.category === 'overlap')
    expect(overlap?.amplitude ?? 1).toBeLessThan(0.3)
  })
})

describe('wikipedia public field', () => {
  it('keeps titles and coordinates and drops article text', () => {
    const hits = hitsFromGeosearch({
      query: {
        geosearch: [
          { pageid: 1, title: 'Brooklyn Bridge Park', lat: 40.7, lon: -74, extract: 'do not keep' },
        ],
      },
    })
    const records = recordsFromHits(hits, 'open-knowledge', new Map([['Brooklyn Bridge Park', 92]]), '2026-10-23T00:00:00.000Z')
    expect(records[0]?.url).toBe('https://en.wikipedia.org/wiki/Brooklyn_Bridge_Park')
    expect(records[0]?.licence).toBe('cc-by-sa')
    expect(records[0]?.weight).toBeGreaterThan(1)
    expect(records[0]?.measurement).toMatchObject({
      kind: 'wikimedia-pageviews',
      value: 92,
      unit: 'pageviews',
      sourceId: 'wikimedia-pageviews-en',
    })
    expect(records[0]?.measurement.sourceUrl).toContain('/daily/')
    expect(JSON.stringify(records)).not.toContain('do not keep')
    const snapshot = publicFieldSnapshot(records, Date.parse('2026-10-23T00:00:00.000Z'))
    expect(snapshot.bands[0]?.sourceType).toBe('public-aggregate')
    expect(snapshot.coverageNote).toContain('Not the whole web')
    expect(parseFieldSnapshot(JSON.stringify(snapshot))?.sources[0]?.title).toBe('Brooklyn Bridge Park')
  })

  it('sums daily pageviews and gives a quiet page a small weight', () => {
    expect(viewsFromPayload({ items: [{ views: 32 }, { views: 60 }] })).toBe(92)
    expect(weightFromViews(0)).toBe(0.2)
    expect(weightFromViews(1_000_000)).toBe(5)
  })

  it('records the exact requested pageview window across a UTC date rollover', () => {
    const requestedWindow = {
      start: new Date('2026-10-16T23:59:30.000Z'),
      end: new Date('2026-10-22T23:59:30.000Z'),
    }
    const retrievedAt = '2026-10-23T00:01:00.000Z'
    const [record] = recordsFromHits(
      [{ pageid: 2, title: 'Date Rollover', lat: 40.7, lon: -74 }],
      'open-knowledge',
      new Map([['Date Rollover', 25]]),
      retrievedAt,
      requestedWindow,
    )
    const exactUrl = wikipediaPageviewsUrl('Date Rollover', requestedWindow)
    expect(exactUrl).toContain('/daily/20261016/20261022')
    expect(record?.measurement.sourceUrl).toBe(exactUrl)
    expect(record?.measurement.windowStart).toBe('20261016')
    expect(record?.measurement.windowEnd).toBe('20261022')
    expect(record?.retrievedAt).toBe(retrievedAt)
  })
})
