import { describe, expect, it } from 'vitest'
import { buildNewsDigest, cleanTitle, NEWS_DIGEST_LIMITS, placeNamedIn, type NewsItemInput, type NewsSourceMeta } from './newsDigest'
import newsFeeds from '../../main/news/newsFeeds.json'
import internationalFeeds from '../../main/news/internationalFeeds.json'

/** Counts and text the news shows as fact, as the round 5 audit of a live digest (17 November 2026) found them wrong. */
const now = Date.parse('2026-11-17T03:00:00Z')

describe('counts and text shown as fact', () => {
  it('counts a country’s outlets as its headlines name them', () => {
    // Norway on 17 November 2026: seven papers of three publisher groups. The panel lists the papers, so it counts them.
    const papers: Array<[string, string]> = [['Adresseavisen', 'polaris'], ['Fædrelandsvennen', 'polaris'], ['Aftenposten', 'schibsted'], ['Bergens Tidende', 'schibsted'], ['Stavanger Aftenblad', 'schibsted'], ['Nordlys', 'amedia'], ['Romerikes Blad', 'amedia']]
    const sources: NewsSourceMeta[] = papers.map(([name, group], i) => ({ sourceId: `no-${i}`, countryCode: 'NO', publisherName: name, publisherGroupId: group, scope: 'regional', language: 'nb' }))
    const at = new Date(now - 3_600_000).toISOString()
    const items: NewsItemInput[] = sources.map((source, i) => ({ sourceId: source.sourceId, title: `Robert Pattinson får rollen som James Bond, sak ${i}`, url: `https://example.com/no/${i}`, publishedAt: at, discoveredAt: at }))
    const norway = buildNewsDigest({ sources, items, health: {}, now }).countries.find((country) => country.countryCode === 'NO')!
    expect(new Set(norway.headlines.map((headline) => headline.publisher)).size).toBe(7)
    expect(norway.outletCount).toBe(7)
  })

  it('places a headline only where it names a place, with a capital letter', () => {
    // Real headlines of 17 November 2026: once placed in Spring, Texas, and in Novi, Michigan.
    expect(placeNamedIn('Lindsay Clancy to face a new trial in spring of 2027 over children\'s killing', 'US')).toBeNull()
    expect(placeNamedIn('Znano je, kdo bo novi James Bond', 'US')).toBeNull()
    expect(placeNamedIn('Poznato ko je novi James Bond', 'US')).toBeNull()
    expect(placeNamedIn('Flooding closes roads in Spring after overnight storms', 'US')?.name).toBe('Spring')
    expect(placeNamedIn('Chuva forte em São Paulo', 'BR')?.name).toBe('São Paulo')
  })

  it('files each outlet under one publisher group, so a story never counts it twice', () => {
    const groups = new Map<string, Set<string>>()
    for (const feed of [...newsFeeds.feeds, ...internationalFeeds.feeds]) {
      const outlet = `${feed.publisherName} (${feed.countryCode})`
      groups.set(outlet, (groups.get(outlet) ?? new Set()).add(feed.independentPublisherGroupId))
    }
    expect([...groups.entries()].filter(([, ids]) => ids.size > 1).map(([outlet, ids]) => `${outlet}: ${[...ids].join(', ')}`)).toEqual([])
  })

  it('cuts a long headline after a whole word and says so', () => {
    // Le Calame, Nouakchott: 224 characters, once shown ending "…l’ensemble des Mauritan".
    const long = 'Hommage de reconnaissance et de gratitude à Son Excellence le Président de la République, Monsieur Mohamed Ould Cheikh El Ghazouani, de la part des populations de la wilaya du Gorgol et, au nom de l’ensemble des Mauritaniens'
    const shown = cleanTitle(long)
    expect(shown.length).toBeLessThanOrEqual(NEWS_DIGEST_LIMITS.titleChars)
    expect(shown.endsWith('l’ensemble des…')).toBe(true)
    expect(cleanTitle('  Floods hit   Mombasa as rains continue ')).toBe('Floods hit Mombasa as rains continue')
    expect(cleanTitle('字'.repeat(300))).toBe(`${'字'.repeat(NEWS_DIGEST_LIMITS.titleChars - 1)}…`)
  })
})
