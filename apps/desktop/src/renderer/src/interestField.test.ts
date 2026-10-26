import { describe, expect, it } from 'vitest'
import type { FieldSnapshot, SourceRecord } from '@intoponet/field-snapshot'
import {
  buildInterestTextureData,
  INTEREST_FIELD_LIMITS,
  signalsFromSnapshot,
  syntheticInterestSignals,
  syntheticPreviewInterestSignals,
  type InterestSignal,
} from './interestField'

const baseSignal = (overrides: Partial<InterestSignal> = {}): InterestSignal => ({
  id: 'anchor-a',
  lat: 0,
  lon: 0,
  intensity: 0.7,
  radiusKm: 1_000,
  momentum: 0.4,
  confidence: 0.8,
  timestamp: '2026-10-24T12:00:00.000Z',
  topicId: 'topic-a',
  sourceType: 'synthetic',
  ...overrides,
})

function source(id: string, overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id,
    kind: 'public-record',
    title: id,
    url: `https://example.test/${id}`,
    licence: 'open-data',
    attribution: 'Test source',
    retrievedAt: '2026-10-24T12:00:00.000Z',
    lat: 12.25,
    lon: 34.5,
    radiusKm: 17,
    topics: ['topic-a'],
    weight: 0.5,
    publishedAt: '2026-10-24T12:00:00.000Z',
    measurement: {
      kind: 'wikimedia-pageviews',
      value: 10,
      unit: 'views',
      scale: 'daily',
      sourceId: 'wiki',
      sourceUrl: 'https://example.test/data',
      transformation: 'test',
    },
    ...overrides,
  }
}

describe('interest field texture', () => {
  it('distributes only the Design-preview world-knowledge fixture across hemispheres', () => {
    const worldKnowledge = syntheticPreviewInterestSignals.filter((signal) => signal.topicId === 'world-knowledge')
    const sharedLabFixture = syntheticInterestSignals.filter((signal) => signal.topicId === 'world-knowledge')
    expect(worldKnowledge.some((signal) => signal.lat < -10)).toBe(true)
    expect(worldKnowledge.some((signal) => signal.lat >= -10 && signal.lat <= 10)).toBe(true)
    expect(worldKnowledge.some((signal) => signal.lat > 10)).toBe(true)
    expect(worldKnowledge.every((signal) => signal.sourceType === 'synthetic' && signal.radiusKm >= 1_500 && signal.radiusKm <= 3_000)).toBe(true)
    expect(sharedLabFixture.map((signal) => signal.id)).toEqual([
      'synthetic-patch-01', 'synthetic-patch-02', 'synthetic-patch-12', 'synthetic-patch-14',
    ])
    expect(sharedLabFixture.every((signal) => signal.lat > 0)).toBe(true)
  })

  it('rasterizes private local measurements without changing their geographic support', () => {
    const signal = baseSignal({ sourceType: 'private-local', intensity: 0.25 })
    const weak = buildInterestTextureData([signal], 72, 36)
    const strong = buildInterestTextureData([{ ...signal, intensity: 0.75 }], 72, 36)
    const center = (18 * 72 + 36) * 4
    const remote = (18 * 72 + 4) * 4
    expect(strong.data[center]).toBeGreaterThan(weak.data[center]!)
    expect(strong.data[remote]).toBe(0)
    expect(signal.sourceType).toBe('private-local')
  })

  it('returns a zeroed texture for no observations', () => {
    const result = buildInterestTextureData([])
    expect(result.width).toBe(256)
    expect(result.height).toBe(128)
    expect([...result.data].every((value) => value === 0)).toBe(true)
    expect(result.undersampledSignalIds).toEqual([])
  })

  it('bounds and monotonically increases local intensity without globally scaling unrelated pixels', () => {
    const quiet = buildInterestTextureData([baseSignal({ intensity: 0.25 })], 72, 36)
    const strong = buildInterestTextureData([baseSignal({ intensity: 0.75 })], 72, 36)
    const remote = buildInterestTextureData([baseSignal({ lat: 0, lon: 100 })], 72, 36)
    const center = (18 * 72 + 36) * 4
    const far = (18 * 72 + 4) * 4
    expect(strong.data[center]).toBeGreaterThan(quiet.data[center]!)
    expect(strong.data[center]).toBeLessThanOrEqual(1)
    expect(strong.data[center]).toBeGreaterThan(0)
    expect(quiet.data[far]).toBe(0)
    expect(remote.data[far]).toBe(0)
  })

  it('keeps the exact geodesic support edge and reports sub-texel radii without widening them', () => {
    const inside = buildInterestTextureData([baseSignal({ radiusKm: 100 })], 360, 180)
    const outside = buildInterestTextureData([baseSignal({ radiusKm: 50 })], 360, 180)
    const nearEquator = (90 * 360 + 180) * 4
    expect(inside.data[nearEquator]).toBeGreaterThan(0)
    expect(outside.data[nearEquator]).toBe(0)

    const tiny = buildInterestTextureData([baseSignal({ id: 'tiny', radiusKm: 1 })], 8, 4)
    expect(tiny.undersampledSignalIds).toEqual(['tiny'])
    expect([...tiny.data].every((value) => value === 0)).toBe(true)
  })

  it('is deterministic, seam continuous, and longitude invariant at a pole', () => {
    const fixture = buildInterestTextureData(syntheticInterestSignals, 64, 32)
    const repeat = buildInterestTextureData(syntheticInterestSignals, 64, 32)
    expect(repeat.data).toEqual(fixture.data)

    const east = buildInterestTextureData([baseSignal({ lon: 180 })], 64, 32)
    const west = buildInterestTextureData([baseSignal({ lon: -180 })], 64, 32)
    expect([...east.data].every((value, i) => Math.abs(value - west.data[i]!) < 1e-6)).toBe(true)

    const polar = buildInterestTextureData([baseSignal({ lat: 90, radiusKm: 500 })], 64, 32)
    const topRow = Array.from({ length: 64 }, (_, x) => polar.data[((31 * 64 + x) * 4)]!)
    expect(Math.max(...topRow) - Math.min(...topRow)).toBeLessThan(1e-6)
  })

  it('uses deterministic geoname ID tie-breaking for more than 100 equal siblings', () => {
    const siblings = Array.from({ length: 137 }, (_, index) => baseSignal({
      id: `place-${String(index).padStart(3, '0')}`,
      lat: 0,
      lon: 0,
      intensity: 0.001,
      radiusKm: 2_000,
    })).reverse()
    const first = buildInterestTextureData(siblings, 32, 16)
    const second = buildInterestTextureData([...siblings].reverse(), 32, 16)
    expect(second.data).toEqual(first.data)
    expect(first.data.some((value) => value > 0)).toBe(true)
  })

  it('rejects malformed anchors and unsafe raster budgets', () => {
    expect(() => buildInterestTextureData([baseSignal({ lat: 91 })])).toThrow(TypeError)
    expect(() => buildInterestTextureData([baseSignal({ momentum: 2 })])).toThrow(TypeError)
    expect(() => buildInterestTextureData([baseSignal({ id: '' })])).toThrow(TypeError)
    expect(() => buildInterestTextureData([baseSignal()], 1, 128)).toThrow(RangeError)
    expect(() => buildInterestTextureData(Array.from({ length: INTEREST_FIELD_LIMITS.signals + 1 }, (_, i) => baseSignal({ id: `id-${i}` })))).toThrow(RangeError)
  })
})

