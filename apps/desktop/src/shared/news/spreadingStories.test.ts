import { describe, expect, it } from 'vitest'
import { buildSpreadingStories, spreadGrowth } from './spreadingStories'
import type { NewsItemInput, NewsSourceMeta } from './newsDigest'

const now = Date.parse('2026-10-30T20:00:00Z')
const hoursAgo = (h: number): string => new Date(now - h * 3_600_000).toISOString()
const local = (id: string, city: string, region: string): NewsSourceMeta => ({ sourceId: id, countryCode: 'US', publisherName: id.toUpperCase(), publisherGroupId: id, scope: 'local', cityName: city, regionName: region, language: 'en' })
const sources: NewsSourceMeta[] = [
  local('laist', 'Los Angeles', 'California'),
  local('latimes', 'Los Angeles', 'California'),
  local('vosd', 'San Diego', 'California'),
  local('azcentral', 'Phoenix', 'Arizona'),
  local('seattle', 'Seattle', 'Washington'),
  local('sfstandard', 'San Francisco', 'California'),
  { sourceId: 'npr', countryCode: 'US', publisherName: 'NPR', publisherGroupId: 'npr', scope: 'national', language: 'en' },
  { sourceId: 'ap', countryCode: 'US', publisherName: 'AP', publisherGroupId: 'ap', scope: 'national', language: 'en' },
]
let n = 0
const item = (sourceId: string, title: string, h: number): NewsItemInput => ({ sourceId, title, url: `https://example.com/${n += 1}`, publishedAt: hoursAgo(h), discoveredAt: hoursAgo(h) })
// Unrelated local news, so the distinctive-word filter has a background to work against.
const filler = ['laist', 'latimes', 'vosd', 'azcentral', 'seattle', 'sfstandard'].flatMap((id, i) => [
  item(id, `School board weighs budget plan number ${i}`, 5 + i),
  item(id, `Weekend weather brings cooler air to the region ${i}`, 7 + i),
  item(id, `City council approves new bike lanes on street ${i}`, 9 + i),
])

describe('local stories that spread', () => {
  const spreading = [
    item('laist', 'Palisades Reservoir dam crack forces evacuations in Los Angeles', 14),
    item('latimes', 'Los Angeles orders evacuations after Palisades Reservoir dam crack', 13),
    item('vosd', 'San Diego checks its dams after Palisades Reservoir crack in Los Angeles', 9),
    item('azcentral', 'Phoenix water officials watch Palisades Reservoir crack in Los Angeles', 6),
    item('seattle', 'Palisades Reservoir dam crack in Los Angeles prompts Seattle inspection', 2),
  ]
  const national = [
    item('npr', 'Senate passes Hendricks Farm Bill after long debate', 10),
    item('ap', 'Hendricks Farm Bill heads to the president', 9.5),
    item('laist', 'What the Hendricks Farm Bill means for Los Angeles', 8),
    item('seattle', 'Hendricks Farm Bill: what changes for Seattle growers', 7),
    item('vosd', 'Hendricks Farm Bill and San Diego farms', 6),
  ]
  const stories = buildSpreadingStories({ sources, items: [...filler, ...spreading, ...national], now })

  it('finds where a story started and where it travelled, in order', () => {
    const dam = stories.find((story) => story.terms.includes('palisades'))
    expect(dam).toBeDefined()
    expect(dam!.origin.name).toBe('Los Angeles')
    expect(dam!.origin.firstAt).toBe(hoursAgo(14))
    expect(dam!.pickups.map((pickup) => pickup.name)).toEqual(['San Diego', 'Phoenix', 'Seattle'])
    expect(dam!.headlines[0]!.placeName).toBe('Los Angeles')
    expect(spreadGrowth(dam!, now)).toEqual({ recent: 2, earlier: 1 })
  })

  it('does not treat a national story as one spreading from wherever it was first localised', () => {
    expect(stories.find((story) => story.terms.includes('hendricks'))).toBeUndefined()
  })

  it('needs at least one other place to have picked it up', () => {
    const alone = buildSpreadingStories({ sources, items: [...filler, ...spreading.slice(0, 2)], now })
    expect(alone.find((story) => story.terms.includes('palisades'))).toBeUndefined()
  })
})
