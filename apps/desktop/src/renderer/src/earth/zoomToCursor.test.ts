import { describe, expect, it } from 'vitest'
import {
  orbitKeepingPointUnderCursor,
  PHI_MAX,
  PHI_MIN,
  projectToNdc,
  surfaceUnderCursor,
  wheelRadius,
} from './zoomToCursor'

const lens = { fovDeg: 38, aspect: 1.6 }

describe('surfaceUnderCursor / projectToNdc', () => {
  it('the screen centre looks at the point straight below the camera', () => {
    const hit = surfaceUnderCursor({ theta: 0.4, phi: 1.1, radius: 4 }, { x: 0, y: 0 }, lens)
    expect(hit).not.toBeNull()
    expect(hit!.x).toBeCloseTo(Math.sin(1.1) * Math.sin(0.4), 6)
    expect(hit!.y).toBeCloseTo(Math.cos(1.1), 6)
  })

  it('round-trips a cursor position through the surface', () => {
    const orbit = { theta: -1.2, phi: 1.4, radius: 3.2 }
    const ndc = { x: 0.31, y: -0.22 }
    const hit = surfaceUnderCursor(orbit, ndc, lens)!
    const back = projectToNdc(orbit, hit, lens)!
    expect(back.x).toBeCloseTo(ndc.x, 6)
    expect(back.y).toBeCloseTo(ndc.y, 6)
  })

  it('misses the globe in empty space', () => {
    expect(surfaceUnderCursor({ theta: 0, phi: 1.3, radius: 4.35 }, { x: 0.95, y: 0.9 }, lens)).toBeNull()
  })
})

describe('orbitKeepingPointUnderCursor', () => {
  it('keeps an off-centre point under the cursor as the camera moves in', () => {
    const start = { theta: 0.35, phi: 1.28, radius: 4.35 }
    const ndc = { x: 0.35, y: 0.25 }
    const point = surfaceUnderCursor(start, ndc, lens)!
    let orbit = start
    for (const radius of [3.8, 3.1, 2.4, 1.9, 1.6]) {
      orbit = orbitKeepingPointUnderCursor(orbit, radius, point, ndc, lens)
      const at = projectToNdc(orbit, point, lens)!
      expect(at.x).toBeCloseTo(ndc.x, 3)
      expect(at.y).toBeCloseTo(ndc.y, 3)
      expect(orbit.radius).toBe(radius)
    }
    // Zooming in toward a point right of centre turns the camera toward it, not away.
    expect(orbit.theta).toBeGreaterThan(start.theta)
    expect(orbit.phi).toBeLessThan(start.phi)
  })

  it('keeps the point under the cursor zooming out too', () => {
    const start = { theta: 2, phi: 1.6, radius: 1.7 }
    const ndc = { x: -0.2, y: -0.15 }
    const point = surfaceUnderCursor(start, ndc, lens)!
    const orbit = orbitKeepingPointUnderCursor(start, 3.5, point, ndc, lens)
    const at = projectToNdc(orbit, point, lens)!
    expect(at.x).toBeCloseTo(ndc.x, 3)
    expect(at.y).toBeCloseTo(ndc.y, 3)
  })

  it('leaves the pose alone when the cursor is at the centre', () => {
    const start = { theta: 1, phi: 1.2, radius: 4 }
    const point = surfaceUnderCursor(start, { x: 0, y: 0 }, lens)!
    const orbit = orbitKeepingPointUnderCursor(start, 2, point, { x: 0, y: 0 }, lens)
    expect(orbit.theta).toBeCloseTo(1, 5)
    expect(orbit.phi).toBeCloseTo(1.2, 5)
  })

  it('takes the short way round across the theta seam', () => {
    const start = { theta: Math.PI - 0.05, phi: 1.3, radius: 4 }
    const ndc = { x: 0.3, y: 0 }
    const point = surfaceUnderCursor(start, ndc, lens)!
    const orbit = orbitKeepingPointUnderCursor(start, 2, point, ndc, lens)
    expect(Math.abs(orbit.theta - start.theta)).toBeLessThan(1)
  })

  it('pulls a point near the limb toward the centre rather than losing it over the horizon', () => {
    const start = { theta: 0, phi: 1.3, radius: 4.35 }
    const ndc = { x: 0.41, y: 0 }
    const point = surfaceUnderCursor(start, ndc, lens)!
    const orbit = orbitKeepingPointUnderCursor(start, 1.5, point, ndc, lens)
    const at = projectToNdc(orbit, point, lens)
    expect(at).not.toBeNull()
    expect(at!.x).toBeGreaterThan(0)
    expect(at!.x).toBeLessThanOrEqual(ndc.x + 1e-3)
    expect(orbit.phi).toBeGreaterThanOrEqual(PHI_MIN)
    expect(orbit.phi).toBeLessThanOrEqual(PHI_MAX)
  })
})

describe('wheelRadius', () => {
  it('scrolling forward (negative deltaY) zooms in and back zooms out', () => {
    expect(wheelRadius(4, -100)).toBeLessThan(4)
    expect(wheelRadius(4, 100)).toBeGreaterThan(4)
  })

  it('steps by altitude, so close in a notch moves less', () => {
    const far = 4.35 - wheelRadius(4.35, -100)
    const near = 1.8 - wheelRadius(1.8, -100)
    expect(near).toBeLessThan(far)
    expect(near).toBeGreaterThan(0)
  })

  it('pinch deltas reach further per unit, and both clamp to the rig limits', () => {
    expect(4 - wheelRadius(4, -5, { pinch: true })).toBeGreaterThan(4 - wheelRadius(4, -5))
    expect(wheelRadius(1.5, -10_000)).toBe(1.2)
    expect(wheelRadius(5, 10_000)).toBe(5.4)
  })
})
