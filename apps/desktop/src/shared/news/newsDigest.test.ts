import { describe, expect, it } from 'vitest'
import { buildNewsDigest, capitalEvidence, parseNewsDigest, placeNamedIn, type NewsItemInput, type NewsSourceMeta } from './newsDigest'

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

describe('momentum (rising and fading)', () => {
  const ke: NewsSourceMeta[] = [
    { sourceId: 'ke-a', countryCode: 'KE', publisherName: 'A', publisherGroupId: 'a', scope: 'national' },
    { sourceId: 'ke-b', countryCode: 'KE', publisherName: 'B', publisherGroupId: 'b', scope: 'national' },
  ]
  const stories = (sourceId: string, n: number, fromHours: number, prefix: string): NewsItemInput[] =>
    Array.from({ length: n }, (_, i) => item(sourceId, `${prefix} story number ${i} about the budget`, fromHours + i * 0.1))

  it('compares the last 24 h with the 24 h before, over comparable feeds only', () => {
    const digest = buildNewsDigest({
      sources: ke,
      now,
      health: { 'ke-a': 'healthy', 'ke-b': 'healthy' },
      // ke-a has 3 days of history; ke-b only shows its last few hours.
      items: [...stories('ke-a', 12, 1, 'Recent'), ...stories('ke-a', 4, 30, 'Earlier'), item('ke-a', 'An old report from three days back', 70), ...stories('ke-b', 20, 0.5, 'Busy')],
    })
    const kenya = digest.countries[0]!
    expect(kenya.comparableFeeds).toBe(1)
    expect(kenya.recentCount).toBe(12)
    expect(kenya.previousCount).toBe(4)
    expect(kenya.momentum).toBeCloseTo((12 - 4) / (12 + 4 + 4))
    expect(kenya.storyCount).toBe(36)
  })

  it('reports no momentum without comparable coverage, never a false fade', () => {
    const digest = buildNewsDigest({ sources: ke, now, health: {}, items: stories('ke-b', 20, 0.5, 'Busy') })
    expect(digest.countries[0]!.momentum).toBeNull()
    expect(digest.countries[0]!.comparableFeeds).toBe(0)
  })

  it('uses observed coverage intervals when given', () => {
    const items = [...stories('ke-a', 6, 1, 'Recent'), ...stories('ke-a', 6, 30, 'Earlier')]
    const gap = buildNewsDigest({ sources: ke, now, health: { 'ke-a': 'healthy' }, items, coverage: { 'ke-a': [[now - 50 * 3_600_000, now - 30 * 3_600_000], [now - 10 * 3_600_000, now]] } })
    expect(gap.countries[0]!.momentum).toBeNull()
    const full = buildNewsDigest({ sources: ke, now, health: { 'ke-a': 'healthy' }, items, coverage: { 'ke-a': [[now - 50 * 3_600_000, now]] } })
    expect(full.countries[0]!.momentum).toBe(0)
  })

  it('excludes a stale feed from comparisons even when its old coverage spans both days', () => {
    const digest = buildNewsDigest({
      sources: ke, now, health: { 'ke-a': 'stale', 'ke-b': 'healthy' },
      items: [...stories('ke-a', 8, 1, 'Recent'), ...stories('ke-a', 8, 30, 'Earlier')],
      coverage: { 'ke-a': [[now - 60 * 3_600_000, now]] },
    })
    expect(digest.countries[0]!.comparableFeeds).toBe(0)
    expect(digest.countries[0]!.momentum).toBeNull()
    expect(digest.countries[0]!.healthyFeedCount).toBe(1)
  })

  it('does not infer current monitoring from old publication timestamps when coverage is supplied', () => {
    const digest = buildNewsDigest({
      sources: ke, now, health: { 'ke-a': 'healthy' },
      items: [item('ke-a', 'An old report from three days back', 70), ...stories('ke-a', 8, 2, 'Recent'), ...stories('ke-a', 8, 30, 'Earlier')],
      coverage: {},
    })
    expect(digest.countries[0]!.comparableFeeds).toBe(0)
    expect(digest.countries[0]!.momentum).toBeNull()
  })
})

