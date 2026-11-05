/**
 * Zoom-to-cursor for the orbit camera: the camera sits at (theta, phi, radius) on a sphere
 * around the globe, looks at the origin with world +Y up (as three's lookAt does), and has
 * no roll. Given a surface point that is under the cursor, find the orbit angles that keep
 * it under the cursor at a new radius.
 */

export type Vec3 = { x: number; y: number; z: number }
export type Orbit = { theta: number; phi: number; radius: number }
/** Normalized device coordinates: -1..1, +y up. */
export type Ndc = { x: number; y: number }
export type Lens = { fovDeg: number; aspect: number; globeRadius?: number }

export const PHI_MIN = 0.18
export const PHI_MAX = Math.PI - 0.18

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const scaled = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
const unit = (a: Vec3): Vec3 => scaled(a, 1 / Math.hypot(a.x, a.y, a.z))

export function orbitPosition({ theta, phi, radius }: Orbit): Vec3 {
  return {
    x: radius * Math.sin(phi) * Math.sin(theta),
    y: radius * Math.cos(phi),
    z: radius * Math.sin(phi) * Math.cos(theta),
  }
}

/** Camera basis: right, up, and back (the camera looks down -back), matching Object3D.lookAt. */
function basis(orbit: Orbit): { eye: Vec3; right: Vec3; up: Vec3; back: Vec3 } {
  const eye = orbitPosition(orbit)
  const back = unit(eye)
  const right = unit(cross({ x: 0, y: 1, z: 0 }, back))
  return { eye, right, up: cross(back, right), back }
}

/** Where the ray through `ndc` first meets the globe, or null when it misses. */
export function surfaceUnderCursor(orbit: Orbit, ndc: Ndc, lens: Lens): Vec3 | null {
  const { eye, right, up, back } = basis(orbit)
  const tan = Math.tan((lens.fovDeg * Math.PI) / 360)
  const direction = unit({
    x: ndc.x * tan * lens.aspect * right.x + ndc.y * tan * up.x - back.x,
    y: ndc.x * tan * lens.aspect * right.y + ndc.y * tan * up.y - back.y,
    z: ndc.x * tan * lens.aspect * right.z + ndc.y * tan * up.z - back.z,
  })
  const r = lens.globeRadius ?? 1
  const b = dot(eye, direction)
  const disc = b * b - (dot(eye, eye) - r * r)
  if (disc < 0) return null
  const t = -b - Math.sqrt(disc)
  if (t <= 0) return null
  return { x: eye.x + direction.x * t, y: eye.y + direction.y * t, z: eye.z + direction.z * t }
}

/** Screen position of a world point, or null if it is behind the camera or on the far side of the globe. */
export function projectToNdc(orbit: Orbit, point: Vec3, lens: Lens): Ndc | null {
  const { eye, right, up, back } = basis(orbit)
  const v = sub(point, eye)
  const depth = -dot(v, back)
  if (depth <= 1e-6) return null
  // Far side: the point's outward normal faces away from the camera.
  if (dot(point, sub(eye, point)) < -1e-6) return null
  const tan = Math.tan((lens.fovDeg * Math.PI) / 360)
  return { x: dot(v, right) / (depth * tan * lens.aspect), y: dot(v, up) / (depth * tan) }
}

const clampPhi = (phi: number): number => Math.min(PHI_MAX, Math.max(PHI_MIN, phi))

/** Gauss-Newton on (theta, phi) so `point` projects to `ndc` at `radius`. Returns null if it can't get there. */
function solve(start: Orbit, radius: number, point: Vec3, ndc: Ndc, lens: Lens): Orbit | null {
  let theta = start.theta
  let phi = clampPhi(start.phi)
  const h = 1e-5
  for (let i = 0; i < 12; i += 1) {
    const at = projectToNdc({ theta, phi, radius }, point, lens)
    if (!at) return null
    const ex = at.x - ndc.x
    const ey = at.y - ndc.y
    if (Math.hypot(ex, ey) < 1e-6) break
    const dt = projectToNdc({ theta: theta + h, phi, radius }, point, lens)
    const dp = projectToNdc({ theta, phi: phi + h, radius }, point, lens)
    if (!dt || !dp) return null
    const a = (dt.x - at.x) / h
    const c = (dt.y - at.y) / h
    const b = (dp.x - at.x) / h
    const d = (dp.y - at.y) / h
    const det = a * d - b * c
    if (Math.abs(det) < 1e-12) return null
    let stepTheta = (d * ex - b * ey) / det
    let stepPhi = (-c * ex + a * ey) / det
    // Damp large steps so one iteration never swings the globe round.
    const size = Math.hypot(stepTheta, stepPhi)
    if (size > 0.5) {
      stepTheta *= 0.5 / size
      stepPhi *= 0.5 / size
    }
    theta -= stepTheta
    phi = clampPhi(phi - stepPhi)
  }
  const end = projectToNdc({ theta, phi, radius }, point, lens)
  if (!end || Math.hypot(end.x - ndc.x, end.y - ndc.y) > 2e-3) return null
  return { theta, phi, radius }
}

/**
 * Orbit at `radius` that keeps `point` (on the globe) under the cursor at `ndc`.
 * When the point can't stay exactly there (e.g. it's near the limb and the camera moves in,
 * so it would pass over the horizon), it is kept as close to the cursor as possible along the
 * line to the screen centre. Theta stays continuous with `current` (no full-turn jumps).
 */
export function orbitKeepingPointUnderCursor(
  current: Orbit,
  radius: number,
  point: Vec3,
  ndc: Ndc,
  lens: Lens,
): Orbit {
  const exact = solve(current, radius, point, ndc, lens)
  if (exact) return exact
  // Looking straight down at the point always works; start from there when the current
  // angles would put the point over the horizon at this radius.
  const turn = Math.PI * 2
  const aimTheta = Math.atan2(point.x, point.z)
  const aimed: Orbit = {
    theta: current.theta + ((((aimTheta - current.theta) % turn) + turn * 1.5) % turn) - Math.PI,
    phi: clampPhi(Math.acos(Math.max(-1, Math.min(1, point.y / Math.hypot(point.x, point.y, point.z))))),
    radius,
  }
  const fromAim = solve(aimed, radius, point, ndc, lens)
  if (fromAim) return fromAim
  // Otherwise, the largest fraction of the way out to the cursor that is still reachable.
  let lo = 0
  let hi = 1
  let best: Orbit = solve(aimed, radius, point, { x: 0, y: 0 }, lens) ?? aimed
  for (let i = 0; i < 10; i += 1) {
    const mid = (lo + hi) / 2
    const found = solve(best, radius, point, { x: ndc.x * mid, y: ndc.y * mid }, lens)
    if (found) {
      lo = mid
      best = found
    } else {
      hi = mid
    }
  }
  return best
}

/**
 * New camera radius after a wheel step. Zoom is proportional to altitude above the
 * surface, so a notch feels the same far out as close in.
 */
export function wheelRadius(
  radius: number,
  deltaY: number,
  { pinch = false, min = 1.2, max = 5.4 }: { pinch?: boolean; min?: number; max?: number } = {},
): number {
  const altitude = Math.max(1e-3, radius - 1)
  // Trackpad pinch (ctrl+wheel) reports small deltas; give it more reach per unit.
  const k = pinch ? 0.01 : 0.0011
  const next = 1 + altitude * Math.exp(deltaY * k)
  return Math.min(max, Math.max(min, next))
}
