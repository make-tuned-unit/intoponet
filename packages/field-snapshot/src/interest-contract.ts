/**
 * Versioned public-interest contracts. These are deliberately separate from
 * the legacy FieldSnapshot v2 adapter in types.ts. Parsers validate structure,
 * bounds, and cross-references; they do not establish source truth, rights,
 * location correctness, independence, or the factual validity of supplied
 * independentSourceCount. Bounded allow-listed copies exclude executable or
 * renderer-controlled feed properties.
 */
export type GeographyKind = 'about_location' | 'audience_location' | 'global' | 'unknown'
export type InterestSourceType = 'synthetic' | 'gdelt' | 'wikimedia' | 'rss' | 'atom' | 'public_api' | 'civic' | 'beacon'
export type PublicSourceKind = 'rss' | 'atom' | 'gdelt' | 'public_api' | 'civic' | 'beacon'
export type GeographicScope = 'local' | 'regional' | 'national' | 'international' | 'unknown'
export type LicenseStatus = 'approved' | 'review_required' | 'blocked'
export type FeedHealth = 'healthy' | 'stale' | 'error' | 'disabled'
export type LocationEvidence = 'explicit' | 'entity_linked' | 'inferred'
export type CoverageState = 'observed' | 'low_observed' | 'insufficient' | 'stale'

export type Anchor = { lat: number; lon: number; weight: number; radiusKm: number }

export type InterestSignal = {
  schemaVersion: '1.0'
  id: string
  topicId: string
  sourceType: InterestSourceType
  geographyKind: GeographyKind
  anchors: Anchor[]
  observationStart: string
  observationEnd: string
  intensity: number
  momentum: number
  geoConfidence: number
  coverageConfidence: number
  independentSourceCount: number
  provenanceIds: string[]
  updatedAt: string
}

/** Renderer-safe band contract; never includes shader/source code. */
export type ContractFrequencyBand = {
  schemaVersion: '1.0'
  id: string
  topicIds: string[]
  centerline: Array<{ lat: number; lon: number }>
  widthKm: number
  wavelengthKm: number
  amplitude: number
  phase: number
  phaseVelocity: number
  confidence: number
  updatedAt: string
}

/** Source registry row; named distinctly from the existing v2 SourceRecord. */
export type PublicSourceRecord = {
  schemaVersion: '1.0'
  sourceId: string
  kind: PublicSourceKind
  url: string
  publisherName: string
  languageTags: string[]
  declaredCoverage: { countryCodes: string[]; regionIds: string[]; cityIds: string[] }
  geographicScope: GeographicScope
  licenseStatus: LicenseStatus
  termsUrl?: string
  pollingMinSeconds: number
  etag?: string
  lastModified?: string
  lastSuccessfulFetchAt?: string
  lastObservedItemAt?: string
  health: FeedHealth
  independentPublisherGroupId: string
}

export type PublicItem = {
  schemaVersion: '1.0'
  id: string
  sourceId: string
  canonicalUrl: string
  title: string
  publishedAt?: string
  discoveredAt: string
  language: string
  sourceContentHash: string
  syndicationClusterId?: string
  topicIds: string[]
  eventClusterId?: string
  aboutLocations: Array<{
    placeId: string
    lat: number
    lon: number
    radiusKm: number
    confidence: number
    evidence: LocationEvidence
  }>
  provenanceId: string
  updatedAt?: string
}

export type TileObservation = {
  schemaVersion: '1.0'
  tileId: string
  resolution: number
  bucketStart: string
  bucketEnd: string
  topicId: string
  observedActivity: number
  normalizedIntensity: number
  momentum: number
  independentSourceCount: number
  itemCount: number
  geographicConfidence: number
  coverageConfidence: number
  coverageState: CoverageState
  provenanceManifestId: string
  processedAt: string
}

export type ProvenanceEntry = {
  provenanceId: string
  sourceId: string
  itemIds: string[]
  canonicalUrls: string[]
  observedAt: string
}

export type ProvenanceManifest = {
  schemaVersion: '1.0'
  id: string
  generatedAt: string
  entries: ProvenanceEntry[]
}

export type PublicTileBundle = {
  schemaVersion: '1.0'
  id: string
  dataKind: 'synthetic' | 'public'
  generatedAt: string // bundle creation time
  tilePublishedAt: string
  normalizationVersion: string
  signals: InterestSignal[]
  bands: ContractFrequencyBand[]
  observations: TileObservation[]
  sources: PublicSourceRecord[]
  items: PublicItem[]
  provenance: ProvenanceManifest
}

