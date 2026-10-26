import { describe, expect, it } from 'vitest'
import {
  isUtcTimestamp,
  parseContractFrequencyBand,
  parseInterestSignal,
  parseProvenanceManifest,
  parsePublicItem,
  parsePublicSourceRecord,
  parsePublicTileBundle,
  parseTileObservation,
} from './interest-contract'

const stamp = '2026-10-23T19:00:00Z'
const source = {
  schemaVersion: '1.0', sourceId: 'feed-city', kind: 'rss', url: 'https://news.example/feed.xml',
  publisherName: 'Example News', languageTags: ['en'],
  declaredCoverage: { countryCodes: ['CA'], regionIds: [], cityIds: ['halifax'] },
  geographicScope: 'local', licenseStatus: 'approved', pollingMinSeconds: 120,
  health: 'healthy', independentPublisherGroupId: 'publisher-example',
}
const item = {
  schemaVersion: '1.0', id: 'item-1', sourceId: 'feed-city', canonicalUrl: 'https://news.example/story/1',
  title: 'A local story', publishedAt: stamp, discoveredAt: stamp, language: 'en',
  sourceContentHash: 'a'.repeat(64), topicIds: ['housing'],
  aboutLocations: [{ placeId: 'halifax', lat: 44.65, lon: -63.57, radiusKm: 20, confidence: 0.8, evidence: 'entity_linked' }],
  provenanceId: 'prov-item-1',
  updatedAt: stamp,
}
const signal = {
  schemaVersion: '1.0', id: 'signal-1', topicId: 'housing', sourceType: 'rss', geographyKind: 'about_location',
  anchors: [{ lat: 44.65, lon: -63.57, weight: 1, radiusKm: 20 }],
  observationStart: '2026-10-23T18:00:00Z', observationEnd: stamp, intensity: 0.7, momentum: 0.2,
  geoConfidence: 0.8, coverageConfidence: 0.6, independentSourceCount: 2,
  provenanceIds: ['prov-item-1'], updatedAt: stamp,
}
const band = {
  schemaVersion: '1.0', id: 'band-housing-1', topicIds: ['housing'],
  centerline: [{ lat: 44.6, lon: -63.6 }, { lat: 44.7, lon: -63.5 }],
  widthKm: 40, wavelengthKm: 80, amplitude: 0.7, phase: 0, phaseVelocity: 0.02, confidence: 0.8, updatedAt: stamp,
}
const manifest = {
  schemaVersion: '1.0', id: 'manifest-1', generatedAt: stamp,
  entries: [{ provenanceId: 'prov-item-1', sourceId: 'feed-city', itemIds: ['item-1'], canonicalUrls: ['https://news.example/story/1'], observedAt: stamp }],
}
const observation = {
  schemaVersion: '1.0', tileId: 'tile-7', resolution: 7, bucketStart: '2026-10-23T18:00:00Z', bucketEnd: stamp,
  topicId: 'housing', observedActivity: 2, normalizedIntensity: 0.7, momentum: 0.2,
  independentSourceCount: 2, itemCount: 2, geographicConfidence: 0.8, coverageConfidence: 0.6,
  coverageState: 'observed', provenanceManifestId: 'manifest-1', processedAt: stamp,
}
const publicBundle = () => ({
  schemaVersion: '1.0', id: 'bundle-1', dataKind: 'public', generatedAt: stamp, tilePublishedAt: stamp,
  normalizationVersion: 'observed-activity-v1', signals: [signal], bands: [band], observations: [observation],
  sources: [source], items: [item], provenance: manifest,
})

