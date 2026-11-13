import { describe, expect, it } from 'vitest'
import { buildStoryMountains, storyHeight } from './storyMountains'
import { NEWS_DIGEST_SCHEMA, parseNewsDigest, type NewsItemInput, type NewsSourceMeta } from './newsDigest'
import { matchTabsToStories, mountainHeadlines } from './storyTabs'
import { buildStoryTerrain, heightAt, storyAt, storyTerrainKey } from '../../renderer/src/globe/storyTerrain'

const now = Date.parse('2026-11-06T12:00:00Z')
const hoursAgo = (hours: number): string => new Date(now - hours * 3_600_000).toISOString()

function source(id: string, countryCode: string, scope: NewsSourceMeta['scope'] = 'national', cityName: string | null = null): NewsSourceMeta {
  return { sourceId: id, countryCode, publisherName: `Outlet ${id}`, publisherGroupId: `group-${id}`, scope, cityName, language: 'en' }
}

function item(sourceId: string, title: string, hours = 1): NewsItemInput {
  return { sourceId, title, url: `https://example.com/${sourceId}/${encodeURIComponent(title)}`, publishedAt: hoursAgo(hours), discoveredAt: hoursAgo(hours) }
}

/** Filler so clustering has a realistic background of unrelated headlines. */
function background(sources: NewsSourceMeta[]): NewsItemInput[] {
  const topics = ['Local bakery opens', 'Council approves budget', 'Rain expected tomorrow', 'School wins award', 'Road works delay traffic', 'Museum hosts exhibit', 'Library extends hours', 'Hospital adds beds']
  return sources.flatMap((s, i) => topics.map((topic, k) => item(s.sourceId, `${topic} in district ${i * 10 + k}`, 2 + k)))
}

