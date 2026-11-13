import { storyHeight, type StoryMountain } from '../../../shared/news/storyMountains'
import { countryPlace } from '../../../shared/places/places'

/**
 * Story mountains as one height field. Each story is a broad shoulder over the
 * places covering it plus one summit, scaled to its fixed-scale height. Stories
 * combine by their upper envelope (the taller wins at each point, never a sum),
 * so overlapping stories cannot build a summit taller than the most-covered
 * story, and the tallest summit is always the most-covered story.
 *
 * Texture channels (RGBA Float32, equirectangular, the renderer's atan(-z, x)
 * convention): R height 0..1, G owner's momentum -1..1, B height relative to
 * the owner's own summit 0..1 (the crest cap reads this), A support 0..1.
 */
export type StoryTerrain = {
  data: Float32Array
  /** Index into `stories` of the story owning each pixel, or -1. */
  owner: Int16Array
  width: number
  height: number
  stories: StoryMountain[]
  key: string
}

const EARTH_RADIUS_KM = 6_371.0088
const DEG = Math.PI / 180
/** Shoulders are lower than the summit so a national story reads as a range with one peak, not a plateau. */
const SHOULDER = 0.35
/** A country's coverage hill: its own outlets on the same fixed scale, a little lower so it never reads as a second summit. */
export const ECHO_RADIUS_KM = 340
export const echoHeight = (outlets: number): number => 0.85 * storyHeight(outlets)
const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value))

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Compact Gaussian on the sphere: σ = half the support radius, tapering to exactly zero at the edge. */
function stamp(
  width: number,
  height: number,
  lat: number,
  lon: number,
  radiusKm: number,
  visit: (pixel: number, kernel: number) => void,
): void {
  const angular = Math.min(Math.PI, radiusKm / EARTH_RADIUS_KM)
  const cosCutoff = Math.cos(angular)
  const sinA = Math.sin(lat * DEG)
  const cosA = Math.cos(lat * DEG)
  const reach = angular / DEG
  const firstY = Math.max(0, Math.ceil(((lat - reach + 90) / 180) * height - 0.5))
  const lastY = Math.min(height - 1, Math.floor(((lat + reach + 90) / 180) * height - 0.5))
  for (let y = firstY; y <= lastY; y += 1) {
    const rowLat = ((y + 0.5) / height) * 180 - 90
    const sinL = Math.sin(rowLat * DEG)
    const cosL = Math.cos(rowLat * DEG)
    // Only the columns this row can reach (all of them near the poles).
    const denominator = cosL * cosA
    const ratio = denominator > 1e-9 ? (cosCutoff - sinL * sinA) / denominator : -2
    if (ratio > 1) continue
    const halfSpan = ratio < -1 ? 180 : Math.acos(ratio) / DEG
    const span = Math.min(width, Math.ceil((2 * halfSpan / 360) * width) + 2)
    const startX = Math.floor(((lon - halfSpan + 180) / 360) * width - 0.5)
    for (let k = 0; k < span; k += 1) {
      const x = ((startX + k) % width + width) % width
      const columnLon = ((x + 0.5) / width) * 360 - 180
      const cosDistance = sinL * sinA + cosL * cosA * Math.cos((columnLon - lon) * DEG)
      if (cosDistance < cosCutoff) continue
      const ratioDistance = Math.acos(clamp(cosDistance, -1, 1)) / angular
      const kernel = Math.exp(-0.5 * (ratioDistance / 0.5) ** 2) * (1 - smoothstep(0.75, 1, ratioDistance))
      if (kernel > 0) visit(y * width + x, kernel)
    }
  }
}

/**
 * Summit kernel radius: the same for every story, so where summits share ground the taller one
 * owns it all the way round (breadth comes from the footprint's lower shoulders, not a wider peak).
 */
export function summitRadiusKm(_story: StoryMountain): number {
  return 520
}