// Payload and collection ceilings are intentional: contract parsing happens
// at untrusted feed/cache boundaries and should not accept unbounded JSON.
export const INTEREST_CONTRACT_LIMITS = {
  payloadBytes: 1_000_000,
  signals: 10_000,
  anchorsPerSignal: 32,
  provenanceIdsPerSignal: 256,
  bands: 10_000,
  centerlinePoints: 256,
  sources: 2_000,
  items: 20_000,
  observations: 50_000,
  manifestEntries: 20_000,
  strings: 512,
  title: 512,
  radiusKm: 20_100,
  widthKm: 20_100,
  wavelengthKm: 100_000,
  pollSeconds: 31_536_000,
} as const

type Obj = Record<string, unknown>
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown, max: number = INTEREST_CONTRACT_LIMITS.strings): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const bounded = (value: unknown, min: number, max: number): value is number =>
  finite(value) && value >= min && value <= max
const int = (value: unknown, min: number, max: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max
const arr = <T>(value: unknown, max: number, check: (item: unknown) => item is T): value is T[] =>
  Array.isArray(value) && value.length <= max && value.every(check)
const enumIs = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === 'string' && values.includes(value as T)
const keysOnly = (obj: Obj, allowed: readonly string[]): boolean =>
  Object.keys(obj).every((key) => allowed.includes(key))
const all = (obj: Obj, required: readonly string[], optional: readonly string[] = []): boolean =>
  keysOnly(obj, [...required, ...optional]) && required.every((key) => key in obj)
const id = (value: unknown): value is string =>
  str(value, 160) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
const strings = (value: unknown, maxItems: number, maxString = 160): value is string[] =>
  arr(value, maxItems, (item): item is string => str(item, maxString))
const unique = (values: string[]): boolean => new Set(values).size === values.length
function boundedJsonCopy<T>(value: unknown): T | null {
  try {
    const encoded = typeof value === 'string' ? value : JSON.stringify(value)
    if (typeof encoded !== 'string' || new TextEncoder().encode(encoded).byteLength > INTEREST_CONTRACT_LIMITS.payloadBytes) return null
    return JSON.parse(encoded) as T
  } catch {
    return null
  }
}

/** Enforce ISO UTC shape and real calendar/time values (Date.parse alone normalizes invalid dates). */
export function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return false
  const normalized = new Date(ms).toISOString()
  const source = /\.\d{1,3}Z$/.test(value)
    ? value.replace(/\.(\d{1,3})Z$/, (_match, digits: string) => `.${digits.padEnd(3, '0')}Z`)
    : value.replace(/Z$/, '.000Z')
  return normalized === source
}

const validPoint = (value: unknown): value is { lat: number; lon: number } =>
  isObj(value) && all(value, ['lat', 'lon']) && bounded(value.lat, -90, 90) && bounded(value.lon, -180, 180)

const validAnchor = (value: unknown): value is Anchor =>
  isObj(value) && all(value, ['lat', 'lon', 'weight', 'radiusKm']) &&
  bounded(value.lat, -90, 90) && bounded(value.lon, -180, 180) &&
  bounded(value.weight, 0, 1) && bounded(value.radiusKm, 0.1, INTEREST_CONTRACT_LIMITS.radiusKm)

const validSourceType = (v: unknown): v is InterestSourceType =>
  enumIs(v, ['synthetic', 'gdelt', 'wikimedia', 'rss', 'atom', 'public_api', 'civic', 'beacon'] as const)

function validInterestSignal(value: unknown): value is InterestSignal {
  if (!isObj(value) || !all(value, ['schemaVersion','id','topicId','sourceType','geographyKind','anchors','observationStart','observationEnd','intensity','momentum','geoConfidence','coverageConfidence','independentSourceCount','provenanceIds','updatedAt'])) return false
  if (value.schemaVersion !== '1.0' || !id(value.id) || !id(value.topicId) || !validSourceType(value.sourceType)) return false
  if (!enumIs(value.geographyKind, ['about_location','audience_location','global','unknown'] as const)) return false
  if (!arr(value.anchors, INTEREST_CONTRACT_LIMITS.anchorsPerSignal, validAnchor)) return false
  if ((value.geographyKind === 'global' || value.geographyKind === 'unknown') && value.anchors.length !== 0) return false
  if (!isUtcTimestamp(value.observationStart) || !isUtcTimestamp(value.observationEnd) || !isUtcTimestamp(value.updatedAt)) return false
  // updatedAt is the publisher/processor clock and may differ from observation time.
  if (Date.parse(value.observationStart) > Date.parse(value.observationEnd)) return false
  return bounded(value.intensity, 0, 1) && bounded(value.momentum, -1, 1) &&
    bounded(value.geoConfidence, 0, 1) && bounded(value.coverageConfidence, 0, 1) &&
    int(value.independentSourceCount, 0, 1_000_000) &&
    strings(value.provenanceIds, INTEREST_CONTRACT_LIMITS.provenanceIdsPerSignal) && value.provenanceIds.length > 0 && unique(value.provenanceIds)
}