describe('story mountains', () => {
  it('uses a fixed, strictly increasing height scale', () => {
    const values = [0, 1, 2, 10, 40, 200, 500].map(storyHeight)
    for (let i = 1; i < values.length; i += 1) expect(values[i]!).toBeGreaterThan(values[i - 1]!)
    expect(storyHeight(2)).toBeCloseTo(0.145, 2)
    expect(storyHeight(500)).toBeLessThan(0.7)
  })

  it('raises the story most outlets carry highest, at home in the country it is about', () => {
    const us = Array.from({ length: 12 }, (_, i) => source(`us${i}`, 'US'))
    const py = Array.from({ length: 3 }, (_, i) => source(`py${i}`, 'PY'))
    const ar = Array.from({ length: 4 }, (_, i) => source(`ar${i}`, 'AR'))
    const sources = [...us, ...py, ...ar]
    const items = [
      ...background(sources),
      ...us.map((s, i) => item(s.sourceId, `Democrats win House as Trump faces midterm defeat ${i}`)),
      ...py.map((s) => item(s.sourceId, 'Paraguay president Santiago Peña resigns over Ueno bank collapse')),
      ...ar.map((s) => item(s.sourceId, 'Paraguay: Santiago Peña resigns over Ueno bank collapse', 2)),
    ]
    const { stories } = buildStoryMountains({ sources, items, now })
    expect(stories[0]!.countryCode).toBe('US')
    expect(stories[0]!.label).toBe('US midterm elections')
    const paraguay = stories.find((story) => story.terms.includes('ueno'))!
    // Covered more in Argentina, but about Paraguay: headlines naming a country count double.
    expect(paraguay.countryCode).toBe('PY')
    expect(paraguay.countries.map((country) => country.countryCode)).toEqual(['AR'])
    expect(stories[0]!.height).toBeGreaterThan(paraguay.height)
  })

  it('weights each outlet once, by its latest headline, halving every 12 hours', () => {
    const sources = Array.from({ length: 4 }, (_, i) => source(`s${i}`, 'GB'))
    const fresh = buildStoryMountains({ sources, now, items: [...background(sources), ...sources.map((s) => item(s.sourceId, 'Russell Brand found guilty of rape', 0))] })
    const old = buildStoryMountains({ sources, now, items: [...background(sources), ...sources.map((s) => item(s.sourceId, 'Russell Brand found guilty of rape', 12))] })
    const repeated = buildStoryMountains({ sources, now, items: [...background(sources), ...sources.flatMap((s) => [0, 1, 2].map((h) => item(s.sourceId, `Russell Brand found guilty of rape, update ${h}`, h)))] })
    const coverage = (result: typeof fresh): number => result.stories.find((story) => story.terms.includes('brand'))!.coverage
    expect(coverage(fresh)).toBeCloseTo(4, 1)
    expect(coverage(old)).toBeCloseTo(2, 1)
    expect(coverage(repeated)).toBeCloseTo(4, 1)
  })

  it('merges election coverage told in several ways into one mountain, but not unrelated stories sharing a name', () => {
    const us = Array.from({ length: 10 }, (_, i) => source(`us${i}`, 'US'))
    const items = [
      ...background(us),
      ...us.slice(0, 5).map((s, i) => item(s.sourceId, `Democrats take the Senate in midterm wave ${i}`)),
      ...us.slice(5).map((s, i) => item(s.sourceId, `Republicans hold Florida House seats as election results arrive ${i}`)),
      ...us.slice(0, 4).map((s, i) => item(s.sourceId, `Federal judge blocks Trump arch construction ${i}`, 3)),
    ]
    const { stories } = buildStoryMountains({ sources: us, items, now })
    const elections = stories.filter((story) => story.label === 'US midterm elections')
    expect(elections).toHaveLength(1)
    expect(elections[0]!.outlets).toBe(10)
    expect(stories.some((story) => story.terms.includes('arch') && story.label === null)).toBe(true)
  })

  it('keeps US midterm coverage told from abroad on the US, whatever else it names', () => {
    const abroad = ['GB', 'DE', 'IN', 'AU'].map((code, i) => source(`f${i}`, code))
    const us = [source('us0', 'US')]
    const sources = [...abroad, ...us]
    const items = [
      ...background(sources),
      ...abroad.map((s, i) => item(s.sourceId, `Voters punished republicans in the midterm vote, says Vance, blaming the Iran war ${i}`)),
    ]
    const { stories } = buildStoryMountains({ sources, items, now })
    const story = stories.find((entry) => entry.terms.includes('vance'))!
    expect(story.countryCode).toBe('US')
    expect(story.label).toBe('US midterm elections')
  })

  // 7 November 2026: Pope Leo XIV's vigils in Montevideo and, next, Lima; Peru's north under a rain alert.
  // Two live pages from Peruvian outlets share "Perú" and "en vivo" with the Pope's: a weak pair that once
  // pulled the rain alert into the Pope's mountain (its earliest Peruvian headline, so Peru's line, so a
  // tab on the rain alert was labelled with the Pope's story).
  const vigil = (): { sources: NewsSourceMeta[]; items: NewsItemInput[] } => {
    const sources = [
      ...['uy1', 'uy2', 'uy3'].map((id) => source(id, 'UY')),
      ...['ar1', 'ar2', 'ar3'].map((id) => source(id, 'AR')),
      ...['pe1', 'pe2', 'pe3', 'pe4'].map((id) => source(id, 'PE')),
      ...['cl1', 'mx1'].map((id) => source(id, id === 'cl1' ? 'CL' : 'MX')),
    ].map((meta) => ({ ...meta, language: 'es' }))
    const items = [
      ...background(sources),
      item('uy1', 'Más de 60.000 personas se reúnen en la vigilia del papa León XIV en el estadio Centenario', 3),
      item('uy2', 'El papa León XIV encabezó la vigilia con jóvenes en el Centenario de Montevideo', 4),
      item('uy3', 'Vigilia del papa León XIV en Montevideo: el pontífice pidió a los jóvenes transmitir la fe', 5),
      item('ar1', 'Durante la vigilia en el estadio Centenario, el papa León XIV animó a los fieles uruguayos', 4),
      item('ar2', 'El papa León XIV llega a Argentina tras la vigilia en Uruguay: a qué hora abren los accesos', 2),
      item('ar3', 'Uruguay despide al papa León XIV después de la vigilia multitudinaria', 2),
      item('cl1', 'El papa León XIV reunió a miles de jóvenes en una vigilia en Uruguay', 6),
      item('mx1', 'Vigilia del papa León XIV en Uruguay reúne a más de 60 mil fieles', 6),
      item('pe1', 'Papa León XIV en Lima: la vigilia con 51.000 jóvenes en el Estadio Nacional tendrá 16 ambulancias', 8),
      item('pe2', 'Vigilia del papa León XIV en el Estadio Nacional: mapa, accesos y transporte para los jóvenes', 7),
      item('pe3', '¿Dónde está el papa León XIV EN VIVO? Sigue su recorrido y su llegada al Perú para la vigilia', 1),
      item('pe4', 'Papa León XIV en Perú, en vivo: jóvenes se preparan para la vigilia en el Estadio Nacional', 1),
      // The rain alert: its own story, and the earliest Peruvian headlines here.
      item('pe1', 'Lluvias en Perú HOY EN VIVO: Piura y Tumbes bajo alerta roja y pronóstico del Senamhi', 20),
      item('pe2', 'Lluvias en Perú en vivo: el Senamhi mantiene la alerta roja en Piura y Tumbes', 19),
      item('pe3', 'Piura y Tumbes bajo alerta roja por lluvias intensas, advierte el Senamhi', 18),
    ]
    return { sources, items }
  }

  it('keeps a rain alert out of the Pope’s vigil story, so a tab on it is not labelled with the Pope', () => {
    const { sources, items } = vigil()
    const { stories } = buildStoryMountains({ sources, items, now })
    const pope = stories.find((story) => story.terms.includes('vigilia') || story.terms.includes('leon'))!
    expect(pope).toBeTruthy()
    const shown = [pope.title, ...pope.countries.map((country) => country.headline.title)]
    expect(shown.some((title) => /alerta roja|Senamhi/.test(title))).toBe(false)
    const rainUrl = items.find((entry) => entry.title.startsWith('Lluvias en Perú HOY'))!.url
    const evidence = stories.map((story) => mountainHeadlines(story, story.label ?? story.title))
    const labels = matchTabsToStories([{ id: 'rain', url: rainUrl, title: 'Piura y Tumbes bajo alerta roja' }], evidence)
    expect(labels.get('rain')?.storyId).not.toBe(pope.id)
  })

  it('still counts Peru’s own coverage of the vigil in the Pope’s story', () => {
    const { sources, items } = vigil()
    const { stories } = buildStoryMountains({ sources, items, now })
    const pope = stories.find((story) => story.terms.includes('vigilia') || story.terms.includes('leon'))!
    const peru = pope.countries.find((country) => country.countryCode === 'PE') ?? (pope.countryCode === 'PE' ? { headline: { title: pope.title } } : null)
    expect(peru?.headline.title).toMatch(/León XIV/)
    const vigilUrl = items.find((entry) => entry.title.startsWith('Papa León XIV en Lima'))!.url
    const evidence = stories.map((story) => mountainHeadlines(story, story.label ?? story.title))
    const labels = matchTabsToStories([{ id: 'lima', url: vigilUrl, title: 'Papa León XIV en Lima: la vigilia con 51.000 jóvenes en el Estadio Nacional tendrá 16 ambulancias' }], evidence)
    expect(labels.get('lima')?.storyId).toBe(pope.id)
  })

  it('keeps a story’s id and summit across rebuilds', () => {
    const sources = Array.from({ length: 5 }, (_, i) => source(`s${i}`, 'KE'))
    const items = [...background(sources), ...sources.map((s) => item(s.sourceId, 'Kenyan cult leader Paul Mackenzie sentenced to 200 years'))]
    const first = buildStoryMountains({ sources, items, now })
    const second = buildStoryMountains({ sources, items: [...items, item('s0', 'Kenyan cult leader Paul Mackenzie to appeal sentence', 0)], now: now + 60_000, previous: first.memory })
    const a = first.stories.find((story) => story.terms.includes('mackenzie'))!
    const b = second.stories.find((story) => story.terms.includes('mackenzie'))!
    expect(b.id).toBe(a.id)
    expect(b.summit).toEqual(a.summit)
  })

  it('raises an established summit vertically as fresh independent coverage gains momentum', () => {
    const sources = Array.from({ length: 12 }, (_, i) => source(`s${i}`, 'KE'))
    const title = 'Kenyan cult leader Paul Mackenzie sentenced to 200 years'
    const earlier = sources.slice(0, 2).map((s) => item(s.sourceId, title, 8))
    const first = buildStoryMountains({ sources, items: [...background(sources), ...earlier], now })
    const growing = buildStoryMountains({ sources, items: [...background(sources), ...earlier, ...sources.slice(2).map((s) => item(s.sourceId, title, 1))], now, previous: first.memory })
    const a = first.stories.find((story) => story.terms.includes('mackenzie'))!
    const b = growing.stories.find((story) => story.id === a.id)!
    expect(b.summit).toEqual(a.summit)
    expect(b.momentum).toBeGreaterThan(0)
    expect(b.height).toBeGreaterThan(a.height)
    expect(heightAt(buildStoryTerrain([b]), b.summit.lat, b.summit.lon)).toBeGreaterThan(heightAt(buildStoryTerrain([a]), a.summit.lat, a.summit.lon))
  })

  it('keeps large-country mountains through the renderer and cache boundary', () => {
    const sources = [source('a', 'GB', 'international'), source('b', 'US', 'international')]
    const { stories } = buildStoryMountains({ sources, items: [...background(sources), ...sources.map((s) => item(s.sourceId, 'Russian athletes barred over Ukraine war'))], now })
    const russia = stories.find((story) => story.countryCode === 'RU')!
    expect(russia.footprint[0]!.radiusKm).toBeGreaterThan(2_000)
    const parse = (mountains: typeof stories) => parseNewsDigest(JSON.stringify({ schema: NEWS_DIGEST_SCHEMA, generatedAt: hoursAgo(0), countries: [], places: [], mountains }))!.mountains
    expect(parse(stories)).toEqual(stories)
    expect(parse([{ ...russia, footprint: [{ ...russia.footprint[0]!, radiusKm: 20_000 }] }])).toEqual([])
  })
})

