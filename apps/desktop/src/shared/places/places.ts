import { CITY_ALIASES, CITY_ROWS, COUNTRY_ALIASES, COUNTRY_ROWS, REGION_ROWS } from './placeData'

export type Place = {
  id: string
  name: string
  kind: 'country' | 'city' | 'region'
  countryCode: string
  country: string
  region?: string
  lat: number
  lon: number
  population: number
  radiusKm: number
}

export const PLACE_ATTRIBUTION = 'Places: GeoNames, CC BY 4.0 (https://www.geonames.org/)'

type Entry = { place: Place; name: string; words: string[]; aliases: string[]; boost: number }

/** Lowercase, strip diacritics and punctuation, collapse spaces. */
export function normalizePlaceText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

let index: Entry[] | null = null

function cityRadiusKm(population: number): number {
  return Math.round(Math.min(120, Math.max(15, Math.sqrt(population) / 30)))
}

function buildIndex(): Entry[] {
  const countryNames = new Map(COUNTRY_ROWS.map(([code, name]) => [code, name]))
  const entries: Entry[] = []
  const add = (place: Place, aliases: string[], boost: number): void => {
    const name = normalizePlaceText(place.name)
    entries.push({ place, name, words: name.split(' '), aliases: aliases.map(normalizePlaceText), boost })
  }
  for (const [code, name, lat, lon, radiusKm, population] of COUNTRY_ROWS) {
    const id = `country:${code}`
    add({ id, name, kind: 'country', countryCode: code, country: name, lat, lon, population, radiusKm }, COUNTRY_ALIASES[id] ?? [], 1_000_000_000)
  }
  for (const [key, name, code, lat, lon, radiusKm, population] of REGION_ROWS) {
    add({ id: `region:${key}`, name, kind: 'region', countryCode: code, country: countryNames.get(code) ?? code, lat, lon, population, radiusKm }, [], 0)
  }
  const aliased = new Set<string>()
  for (const [geonameId, name, code, region, lat, lon, population] of CITY_ROWS) {
    // Rows are sorted by population, so the first city with a name gets its aliases.
    const aliases = !aliased.has(name) ? CITY_ALIASES[name] ?? [] : []
    aliased.add(name)
    add({
      id: `city:${geonameId}`,
      name,
      kind: 'city',
      countryCode: code,
      country: countryNames.get(code) ?? code,
      ...(region ? { region } : {}),
      lat,
      lon,
      population,
      radiusKm: cityRadiusKm(population),
    }, aliases, 0)
  }
  return entries
}

/** Match tier: lower is better; null means no match. */
function tier(entry: Entry, query: string): number | null {
  if (entry.name === query) return 0
  if (entry.aliases.includes(query)) return 1
  if (entry.name.startsWith(query)) return 2
  if (entry.words.some((word) => word.startsWith(query)) || entry.name.includes(` ${query}`)) return 3
  if (entry.aliases.some((alias) => alias.startsWith(query))) return 4
  return null
}

export function searchPlaces(query: string, limit = 6): Place[] {
  const normalized = normalizePlaceText(query)
  if (normalized.length < 2 || limit <= 0) return []
  index ??= buildIndex()
  const matches: { entry: Entry; tier: number; rank: number }[] = []
  for (const entry of index) {
    const matchTier = tier(entry, normalized)
    if (matchTier === null) continue
    // Countries only get their boost for exact name/alias matches.
    const rank = entry.place.population + (matchTier <= 1 ? entry.boost : 0)
    matches.push({ entry, tier: matchTier, rank })
  }
  matches.sort((a, b) => a.tier - b.tier || b.rank - a.rank)
  return matches.slice(0, limit).map((match) => match.entry.place)
}

export function placeLabel(place: Place): string {
  if (place.kind === 'country') return place.name
  const parts = [place.name]
  if (place.region && place.region !== place.name && (place.kind === 'city' && ['US', 'CA', 'AU'].includes(place.countryCode))) {
    parts.push(place.region)
  }
  parts.push(place.country)
  return parts.join(', ')
}

