import type { FrequencyBand } from '@intoponet/frequency-field'
import { scoreSources, topographyFromSnapshot, type FieldScale } from './topography'
import {
  fieldSnapshotSchema,
  type FieldSnapshot,
  type SourceLicence,
  type SourceRecord,
} from './types'

const referenceScale = 8
const licences = new Set<SourceLicence>([
  'public-domain',
  'cc0',
  'cc-by',
  'cc-by-sa',
  'open-data',
  'link-only',
])

export function assertAttributable(source: SourceRecord): void {
  if (!source.id.trim() || !source.title.trim()) {
    throw new Error('A source needs an id and a title.')
  }
  if (!source.attribution.trim()) {
    throw new Error('A source needs attribution.')
  }
  if (!licences.has(source.licence)) {
    throw new Error('A source needs a reviewed licence.')
  }
  let url: URL
  try {
    url = new URL(source.url)
  } catch {
    throw new Error('A source needs an original URL.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('A source URL must be HTTP or HTTPS.')
  }
  if (source.kind === 'public-record' && source.topics.length === 0) {
    throw new Error('A public record needs a topic.')
  }
  if (!Number.isFinite(source.weight) || source.weight <= 0 || source.weight > 5) {
    throw new Error('A source weight must be between 0 and 5.')
  }
  if (!source.measurement || !source.measurement.kind || !source.measurement.unit.trim()) {
    throw new Error('A source needs a typed measurement and unit.')
  }
  if (source.measurement.value !== null && !Number.isFinite(source.measurement.value)) {
    throw new Error('A measurement value must be finite or explicitly unknown.')
  }
  if (!source.measurement.sourceId.trim() || !source.measurement.transformation.trim()) {
    throw new Error('A measurement needs provenance and a transformation description.')
  }
  let measurementUrl: URL
  try {
    measurementUrl = new URL(source.measurement.sourceUrl)
  } catch {
    throw new Error('A measurement needs a provenance URL.')
  }
  if (measurementUrl.protocol !== 'https:' && measurementUrl.protocol !== 'http:') {
    throw new Error('A measurement provenance URL must be HTTP or HTTPS.')
  }
}

function measurementIdentity(source: SourceRecord): [string, string, string | null, string] {
  const { kind, unit, scale } = source.measurement
  const legacyIdentity = kind === 'legacy-untyped' ? source.id : ''
  return [kind, unit, scale ?? null, legacyIdentity]
}

export function dedupeSources(sources: SourceRecord[]): SourceRecord[] {
  const seen = new Set<string>()
  const unique: SourceRecord[] = []
  for (const source of sources) {
    const key = source.url.replace(/\/$/, '').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(source)
  }
  return unique
}

export function aggregateSnapshot(
  sources: SourceRecord[],
  now = Date.parse('2026-10-23T00:00:00.000Z'),
): FieldSnapshot {
  const unique = dedupeSources(sources)
  for (const source of unique) assertAttributable(source)

  type Cell = {
    topic: string
    lat: number
    lon: number
    id: string
    measurement: SourceRecord['measurement']
    raw: number
    sources: SourceRecord[]
  }
  const cells = new Map<string, Cell>()
  const scored = scoreSources(unique, now)
  for (const source of scored) {
    const lat = Math.round(source.lat / 10) * 10
    const lon = Math.round(source.lon / 10) * 10
    const topic = source.topics[0] ?? 'open'
    const key = JSON.stringify([topic, lat, lon, measurementIdentity(source)])
    const cell = cells.get(key) ?? {
      topic,
      lat,
      lon,
      id: `band-${encodeURIComponent(key)}`,
      measurement: source.measurement,
      raw: 0,
      sources: [],
    }
    cell.raw += source.raw
    cell.sources.push(source)
    cells.set(key, cell)
  }

  const bands = [...cells.values()].map((cell) => {
    const synthetic = cell.sources.every((source) => source.kind === 'synthetic-fixture')
    return {
      id: cell.id,
      topicIds: [cell.topic],
      lat: cell.lat,
      lon: cell.lon,
      amplitude: Math.min(1, Math.log1p(cell.raw) / Math.log1p(referenceScale)),
      confidence: synthetic ? 0.3 : Math.min(0.9, 0.4 + cell.sources.length * 0.1),
      sourceIds: cell.sources.map((source) => source.id),
      sourceType: synthetic ? ('synthetic' as const) : ('public-aggregate' as const),
      measurement: {
        kind: cell.measurement.kind,
        unit: cell.measurement.unit,
        ...(cell.measurement.scale ? { scale: cell.measurement.scale } : {}),
      },
    }
  })

  const syntheticCount = unique.filter((source) => source.kind === 'synthetic-fixture').length
  return {
    schema: fieldSnapshotSchema,
    id: syntheticCount === unique.length ? 'snapshot-synthetic-v1' : `snapshot-${unique.length}`,
    algorithm: 'log1p-separated-v2',
    createdAt: new Date(now).toISOString(),
    coverageNote:
      syntheticCount > 0
        ? 'Synthetic fixture snapshot. Not public activity.'
        : 'Public records only. Coverage is the registered sources, not the whole web.',
    sources: unique,
    bands,
  }
}

export function bandsFromSnapshot(
  snapshot: FieldSnapshot,
  scale: FieldScale = 'earth',
): FrequencyBand[] {
  return topographyFromSnapshot(snapshot, scale)
}