export function storyTerrainKey(stories: StoryMountain[]): string {
  // Every input to the height field belongs here: new coverage abroad and moving
  // shoulders must update even when the rounded summit height is unchanged.
  // Display copy is excluded so headline updates don't rebuild a 512 × 256 field.
  return JSON.stringify(stories.map((story) => [
    story.id, story.height.toFixed(3), story.momentum?.toFixed(1) ?? null,
    story.summit.lat, story.summit.lon,
    story.footprint.map(({ lat, lon, radiusKm, weight }) => [lat, lon, radiusKm, weight]),
    story.countries.map(({ countryCode, outlets }) => [countryCode, outlets]),
  ]))
}

export function buildStoryTerrain(stories: StoryMountain[], width = 512, height = 256): StoryTerrain {
  const pixels = width * height
  const data = new Float32Array(pixels * 4)
  const owner = new Int16Array(pixels).fill(-1)
  const kernel = new Float32Array(pixels)
  const support = new Float32Array(pixels)
  stories.forEach((story, index) => {
    if (!(story.height > 0)) return
    kernel.fill(0)
    const touched: number[] = []
    const raise = (pixel: number, value: number): void => {
      if (kernel[pixel] === 0) touched.push(pixel)
      if (value > kernel[pixel]!) kernel[pixel] = value
    }
    for (const anchor of story.footprint) {
      stamp(width, height, anchor.lat, anchor.lon, anchor.radiusKm, (pixel, k) => raise(pixel, SHOULDER * anchor.weight * k))
    }
    stamp(width, height, story.summit.lat, story.summit.lon, summitRadiusKm(story), (pixel, k) => raise(pixel, k))
    // Coverage abroad: a hill in each other country that carried the story, as tall as its own
    // outlets alone would raise it (always below the home summit, so the ranking is untouched).
    for (const coverage of story.countries) {
      const place = countryPlace(coverage.countryCode)
      if (!place) continue
      const ratio = Math.min(0.8, echoHeight(coverage.outlets) / story.height)
      stamp(width, height, place.lat, place.lon, ECHO_RADIUS_KM, (pixel, k) => {
        raise(pixel, ratio * k)
        if (k > support[pixel]!) support[pixel] = k
      })
    }
    for (const pixel of touched) {
      const k = kernel[pixel]!
      const h = story.height * k
      const offset = pixel * 4
      data[offset + 3] = Math.max(data[offset + 3]!, k, support[pixel]!)
      support[pixel] = 0
      if (h <= data[offset]!) continue
      data[offset] = h
      data[offset + 1] = story.momentum ?? 0
      data[offset + 2] = k
      owner[pixel] = index
    }
  })
  return { data, owner, width, height, stories, key: storyTerrainKey(stories) }
}

/** The story owning the terrain at a point, if any (for hover). */
export function storyAt(terrain: StoryTerrain, lat: number, lon: number): StoryMountain | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const column = Math.floor(((lon + 180) / 360) * terrain.width)
  const x = ((column % terrain.width) + terrain.width) % terrain.width
  const y = clamp(Math.floor(((lat + 90) / 180) * terrain.height), 0, terrain.height - 1)
  const pixel = y * terrain.width + x
  const index = terrain.owner[pixel]!
  // The faint outer skirt is not a mountain to hover.
  if (index < 0 || terrain.data[pixel * 4]! < 0.02) return null
  return terrain.stories[index] ?? null
}

/** Terrain height (0..1 on the fixed scale) at a point, bilinear between texels. */
export function heightAt(terrain: StoryTerrain, lat: number, lon: number): number {
  const fx = ((lon + 180) / 360) * terrain.width - 0.5
  const fy = clamp(((lat + 90) / 180) * terrain.height - 0.5, 0, terrain.height - 1)
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const sample = (x: number, y: number): number => terrain.data[(clamp(y, 0, terrain.height - 1) * terrain.width + ((x % terrain.width) + terrain.width) % terrain.width) * 4]!
  const top = sample(x0, y0) * (1 - tx) + sample(x0 + 1, y0) * tx
  const bottom = sample(x0, y0 + 1) * (1 - tx) + sample(x0 + 1, y0 + 1) * tx
  return top * (1 - ty) + bottom * ty
}
