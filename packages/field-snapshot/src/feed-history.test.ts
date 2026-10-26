import { describe, expect, it } from 'vitest'
import { activityLineages, emptyFeedHistory, parseFeedHistorySnapshot, reduceFeedHistory, replayFeedHistory, snapshotFeedHistory } from './feed-history'
import type { FeedHistoryBatch } from './feed-history'
import type { PublicItem, PublicSourceRecord } from './interest-contract'

const t0 = '2026-10-23T10:00:00Z'
const t1 = '2026-10-23T10:01:00Z'
const t2 = '2026-10-23T10:02:00Z'
const t0Canonical = '2026-10-23T10:00:00.000Z'
const t1Canonical = '2026-10-23T10:01:00.000Z'
const t2Canonical = '2026-10-23T10:02:00.000Z'
const publisherA: PublicSourceRecord = {
  schemaVersion: '1.0', sourceId: 'feed-a', kind: 'rss', url: 'https://a.example/feed.xml', publisherName: 'A News', languageTags: ['en'],
  declaredCoverage: { countryCodes: ['CA'], regionIds: [], cityIds: [] }, geographicScope: 'local', licenseStatus: 'approved',
  pollingMinSeconds: 300, health: 'healthy', independentPublisherGroupId: 'group-a', lastSuccessfulFetchAt: t0,
}
const publisherACopy = { ...publisherA, sourceId: 'feed-a-copy', url: 'https://a.example/other-feed.xml', publisherName: 'A syndication feed' }
const publisherB: PublicSourceRecord = { ...publisherA, sourceId: 'feed-b', url: 'https://b.example/feed.xml', publisherName: 'B News', independentPublisherGroupId: 'group-b' }

function item(overrides: Partial<PublicItem> = {}): PublicItem {
  const base: PublicItem = {
    schemaVersion: '1.0', id: 'item-a1', sourceId: 'feed-a', canonicalUrl: 'https://a.example/story/1', title: 'Harbor transit plan',
    publishedAt: t0, discoveredAt: t0, language: 'en', sourceContentHash: 'a'.repeat(64), topicIds: ['transit'],
    aboutLocations: [], provenanceId: 'prov-a1',
  }
  return { ...base, ...overrides }
}
const batch = (sources: PublicSourceRecord[], items: Array<{ value: PublicItem; at?: string }> = [], at = t0): FeedHistoryBatch => ({
  sources: sources.map(source => ({ source: { ...source, lastSuccessfulFetchAt: source.health === 'healthy' ? at : source.lastSuccessfulFetchAt }, observedAt: at })),
  items: items.map(row => ({ item: row.value, observedAt: row.at ?? at })),
})

