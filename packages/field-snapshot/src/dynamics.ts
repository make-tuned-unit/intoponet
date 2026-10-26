import { isUtcTimestamp, parsePublicSourceRecord, type PublicSourceRecord } from './interest-contract'
import { activityLineages, parseFeedHistorySnapshot, type FeedHistorySnapshot } from './feed-history'
import { sha256Hex, type ItemGeographyResult, type PublicEventGeography } from './event-geography'

/** Versioned, renderer-neutral output from public publication activity. */
export interface FieldDynamicsSignal {
  schemaVersion: 'intoponet.field-dynamics.v1'
  id: string
  topicId: string
  geography: 'about_location' | 'global' | 'unknown'
  placeId?: string
  anchors: Array<{ lat: number; lon: number; radiusKm?: number; weight: number }>
  languageCohort: string
  coverageCohort: 'low' | 'medium' | 'high' | 'unknown'
  windowStart: string
  windowEnd: string
  baselineStart: string
  observedActivity: number
  decayedActivity: number
  normalizedIntensity: number
  /** Null when history or coverage is not comparable; never infer decline from an outage. */
  momentum: number | null
  momentumStatus: 'comparable' | 'insufficient-baseline' | 'coverage-limited' | 'coverage-unverified' | 'stale'
  geographicConfidence: number
  coverageConfidence: number
  /** Distribution groups associated with the activity; not an authorship/origin claim. */
  publisherGroupCount: number
  provenanceItemIds: string[]
  anomalyFlags: string[]
  normalizationVersion: 'cohort-decay-v1'
}

export interface FieldDynamicsSnapshot {
  schemaVersion: 'intoponet.field-dynamics-snapshot.v1'
  asOf: string
  signals: FieldDynamicsSignal[]
}

export interface FieldDynamicsOptions {
  asOf: string
  /** Current and immediately preceding comparison windows. Defaults to 6 hours. */
  windowHours?: number
  /** Rolling baseline length before the comparison windows. Defaults to 7 days. */
  baselineDays?: number
  /** Publication activity half-life. Defaults to 36 hours. */
  halfLifeHours?: number
  /** Maximum weighted activity one publisher group can contribute per topic/place/window. */
  publisherCap?: number
  /** Activity above this many weighted units in a window is flagged, not discarded. */
  anomalyThreshold?: number
  /** Optional reviewed hierarchy IDs for a place (for national and regional source coverage). */
  placeCoverageAncestors?: Record<string, string[]>
  /** Explicit publisher-group availability for both comparison windows, from fetch history. */
  coverageWindows?: Array<{ placeId: string; language: string; windowStart: string; windowEnd: string; healthyPublisherGroupIds: string[] }>
}

const LIMITS = { events: 20_000, sources: 2_000, output: 100_000, id: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/ }
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
const round = (n: number, digits = 6) => Number(n.toFixed(digits))
const iso = (ms: number) => new Date(ms).toISOString()
const SIGNAL_KEYS = ['schemaVersion','id','topicId','geography','placeId','anchors','languageCohort','coverageCohort','windowStart','windowEnd','baselineStart','observedActivity','decayedActivity','normalizedIntensity','momentum','momentumStatus','geographicConfidence','coverageConfidence','publisherGroupCount','provenanceItemIds','anomalyFlags','normalizationVersion']

