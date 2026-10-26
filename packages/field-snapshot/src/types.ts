export const legacyFieldSnapshotSchema = 'intoponet.field-snapshot.v1' as const
export const fieldSnapshotSchema = 'intoponet.field-snapshot.v2' as const

export type MeasurementKind =
  | 'wikimedia-pageviews'
  | 'usgs-earthquake-magnitude'
  | 'synthetic-fixture'
  | 'declared-index'
  | 'legacy-pageviews-weight'
  | 'legacy-earthquake-weight'
  | 'legacy-untyped'

export type SourceMeasurement = {
  kind: MeasurementKind
  value: number | null
  unit: string
  sourceId: string
  sourceUrl: string
  transformation: string
  windowStart?: string
  windowEnd?: string
  scale?: string
}

export type SourceLicence = 'public-domain' | 'cc0' | 'cc-by' | 'cc-by-sa' | 'open-data' | 'link-only'

export type SourceKind = 'synthetic-fixture' | 'public-record'

export type SourceRecord = {
  id: string
  kind: SourceKind
  title: string
  url: string
  licence: SourceLicence
  attribution: string
  retrievedAt: string
  lat: number
  lon: number
  radiusKm: number
  topics: string[]
  /** Bounded scoring input, comparable only inside the same measurement group. */
  weight: number
  publishedAt: string
  measurement: SourceMeasurement
}

export type SnapshotBand = {
  id: string
  topicIds: string[]
  lat: number
  lon: number
  amplitude: number
  confidence: number
  sourceIds: string[]
  sourceType: 'synthetic' | 'public-aggregate'
  measurement: {
    kind: MeasurementKind
    unit: string
    scale?: string
  }
}

export type FieldSnapshot = {
  schema: typeof fieldSnapshotSchema
  id: string
  algorithm: 'log1p-separated-v2'
  createdAt: string
  coverageNote: string
  sources: SourceRecord[]
  bands: SnapshotBand[]
}
