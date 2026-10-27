import { describe, expect, it } from 'vitest'
import { isDaylight, subsolarPoint } from './sun'

describe('subsolar point', () => {
  it('sits on the Tropic of Cancer at the June solstice and near the equator at the equinox', () => {
    expect(subsolarPoint(new Date('2026-06-21T08:24:00Z')).lat).toBeCloseTo(23.44, 1)
    expect(Math.abs(subsolarPoint(new Date('2026-03-20T14:46:00Z')).lat)).toBeLessThan(0.05)
    expect(subsolarPoint(new Date('2026-12-21T20:50:00Z')).lat).toBeCloseTo(-23.44, 1)
  })

  it('is near Greenwich at noon UTC, off only by the equation of time', () => {
    // Early November the sun runs ~16 min fast: solar noon at Greenwich is ~11:44 UTC,
    // so at 12:00 UTC the sun is already ~4° west.
    const nov = subsolarPoint(new Date('2026-11-03T12:00:00Z'))
    expect(nov.lon).toBeLessThan(-3.5)
    expect(nov.lon).toBeGreaterThan(-4.5)
    // Mid-February it runs ~14 min slow: still ~3.5° east at 12:00 UTC.
    const feb = subsolarPoint(new Date('2026-02-11T12:00:00Z'))
    expect(feb.lon).toBeGreaterThan(3)
    expect(feb.lon).toBeLessThan(4.2)
  })

  it('moves west 15° per hour', () => {
    const a = subsolarPoint(new Date('2026-10-26T00:00:00Z'))
    const b = subsolarPoint(new Date('2026-10-26T01:00:00Z'))
    expect(((a.lon - b.lon) + 360) % 360).toBeCloseTo(15, 0)
  })

  it('knows day from night', () => {
    const t = new Date('2026-10-26T12:00:00Z')
    expect(isDaylight(51.5, -0.1, t)).toBe(true) // London, noon
    expect(isDaylight(35.7, 139.7, t)).toBe(false) // Tokyo, 21:00
    expect(isDaylight(-33.9, 151.2, t)).toBe(false) // Sydney, 23:00
    expect(isDaylight(40.7, -74, t)).toBe(true) // New York, 08:00
  })
})

describe('day phase', () => {
  it('describes the sun at a place', async () => {
    const { dayPhase, dayPhaseText } = await import('./sun')
    const t = new Date('2026-10-26T12:00:00Z')
    expect(dayPhase(51.5, -0.1, t).phase).toBe('day')
    expect(dayPhase(35.7, 139.7, t).phase).toBe('night')
    expect(dayPhaseText(51.5, -0.1, t)).toMatch(/^Daytime · sun \d+° up$/)
    // New York sunrise is ~11:20 UTC in late October: ~11:00 UTC is dawn.
    expect(dayPhase(40.7, -74, new Date('2026-10-26T11:05:00Z')).phase).toBe('dawn')
    // ~22:00 UTC is just after sunset there.
    expect(dayPhase(40.7, -74, new Date('2026-10-26T22:15:00Z')).phase).toBe('dusk')
  })
})
