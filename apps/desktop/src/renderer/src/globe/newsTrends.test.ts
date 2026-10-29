import { describe, expect, it } from 'vitest'
import { buildNewsDigest, type CoverageIntervals, type NewsItemInput, type NewsSourceMeta } from '../../../shared/news/newsDigest'
import { fadingSignals, newsGlobeSignals, risingSignals } from './globeSignals'

const now = Date.parse('2026-10-28T12:00:00Z')
const hour = 3_600_000
const sources: NewsSourceMeta[] = [
  { sourceId: 'ca', countryCode: 'CA', publisherName: 'Canadian feed', publisherGroupId: 'ca', scope: 'national' },
  { sourceId: 'ke', countryCode: 'KE', publisherName: 'Kenyan feed', publisherGroupId: 'ke', scope: 'national' },
]
const stories = (sourceId: string, count: number, hoursAgo: number): NewsItemInput[] =>
  Array.from({ length: count }, (_, i) => ({
    sourceId,
    title: `Distinct headline ${sourceId} ${hoursAgo} ${i}`,
    url: `https://example.org/${sourceId}/${hoursAgo}/${i}`,
    publishedAt: new Date(now - hoursAgo * hour).toISOString(),
    discoveredAt: new Date(now - hoursAgo * hour).toISOString(),
  }))
const items = [...stories('ca', 8, 2), ...stories('ca', 2, 30), ...stories('ke', 2, 2), ...stories('ke', 8, 30)]
const coverage: CoverageIntervals = { ca: [[now - 48 * hour, now]], ke: [[now - 48 * hour, now]] }
const signals = (spans = coverage) => newsGlobeSignals(buildNewsDigest({ sources, items, coverage: spans, health: { ca: 'healthy', ke: 'healthy' }, now }))

describe('RSS feeds in the globe trend views', () => {
  it('populates Rising and Fading without any Wikipedia signals', () => {
    const news = signals()
    expect(news.every((signal) => signal.layer === 'news')).toBe(true)
    expect(risingSignals(news).map((signal) => signal.id)).toEqual(['news:country:CA'])
    expect(fadingSignals(news).map((signal) => signal.id)).toEqual(['news:country:KE'])
    expect(news.find((signal) => signal.id === 'news:country:CA')?.trendNote).toBe('8 stories in the last 24 h vs 2 the day before')
  })

  it('does not turn missing feed coverage into a fading signal', () => {
    const news = signals({ ...coverage, ke: [[now - 48 * hour, now - 24 * hour]] })
    expect(fadingSignals(news)).toEqual([])
    expect(news.find((signal) => signal.id === 'news:country:KE')?.momentum).toBeNull()
  })

  it('does not inflate frequency when a feed repeats its headlines', () => {
    const news = newsGlobeSignals(buildNewsDigest({ sources, items: [...items, ...items], coverage, health: { ca: 'healthy', ke: 'healthy' }, now }))
    expect(news.map((signal) => [signal.id, signal.value, signal.momentum])).toEqual(signals().map((signal) => [signal.id, signal.value, signal.momentum]))
  })
})
