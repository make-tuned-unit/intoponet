import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mapPublicItemGeography, sha256Hex, type GeographyAnnotation, type PlaceLookupResult, type PublicItemObservation } from './event-geography'
import type { PublicItem, PublicSourceRecord } from './interest-contract'

const observedAt = '2026-10-23T12:00:00Z'
const sourceA: PublicSourceRecord = {
  schemaVersion: '1.0', sourceId: 'feed-a', kind: 'rss', url: 'https://a.example/feed.xml', publisherName: 'Harbor Gazette', languageTags: ['en'],
  declaredCoverage: { countryCodes: ['CA'], regionIds: [], cityIds: [] }, geographicScope: 'local', licenseStatus: 'approved',
  pollingMinSeconds: 300, health: 'healthy', independentPublisherGroupId: 'publisher-a',
}
const sourceB: PublicSourceRecord = { ...sourceA, sourceId: 'feed-b', url: 'https://b.example/feed.xml', publisherName: 'Daily Wire', independentPublisherGroupId: 'publisher-b', languageTags: ['fr'] }
function item(overrides: Partial<PublicItem> = {}): PublicItem {
  return {
    schemaVersion: '1.0', id: 'item-a', sourceId: 'feed-a', canonicalUrl: 'https://a.example/story/1', title: 'Flooding reported in Halifax',
    publishedAt: '2026-10-23T11:30:00Z', discoveredAt: observedAt, language: 'en', sourceContentHash: 'a'.repeat(64), topicIds: ['flooding'],
    aboutLocations: [], provenanceId: 'prov-a',
    ...overrides,
  }
}
const observations = (...items: PublicItem[]): PublicItemObservation[] => items.map(value => ({ item: value, observedAt }))

const placeResult = (name: string): PlaceLookupResult => {
  if (name.toLocaleLowerCase('en') === 'springfield') return {
    status: 'ambiguous', coverage: 'catalog-scope', candidates: [
      { id: 'geonames:111', name: 'Springfield', kind: 'populated-place', precision: 'populated-place-point', latitude: 44.0, longitude: -63.0 },
      { id: 'geonames:222', name: 'Springfield', kind: 'populated-place', precision: 'populated-place-point', latitude: 45.0, longitude: -62.0 },
    ],
  }
  if (name.toLowerCase() === 'halifax') return {
    status: 'resolved', coverage: 'catalog-scope', place: { id: 'geonames:123', name: 'Halifax', kind: 'populated-place', precision: 'populated-place-point', latitude: 44.65, longitude: -63.57 },
  }
  if (name.toLowerCase() === 'countryland') return {
    status: 'resolved', coverage: 'catalog-scope', place: { id: 'geonames:900', name: 'Countryland', kind: 'country', precision: 'country' },
  }
  return { status: 'not-found', coverage: 'catalog-scope', scope: 'cities15000-subset' }
}
const lookup = { lookup: placeResult }

function mention(value: Partial<GeographyAnnotation> & Pick<GeographyAnnotation, 'itemId' | 'start' | 'end'>): GeographyAnnotation {
  return { kind: 'place-mention', field: 'title', itemId: value.itemId, start: value.start, end: value.end, ruleId: 'title-about-v1', relation: 'about_location', confidence: 0.72 }
}

