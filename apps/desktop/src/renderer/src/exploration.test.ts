import { describe, expect, it } from 'vitest'
import {
  nudgeOrbit,
  restoreAfterTopic,
  scaleFromDistance,
  shouldSnapshotBeforeTopic,
  zoomTowardEarth,
  zoomTowardTopic,
} from './exploration'

describe('exploration scale', () => {
  it('moves from planet toward a topic and back through city', () => {
    expect(zoomTowardTopic('earth')).toBe('region')
    expect(zoomTowardTopic('region')).toBe('city')
    expect(zoomTowardTopic('city')).toBe('topic')
    expect(zoomTowardTopic('topic')).toBe('topic')
    expect(zoomTowardEarth('topic')).toBe('city')
    expect(zoomTowardEarth('city')).toBe('region')
    expect(zoomTowardEarth('earth')).toBe('earth')
  })

  it('maps camera distance onto a continuous scale', () => {
    expect(scaleFromDistance(3.5)).toBe('earth')
    expect(scaleFromDistance(2.5)).toBe('region')
    expect(scaleFromDistance(1.9)).toBe('city')
    expect(scaleFromDistance(1.6)).toBe('topic')
  })

  it('turns the viewpoint with the arrow keys and stays off the poles', () => {
    const pose = { theta: 0.4, phi: 1.2, radius: 3.52 }
    expect(nudgeOrbit(pose, 'left').theta).toBeCloseTo(0.48)
    expect(nudgeOrbit(pose, 'right').theta).toBeCloseTo(0.32)
    expect(nudgeOrbit(pose, 'up').phi).toBeGreaterThan(pose.phi)
    expect(nudgeOrbit({ ...pose, phi: 0.2 }, 'down').phi).toBeCloseTo(0.18)
    expect(nudgeOrbit({ ...pose, phi: 2.9 }, 'up').phi).toBeLessThan(Math.PI - 0.17)
  })

  it('restores the exact viewpoint after leaving a topic', () => {
    const saved = { theta: 1.1, phi: 0.9, radius: 2.48 }
    expect(shouldSnapshotBeforeTopic('city', 'topic')).toBe(true)
    expect(restoreAfterTopic('topic', 'city', saved)).toEqual(saved)
    expect(restoreAfterTopic('city', 'region', saved)).toBeNull()
  })
})
