import type { GlobeSignal } from './globeSignals'

/** How much of Earth a picture of each kind of event should show (degrees of latitude). */
const SPAN: Record<string, number> = {
  Wildfire: 1.6,
  Volcano: 1.2,
  'Severe storm': 14,
  Flood: 4,
  'Sea and lake ice': 3,
  'Dust and haze': 10,
  Drought: 8,
  Snow: 6,
  Landslide: 1.2,
  'Temperature extreme': 12,
  'Water colour': 3,
}

/** Fire and volcano pictures also show NASA's thermal hotspots (red dots). */
const HOTSPOTS = new Set(['Wildfire', 'Volcano', 'Human-made event'])

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/**
 * A NASA satellite picture of an event (NOAA-20 VIIRS true colour, with fire
 * hotspots for fires and volcanoes): the latest full day for an event still
 * open, else the day it was last observed. Public-domain NASA imagery.
 */
export function eventPicture(signal: Pick<GlobeSignal, 'kind' | 'lat' | 'lon' | 'observedAt' | 'endedAt'>, now: number, daysBack = 0): { url: string; day: string; hotspots: boolean } {
  const span = SPAN[signal.kind] ?? 4
  const lonSpan = Math.min(60, span / Math.max(0.2, Math.cos((signal.lat * Math.PI) / 180)))
  const south = Math.max(-90, signal.lat - span / 2)
  const north = Math.min(90, signal.lat + span / 2)
  const west = Math.max(-180, signal.lon - lonSpan / 2)
  const east = Math.min(180, signal.lon + lonSpan / 2)
  const observed = Date.parse(signal.observedAt)
  const ended = signal.endedAt ? Date.parse(signal.endedAt) : null
  // Today's pass may not be processed yet: use yesterday for an open event.
  const latest = ended ?? Math.max(Math.min(now - 86_400_000, Date.now()), Number.isFinite(observed) ? observed : now - 86_400_000)
  const day = isoDay(latest - daysBack * 86_400_000)
  const hotspots = HOTSPOTS.has(signal.kind)
  // Two satellites, so a gap between one's passes is filled by the other.
  const layers = ['VIIRS_SNPP_CorrectedReflectance_TrueColor', 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', ...(hotspots ? ['VIIRS_NOAA20_Thermal_Anomalies_375m_All', 'VIIRS_SNPP_Thermal_Anomalies_375m_All'] : [])]
  const params = new URLSearchParams({
    REQUEST: 'GetSnapshot',
    LAYERS: layers.join(','),
    CRS: 'EPSG:4326',
    BBOX: [south, west, north, east].map((value) => value.toFixed(3)).join(','),
    FORMAT: 'image/jpeg',
    WIDTH: '720',
    HEIGHT: String(Math.round(720 * Math.min(1, (north - south) / Math.max(0.1, east - west)))),
    TIME: day,
  })
  return { url: `https://wvs.earthdata.nasa.gov/api/v1/snapshot?${params.toString()}`, day, hotspots }
}

/**
 * The event's own name, for finding news about it: "BEE HAVEN (2) (24-06),
 * Hamilton, Florida" → "Bee Haven"; "Tropical Cyclone Arnab" → "Arnab";
 * "Etna Volcano, Italy" → "Etna"; "Iceberg A81" → "A81".
 */
export function eventName(title: string): string | null {
  let name = title.replace(/\s*\(.*?\)/g, '').split(',')[0]!.trim()
  name = name.replace(/^(Prescribed Fire|Wildfire|Wildfires|Fire|Super Typhoon|Typhoon|Hurricane|Tropical Storm|Tropical Cyclone|Tropical Depression|Severe Tropical Cyclone|Cyclone|Subtropical Storm|Iceberg)\s+/i, '').replace(/\s+(Volcano|Fire|Complex|RX|Rx)$/i, '').trim()
  if (name.length < 2 || /^\d+$/.test(name)) return null
  // Fire names arrive in capitals ("BEE HAVEN"): write them as names.
  return name === name.toUpperCase() && /[A-Z]{3,}/.test(name) ? name.toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()) : name
}

/** Words that make a headline about this kind of event, for names too common to match alone ("Bull", "Jones"). */
const KIND_WORDS: Record<string, RegExp> = {
  Wildfire: /\b(fire|wildfire|blaze|burn|acres|evacuat)/i,
  'Severe storm': /\b(storm|cyclone|hurricane|typhoon|landfall|winds|rain)/i,
  Volcano: /\b(volcan|eruption|erupt|lava|ash)/i,
  'Sea and lake ice': /\b(iceberg|ice shelf|antarctic|arctic)/i,
  Flood: /\b(flood|rain|river)/i,
}

/** Headlines that name the event (and, for a short or common name, say what kind of event it is). */
export function headlinesAbout<T extends { title: string }>(signal: Pick<GlobeSignal, 'title' | 'kind'>, headlines: T[], limit = 4): T[] {
  const name = eventName(signal.title)
  if (!name) return []
  const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '-?')}\\b`, 'i')
  const kind = KIND_WORDS[signal.kind]
  const needsKind = name.length <= 6 || name.split(' ').length === 1
  const seen = new Set<string>()
  return headlines.filter((headline) => {
    const key = headline.title.toLowerCase()
    if (seen.has(key) || !pattern.test(headline.title) || (needsKind && kind && !kind.test(headline.title))) return false
    seen.add(key)
    return true
  }).slice(0, limit)
}
