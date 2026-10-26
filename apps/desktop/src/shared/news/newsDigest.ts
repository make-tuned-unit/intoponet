import { countryPlace, normalizePlaceText, placesInCountry, type Place } from '../places/places'

/**
 * News digest: what each country's own outlets are publishing now.
 *
 * Built only from feed metadata (headline, link, publish time). A story is
 * placed at a city only when the headline names that city, or when the feed
 * is a declared city/regional outlet; otherwise it counts toward its country
 * as a whole and is drawn at country scale. Publisher location is never used
 * as the story's location.
 */
export const NEWS_DIGEST_SCHEMA = 'intoponet.news-digest.v1' as const

export type NewsSourceMeta = {
  sourceId: string
  countryCode: string
  publisherName: string
  publisherGroupId: string
  scope: 'national' | 'regional' | 'local'
  cityName?: string | null
  regionName?: string | null
}

export type NewsItemInput = {
  sourceId: string
  title: string
  url: string
  publishedAt?: string | undefined
  discoveredAt: string
}

export type NewsFeedHealth = 'pending' | 'healthy' | 'stale' | 'error'

export type NewsHeadline = {
  title: string
  url: string
  publisher: string
  publishedAt: string
  /** City or region named in the headline, if any. */
  place?: string
}

export type NewsCountry = {
  countryCode: string
  name: string
  lat: number
  lon: number
  radiusKm: number
  /** Distinct stories (duplicate headlines merged) in the window. */
  storyCount: number
  outletCount: number
  feedCount: number
  healthyFeedCount: number
  latestAt: string | null
  headlines: NewsHeadline[]
}

export type NewsPlace = {
  id: string
  name: string
  countryCode: string
  lat: number
  lon: number
  radiusKm: number
  storyCount: number
  /** Why stories are placed here: headlines name it, a city outlet covers it, or both. */
  evidence: 'named-in-headline' | 'local-outlet' | 'both'
  headlines: NewsHeadline[]
}

export type NewsDigest = {
  schema: typeof NEWS_DIGEST_SCHEMA
  generatedAt: string
  windowHours: number
  feedCount: number
  healthyFeedCount: number
  countries: NewsCountry[]
  places: NewsPlace[]
  /** Countries in the registry whose feeds returned nothing usable. */
  quietCountryCodes: string[]
}

export const NEWS_DIGEST_LIMITS = {
  headlinesPerCountry: 12,
  headlinesPerPlace: 8,
  placesPerCountry: 12,
  titleChars: 220,
} as const

/** Place names that are also everyday words in headlines; never matched. */
const AMBIGUOUS_NAMES = new Set([
  'nice', 'mobile', 'reading', 'orange', 'victoria', 'independence', 'concord', 'split', 'hope', 'union',
  'enterprise', 'paradise', 'sale', 'wells', 'bath', 'march', 'may', 'police', 'mission', 'surprise',
  'gold coast', 'central', 'capital', 'eastern', 'western', 'northern', 'southern', 'north', 'south', 'east', 'west',
  'santa', 'san', 'leon', 'linz', 'bar', 'mons', 'aba', 'ede', 'bo', 'goes', 'hof', 'sur', 'tema', 'kids',
])

/** Matched against accent-preserving text when the name itself has accents. */
type Matcher = { place: Place; needle: string; accented: boolean }

/** Lowercase, punctuation to spaces, accents kept (so "Pará" never matches "para"). */
function accentText(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}
const matcherCache = new Map<string, Matcher[]>()

function matchersFor(countryCode: string): Matcher[] {
  const cached = matcherCache.get(countryCode)
  if (cached) return cached
  const seen = new Set<string>()
  const matchers: Matcher[] = []
  for (const place of placesInCountry(countryCode)) {
    const plain = normalizePlaceText(place.name)
    const accented = accentText(place.name) !== plain
    const needle = accented ? accentText(place.name) : plain
    if (plain.length < 4 || AMBIGUOUS_NAMES.has(plain) || seen.has(needle)) continue
    seen.add(needle)
    matchers.push({ place, needle, accented })
  }
  // Longer names first, so "New York" wins over "York".
  matchers.sort((a, b) => b.needle.length - a.needle.length)
  matcherCache.set(countryCode, matchers)
  return matchers
}

/** First city/region of the country named in a headline, matched on word boundaries. */
export function placeNamedIn(title: string, countryCode: string): Place | null {
  const plain = ` ${normalizePlaceText(title)} `
  const accented = ` ${accentText(title)} `
  for (const matcher of matchersFor(countryCode)) {
    if ((matcher.accented ? accented : plain).includes(` ${matcher.needle} `)) return matcher.place
  }
  return null
}

