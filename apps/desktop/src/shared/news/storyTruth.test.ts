import { describe, expect, it } from 'vitest'
import { buildGlobalStories, clusterHeadlines, storyTokens, type GlobalStory } from './globalStories'
import { buildStoryMountains, STORY_MOUNTAIN_LIMITS } from './storyMountains'
import { NEWS_DIGEST_SCHEMA, parseNewsDigest, type NewsItemInput, type NewsSourceMeta } from './newsDigest'
import { namesStory } from './storyTabs'
import {
  BANK_OUTAGE, BLACK_FRIDAY, BOND, ESTADOS_UNIDOS, ESTONIA_BORDER, FRANCOPHONIE, GERMANY_NETHERLANDS, live, LUKAKU, RWANDA_DEPORTATION, SANTA_CRUZ,
  SOUTH_AFRICA_SHOOTINGS, SOUTH_KOREA, TRUMP_BIDEN, TRUMP_ELSEWHERE, TRUMP_SUMMIT, type LiveRow,
} from './liveHeadlines.fixture'

/**
 * Stories grouped and counted truthfully, on real headlines from 17 November 2026: what the round 5 audit of a
 * live digest found wrong (see liveHeadlines.fixture.ts).
 */
const now = Date.parse('2026-11-17T03:00:00Z')
const world = (...lists: LiveRow[][]): GlobalStory[] => {
  const { sources, items } = live(lists.flat(), now)
  return buildGlobalStories({ sources, items, now })
}
const titlesOf = (rows: LiveRow[]): Set<string> => new Set(rows.map((row) => row[3]))
/** How many of a story's listed headlines come from a list. */
const from = (story: GlobalStory, rows: LiveRow[]): number => story.headlines.filter((headline) => titlesOf(rows).has(headline.title)).length

