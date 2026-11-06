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
    // Longer abbreviations (PEI, NSW, QLD) also work on their own; two-letter codes only after a place name.
    const shortNames = Object.entries(REGION_CODES[code] ?? {}).filter(([abbr, region]) => region === name && abbr.replace(/ /g, '').length >= 3).map(([abbr]) => abbr)
    add({ id: `region:${key}`, name, kind: 'region', countryCode: code, country: countryNames.get(code) ?? code, lat, lon, population, radiusKm }, shortNames, 0)
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

/**
 * Province/state abbreviations people type after a place ("Charlottetown PEI",
 * "Halifax NS", "Austin TX"). Used only as a qualifier after a place name, never
 * on their own, so words like "In" or "OK" in headlines don't become states.
 */
const REGION_CODES: Record<string, Record<string, string>> = {
  CA: { ab: 'Alberta', bc: 'British Columbia', mb: 'Manitoba', nb: 'New Brunswick', nl: 'Newfoundland and Labrador', nf: 'Newfoundland and Labrador', ns: 'Nova Scotia', nt: 'Northwest Territories', nu: 'Nunavut', on: 'Ontario', ont: 'Ontario', pe: 'Prince Edward Island', pei: 'Prince Edward Island', 'p e i': 'Prince Edward Island', qc: 'Quebec', que: 'Quebec', sk: 'Saskatchewan', sask: 'Saskatchewan', yt: 'Yukon', 'b c': 'British Columbia', 'n s': 'Nova Scotia', 'n b': 'New Brunswick' },
  US: { al: 'Alabama', ak: 'Alaska', az: 'Arizona', ar: 'Arkansas', ca: 'California', co: 'Colorado', ct: 'Connecticut', de: 'Delaware', dc: 'District of Columbia', fl: 'Florida', ga: 'Georgia', hi: 'Hawaii', id: 'Idaho', il: 'Illinois', in: 'Indiana', ia: 'Iowa', ks: 'Kansas', ky: 'Kentucky', la: 'Louisiana', me: 'Maine', md: 'Maryland', ma: 'Massachusetts', mi: 'Michigan', mn: 'Minnesota', ms: 'Mississippi', mo: 'Missouri', mt: 'Montana', ne: 'Nebraska', nv: 'Nevada', nh: 'New Hampshire', nj: 'New Jersey', nm: 'New Mexico', ny: 'New York', nc: 'North Carolina', nd: 'North Dakota', oh: 'Ohio', ok: 'Oklahoma', or: 'Oregon', pa: 'Pennsylvania', ri: 'Rhode Island', sc: 'South Carolina', sd: 'South Dakota', tn: 'Tennessee', tx: 'Texas', ut: 'Utah', vt: 'Vermont', va: 'Virginia', wa: 'Washington', wv: 'West Virginia', wi: 'Wisconsin', wy: 'Wyoming' },
  AU: { nsw: 'New South Wales', vic: 'Victoria', qld: 'Queensland', wa: 'Western Australia', sa: 'South Australia', tas: 'Tasmania', act: 'Australian Capital Territory', nt: 'Northern Territory' },
}

/** What a trailing qualifier names: a region (with its country) or a country. */
function qualifierScope(qualifier: string): Array<{ countryCode: string; region?: string }> {
  index ??= buildIndex()
  const scopes: Array<{ countryCode: string; region?: string }> = []
  for (const [countryCode, codes] of Object.entries(REGION_CODES)) {
    const region = codes[qualifier]
    if (region) scopes.push({ countryCode, region })
  }
  for (const entry of index) {
    if (entry.place.kind === 'city') continue
    if (entry.name !== qualifier && !entry.aliases.includes(qualifier)) continue
    scopes.push(entry.place.kind === 'region' ? { countryCode: entry.place.countryCode, region: entry.place.name } : { countryCode: entry.place.countryCode })
  }
  if (/^[a-z]{2}$/.test(qualifier)) scopes.push({ countryCode: qualifier.toUpperCase() })
  return scopes
}

export function searchPlaces(query: string, limit = 6): Place[] {
  const direct = searchPlacesExact(query, limit)
  if (direct.length) return direct
  // "Charlottetown PEI", "Halifax, NS", "Springfield Illinois": a place, then its region or country.
  const normalized = normalizePlaceText(query)
  const commaParts = query.split(',').map((part) => part.trim()).filter(Boolean)
  const splits: Array<[string, string]> = []
  if (commaParts.length >= 2) splits.push([commaParts[0]!, normalizePlaceText(commaParts.slice(1).join(' '))])
  const words = normalized.split(' ')
  for (let tail = Math.min(4, words.length - 1); tail >= 1; tail -= 1) splits.push([words.slice(0, -tail).join(' '), words.slice(-tail).join(' ')])
  for (const [placePart, qualifier] of splits) {
    const scopes = qualifierScope(qualifier)
    if (!scopes.length) continue
    const found = searchPlacesExact(placePart, 50).filter((place) => place.kind !== 'country' && scopes.some((scope) =>
      scope.countryCode === place.countryCode && (!scope.region || place.region === scope.region || place.name === scope.region)))
    if (found.length) return found.slice(0, limit)
  }
  return []
}

