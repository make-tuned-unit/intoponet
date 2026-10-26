import { describe, expect, it } from 'vitest'
import type { FieldSnapshot, SnapshotBand, SourceRecord } from '@intoponet/field-snapshot'
import {
  eligibleSignalsFromSnapshot,
  evaluateFrequencyEligibility,
  filterSnapshotForFrequencyEligibility,
} from './contentEligibility'

const evaluate = (overrides: Partial<Parameters<typeof evaluateFrequencyEligibility>[0]> = {}) => evaluateFrequencyEligibility({
  url: 'https://example.org/articles/history',
  title: 'A history article',
  topic: 'history',
  ...overrides,
})

function source(id: string, overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id,
    kind: 'public-record',
    title: `Source ${id}`,
    url: `https://example.org/${id}`,
    licence: 'open-data',
    attribution: 'Example publisher',
    retrievedAt: '2026-10-25T12:00:00.000Z',
    lat: 45,
    lon: -63,
    radiusKm: 12,
    topics: ['history'],
    weight: 0.5,
    publishedAt: '2026-10-25T11:00:00.000Z',
    measurement: {
      kind: 'wikimedia-pageviews',
      value: 12,
      unit: 'views',
      sourceId: 'fixture',
      sourceUrl: 'https://example.org/metrics',
      transformation: 'fixture',
    },
    ...overrides,
  }
}

function band(id: string, sourceIds: string[]): SnapshotBand {
  return {
    id,
    topicIds: ['history'],
    lat: 45,
    lon: -63,
    amplitude: 0.5,
    confidence: 0.8,
    sourceIds,
    sourceType: 'public-aggregate',
    measurement: { kind: 'wikimedia-pageviews', unit: 'views' },
  }
}

describe('frequency content eligibility', () => {
  it('blocks known adult domains and subdomains without matching suffix spoofs', () => {
    expect(evaluate({ url: 'https://www.pornhub.com/video' }).eligible).toBe(false)
    expect(evaluate({ url: 'https://xvideos.com.example.org/news', title: 'Ordinary page' }).eligible).toBe(true)
    expect(evaluate({ url: 'https://notpornhub.com/news', title: 'Ordinary page' }).eligible).toBe(true)
  })

  it('detects case-insensitive and percent-encoded explicit path markers', () => {
    expect(evaluate({ url: 'https://example.org/PORN/video' }).eligible).toBe(false)
    expect(evaluate({ url: 'https://example.org/%252Fadult-video%252Fclip' }).eligible).toBe(false)
    expect(evaluate({ url: 'https://example.org/adult/health/sex-education' }).eligible).toBe(true)
  })

  it('blocks explicit semantic title/topic markers without blocking medical sex education', () => {
    expect(evaluate({ title: 'Explicit adult video collection' }).eligible).toBe(false)
    expect(evaluate({ topic: 'pornographic material' }).eligible).toBe(false)
    expect(evaluate({ title: 'Sex education and reproductive health' }).eligible).toBe(true)
    expect(evaluate({ title: 'Sexual health clinic opens in the city' }).eligible).toBe(true)
  })

  it('blocks the requested restricted rating markers but never a stray R substring', () => {
    for (const rating of ['R', 'Rated R', 'R-rated', 'PG | R', 'NC-17', 'NC17', 'TV-MA', 'TVMA', '18+', '18', 'Age: 18']) {
      expect(evaluate({ rating }).eligible, rating).toBe(false)
    }
    expect(evaluate({ rating: 'PG-13' }).eligible).toBe(true)
    expect(evaluate({ rating: 'Not rated', title: 'Portrait of a city' }).eligible).toBe(true)
    expect(evaluate({ title: 'A portrait of art history' }).eligible).toBe(true)
  })

  it('fails closed for unrated entertainment categories but allows ordinary research topics', () => {
    expect(evaluate({ topic: 'movies' })).toMatchObject({ eligible: false })
    for (const rating of ['unrated', 'unknown', 'banana', 'PG | unknown']) {
      expect(evaluate({ topic: 'movies', rating }).eligible, rating).toBe(false)
    }
    for (const rating of ['PG-13', 'TV-G', 'TV-PG', 'TV-14', 'U', '12', '12A']) {
      expect(evaluate({ topic: 'movies', rating }).eligible, rating).toBe(true)
    }
    expect(evaluate({ topic: 'film studies' }).eligible).toBe(true)
    expect(evaluate({ topic: 'history' }).eligible).toBe(true)
  })

  it('does not claim undetected metadata is safe and excludes unscannable long inputs', () => {
    const ordinary = evaluate()
    expect(ordinary.eligible).toBe(true)
    expect(ordinary.reason).toMatch(/does not certify content safety/)
    expect(evaluate({ title: 'x'.repeat(8_193) })).toMatchObject({ eligible: false })
  })

  it('filters excluded sources and any aggregate band that cannot be safely recomputed', () => {
    const safe = source('safe-source')
    const adult = source('adult-source', { url: 'https://xhamster.com/watch', title: 'Video' })
    const safeBand = band('safe-band', ['safe-source'])
    const mixedBand = band('mixed-band', ['safe-source', 'adult-source'])
    const missingBand = band('missing-source-band', ['missing-source'])
    const snapshot: FieldSnapshot = {
      schema: 'intoponet.field-snapshot.v2',
      id: 'snapshot-fixture',
      algorithm: 'log1p-separated-v2',
      createdAt: '2026-10-25T12:00:00.000Z',
      coverageNote: 'Fixture only',
      sources: [safe, adult],
      bands: [safeBand, mixedBand, missingBand],
    }

    const filtered = filterSnapshotForFrequencyEligibility(snapshot)
    expect(filtered.excludedSourceCount).toBe(1)
    expect(filtered.excludedBandCount).toBe(2)
    expect(filtered.snapshot.sources.map(({ id }) => id)).toEqual(['safe-source'])
    expect(filtered.snapshot.bands.map(({ id }) => id)).toEqual(['safe-band'])
    expect(eligibleSignalsFromSnapshot(snapshot, 'history').map(({ id }) => id)).toEqual(['safe-source'])
  })
})