/** The country's own entry (capital or population centre, with an area-based radius). */
export function countryPlace(countryCode: string): Place | null {
  index ??= buildIndex()
  return index.find((entry) => entry.place.kind === 'country' && entry.place.countryCode === countryCode)?.place ?? null
}

/** Cities and first-level regions inside one country, largest first. */
export function placesInCountry(countryCode: string): Place[] {
  index ??= buildIndex()
  return index
    .filter((entry) => entry.place.kind !== 'country' && entry.place.countryCode === countryCode)
    .map((entry) => entry.place)
    .sort((a, b) => b.population - a.population)
}

/** Great-circle distance in km. */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180
  const dLat = (bLat - aLat) * rad
  const dLon = (bLon - aLon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * The country of the known place nearest a point (e.g. the centre of the
 * view), with the distance to that place. Over open ocean it is the nearest
 * coast's country, so callers should show the distance or name it.
 */
export function nearestCountry(lat: number, lon: number): { place: Place; km: number } | null {
  index ??= buildIndex()
  let best: { place: Place; km: number } | null = null
  for (const entry of index) {
    const km = distanceKm(lat, lon, entry.place.lat, entry.place.lon)
    if (!best || km < best.km) best = { place: entry.place, km }
  }
  if (!best) return null
  const country = countryPlace(best.place.countryCode)
  return country ? { place: country, km: best.km } : null
}

/** Words that are place names but usually mean something else in a title. */
const TITLE_STOP_PLACES = new Set([
  'nice', 'mobile', 'reading', 'orange', 'victoria', 'independence', 'concord', 'split', 'hope', 'union', 'enterprise', 'paradise', 'sale',
  'wells', 'bath', 'march', 'may', 'police', 'mission', 'surprise', 'central', 'capital', 'eastern', 'western', 'northern', 'southern',
  'north', 'south', 'east', 'west', 'santa', 'san', 'leon', 'bar', 'mons', 'aba', 'ede', 'bo', 'goes', 'hof', 'sur', 'kids', 'home',
  'wikipedia', 'news', 'history', 'live', 'media', 'university', 'world', 'national', 'republic', 'city', 'about', 'many', 'best',
])

/**
 * Places named in a page's title or address, for suggesting where to pin it.
 * Only capitalised names (or words from the URL path) count, matched whole
 * against place names and aliases; first mention first, countries before
 * regions before cities.
 */
export function placesNamedIn(text: string, limit = 4): Place[] {
  index ??= buildIndex()
  const byName = new Map<string, Entry[]>()
  for (const entry of index) {
    for (const name of [entry.name, ...entry.aliases]) {
      const list = byName.get(name) ?? []
      list.push(entry)
      byName.set(name, list)
    }
  }
  const words = text.split(/[\s_/,.;:()[\]|"“”–—-]+/).filter(Boolean)
  const found: { place: Place; at: number }[] = []
  const seen = new Set<string>()
  for (let i = 0; i < words.length; i += 1) {
    for (let n = 3; n >= 1; n -= 1) {
      const slice = words.slice(i, i + n)
      if (slice.length < n || !/^\p{Lu}/u.test(slice[0]!)) continue
      const name = normalizePlaceText(slice.join(' '))
      if (name.length < 3 || TITLE_STOP_PLACES.has(name)) continue
      const entries = byName.get(name)
      if (!entries?.length) continue
      const kindRank = { country: 0, region: 1, city: 2 } as const
      const best = [...entries].sort((a, b) => kindRank[a.place.kind] - kindRank[b.place.kind] || b.place.population - a.place.population)[0]!
      if (!seen.has(best.place.id)) {
        seen.add(best.place.id)
        found.push({ place: best.place, at: i })
      }
      i += n - 1
      break
    }
  }
  return found.slice(0, limit).map((item) => item.place)
}
