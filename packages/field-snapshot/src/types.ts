export const legacyFieldSnapshotSchema = 'intoponet.field-snapshot.v1' as const
export const fieldSnapshotSchema = 'intoponet.field-snapshot.v2' as const

export type MeasurementKind =
  | 'wikimedia-pageviews'
  | 'usgs-earthquake-magnitude'
  | 'nasa-eonet-event'
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
  /** Short plain-text description from the source (≤ 280 chars). */
  summary?: string
  /** Human-readable place, when the source names one (≤ 120 chars). */
  placeLabel?: string
  /** HTTPS preview image published by the source. */
  thumbnail?: string
  /** When the source reports the event as closed. */
  endedAt?: string
  /**
   * Same measurement for the previous comparable window (e.g. the previous
   * UTC day's pageviews). null means absent from that window's list; undefined
   * means no comparison was available.
   */
  previousValue?: number | null
  /** A Wikipedia article about this event, checked to exist (never a search). */
  articleUrl?: string
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
  algorithm: 'log1p-separated-v2' | 'log1p-separated-v3'
  createdAt: string
  coverageNote: string
  sources: SourceRecord[]
  bands: SnapshotBand[]
}