/** Validate a persisted or received dynamics snapshot against closed, bounded output fields. */
export function parseFieldDynamicsSnapshot(value: unknown): FieldDynamicsSnapshot | null {
  let json: string
  try { json = JSON.stringify(value) } catch { return null }
  if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > 8_000_000) return null
  let copy: unknown
  try { copy = JSON.parse(json) } catch { return null }
  if (!copy || typeof copy !== 'object' || Array.isArray(copy)) return null
  const snapshot = copy as Record<string, unknown>
  if (Object.keys(snapshot).length !== 3 || snapshot.schemaVersion !== 'intoponet.field-dynamics-snapshot.v1' ||
    typeof snapshot.asOf !== 'string' || !isUtcTimestamp(snapshot.asOf) ||
    !Array.isArray(snapshot.signals) || snapshot.signals.length > LIMITS.output) return null
  const ids = new Set<string>()
  for (const candidate of snapshot.signals) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
    const signal = candidate as Record<string, unknown>
    if (Object.keys(signal).some(key => !SIGNAL_KEYS.includes(key)) || SIGNAL_KEYS.some(key => key !== 'placeId' && !(key in signal)) ||
      (signal.placeId !== undefined && !LIMITS.id.test(String(signal.placeId))) || signal.schemaVersion !== 'intoponet.field-dynamics.v1' ||
      typeof signal.id !== 'string' || !/^dyn-[a-f0-9]{64}$/.test(signal.id) || ids.has(signal.id) ||
      typeof signal.topicId !== 'string' || !LIMITS.id.test(signal.topicId) || !['about_location','global','unknown'].includes(String(signal.geography)) ||
      (signal.geography === 'about_location' ? typeof signal.placeId !== 'string' : signal.placeId !== undefined) ||
      typeof signal.languageCohort !== 'string' || signal.languageCohort.length > 64 || !['low','medium','high','unknown'].includes(String(signal.coverageCohort)) ||
      ![signal.windowStart, signal.windowEnd, signal.baselineStart].every(v => typeof v === 'string' && isUtcTimestamp(v)) ||
      Date.parse(signal.baselineStart as string) >= Date.parse(signal.windowStart as string) || Date.parse(signal.windowStart as string) >= Date.parse(signal.windowEnd as string) || Date.parse(signal.windowEnd as string) > Date.parse(snapshot.asOf) ||
      !Number.isSafeInteger(signal.observedActivity) || (signal.observedActivity as number) < 0 || !Number.isSafeInteger(signal.publisherGroupCount) || (signal.publisherGroupCount as number) < 0 ||
      ![signal.decayedActivity, signal.normalizedIntensity, signal.geographicConfidence, signal.coverageConfidence].every(v => typeof v === 'number' && Number.isFinite(v)) ||
      (signal.decayedActivity as number) < 0 || (signal.normalizedIntensity as number) < 0 || (signal.normalizedIntensity as number) > 1 ||
      (signal.geographicConfidence as number) < 0 || (signal.geographicConfidence as number) > 1 || (signal.coverageConfidence as number) < 0 || (signal.coverageConfidence as number) > 1 ||
      !(['comparable','insufficient-baseline','coverage-limited','coverage-unverified','stale'] as string[]).includes(String(signal.momentumStatus)) ||
      (signal.momentumStatus === 'comparable' ? typeof signal.momentum !== 'number' || !Number.isFinite(signal.momentum) || Math.abs(signal.momentum) > 1 : signal.momentum !== null) ||
      !Array.isArray(signal.anchors) || signal.anchors.length > 32 || !Array.isArray(signal.provenanceItemIds) || signal.provenanceItemIds.length > LIMITS.events ||
      signal.provenanceItemIds.some(id => typeof id !== 'string' || !LIMITS.id.test(id)) || new Set(signal.provenanceItemIds).size !== signal.provenanceItemIds.length || !Array.isArray(signal.anomalyFlags) || signal.anomalyFlags.length > 32 ||
      signal.anomalyFlags.some(flag => typeof flag !== 'string' || flag.length > 64) || signal.normalizationVersion !== 'cohort-decay-v1') return null
    if ((signal.geography !== 'about_location' && signal.anchors.length > 0) || signal.anchors.some(anchor => !anchor || typeof anchor !== 'object' || Object.keys(anchor).some(key => !['lat','lon','radiusKm','weight'].includes(key)) ||
      !Number.isFinite((anchor as { lat?: number }).lat) || !Number.isFinite((anchor as { lon?: number }).lon) ||
      !Number.isFinite((anchor as { weight?: number }).weight) || (anchor as { lat: number }).lat < -90 || (anchor as { lat: number }).lat > 90 ||
      (anchor as { lon: number }).lon < -180 || (anchor as { lon: number }).lon > 180 ||
      ((anchor as { radiusKm?: number }).radiusKm !== undefined && (typeof (anchor as { radiusKm?: unknown }).radiusKm !== 'number' || !Number.isFinite((anchor as { radiusKm?: number }).radiusKm) || (anchor as { radiusKm: number }).radiusKm <= 0 || (anchor as { radiusKm: number }).radiusKm > 20_100)) ||
      (anchor as { weight: number }).weight < 0 || (anchor as { weight: number }).weight > 1)) return null
    if (new Set(signal.anchors.map(anchor => `${(anchor as { lat: number }).lat}|${(anchor as { lon: number }).lon}|${(anchor as { radiusKm?: number }).radiusKm ?? ''}`)).size !== signal.anchors.length) return null
    ids.add(signal.id)
  }
  return copy as FieldDynamicsSnapshot
}
function optionsOf(input: FieldDynamicsOptions): Required<FieldDynamicsOptions> {
  if (!input || typeof input !== 'object' || !/^(?:\d{4})-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(input.asOf) || !Number.isFinite(Date.parse(input.asOf))) throw new TypeError('asOf must be a UTC timestamp')
  const allowed = ['asOf','windowHours','baselineDays','halfLifeHours','publisherCap','anomalyThreshold','placeCoverageAncestors','coverageWindows']
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new TypeError('Unknown dynamics option')
  const result = { windowHours: 6, baselineDays: 7, halfLifeHours: 36, publisherCap: 2, anomalyThreshold: 20, placeCoverageAncestors: {}, coverageWindows: [], ...input }
  for (const key of ['windowHours', 'baselineDays', 'halfLifeHours', 'publisherCap', 'anomalyThreshold'] as const) {
    if (!Number.isFinite(result[key]) || result[key] <= 0) throw new RangeError(`${key} must be a finite positive number`)
  }
  if (result.windowHours > 168 || result.baselineDays > 90 || result.halfLifeHours > 720 || result.publisherCap > 100 || result.anomalyThreshold > 1_000_000) throw new RangeError('Dynamics option exceeds bounded limits')
  return { ...result, asOf: iso(Date.parse(input.asOf)) }
}

