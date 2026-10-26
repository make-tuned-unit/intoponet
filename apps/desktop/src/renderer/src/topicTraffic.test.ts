import { describe, expect, it } from 'vitest'
import {
  aggregateTopicTraffic,
  topicTrafficDemoResult,
  type TopicVisit,
} from './topicTraffic'

const now = '2026-10-25T12:00:00.000Z'
const hour = 60 * 60 * 1000
const destinationId = 'place:roman-colosseum'
const topicId = 'ancient-rome'

function traffic(visits: readonly TopicVisit[], overrides: Partial<Parameters<typeof aggregateTopicTraffic>[0]> = {}) {
  return aggregateTopicTraffic({
    destinationId,
    topicId,
    visits,
    now,
    currentWindowMs: 24 * hour,
    ...overrides,
  })
}

describe('topic destination traffic aggregation', () => {
  it('uses all current visits as the origin percentage denominator and exposes unknown origin', () => {
    const result = traffic([
      { destinationId, topicId, timestamp: '2026-10-25T11:00:00Z', originCountryCode: 'bo' },
      { destinationId, topicId, timestamp: '2026-10-25T10:00:00Z', originCountryCode: 'IT' },
      { destinationId, topicId, timestamp: '2026-10-25T09:00:00Z' },
      { destinationId, topicId, timestamp: '2026-10-25T08:00:00Z', originCountryCode: 'invalid' },
    ])

    expect(result.current.totalVisits).toBe(4)
    expect(result.current.knownOriginVisits).toBe(2)
    expect(result.current.unknownOriginVisits).toBe(2)
    expect(result.current.origins).toEqual([
      { countryCode: null, visits: 2, percent: 50 },
      { countryCode: 'BO', visits: 1, percent: 25 },
      { countryCode: 'IT', visits: 1, percent: 25 },
    ])
  })

  it('treats reserved and malformed country codes as unknown', () => {
    const result = traffic([
      { destinationId, topicId, timestamp: '2026-10-25T11:00:00Z', originCountryCode: 'XX' },
      { destinationId, topicId, timestamp: '2026-10-25T10:00:00Z', originCountryCode: 'ZZ' },
      { destinationId, topicId, timestamp: '2026-10-25T09:00:00Z', originCountryCode: 'QZ' },
    ])
    expect(result.current.origins).toEqual([{ countryCode: null, visits: 3, percent: 100 }])
    expect(result.countryTrends).toMatchObject([{ countryCode: null, currentVisits: 3, currentPercent: 100 }])
  })

  it('separates destination/topic and current versus immediately preceding baseline windows', () => {
    const result = traffic([
      { destinationId, topicId, timestamp: '2026-10-25T11:00:00Z', originCountryCode: 'BO' },
      { destinationId, topicId, timestamp: '2026-10-24T11:00:00Z', originCountryCode: 'BO' },
      { destinationId: 'place:elsewhere', topicId, timestamp: '2026-10-25T11:00:00Z', originCountryCode: 'BO' },
      { destinationId, topicId: 'other-topic', timestamp: '2026-10-25T11:00:00Z', originCountryCode: 'BO' },
      { destinationId, topicId, timestamp: '2026-10-23T11:00:00Z', originCountryCode: 'BO' },
    ])

    expect(result.current.totalVisits).toBe(1)
    expect(result.baseline.totalVisits).toBe(1)
    expect(result.spike.status).toBe('normal')
    expect(result.current.start).toBe(Date.parse('2026-10-24T12:00:00.000Z'))
    expect(result.baseline.start).toBe(Date.parse('2026-10-23T12:00:00.000Z'))
  })

  it('reports a finite rate ratio for a spike against a nonzero baseline', () => {
    const result = traffic([
      { destinationId, topicId, timestamp: '2026-10-25T11:00:00Z', originCountryCode: 'BO' },
      { destinationId, topicId, timestamp: '2026-10-25T10:00:00Z', originCountryCode: 'BO' },
      { destinationId, topicId, timestamp: '2026-10-25T09:00:00Z', originCountryCode: 'BO' },
      { destinationId, topicId, timestamp: '2026-10-24T11:00:00Z', originCountryCode: 'BO' },
    ])
    expect(result.spike).toMatchObject({ ratio: 3, status: 'spike' })
  })

  it('computes a country-specific spike independent of the aggregate destination rate', () => {
    const result = traffic([
      { destinationId, topicId, timestamp: '2026-10-25T11:00:00Z', originCountryCode: 'BO' },
      { destinationId, topicId, timestamp: '2026-10-25T10:00:00Z', originCountryCode: 'BO' },
      { destinationId, topicId, timestamp: '2026-10-25T09:00:00Z', originCountryCode: 'BO' },
      { destinationId, topicId, timestamp: '2026-10-25T08:00:00Z', originCountryCode: 'IT' },
      { destinationId, topicId, timestamp: '2026-10-24T11:00:00Z', originCountryCode: 'BO' },
      { destinationId, topicId, timestamp: '2026-10-24T10:00:00Z', originCountryCode: 'IT' },
    ])
    expect(result.spike).toMatchObject({ ratio: 2, status: 'spike' })
    expect(result.countryTrends.find((trend) => trend.countryCode === 'BO')).toMatchObject({
      currentVisits: 3,
      baselineVisits: 1,
      ratio: 3,
      status: 'spike',
    })
    expect(result.countryTrends.find((trend) => trend.countryCode === 'IT')).toMatchObject({
      currentVisits: 1,
      baselineVisits: 1,
      ratio: 1,
      status: 'normal',
    })
  })

  it('never produces an infinite spike ratio when baseline is zero', () => {
    const result = traffic([
      { destinationId, topicId, timestamp: '2026-10-25T11:00:00Z', originCountryCode: 'BO' },
    ])
    expect(result.baseline.totalVisits).toBe(0)
    expect(result.spike.ratio).toBeNull()
    expect(result.spike.status).toBe('no-baseline')
    expect(Number.isFinite(result.spike.currentRatePerHour)).toBe(true)
    expect(result.countryTrends.find((trend) => trend.countryCode === 'BO')).toMatchObject({
      ratio: null,
      status: 'no-baseline',
    })
  })

  it('uses insufficient-baseline when both windows are empty', () => {
    const result = traffic([])
    expect(result.current.totalVisits).toBe(0)
    expect(result.current.origins).toEqual([])
    expect(result.spike).toMatchObject({ ratio: null, status: 'insufficient-baseline' })
  })

  it('provides a clearly synthetic Colosseum-to-Bolivia preview with internally consistent totals', () => {
    expect(topicTrafficDemoResult.destinationId).toBe('demo:roman-colosseum')
    expect(topicTrafficDemoResult.current.totalVisits).toBe(6)
    expect(topicTrafficDemoResult.current.origins.find((origin) => origin.countryCode === 'BO')).toEqual({
      countryCode: 'BO', visits: 3, percent: 50,
    })
    expect(topicTrafficDemoResult.current.unknownOriginVisits).toBe(1)
    expect(topicTrafficDemoResult.baseline.totalVisits).toBe(3)
    expect(topicTrafficDemoResult.countryTrends.find((trend) => trend.countryCode === 'BO')).toMatchObject({
      currentVisits: 3,
      baselineVisits: 1,
      ratio: 3,
      status: 'spike',
    })
    expect(topicTrafficDemoResult.spike.status).toBe('spike')
  })
})
