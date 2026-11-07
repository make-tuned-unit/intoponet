import { describe, expect, it } from 'vitest'
import type { NewsDigest, NewsHeadline } from './newsDigest'
import { headlinesNearAnchor } from './anchorHeadlines'

const headline = (title: string): NewsHeadline => ({ title, url: `https://news.example/${title}`, publisher: 'Example', publishedAt: '2026-11-07T08:00:00Z' })

function digest(parts: Record<string, unknown>): NewsDigest {
  return { generatedAt: '2026-11-07T09:00:00Z', windowHours: 48, feedCount: 0, healthyFeedCount: 0, countries: [], places: [], quietCountryCodes: [], rising: [], ...parts } as unknown as NewsDigest
}

describe('headlinesNearAnchor', () => {
  const lisbon = { lat: 38.72, lon: -9.14 }

  it('uses the nearest news place within 150 km that has headlines', () => {
    const result = headlinesNearAnchor(lisbon, digest({
      places: [
        { id: 'far', name: 'Porto', countryCode: 'PT', lat: 41.15, lon: -8.61, headlines: [headline('porto')] },
        { id: 'near', name: 'Setubal', countryCode: 'PT', lat: 38.52, lon: -8.89, headlines: [headline('a'), headline('b')] },
        { id: 'empty', name: 'Sintra', countryCode: 'PT', lat: 38.8, lon: -9.38, headlines: [] },
      ],
    }))
    expect(result).toEqual({ source: 'place', name: 'Setubal', headlines: [headline('a'), headline('b')] })
  })

  it('falls back to the anchor country when no place is within reach', () => {
    const result = headlinesNearAnchor(lisbon, digest({
      countries: [{ countryCode: 'PT', name: 'Portugal', headlines: [headline('pt-1')] }],
      places: [{ id: 'far', name: 'Porto', countryCode: 'PT', lat: 41.15, lon: -8.61, headlines: [headline('porto')] }],
    }))
    expect(result).toEqual({ source: 'country', name: 'Portugal', headlines: [headline('pt-1')] })
  })

  it('shows at most five headlines', () => {
    const many = Array.from({ length: 8 }, (_, i) => headline(`h${i}`))
    const result = headlinesNearAnchor(lisbon, digest({ places: [{ id: 'p', name: 'Lisboa', countryCode: 'PT', lat: 38.72, lon: -9.14, headlines: many }] }))
    expect(result?.headlines).toHaveLength(5)
  })

  it('has nothing to show without a digest or without headlines', () => {
    expect(headlinesNearAnchor(lisbon, null)).toBeNull()
    expect(headlinesNearAnchor(lisbon, digest({ countries: [{ countryCode: 'PT', name: 'Portugal', headlines: [] }] }))).toBeNull()
  })
})