function validateGeography(input: PublicEventGeography, history: FeedHistorySnapshot): void {
  if (!input || input.schemaVersion !== 'intoponet.event-geography.v1' || !Array.isArray(input.events) || !Array.isArray(input.items) || input.events.length > LIMITS.events || input.items.length > LIMITS.events) throw new TypeError('Invalid or oversized event geography input')
  let byteLength: number
  try { byteLength = new TextEncoder().encode(JSON.stringify(input)).byteLength } catch { throw new TypeError('Event geography input must be bounded JSON') }
  if (byteLength > 32_000_000) throw new RangeError('Event geography input exceeds byte limit')
  const itemIds = new Set(history.items.map(row => row.item.id))
  const seenEvents = new Set<string>()
  const seenItems = new Set<string>()
  for (const event of input.events) {
    if (!LIMITS.id.test(event.eventId) || seenEvents.has(event.eventId) || !Array.isArray(event.itemIds) || event.itemIds.length === 0 || event.itemIds.length > LIMITS.events || !Array.isArray(event.topicIds) || event.topicIds.length > 64 || event.topicIds.some(id => !LIMITS.id.test(id)) || !Array.isArray(event.anchors) || event.anchors.length > 32 || !Array.isArray(event.evidence) || event.evidence.length > 5_000 || !Array.isArray(event.distributingPublisherGroupIds) || event.distributingPublisherGroupIds.length > LIMITS.sources || event.distributingPublisherGroupIds.some(id => !LIMITS.id.test(id))) throw new TypeError('Invalid event geography row')
    seenEvents.add(event.eventId)
    for (const itemId of event.itemIds) {
      if (!itemIds.has(itemId) || seenItems.has(itemId)) throw new TypeError('Event geography references an unknown or duplicate item')
      seenItems.add(itemId)
    }
    if (!['localized', 'ambiguous', 'global', 'unknown'].includes(event.geography)) throw new TypeError('Invalid event geography state')
    for (const anchor of event.anchors) {
      if (!LIMITS.id.test(anchor.placeId) || !Number.isFinite(anchor.confidence) || anchor.confidence < 0 || anchor.confidence > 1 ||
        (anchor.latitude !== undefined && (!Number.isFinite(anchor.latitude) || anchor.latitude < -90 || anchor.latitude > 90)) ||
        (anchor.longitude !== undefined && (!Number.isFinite(anchor.longitude) || anchor.longitude < -180 || anchor.longitude > 180)) ||
        (anchor.radiusKm !== undefined && (!Number.isFinite(anchor.radiusKm) || anchor.radiusKm <= 0 || anchor.radiusKm > 20_100))) throw new TypeError('Invalid geographic anchor')
    }
  }
  for (const row of input.items) {
    if (!row || !LIMITS.id.test(row.itemId) || !LIMITS.id.test(row.eventId) || !isUtcTimestamp(row.observedAt) ||
      !Array.isArray(row.topicIds) || row.topicIds.length > 64 || row.topicIds.some(id => !LIMITS.id.test(id)) ||
      !['valid','missing','future'].includes(row.publicationStatus) || !['localized','ambiguous','global','unknown'].includes(row.geography) ||
      !Array.isArray(row.anchors) || row.anchors.length > 32 || !Array.isArray(row.evidence) || row.evidence.length > 5_000) throw new TypeError('Invalid item geography row')
    for (const anchor of row.anchors) {
      if (!LIMITS.id.test(anchor.placeId) || !Number.isFinite(anchor.confidence) || anchor.confidence < 0 || anchor.confidence > 1 ||
        (anchor.latitude !== undefined && (!Number.isFinite(anchor.latitude) || anchor.latitude < -90 || anchor.latitude > 90)) ||
        (anchor.longitude !== undefined && (!Number.isFinite(anchor.longitude) || anchor.longitude < -180 || anchor.longitude > 180)) ||
        (anchor.radiusKm !== undefined && (!Number.isFinite(anchor.radiusKm) || anchor.radiusKm <= 0 || anchor.radiusKm > 20_100)) ||
        ((anchor.latitude === undefined) !== (anchor.longitude === undefined))) throw new TypeError('Invalid item geography anchor')
    }
  }
  const geoIds = new Set(input.items.map(row => row.itemId))
  if (geoIds.size !== input.items.length || [...geoIds].some(id => !itemIds.has(id))) throw new TypeError('Geography item index does not match history')
}