function declaredPlace(source: NewsSourceMeta): Place | null {
  if (source.scope === 'national') return null
  const wanted = normalizePlaceText(source.cityName ?? source.regionName ?? '')
  if (!wanted) return null
  return placesInCountry(source.countryCode).find((place) => normalizePlaceText(place.name) === wanted) ?? null
}

function storyKey(title: string): string {
  return normalizePlaceText(title).slice(0, 120)
}

function cleanTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().slice(0, NEWS_DIGEST_LIMITS.titleChars)
}

export function buildNewsDigest(input: {
  sources: NewsSourceMeta[]
  items: NewsItemInput[]
  health: Record<string, NewsFeedHealth>
  now: number
  windowHours?: number
}): NewsDigest {
  const windowHours = input.windowHours ?? 48
  const horizon = input.now - windowHours * 3_600_000
  const sourceById = new Map(input.sources.map((source) => [source.sourceId, source]))

  type Story = NewsHeadline & { at: number; countryCode: string; publisherGroupId: string; placeRef: Place | null; evidence: 'named-in-headline' | 'local-outlet' | null }
  const stories = new Map<string, Story>()
  for (const item of input.items) {
    const source = sourceById.get(item.sourceId)
    if (!source) continue
    const title = cleanTitle(item.title)
    if (title.length < 8 || !/^https?:\/\//.test(item.url)) continue
    const published = Date.parse(item.publishedAt ?? '')
    // Undated items count from when we first saw them.
    const at = Number.isFinite(published) && published <= input.now + 10 * 60_000 ? published : Date.parse(item.discoveredAt)
    if (!Number.isFinite(at) || at < horizon) continue
    const key = `${source.countryCode}|${storyKey(title)}`
    if (stories.has(key)) continue
    const named = placeNamedIn(title, source.countryCode)
    const declared = named ? null : declaredPlace(source)
    const placeRef = named ?? declared
    stories.set(key, {
      title,
      url: item.url,
      publisher: source.publisherName,
      publishedAt: new Date(at).toISOString(),
      ...(placeRef ? { place: placeRef.name } : {}),
      at,
      countryCode: source.countryCode,
      publisherGroupId: source.publisherGroupId,
      placeRef,
      evidence: named ? 'named-in-headline' : declared ? 'local-outlet' : null,
    })
  }

  const byCountry = new Map<string, Story[]>()
  for (const story of stories.values()) {
    const list = byCountry.get(story.countryCode) ?? []
    list.push(story)
    byCountry.set(story.countryCode, list)
  }
  const strip = ({ title, url, publisher, publishedAt, place }: Story): NewsHeadline => ({ title, url, publisher, publishedAt, ...(place ? { place } : {}) })
  const newestFirst = (a: Story, b: Story): number => b.at - a.at

  const registryCountries = [...new Set(input.sources.map((source) => source.countryCode))].sort()
  const countries: NewsCountry[] = []
  const places: NewsPlace[] = []
  const quietCountryCodes: string[] = []
  for (const code of registryCountries) {
    const feeds = input.sources.filter((source) => source.countryCode === code)
    const list = (byCountry.get(code) ?? []).sort(newestFirst)
    const anchor = countryPlace(code)
    if (!list.length || !anchor) {
      quietCountryCodes.push(code)
      continue
    }
    // Alternate outlets so one prolific publisher can't fill the list.
    const queues = new Map<string, Story[]>()
    for (const story of list) queues.set(story.publisherGroupId, [...(queues.get(story.publisherGroupId) ?? []), story])
    const mixed: Story[] = []
    for (let i = 0; mixed.length < Math.min(list.length, NEWS_DIGEST_LIMITS.headlinesPerCountry); i += 1) {
      for (const queue of queues.values()) if (queue[i] && mixed.length < NEWS_DIGEST_LIMITS.headlinesPerCountry) mixed.push(queue[i]!)
    }
    countries.push({
      countryCode: code,
      name: anchor.name,
      lat: anchor.lat,
      lon: anchor.lon,
      radiusKm: Math.min(900, Math.max(250, anchor.radiusKm)),
      storyCount: list.length,
      outletCount: new Set(list.map((story) => story.publisherGroupId)).size,
      feedCount: feeds.length,
      healthyFeedCount: feeds.filter((feed) => input.health[feed.sourceId] === 'healthy' || input.health[feed.sourceId] === 'stale').length,
      latestAt: new Date(list[0]!.at).toISOString(),
      headlines: mixed.map(strip),
    })
    const byPlace = new Map<string, Story[]>()
    for (const story of list) {
      if (!story.placeRef) continue
      byPlace.set(story.placeRef.id, [...(byPlace.get(story.placeRef.id) ?? []), story])
    }
    const placeEntries = [...byPlace.values()]
      .sort((a, b) => b.length - a.length || b[0]!.at - a[0]!.at)
      .slice(0, NEWS_DIGEST_LIMITS.placesPerCountry)
    for (const group of placeEntries) {
      const place = group[0]!.placeRef!
      places.push({
        id: place.id,
        name: place.name,
        countryCode: code,
        lat: place.lat,
        lon: place.lon,
        radiusKm: Math.min(250, Math.max(60, place.radiusKm * 2)),
        storyCount: group.length,
        evidence: group.every((story) => story.evidence === 'named-in-headline')
          ? 'named-in-headline'
          : group.every((story) => story.evidence === 'local-outlet') ? 'local-outlet' : 'both',
        headlines: group.slice(0, NEWS_DIGEST_LIMITS.headlinesPerPlace).map(strip),
      })
    }
  }
  const healthyFeedCount = input.sources.filter((source) => input.health[source.sourceId] === 'healthy' || input.health[source.sourceId] === 'stale').length
  return {
    schema: NEWS_DIGEST_SCHEMA,
    generatedAt: new Date(input.now).toISOString(),
    windowHours,
    feedCount: input.sources.length,
    healthyFeedCount,
    countries,
    places,
    quietCountryCodes,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const httpsOrHttp = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\//.test(value) && value.length < 2_048
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function parseHeadlines(value: unknown): NewsHeadline[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row): NewsHeadline[] => {
    if (!isRecord(row) || !text(row['title'], 400) || !httpsOrHttp(row['url']) || !text(row['publisher'], 200) || !text(row['publishedAt'], 40)) return []
    return [{
      title: row['title'],
      url: row['url'],
      publisher: row['publisher'],
      publishedAt: row['publishedAt'],
      ...(text(row['place'], 120) ? { place: row['place'] } : {}),
    }]
  }).slice(0, 20)
}

/** Validate a digest crossing the IPC boundary; drops malformed rows. */
export function parseNewsDigest(raw: string | null): NewsDigest | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(value) || value['schema'] !== NEWS_DIGEST_SCHEMA || !text(value['generatedAt'], 40)) return null
  const countries = Array.isArray(value['countries']) ? value['countries'].flatMap((row): NewsCountry[] => {
    if (!isRecord(row) || !text(row['countryCode'], 3) || !text(row['name'], 120) || !finite(row['lat']) || !finite(row['lon']) ||
      !finite(row['radiusKm']) || !finite(row['storyCount']) || !finite(row['outletCount']) || !finite(row['feedCount']) || !finite(row['healthyFeedCount'])) return []
    return [{
      countryCode: row['countryCode'],
      name: row['name'],
      lat: row['lat'],
      lon: row['lon'],
      radiusKm: row['radiusKm'],
      storyCount: row['storyCount'],
      outletCount: row['outletCount'],
      feedCount: row['feedCount'],
      healthyFeedCount: row['healthyFeedCount'],
      latestAt: text(row['latestAt'], 40) ? row['latestAt'] : null,
      headlines: parseHeadlines(row['headlines']),
    }]
  }) : []
  const places = Array.isArray(value['places']) ? value['places'].flatMap((row): NewsPlace[] => {
    if (!isRecord(row) || !text(row['id'], 80) || !text(row['name'], 120) || !text(row['countryCode'], 3) || !finite(row['lat']) ||
      !finite(row['lon']) || !finite(row['radiusKm']) || !finite(row['storyCount'])) return []
    return [{
      id: row['id'],
      name: row['name'],
      countryCode: row['countryCode'],
      lat: row['lat'],
      lon: row['lon'],
      radiusKm: row['radiusKm'],
      storyCount: row['storyCount'],
      evidence: row['evidence'] === 'local-outlet' || row['evidence'] === 'both' ? row['evidence'] : 'named-in-headline',
      headlines: parseHeadlines(row['headlines']),
    }]
  }) : []
  return {
    schema: NEWS_DIGEST_SCHEMA,
    generatedAt: value['generatedAt'],
    windowHours: finite(value['windowHours']) ? value['windowHours'] : 48,
    feedCount: finite(value['feedCount']) ? value['feedCount'] : 0,
    healthyFeedCount: finite(value['healthyFeedCount']) ? value['healthyFeedCount'] : 0,
    countries,
    places,
    quietCountryCodes: Array.isArray(value['quietCountryCodes']) ? value['quietCountryCodes'].filter((code): code is string => text(code, 3)) : [],
  }
}
