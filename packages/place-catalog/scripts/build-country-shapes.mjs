// Country shapes for the globe: which country is under the cursor, and where its name goes.
// Source: Natural Earth 1:50m Admin 0 – Countries (public domain), naturalearthdata.com.
//   curl -L -o ne50.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
//   node packages/place-catalog/scripts/build-country-shapes.mjs ne50.geojson
// Writes apps/desktop/src/shared/places/countryShapes.ts. Every country in COUNTRY_ROWS is
// accounted for: one too small for the 1:50m data gets a point (its capital) instead of a shape.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '../../..')
const out = join(repo, 'apps/desktop/src/shared/places/countryShapes.ts')
const input = process.argv[2]
if (!input) throw new Error('Usage: build-country-shapes.mjs <ne_50m_admin_0_countries.geojson>')

// Tolerance in degrees (~2 km); coordinates stored as integers of 1/100 degree.
const TOLERANCE = 0.02
const Q = 100

// Disputed or tiny overlays: clickable as their country, but never labelled on their own.
const UNLABELLED = new Set(['N. Cyprus', 'Siachen Glacier', 'Indian Ocean Ter.', 'Ashmore and Cartier Is.', 'Baikonur', 'Cyprus U.N. Buffer Zone'])
// Natural Earth parts with no ISO code of their own.
const CODE_FALLBACK = { Somaliland: 'SO', 'N. Cyprus': 'CY', 'Siachen Glacier': 'IN' }

function simplify(points, tolerance) {
  // A closed ring starts and ends on the same point: simplify its two halves, split at the point farthest from the start.
  const [sx, sy] = points[0]
  const [ex, ey] = points[points.length - 1]
  if (points.length > 4 && sx === ex && sy === ey) {
    let far = 1
    for (let i = 1; i < points.length - 1; i += 1) if (Math.hypot(points[i][0] - sx, points[i][1] - sy) > Math.hypot(points[far][0] - sx, points[far][1] - sy)) far = i
    return [...simplifyOpen(points.slice(0, far + 1), tolerance), ...simplifyOpen(points.slice(far), tolerance).slice(1)]
  }
  return simplifyOpen(points, tolerance)
}

