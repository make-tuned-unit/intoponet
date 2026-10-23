export type { FieldSnapshot, SnapshotBand, SourceKind, SourceLicence, SourceRecord } from './types'
export { fieldSnapshotSchema } from './types'
export { aggregateSnapshot, assertAttributable, bandsFromSnapshot, dedupeSources } from './aggregate'
export {
  dedupFactor,
  geographicRelevance,
  haversineKm,
  rawTotal,
  scoreSources,
  topographyFromSnapshot,
} from './topography'
export type { FieldScale, ScoredSource } from './topography'
export { demoFieldSnapshot, syntheticRegistry } from './fixtures'
export {
  hitsFromGeosearch,
  parseFieldSnapshot,
  publicAnchors,
  publicFieldSnapshot,
  recordsFromHits,
  snapshotLabel,
  viewsFromPayload,
  weightFromViews,
  wikipediaAttribution,
  wikipediaCoverage,
  wikipediaTitlePath,
  coverageForRecords,
} from './wikipedia'
export { recordsFromQuakes, usgsAttribution, usgsFeed, weightFromMagnitude } from './usgs'
export type { WikipediaHit } from './wikipedia'
