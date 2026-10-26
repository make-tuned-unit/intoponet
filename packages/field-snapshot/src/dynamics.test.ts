import { describe, expect, it } from 'vitest'
import { mapPublicItemGeography } from './event-geography'
import { emptyFeedHistory, reduceFeedHistory } from './feed-history'
import { aggregateFieldDynamics, parseFieldDynamicsSnapshot } from './dynamics'
import type { PublicItem, PublicSourceRecord } from './interest-contract'

const asOf = '2026-10-23T12:00:00Z'
const placeId = 'geonames:123'
const source = (id = 'feed-a', group = 'publisher-a', health: PublicSourceRecord['health'] = 'healthy'): PublicSourceRecord => ({
  schemaVersion: '1.0', sourceId: id, kind: 'rss', url: `https://${id}.example/feed.xml`, publisherName: id,
  languageTags: ['en'], declaredCoverage: { countryCodes: [], regionIds: [], cityIds: [placeId] },
  geographicScope: 'local', licenseStatus: 'approved', pollingMinSeconds: 300, health, independentPublisherGroupId: group,
})
const item = (id: string, sourceId: string, url: string, publishedAt = '2026-10-23T09:00:00Z', syndicationClusterId?: string): PublicItem => ({
  schemaVersion: '1.0', id, sourceId, canonicalUrl: url, title: 'Halifax transit update', publishedAt,
  discoveredAt: asOf, language: 'en', sourceContentHash: `${'a'.repeat(63)}${(id.length % 16).toString(16)}`, topicIds: ['transit'],
  aboutLocations: [{ placeId, lat: 44.65, lon: -63.57, radiusKm: 30, confidence: 0.8, evidence: 'explicit' }], provenanceId: `prov-${id}`,
  ...(syndicationClusterId ? { syndicationClusterId } : {}),
})
function run(rows: PublicItem[], sources: PublicSourceRecord[] = [source()], at = asOf, reviewedMappings: Array<{ mappingId: string; eventId: string; itemIds: string[]; kind: 'same-event' | 'cross-language-alias'; evidenceRef: string }> = [], coverageGroups?: [string[], string[]]) {
  const history = reduceFeedHistory(emptyFeedHistory(), {
    sources: sources.map(value => ({ source: value.health === 'healthy' ? { ...value, lastSuccessfulFetchAt: at } : value, observedAt: at })),
    items: rows.map(value => ({ item: value, observedAt: at })),
  })
  const geography = mapPublicItemGeography(rows.map(value => ({ item: value, observedAt: at })), sources, [], { lookup: () => ({ status: 'not-found', coverage: 'catalog-scope', scope: 'test' }) }, { reviewedMappings })
  const end = Date.parse(at)
  const windowMs = 6 * 3_600_000
  const groups = [...new Set(sources.filter(value => value.health === 'healthy' && value.licenseStatus === 'approved').map(value => value.independentPublisherGroupId))].sort()
  const coverageWindows = [
    { placeId, language: 'en', windowStart: new Date(end - 2 * windowMs).toISOString(), windowEnd: new Date(end - windowMs).toISOString(), healthyPublisherGroupIds: coverageGroups?.[1] ?? groups },
    { placeId, language: 'en', windowStart: new Date(end - windowMs).toISOString(), windowEnd: new Date(end).toISOString(), healthyPublisherGroupIds: coverageGroups?.[0] ?? groups },
  ]
  return aggregateFieldDynamics(history, geography, sources, { asOf: at, coverageWindows })
}

