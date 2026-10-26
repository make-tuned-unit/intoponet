import { describe, expect, it } from 'vitest'
import { displacementAt, fieldAt, phaseModulationDepth, segmentsFromBands } from './evaluate'
import { syntheticFrequencyBands } from './fixtures'
import { cross, distToArc, dot, latLonToOrbit, latLonToRender, latLonToUnit, normalize, stableTangentBasis } from './geo'
import type { FrequencyBand } from './types'

const stamp = '2026-10-23T00:00:00.000Z'
function localBand(overrides: Partial<FrequencyBand> = {}): FrequencyBand {
  return {
    id: 'local', centerline: [{ lat: 0, lon: 0 }, { lat: 0, lon: 5 }], widthKm: 500,
    wavelengthKm: 1000, amplitude: 0.5, phase: 0, phaseVelocity: 0.4, confidence: 0.9,
    topicIds: ['test'], updatedAt: stamp, sourceType: 'synthetic', ...overrides,
  }
}

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

  it('aligns rendered coordinates with standard equirectangular Earth UVs', () => {
    const primeMeridian = latLonToRender(0, 0)
    const west90 = latLonToRender(0, -90)
    const east90 = latLonToRender(0, 90)
    const antimeridian = latLonToRender(0, 180)
    expect(primeMeridian.x).toBeCloseTo(1)
    expect(primeMeridian.z).toBeCloseTo(0)
    expect(west90.x).toBeCloseTo(0)
    expect(west90.z).toBeCloseTo(1)
    expect(east90.x).toBeCloseTo(0)
    expect(east90.z).toBeCloseTo(-1)
    expect(antimeridian.x).toBeCloseTo(-1)
    expect(antimeridian.z).toBeCloseTo(0)
    expect(latLonToOrbit(0, -90).theta).toBeCloseTo(0)
    expect(latLonToOrbit(0, 0).theta).toBeCloseTo(Math.PI / 2)
  })

  it('keeps activity phase modulation within the specified restrained range', () => {
    expect(phaseModulationDepth()).toBe(0.14)
    expect(phaseModulationDepth(0)).toBe(0.08)
    expect(phaseModulationDepth(1)).toBe(0.2)
  })

  it('increasing intensity raises the same fixed location', () => {
    const point = latLonToUnit(0, 2)
    const low = displacementAt(point, segmentsFromBands([localBand({ amplitude: 0.25 })]), 1.7)
    const high = displacementAt(point, segmentsFromBands([localBand({ amplitude: 0.8 })]), 1.7)
    expect(high).toBeGreaterThan(low)
  })

  it('increasing reach widens the envelope without increasing its center peak', () => {
    const center = latLonToUnit(0, 2)
    const shoulder = latLonToUnit(2, 2)
    const narrow = segmentsFromBands([localBand({ widthKm: 500 })])
    const broad = segmentsFromBands([localBand({ widthKm: 1000 })])
    expect(broad[0]?.ax).toBe(narrow[0]?.ax)
    expect(broad[0]?.ay).toBe(narrow[0]?.ay)
    expect(broad[0]?.az).toBe(narrow[0]?.az)
    expect(fieldAt(center, broad, 1.2)).toBeCloseTo(fieldAt(center, narrow, 1.2), 10)
    expect(fieldAt(shoulder, broad, 1.2)).toBeGreaterThan(fieldAt(shoulder, narrow, 1.2))
  })

  it('keeps the envelope baseline phase independent over a full cycle', () => {
    const sample = latLonToUnit(1, 2)
    const one = segmentsFromBands([localBand({ phaseModulation: 0.2 })])
    const segment = one[0]!
    const distance = distToArc(sample, { x: segment.ax, y: segment.ay, z: segment.az }, { x: segment.bx, y: segment.by, z: segment.bz }).distance
    const base = segment.amplitude * Math.exp(-0.5 * (distance / segment.sigma) ** 2)
    const period = (Math.PI * 2) / (one[0]?.omega ?? 1)
    const average = Array.from({ length: 120 }, (_, index) => fieldAt(sample, one, period * index / 120))
      .reduce((sum, value) => sum + value, 0) / 120
    expect(average).toBeCloseTo(base, 3)
  })

  it('saturates overlapping activity without exceeding the displacement ceiling', () => {
    const point = latLonToUnit(0, 2)
    const one = displacementAt(point, segmentsFromBands([localBand({ amplitude: 1 })]), 0.2, 0.045)
    const overlap = displacementAt(point, segmentsFromBands([
      localBand({ amplitude: 1 }), localBand({ id: 'second', amplitude: 1, phase: 1 }),
    ]), 0.2, 0.045)
    expect(overlap).toBeGreaterThan(one)
    expect(overlap).toBeLessThan(0.045)
  })

  it('keeps antimeridian and polar corridors finite and geographically local', () => {
    const acrossDateLine = localBand({ centerline: [{ lat: 0, lon: 179 }, { lat: 0, lon: -179 }] })
    const seamSegments = segmentsFromBands([acrossDateLine])
    const seam = fieldAt(latLonToUnit(0, 180), seamSegments, 0)
    const distant = fieldAt(latLonToUnit(0, 150), seamSegments, 0)
    expect(Number.isFinite(seam)).toBe(true)
    expect(seam).toBeGreaterThan(distant)

    const polar = localBand({ centerline: [{ lat: 88, lon: -90 }, { lat: 88, lon: 90 }], widthKm: 1200 })
    const polarValue = fieldAt(latLonToUnit(89, 0), segmentsFromBands([polar]), 0)
    expect(Number.isFinite(polarValue)).toBe(true)
    expect(polarValue).toBeGreaterThan(0)
  })

  it('builds stable outward finite-difference normals at poles and axis-aligned points', () => {
    const axes = [
      { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
    ]
    const fixture = segmentsFromBands([
      localBand({ centerline: [{ lat: 86, lon: -90 }, { lat: 88, lon: 90 }], widthKm: 950 }),
    ])
    for (const raw of axes) {
      const normal = normalize(raw)
      const { tangent, bitangent } = stableTangentBasis(normal)
      expect(Number.isFinite(tangent.x + tangent.y + tangent.z + bitangent.x + bitangent.y + bitangent.z)).toBe(true)
      expect(dot(normal, tangent)).toBeCloseTo(0, 8)
      expect(dot(normal, bitangent)).toBeCloseTo(0, 8)
      expect(dot(cross(tangent, bitangent), normal)).toBeGreaterThan(0.999999)

      const offset = (direction: typeof normal) => {
        const point = normalize({ x: normal.x + direction.x * 0.012, y: normal.y + direction.y * 0.012, z: normal.z + direction.z * 0.012 })
        const radius = 1 + displacementAt(point, fixture, 0.4)
        return { x: point.x * radius, y: point.y * radius, z: point.z * radius }
      }
      const p = offset({ x: 0, y: 0, z: 0 })
      const pu = offset(tangent)
      const pv = offset(bitangent)
      const surfaceNormal = normalize(cross(
        { x: pu.x - p.x, y: pu.y - p.y, z: pu.z - p.z },
        { x: pv.x - p.x, y: pv.y - p.y, z: pv.z - p.z },
      ))
      expect(Number.isFinite(surfaceNormal.x + surfaceNormal.y + surfaceNormal.z)).toBe(true)
      expect(dot(surfaceNormal, normal)).toBeGreaterThan(0)
    }
  })
})