export function parseInterestSignal(value: unknown): InterestSignal | null {
  const copy = boundedJsonCopy<InterestSignal>(value)
  return validInterestSignal(copy) ? copy : null
}

function validBand(value: unknown): value is ContractFrequencyBand {
  if (!isObj(value) || !all(value, ['schemaVersion','id','topicIds','centerline','widthKm','wavelengthKm','amplitude','phase','phaseVelocity','confidence','updatedAt'])) return false
  return value.schemaVersion === '1.0' && id(value.id) && strings(value.topicIds, 64) && value.topicIds.length > 0 && unique(value.topicIds) &&
    arr(value.centerline, INTEREST_CONTRACT_LIMITS.centerlinePoints, validPoint) && value.centerline.length >= 2 &&
    bounded(value.widthKm, 0.1, INTEREST_CONTRACT_LIMITS.widthKm) && bounded(value.wavelengthKm, 0.1, INTEREST_CONTRACT_LIMITS.wavelengthKm) &&
    bounded(value.amplitude, 0, 1) && bounded(value.phase, -1_000_000, 1_000_000) &&
    bounded(value.phaseVelocity, -100, 100) && bounded(value.confidence, 0, 1) && isUtcTimestamp(value.updatedAt)
}

export function parseContractFrequencyBand(value: unknown): ContractFrequencyBand | null {
  const copy = boundedJsonCopy<ContractFrequencyBand>(value)
  return validBand(copy) ? copy : null
}

const sourceKinds: readonly PublicSourceKind[] = ['rss','atom','gdelt','public_api','civic','beacon']
const scopes: readonly GeographicScope[] = ['local','regional','national','international','unknown']
const licenses: readonly LicenseStatus[] = ['approved','review_required','blocked']
const healthValues: readonly FeedHealth[] = ['healthy','stale','error','disabled']
function validHttpUrl(value: unknown): value is string {
  if (!str(value, 2048)) return false
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' }
  catch { return false }
}
function validSource(value: unknown): value is PublicSourceRecord {
  if (!isObj(value) || !all(value, ['schemaVersion','sourceId','kind','url','publisherName','languageTags','declaredCoverage','geographicScope','licenseStatus','pollingMinSeconds','health','independentPublisherGroupId'], ['termsUrl','etag','lastModified','lastSuccessfulFetchAt','lastObservedItemAt'])) return false
  if (value.schemaVersion !== '1.0' || !id(value.sourceId) || !enumIs(value.kind, sourceKinds) || !validHttpUrl(value.url) || !str(value.publisherName)) return false
  if (!strings(value.languageTags, 32, 35) || !value.languageTags.every((tag) => /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(tag)) || !isObj(value.declaredCoverage) || !all(value.declaredCoverage, ['countryCodes','regionIds','cityIds'])) return false
  const coverage = value.declaredCoverage
  if (!strings(coverage.countryCodes, 300, 2) || !coverage.countryCodes.every((c) => /^[A-Z]{2}$/.test(c)) ||
    !strings(coverage.regionIds, 1000) || !strings(coverage.cityIds, 5000)) return false
  if (!enumIs(value.geographicScope, scopes) || !enumIs(value.licenseStatus, licenses) || !int(value.pollingMinSeconds, 30, INTEREST_CONTRACT_LIMITS.pollSeconds) || !enumIs(value.health, healthValues) || !id(value.independentPublisherGroupId)) return false
  if ('termsUrl' in value && !validHttpUrl(value.termsUrl)) return false
  if ('etag' in value && !str(value.etag, 1024)) return false
  if ('lastModified' in value && !str(value.lastModified, 128)) return false
  for (const key of ['lastSuccessfulFetchAt','lastObservedItemAt'] as const) if (key in value && !isUtcTimestamp(value[key])) return false
  return true
}
export function parsePublicSourceRecord(value: unknown): PublicSourceRecord | null {
  const copy = boundedJsonCopy<PublicSourceRecord>(value)
  return validSource(copy) ? copy : null
}