function simplifyOpen(points, tolerance) {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    const [ax, ay] = points[a]
    const [bx, by] = points[b]
    const dx = bx - ax
    const dy = by - ay
    const length = Math.hypot(dx, dy) || 1e-12
    let best = -1
    let bestDistance = tolerance
    for (let i = a + 1; i < b; i += 1) {
      const [px, py] = points[i]
      const distance = Math.abs(dy * px - dx * py + bx * ay - by * ax) / length
      if (distance > bestDistance) { best = i; bestDistance = distance }
    }
    if (best !== -1) {
      keep[best] = 1
      stack.push([a, best], [best, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

// COUNTRY_ROWS from the bundled place data: [code, name, lat, lon, radiusKm, population].
const placeData = readFileSync(join(repo, 'apps/desktop/src/shared/places/placeData.ts'), 'utf8')
const rows = JSON.parse(placeData.match(/export const COUNTRY_ROWS: CountryRow\[\] = (\[.*?\])\n/s)[1])

const geo = JSON.parse(readFileSync(input, 'utf8'))
const shapes = []
for (const feature of geo.features) {
  const p = feature.properties
  const code = [p.ISO_A2_EH, p.ISO_A2].find((value) => value && value !== '-99') ?? CODE_FALLBACK[p.NAME]
  if (!code) { console.warn(`No code for ${p.NAME}; skipped`); continue }
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates
  const rings = []
  let west = 180, south = 90, east = -180, north = -90
  // Outer rings only (holes are lakes or enclaves, which other features cover).
  const outers = polygons.map((polygon) => polygon[0])
  const largest = Math.max(...outers.map((ring) => ring.length))
  for (const ring of outers) {
    let simple = simplify(ring, TOLERANCE)
    // Keep islands that survive simplification, and always the main shape of a tiny country.
    if (simple.length < 4) {
      if (ring.length !== largest) continue
      simple = ring
    }
    const flat = []
    for (const [lon, lat] of simple) {
      flat.push(Math.round(lon * Q), Math.round(lat * Q))
      west = Math.min(west, lon); east = Math.max(east, lon); south = Math.min(south, lat); north = Math.max(north, lat)
    }
    rings.push(flat)
  }
  if (!rings.length) continue
  shapes.push({
    code,
    name: UNLABELLED.has(p.NAME) ? '' : p.NAME,
    lat: Math.round(p.LABEL_Y * Q) / Q,
    lon: Math.round(p.LABEL_X * Q) / Q,
    // Natural Earth's own label priority: the lowest map zoom at which the name appears.
    rank: Math.round((p.MIN_LABEL ?? p.LABELRANK ?? 6) * 10) / 10,
    bbox: [west, south, east, north].map((value) => Math.round(value * Q) / Q),
    rings,
  })
}

// Overseas parts folded into another country's shape (French Guiana in France, Svalbard in Norway):
// the island or territory holding that country's capital becomes its own shape.
const inRing = (ring, lon, lat) => {
  let inside = false
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i] / Q, yi = ring[i + 1] / Q, xj = ring[j] / Q, yj = ring[j + 1] / Q
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const ringBox = (ring) => {
  const xs = ring.filter((_, i) => i % 2 === 0).map((v) => v / Q)
  const ys = ring.filter((_, i) => i % 2 === 1).map((v) => v / Q)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}
for (const [code, name, lat, lon] of rows) {
  if (shapes.some((shape) => shape.code === code)) continue
  for (const shape of shapes) {
    const index = shape.rings.findIndex((ring) => inRing(ring, lon, lat))
    // Never carve out a country's main shape.
    if (index === -1 || shape.rings.length === 1) continue
    const [ring] = shape.rings.splice(index, 1)
    const box = ringBox(ring)
    // The rest of that territory: nearby islands of the same group (Guadeloupe's, Svalbard's).
    const group = []
    for (let i = shape.rings.length - 1; i >= 0; i -= 1) {
      const [w, s, e, n] = ringBox(shape.rings[i])
      if (Math.abs((w + e) / 2 - (box[0] + box[2]) / 2) < 3 && Math.abs((s + n) / 2 - (box[1] + box[3]) / 2) < 3) group.push(...shape.rings.splice(i, 1))
    }
    const rings = [ring, ...group]
    const boxes = rings.map(ringBox)
    shapes.push({
      code, name, lat, lon, rank: 6,
      bbox: [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))].map((v) => Math.round(v * Q) / Q),
      rings,
    })
    const rest = shape.rings.map(ringBox)
    shape.bbox = [Math.min(...rest.map((b) => b[0])), Math.min(...rest.map((b) => b[1])), Math.max(...rest.map((b) => b[2])), Math.max(...rest.map((b) => b[3]))].map((v) => Math.round(v * Q) / Q)
    break
  }
}

// Every country the app knows: a point where the 1:50m data has no shape.
const shaped = new Set(shapes.map((shape) => shape.code))
const points = rows.filter(([code]) => !shaped.has(code)).map(([code, name, lat, lon]) => ({ code, name, lat, lon, rank: 7, bbox: [lon, lat, lon, lat], rings: [] }))
const all = [...shapes, ...points]
const missing = rows.filter(([code]) => !all.some((shape) => shape.code === code))
if (missing.length) throw new Error(`Countries not accounted for: ${missing.map(([code]) => code).join(', ')}`)

const header = `// Generated by packages/place-catalog/scripts/build-country-shapes.mjs — do not edit.
// Natural Earth 1:50m Admin 0 – Countries (public domain), simplified to ~2 km; coordinates in 1/100 degree.
// Countries without a 1:50m shape are points (capital) with no rings.
`
const type = `export type CountryShape = {
  code: string
  /** Map label ("Dem. Rep. Congo"); empty for parts that are never labelled on their own. */
  name: string
  /** Where the label goes. */
  lat: number
  lon: number
  /** Natural Earth label priority: lower names show from further away. */
  rank: number
  /** [west, south, east, north] in degrees. */
  bbox: [number, number, number, number]
  /** Outer rings as flat [lon, lat, lon, lat, …] in 1/100 degree. */
  rings: number[][]
}
`
writeFileSync(out, `${header}${type}\nexport const COUNTRY_SHAPES: CountryShape[] = ${JSON.stringify(all)}\n`)
const pointsCount = all.reduce((sum, shape) => sum + shape.rings.reduce((n, ring) => n + ring.length / 2, 0), 0)
console.log(`${shapes.length} shapes (overseas parts split out), ${points.length} point-only (${points.map((p) => p.code).join(' ')}), ${pointsCount} vertices → ${out}`)
