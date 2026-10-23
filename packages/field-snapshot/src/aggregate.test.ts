import { describe, expect, it } from 'vitest'
import { aggregateSnapshot, assertAttributable, bandsFromSnapshot, dedupeSources } from './aggregate'
import { demoFieldSnapshot, syntheticRegistry } from './fixtures'
import type { SourceRecord } from './types'
import { rawTotal } from './topography'
import { hitsFromGeosearch, parseFieldSnapshot, publicFieldSnapshot, recordsFromHits, viewsFromPayload, weightFromViews } from './wikipedia'

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
}

describe('field snapshot', () => {
  it('rejects a source that has no attribution', () => {
    expect(() => assertAttributable({ ...publicSource, attribution: ' ' })).toThrow('attribution')
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

  it('publishes the demo field as a synthetic snapshot', () => {
    const snapshot = demoFieldSnapshot()
    expect(snapshot.schema).toBe('intoponet.field-snapshot.v1')
    expect(snapshot.algorithm).toBe('log1p-v1')
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
    const corridor = earth.find((band) => band.topicIds[0] === 'open-knowledge' && !band.category)
    const lons = corridor?.centerline.map((point) => point.lon) ?? []
    expect(Math.min(...lons)).toBeLessThan(-73.5)
    expect(Math.max(...lons)).toBeGreaterThan(-73.4)
    const earthWave = earth.find((band) => !band.category)?.wavelengthKm ?? 0
    const cityWave = bandsFromSnapshot(snapshot, 'city').find((band) => !band.category)?.wavelengthKm ?? 0
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
})