describe('versioned interest contracts', () => {
  it('accepts a complete public bundle and parses each entity', () => {
    const bundle = publicBundle()
    expect(parseInterestSignal(signal)).toEqual(signal)
    expect(parseContractFrequencyBand(band)).toEqual(band)
    expect(parsePublicSourceRecord(source)).toEqual(source)
    expect(parsePublicItem(item)).toEqual(item)
    expect(parseTileObservation(observation)).toEqual(observation)
    expect(parseProvenanceManifest(manifest)).toEqual(manifest)
    expect(parsePublicTileBundle(bundle)).toEqual(bundle)
    expect(parsePublicTileBundle(JSON.stringify(bundle))).toEqual(bundle)
  })

  it('requires real UTC calendar timestamps and ordered windows', () => {
    expect(isUtcTimestamp('2026-02-30T12:00:00Z')).toBe(false)
    expect(isUtcTimestamp('2026-10-23T12:00:00-03:00')).toBe(false)
    expect(isUtcTimestamp('2026-10-23T12:00:00.12Z')).toBe(true)
    expect(parseInterestSignal({ ...signal, observationEnd: '2026-10-22T18:00:00Z' })).toBeNull()
    expect(parseTileObservation({ ...observation, bucketEnd: observation.bucketStart })).toBeNull()
  })

  it('keeps global and unknown signals unanchored, and rejects fabricated coordinates', () => {
    expect(parseInterestSignal({ ...signal, geographyKind: 'global', anchors: [] })).not.toBeNull()
    expect(parseInterestSignal({ ...signal, geographyKind: 'unknown', anchors: [] })).not.toBeNull()
    expect(parseInterestSignal({ ...signal, geographyKind: 'global' })).toBeNull()
    expect(parseInterestSignal({ ...signal, anchors: [{ ...signal.anchors[0], lat: 91 }] })).toBeNull()
  })

  it('rejects unknown executable fields and oversized or invalid values', () => {
    expect(parseContractFrequencyBand({ ...band, shader: 'void main() {}' })).toBeNull()
    expect(parseInterestSignal({ ...signal, intensity: Number.NaN })).toBeNull()
    expect(parseInterestSignal({ ...signal, provenanceIds: Array(257).fill('p') })).toBeNull()
    expect(parsePublicItem({ ...item, aboutLocations: [{ ...item.aboutLocations[0], radiusKm: 20_101 }] })).toBeNull()
    expect(parsePublicItem({ ...item, sourceContentHash: ['a'.repeat(64)] })).toBeNull()
    expect(parsePublicItem({ ...item, language: 'invalid language!' })).toBeNull()
    expect(parsePublicSourceRecord({ ...source, arbitrary: true })).toBeNull()
    expect(parsePublicTileBundle({ ...publicBundle(), normalizationVersion: 'x'.repeat(1_000_001) })).toBeNull()
    expect(parsePublicTileBundle(`${' '.repeat(1_000_001)}{}`)).toBeNull()
    expect(parsePublicSourceRecord({ ...source, languageTags: ['not a language tag!'] })).toBeNull()
  })

  it('requires manifest references to resolve and does not mix synthetic/public signals', () => {
    expect(parsePublicTileBundle({ ...publicBundle(), items: [{ ...item, sourceId: 'missing' }] })).toBeNull()
    expect(parsePublicTileBundle({ ...publicBundle(), observations: [{ ...observation, provenanceManifestId: 'missing' }] })).toBeNull()
    expect(parsePublicTileBundle({ ...publicBundle(), signals: [{ ...signal, sourceType: 'synthetic' }] })).toBeNull()
    const secondSource = { ...source, sourceId: 'feed-other', url: 'https://other.example/feed.xml', independentPublisherGroupId: 'publisher-other' }
    expect(parsePublicTileBundle({ ...publicBundle(), sources: [source, secondSource], provenance: { ...manifest, entries: [{ ...manifest.entries[0], sourceId: 'feed-other' }] } })).toBeNull()
    expect(parsePublicTileBundle({ ...publicBundle(), provenance: { ...manifest, entries: [{ ...manifest.entries[0], canonicalUrls: ['https://news.example/other'] }] } })).toBeNull()
    expect(parsePublicTileBundle({ ...publicBundle(), signals: [{ ...signal, provenanceIds: [] }] })).toBeNull()
    const emptyEvidence = {
      ...publicBundle(), items: [],
      signals: [{ ...signal, provenanceIds: ['prov-empty'] }],
      provenance: { ...manifest, entries: [{ ...manifest.entries[0], provenanceId: 'prov-empty', itemIds: [], canonicalUrls: [] }] },
    }
    expect(parsePublicTileBundle(emptyEvidence)).toBeNull()
    const global = { ...signal, id: 'global-1', geographyKind: 'global', anchors: [] }
    expect(parseInterestSignal(global)).not.toBeNull()
  })

  it('supports isolated synthetic bundles with explicit synthetic provenance IDs', () => {
    const syntheticSignal = { ...signal, sourceType: 'synthetic', provenanceIds: ['synthetic-fixture-1'] }
    const syntheticBundle = {
      schemaVersion: '1.0', id: 'synthetic-bundle', dataKind: 'synthetic', generatedAt: stamp,
      tilePublishedAt: stamp, normalizationVersion: 'fixture-v1', signals: [syntheticSignal], bands: [band],
      observations: [{ ...observation, provenanceManifestId: 'synthetic-manifest' }], sources: [], items: [],
      provenance: { schemaVersion: '1.0', id: 'synthetic-manifest', generatedAt: stamp,
        entries: [{ provenanceId: 'synthetic-fixture-1', sourceId: 'synthetic:fixture', itemIds: [], canonicalUrls: [], observedAt: stamp }] },
    }
    expect(parsePublicTileBundle(syntheticBundle)).not.toBeNull()
    expect(parsePublicTileBundle({ ...syntheticBundle, sources: [source] })).toBeNull()
  })

  it('allows coverage-only observations for topics with no signal yet', () => {
    const coverageOnly = {
      schemaVersion: '1.0', id: 'coverage-only', dataKind: 'public', generatedAt: stamp,
      tilePublishedAt: stamp, normalizationVersion: 'observed-activity-v1', signals: [], bands: [],
      observations: [{ ...observation, coverageState: 'insufficient', observedActivity: 0, normalizedIntensity: 0,
        independentSourceCount: 0, itemCount: 0, provenanceManifestId: 'coverage-manifest' }],
      sources: [], items: [],
      provenance: { schemaVersion: '1.0', id: 'coverage-manifest', generatedAt: stamp, entries: [] },
    }
    expect(parsePublicTileBundle(coverageOnly)).not.toBeNull()
  })
})
