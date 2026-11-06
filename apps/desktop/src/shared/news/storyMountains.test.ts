import { describe, expect, it } from 'vitest'
import { buildStoryMountains, storyHeight } from './storyMountains'
import type { NewsItemInput, NewsSourceMeta } from './newsDigest'
import { buildStoryTerrain, storyAt } from '../../renderer/src/globe/storyTerrain'

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
})