describe('story terrain', () => {
  const story = (id: string, lat: number, lon: number, height: number) => ({
    id, label: null, title: id, url: `https://example.com/${id}`, publisher: 'x', terms: [], coverage: 1, outlets: 2, internationalDesks: 0, articles: 2,
    height, momentum: null, countryCode: 'US', summit: { lat, lon, name: id }, footprint: [{ lat, lon, radiusKm: 600, weight: 1, name: id }],
    countries: [], homeOutlets: 2, firstAt: hoursAgo(2), latestAt: hoursAgo(1),
  })

  it('combines overlapping stories by the taller, never their sum', () => {
    const a = story('a', 40, -90, 0.5)
    const b = story('b', 41, -89, 0.3)
    const terrain = buildStoryTerrain([a, b])
    let max = 0
    for (let pixel = 0; pixel < terrain.width * terrain.height; pixel += 1) max = Math.max(max, terrain.data[pixel * 4]!)
    expect(max).toBeLessThanOrEqual(0.5 + 1e-6)
    expect(max).toBeGreaterThan(0.45)
    expect(storyAt(terrain, 40, -90)?.id).toBe('a')
  })

  it('marks each story’s own summit for the crest cap, and leaves untouched ground flat', () => {
    const terrain = buildStoryTerrain([story('a', 0, 0, 0.4), story('b', 0, 90, 0.2)])
    const at = (lat: number, lon: number): number => {
      const x = Math.floor(((lon + 180) / 360) * terrain.width)
      const y = Math.floor(((lat + 90) / 180) * terrain.height)
      return (y * terrain.width + x) * 4
    }
    // Both summits reach ~1 of their own height in the B channel, whatever their height.
    expect(terrain.data[at(0, 0) + 2]!).toBeGreaterThan(0.9)
    expect(terrain.data[at(0, 90) + 2]!).toBeGreaterThan(0.9)
    expect(terrain.data[at(0, -120)]!).toBe(0)
    expect(storyAt(terrain, 0, -120)).toBeNull()
  })

  it('grows upward on the same footprint and wears down on the same scale', () => {
    const quiet = story('a', 0, 0, storyHeight(2))
    const busy = { ...quiet, height: storyHeight(40), momentum: 0.7 }
    const low = buildStoryTerrain([quiet])
    const high = buildStoryTerrain([busy])
    for (let pixel = 0; pixel < low.owner.length; pixel += 1) {
      expect(high.owner[pixel]).toBe(low.owner[pixel])
      expect(high.data[pixel * 4]!).toBeGreaterThanOrEqual(low.data[pixel * 4]!)
    }
    expect(heightAt(high, 0, 0) / heightAt(low, 0, 0)).toBeCloseTo(busy.height / quiet.height, 5)
    expect(heightAt(buildStoryTerrain([quiet]), 0, 0)).toBeCloseTo(heightAt(low, 0, 0), 6)
  })

  it('invalidates terrain for changed geography and coverage, but not headline copy', () => {
    const a = story('a', 0, 0, 0.4)
    const key = storyTerrainKey([a])
    expect(storyTerrainKey([{ ...a, title: 'A newer headline', publisher: 'Another outlet' }])).toBe(key)
    expect(storyTerrainKey([{ ...a, summit: { ...a.summit, lon: 90 } }])).not.toBe(key)
    expect(storyTerrainKey([{ ...a, footprint: [{ ...a.footprint[0]!, radiusKm: 1200 }] }])).not.toBe(key)
    const abroad = { countryCode: 'JP', outlets: 4, articles: 4, firstAt: hoursAgo(1), headline: { title: 'Coverage in Japan', url: 'https://example.com/jp', publisher: 'Japan', publishedAt: hoursAgo(1) } }
    expect(storyTerrainKey([{ ...a, countries: [abroad] }])).not.toBe(key)
    expect(storyTerrainKey([{ ...a, countries: [abroad] }])).not.toBe(storyTerrainKey([{ ...a, countries: [{ ...abroad, outlets: 6 }] }]))
  })

  it('picks the same story on either side of the longitude seam', () => {
    const terrain = buildStoryTerrain([story('a', 0, -178, 0.4), story('b', 0, 178, 0.4)])
    expect(storyAt(terrain, 0, 180)?.id).toBe(storyAt(terrain, 0, -180)?.id)
    expect(storyAt(terrain, 0, 540)?.id).toBe(storyAt(terrain, 0, -180)?.id)
    expect(storyAt(terrain, NaN, 0)).toBeNull()
  })
})
