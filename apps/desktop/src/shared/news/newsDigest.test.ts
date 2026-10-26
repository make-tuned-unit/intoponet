import { describe, expect, it } from 'vitest'
import { buildNewsDigest, parseNewsDigest, placeNamedIn, type NewsItemInput, type NewsSourceMeta } from './newsDigest'

const now = Date.parse('2026-10-26T12:00:00.000Z')
const sources: NewsSourceMeta[] = [
  { sourceId: 'ke-a', countryCode: 'KE', publisherName: 'Outlet A', publisherGroupId: 'a', scope: 'national' },
  { sourceId: 'ke-b', countryCode: 'KE', publisherName: 'Outlet B', publisherGroupId: 'b', scope: 'national' },
  { sourceId: 'ca-hfx', countryCode: 'CA', publisherName: 'Halifax Local', publisherGroupId: 'hfx', scope: 'local', cityName: 'Halifax' },
  { sourceId: 'er-x', countryCode: 'ER', publisherName: 'Quiet', publisherGroupId: 'q', scope: 'national' },
]
const item = (sourceId: string, title: string, hoursAgo: number, url = `https://example.org/${encodeURIComponent(title)}`): NewsItemInput => ({
  sourceId,
  title,
  url,
  publishedAt: new Date(now - hoursAgo * 3_600_000).toISOString(),
  discoveredAt: new Date(now).toISOString(),
})

describe('placeNamedIn', () => {
  it('matches cities of the same country on word boundaries', () => {
    expect(placeNamedIn('Floods hit Mombasa as rains continue', 'KE')?.name).toBe('Mombasa')
    expect(placeNamedIn('Mombasa-bound trains delayed', 'KE')?.name).toBe('Mombasa')
    expect(placeNamedIn('Budget debate in parliament', 'KE')).toBeNull()
    // A Kenyan feed naming a foreign city is not placed there.
    expect(placeNamedIn('Talks resume in Paris', 'KE')).toBeNull()
  })

  it('keeps accents significant for accented names', () => {
    expect(placeNamedIn('Justiça nega pedido para prender empresário', 'BR')).toBeNull()
    expect(placeNamedIn('Pará registra 36 ocorrências', 'BR')?.name).toBe('Pará')
    expect(placeNamedIn('Chuva forte em São Paulo', 'BR')?.name).toBe('São Paulo')
  })

  it('skips names that are everyday words', () => {
    expect(placeNamedIn('A nice day for reading', 'GB')).toBeNull()
  })
})

describe('buildNewsDigest', () => {
  const digest = buildNewsDigest({
    sources,
    now,
    health: { 'ke-a': 'healthy', 'ke-b': 'healthy', 'ca-hfx': 'healthy', 'er-x': 'error' },
    items: [
      item('ke-a', 'Floods hit Mombasa as rains continue', 2),
      item('ke-b', 'Floods hit Mombasa as rains continue!', 3, 'https://other.example/same-story'),
      item('ke-b', 'Budget debate in parliament today', 5),
      item('ke-a', 'Old story from last week', 24 * 7),
      item('ca-hfx', 'Ferry schedule changes this weekend', 1),
    ],
  })

  it('counts distinct stories per country within the window', () => {
    const kenya = digest.countries.find((country) => country.countryCode === 'KE')!
    expect(kenya.storyCount).toBe(2)
    expect(kenya.outletCount).toBe(2)
    expect(kenya.healthyFeedCount).toBe(2)
    expect(kenya.headlines[0]!.title).toBe('Floods hit Mombasa as rains continue')
    expect(kenya.headlines[0]!.place).toBe('Mombasa')
  })

  it('places named cities and declared local outlets, never the publisher by default', () => {
    expect(digest.places.find((place) => place.name === 'Mombasa')).toMatchObject({ evidence: 'named-in-headline', storyCount: 1 })
    expect(digest.places.find((place) => place.name === 'Halifax')).toMatchObject({ evidence: 'local-outlet', countryCode: 'CA' })
    expect(digest.places.some((place) => place.countryCode === 'KE' && place.name === 'Nairobi')).toBe(false)
  })

  it('reports countries whose feeds produced nothing', () => {
    expect(digest.quietCountryCodes).toEqual(['ER'])
    expect(digest.feedCount).toBe(4)
    expect(digest.healthyFeedCount).toBe(3)
  })

  it('round-trips through the IPC parser', () => {
    const parsed = parseNewsDigest(JSON.stringify(digest))
    expect(parsed).toEqual(digest)
    expect(parseNewsDigest('{"schema":"nope"}')).toBeNull()
    expect(parseNewsDigest('not json')).toBeNull()
  })
})
