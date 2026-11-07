import { distanceKm, nearestCountry } from '../places/places'
import type { NewsDigest, NewsHeadline } from './newsDigest'

/** A place within this many kilometres of an anchor counts as the anchor's own news. */
export const ANCHOR_REACH_KM = 150
export const ANCHOR_HEADLINE_LIMIT = 5

export type AnchorHeadlines = {
  /** Where the headlines come from: a news place near the anchor, or the anchor's country. */
  source: 'place' | 'country'
  name: string
  headlines: NewsHeadline[]
}

/**
 * The latest headlines for a workspace's anchored place, from the public news digest only: the
 * nearest digest place within reach (with headlines), else the anchor's country. Null when the
 * digest has nothing for it.
 */
export function headlinesNearAnchor(anchor: { lat: number; lon: number }, digest: NewsDigest | null | undefined, limit = ANCHOR_HEADLINE_LIMIT): AnchorHeadlines | null {
  if (!digest) return null
  let best: NewsDigest['places'][number] | null = null
  let bestKm = Infinity
  for (const place of digest.places) {
    if (place.headlines.length === 0) continue
    const km = distanceKm(anchor.lat, anchor.lon, place.lat, place.lon)
    if (km <= ANCHOR_REACH_KM && km < bestKm) {
      best = place
      bestKm = km
    }
  }
  if (best) return { source: 'place', name: best.name, headlines: best.headlines.slice(0, limit) }
  const nearest = nearestCountry(anchor.lat, anchor.lon)
  if (!nearest) return null
  const country = digest.countries.find((item) => item.countryCode === nearest.place.countryCode)
  if (!country || country.headlines.length === 0) return null
  return { source: 'country', name: country.name, headlines: country.headlines.slice(0, limit) }
}
