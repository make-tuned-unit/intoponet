import { describe, expect, it } from 'vitest'
import { buildStoryTerrain } from '../globe/storyTerrain'
import { maxTextureDelta, ORGANIC_NOOP_DELTA } from './textureDelta'

const story = (id: string, lat: number, lon: number, height: number) => ({
  id, label: null, title: id, url: `https://example.com/${id}`, publisher: 'x', terms: [], coverage: 1, outlets: 2, internationalDesks: 0, articles: 2,
  height, momentum: null, countryCode: 'US', summit: { lat, lon, name: id }, footprint: [{ lat, lon, radiusKm: 600, weight: 1, name: id }],
  countries: [], homeOutlets: 2, firstAt: '2026-11-06T10:00:00Z', latestAt: '2026-11-06T11:00:00Z',
})

describe('terrain changes', () => {
  it('treats a minute of decay as too small to animate, and a new story as a change', () => {
    const before = buildStoryTerrain([story('a', 40, -95, 0.6)]).data
    // Coverage halves every 12 hours; a minute later the summit is a hair lower.
    const minute = buildStoryTerrain([story('a', 40, -95, 0.6 * 2 ** (-1 / 720))]).data
    const added = buildStoryTerrain([story('a', 40, -95, 0.6), story('b', 0, 30, 0.3)]).data
    expect(maxTextureDelta(before, minute)).toBeLessThan(ORGANIC_NOOP_DELTA)
    expect(maxTextureDelta(before, added)).toBeGreaterThan(0.1)
    expect(maxTextureDelta(before, new Float32Array(4))).toBe(Infinity)
  })
})