type Bucket = { key: string; topicId: string; geography: FieldDynamicsSignal['geography']; placeId?: string; anchors: FieldDynamicsSignal['anchors']; language: string; coverageCohort: FieldDynamicsSignal['coverageCohort']; events: Array<{ id: string; at: number; groups: string[]; confidence: number; itemIds: string[] }> }

function coverageMatch(source: PublicSourceRecord, placeId: string, language: string, ancestors: string[] = []): boolean {
  if (source.licenseStatus !== 'approved') return false
  const declared = source.declaredCoverage
  const coverageIds = new Set([placeId, ...ancestors])
  const placeMatch = [...declared.cityIds, ...declared.regionIds, ...declared.countryCodes].some(id => coverageIds.has(id))
  const broadMatch = source.geographicScope === 'international' && declared.countryCodes.length === 0 && declared.regionIds.length === 0 && declared.cityIds.length === 0
  const languageCohort = language === 'unknown' ? [] : language.startsWith('multi:') ? language.slice(6).split('+') : [language]
  const languageMatch = !languageCohort.length || source.languageTags.length === 0 || source.languageTags.some(tag => languageCohort.some(code => tag.toLowerCase() === code.toLowerCase() || tag.toLowerCase().split('-')[0] === code.toLowerCase().split('-')[0]))
  return (placeMatch || broadMatch) && languageMatch
}

/**
 * Aggregate mapped public feed history deterministically. This consumes only public item/source
 * contracts and event-geography evidence; it has no access to browser or private-library state.
 */