/** Entries by the first two letters of every word in their names and aliases (all matching is word-prefix based). */
let byPrefix: Map<string, Entry[]> | null = null
function prefixBuckets(): Map<string, Entry[]> {
  if (byPrefix) return byPrefix
  index ??= buildIndex()
  const buckets = new Map<string, Entry[]>()
  for (const entry of index) {
    const keys = new Set<string>()
    // Two-letter keys; single-letter words ("p e i" for P.E.I.) are keyed by their letter.
    for (const text of [entry.name, ...entry.aliases]) for (const word of text.split(' ')) if (word) keys.add(word.slice(0, 2))
    for (const key of keys) {
      const list = buckets.get(key)
      if (list) list.push(entry)
      else buckets.set(key, [entry])
    }
  }
  byPrefix = buckets
  return buckets
}

function searchPlacesExact(query: string, limit = 6): Place[] {
  const normalized = normalizePlaceText(query)
  if (normalized.length < 2 || limit <= 0) return []
  index ??= buildIndex()
  const matches: { entry: Entry; tier: number; rank: number }[] = []
  // Only places with a word starting like the query can match (exact, prefix and word-prefix tiers).
  const firstWord = normalized.split(' ')[0]!
  const candidates = prefixBuckets().get(firstWord.slice(0, 2)) ?? []
  for (const entry of candidates) {
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
const byCountry = new Map<string, Place[]>()

/** A country's cities and regions, largest first (computed once per country; treat as read-only). */
export function placesInCountry(countryCode: string): Place[] {
  const cached = byCountry.get(countryCode)
  if (cached) return cached
  index ??= buildIndex()
  const places = index
    .filter((entry) => entry.place.kind !== 'country' && entry.place.countryCode === countryCode)
    .map((entry) => entry.place)
    .sort((a, b) => b.population - a.population)
  byCountry.set(countryCode, places)
  return places
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
  // Districts named for an idea ("Commonwealth", Quezon City): in a headline they are the idea.
  'commonwealth', 'liberty', 'freedom', 'progress', 'justice', 'unity', 'harmony', 'triumph', 'faith', 'charity', 'friendship',
  'opportunity', 'success', 'welcome', 'energy', 'commerce', 'industry', 'security', 'plenty', 'prosperity', 'peace', 'victory',
])

/** Every name a place is known by (its name and aliases), normalised as matching sees them. */
export function placeNames(id: string): string[] {
  index ??= buildIndex()
  const entry = index.find((item) => item.place.id === id)
  return entry ? [entry.name, ...entry.aliases] : []
}

/**
 * Places named in a page's title or address, for suggesting where to pin it.
 * Only capitalised names (or words from the URL path) count, matched whole
 * against place names and aliases; first mention first, countries before
 * regions before cities.
 */
export function placesNamedIn(text: string, limit = 4, hint = ''): Place[] {
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
  const found: { place: Place; at: number; homonyms?: Place[] }[] = []
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
        found.push({ place: best.place, at: i, ...(entries.length > 1 ? { homonyms: entries.map((entry) => entry.place) } : {}) })
      }
      i += n - 1
      break
    }
  }
  // Regions the page names (in its text, or in its site name: "texastribune" names Texas).
  const host = normalizePlaceText(hint).replace(/\s+/g, '')
  const named = found.filter((item) => item.place.kind === 'region').map((item) => item.place)
  if (host.length >= 4) {
    for (const entry of index) {
      if (entry.place.kind === 'region' && entry.name.length >= 5 && host.includes(entry.name.replace(/\s+/g, '')) && !named.some((place) => place.id === entry.place.id)) named.push(entry.place)
    }
  }
  // A city name shared by many places: prefer the one in a named region; drop a guess that contradicts it.
  const resolved = found.flatMap((item) => {
    if (item.place.kind !== 'city' || !named.length) return [item]
    const regions = named.filter((region) => region.countryCode === item.place.countryCode)
    if (!regions.length || regions.some((region) => region.name === item.place.region)) return [item]
    const better = (item.homonyms ?? []).filter((place) => place.kind === 'city' && regions.some((region) => region.name === place.region))
      .sort((a, b) => b.population - a.population)[0]
    return better ? [{ ...item, place: better }] : []
  })
  for (const region of named) if (!resolved.some((item) => item.place.id === region.id)) resolved.push({ place: region, at: Number.MAX_SAFE_INTEGER })
  return resolved.slice(0, limit).map((item) => item.place)
}

/** Other names a city is known by ("NYC" for New York City), from the bundled alias list. */
export function cityAliases(name: string): string[] {
  return CITY_ALIASES[name] ?? []
}
