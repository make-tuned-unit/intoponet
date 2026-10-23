import { describe, expect, it } from 'vitest'
import { publicFieldSnapshot, recordsFromHits } from './wikipedia'
import { recordsFromQuakes, weightFromMagnitude } from './usgs'

describe('USGS public field', () => {
  it('keeps the place, link, and magnitude weight and drops the narrative', () => {
    const records = recordsFromQuakes(
      {
        features: [
          {
            id: 'us1000',
            geometry: { type: 'Point', coordinates: [-122.4, 37.8, 10] },
            properties: {
              mag: 5.4,
              place: '10 km W of Berkeley, CA',
              url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us1000',
              time: Date.parse('2026-10-22T12:00:00.000Z'),
              type: 'earthquake',
              detail: 'Do not store this narrative.',
            },
          },
          {
            id: 'weak',
            geometry: { type: 'Point', coordinates: [10, 10, 1] },
            properties: {
              mag: 3.1,
              place: 'too small',
              url: 'https://earthquake.usgs.gov/earthquakes/eventpage/weak',
              time: Date.parse('2026-10-22T12:00:00.000Z'),
              type: 'earthquake',
            },
          },
        ],
      },
      '2026-10-23T00:00:00.000Z',
    )
    expect(records).toHaveLength(1)
    expect(records[0]?.licence).toBe('public-domain')
    expect(records[0]?.title).toBe('10 km W of Berkeley, CA')
    expect(records[0]?.topics).toEqual(['seismic-record'])
    expect(records[0]?.weight).toBeLessThan(2.2)
    expect(JSON.stringify(records)).not.toContain('Do not store')
    expect(weightFromMagnitude(12)).toBe(2.2)
  })

  it('names both source classes without calling either one importance', () => {
    const wiki = recordsFromHits(
      [{ pageid: 1, title: 'Brooklyn Bridge Park', lat: 40.7, lon: -74 }],
      'open-knowledge',
      new Map([['Brooklyn Bridge Park', 40]]),
      '2026-10-23T00:00:00.000Z',
    )
    const quakes = recordsFromQuakes(
      {
        features: [
          {
            id: 'us1000',
            geometry: { type: 'Point', coordinates: [139.7, 35.6, 8] },
            properties: {
              mag: 4.8,
              place: 'near Tokyo',
              url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us1000',
              time: Date.parse('2026-10-22T00:00:00.000Z'),
              type: 'earthquake',
            },
          },
        ],
      },
      '2026-10-23T00:00:00.000Z',
    )
    const snapshot = publicFieldSnapshot([...wiki, ...quakes], Date.parse('2026-10-23T00:00:00.000Z'))
    expect(snapshot.coverageNote).toContain('Wikipedia')
    expect(snapshot.coverageNote).toContain('USGS')
    expect(snapshot.coverageNote).toContain('Not the whole web')
    expect(snapshot.coverageNote).toContain('not a measure of importance')
    expect(snapshot.sources.some((source) => source.id.startsWith('usgs-'))).toBe(true)
  })
})
