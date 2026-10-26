/** A locally held completed visit. Do not transmit these records. */
export type TopicVisit = {
  destinationId: string
  topicId: string
  /** ISO timestamp or epoch milliseconds. */
  timestamp: string | number
  /** ISO 3166-1 alpha-2 when known; absent/invalid values stay unknown. */
  originCountryCode?: string | null
}

export type TrafficWindow = {
  start: number
  end: number
  durationMs: number
  totalVisits: number
  knownOriginVisits: number
  unknownOriginVisits: number
  origins: Array<{ countryCode: string | null; visits: number; percent: number }>
}

export type TrafficTrendStatus = 'insufficient-baseline' | 'no-baseline' | 'normal' | 'spike'

export type TopicTrafficResult = {
  destinationId: string
  topicId: string
  current: TrafficWindow
  baseline: TrafficWindow
  countryTrends: Array<{
    countryCode: string | null
    currentVisits: number
    currentPercent: number
    baselineVisits: number
    currentRatePerHour: number
    baselineRatePerHour: number
    ratio: number | null
    status: TrafficTrendStatus
  }>
  spike: {
    threshold: number
    currentRatePerHour: number
    baselineRatePerHour: number
    ratio: number | null
    status: TrafficTrendStatus
  }
}

export type AggregateTopicTrafficOptions = {
  destinationId: string
  topicId: string
  visits: readonly TopicVisit[]
  /** Current window ends at this instant. */
  now: string | number
  currentWindowMs: number
  /** Defaults to currentWindowMs; immediately precedes the current window. */
  baselineWindowMs?: number
  /** Current/baseline hourly-rate ratio that counts as a spike. Defaults to 2. */
  spikeThreshold?: number
}

const HOUR_MS = 60 * 60 * 1000
const ISO_ALPHA_2 = new Set(
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' '),
)

function timestampMs(value: string | number): number {
  return typeof value === 'number' ? value : Date.parse(value)
}

function normalizedCountryCode(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return ISO_ALPHA_2.has(code) ? code : null
}

function buildWindow(
  visits: readonly TopicVisit[],
  destinationId: string,
  topicId: string,
  start: number,
  end: number,
): TrafficWindow {
  const counts = new Map<string | null, number>()
  let totalVisits = 0
  for (const visit of visits) {
    if (visit.destinationId !== destinationId || visit.topicId !== topicId) continue
    const at = timestampMs(visit.timestamp)
    if (!Number.isFinite(at) || at < start || at >= end) continue
    const country = normalizedCountryCode(visit.originCountryCode)
    counts.set(country, (counts.get(country) ?? 0) + 1)
    totalVisits += 1
  }

  const origins = [...counts.entries()]
    .map(([countryCode, count]) => ({ countryCode, visits: count, percent: totalVisits ? count / totalVisits * 100 : 0 }))
    .sort((a, b) => b.visits - a.visits || (a.countryCode ?? 'ZZ').localeCompare(b.countryCode ?? 'ZZ'))
  const unknownOriginVisits = counts.get(null) ?? 0
  return {
    start,
    end,
    durationMs: end - start,
    totalVisits,
    knownOriginVisits: totalVisits - unknownOriginVisits,
    unknownOriginVisits,
    origins,
  }
}

/**
 * Aggregates a destination/topic pair in memory. Origin percentages use all
 * matching visits as the denominator, with missing or invalid origins shown
 * as an explicit unknown bucket. No visit records leave this pure function.
 */
