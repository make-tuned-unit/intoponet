import { describe, expect, it } from 'vitest'
import { buildInterestTextureData } from './interestField'
import {
  emptyPersonalActivity,
  personalTrafficVisits,
  personalVisitSignals,
  recordPersonalVisit,
  unplacedPersonalVisitCount,
  type PersonalActivityState,
  type PersonalTopicLocation,
} from './personalInterest'

const topicLocation: PersonalTopicLocation = {
  id: 'geonames:123',
  label: 'Example City',
  lat: 44.65,
  lon: -63.57,
  radiusKm: 70,
}

function visit(state: PersonalActivityState, overrides: Partial<Parameters<typeof recordPersonalVisit>[1]> = {}) {
  return recordPersonalVisit(state, {
    url: 'https://example.org/research?utm_source=browser#section',
    title: 'Research page',
    topicId: 'Open research',
    timestamp: '2026-10-25T12:00:00.000Z',
    eligible: true,
    topicLocation,
    ...overrides,
  })
}

describe('personal activity aggregation', () => {
  it('records only eligible completed-page input and keeps URL/title out of activity records', () => {
    const rejected = visit(emptyPersonalActivity, { eligible: false })
    expect(rejected.result).toBe('ineligible')
    const result = visit(rejected.state)
    expect(result.result).toBe('recorded')
    expect(result.state.visits).toEqual([{
      topicId: 'Open research',
      timestamp: '2026-10-25T12:00:00.000Z',
      topicLocation,
    }])
    expect(JSON.stringify(result.state)).not.toContain('example.org')
    expect(JSON.stringify(result.state)).not.toContain('Research page')
  })

  it('deduplicates refreshes, redirects to a canonical URL, and ignores later title updates', () => {
    const first = visit(emptyPersonalActivity)
    const duplicate = visit(first.state, {
      url: 'https://EXAMPLE.org/research/?utm_medium=reload#new-title',
      title: 'A later title update',
      timestamp: '2026-10-25T12:02:00.000Z',
    })
    expect(duplicate.result).toBe('duplicate')
    expect(duplicate.state.visits).toHaveLength(1)
    const laterVisit = visit(first.state, { timestamp: '2026-10-25T13:00:00.000Z' })
    expect(laterVisit.result).toBe('recorded')
  })

  it('allows the same page to count under a newly chosen research topic', () => {
    const first = visit(emptyPersonalActivity)
    const changedTopic = visit(first.state, {
      topicId: 'Civic memory',
      timestamp: '2026-10-25T12:02:00.000Z',
    })
    expect(changedTopic.result).toBe('recorded')
    expect(changedTopic.state.visits).toHaveLength(2)
  })

  it('counts unplaced activity transparently and places only visits with explicit topic locations', () => {
    const unplaced = visit(emptyPersonalActivity, { topicLocation: null })
    expect(unplaced.result).toBe('recorded')
    expect(unplacedPersonalVisitCount(unplaced.state)).toBe(1)
    expect(personalVisitSignals(unplaced.state, '2026-10-25T12:01:00.000Z')).toEqual([])
    const placed = visit(unplaced.state, {
      url: 'https://other.example.org/topic',
      topicLocation,
    })
    expect(unplacedPersonalVisitCount(placed.state)).toBe(1)
    expect(personalVisitSignals(placed.state, '2026-10-25T12:01:00.000Z')).toMatchObject([
      { lat: topicLocation.lat, lon: topicLocation.lon, radiusKm: topicLocation.radiusKm, topicId: 'Open research', sourceType: 'private-local' },
    ])
  })

  it('maps only visits for a selected destination and leaves visitor origin unknown', () => {
    const unplaced = visit(emptyPersonalActivity, { topicLocation: null })
    const placed = visit(unplaced.state, {
      url: 'https://example.org/colosseum',
      topicId: 'Ancient Rome',
      topicLocation: { ...topicLocation, id: 'rome:colosseum' },
      timestamp: '2026-10-25T12:05:00.000Z',
    })
    const selectedLocation = { ...topicLocation, id: 'rome:colosseum' }
    expect(personalTrafficVisits(placed.state, 'Ancient Rome', selectedLocation)).toEqual([{
      destinationId: 'rome:colosseum',
      topicId: 'Ancient Rome',
      timestamp: '2026-10-25T12:05:00.000Z',
      originCountryCode: null,
    }])
    expect(personalTrafficVisits(placed.state, 'General browsing', selectedLocation)).toEqual([])
    expect(personalTrafficVisits(placed.state, 'Ancient Rome', null)).toEqual([])
  })

  it('keeps topics as separate locally observed signals and decays old visits', () => {
    const first = visit(emptyPersonalActivity, { timestamp: '2026-10-01T12:00:00.000Z' })
    const second = visit(first.state, {
      url: 'https://example.org/another',
      timestamp: '2026-10-25T11:00:00.000Z',
      topicId: 'Civic memory',
    })
    const signals = personalVisitSignals(second.state, '2026-10-25T12:00:00.000Z')
    expect(signals).toHaveLength(2)
    expect(signals.map((signal) => signal.topicId)).toEqual(['Civic memory', 'Open research'])
    expect(signals[0]!.intensity).toBeGreaterThan(signals[1]!.intensity)
  })

  it('raises field support at the explicitly selected center without spreading to unrelated areas', () => {
    const chosenTopicLocation = { id: 'topic-location:test', label: 'Chosen topic location', lat: 0, lon: 0, radiusKm: 1_200 }
    const recorded = visit(emptyPersonalActivity, { topicLocation: chosenTopicLocation })
    const [signal] = personalVisitSignals(recorded.state, '2026-10-25T12:01:00.000Z')
    expect(signal).toMatchObject({ lat: 0, lon: 0, radiusKm: 1_200, sourceType: 'private-local' })
    const field = buildInterestTextureData([signal!], 512, 256)
    const centerOffset = ((128 * field.width + 256) * 4)
    const distantOffset = ((128 * field.width + 0) * 4)
    expect(field.data[centerOffset]).toBeGreaterThan(0)
    expect(field.data[distantOffset]).toBe(0)
    expect(field.data[distantOffset + 3]).toBe(0)
  })

  it('rejects unsupported URLs and malformed anchors', () => {
    expect(visit(emptyPersonalActivity, { url: 'file:///private/page' }).result).toBe('invalid')
    expect(visit(emptyPersonalActivity, { topicLocation: { ...topicLocation, lat: 100 } }).result).toBe('invalid')
  })
})