describe('public field dynamics', () => {
  it('deduplicates syndicated copies, caps publisher influence, and emits deterministic provenance IDs', () => {
    const a = source()
    const b = source('feed-b', 'publisher-b')
    const result = run([
      item('copy-a', a.sourceId, 'https://a.example/story', undefined, 'syndicated-1'),
      item('copy-b', b.sourceId, 'https://b.example/story', undefined, 'syndicated-1'),
    ], [a, b])
    const signal = result.signals[0]!
    expect(result.signals).toHaveLength(1)
    expect(signal).toMatchObject({ geography: 'about_location', placeId, observedActivity: 1, publisherGroupCount: 2, provenanceItemIds: ['copy-a', 'copy-b'] })
    const singleCopy = run([item('only-copy', a.sourceId, 'https://a.example/single')], [a]).signals[0]!
    expect(signal.decayedActivity).toBe(singleCopy.decayedActivity)
    expect(run([
      item('copy-b', b.sourceId, 'https://b.example/story', undefined, 'syndicated-1'),
      item('copy-a', a.sourceId, 'https://a.example/story', undefined, 'syndicated-1'),
    ], [b, a]).signals[0]?.id).toBe(signal.id)
    const prolific = run(Array.from({ length: 5 }, (_, index) => item(`many-${index}`, a.sourceId, `https://a.example/many-${index}`)), [a]).signals[0]!
    expect(prolific).toMatchObject({ observedActivity: 5, publisherGroupCount: 1, provenanceItemIds: ['many-0','many-1','many-2','many-3','many-4'], anomalyFlags: ['publisher-cap-applied'] })
    expect(prolific.decayedActivity).toBeLessThanOrEqual(2)
    const expandedRegistry = [a, source('feed-c', 'publisher-c'), source('feed-d', 'publisher-d')]
    const expanded = run([item('only-copy', a.sourceId, 'https://a.example/single')], expandedRegistry).signals[0]!
    expect(expanded.coverageCohort).toBe('medium')
    expect(expanded.id).toBe(singleCopy.id)
  })

  it('decays old activity, keeps intensity separate from confidence, and reports comparable momentum', () => {
    const rows = [
      item('old', 'feed-a', 'https://a.example/old', '2026-10-20T09:00:00Z'),
      item('previous', 'feed-a', 'https://a.example/previous', '2026-10-23T04:00:00Z'),
      item('recent-1', 'feed-a', 'https://a.example/recent-1', '2026-10-23T10:00:00Z'),
      item('recent-2', 'feed-a', 'https://a.example/recent-2', '2026-10-23T11:00:00Z'),
    ]
    const { signals } = run(rows)
    expect(signals[0]).toMatchObject({ momentumStatus: 'comparable', geographicConfidence: 0.8, coverageConfidence: 1, observedActivity: 2 })
    expect(signals[0]!.momentum).toBeGreaterThan(0)
    expect(signals[0]!.normalizedIntensity).toBeGreaterThan(0)
    expect(signals[0]!.decayedActivity).toBeLessThanOrEqual(signals[0]!.observedActivity)
  })

  it('leaves momentum unavailable under source outage rather than reporting a decline', () => {
    const offline = source('feed-a', 'publisher-a', 'error')
    const { signals } = run([item('story', offline.sourceId, 'https://a.example/story')], [offline])
    expect(signals[0]).toMatchObject({ momentum: null, momentumStatus: 'stale', coverageConfidence: 0 })
    expect(signals[0]!.normalizedIntensity).toBeGreaterThan(0)
  })

  it('withholds momentum unless both windows have the same complete registered coverage cohort', () => {
    const result = run([item('story', 'feed-a', 'https://a.example/story')], [source()], asOf, [], [[], ['publisher-a']])
    expect(result.signals[0]).toMatchObject({ momentum: null, momentumStatus: 'coverage-limited', coverageConfidence: 1 })
    expect(parseFieldDynamicsSnapshot({ ...result, signals: [{ ...result.signals[0]!, provenanceItemIds: ['story', 'story'] }] })).toBeNull()
    expect(parseFieldDynamicsSnapshot({ ...result, signals: [{ ...result.signals[0]!, anchors: [{ lat: 91, lon: 0, radiusKm: 1, weight: 1 }] }] })).toBeNull()
  })

  it('withholds momentum during a partial current outage even when prior windows had complete coverage', () => {
    const a = source('feed-a', 'publisher-a', 'healthy')
    const b = source('feed-b', 'publisher-b', 'error')
    const result = run([item('story', a.sourceId, 'https://a.example/story')], [a, b], asOf, [], [['publisher-a','publisher-b'], ['publisher-a','publisher-b']])
    expect(result.signals[0]).toMatchObject({ momentum: null, momentumStatus: 'coverage-limited', coverageConfidence: 0.5 })
  })

  it('filters future and unapproved observations before deduplication and aggregation', () => {
    const approvedA = source('feed-a', 'publisher-a')
    const approvedB = source('feed-b', 'publisher-b')
    const unapproved = { ...source('feed-x', 'publisher-x'), licenseStatus: 'review_required' as const }
    const a = item('approved-a', approvedA.sourceId, 'https://a.example/shared')
    const bridge = item('unapproved-bridge', unapproved.sourceId, 'https://a.example/shared', '2026-10-23T09:00:00Z', 'syndication-bridge')
    const b = item('approved-b', approvedB.sourceId, 'https://b.example/report', '2026-10-23T09:00:00Z', 'syndication-bridge')
    const filtered = run([a, bridge, b], [approvedA, approvedB, unapproved]).signals[0]!
    expect(filtered.observedActivity).toBe(2)
    expect(filtered.provenanceItemIds).toEqual(['approved-a', 'approved-b'])
    expect(run([item('not-yet-known', approvedA.sourceId, 'https://a.example/future', '2026-10-23T11:00:00Z')], [approvedA], '2026-10-23T10:00:00Z').signals).toEqual([])
  })

  it('preserves point precision when geography evidence supplies no radius', () => {
    const publisher = source()
    const row = { ...item('point-only', publisher.sourceId, 'https://a.example/point'), aboutLocations: [] }
    const history = reduceFeedHistory(emptyFeedHistory(), {
      sources: [{ source: { ...publisher, lastSuccessfulFetchAt: asOf }, observedAt: asOf }], items: [{ item: row, observedAt: asOf }],
    })
    const geography = mapPublicItemGeography([{ item: row, observedAt: asOf }], [publisher], [
      { kind: 'place-mention', itemId: row.id, field: 'title', start: 0, end: 7, ruleId: 'place-v1', relation: 'about_location', confidence: 0.7 },
    ], { lookup: () => ({ status: 'resolved', coverage: 'catalog-scope', place: { id: placeId, name: 'Halifax', kind: 'populated-place', precision: 'populated-place-point', latitude: 44.65, longitude: -63.57 } }) }, { approvedAboutLocationRuleIds: ['place-v1'] })
    const snapshot = aggregateFieldDynamics(history, geography, [publisher], { asOf })
    expect(snapshot.signals[0]?.anchors).toEqual([{ lat: 44.65, lon: -63.57, weight: 1 }])
  })

  it('uses the item language for cohorts when a publisher supports multiple languages', () => {
    const bilingual = { ...source(), languageTags: ['en', 'fr'] }
    const french = { ...item('french-story', bilingual.sourceId, 'https://a.example/fr'), language: 'fr' }
    expect(run([french], [bilingual]).signals[0]).toMatchObject({ languageCohort: 'fr' })
  })

  it('selects same-place anchor evidence deterministically when items are reordered', () => {
    const a = source()
    const b = source('feed-b', 'publisher-b')
    const low = { ...item('aaa-low', a.sourceId, 'https://a.example/same'), aboutLocations: [{ placeId, lat: 44.65, lon: -63.57, radiusKm: 25, confidence: 0.2, evidence: 'explicit' as const }] }
    const high = { ...item('zzz-high', b.sourceId, 'https://a.example/same'), aboutLocations: [{ placeId, lat: 44.66, lon: -63.58, radiusKm: 25, confidence: 0.9, evidence: 'explicit' as const }] }
    const rows = [low, high]
    const history = reduceFeedHistory(emptyFeedHistory(), {
      sources: [a, b].map(value => ({ source: { ...value, lastSuccessfulFetchAt: asOf }, observedAt: asOf })),
      items: rows.map(value => ({ item: value, observedAt: asOf })),
    })
    const geography = mapPublicItemGeography(rows.map(value => ({ item: value, observedAt: asOf })), [a, b], [], { lookup: () => ({ status: 'not-found', coverage: 'catalog-scope', scope: 'test' }) })
    const groupIds = ['publisher-a', 'publisher-b']
    const windowMs = 6 * 3_600_000
    const end = Date.parse(asOf)
    const coverageWindows = [
      { placeId, language: 'en', windowStart: new Date(end - 2 * windowMs).toISOString(), windowEnd: new Date(end - windowMs).toISOString(), healthyPublisherGroupIds: groupIds },
      { placeId, language: 'en', windowStart: new Date(end - windowMs).toISOString(), windowEnd: new Date(end).toISOString(), healthyPublisherGroupIds: groupIds },
    ]
    const first = aggregateFieldDynamics(history, geography, [a, b], { asOf, coverageWindows })
    const reversedGeo = { ...geography, events: geography.events.map(event => ({ ...event, itemIds: [...event.itemIds].reverse() })), items: [...geography.items].reverse() }
    const reversed = aggregateFieldDynamics(history, reversedGeo, [b, a], { asOf, coverageWindows })
    expect(first).toEqual(reversed)
    expect(first.signals[0]?.anchors).toEqual([{ lat: 44.66, lon: -63.58, radiusKm: 25, weight: 1 }])
  })

  it('replays new report, corroborating copy, repeated copy, aging, and outage without duplicate spikes', () => {
    const a = source()
    const b = source('feed-b', 'publisher-b')
    const first = item('first', a.sourceId, 'https://a.example/first', '2026-10-23T11:00:00Z')
    const corroborating = item('corroboration', b.sourceId, 'https://b.example/report', '2026-10-23T11:00:00Z', 'report-b')
    const copy = item('repeated-copy', a.sourceId, 'https://a.example/repeat', '2026-10-23T11:00:00Z', 'report-b')
    const mappings = [{ mappingId: 'event-map', eventId: 'event-x', itemIds: ['first', 'corroboration', 'repeated-copy'], kind: 'same-event' as const, evidenceRef: 'reviewed-event-evidence' }]
    const initial = run([first], [a]).signals[0]!
    const corroborated = run([first, corroborating], [a, b], asOf, mappings.slice(0, 1).map(mapping => ({ ...mapping, itemIds: ['first', 'corroboration'] }))).signals[0]!
    const copied = run([first, corroborating, copy], [a, b], asOf, mappings).signals[0]!
    expect(corroborated.decayedActivity).toBeGreaterThan(initial.decayedActivity)
    expect(copied.decayedActivity).toBe(corroborated.decayedActivity)
    expect(copied.observedActivity).toBe(2)
    const aged = run([first], [a], '2026-10-24T00:00:00Z').signals[0]!
    expect(aged.decayedActivity).toBeLessThan(initial.decayedActivity)
    const outage = run([first], [source('feed-a', 'publisher-a', 'error')], '2026-10-23T13:00:00Z').signals[0]!
    expect(outage).toMatchObject({ momentum: null, momentumStatus: 'stale' })
    expect(outage.normalizedIntensity).toBeGreaterThan(0)
  })

  it('keeps global and unknown activity nonspatial and labels absent coverage as unknown', () => {
    const globalItem = { ...item('global-story', 'feed-a', 'https://a.example/global'), aboutLocations: [], title: 'Worldwide transit update' }
    const rows = [globalItem]
    const sources = [source()]
    const history = reduceFeedHistory(emptyFeedHistory(), {
      sources: sources.map(value => ({ source: value, observedAt: asOf })), items: rows.map(value => ({ item: value, observedAt: asOf })),
    })
    const geography = mapPublicItemGeography(rows.map(value => ({ item: value, observedAt: asOf })), sources, [], { lookup: () => ({ status: 'not-found', coverage: 'catalog-scope', scope: 'test' }) })
    const result = aggregateFieldDynamics(history, geography, sources, { asOf })
    expect(result.signals[0]).toMatchObject({ geography: 'unknown', anchors: [], coverageConfidence: 0, coverageCohort: 'unknown', momentum: null })
    expect(result.signals[0]).not.toHaveProperty('placeId')
  })
})