type PublicItemLocation = PublicItem['aboutLocations'][number]
function validItemLocation(value: unknown): value is PublicItemLocation {
  return isObj(value) && all(value, ['placeId','lat','lon','radiusKm','confidence','evidence']) && id(value.placeId) &&
    bounded(value.lat, -90, 90) && bounded(value.lon, -180, 180) && bounded(value.radiusKm, 0.1, INTEREST_CONTRACT_LIMITS.radiusKm) &&
    bounded(value.confidence, 0, 1) && enumIs(value.evidence, ['explicit','entity_linked','inferred'] as const)
}
function validItem(value: unknown): value is PublicItem {
  if (!isObj(value) || !all(value, ['schemaVersion','id','sourceId','canonicalUrl','title','discoveredAt','language','sourceContentHash','topicIds','aboutLocations','provenanceId'], ['publishedAt','updatedAt','syndicationClusterId','eventClusterId'])) return false
  return value.schemaVersion === '1.0' && id(value.id) && id(value.sourceId) && validHttpUrl(value.canonicalUrl) &&
    str(value.title, INTEREST_CONTRACT_LIMITS.title) && isUtcTimestamp(value.discoveredAt) &&
    (!('publishedAt' in value) || isUtcTimestamp(value.publishedAt)) && (!('updatedAt' in value) || isUtcTimestamp(value.updatedAt)) &&
    str(value.language, 35) && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value.language) &&
    typeof value.sourceContentHash === 'string' && /^[a-fA-F0-9]{32,128}$/.test(value.sourceContentHash) &&
    (!('syndicationClusterId' in value) || id(value.syndicationClusterId)) && (!('eventClusterId' in value) || id(value.eventClusterId)) &&
    strings(value.topicIds, 64) && unique(value.topicIds) && arr(value.aboutLocations, 32, validItemLocation) && id(value.provenanceId)
}
export function parsePublicItem(value: unknown): PublicItem | null {
  const copy = boundedJsonCopy<PublicItem>(value)
  return validItem(copy) ? copy : null
}

function validObservation(value: unknown): value is TileObservation {
  if (!isObj(value) || !all(value, ['schemaVersion','tileId','resolution','bucketStart','bucketEnd','topicId','observedActivity','normalizedIntensity','momentum','independentSourceCount','itemCount','geographicConfidence','coverageConfidence','coverageState','provenanceManifestId','processedAt'])) return false
  return value.schemaVersion === '1.0' && id(value.tileId) && int(value.resolution, 0, 30) && id(value.topicId) &&
    isUtcTimestamp(value.bucketStart) && isUtcTimestamp(value.bucketEnd) && Date.parse(value.bucketStart) < Date.parse(value.bucketEnd) &&
    bounded(value.observedActivity, 0, 1_000_000_000) && bounded(value.normalizedIntensity, 0, 1) && bounded(value.momentum, -1, 1) &&
    int(value.independentSourceCount, 0, 1_000_000) && int(value.itemCount, 0, 10_000_000) &&
    bounded(value.geographicConfidence, 0, 1) && bounded(value.coverageConfidence, 0, 1) &&
    enumIs(value.coverageState, ['observed','low_observed','insufficient','stale'] as const) && id(value.provenanceManifestId) && isUtcTimestamp(value.processedAt)
}
export function parseTileObservation(value: unknown): TileObservation | null {
  const copy = boundedJsonCopy<TileObservation>(value)
  return validObservation(copy) ? copy : null
}

function validManifest(value: unknown): value is ProvenanceManifest {
  if (!isObj(value) || !all(value, ['schemaVersion','id','generatedAt','entries'])) return false
  return value.schemaVersion === '1.0' && id(value.id) && isUtcTimestamp(value.generatedAt) &&
    arr(value.entries, INTEREST_CONTRACT_LIMITS.manifestEntries, (entry): entry is ProvenanceEntry => {
      if (!isObj(entry) || !all(entry, ['provenanceId','sourceId','itemIds','canonicalUrls','observedAt'])) return false
      return id(entry.provenanceId) && id(entry.sourceId) && strings(entry.itemIds, 5000) && unique(entry.itemIds) &&
        arr(entry.canonicalUrls, 5000, (url): url is string => validHttpUrl(url)) && unique(entry.canonicalUrls) && isUtcTimestamp(entry.observedAt)
    }) && unique(value.entries.map((entry) => (entry as Obj).provenanceId as string))
}
export function parseProvenanceManifest(value: unknown): ProvenanceManifest | null {
  const copy = boundedJsonCopy<ProvenanceManifest>(value)
  return validManifest(copy) ? copy : null
}

