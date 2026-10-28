import { describe, expect, it } from 'vitest'
import { eventName, eventPicture, headlinesAbout } from './naturalEvent'

describe('natural event view', () => {
  it('finds the event’s own name', () => {
    expect(eventName('Wildfire BEE HAVEN (2) (24-06), Hamilton, Florida')).toBe('Bee Haven')
    expect(eventName('Tropical Cyclone Arnab')).toBe('Arnab')
    expect(eventName('Super Typhoon In-fa')).toBe('In-fa')
    expect(eventName('Etna Volcano, Italy')).toBe('Etna')
    expect(eventName('Iceberg A81')).toBe('A81')
  })
  it('frames a wide storm and a tight fire, with hotspots for fires', () => {
    const fire = eventPicture({ kind: 'Wildfire', lat: 30.5, lon: -82.9, observedAt: '2026-10-22T00:00:00Z', endedAt: null }, Date.parse('2026-10-28T12:00:00Z'))
    expect(fire.url).toContain('Thermal_Anomalies')
    expect(fire.day).toBe('2026-10-27')
    const storm = eventPicture({ kind: 'Severe storm', lat: 17, lon: 85, observedAt: '2026-10-26T00:00:00Z', endedAt: '2026-10-27T00:00:00Z' }, Date.parse('2026-10-28T12:00:00Z'))
    expect(storm.url).not.toContain('Thermal')
    expect(storm.day).toBe('2026-10-27')
  })
  it('finds headlines naming the event, and the kind for short names', () => {
    const headlines = [{ title: 'Cyclone Arnab turns deadly after landfall' }, { title: 'Arnab Goswami hosts debate' }, { title: 'Bee Haven fire grows to 2,000 acres' }]
    expect(headlinesAbout({ title: 'Tropical Cyclone Arnab', kind: 'Severe storm' }, headlines).map((h) => h.title)).toEqual(['Cyclone Arnab turns deadly after landfall'])
    expect(headlinesAbout({ title: 'Wildfire BEE HAVEN (2) (24-06), Hamilton, Florida', kind: 'Wildfire' }, headlines).map((h) => h.title)).toEqual(['Bee Haven fire grows to 2,000 acres'])
  })
})
