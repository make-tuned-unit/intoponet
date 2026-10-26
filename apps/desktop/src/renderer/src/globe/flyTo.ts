import { latLonToOrbit } from '@intoponet/frequency-field'
import type { OrbitPose } from '../exploration'

/** Camera radius for framing a place of the given display radius. */
export function radiusForSpan(spanKm: number): number {
  // 1.62 frames a city closely; 4.35 frames the whole planet.
  const t = Math.min(1, Math.max(0, Math.log10(Math.max(30, spanKm) / 30) / Math.log10(4_000 / 30)))
  return 1.62 + t * (3.4 - 1.62)
}

/**
 * Orbit pose aiming at a point, taking the shortest way round so the camera
 * never spins a full turn to reach a nearby longitude.
 */
export function poseToward(current: OrbitPose, lat: number, lon: number, radius = current.radius): OrbitPose {
  const aim = latLonToOrbit(lat, lon)
  const turn = Math.PI * 2
  const delta = ((((aim.theta - current.theta) % turn) + turn * 1.5) % turn) - Math.PI
  return {
    theta: current.theta + delta,
    phi: Math.min(Math.PI - 0.18, Math.max(0.18, aim.phi)),
    radius,
  }
}