describe('world stories on real headlines', () => {
  it('reads "Estados Unidos" as one country, not as two words that make a story', () => {
    expect(storyTokens('Presidente do Equador nega que o país tenha uma base militar dos Estados Unidos', 'pt')).toEqual(expect.arrayContaining(['ecuador', 'united-states']))
    expect(storyTokens('Presidente do Equador nega que o país tenha uma base militar dos Estados Unidos', 'pt')).not.toEqual(expect.arrayContaining(['estados']))
    // Twelve unrelated headlines that name the United States, and the day's bank outage told in Spanish.
    const stories = world(ESTADOS_UNIDOS, BANK_OUTAGE, RWANDA_DEPORTATION)
    for (const story of stories) expect(from(story, ESTADOS_UNIDOS), `"${story.title}" [${story.terms}]`).toBeLessThanOrEqual(1)
    expect(stories.some((story) => story.terms.includes('estados') || story.terms.includes('unidos'))).toBe(false)
    const outage = stories.filter((story) => from(story, BANK_OUTAGE) >= 3)
    expect(outage).toHaveLength(1)
  })

  it('lists one story told in many languages once, and counts every country that covered it', () => {
    const stories = world(RWANDA_DEPORTATION, ESTADOS_UNIDOS)
    const rwanda = stories.filter((story) => story.terms.includes('rwanda'))
    expect(rwanda).toHaveLength(1)
    // English, Spanish, Portuguese, French and Catalan outlets say Rwanda, Ruanda, Rwanda, Rwanda and Ruanda.
    const languages = new Set(rwanda[0]!.headlines.map((headline) => headline.lang?.split('-')[0]))
    for (const language of ['en', 'es', 'pt', 'fr', 'ca']) expect(languages, language).toContain(language)
    expect(rwanda[0]!.countries.length).toBeGreaterThanOrEqual(8)
    expect(rwanda[0]!.countries).toEqual(expect.arrayContaining(['AO', 'MX', 'BR', 'LU', 'ES']))
  })

  it('keeps two stories about the same country apart', () => {
    const stories = world(RWANDA_DEPORTATION, FRANCOPHONIE, ESTADOS_UNIDOS)
    const deportation = stories.find((story) => from(story, RWANDA_DEPORTATION) >= 3)!
    expect(deportation).toBeTruthy()
    expect(from(deportation, FRANCOPHONIE)).toBe(0)
    for (const story of stories) if (from(story, FRANCOPHONIE) >= 2) expect(from(story, RWANDA_DEPORTATION)).toBe(0)
  })

  it('does not count South Korea’s headlines in a South African story', () => {
    const stories = world(SOUTH_AFRICA_SHOOTINGS, SOUTH_KOREA, ESTADOS_UNIDOS)
    const shootings = stories.find((story) => from(story, SOUTH_AFRICA_SHOOTINGS) >= 3)!
    expect(shootings).toBeTruthy()
    expect(from(shootings, SOUTH_KOREA)).toBe(0)
    // Sri Lanka, Nepal and Afghanistan only wrote about South Korea.
    for (const code of ['LK', 'NP', 'AF', 'PH']) expect(shootings.countries).not.toContain(code)
    expect(shootings.terms).toContain('south-africa')
  })

  it('does not make a story of a two-word name that heads unrelated headlines', () => {
    const stories = world(BLACK_FRIDAY, SANTA_CRUZ, LUKAKU, ESTADOS_UNIDOS)
    expect(stories.some((story) => from(story, BLACK_FRIDAY) >= 2), 'Black Friday').toBe(false)
    expect(stories.some((story) => from(story, SANTA_CRUZ) >= 2), 'Santa Cruz').toBe(false)
    // A person's two-word name is still a story when the headlines say the same of him.
    const lukaku = stories.filter((story) => story.terms.includes('lukaku'))
    expect(lukaku).toHaveLength(1)
    expect(lukaku[0]!.countries.length).toBeGreaterThanOrEqual(6)
    expect(lukaku[0]!.terms).toContain('belgium')
  })

  it('does not join two stories because the same president is in both', () => {
    const stories = world(TRUMP_BIDEN, TRUMP_SUMMIT, TRUMP_ELSEWHERE)
    const blame = stories.find((story) => from(story, TRUMP_BIDEN) >= 3)!
    const summit = stories.find((story) => from(story, TRUMP_SUMMIT) >= 3)!
    expect(blame).toBeTruthy()
    expect(summit).toBeTruthy()
    expect(blame).not.toBe(summit)
    // One roundup names both ("FAA ground stop… And, Trump meets Xi, Putin in Asia"): it does not make them one.
    expect(from(blame, TRUMP_SUMMIT)).toBeLessThanOrEqual(1)
    expect(from(summit, TRUMP_BIDEN)).toBe(0)
    expect(blame.terms).toContain('biden')
    expect(summit.terms).toContain('putin')
  })

  it('finds a match between two countries told in five languages', () => {
    const stories = world(GERMANY_NETHERLANDS, ESTONIA_BORDER, ESTADOS_UNIDOS)
    const match = stories.filter((story) => story.terms.includes('germany') && story.terms.includes('netherlands'))
    expect(match).toHaveLength(1)
    // English, Spanish, Indonesian, French and German: Germany, Alemania, Jerman, Allemagne, Deutschland (and the DFB).
    const languages = new Set(match[0]!.headlines.map((headline) => headline.lang?.split('-')[0]))
    for (const language of ['en', 'es', 'id', 'fr', 'de']) expect(languages, language).toContain(language)
    expect(match[0]!.countries).toEqual(expect.arrayContaining(['CR', 'MX', 'ID', 'DE']))
    // Two countries named together are not a story: the plan to send migrants to Rwanda names Germany and the
    // Netherlands too (it was once counted in the match), and Estonia's border with Russia names two others.
    expect(match[0]!.headlines.some((headline) => /migrants/.test(headline.title))).toBe(false)
    expect(from(match[0]!, ESTONIA_BORDER)).toBe(0)
  })

  it('knows a headline names a story when it says the country in its own language', () => {
    expect(namesStory('Alemania destroza a Países Bajos; aseguran su pase a cuartos de final', ['germany', 'netherlands', 'nations'], 'es')).toBe(true)
    expect(namesStory('Alemania destroza a Países Bajos; aseguran su pase a cuartos de final', ['germany', 'netherlands', 'nations'])).toBe(false)
  })
})