describe('snapshot signal adapter', () => {
  it('keeps source anchors/radii and filters by both topic and measurement group', () => {
    const matching = source('matching')
    const wrongTopic = source('wrong-topic', { topics: ['topic-b'] })
    const wrongMeasurement = source('wrong-measurement', { measurement: {
      ...matching.measurement,
      kind: 'usgs-earthquake-magnitude',
      unit: 'magnitude',
    } })
    const snapshot: FieldSnapshot = {
      schema: 'intoponet.field-snapshot.v2',
      id: 'snapshot-test',
      algorithm: 'log1p-separated-v2',
      createdAt: '2026-10-24T12:00:00.000Z',
      coverageNote: 'Test fixture',
      sources: [matching, wrongTopic, wrongMeasurement],
      bands: [{
        id: 'band-test',
        topicIds: ['topic-a'],
        lat: 10,
        lon: 30,
        amplitude: 0.5,
        confidence: 0.75,
        sourceIds: ['matching', 'wrong-topic', 'wrong-measurement'],
        sourceType: 'public-aggregate',
        measurement: { kind: 'wikimedia-pageviews', unit: 'views', scale: 'daily' },
      }],
    }
    expect(signalsFromSnapshot(snapshot, 'topic-b')).toEqual([])
    expect(signalsFromSnapshot(snapshot, 'topic-a')).toEqual([{
      id: 'matching',
      lat: 12.25,
      lon: 34.5,
      intensity: 0.5,
      radiusKm: 17,
      momentum: null,
      confidence: 0.75,
      timestamp: snapshot.createdAt,
      topicId: 'topic-a',
      sourceType: 'public-aggregate',
    }])
  })
})