describe('public feed history reducer', () => {
  it('keeps stable IDs and first-seen time across repeated fetches while recording revisions', () => {
    const first = item()
    let state = reduceFeedHistory(emptyFeedHistory(), batch([publisherA], [{ value: first }]))
    state = reduceFeedHistory(state, batch([publisherA], [{ value: { ...first, discoveredAt: t1 } }], t1))
    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toMatchObject({ firstSeenAt: t0Canonical, lastSeenAt: t1Canonical, revisionCount: 0, item: { id: 'item-a1' } })
    expect(activityLineages(state)).toHaveLength(1)
    state = reduceFeedHistory(state, batch([publisherA], [{ value: { ...first, title: 'Harbor transit decision', sourceContentHash: 'b'.repeat(64), updatedAt: t2 } }], t2))
    expect(state.items[0]?.revisionCount).toBe(1)
    expect(state.items[0]?.revisions).toHaveLength(2)
  })

  it('separates publication time from observation time and quarantines missing or future times', () => {
    const late = item({ id: 'late', publishedAt: '2026-10-23T09:00:00Z', canonicalUrl: 'https://a.example/late' })
    const { publishedAt: _publishedAt, ...missingBase } = item({ id: 'missing', canonicalUrl: 'https://a.example/missing', sourceContentHash: 'c'.repeat(64) })
    const missing = missingBase
    const future = item({ id: 'future', publishedAt: '2026-10-23T11:00:00Z', canonicalUrl: 'https://a.example/future', sourceContentHash: 'd'.repeat(64) })
    const state = reduceFeedHistory(emptyFeedHistory(), batch([publisherA], [{ value: late, at: t2 }, { value: missing, at: t2 }, { value: future, at: t2 }], t2))
    expect(state.items.find(row => row.item.id === 'late')).toMatchObject({ firstSeenAt: t2Canonical, publicationStatus: 'valid' })
    expect(state.items.find(row => row.item.id === 'missing')?.publicationStatus).toBe('missing')
    expect(state.items.find(row => row.item.id === 'future')?.publicationStatus).toBe('future')
    expect(activityLineages(state).map(row => row.itemIds)).toEqual([['late']])
  })

  it('preserves item history and activity when a source reports an outage', () => {
    const first = item()
    let state = reduceFeedHistory(emptyFeedHistory(), batch([publisherA], [{ value: first }]))
    const { lastSuccessfulFetchAt: _lastSuccess, ...offlineSource } = { ...publisherA, health: 'error' as const }
    state = reduceFeedHistory(state, batch([offlineSource], [], t1))
    expect(state.sources[0]).toMatchObject({ health: 'error', observedAt: t1Canonical, lastSuccessfulFetchAt: t0Canonical })
    expect(state.items).toHaveLength(1)
    expect(activityLineages(state)).toHaveLength(1)
    const healthyQuiet = reduceFeedHistory(emptyFeedHistory(), batch([publisherA], [], t1))
    expect(healthyQuiet).toMatchObject({ items: [], sources: [{ health: 'healthy' }] })
  })

  it('deduplicates only exact canonical or explicit syndication lineage and counts declared publisher groups', () => {
    const urlA = 'https://a.example/story/1'
    const original = item({ canonicalUrl: urlA })
    const sameCanonical = item({ id: 'copy-canonical', sourceId: 'feed-a-copy', canonicalUrl: urlA, title: 'Unrelated wording', sourceContentHash: 'e'.repeat(64) })
    const syndicated = item({ id: 'copy-syndicated', sourceId: 'feed-b', canonicalUrl: 'https://b.example/reprint/1', syndicationClusterId: 'story-cluster-1', title: 'Harbor transit plan reprint', sourceContentHash: 'f'.repeat(64) })
    const linkedOriginal = { ...original, syndicationClusterId: 'story-cluster-1' }
    const independent = item({ id: 'independent', sourceId: 'feed-b', canonicalUrl: 'https://b.example/other-story', title: 'Harbor transit plan', sourceContentHash: '1'.repeat(64) })
    const state = reduceFeedHistory(emptyFeedHistory(), batch([publisherA, publisherACopy, publisherB], [
      { value: linkedOriginal }, { value: sameCanonical }, { value: syndicated }, { value: independent },
    ]))
    const lineages = activityLineages(state)
    expect(lineages).toHaveLength(2)
    expect(lineages.find(row => row.itemIds.includes('item-a1'))).toMatchObject({ distributingPublisherGroupIds: ['group-a', 'group-b'], qualifiedIndependentOriginCount: 1, originAttribution: 'unknown' })
    expect(lineages.find(row => row.itemIds.includes('independent'))?.distributingPublisherGroupIds).toEqual(['group-b'])
  })

  it('retains only the configured rolling item window', () => {
    const older = item({ id: 'older', canonicalUrl: 'https://a.example/older' })
    const newer = item({ id: 'newer', canonicalUrl: 'https://a.example/newer', sourceContentHash: '2'.repeat(64) })
    let state = reduceFeedHistory(emptyFeedHistory(), batch([publisherA], [{ value: older }]), { maxItems: 1 })
    state = reduceFeedHistory(state, batch([publisherA], [{ value: newer }], '2026-10-23T10:01:00Z'), { maxItems: 1 })
    expect(state.items.map(row => row.item.id)).toEqual(['newer'])
  })

  it('replays deterministically regardless of batch and item order, and snapshots are detached', () => {
    const a = item()
    const b = item({ id: 'item-a2', canonicalUrl: 'https://a.example/story/2', sourceContentHash: '3'.repeat(64) })
    const first = batch([publisherA], [{ value: a }, { value: b }])
    const second = batch([publisherA], [{ value: { ...a, title: 'Revised title', sourceContentHash: '4'.repeat(64) } }], t1)
    const left = replayFeedHistory([first, second])
    const right = replayFeedHistory([second, { ...first, items: [...first.items].reverse() }])
    expect(left).toEqual(right)
    const copy = snapshotFeedHistory(left)
    copy.items.pop()
    expect(left.items).toHaveLength(2)
  })

  it('uses canonical UTC instants and normalized health tie keys across batch splits', () => {
    const earlier = batch([{ ...publisherA, health: 'error' }], [], '2026-10-23T10:01:00Z')
    const later = batch([{ ...publisherA, health: 'healthy' }], [], '2026-10-23T10:01:00.500Z')
    const together = replayFeedHistory([{ sources: [...earlier.sources, ...later.sources], items: [] }])
    const split = replayFeedHistory([later, earlier])
    expect(together).toEqual(split)
    expect(split.sources[0]?.health).toBe('healthy')
    const sameInstant = batch([{ ...publisherA, health: 'error' }], [], t1)
    const sameInstantOther = batch([{ ...publisherA, health: 'stale' }], [], '2026-10-23T10:01:00.000Z')
    expect(replayFeedHistory([sameInstant, sameInstantOther])).toEqual(replayFeedHistory([{ sources: [...sameInstant.sources, ...sameInstantOther.sources], items: [] }]))
  })

  it('does not let a late older source revision replace a newer updatedAt version', () => {
    const newer = item({ title: 'Newer version', sourceContentHash: '5'.repeat(64), updatedAt: t1 })
    const older = item({ title: 'Late old copy', sourceContentHash: '6'.repeat(64), updatedAt: t0 })
    let state = reduceFeedHistory(emptyFeedHistory(), batch([publisherA], [{ value: newer }], t1))
    state = reduceFeedHistory(state, batch([publisherA], [{ value: older }], t2))
    expect(state.items[0]?.item.title).toBe('Newer version')
    expect(state.items[0]?.revisionCount).toBe(1)
  })

  it('validates persisted snapshots with closed fields and bounded totals', () => {
    const state = reduceFeedHistory(emptyFeedHistory(), batch([publisherA], [{ value: item() }]))
    expect(parseFeedHistorySnapshot(state)).toEqual(state)
    expect(parseFeedHistorySnapshot({ ...state, secret: 'private' })).toBeNull()
    expect(parseFeedHistorySnapshot({ ...state, items: [{ ...state.items[0], localNote: 'secret' }] })).toBeNull()
    expect(parseFeedHistorySnapshot({ ...state, sources: [{ ...state.sources[0], privateLabel: 'secret' }] })).toBeNull()
    expect(parseFeedHistorySnapshot({ ...state, items: Array(20_001).fill({}) })).toBeNull()
    expect(() => reduceFeedHistory(emptyFeedHistory(), { items: Array(20_001).fill({}) as never, sources: [] })).toThrow(/bounds/i)
  })

  it('reports one qualified origin for a lineage distributed by many publishers', () => {
    const sources = Array.from({ length: 100 }, (_, index): PublicSourceRecord => ({
      ...publisherA,
      sourceId: `syndicator-${index}`,
      url: `https://publisher-${index}.example/feed.xml`,
      publisherName: `Publisher ${index}`,
      independentPublisherGroupId: `distribution-group-${index}`,
    }))
    const items = sources.map((source, index) => ({ value: item({
      id: `copy-${index}`, sourceId: source.sourceId, canonicalUrl: `https://publisher-${index}.example/copy/${index}`,
      syndicationClusterId: 'one-story-origin', sourceContentHash: index.toString(16).padStart(64, '0'),
      publishedAt: index === 0 ? '2026-10-23T10:00:00.500Z' : index === 1 ? '2026-10-23T10:00:00.100Z' : '2026-10-23T10:00:01Z',
    }) }))
    const state = reduceFeedHistory(emptyFeedHistory(), batch(sources, items, t2))
    expect(activityLineages(state)).toMatchObject([{ publishedAt: '2026-10-23T10:00:00.100Z', qualifiedIndependentOriginCount: 1, originAttribution: 'unknown', distributingPublisherGroupIds: sources.map(source => source.independentPublisherGroupId).sort() }])
  })

  it('evicts items whose source state falls outside the bounded source window', () => {
    const sourceB: PublicSourceRecord = { ...publisherB }
    let state = reduceFeedHistory(emptyFeedHistory(), batch([publisherA], [{ value: item() }]))
    state = reduceFeedHistory(state, batch([sourceB], [], t1), { maxSources: 1 })
    expect(state.sources.map(source => source.sourceId)).toEqual(['feed-b'])
    expect(state.items).toEqual([])
    expect(parseFeedHistorySnapshot(state)).not.toBeNull()
  })

  it('replays repeated source polls in bounded chunks beyond the per-batch source cap', () => {
    const polls = Array.from({ length: 2_005 }, () => batch([publisherA]))
    const state = replayFeedHistory(polls)
    expect(state.sources).toHaveLength(1)
    expect(state.sources[0]?.sourceId).toBe('feed-a')
  })

  it('rejects uncontracted private fields and missing source identity', () => {
    const privateItem = { ...item(), localNote: 'personally sensitive' }
    expect(() => reduceFeedHistory(emptyFeedHistory(), batch([publisherA], [{ value: privateItem as PublicItem }]))).toThrow(/public item/i)
    expect(() => reduceFeedHistory(emptyFeedHistory(), batch([], [{ value: item() }]))).toThrow(/publisher group/i)
  })
})