describe('a name that folds to an everyday word', () => {
  // "Peña" (Paraguay's former president) and "pena" (a sentence, in Spanish, Portuguese and Catalan) are one token.
  // Headlines of 17 November 2026.
  const pena: Array<[string, string]> = [
    ['es', 'Paraguay: claves del escándalo bancario que llevó a la renuncia a Peña'],
    ['es', 'Video: estos son los expresidentes que fueron presos o imputados antes que Peña'],
    ['es', 'De sala histórica a gimnasio: los privilegios de Peña en su reclusión'],
    ['es', 'Hijo de Peña, vinculado a despojo de tierra en Chaco'],
    ['es', 'Santiago Peña es sacado de la celda VIP a otra pequeña de una prisión militar'],
    ['es', 'Santiago Peña cumple 48 años alejado del poder y bajo prisión preventiva por Ueno bank'],
  ]
  const sentences: Array<[string, string]> = [
    ['pt', 'TUI eleva para 26 anos pena de prisão de ex-procurador-adjunto'],
    ['ca', 'Petició de pena de vuit mesos de presó a un home per amenaçar a l\'exparella: "T\'ho juro que et mataria"'],
    ['pt', 'TUI agrava pena aplicada ao ex-procurador-adjunto Kong Chi para 26 anos'],
    ['es', 'El Supremo confirma la pena de 442 años de cárcel para el pederasta del Fortnite'],
    ['es', '¿Vale la pena participar en política?'],
    ['pt', 'Em 13ª condenação, Serial killer recebe mais de 30 anos de prisão; penas já somam 381 anos'],
  ]
  const cluster = () => {
    const entries = [...pena, ...sentences].map(([lang, title], i) => ({ title, lang, group: `outlet-${i}`, tokens: storyTokens(title, lang) }))
    const clusters = clusterHeadlines(entries, (indices) => (indices.length >= 2 ? indices.length : null), 20)
    return { entries, clusters }
  }

  it('keeps the name’s weight however often the word is used', () => {
    // Five headlines say "pena" in lower case and six say "Peña": folded together it would be a word, not a name.
    const { entries, clusters } = cluster()
    const named = clusters.filter((group) => group.terms.has('pena'))
    expect(named.length).toBeGreaterThanOrEqual(1)
    // Pairs with an ordinary word ("Peña" and "prisión") need Peña to be a name.
    const members = new Set(named.flatMap((group) => [...group.indices]))
    expect([...members].filter((index) => index < pena.length).length).toBeGreaterThanOrEqual(2)
    expect(entries[4]!.tokens).toContain('pena')
  })

  it('does not put a prison sentence in the former president’s story', () => {
    const { entries, clusters } = cluster()
    for (const group of clusters.filter((item) => item.terms.has('pena'))) {
      for (const index of group.indices) expect(entries[index]!.title, `in [${[...group.terms.keys()]}]`).toMatch(/Peña/)
    }
    // A headline that only has the word no longer carries the name's token.
    expect(entries[pena.length + 3]!.tokens).not.toContain('pena')
  })
})

