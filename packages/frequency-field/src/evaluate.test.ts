import { describe, expect, it } from 'vitest'
import { displacementAt, fieldAt, segmentsFromBands } from './evaluate'
import { syntheticFrequencyBands } from './fixtures'
import { latLonToOrbit, latLonToUnit } from './geo'

describe('frequency field geometry', () => {
  const segments = segmentsFromBands(syntheticFrequencyBands)

  it('keeps displacement bounded and non-negative', () => {
    const samples = [
      latLonToUnit(48, -32),
      latLonToUnit(0, 20),
      latLonToUnit(-80, 0),
      latLonToUnit(90, 0),
    ]
    for (const point of samples) {
      const height = displacementAt(point, segments, 1.5, 0.045)
      expect(height).toBeGreaterThanOrEqual(0)
      expect(height).toBeLessThanOrEqual(0.045)
    }
  })

  it('raises a corridor above a quiet pole', () => {
    const atlantic = fieldAt(latLonToUnit(48, -32), segments, 0)
    const pole = fieldAt(latLonToUnit(90, 0), segments, 0)
    expect(atlantic).toBeGreaterThan(pole)
  })

  it('does not create a tower at a crossing', () => {
    const crossing = displacementAt(latLonToUnit(39, 32), segments, 0, 0.045)
    expect(crossing).toBeLessThan(0.045)
  })

  it('wraps longitudes used by fixture paths', () => {
    expect(segments.length).toBeGreaterThan(4)
    expect(segments.length).toBeLessThanOrEqual(20)
  })

  it('maps a geographic anchor onto an orbital heading', () => {
    const newYork = latLonToOrbit(40.7, -74)
    expect(newYork.phi).toBeGreaterThan(0.5)
    expect(newYork.phi).toBeLessThan(Math.PI - 0.5)
    expect(Number.isFinite(newYork.theta)).toBe(true)
  })
})
