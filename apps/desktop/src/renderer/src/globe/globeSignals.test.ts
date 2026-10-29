import { describe, expect, it } from 'vitest'
import type { FieldSnapshot, SourceRecord } from '@intoponet/field-snapshot'
import { latLonToOrbit } from '@intoponet/frequency-field'
import { distanceKm, filterGlobeSignals, MEMBRANE_MAX_SIGNALS, freshness, globeSignalsFromSnapshot, layerCounts, membraneSignals, nearbySignals } from './globeSignals'
import { poseToward, radiusForSpan } from './flyTo'

const now = Date.parse('2026-10-26T12:00:00.000Z')

function record(overrides: Partial<SourceRecord> & Pick<SourceRecord, 'id' | 'measurement'>): SourceRecord {
  return {
    kind: 'public-record',
    title: overrides.id,
    url: `https://example.org/${overrides.id}`,
    licence: 'public-domain',
    attribution: 'Test',
    retrievedAt: '2026-10-26T11:00:00.000Z',
    lat: 10,
    lon: 10,
    radiusKm: 50,
    topics: ['t'],
    weight: 1,
    publishedAt: '2026-10-26T10:00:00.000Z',
    ...overrides,
  }
}

const views = (value: number) => ({ kind: 'wikimedia-pageviews' as const, value, unit: 'pageviews', sourceId: 'w', sourceUrl: 'https://w.example', transformation: 'x', windowStart: '20261025', windowEnd: '20261025' })
const quake = (value: number) => ({ kind: 'usgs-earthquake-magnitude' as const, value, unit: 'magnitude', sourceId: 'u', sourceUrl: 'https://u.example', transformation: 'x', scale: 'mww' })
const eonet = { kind: 'nasa-eonet-event' as const, value: null, unit: 'event', sourceId: 'e', sourceUrl: 'https://e.example', transformation: 'x' }

const snapshot: FieldSnapshot = {
  schema: 'intoponet.field-snapshot.v2',
  id: 's',
  algorithm: 'log1p-separated-v2',
  createdAt: '2026-10-26T11:30:00.000Z',
  coverageNote: '',
  bands: [],
  sources: [
    record({ id: 'wiki-1', measurement: views(900_000), lat: 35.7, lon: 139.7, topics: ['reading-now'] }),
    record({ id: 'wiki-2', measurement: views(9_000), lat: 48.8, lon: 2.3, topics: ['reading-now'] }),
    record({ id: 'usgs-1', measurement: quake(6.8), lat: 36, lon: 140, topics: ['seismic-record'] }),
    record({ id: 'usgs-old', measurement: quake(4.6), publishedAt: '2026-10-20T00:00:00.000Z', topics: ['seismic-record'] }),
    record({ id: 'eonet-1', measurement: eonet, topics: ['natural-wildfires'], summary: 'Wildfire · reported by IRWIN' }),
    record({ id: 'fixture', kind: 'synthetic-fixture', measurement: views(5) }),
  ],
}

describe('globe signals', () => {
  const signals = globeSignalsFromSnapshot(snapshot)

  it('maps public records to layers and drops synthetic fixtures', () => {
    expect(signals.map((s) => s.id).sort()).toEqual(['eonet-1', 'usgs-1', 'usgs-old', 'wiki-1', 'wiki-2'])
    expect(layerCounts(signals)).toEqual({ news: 0, reading: 2, quakes: 2, natural: 1 })
    expect(signals.find((s) => s.id === 'eonet-1')).toMatchObject({ kind: 'Wildfire', summary: 'Wildfire · reported by IRWIN' })
    expect(signals.find((s) => s.id === 'usgs-1')?.kind).toBe('M6.8 earthquake')
    expect(signals.find((s) => s.id === 'wiki-1')?.measurement).toMatch(/^900,000 reads on Oct 25$/)
  })

  it('ranks only within a layer', () => {
    const byId = Object.fromEntries(signals.map((s) => [s.id, s.intensity]))
    expect(byId['wiki-1']).toBe(1)
    expect(byId['wiki-2']).toBeCloseTo(0.3)
    expect(byId['usgs-1']).toBe(1)
    expect(byId['usgs-old']).toBeCloseTo(0.3)
  })

  it('filters by layer and time window, always keeping the latest reading day', () => {
    const layers = new Set(['reading', 'quakes'] as const)
    const day = filterGlobeSignals(signals, { layers, window: '24h', now })
    expect(day.map((s) => s.id).sort()).toEqual(['usgs-1', 'wiki-1', 'wiki-2'])
    const week = filterGlobeSignals(signals, { layers, window: '7d', now })
    expect(week.map((s) => s.id)).toContain('usgs-old')
  })

  it('caps membrane input at the texture budget, keeping the strongest', () => {
    const many = Array.from({ length: 700 }, (_, i) => ({ ...signals[0]!, id: `s${i}`, intensity: (i % 100) / 100 + 0.001 }))
    const membrane = membraneSignals(many, snapshot.createdAt)
    expect(membrane).toHaveLength(MEMBRANE_MAX_SIGNALS)
    expect(Math.min(...membrane.map((s) => s.intensity))).toBeGreaterThan(0.2)
  })

  it('builds bounded membrane input', () => {
    const membrane = membraneSignals(signals, snapshot.createdAt)
    expect(membrane.every((s) => s.intensity > 0 && s.intensity <= 1 && s.sourceType === 'public-aggregate')).toBe(true)
  })

  it('finds nearby signals by distance', () => {
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111.2, 0)
    expect(nearbySignals(signals, { lat: 35.68, lon: 139.69 }, 500).map((s) => s.id)).toEqual(['wiki-1', 'usgs-1'])
  })

  it('reports staleness', () => {
    expect(freshness(snapshot, now)).toEqual({ label: 'Updated 30 min ago', stale: false })
    expect(freshness(snapshot, now + 5 * 3_600_000).stale).toBe(true)
    expect(freshness(null, now)).toEqual({ label: 'No public snapshot yet', stale: true })
  })
})

describe('fly to', () => {
  it('takes the short way round', () => {
    const aim = latLonToOrbit(0, 170)
    const pose = poseToward({ theta: aim.theta + Math.PI * 4 + 0.1, phi: 1, radius: 3 }, 0, 170)
    expect(pose.theta).toBeCloseTo(aim.theta + Math.PI * 4)
    expect(pose.radius).toBe(3)
  })

  it('frames cities closer than countries', () => {
    expect(radiusForSpan(40)).toBeLessThan(radiusForSpan(1_500))
    expect(radiusForSpan(10)).toBeCloseTo(1.62)
    expect(radiusForSpan(100_000)).toBeCloseTo(3.4)
  })
})