describe('coverage helpers', () => {
  it('merges spans and checks windows with small tolerance', async () => {
    const { addCoverage, coversWindow } = await import('./newsDigest')
    const h = 3_600_000
    let spans = addCoverage([], [0, 10 * h], 0)
    spans = addCoverage(spans, [10.5 * h, 20 * h], 0)
    expect(spans).toEqual([[0, 20 * h]])
    expect(coversWindow(spans, 0, 20 * h)).toBe(true)
    expect(coversWindow([[0, 5 * h], [9 * h, 20 * h]], 0, 20 * h)).toBe(false)
  })
})

describe('rising terms', () => {
  const countries = ['KE', 'NG', 'GH', 'ZA', 'UG']
  const sources: NewsSourceMeta[] = countries.map((code) => ({ sourceId: `${code}-x`, countryCode: code, publisherName: code, publisherGroupId: code, scope: 'national' }))
  const coverage = Object.fromEntries(sources.map((source) => [source.sourceId, [[now - 60 * 3_600_000, now]] as Array<[number, number]>]))

  it('finds terms used by more countries today than yesterday, preferring bigrams', () => {
    const items: NewsItemInput[] = [
      ...countries.map((code, i) => item(`${code}-x`, `Health officials report Ebola outbreak in ${['Nakuru', 'Kano', 'Kumasi', 'Durban', 'Gulu'][i]}`, 2 + i)),
      item('KE-x', 'Ebola outbreak first reported near border', 30),
      ...countries.map((code, i) => item(`${code}-x`, `Football league results weekend roundup ${i}`, 30 + i)),
      ...countries.map((code, i) => item(`${code}-x`, `Football league results weekend roundup again ${i}`, 3 + i)),
    ]
    const digest = buildNewsDigest({ sources, items, health: {}, now, coverage })
    const top = digest.rising[0]!
    expect(top.term).toBe('ebola outbreak')
    expect(top.recentCountries).toEqual(['GH', 'KE', 'NG', 'UG', 'ZA'])
    expect(top.previousCountryCount).toBe(1)
    expect(top.momentum).toBeCloseTo((5 - 1) / (5 + 1 + 2))
    expect(top.headlines.length).toBeLessThanOrEqual(4)
    // Steady terms (same countries both days) are not rising; component words are folded into the bigram.
    expect(digest.rising.some((term) => term.term.includes('football'))).toBe(false)
    expect(digest.rising.some((term) => term.term === 'ebola')).toBe(false)
  })

  it('does not report everyday words as rising', () => {
    const items: NewsItemInput[] = countries.map((code, i) => item(`${code}-x`, `Prices rise again on monday across the region ${i}`, 2 + i))
    const digest = buildNewsDigest({ sources, items, health: {}, now, coverage })
    expect(digest.rising.map((term) => term.term)).toEqual([])
  })

  it('ignores stopwords and country names', async () => {
    const { headlineTerms } = await import('./newsDigest')
    expect(headlineTerms('President says Kenya government will act')).toEqual([])
    expect(headlineTerms('Floods hit Mombasa')).toContain('floods')
  })

  it('stays fast on a large digest', () => {
    const many: NewsItemInput[] = []
    for (let i = 0; i < 15_000; i += 1) many.push(item(`${countries[i % 5]}-x`, `Headline ${i} mentions harbour cranes and storm number ${i % 97}`, (i % 47) + 0.5))
    const t = performance.now()
    buildNewsDigest({ sources, items: many, health: {}, now, coverage })
    const elapsed = performance.now() - t
    expect(elapsed).toBeLessThan(1500)
    ;(globalThis as { __digestMs?: number }).__digestMs = elapsed
  })
})

describe('headline terms', () => {
  it('bridges a short connector into a bigram', async () => {
    const { headlineTerms } = await import('./newsDigest')
    expect(headlineTerms('Réélection de Lula da Silva')).toContain('lula silva')
  })
})

describe('rising terms look like names', () => {
  it('reads capitalisation only from sentence-case headlines', () => {
    expect(capitalEvidence('Supporters celebrate as Lula wins second round').get('lula')).toBe(true)
    expect(capitalEvidence('Supporters celebrate as Lula wins second round').get('round')).toBe(false)
    expect(capitalEvidence('Storm Hits Coast As Ports Close Early').size).toBe(0)
  })
})