export function aggregateFieldDynamics(
  historyInput: FeedHistorySnapshot,
  geography: PublicEventGeography,
  registryInput: unknown[],
  rawOptions: FieldDynamicsOptions,
): FieldDynamicsSnapshot {
  const history = parseFeedHistorySnapshot(historyInput)
  if (!history) throw new TypeError('Invalid public feed history snapshot')
  if (!Array.isArray(registryInput) || registryInput.length > LIMITS.sources) throw new RangeError('Source registry exceeds bounds')
  if (new TextEncoder().encode(JSON.stringify(registryInput)).byteLength > 8_000_000) throw new RangeError('Source registry exceeds byte limit')
  const sources = registryInput.map(row => {
    const parsed = parsePublicSourceRecord(row)
    if (!parsed) throw new TypeError('Invalid public source registry row')
    return parsed
  }).sort((a, b) => cmp(a.sourceId, b.sourceId))
  if (new Set(sources.map(source => source.sourceId)).size !== sources.length) throw new TypeError('Duplicate source registry IDs')
  const options = optionsOf(rawOptions)
  const placeAncestors = options.placeCoverageAncestors ?? {}
  if (!placeAncestors || typeof placeAncestors !== 'object' || Array.isArray(placeAncestors) || Object.keys(placeAncestors).length > 20_000) throw new TypeError('Invalid place coverage hierarchy')
  if (new TextEncoder().encode(JSON.stringify(placeAncestors)).byteLength > 2_000_000) throw new RangeError('Place coverage hierarchy exceeds byte limit')
  for (const [placeId, parents] of Object.entries(placeAncestors)) {
    if (!LIMITS.id.test(placeId) || !Array.isArray(parents) || parents.length > 16 || parents.some(parent => typeof parent !== 'string' || !LIMITS.id.test(parent))) throw new TypeError('Invalid place coverage hierarchy entry')
  }
  const coverageWindows = options.coverageWindows
  if (!Array.isArray(coverageWindows) || coverageWindows.length > 100_000) throw new TypeError('Invalid coverage-window evidence')
  if (new TextEncoder().encode(JSON.stringify(coverageWindows)).byteLength > 8_000_000) throw new RangeError('Coverage-window evidence exceeds byte limit')
  const coverageWindowKeys = new Set<string>()
  for (const row of coverageWindows) {
    if (!row || typeof row !== 'object' || Object.keys(row).length !== 5 || !LIMITS.id.test(row.placeId) || typeof row.language !== 'string' || row.language.length > 64 ||
      !isUtcTimestamp(row.windowStart) || !isUtcTimestamp(row.windowEnd) ||
      Date.parse(row.windowStart) >= Date.parse(row.windowEnd) || !Array.isArray(row.healthyPublisherGroupIds) || row.healthyPublisherGroupIds.length > LIMITS.sources ||
      row.healthyPublisherGroupIds.some(id => !LIMITS.id.test(id)) || new Set(row.healthyPublisherGroupIds).size !== row.healthyPublisherGroupIds.length) throw new TypeError('Invalid coverage-window evidence row')
    const key = [row.placeId, row.language.toLowerCase(), Date.parse(row.windowStart), Date.parse(row.windowEnd)].join('|')
    if (coverageWindowKeys.has(key)) throw new TypeError('Duplicate coverage-window evidence')
    coverageWindowKeys.add(key)
  }
  validateGeography(geography, history)
  const asOf = Date.parse(options.asOf)
  const windowMs = options.windowHours * 3_600_000
  const baselineMs = options.baselineDays * 86_400_000
  const recentStart = asOf - windowMs
  const previousStart = recentStart - windowMs
  const baselineStart = previousStart - baselineMs
  const halfLife = options.halfLifeHours * 3_600_000
  const items = new Map(history.items.map(row => [row.item.id, row.item]))
  const registry = new Map(sources.map(source => [source.sourceId, source]))
  for (const prior of history.sources) {
    const registered = registry.get(prior.sourceId)
    if (registered && registered.independentPublisherGroupId !== prior.independentPublisherGroupId) throw new TypeError(`Publisher group mismatch for ${prior.sourceId}`)
  }
  const itemGeo = new Map<string, ItemGeographyResult>(geography.items.map(row => [row.itemId, row]))
  const visibleHistory: FeedHistorySnapshot = {
    schemaVersion: '1.0', asOf: options.asOf,
    items: history.items.filter(row => Date.parse(row.firstSeenAt) <= asOf && Date.parse(row.latestItemObservedAt) <= asOf &&
    Date.parse(row.latestVersionAt) <= asOf && row.publicationStatus === 'valid' && row.item.publishedAt !== undefined && Date.parse(row.item.publishedAt) <= asOf &&
    registry.get(row.item.sourceId)?.licenseStatus === 'approved').map(row => ({ ...row,
      lastSeenAt: Date.parse(row.lastSeenAt) > asOf ? options.asOf : row.lastSeenAt,
      revisions: row.revisions.filter(revision => Date.parse(revision.observedAt) <= asOf),
    })),
    sources: history.sources.map(row => Date.parse(row.observedAt) > asOf
      ? { ...row, observedAt: options.asOf, health: 'stale' as const, ...(row.lastSuccessfulFetchAt && Date.parse(row.lastSuccessfulFetchAt) <= asOf ? { lastSuccessfulFetchAt: row.lastSuccessfulFetchAt } : {}) }
      : row.lastSuccessfulFetchAt && Date.parse(row.lastSuccessfulFetchAt) > asOf
        ? (({ lastSuccessfulFetchAt: _future, ...rest }) => rest)(row)
        : row),
  }
  const lineages = activityLineages(visibleHistory).map(lineage => {
    const itemIds = lineage.itemIds.filter(id => registry.get(items.get(id)?.sourceId ?? '')?.licenseStatus === 'approved').sort(cmp)
    const lineageItems = itemIds.map(id => items.get(id)!).filter(Boolean)
    const groups = [...new Set(lineageItems.map(item => registry.get(item.sourceId)?.independentPublisherGroupId).filter((id): id is string => !!id))].sort(cmp)
    return { ...lineage, itemIds, groups }
  }).filter(lineage => lineage.itemIds.length > 0 && lineage.groups.length > 0)
  const visibleItemIds = new Set(visibleHistory.items.map(row => row.item.id))
  const lineagesByItem = new Map<string, typeof lineages>()
  for (const lineage of lineages) for (const id of lineage.itemIds) lineagesByItem.set(id, [...(lineagesByItem.get(id) ?? []), lineage])
  const buckets = new Map<string, Bucket>()

  for (const event of geography.events.slice().sort((a, b) => cmp(a.eventId, b.eventId))) {
    const members = event.itemIds.filter(id => visibleItemIds.has(id)).map(id => items.get(id)!).filter(Boolean).sort((a, b) => cmp(a.id, b.id))
    if (!members.length) continue
    const memberIds = new Set(members.map(item => item.id))
    const eligibleAnchors = members.flatMap(item => itemGeo.get(item.id)?.geography === 'localized' ? itemGeo.get(item.id)!.anchors : [])
    const anchorGroups = new Map<string, typeof eligibleAnchors>()
    for (const anchor of eligibleAnchors) anchorGroups.set(anchor.placeId, [...(anchorGroups.get(anchor.placeId) ?? []), anchor])
    const uniqueAnchors = [...anchorGroups.entries()].sort(([a], [b]) => cmp(a, b)).map(([, rows]) => rows.slice().sort((a, b) =>
      b.confidence - a.confidence || Number(b.latitude !== undefined && b.longitude !== undefined) - Number(a.latitude !== undefined && a.longitude !== undefined) ||
      (a.radiusKm ?? Number.POSITIVE_INFINITY) - (b.radiusKm ?? Number.POSITIVE_INFINITY) || (a.latitude ?? 0) - (b.latitude ?? 0) || (a.longitude ?? 0) - (b.longitude ?? 0))[0]!)
    const targets: Array<{ geography: FieldDynamicsSignal['geography']; placeId?: string; anchors: Bucket['anchors']; confidence: number }> = uniqueAnchors.length
      ? uniqueAnchors.map(anchor => ({ geography: 'about_location', placeId: anchor.placeId, confidence: anchor.confidence,
          anchors: anchor.latitude !== undefined && anchor.longitude !== undefined
            ? [{ lat: anchor.latitude, lon: anchor.longitude, ...(anchor.radiusKm !== undefined ? { radiusKm: anchor.radiusKm } : {}), weight: 1 }]
            : [] }))
      : [{ geography: members.some(item => itemGeo.get(item.id)?.geography === 'global') ? 'global' : 'unknown', anchors: [], confidence: 0 }]
    const eventLineages = [...new Map([...memberIds].flatMap(id => lineagesByItem.get(id) ?? []).map(lineage => [lineage.lineageId, lineage])).values()].sort((a, b) => cmp(a.lineageId, b.lineageId))
    for (const lineage of eventLineages) {
      const lineageItems = lineage.itemIds.filter(id => memberIds.has(id)).map(id => items.get(id)!).filter(Boolean)
      const at = Date.parse(lineage.publishedAt)
      if (at < baselineStart || at > asOf) continue
      const languages = [...new Set(lineageItems.map(item => item.language.toLowerCase()))].sort(cmp)
      const language = languages.length === 0 ? 'unknown' : languages.length === 1 ? languages[0]! : `multi:${languages.join('+')}`
      const itemIds = lineageItems.map(item => item.id).sort(cmp)
      const lineageTopics = [...new Set(lineageItems.flatMap(item => item.topicIds))].filter(topic => event.topicIds.includes(topic)).sort(cmp)
      if (!lineageTopics.length) continue
      for (const topicId of lineageTopics) for (const target of targets) {
      const place = target.placeId ?? target.geography
      const relevant = target.placeId ? sources.filter(source => coverageMatch(source, target.placeId!, language, placeAncestors[target.placeId!] ?? [])) : []
      const coverageCohort: FieldDynamicsSignal['coverageCohort'] = !relevant.length ? 'unknown' : relevant.length < 3 ? 'low' : relevant.length < 10 ? 'medium' : 'high'
      const key = [topicId, place, language, coverageCohort].join('|')
      let bucket = buckets.get(key)
      if (!bucket) {
        if (buckets.size >= LIMITS.output) throw new RangeError('Dynamics aggregation exceeds output bucket limit')
        bucket = { key, topicId, geography: target.geography, ...(target.placeId ? { placeId: target.placeId } : {}), anchors: target.anchors,
          language, coverageCohort, events: [] }
        buckets.set(key, bucket)
      }
      bucket.events.push({ id: `${event.eventId}:${lineage.lineageId}`, at, groups: lineage.groups, confidence: target.confidence, itemIds })
      }
    }
  }

  const output: FieldDynamicsSignal[] = []
  for (const bucket of [...buckets.values()].sort((a, b) => cmp(a.key, b.key))) {
    const weighted = (start: number, end: number) => {
      const used = new Map<string, number>()
      const result = { weight: 0, eventCount: 0, groups: new Set<string>(), itemIds: new Set<string>(), capApplied: false }
      for (const event of bucket.events.slice().sort((a, b) => b.at - a.at || cmp(a.id, b.id))) {
        if (event.at < start || event.at >= end) continue
        result.eventCount++
        event.itemIds.forEach(id => result.itemIds.add(id))
        event.groups.forEach(group => result.groups.add(group))
        let eventWeight = 0
        const age = Math.max(0, end - event.at)
        const decay = Math.pow(0.5, age / halfLife)
        for (const group of event.groups) {
          const prior = used.get(group) ?? 0
          // A syndicated lineage remains one activity unit even when many publisher groups distribute it.
          const proposed = decay / event.groups.length
          const remaining = Math.max(0, options.publisherCap - prior)
          if (remaining < proposed) result.capApplied = true
          const contribution = Math.min(proposed, remaining)
          if (contribution > 0) { used.set(group, prior + contribution); eventWeight += contribution; result.groups.add(group) }
        }
        if (eventWeight > 0) {
          result.weight += eventWeight
        }
      }
      return result
    }
    const recent = weighted(recentStart, asOf + 1)
    const previous = weighted(previousStart, recentStart)
    const baseline = weighted(baselineStart, previousStart)
    // Activity decays across the rolling retention window; discrete windows drive momentum only.
    const trailing = weighted(baselineStart, asOf + 1)
    const relevant = bucket.placeId ? sources.filter(source => coverageMatch(source, bucket.placeId!, bucket.language, placeAncestors[bucket.placeId!] ?? [])) : []
    const healthById = new Map(history.sources.filter(row => Date.parse(row.observedAt) <= asOf).map(row => [row.sourceId, row]))
    const healthyGroups = new Set<string>()
    for (const source of relevant) {
      const health = healthById.get(source.sourceId)
      if (health?.health === 'healthy' && asOf - Date.parse(health.observedAt) <= 48 * 3_600_000) healthyGroups.add(source.independentPublisherGroupId)
    }
    const registeredGroups = new Set(relevant.map(source => source.independentPublisherGroupId))
    const coverageConfidence = registeredGroups.size ? round(healthyGroups.size / registeredGroups.size) : 0
    const allStale = relevant.length > 0 && relevant.every(source => {
      const health = healthById.get(source.sourceId)
      return !health || health.health === 'stale' || health.health === 'error' || health.health === 'disabled' || asOf - Date.parse(health.observedAt) > 48 * 3_600_000
    })
    // Compare recent decayed activity with an equally long historical interval in the same cohort.
    const intensity = trailing.weight / (trailing.weight + 3 * baseline.weight + 1)
    const hasBaseline = baseline.eventCount > 0 || previous.eventCount > 0
    const recentCoverage = options.coverageWindows.find(row => row.placeId === bucket.placeId && row.language.toLowerCase() === bucket.language.toLowerCase() &&
      Date.parse(row.windowStart) === recentStart && Date.parse(row.windowEnd) === asOf)
    const previousCoverage = options.coverageWindows.find(row => row.placeId === bucket.placeId && row.language.toLowerCase() === bucket.language.toLowerCase() &&
      Date.parse(row.windowStart) === previousStart && Date.parse(row.windowEnd) === recentStart)
    const coverageVerified = !!recentCoverage && !!previousCoverage
    const recentGroups = (recentCoverage?.healthyPublisherGroupIds ?? []).slice().sort(cmp)
    const previousGroups = (previousCoverage?.healthyPublisherGroupIds ?? []).slice().sort(cmp)
    const registeredGroupIds = [...registeredGroups].sort(cmp)
    const coverageComparable = coverageVerified && registeredGroupIds.length > 0 && recentGroups.join('|') === previousGroups.join('|') && recentGroups.join('|') === registeredGroupIds.join('|')
    const momentumStatus: FieldDynamicsSignal['momentumStatus'] = allStale ? 'stale' : !coverageVerified ? 'coverage-unverified' :
      !registeredGroups.size || !coverageComparable || healthyGroups.size < registeredGroups.size ? 'coverage-limited' : hasBaseline ? 'comparable' : 'insufficient-baseline'
    const momentum = momentumStatus === 'comparable'
      ? round(clamp((recent.weight - previous.weight) / (recent.weight + previous.weight + 1), -1, 1)) : null
    const geoConfidence = bucket.geography === 'about_location'
      ? round(bucket.events.reduce((sum, event) => sum + event.confidence, 0) / Math.max(1, bucket.events.length)) : 0
    const flags = [...(recent.eventCount >= options.anomalyThreshold ? ['activity-spike'] : []), ...(recent.capApplied ? ['publisher-cap-applied'] : [])]
    const identity = JSON.stringify(['observed-publication-activity-v1', bucket.topicId, bucket.placeId ?? bucket.geography, bucket.language])
    const id = `dyn-${sha256Hex(identity)}`
    output.push({ schemaVersion: 'intoponet.field-dynamics.v1', id, topicId: bucket.topicId, geography: bucket.geography,
      ...(bucket.placeId ? { placeId: bucket.placeId } : {}), anchors: bucket.anchors, languageCohort: bucket.language,
      coverageCohort: bucket.coverageCohort, windowStart: iso(recentStart), windowEnd: iso(asOf), baselineStart: iso(baselineStart),
      observedActivity: recent.eventCount, decayedActivity: round(trailing.weight), normalizedIntensity: round(clamp(intensity, 0, 1)),
      momentum, momentumStatus, geographicConfidence: geoConfidence, coverageConfidence,
      publisherGroupCount: trailing.groups.size, provenanceItemIds: [...trailing.itemIds].sort(cmp), anomalyFlags: flags,
      normalizationVersion: 'cohort-decay-v1' })
  }
  const result = { schemaVersion: 'intoponet.field-dynamics-snapshot.v1', asOf: options.asOf, signals: output } satisfies FieldDynamicsSnapshot
  const validated = parseFieldDynamicsSnapshot(result)
  if (!validated) throw new TypeError('Dynamics aggregation produced an invalid snapshot')
  return validated
}

