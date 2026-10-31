import { describe, expect, it } from 'vitest'
import { spreadGlobeSignals, spreadRidgeSignals, spreadSignalId } from './globeSignals'
import type { NewsDigest } from '../../../shared/news/newsDigest'
import type { SpreadingStory } from '../../../shared/news/spreadingStories'

const now = Date.parse('2026-10-30T20:00:00Z')
const at = (h: number): string => new Date(now - h * 3_600_000).toISOString()
const place = (id: string, name: string, lat: number, lon: number, h: number) => ({ id, name, countryCode: 'US', lat, lon, radiusKm: 40, firstAt: at(h), outlets: 1 })
const story: SpreadingStory = {
  id: 'sp-la-dam', title: 'Dam crack forces evacuations in Los Angeles', url: 'https://example.com/a', publisher: 'LAist', terms: ['dam', 'crack'],
  origin: place('city:1', 'Los Angeles', 34.05, -118.24, 14),
  pickups: [place('city:2', 'Phoenix', 33.45, -112.07, 6), place('city:3', 'Seattle', 47.61, -122.33, 2)],
  outletCount: 5, nationalOutlets: 1, firstAt: at(14), latestAt: at(2),
  headlines: [{ title: 'Dam crack forces evacuations in Los Angeles', url: 'https://example.com/a', publisher: 'LAist', publishedAt: at(14), placeName: 'Los Angeles' }],
}
const digest = { spreading: [story] } as unknown as NewsDigest

describe('stories spreading from where they started', () => {
  it('raises a peak at the origin that says where the story went', () => {
    const [peak] = spreadGlobeSignals(digest, now)
    expect(peak!.id).toBe(spreadSignalId(story))
    expect([peak!.lat, peak!.lon]).toEqual([34.05, -118.24])
    expect(peak!.summary).toContain('Started in Los Angeles 14 h ago; picked up in Phoenix, Seattle, and 1 national desk')
    expect(peak!.measurement).toBe('3 places · 5 outlets')
    expect(peak!.momentum).toBeGreaterThan(0)
    expect(peak!.headlines![0]!.place).toBe('Los Angeles')
  })
  it('runs a ridge from the origin to each pickup, fading towards it', () => {
    const ridges = spreadRidgeSignals([story], null, at(0))
    const toSeattle = ridges.filter((ridge) => ridge.id.includes('city:3')).sort((a, b) => a.lat - b.lat)
    expect(toSeattle.length).toBeGreaterThanOrEqual(3)
    expect(toSeattle[0]!.intensity).toBeGreaterThan(toSeattle[toSeattle.length - 1]!.intensity)
    expect(toSeattle[toSeattle.length - 1]!.lat).toBeCloseTo(47.61, 1)
    // Selecting the story makes its ridges stand out.
    const selected = spreadRidgeSignals([story], spreadSignalId(story), at(0))
    expect(Math.max(...selected.map((ridge) => ridge.intensity))).toBeGreaterThan(Math.max(...ridges.map((ridge) => ridge.intensity)))
    expect(spreadRidgeSignals([story], null, at(0), 4)).toHaveLength(4)
  })
})
