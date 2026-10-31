import { describe, expect, it } from 'vitest'
import { placeTrends } from './placeTrends'
import type { NewsItemInput, NewsSourceMeta } from './newsDigest'

const now = Date.parse('2026-10-28T12:00:00Z')
const hours = (h: number): string => new Date(now - h * 3_600_000).toISOString()
const sources: NewsSourceMeta[] = [
  { sourceId: 'a', countryCode: 'CD', publisherName: 'Radio Okapi', publisherGroupId: 'okapi', scope: 'national', language: 'fr' },
  { sourceId: 'b', countryCode: 'CD', publisherName: 'Goma24', publisherGroupId: 'goma24', scope: 'local', cityName: 'Goma', language: 'fr' },
  { sourceId: 'c', countryCode: 'RW', publisherName: 'New Times', publisherGroupId: 'nt', scope: 'national', language: 'en' },
]
const whole: [number, number][] = [[now - 50 * 3_600_000, now]]
const coverage = { a: whole, b: whole, c: whole }
const item = (sourceId: string, title: string, h: number): NewsItemInput => ({ sourceId, title, url: `https://x/${encodeURIComponent(title)}`, publishedAt: hours(h), discoveredAt: hours(h) })

describe('rising and fading in one place', () => {
  const items = [
    item('b', 'Choléra : nouveaux cas signalés à Goma', 2), item('a', 'Goma : le choléra gagne trois quartiers', 5), item('c', 'Cholera spreads in Goma camps', 8), item('b', 'Hausse du choléra dans les camps de Goma', 10),
    item('b', 'Embouteillages à Goma après la pluie', 30), item('a', 'Goma : embouteillages sur la route de Sake', 33), item('b', 'Embouteillages persistants au centre de Goma', 36),
    item('a', 'Kinshasa : grève des enseignants', 3),
  ]
  it('finds what a city’s news uses more, and less, than the day before', () => {
    const goma = placeTrends({ sources, items, coverage, now, place: { countryCode: 'CD', name: 'Goma' } })
    expect(goma.rising.map((trend) => trend.term)).toContain('choléra')
    expect(goma.fading.map((trend) => trend.term)).toContain('embouteillages')
    // Kinshasa's strike is not Goma's; the city's own name is not a trend.
    expect(goma.rising.map((trend) => trend.term)).not.toContain('grève')
    expect([...goma.rising, ...goma.fading].map((trend) => trend.term)).not.toContain('goma')
    expect(goma.rising[0]!.headlines[0]!.title).toContain('Goma')
  })
  it('never reads a feed that was down as fading', () => {
    const gap = placeTrends({ sources, items, coverage: { a: whole, b: [[now - 20 * 3_600_000, now]], c: whole }, now, place: { countryCode: 'CD', name: 'Goma' } })
    expect(gap.fading.map((trend) => trend.term)).not.toContain('embouteillages')
  })
  it('does not treat persisted coverage on a stale feed as current comparison health', () => {
    const stale = placeTrends({
      sources, items, coverage, health: { a: 'stale', b: 'error', c: 'error' },
      now, place: { countryCode: 'CD', name: 'Goma' },
    })
    expect(stale.rising).toEqual([])
    expect(stale.fading).toEqual([])
    expect(stale.recentStories + stale.previousStories).toBe(0)
    expect(stale.uncompared).toBe(7)
  })
  it('does not infer observation from old headlines when no coverage interval exists', () => {
    const noObservation = placeTrends({
      sources, items: [item('a', 'Goma reports budget debate and new measures', 40)], coverage: {},
      health: { a: 'healthy' }, now, place: { countryCode: 'CD', name: 'Goma' },
    })
    expect(noObservation.recentStories + noObservation.previousStories).toBe(0)
    expect(noObservation.uncompared).toBe(1)
  })
  it('counts only feeds watched across both days, and says how many it set aside', () => {
    const gap = placeTrends({ sources, items, coverage: { a: whole, b: [[now - 20 * 3_600_000, now]], c: whole }, now, place: { countryCode: 'CD', name: 'Goma' } })
    expect(gap.uncompared).toBeGreaterThan(0)
    expect(gap.recentStories + gap.previousStories + gap.uncompared).toBe(7)
  })
  it('counts a statewide outlet as the state’s own news, but not a city’s', () => {
    const state: NewsSourceMeta[] = [
      { sourceId: 's', countryCode: 'US', publisherName: 'CalMatters', publisherGroupId: 'calmatters', scope: 'regional', regionName: 'California', language: 'en' },
      { sourceId: 'n', countryCode: 'US', publisherName: 'NPR', publisherGroupId: 'npr', scope: 'national', language: 'en' },
    ]
    const news = [item('s', 'Wildfire insurance bill passes the Assembly', 2), item('n', 'Senate votes on spending deal', 3)]
    const california = placeTrends({ sources: state, items: news, coverage: { s: whole, n: whole }, now, place: { countryCode: 'US', name: 'California' } })
    expect(california.latest.map((headline) => headline.publisher)).toEqual(['CalMatters'])
    const fresno = placeTrends({ sources: state, items: news, coverage: { s: whole, n: whole }, now, place: { countryCode: 'US', name: 'Fresno' } })
    expect(fresno.latest).toEqual([])
  })
  it('recognises a city by its local name', () => {
    const rome: NewsSourceMeta[] = [{ sourceId: 'r', countryCode: 'IT', publisherName: 'ANSA', publisherGroupId: 'ansa', scope: 'national', language: 'it' }]
    const news = [item('r', 'Roma, sciopero dei trasporti oggi', 2), item('r', 'Sciopero a Roma: metro chiuse', 4), item('r', 'Milano, nebbia in città', 3)]
    const english = placeTrends({ sources: rome, items: news, coverage: { r: whole }, now, place: { countryCode: 'IT', name: 'Rome' } })
    expect(english.recentStories).toBe(0)
    const local = placeTrends({ sources: rome, items: news, coverage: { r: whole }, now, place: { countryCode: 'IT', name: 'Rome', aliases: ['Roma'] } })
    expect(local.recentStories).toBe(2)
    expect(local.rising.map((trend) => trend.term)).toContain('sciopero')
  })
})
