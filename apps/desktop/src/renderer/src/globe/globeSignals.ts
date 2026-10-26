import type { FieldSnapshot, SourceRecord } from '@intoponet/field-snapshot'
import type { InterestSignal } from '../interestField'
import type { NewsDigest, NewsHeadline } from '../../../shared/news/newsDigest'

/**
 * Globe layers. Each layer is one measurement kind, so values are only ever
 * compared inside a layer (PRD FRQ-006, spec §15 rule 5): reading counts,
 * earthquake magnitude and natural-event presence never share a scale.
 */
export type GlobeLayerId = 'news' | 'reading' | 'quakes' | 'natural'
export type GlobeWindow = '24h' | '7d' | '30d'

export const GLOBE_LAYERS: Record<GlobeLayerId, {
  label: string
  source: string
  color: string
  /** Membrane gain so one layer cannot visually swamp another. */
  gain: number
  /** Display footprint floor in km; not a measured geographic spread. */
  radiusKm: number
  describe: string
}> = {
  news: {
    label: 'Local news',
    source: 'Each country’s own outlets',
    color: '#8fb8ff',
    gain: 0.85,
    radiusKm: 300,
    describe: 'Headlines from verified local news feeds in each country. A story is placed at a city only when its headline names that city, or the outlet is a city outlet; otherwise it counts toward the whole country. Brightness is each country’s publishing pace per outlet over 48 hours, not importance. No marker means no working local feed yet.',
  },
  reading: {
    label: 'Reading now',
    source: 'Wikipedia most-read',
    color: '#50d9c7',
    gain: 0.9,
    radiusKm: 420,
    describe: 'English Wikipedia’s most-read articles from the latest full day, placed where the article is about. Articles without coordinates are not mapped.',
  },
  quakes: {
    label: 'Earthquakes',
    source: 'USGS',
    color: '#f2b766',
    gain: 0.72,
    radiusKm: 320,
    describe: 'Magnitude 4.5+ earthquakes from the past week. Magnitude is a physical measurement, not a measure of interest.',
  },
  natural: {
    label: 'Natural events',
    source: 'NASA EONET',
    color: '#ff8a6b',
    gain: 0.58,
    radiusKm: 260,
    describe: 'Open wildfires, storms, volcanoes and other events curated by NASA’s Earth Observatory from linked sources.',
  },
}

export const GLOBE_LAYER_ORDER: GlobeLayerId[] = ['news', 'reading', 'quakes', 'natural']
export const PIN_COLOR = '#a69be8'

export const WINDOW_HOURS: Record<GlobeWindow, number> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 }

const naturalCategories: Record<string, string> = {
  wildfires: 'Wildfire',
  severeStorms: 'Severe storm',
  volcanoes: 'Volcano',
  seaLakeIce: 'Sea and lake ice',
  floods: 'Flood',
  drought: 'Drought',
  dustHaze: 'Dust and haze',
  earthquakes: 'Earthquake',
  landslides: 'Landslide',
  manmade: 'Human-made event',
  snow: 'Snow',
  tempExtremes: 'Temperature extreme',
  waterColor: 'Water colour',
}

export type GlobeSignal = {
  id: string
  layer: GlobeLayerId
  title: string
  /** Short kind label, e.g. "Wildfire", "M5.6 earthquake", "Article". */
  kind: string
  summary: string | null
  placeLabel: string | null
  lat: number
  lon: number
  url: string
  thumbnail: string | null
  /** Headline measurement in words, e.g. "412,301 reads on Oct 25". */
  measurement: string
  value: number | null
  /** Rank inside its own layer, 0..1. Never compared across layers. */
  intensity: number
  radiusKm: number
  observedAt: string
  endedAt: string | null
  attribution: string
  licence: string
  sourceUrl: string
  /** Local news only: the latest headlines behind this signal. */
  headlines?: NewsHeadline[]
}

type ExtendedRecord = SourceRecord & {
  summary?: string
  placeLabel?: string
  thumbnail?: string
  endedAt?: string
}

const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value))