export function aggregateTopicTraffic(options: AggregateTopicTrafficOptions): TopicTrafficResult {
  const {
    destinationId,
    topicId,
    visits,
    currentWindowMs,
    baselineWindowMs = currentWindowMs,
    spikeThreshold = 2,
  } = options
  const now = timestampMs(options.now)
  if (!Number.isFinite(now)) throw new RangeError('now must be a valid timestamp')
  if (!Number.isFinite(currentWindowMs) || currentWindowMs <= 0) throw new RangeError('currentWindowMs must be positive')
  if (!Number.isFinite(baselineWindowMs) || baselineWindowMs <= 0) throw new RangeError('baselineWindowMs must be positive')
  if (!Number.isFinite(spikeThreshold) || spikeThreshold <= 0) throw new RangeError('spikeThreshold must be positive')

  const currentStart = now - currentWindowMs
  const baselineStart = currentStart - baselineWindowMs
  const current = buildWindow(visits, destinationId, topicId, currentStart, now)
  const baseline = buildWindow(visits, destinationId, topicId, baselineStart, currentStart)
  const currentRatePerHour = current.totalVisits / (current.durationMs / HOUR_MS)
  const baselineRatePerHour = baseline.totalVisits / (baseline.durationMs / HOUR_MS)
  const ratio = baseline.totalVisits === 0 ? null : currentRatePerHour / baselineRatePerHour
  const status = baseline.totalVisits === 0
    ? (current.totalVisits === 0 ? 'insufficient-baseline' : 'no-baseline')
    : ratio! >= spikeThreshold ? 'spike' : 'normal'

  const currentByCountry = new Map(current.origins.map((origin) => [origin.countryCode, origin]))
  const baselineByCountry = new Map(baseline.origins.map((origin) => [origin.countryCode, origin]))
  const countryCodes = new Set([...currentByCountry.keys(), ...baselineByCountry.keys()])
  const countryTrends = [...countryCodes].map((countryCode) => {
    const currentOrigin = currentByCountry.get(countryCode)
    const baselineOrigin = baselineByCountry.get(countryCode)
    const currentVisits = currentOrigin?.visits ?? 0
    const baselineVisits = baselineOrigin?.visits ?? 0
    const currentCountryRate = currentVisits / (current.durationMs / HOUR_MS)
    const baselineCountryRate = baselineVisits / (baseline.durationMs / HOUR_MS)
    const countryRatio = baselineVisits === 0 ? null : currentCountryRate / baselineCountryRate
    const countryStatus: TrafficTrendStatus = baselineVisits === 0
      ? (currentVisits === 0 ? 'insufficient-baseline' : 'no-baseline')
      : countryRatio! >= spikeThreshold ? 'spike' : 'normal'
    return {
      countryCode,
      currentVisits,
      currentPercent: currentOrigin?.percent ?? 0,
      baselineVisits,
      currentRatePerHour: currentCountryRate,
      baselineRatePerHour: baselineCountryRate,
      ratio: countryRatio,
      status: countryStatus,
    }
  }).sort((a, b) => b.currentVisits - a.currentVisits || (a.countryCode ?? 'ZZ').localeCompare(b.countryCode ?? 'ZZ'))

  return {
    destinationId,
    topicId,
    current,
    baseline,
    countryTrends,
    spike: { threshold: spikeThreshold, currentRatePerHour, baselineRatePerHour, ratio, status },
  }
}

/**
 * Clearly synthetic Design-preview example: a topic destination at the Roman
 * Colosseum with Bolivia represented among visitor origins. Not real traffic.
 */
export const topicTrafficDemo = {
  synthetic: true as const,
  label: 'Synthetic example — Bolivia to the Roman Colosseum',
  destination: { id: 'demo:roman-colosseum', name: 'Roman Colosseum' },
  destinationId: 'demo:roman-colosseum',
  topicId: 'ancient-rome',
  now: '2026-10-25T12:00:00.000Z',
  currentWindowMs: 24 * HOUR_MS,
  baselineWindowMs: 24 * HOUR_MS,
  spikeThreshold: 2,
  visits: [
    { destinationId: 'demo:roman-colosseum', topicId: 'ancient-rome', timestamp: '2026-10-25T11:50:00.000Z', originCountryCode: 'BO' },
    { destinationId: 'demo:roman-colosseum', topicId: 'ancient-rome', timestamp: '2026-10-25T11:40:00.000Z', originCountryCode: 'BO' },
    { destinationId: 'demo:roman-colosseum', topicId: 'ancient-rome', timestamp: '2026-10-25T11:30:00.000Z', originCountryCode: 'IT' },
    { destinationId: 'demo:roman-colosseum', topicId: 'ancient-rome', timestamp: '2026-10-25T11:20:00.000Z', originCountryCode: 'IT' },
    { destinationId: 'demo:roman-colosseum', topicId: 'ancient-rome', timestamp: '2026-10-25T11:10:00.000Z', originCountryCode: null },
    { destinationId: 'demo:roman-colosseum', topicId: 'ancient-rome', timestamp: '2026-10-25T10:50:00.000Z', originCountryCode: 'BO' },
    { destinationId: 'demo:roman-colosseum', topicId: 'ancient-rome', timestamp: '2026-10-24T11:50:00.000Z', originCountryCode: 'BO' },
    { destinationId: 'demo:roman-colosseum', topicId: 'ancient-rome', timestamp: '2026-10-24T11:40:00.000Z', originCountryCode: 'IT' },
    { destinationId: 'demo:roman-colosseum', topicId: 'ancient-rome', timestamp: '2026-10-24T11:30:00.000Z', originCountryCode: null },
  ] satisfies readonly TopicVisit[],
}

export const topicTrafficDemoResult = aggregateTopicTraffic(topicTrafficDemo)
