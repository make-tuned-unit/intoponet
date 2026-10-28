import { COUNTRY_SHAPES, type CountryShape } from './countryShapes'

const Q = 100
/** A click this close to a tiny island country (no shape at 1:50m, or a speck) still finds it. */
const TINY_REACH_DEG = 0.6
const COAST_REACH_DEG = 0.15
/** Countries smaller than this (deg²) are specks: hard to hit, so they win when close. */
const SPECK_AREA = 0.05

function inRing(ring: number[], lon: number, lat: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i]! / Q
    const yi = ring[i + 1]! / Q
    const xj = ring[j]! / Q
    const yj = ring[j + 1]! / Q
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const area = (shape: CountryShape): number => (shape.bbox[2] - shape.bbox[0]) * (shape.bbox[3] - shape.bbox[1])

/**
 * The country at a point on Earth, or null over open sea. When shapes overlap
 * (an enclave such as Lesotho inside South Africa's outline), the smallest
 * wins. Tiny island countries are found within ~60 km of their outline or point.
 * `reachDeg`: how far the cursor can be from a speck and still hit it (about
 * 10 px at the current zoom).
 */
export function countryAt(lat: number, lon: number, reachDeg = 0.02): CountryShape | null {
  const scale = Math.cos((lat * Math.PI) / 180)
  const boxDistance = (shape: CountryShape): number => {
    const [west, south, east, north] = shape.bbox
    const dLat = lat < south ? south - lat : lat > north ? lat - north : 0
    const dLon = (lon < west ? west - lon : lon > east ? lon - east : 0) * scale
    return Math.hypot(dLat, dLon)
  }
  // A speck under the cursor (Vatican City, Gibraltar) wins over the country around it.
  let speck: CountryShape | null = null
  let speckDistance = reachDeg
  for (const shape of COUNTRY_SHAPES) {
    if (area(shape) > SPECK_AREA) continue
    const distance = boxDistance(shape)
    if (distance <= speckDistance) {
      speck = shape
      speckDistance = distance
    }
  }
  if (speck) return speck
  let best: CountryShape | null = null
  for (const shape of COUNTRY_SHAPES) {
    const [west, south, east, north] = shape.bbox
    if (lon < west || lon > east || lat < south || lat > north || !shape.rings.length) continue
    if (shape.rings.some((ring) => inRing(ring, lon, lat)) && (!best || area(shape) < area(best))) best = shape
  }
  if (best) return best
  // On the coast: outlines are simplified to ~2 km, so a harbour city can fall just outside. Take the nearest outline within ~15 km.
  let coastal: CountryShape | null = null
  let coastalDistance = Math.max(COAST_REACH_DEG, reachDeg)
  for (const shape of COUNTRY_SHAPES) {
    const [west, south, east, north] = shape.bbox
    if (lon < west - 0.3 || lon > east + 0.3 || lat < south - 0.3 || lat > north + 0.3) continue
    for (const ring of shape.rings) {
      for (let i = 0; i < ring.length; i += 2) {
        const distance = Math.hypot(ring[i + 1]! / Q - lat, (ring[i]! / Q - lon) * scale)
        if (distance < coastalDistance) {
          coastal = shape
          coastalDistance = distance
        }
      }
    }
  }
  if (coastal) return coastal
  let nearest: CountryShape | null = null
  let nearestDistance = TINY_REACH_DEG
  for (const shape of COUNTRY_SHAPES) {
    if (area(shape) > 1) continue
    const distance = boxDistance(shape)
    if (distance < nearestDistance) {
      nearest = shape
      nearestDistance = distance
    }
  }
  return nearest
}

/** The labelled shape for a country code (its main part). */
export function countryShape(code: string): CountryShape | null {
  return COUNTRY_SHAPES.find((shape) => shape.code === code && shape.name) ?? null
}

/**
 * The country a view centred here is about: the one under the point, or else
 * the nearest country label within `viewDeg` (island nations whose label sits
 * in the sea between islands, like New Zealand).
 */
export function countryInFocus(lat: number, lon: number, viewDeg: number): CountryShape | null {
  const under = countryAt(lat, lon, viewDeg * 0.1)
  if (under) return countryShape(under.code) ?? under
  const scale = Math.cos((lat * Math.PI) / 180)
  let best: CountryShape | null = null
  let bestDistance = viewDeg
  for (const shape of COUNTRY_SHAPES) {
    if (!shape.name) continue
    const dLon = ((((shape.lon - lon) % 360) + 540) % 360) - 180
    const distance = Math.hypot(shape.lat - lat, dLon * scale)
    if (distance < bestDistance) {
      best = shape
      bestDistance = distance
    }
  }
  return best
}