export function layerOf(source: SourceRecord): GlobeLayerId | null {
  if (source.kind !== 'public-record') return null
  const kind = source.measurement.kind as string
  if (kind === 'wikimedia-pageviews' || kind === 'legacy-pageviews-weight') return 'reading'
  if (kind === 'usgs-earthquake-magnitude' || kind === 'legacy-earthquake-weight') return 'quakes'
  if (kind === 'nasa-eonet-event' || source.topics.some((topic) => topic.startsWith('natural-'))) return 'natural'
  return null
}

export function naturalCategoryLabel(source: SourceRecord): string {
  const topic = source.topics.find((item) => item.startsWith('natural-'))
  const id = topic?.slice('natural-'.length) ?? ''
  return naturalCategories[id] ?? 'Natural event'
}

function dayLabel(stamp: string | undefined): string | null {
  if (!stamp || !/^\d{8}$/.test(stamp)) return null
  const date = new Date(Date.UTC(Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1, Number(stamp.slice(6, 8))))
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** End of a YYYYMMDD day in UTC, as ISO. */
function dayEnd(stamp: string | undefined): string | null {
  if (!stamp || !/^\d{8}$/.test(stamp)) return null
  return new Date(Date.UTC(Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1, Number(stamp.slice(6, 8)) + 1) - 1).toISOString()
}

function safeHttps(value: string | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

function isoOr(value: string | undefined, fallback: string): string {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : fallback
}

/** Map a snapshot's public records onto globe layers with per-layer ranks. */
export function globeSignalsFromSnapshot(snapshot: FieldSnapshot | null): GlobeSignal[] {
  if (!snapshot) return []
  const drafts: Array<Omit<GlobeSignal, 'intensity'> & { rank: number }> = []
  const seen = new Set<string>()
  for (const raw of snapshot.sources) {
    const source = raw as ExtendedRecord
    const layer = layerOf(source)
    if (!layer || seen.has(source.id)) continue
    if (!Number.isFinite(source.lat) || !Number.isFinite(source.lon) || Math.abs(source.lat) > 90 || Math.abs(source.lon) > 180) continue
    seen.add(source.id)
    const value = source.measurement.value
    let kind = 'Article'
    let measurement = 'Public record'
    let rank = 0
    let observedAt = isoOr(source.publishedAt, snapshot.createdAt)
    if (layer === 'reading') {
      const views = typeof value === 'number' ? value : 0
      const day = dayLabel(source.measurement.windowEnd)
      measurement = `${Math.round(views).toLocaleString()} reads${day ? ` on ${day}` : ''}`
      rank = Math.log10(Math.max(1, views))
      observedAt = dayEnd(source.measurement.windowEnd) ?? observedAt
    } else if (layer === 'quakes') {
      const magnitude = typeof value === 'number' ? value : null
      kind = magnitude === null ? 'Earthquake' : `M${magnitude.toFixed(1)} earthquake`
      measurement = magnitude === null ? 'Magnitude unknown' : `Magnitude ${magnitude.toFixed(1)}${source.measurement.scale && source.measurement.scale !== 'unspecified' ? ` (${source.measurement.scale})` : ''}`
      rank = magnitude ?? 4.5
    } else {
      kind = naturalCategoryLabel(source)
      const unit = source.measurement.unit && source.measurement.unit !== 'event' ? source.measurement.unit : ''
      measurement = typeof value === 'number' && unit ? `${value.toLocaleString()} ${unit}` : 'Open event'
      rank = source.weight
    }
    drafts.push({
      id: source.id,
      layer,
      title: source.title,
      kind,
      summary: source.summary?.trim() || null,
      placeLabel: source.placeLabel?.trim() || null,
      lat: source.lat,
      lon: source.lon,
      url: source.url,
      thumbnail: safeHttps(source.thumbnail),
      measurement,
      value: typeof value === 'number' ? value : null,
      radiusKm: Math.max(GLOBE_LAYERS[layer].radiusKm, source.radiusKm),
      observedAt,
      endedAt: source.endedAt && Number.isFinite(Date.parse(source.endedAt)) ? new Date(source.endedAt).toISOString() : null,
      attribution: source.attribution,
      licence: source.licence,
      sourceUrl: source.measurement.sourceUrl,
      rank,
    })
  }
  // Rank inside each layer only: min..max of that layer maps to 0.3..1.
  const result: GlobeSignal[] = []
  for (const layer of GLOBE_LAYER_ORDER) {
    const members = drafts.filter((draft) => draft.layer === layer)
    if (!members.length) continue
    const lo = Math.min(...members.map((member) => member.rank))
    const hi = Math.max(...members.map((member) => member.rank))
    for (const { rank, ...member } of members) {
      const t = hi > lo ? (rank - lo) / (hi - lo) : 0.6
      result.push({ ...member, intensity: 0.3 + 0.7 * clamp(t, 0, 1) })
    }
  }
  return result.sort((a, b) => b.intensity - a.intensity || a.id.localeCompare(b.id))
}

export function filterGlobeSignals(
  signals: GlobeSignal[],
  options: { layers: ReadonlySet<GlobeLayerId>; window: GlobeWindow; now: number },
): GlobeSignal[] {
  const horizon = options.now - WINDOW_HOURS[options.window] * 3_600_000
  return signals.filter((signal) => {
    if (!options.layers.has(signal.layer)) return false
    // The latest full reading day is always shown; it is the newest data there is.
    if (signal.layer === 'reading' || signal.layer === 'news') return true
    const at = Date.parse(signal.observedAt)
    return !Number.isFinite(at) || at >= horizon
  })
}

export function layerCounts(signals: GlobeSignal[]): Record<GlobeLayerId, number> {
  const counts: Record<GlobeLayerId, number> = { news: 0, reading: 0, quakes: 0, natural: 0 }
  for (const signal of signals) counts[signal.layer] += 1
  return counts
}

/** Most signals the 512×256 membrane texture can rasterise within its work budget. */
export const MEMBRANE_MAX_SIGNALS = 480

/**
 * Membrane input: each layer's own rank scaled by its gain. Past the
 * texture's work budget the faintest are left out of the surface only; every
 * signal still has its marker, label and list entry.
 */
export function membraneSignals(signals: GlobeSignal[], timestamp: string): InterestSignal[] {
  const strongest = signals.length > MEMBRANE_MAX_SIGNALS
    ? [...signals].sort((a, b) => b.intensity * GLOBE_LAYERS[b.layer].gain - a.intensity * GLOBE_LAYERS[a.layer].gain).slice(0, MEMBRANE_MAX_SIGNALS)
    : signals
  return strongest.map((signal) => ({
    id: signal.id,
    lat: signal.lat,
    lon: signal.lon,
    intensity: clamp(signal.intensity * GLOBE_LAYERS[signal.layer].gain, 0, 1),
    radiusKm: clamp(signal.radiusKm, 1, 20_000),
    momentum: null,
    confidence: 0.7,
    timestamp,
    topicId: signal.layer,
    sourceType: 'public-aggregate' as const,
  }))
}

const EARTH_RADIUS_KM = 6_371.0088

export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function nearbySignals(signals: GlobeSignal[], center: { lat: number; lon: number }, radiusKm: number, limit = 12): GlobeSignal[] {
  return signals
    .map((signal) => ({ signal, km: distanceKm(center, signal) }))
    .filter((entry) => entry.km <= radiusKm)
    .sort((a, b) => a.km - b.km || b.signal.intensity - a.signal.intensity)
    .slice(0, limit)
    .map((entry) => entry.signal)
}

export function relativeTime(iso: string, now: number): string {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return 'time unknown'
  const minutes = Math.round((now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} days ago`
}

/** A snapshot older than this is shown as stale rather than live. */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000

export function freshness(snapshot: FieldSnapshot | null, now: number): { label: string; stale: boolean } {
  if (!snapshot) return { label: 'No public data yet', stale: true }
  const at = Date.parse(snapshot.createdAt)
  if (!Number.isFinite(at)) return { label: 'Update time unknown', stale: true }
  return { label: `Updated ${relativeTime(snapshot.createdAt, now)}`, stale: now - at > STALE_AFTER_MS }
}

/** Alternate layers so a list never implies one layer outranks another. */
export function interleaveLayers(signals: GlobeSignal[]): GlobeSignal[] {
  const queues = GLOBE_LAYER_ORDER.map((layer) => signals.filter((signal) => signal.layer === layer))
  const result: GlobeSignal[] = []
  for (let i = 0; result.length < signals.length; i += 1) {
    for (const queue of queues) if (queue[i]) result.push(queue[i]!)
  }
  return result
}

/** Rank values to 0.3..1 inside one group. */
function rankWithin(values: number[]): number[] {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  return values.map((value) => 0.3 + 0.7 * (hi > lo ? (value - lo) / (hi - lo) : 0.6))
}

/**
 * Local news as globe signals. Countries are ranked by stories per feed (so a
 * country with more registered feeds doesn't look busier); named cities are
 * ranked among themselves and drawn a little smaller.
 */
export function newsGlobeSignals(digest: NewsDigest | null): GlobeSignal[] {
  if (!digest) return []
  const window = `${digest.windowHours} h`
  const countryRanks = rankWithin(digest.countries.map((country) => Math.log1p(country.storyCount / Math.max(1, country.feedCount))))
  const placeRanks = rankWithin(digest.places.map((place) => Math.log1p(place.storyCount)))
  const publishers = (headlines: NewsHeadline[]): string => [...new Set(headlines.map((headline) => headline.publisher))].slice(0, 3).join(', ')
  const countries = digest.countries.flatMap((country, i): GlobeSignal[] => {
    const first = country.headlines[0]
    if (!first) return []
    return [{
      id: `news:country:${country.countryCode}`,
      layer: 'news',
      title: country.name,
      kind: 'Local news',
      summary: `${country.storyCount} ${country.storyCount === 1 ? 'story' : 'stories'} from ${country.outletCount} local ${country.outletCount === 1 ? 'outlet' : 'outlets'} in the last ${window}.`,
      placeLabel: null,
      lat: country.lat,
      lon: country.lon,
      url: first.url,
      thumbnail: null,
      measurement: `${country.storyCount} ${country.storyCount === 1 ? 'story' : 'stories'} · ${country.outletCount} ${country.outletCount === 1 ? 'outlet' : 'outlets'}`,
      value: country.storyCount,
      intensity: countryRanks[i]!,
      radiusKm: country.radiusKm,
      observedAt: country.latestAt ?? digest.generatedAt,
      endedAt: null,
      attribution: `Headlines and links from ${publishers(country.headlines)}`,
      licence: 'link-only',
      sourceUrl: first.url,
      headlines: country.headlines,
    }]
  })
  const places = digest.places.flatMap((place, i): GlobeSignal[] => {
    const first = place.headlines[0]
    if (!first) return []
    return [{
      id: `news:${place.id}`,
      layer: 'news',
      title: place.name,
      kind: place.evidence === 'named-in-headline' ? 'Named in local headlines' : place.evidence === 'local-outlet' ? 'City outlet' : 'City news',
      summary: `${place.storyCount} ${place.storyCount === 1 ? 'story' : 'stories'} ${place.evidence === 'named-in-headline' ? 'naming this place' : place.evidence === 'local-outlet' ? 'from a local outlet here' : 'from a local outlet here or naming this place'} in the last ${window}.`,
      placeLabel: null,
      lat: place.lat,
      lon: place.lon,
      url: first.url,
      thumbnail: null,
      measurement: `${place.storyCount} ${place.storyCount === 1 ? 'story' : 'stories'}`,
      value: place.storyCount,
      intensity: placeRanks[i]! * 0.85,
      radiusKm: place.radiusKm,
      observedAt: first.publishedAt,
      endedAt: null,
      attribution: `Headlines and links from ${publishers(place.headlines)}`,
      licence: 'link-only',
      sourceUrl: first.url,
      headlines: place.headlines,
    }]
  })
  return [...countries, ...places].sort((a, b) => b.intensity - a.intensity || a.id.localeCompare(b.id))
}