const bundleKeys = ['schemaVersion','id','dataKind','generatedAt','tilePublishedAt','normalizationVersion','signals','bands','observations','sources','items','provenance'] as const
export function parsePublicTileBundle(value: unknown): PublicTileBundle | null {
  const copy = boundedJsonCopy<PublicTileBundle>(value)
  if (!isObj(copy) || !all(copy, bundleKeys)) return null
  const bundle = copy
  if (bundle.schemaVersion !== '1.0' || !id(bundle.id) || !enumIs(bundle.dataKind, ['synthetic','public'] as const) || !isUtcTimestamp(bundle.generatedAt) || !isUtcTimestamp(bundle.tilePublishedAt) || !str(bundle.normalizationVersion, 64)) return null
  if (!arr(bundle.signals, INTEREST_CONTRACT_LIMITS.signals, validInterestSignal) || !arr(bundle.bands, INTEREST_CONTRACT_LIMITS.bands, validBand) ||
    !arr(bundle.observations, INTEREST_CONTRACT_LIMITS.observations, validObservation) || !arr(bundle.sources, INTEREST_CONTRACT_LIMITS.sources, validSource) ||
    !arr(bundle.items, INTEREST_CONTRACT_LIMITS.items, validItem) || !validManifest(bundle.provenance)) return null
  const uniqueIds = (rows: Obj[], key: string) => unique(rows.map((row) => row[key] as string))
  if (!uniqueIds(bundle.signals as Obj[], 'id') || !uniqueIds(bundle.bands as Obj[], 'id') || !uniqueIds(bundle.sources as Obj[], 'sourceId') ||
    !uniqueIds(bundle.items as Obj[], 'id')) return null
  const sourceIds = new Set((bundle.sources as PublicSourceRecord[]).map((source) => source.sourceId))
  const entries = bundle.provenance.entries as ProvenanceEntry[]
  const provenanceIds = new Set(entries.map((entry) => entry.provenanceId))
  const isSynthetic = bundle.dataKind === 'synthetic'
  const itemsById = new Map((bundle.items as PublicItem[]).map((item) => [item.id, item]))
  const provenanceById = new Map(entries.map((entry) => [entry.provenanceId, entry]))
  if (isSynthetic) {
    if (entries.some((entry) => !entry.sourceId.startsWith('synthetic:') || entry.itemIds.length > 0 || entry.canonicalUrls.length > 0)) return null
  } else if (entries.some((entry) => !sourceIds.has(entry.sourceId) || entry.itemIds.length === 0 || entry.canonicalUrls.length === 0 || entry.itemIds.some((itemId) => {
    const referenced = itemsById.get(itemId)
    return !referenced || referenced.sourceId !== entry.sourceId || referenced.provenanceId !== entry.provenanceId || !entry.canonicalUrls.includes(referenced.canonicalUrl)
  }))) return null
  if ((bundle.items as PublicItem[]).some((item) => {
    const entry = provenanceById.get(item.provenanceId)
    return !sourceIds.has(item.sourceId) || !entry || entry.sourceId !== item.sourceId ||
      !entry.itemIds.includes(item.id) || !entry.canonicalUrls.includes(item.canonicalUrl)
  })) return null
  if ((bundle.signals as InterestSignal[]).some((signal) => signal.provenanceIds.some((provenanceId) => !provenanceIds.has(provenanceId)))) return null
  if ((bundle.observations as TileObservation[]).some((observation) => observation.provenanceManifestId !== bundle.provenance.id)) return null
  if ((bundle.signals as InterestSignal[]).some((signal) => (signal.sourceType === 'synthetic') !== isSynthetic)) return null
  if (isSynthetic && ((bundle.sources as PublicSourceRecord[]).length > 0 || (bundle.items as PublicItem[]).length > 0)) return null
  const topicIds = new Set((bundle.signals as InterestSignal[]).map((signal) => signal.topicId))
  if ((bundle.bands as ContractFrequencyBand[]).some((frequencyBand) => frequencyBand.topicIds.some((topicId) => !topicIds.has(topicId)))) return null
  return bundle as unknown as PublicTileBundle
}
