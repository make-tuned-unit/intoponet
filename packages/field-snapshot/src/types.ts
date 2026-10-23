export const fieldSnapshotSchema = 'intoponet.field-snapshot.v1' as const

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
  weight: number
  publishedAt: string
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
}

export type FieldSnapshot = {
  schema: typeof fieldSnapshotSchema
  id: string
  algorithm: 'log1p-v1'
  createdAt: string
  coverageNote: string
  sources: SourceRecord[]
  bands: SnapshotBand[]
}
