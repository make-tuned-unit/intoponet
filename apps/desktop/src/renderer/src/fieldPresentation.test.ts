import { describe, expect, it } from 'vitest'
import type { FieldSnapshot, SourceRecord } from '@intoponet/field-snapshot'
import { resolveSelectedTopic, snapshotKind, topicOptions } from './fieldPresentation'

const source = (overrides: Partial<SourceRecord> = {}): SourceRecord => ({
  id: 'wiki-one', kind: 'public-record', title: 'Public page', url: 'https://example.test/page', licence: 'cc-by', attribution: 'Example',
  retrievedAt: '2026-10-24T12:00:00.000Z', lat: 44, lon: -63, radiusKm: 50, topics: ['open-knowledge'], weight: 1,
  publishedAt: '2026-10-24T11:00:00.000Z',
  measurement: { kind: 'wikimedia-pageviews', value: 12, unit: 'views', sourceId: 'pageviews', sourceUrl: 'https://example.test/api', transformation: 'fixture' },
  ...overrides,
})

const snapshot = (sources: SourceRecord[]): FieldSnapshot => ({
  schema: 'intoponet.field-snapshot.v2', id: 'snapshot-test', algorithm: 'log1p-separated-v2', createdAt: '2026-10-24T12:00:00.000Z',
  coverageNote: 'Fixture coverage note', sources, bands: [],
})

describe('field topic presentation', () => {
  it('uses actual snapshot topics and labels their public measurement kind', () => {
    const topics = topicOptions(snapshot([source(), source({ id: 'quake-one', title: 'Earthquake', topics: ['earthquake'], measurement: {
      kind: 'usgs-earthquake-magnitude', value: 4.2, unit: 'magnitude', sourceId: 'usgs', sourceUrl: 'https://example.test/quakes', transformation: 'fixture',
    } })]))
    expect(topics).toContainEqual({ id: 'open-knowledge', label: 'Open knowledge', kind: 'public', measurements: ['Wikimedia pageviews'] })
    expect(topics).toContainEqual({ id: 'earthquake', label: 'Earthquake', kind: 'public', measurements: ['USGS earthquake magnitude'] })
    expect(resolveSelectedTopic(topics, 'Open knowledge')?.id).toBe('open-knowledge')
    expect(resolveSelectedTopic(topics, 'open-knowledge')?.label).toBe('Open knowledge')
  })

  it('falls back to a real topic when a persisted label is absent and marks synthetic fixtures honestly', () => {
    const onlySynthetic = source({ id: 'fixture', kind: 'synthetic-fixture', measurement: {
      kind: 'synthetic-fixture', value: 1, unit: 'fixture', sourceId: 'fixture', sourceUrl: 'https://example.test/fixture', transformation: 'fixed',
    } })
    const value = snapshot([onlySynthetic])
    expect(snapshotKind(value)).toBe('synthetic')
    expect(topicOptions(value)[0]?.kind).toBe('synthetic')
    expect(resolveSelectedTopic(topicOptions(value), 'unavailable old topic')?.id).toBe('open-knowledge')
    expect(snapshotKind(snapshot([source(), onlySynthetic]))).toBe('mixed')
  })
})
