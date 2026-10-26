import type { GeoPoint, Vec3 } from './types'

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180
}

export function latLonToUnit(latDeg: number, lonDeg: number): Vec3 {
  const lat = degToRad(latDeg)
  const lon = degToRad(lonDeg)
  const cosLat = Math.cos(lat)
  return {
    x: cosLat * Math.cos(lon),
    y: Math.sin(lat),
    z: cosLat * Math.sin(lon),
  }
}

export function latLonToOrbit(latDeg: number, lonDeg: number): { theta: number; phi: number } {
  const point = latLonToRender(latDeg, lonDeg)
  return {
    theta: Math.atan2(point.x, point.z),
    phi: Math.acos(Math.min(1, Math.max(-1, point.y))),
  }
}

export function latLonToRender(latDeg: number, lonDeg: number): Vec3 {
  const lat = degToRad(latDeg)
  const lon = degToRad(lonDeg)
  const cosLat = Math.cos(lat)
  return {
    // Matches SphereGeometry's UVs with the standard equirectangular map:
    // longitude 0 is centered on the texture and faces +X; -90 faces +Z.
    x: cosLat * Math.cos(lon),
    y: Math.sin(lat),
    z: -cosLat * Math.sin(lon),
  }
}

export function wrapLongitude(lonDeg: number): number {
  let lon = lonDeg
  while (lon > 180) lon -= 360
  while (lon < -180) lon += 360
  return lon
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

export function length(value: Vec3): number {
  return Math.hypot(value.x, value.y, value.z)
}

export function normalize(value: Vec3): Vec3 {
  const magnitude = length(value)
  if (magnitude === 0) return { x: 0, y: 0, z: 0 }
  return { x: value.x / magnitude, y: value.y / magnitude, z: value.z / magnitude }
}

/** Stable orthonormal tangent frame for finite differences on any sphere axis. */
export function stableTangentBasis(direction: Vec3): { tangent: Vec3; bitangent: Vec3 } {
  const unit = normalize(direction)
  const normal = length(unit) > 0 ? unit : { x: 0, y: 1, z: 0 }
  const reference = Math.abs(normal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
  const tangent = normalize(cross(reference, normal))
  const bitangent = normalize(cross(normal, tangent))
  return { tangent, bitangent }
}

export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.min(1, Math.max(-1, dot(normalize(a), normalize(b)))))
}

export function distToArc(point: Vec3, start: Vec3, end: Vec3): { distance: number; along: number } {
  const a = normalize(start)
  const b = normalize(end)
  const p = normalize(point)
  const axis = cross(a, b)
  const axisLength = length(axis)
  if (axisLength < 1e-8) {
    const distance = angleBetween(p, a)
    return { distance, along: 0 }
  }
  const closest = normalize(cross(axis, cross(p, axis)))
  const ab = angleBetween(a, b)
  const ac = angleBetween(a, closest)
  const bc = angleBetween(b, closest)
  const onArc = ac <= ab + 1e-4 && bc <= ab + 1e-4
  if (onArc) {
    return {
      distance: Math.abs(Math.asin(Math.min(1, Math.max(-1, dot(p, normalize(axis)))))),
      along: ac,
    }
  }
  const toA = angleBetween(p, a)
  const toB = angleBetween(p, b)
  return toA < toB ? { distance: toA, along: 0 } : { distance: toB, along: ab }
}