describe('story mountains on real headlines', () => {
  const mountains = (...lists: LiveRow[][]) => {
    const { sources, items } = live(lists.flat(), now)
    return buildStoryMountains({ sources, items, now }).stories
  }

  it('raises one mountain for a story told in several languages, over the country every language names', () => {
    const stories = mountains(RWANDA_DEPORTATION, ESTADOS_UNIDOS, SOUTH_KOREA)
    const rwanda = stories.filter((story) => story.terms.includes('rwanda'))
    expect(rwanda).toHaveLength(1)
    expect(rwanda[0]!.countryCode).toBe('RW')
    // Angola's and Brazil's outlets wrote "Ruanda": theirs is this story, not one of their own.
    expect(rwanda[0]!.countries.map((country) => country.countryCode)).toEqual(expect.arrayContaining(['AO', 'BR', 'MX', 'LU']))
    expect(stories.some((story) => ['AO', 'BR', 'MX'].includes(story.countryCode) && /Ruanda/.test(story.title))).toBe(false)
  })

  it('puts a match between Germany and the Netherlands in one of them, not in Mexico', () => {
    const stories = mountains(GERMANY_NETHERLANDS, ESTADOS_UNIDOS, SOUTH_KOREA)
    const match = stories.filter((story) => story.terms.includes('germany') || story.terms.includes('netherlands'))
    expect(match.length).toBeGreaterThanOrEqual(1)
    for (const story of match) expect(['DE', 'NL'], `"${story.title}" is in ${story.countryCode}`).toContain(story.countryCode)
  })

  it('puts the new James Bond in Britain, and no summit in Novi, Michigan', () => {
    const stories = mountains(BOND, ESTADOS_UNIDOS, SOUTH_KOREA)
    const bond = stories.find((story) => story.terms.includes('bond'))!
    expect(bond.countryCode).toBe('GB')
    // "novi James Bond" is "the new James Bond" in Slovenian and Bosnian. Told mostly by US outlets (four are added
    // here, as on the day, when nine carried it), it stands on the country, not on Novi.
    const us = Array.from({ length: 4 }, (_, i): LiveRow => ['US', 'en', `us-outlet-${i}`, ['Robert Pattinson named as the newest James Bond', 'Robert Pattinson is the next James Bond, studio confirms', 'Who is the new James Bond? Robert Pattinson takes the role', 'Robert Pattinson to play James Bond in Denis Villeneuve film'][i]!])
    const american = mountains(us, BOND.filter((row) => !/[Bb]rit/.test(row[3])), ESTADOS_UNIDOS, SOUTH_KOREA).find((story) => story.terms.includes('bond'))!
    expect(american.countryCode).toBe('US')
    expect(american.summit.name).toBe('United States')
    expect(american.footprint.map((anchor) => anchor.name)).not.toContain('Novi')
  })

  it('lists every country that covered a story, so "N other countries" is their number', () => {
    const codes = ['AR', 'AT', 'AU', 'BE', 'BG', 'BO', 'BR', 'CA', 'CH', 'CL', 'CO', 'CR', 'CZ', 'DE', 'DK', 'DO', 'EC', 'EE', 'EG', 'ES', 'FI', 'FR', 'GH', 'GR', 'HN', 'HR', 'HU', 'ID', 'IE', 'IL', 'IN', 'IT', 'JP', 'KE', 'KR', 'LT', 'LU', 'MA', 'MX', 'NG', 'NL', 'NO', 'NZ', 'PA', 'PE', 'PH', 'PL', 'PT', 'RO', 'SE']
    const sources: NewsSourceMeta[] = codes.map((code) => ({ sourceId: code, countryCode: code, publisherName: `Outlet ${code}`, publisherGroupId: `group-${code}`, scope: 'national', language: 'en' }))
    const at = new Date(now - 3_600_000).toISOString()
    const items: NewsItemInput[] = [
      ...sources.map((source, i): NewsItemInput => ({ sourceId: source.sourceId, title: `British actor Robert Pattinson confirmed as the next agent after a long search, report ${i}`, url: `https://example.com/${source.sourceId}/bond`, publishedAt: at, discoveredAt: at })),
      // The rest of the day's news, so that one story is not most of it.
      ...sources.flatMap((source, i) => Array.from({ length: 26 }, (_, k): NewsItemInput => ({ sourceId: source.sourceId, title: `Council approves budget in district ${i * 100 + k}`, url: `https://example.com/${source.sourceId}/budget-${k}`, publishedAt: at, discoveredAt: at }))),
    ]
    const { stories } = buildStoryMountains({ sources, items, now })
    const bond = stories.find((story) => story.terms.includes('pattinson'))!
    expect(bond.outlets).toBe(codes.length)
    expect(bond.countries).toHaveLength(codes.length)
    expect(bond.homeOutlets + bond.countries.reduce((sum, country) => sum + country.outlets, 0) + bond.internationalDesks).toBe(bond.outlets)
    expect(STORY_MOUNTAIN_LIMITS.countries).toBeGreaterThanOrEqual(250)
    // The digest keeps them all on its way to the window.
    const digest = parseNewsDigest(JSON.stringify({ schema: NEWS_DIGEST_SCHEMA, generatedAt: new Date(now).toISOString(), countries: [], places: [], rising: [], mountains: stories }))
    expect(digest!.mountains!.find((story) => story.id === bond.id)!.countries).toHaveLength(codes.length)
  })
})