describe('event geography enrichment', () => {
  it('preserves ambiguous same-name places without choosing a city', () => {
    const row = item({ id: 'ambiguous', title: 'The Springfield vote is today', canonicalUrl: 'https://a.example/springfield' })
    const result = mapPublicItemGeography(observations(row), [sourceA], [mention({ itemId: row.id, start: 4, end: 15 })], lookup, { approvedAboutLocationRuleIds: ['title-about-v1'] })
    expect(result.items[0]).toMatchObject({ geography: 'ambiguous', anchors: [] })
    expect(result.items[0]?.evidence[0]?.candidatePlaceIds).toEqual(['geonames:111', 'geonames:222'])
  })

  it('separates a publisher location mention from the event subject location', () => {
    const row = item({ id: 'hq', title: 'Company announces new office', canonicalUrl: 'https://a.example/hq' })
    const publisher = { ...sourceA, publisherName: 'Halifax Harbor Gazette' }
    const annotation: GeographyAnnotation = { kind: 'place-mention', itemId: row.id, field: 'publisherName', start: 0, end: 7, ruleId: 'publisher-name-place-v1', relation: 'publisher_location', confidence: 1 }
    const result = mapPublicItemGeography(observations(row), [publisher], [annotation], lookup)
    expect(result.items[0]).toMatchObject({ geography: 'unknown', anchors: [] })
    expect(result.items[0]?.evidence[0]).toMatchObject({ field: 'publisherName', relation: 'publisher_location', resolution: 'resolved' })
    expect(() => mapPublicItemGeography(observations(row), [publisher], [{ ...annotation, relation: 'about_location' }], lookup)).toThrow(/publisher-name/i)
  })

  it('requires an approved explicit title rule and records source span, rule, confidence, and coarse precision', () => {
    const row = item()
    const annotation = mention({ itemId: row.id, start: 21, end: 28 })
    const denied = mapPublicItemGeography(observations(row), [sourceA], [annotation], lookup)
    expect(denied.items[0]).toMatchObject({ geography: 'unknown', anchors: [] })
    const admitted = mapPublicItemGeography(observations(row), [sourceA], [annotation], lookup, { approvedAboutLocationRuleIds: ['title-about-v1'] })
    expect(admitted.items[0]).toMatchObject({ geography: 'localized', anchors: [{ placeId: 'geonames:123', precision: 'populated-place-point' }] })
    expect(admitted.items[0]?.anchors[0]).not.toHaveProperty('radiusKm')
    expect(admitted.items[0]?.evidence[0]).toMatchObject({ matchedText: 'Halifax', start: 21, end: 28, ruleId: 'title-about-v1', confidence: 0.72 })
  })

  it('retains a coarse country resolution without manufacturing a point or neighborhood radius', () => {
    const row = item({ id: 'country', title: 'Countryland reports a new policy', canonicalUrl: 'https://a.example/country' })
    const countryMention = mention({ itemId: row.id, start: 0, end: 11 })
    const result = mapPublicItemGeography(observations(row), [sourceA], [countryMention], lookup, { approvedAboutLocationRuleIds: ['title-about-v1'] })
    expect(result.items[0]).toMatchObject({ geography: 'localized', anchors: [], evidence: [{ resolution: 'resolved', candidatePlaceIds: ['geonames:900'] }] })
  })

  it('treats validated PublicItem.aboutLocations as subject geography and preserves global conflicts', () => {
    const row = item({ id: 'contract-location', aboutLocations: [{ placeId: 'geonames:123', lat: 44.65, lon: -63.57, radiusKm: 35, confidence: 0.6, evidence: 'entity_linked' }] })
    const localized = mapPublicItemGeography(observations(row), [sourceA], [], lookup)
    expect(localized.items[0]).toMatchObject({ geography: 'localized', anchors: [{ placeId: 'geonames:123', radiusKm: 35, precision: 'contract-radius' }] })
    const global: GeographyAnnotation = { kind: 'global-scope', itemId: row.id, field: 'title', start: 0, end: 8, ruleId: 'global-v1', confidence: 0.8 }
    const conflict = mapPublicItemGeography(observations(row), [sourceA], [global], lookup, { approvedGlobalRuleIds: ['global-v1'] })
    expect(conflict.items[0]?.geography).toBe('ambiguous')
  })

  it('does not infer incident location from an organization or publisher mention in a title', () => {
    const row = item({ id: 'org', title: 'Acme headquarters in Halifax announces hiring', canonicalUrl: 'https://a.example/org' })
    const organizationContext: GeographyAnnotation = { kind: 'place-mention', itemId: row.id, field: 'title', start: 21, end: 28, ruleId: 'organization-context-v1', relation: 'unknown', confidence: 0.5 }
    const result = mapPublicItemGeography(observations(row), [sourceA], [organizationContext], lookup, { approvedAboutLocationRuleIds: ['title-about-v1'] })
    expect(result.items[0]).toMatchObject({ geography: 'unknown', anchors: [] })
  })

  it('keeps global, unknown, and missing/future publication time states distinct', () => {
    const globalItem = item({ id: 'global', title: 'Worldwide outage affects services', canonicalUrl: 'https://a.example/global' })
    const explicitGlobal: GeographyAnnotation = { kind: 'global-scope', itemId: 'global', field: 'title', start: 0, end: 9, ruleId: 'global-marker-v1', confidence: 0.9 }
    const future = item({ id: 'future', canonicalUrl: 'https://a.example/future', publishedAt: '2026-10-23T13:00:00Z' })
    const { publishedAt: _publishedAt, ...missingBase } = item({ id: 'missing', canonicalUrl: 'https://a.example/missing' })
    const missing = missingBase
    const result = mapPublicItemGeography(observations(globalItem, future, missing), [sourceA], [explicitGlobal], lookup, { approvedGlobalRuleIds: ['global-marker-v1'] })
    expect(result.items.find(row => row.itemId === 'global')?.geography).toBe('global')
    expect(result.items.find(row => row.itemId === 'future')?.publicationStatus).toBe('future')
    expect(result.items.find(row => row.itemId === 'missing')?.publicationStatus).toBe('missing')
    expect(result.items.find(row => row.itemId === 'future')?.eventAt).toBe('2026-10-23T13:00:00.000Z')
  })

  it('links cross-language events only through reviewed mappings and keeps same-name stories separate', () => {
    const english = item({ id: 'news-en', canonicalUrl: 'https://a.example/strike', title: 'Transit strike starts', language: 'en' })
    const french = item({ id: 'news-fr', sourceId: 'feed-b', canonicalUrl: 'https://b.example/greve', title: 'La grève du transport commence', language: 'fr', sourceContentHash: 'b'.repeat(64) })
    const unrelatedA = item({ id: 'springfield-a', canonicalUrl: 'https://a.example/springfield/a', title: 'Springfield vote today' })
    const unrelatedB = item({ id: 'springfield-b', sourceId: 'feed-b', canonicalUrl: 'https://b.example/springfield/b', title: 'Springfield vote today', sourceContentHash: 'c'.repeat(64) })
    const result = mapPublicItemGeography(observations(english, french, unrelatedA, unrelatedB), [sourceA, sourceB], [], lookup, {
      reviewedMappings: [{ mappingId: 'review-1', eventId: 'shared-transit-event', itemIds: ['news-en', 'news-fr'], kind: 'cross-language-alias', evidenceRef: 'source-item:news-en' }],
    })
    const linkedId = result.items.find(row => row.itemId === 'news-en')?.eventId
    expect(linkedId).toMatch(/^event:reviewed-[a-f0-9]{64}$/)
    expect(result.items.find(row => row.itemId === 'news-fr')?.eventId).toBe(linkedId)
    expect(result.items.find(row => row.itemId === 'springfield-a')?.eventId).not.toBe(result.items.find(row => row.itemId === 'springfield-b')?.eventId)
    expect(() => mapPublicItemGeography(observations(english, { ...french, language: 'en' }), [sourceA, sourceB], [], lookup, {
      reviewedMappings: [{ mappingId: 'bad-review', eventId: 'x-event', itemIds: ['news-en', 'news-fr'], kind: 'cross-language-alias', evidenceRef: 'source-item:news-en' }],
    })).toThrow(/multiple declared languages/i)
  })

  it('uses exact canonical and explicit syndication lineage only, with distribution distinct from origin', () => {
    const canonicalCopy = item({ id: 'same-url-copy', sourceId: 'feed-b', canonicalUrl: 'https://a.example/story/1#section', sourceContentHash: 'd'.repeat(64) })
    const syndicationCopy = item({ id: 'syndicated-copy', sourceId: 'feed-b', canonicalUrl: 'https://b.example/repost/1', syndicationClusterId: 'syndicated-story-1', sourceContentHash: 'e'.repeat(64) })
    const original = item({ syndicationClusterId: 'syndicated-story-1' })
    const result = mapPublicItemGeography(observations(original, canonicalCopy, syndicationCopy), [sourceA, sourceB], [], lookup)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({ distributingPublisherGroupIds: ['publisher-a', 'publisher-b'], deduplicatedReportLineageCount: 1, originAttribution: 'unknown' })
    expect(result.events[0]?.lineageEvidence).toEqual(['exact-canonical-url', 'explicit-syndication-cluster'])
  })

  it('keeps a canonical URL event ID stable as identical copies arrive and across reorder', () => {
    const original = item({ id: 'first-copy' })
    const copy = item({ id: 'second-copy', sourceId: 'feed-b', sourceContentHash: 'f'.repeat(64) })
    const first = mapPublicItemGeography(observations(original), [sourceA, sourceB], [], lookup)
    const expanded = mapPublicItemGeography(observations(copy, original), [sourceB, sourceA], [], lookup)
    const reordered = mapPublicItemGeography(observations(original, copy), [sourceA, sourceB], [], lookup)
    expect(first.items[0]?.eventId).toBe(expanded.items[0]?.eventId)
    expect(reordered).toEqual(expanded)
    expect(expanded.events[0]?.itemIds).toEqual(['first-copy', 'second-copy'])
    expect(first.items[0]?.eventId).toBe('event:url-9d20a9f1d53267b9f0cc070bbd84674113c6ff3ed2a45195d2f38361aaa34bc2')
    expect(expanded.items[0]?.eventId).not.toContain('https://')
  })

  it('matches Node SHA-256 for Unicode multi-block canonical URLs', () => {
    const inputUrl = `https://例え.テスト/記事/${'長いセグメント-'.repeat(12)}?lang=日本語#section`
    const normalized = new URL(inputUrl)
    normalized.hash = ''
    const itemUrl = item({ id: 'unicode-url', canonicalUrl: inputUrl, title: 'Unicode article' })
    const output = mapPublicItemGeography(observations(itemUrl), [sourceA], [], lookup)
    const expected = createHash('sha256').update(normalized.href, 'utf8').digest('hex')
    expect(sha256Hex(normalized.href)).toBe(expected)
    expect(output.items[0]?.eventId).toBe(`event:url-${expected}`)
  })

  it('merges disjoint reviewed mappings that declare the same event ID', () => {
    const a = item({ id: 'review-a', canonicalUrl: 'https://a.example/a' })
    const b = item({ id: 'review-b', sourceId: 'feed-b', canonicalUrl: 'https://b.example/b', sourceContentHash: '1'.repeat(64) })
    const c = item({ id: 'review-c', canonicalUrl: 'https://a.example/c', sourceContentHash: '2'.repeat(64) })
    const d = item({ id: 'review-d', sourceId: 'feed-b', canonicalUrl: 'https://b.example/d', sourceContentHash: '3'.repeat(64) })
    const rows = observations(a, b, c, d)
    const mappings = [
      { mappingId: 'review-ab', eventId: 'same-event', itemIds: ['review-a', 'review-b'], kind: 'same-event' as const, evidenceRef: 'review:record-ab' },
      { mappingId: 'review-cd', eventId: 'same-event', itemIds: ['review-c', 'review-d'], kind: 'same-event' as const, evidenceRef: 'review:record-cd' },
    ]
    const merged = mapPublicItemGeography(rows, [sourceA, sourceB], [], lookup, { reviewedMappings: mappings })
    expect(merged.events).toHaveLength(1)
    expect(merged.events[0]?.itemIds).toEqual(['review-a', 'review-b', 'review-c', 'review-d'])
    expect(mapPublicItemGeography(rows, [sourceA, sourceB], [], lookup, { reviewedMappings: [...mappings].reverse() })).toEqual(merged)
  })

  it('rejects private item fields and fabricated annotation spans', () => {
    const row = item()
    expect(() => mapPublicItemGeography(observations({ ...row, privateTag: 'forbidden' } as PublicItem), [sourceA], [], lookup)).toThrow(/public item/i)
    expect(() => mapPublicItemGeography(observations(row), [sourceA], [mention({ itemId: row.id, start: 50, end: 57 })], lookup)).toThrow(/span is outside/i)
  })

  it('does not allow a supplied publication status to promote missing or future dates', () => {
    const future = item({ id: 'future-override', canonicalUrl: 'https://a.example/future-override', publishedAt: '2026-10-23T13:00:00Z' })
    expect(() => mapPublicItemGeography([{ item: future, observedAt: observedAt, publicationStatus: 'valid' }], [sourceA], [], lookup)).toThrow(/conflicts/i)
    const { publishedAt: _publishedAt, ...withoutDate } = item({ id: 'missing-override', canonicalUrl: 'https://a.example/missing-override' })
    expect(() => mapPublicItemGeography([{ item: withoutDate, observedAt: observedAt, publicationStatus: 'valid' }], [sourceA], [], lookup)).toThrow(/conflicts/i)
  })
})
