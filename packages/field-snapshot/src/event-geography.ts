import { isUtcTimestamp, parsePublicItem, parsePublicSourceRecord, type PublicItem, type PublicSourceRecord } from './interest-contract'
import { parseFeedHistorySnapshot, type FeedHistorySnapshot } from './feed-history'

export interface PlaceCandidate {
  id: string
  name: string
  kind: 'country' | 'admin1' | 'admin2' | 'populated-place'
  precision: 'country' | 'admin1-point' | 'admin2-point' | 'populated-place-point'
  latitude?: number
  longitude?: number
}

export type PlaceLookupResult =
  | { status: 'resolved'; place: PlaceCandidate; coverage: 'catalog-scope' }
  | { status: 'ambiguous'; candidates: PlaceCandidate[]; coverage: 'catalog-scope' }
  | { status: 'not-found'; coverage: 'catalog-scope' | 'country-not-in-catalog'; scope: string }
  | { status: 'unsupported-country'; countryCode: string; coverage: 'country-not-in-catalog'; scope: string }

/** Inject the place catalog here; this module has no network or gazetteer-loading behavior. */
export interface PlaceNameLookup { lookup(name: string): PlaceLookupResult }
export interface PublicItemObservation { item: unknown; observedAt: string; publicationStatus?: 'valid' | 'missing' | 'future' }
export interface SourceGroupInput { sourceId: string; independentPublisherGroupId: string }
export type LocationMentionAnnotation = {
  kind: 'place-mention'
  itemId: string
  field: 'title' | 'publisherName'
  start: number
  end: number
  ruleId: string
  relation: 'about_location' | 'publisher_location' | 'unknown'
  confidence: number
}
export type GlobalScopeAnnotation = {
  kind: 'global-scope'
  itemId: string
  field: 'title'
  start: number
  end: number
  ruleId: string
  confidence: number
}
export type GeographyAnnotation = LocationMentionAnnotation | GlobalScopeAnnotation
export interface ReviewedEventMapping {
  mappingId: string
  eventId: string
  itemIds: string[]
  kind: 'same-event' | 'cross-language-alias'
  evidenceRef: string
}
export interface EventGeographyOptions {
  /** Rule IDs permitted to assert subject geography from title spans. */
  approvedAboutLocationRuleIds?: string[]
  /** Rule IDs permitted to assert global scope from explicit spans. */
  approvedGlobalRuleIds?: string[]
  /** Publisher-name text for history snapshots, whose health metadata omits names. */
  publisherNames?: Record<string, string>
  reviewedMappings?: ReviewedEventMapping[]
}

export interface ResolvedLocationAnchor {
  placeId: string
  latitude?: number
  longitude?: number
  /** Gazetteer precision is retained; this record never invents a radius or neighborhood polygon. */
  precision: PlaceCandidate['precision'] | 'contract-radius'
  radiusKm?: number
  confidence: number
}
export interface EventLocationEvidence {
  itemId: string
  field: 'title' | 'publisherName' | 'contract-aboutLocations'
  start?: number
  end?: number
  matchedText?: string
  ruleId: string
  relation: 'about_location' | 'publisher_location' | 'unknown'
  confidence: number
  resolution: 'resolved' | 'ambiguous' | 'not-found' | 'unsupported-country' | 'not-looked-up'
  candidatePlaceIds: string[]
  coverage?: string
  scope?: string
}
export interface ItemGeographyResult {
  itemId: string
  eventId: string
  topicIds: string[]
  observedAt: string
  publicationStatus: 'valid' | 'missing' | 'future'
  eventAt?: string
  anchors: ResolvedLocationAnchor[]
  evidence: EventLocationEvidence[]
  geography: 'localized' | 'ambiguous' | 'global' | 'unknown'
}
interface IndexedEvidence { evidence: EventLocationEvidence; anchor?: ResolvedLocationAnchor }
export interface PublicEventGeography {
  schemaVersion: 'intoponet.event-geography.v1'
  events: Array<{
    eventId: string
    itemIds: string[]
    topicIds: string[]
    eventAt?: string
    geography: 'localized' | 'ambiguous' | 'global' | 'unknown'
    anchors: ResolvedLocationAnchor[]
    evidence: EventLocationEvidence[]
    distributingPublisherGroupIds: string[]
    /** Exact canonical/syndication content lineages; not an independent-origin claim. */
    deduplicatedReportLineageCount: number
    /** Original publisher/authorship and independent origin are not established here. */
    originAttribution: 'unknown'
    lineageEvidence: string[]
  }>
  items: ItemGeographyResult[]
}

const MAX_ITEMS = 20_000
const MAX_ANNOTATIONS = 50_000
const MAX_ENRICHMENT_BYTES = 32_000_000
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const sortedUnique = (values: string[]) => [...new Set(values)].sort(compare)
function hasExactKeys(value: unknown, keys: string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => actual.includes(key))
}
function hasAllowedKeys(value: unknown, required: string[], optional: string[] = []): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value)
  return required.every(key => actual.includes(key)) && actual.every(key => [...required, ...optional].includes(key))
}

function validId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`Invalid ${label}`)
}
function normalizeTimestamp(value: unknown, label: string): string {
  if (!isUtcTimestamp(value)) throw new TypeError(`${label} must be a valid UTC timestamp`)
  return new Date(Date.parse(value)).toISOString()
}
function canonicalUrl(item: PublicItem): string {
  const url = new URL(item.canonicalUrl)
  url.hash = ''
  return url.href
}
export function sha256Hex(value: string): string {
  const bytes = new TextEncoder().encode(value)
  const constants = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ]
  const bitLength = bytes.length * 8
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000))
  view.setUint32(paddedLength - 4, bitLength >>> 0)
  const hash = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]
  const rotate = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = new Uint32Array(64)
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15]!; const y = words[i - 2]!
      const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)
      const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10)
      words[i] = (words[i - 16]! + s0 + words[i - 7]! + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = hash
    for (let i = 0; i < 64; i++) {
      const s1 = rotate(e!, 6) ^ rotate(e!, 11) ^ rotate(e!, 25)
      const choice = (e! & f!) ^ (~e! & g!)
      const temp1 = (h! + s1 + choice + constants[i]! + words[i]!) >>> 0
      const s0 = rotate(a!, 2) ^ rotate(a!, 13) ^ rotate(a!, 22)
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!)
      const temp2 = (s0 + majority) >>> 0
      h = g; g = f; f = e; e = (d! + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0
    }
    hash[0] = (hash[0]! + a!) >>> 0; hash[1] = (hash[1]! + b!) >>> 0
    hash[2] = (hash[2]! + c!) >>> 0; hash[3] = (hash[3]! + d!) >>> 0
    hash[4] = (hash[4]! + e!) >>> 0; hash[5] = (hash[5]! + f!) >>> 0
    hash[6] = (hash[6]! + g!) >>> 0; hash[7] = (hash[7]! + h!) >>> 0
  }
  return hash.map(word => word.toString(16).padStart(8, '0')).join('')
}
function validatePlaceCandidate(value: PlaceCandidate): PlaceCandidate {
  validId(value.id, 'place ID')
  if (!value.name || value.name.length > 512 || !['country', 'admin1', 'admin2', 'populated-place'].includes(value.kind) ||
    !['country', 'admin1-point', 'admin2-point', 'populated-place-point'].includes(value.precision)) throw new TypeError('Invalid place candidate')
  const hasLat = value.latitude !== undefined; const hasLon = value.longitude !== undefined
  if (hasLat !== hasLon || (hasLat && (!Number.isFinite(value.latitude) || value.latitude! < -90 || value.latitude! > 90 ||
    !Number.isFinite(value.longitude) || value.longitude! < -180 || value.longitude! > 180))) throw new TypeError('Invalid place candidate coordinates')
  return { ...value }
}

function validateLookup(result: PlaceLookupResult): PlaceLookupResult {
  if (!result || typeof result !== 'object') throw new TypeError('Place lookup returned an invalid result')
  if (result.status === 'resolved') return { ...result, place: validatePlaceCandidate(result.place) }
  if (result.status === 'ambiguous') {
    if (!Array.isArray(result.candidates) || result.candidates.length > 1_000) throw new RangeError('Ambiguous place candidate limit exceeded')
    return { ...result, candidates: result.candidates.map(validatePlaceCandidate).sort((a, b) => compare(a.id, b.id)) }
  }
  if (result.status === 'not-found' || result.status === 'unsupported-country') return { ...result }
  throw new TypeError('Place lookup returned an unsupported status')
}

function relationFor(annotation: LocationMentionAnnotation, approved: Set<string>): LocationMentionAnnotation['relation'] {
  if (annotation.field === 'publisherName') return 'publisher_location'
  if (annotation.relation === 'about_location' && !approved.has(annotation.ruleId)) return 'unknown'
  return annotation.relation
}

function validateAnnotations(
  annotations: GeographyAnnotation[],
  items: Map<string, PublicItem>,
  sourceNames: Map<string, string>,
  placeLookup: PlaceNameLookup,
  options: EventGeographyOptions,
): Map<string, IndexedEvidence[]> {
  if (annotations.length > MAX_ANNOTATIONS) throw new RangeError('Geography annotation limit exceeded')
  const byItem = new Map<string, IndexedEvidence[]>()
  const aboutRuleIds = new Set(options.approvedAboutLocationRuleIds ?? [])
  const globalRuleIds = new Set(options.approvedGlobalRuleIds ?? [])
  for (const ruleId of [...aboutRuleIds, ...globalRuleIds]) validId(ruleId, 'geography rule ID')
  for (const annotation of [...annotations].sort((a, b) => compare(a.itemId, b.itemId) || compare(a.field, b.field) || a.start - b.start || a.end - b.end || compare(a.ruleId, b.ruleId))) {
    const annotationKeys = annotation.kind === 'global-scope'
      ? ['kind', 'itemId', 'field', 'start', 'end', 'ruleId', 'confidence']
      : ['kind', 'itemId', 'field', 'start', 'end', 'ruleId', 'relation', 'confidence']
    if (!hasExactKeys(annotation, annotationKeys)) throw new TypeError('Geography annotations must contain only public evidence fields')
    validId(annotation.itemId, 'annotation item ID'); validId(annotation.ruleId, 'geography rule ID')
    const item = items.get(annotation.itemId)
    if (!item || !Number.isSafeInteger(annotation.start) || !Number.isSafeInteger(annotation.end) || annotation.start < 0 || annotation.end <= annotation.start ||
      !Number.isFinite(annotation.confidence) || annotation.confidence < 0 || annotation.confidence > 1) throw new TypeError('Invalid geography annotation span or confidence')
    const text = annotation.field === 'title' ? item.title : sourceNames.get(item.sourceId)
    if (text === undefined || annotation.end > text.length) throw new TypeError('Geography annotation span is outside its source text')
    const matchedText = text.slice(annotation.start, annotation.end)
    if (!matchedText.trim()) throw new TypeError('Geography annotation must reference a nonempty source span')
    if (annotation.kind === 'global-scope') {
      if (annotation.field !== 'title') throw new TypeError('Global scope evidence must be in the item title')
      const approved = globalRuleIds.has(annotation.ruleId)
      const evidence: EventLocationEvidence = { itemId: item.id, field: 'title', start: annotation.start, end: annotation.end,
        matchedText, ruleId: annotation.ruleId, relation: 'unknown', confidence: annotation.confidence,
        resolution: 'not-looked-up', candidatePlaceIds: [], scope: approved ? 'approved-global-rule' : 'global-rule-not-approved' }
      byItem.set(item.id, [...(byItem.get(item.id) ?? []), { evidence }])
      continue
    }
    if (!['about_location', 'publisher_location', 'unknown'].includes(annotation.relation)) throw new TypeError('Invalid location relation')
    if (annotation.field === 'publisherName' && annotation.relation === 'about_location') throw new TypeError('Publisher-name location cannot assert event subject geography')
    const relation = relationFor(annotation, aboutRuleIds)
    const resolution = validateLookup(placeLookup.lookup(matchedText))
    const evidence: EventLocationEvidence = {
      itemId: item.id,
      field: annotation.field,
      start: annotation.start,
      end: annotation.end,
      matchedText,
      ruleId: annotation.ruleId,
      relation,
      confidence: annotation.confidence,
      resolution: resolution.status,
      candidatePlaceIds: resolution.status === 'resolved' ? [resolution.place.id] : resolution.status === 'ambiguous' ? resolution.candidates.map(place => place.id) : [],
      ...('coverage' in resolution ? { coverage: resolution.coverage } : {}),
      ...('scope' in resolution ? { scope: resolution.scope } : {}),
    }
    let anchor: ResolvedLocationAnchor | undefined
    if (relation === 'about_location' && resolution.status === 'resolved' && resolution.place.latitude !== undefined) {
      const place = resolution.place
      anchor = { placeId: place.id, precision: place.precision, confidence: annotation.confidence,
        ...(place.latitude !== undefined ? { latitude: place.latitude, longitude: place.longitude } : {}) }
    }
    byItem.set(item.id, [...(byItem.get(item.id) ?? []), { evidence, ...(anchor ? { anchor } : {}) }])
  }
  return byItem
}

function buildEventGroups(
  items: PublicItem[],
  reviewedMappings: ReviewedEventMapping[],
): { groups: PublicItem[][]; eventIds: Map<string, string>; lineageEvidence: Map<string, string[]>; contentLineageIds: Map<string, string> } {
  const indices = new Map(items.map((item, index) => [item.id, index]))
  const parent = items.map((_item, index) => index)
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]!))
  const join = (a: number, b: number) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb) }
  const aliases = new Map<string, number>()
  const reviewedEventAliases = new Map<string, number>()
  const evidenceByItem = new Map<string, Set<string>>()
  const reviewedEventIdsByItem = new Map<string, Set<string>>()
  const contentParent = items.map((_item, index) => index)
  const findContent = (index: number): number => contentParent[index] === index ? index : (contentParent[index] = findContent(contentParent[index]!))
  const joinContent = (a: number, b: number) => { const ra = findContent(a); const rb = findContent(b); if (ra !== rb) contentParent[Math.max(ra, rb)] = Math.min(ra, rb) }
  const contentAliases = new Map<string, number>()
  for (const [index, item] of items.entries()) {
    const keys = [`canonical:${canonicalUrl(item)}`, ...(item.syndicationClusterId ? [`syndication:${item.syndicationClusterId}`] : [])]
    for (const key of keys) {
      const prior = aliases.get(key)
      if (prior === undefined) aliases.set(key, index)
      else join(index, prior)
      const contentPrior = contentAliases.get(key)
      if (contentPrior === undefined) contentAliases.set(key, index)
      else joinContent(index, contentPrior)
      evidenceByItem.set(item.id, new Set([...(evidenceByItem.get(item.id) ?? []), key.startsWith('canonical:') ? 'exact-canonical-url' : 'explicit-syndication-cluster']))
    }
  }
  if (!Array.isArray(reviewedMappings) || reviewedMappings.length > MAX_ITEMS) throw new RangeError('Reviewed event mapping limit exceeded')
  for (const mapping of [...reviewedMappings].sort((a, b) => compare(a.eventId, b.eventId) || compare(a.mappingId, b.mappingId))) {
    if (!hasExactKeys(mapping, ['mappingId', 'eventId', 'itemIds', 'kind', 'evidenceRef'])) throw new TypeError('Reviewed event mappings must contain only public evidence references')
    validId(mapping.mappingId, 'review mapping ID'); validId(mapping.eventId, 'review event ID')
    if (!['same-event', 'cross-language-alias'].includes(mapping.kind) || !ID.test(mapping.evidenceRef) ||
      !Array.isArray(mapping.itemIds) || mapping.itemIds.length < 2 || mapping.itemIds.length > 1000 || new Set(mapping.itemIds).size !== mapping.itemIds.length) throw new TypeError('Invalid reviewed event mapping')
    const memberIndices = mapping.itemIds.map(id => {
      validId(id, 'reviewed item ID')
      const index = indices.get(id)
      if (index === undefined) throw new TypeError(`Reviewed event mapping references unknown item ${id}`)
      return index
    })
    if (mapping.kind === 'cross-language-alias' && new Set(memberIndices.map(index => items[index]!.language)).size < 2) {
      throw new TypeError('Cross-language event mappings require multiple declared languages')
    }
    memberIndices.slice(1).forEach(index => join(memberIndices[0]!, index))
    const priorEventItem = reviewedEventAliases.get(mapping.eventId)
    if (priorEventItem === undefined) reviewedEventAliases.set(mapping.eventId, memberIndices[0]!)
    else join(priorEventItem, memberIndices[0]!)
    for (const id of mapping.itemIds) {
      evidenceByItem.set(id, new Set([...(evidenceByItem.get(id) ?? []), `reviewed:${mapping.mappingId}:${mapping.kind}:${mapping.evidenceRef}`]))
      reviewedEventIdsByItem.set(id, new Set([...(reviewedEventIdsByItem.get(id) ?? []), mapping.eventId]))
    }
  }
  const groupedIndices = new Map<number, number[]>()
  items.forEach((_item, index) => { const root = find(index); groupedIndices.set(root, [...(groupedIndices.get(root) ?? []), index]) })
  const groups: PublicItem[][] = []; const eventIds = new Map<string, string>(); const lineageEvidence = new Map<string, string[]>()
  for (const groupIndices of groupedIndices.values()) {
    const group = groupIndices.map(index => items[index]!).sort((a, b) => compare(a.id, b.id))
    const reviewedIds = sortedUnique(group.flatMap(item => [...(reviewedEventIdsByItem.get(item.id) ?? [])]))
    if (reviewedIds.length > 1) throw new TypeError('Conflicting reviewed event IDs inside one linked event lineage')
    const syndicationIds = sortedUnique(group.flatMap(item => item.syndicationClusterId ? [item.syndicationClusterId] : []))
    const canonicalUrls = sortedUnique(group.map(canonicalUrl))
    // Unclustered IDs are SHA-256 of canonical URL from the first observation, so adding
    // an identical-URL copy leaves the ID stable. Explicit syndication/review links create
    // a new shared lineage identity; reviewed IDs and cluster keys are never emitted raw.
    const eventId = reviewedIds.length ? `event:reviewed-${sha256Hex(reviewedIds[0]!)}`
      : syndicationIds.length ? `event:syndication-${sha256Hex(syndicationIds[0]!)}`
        : `event:url-${sha256Hex(canonicalUrls[0]!)}`
    groups.push(group)
    for (const item of group) {
      eventIds.set(item.id, eventId)
      lineageEvidence.set(item.id, [...(evidenceByItem.get(item.id) ?? [])].sort(compare))
    }
  }
  const contentLineageIds = new Map<string, string>()
  for (const groupIndices of groupedIndices.values()) {
    const roots = new Map<number, PublicItem[]>()
    for (const index of groupIndices) {
      const root = findContent(index)
      roots.set(root, [...(roots.get(root) ?? []), items[index]!])
    }
    for (const members of roots.values()) {
      const clusterIds = sortedUnique(members.flatMap(item => item.syndicationClusterId ? [item.syndicationClusterId] : []))
      const urls = sortedUnique(members.map(canonicalUrl))
      const contentId = clusterIds.length ? `syndication:${clusterIds[0]}` : members.length > 1 ? `canonical:${urls[0]}` : `item:${members[0]!.id}`
      for (const member of members) contentLineageIds.set(member.id, contentId)
    }
  }
  return { groups: groups.sort((a, b) => compare(eventIds.get(a[0]!.id)!, eventIds.get(b[0]!.id)!)), eventIds, lineageEvidence, contentLineageIds }
}

function publicationStatus(item: PublicItem, observedAt: string): ItemGeographyResult['publicationStatus'] {
  if (!item.publishedAt) return 'missing'
  return Date.parse(item.publishedAt) > Date.parse(observedAt) ? 'future' : 'valid'
}

/** Map normalized public items to transparent place/topic/event evidence; no NLP or network is used. */
export function mapPublicItemGeography(
  observations: PublicItemObservation[],
  sources: Array<SourceGroupInput | PublicSourceRecord>,
  annotations: GeographyAnnotation[],
  placeLookup: PlaceNameLookup,
  options: EventGeographyOptions = {},
): PublicEventGeography {
  if (!Array.isArray(observations) || observations.length > MAX_ITEMS || !Array.isArray(sources) || sources.length > 2_000 || !Array.isArray(annotations)) throw new RangeError('Event geography input exceeds bounds')
  if (!hasAllowedKeys(options, [], ['approvedAboutLocationRuleIds', 'approvedGlobalRuleIds', 'publisherNames', 'reviewedMappings'])) throw new TypeError('Unknown event geography option')
  let inputBytes: number
  try { inputBytes = new TextEncoder().encode(JSON.stringify({ observations, sources, annotations, options })).byteLength }
  catch { throw new TypeError('Event geography inputs must be bounded serializable public data') }
  if (inputBytes > MAX_ENRICHMENT_BYTES) throw new RangeError('Event geography input exceeds byte limit')
  const items = observations.map(row => {
    if (!hasAllowedKeys(row, ['item', 'observedAt'], ['publicationStatus'])) throw new TypeError('Invalid public item observation fields')
    const item = parsePublicItem(row.item)
    if (!item) throw new TypeError('Invalid public item; private or unknown fields are not accepted')
    const observedAt = normalizeTimestamp(row.observedAt, 'observedAt')
    const derivedStatus = publicationStatus(item, observedAt)
    if (row.publicationStatus !== undefined && row.publicationStatus !== derivedStatus) throw new TypeError('Supplied publication status conflicts with publishedAt and observedAt')
    return { item, observedAt, publicationStatus: derivedStatus }
  }).sort((a, b) => compare(a.item.id, b.item.id))
  if (new Set(items.map(row => row.item.id)).size !== items.length) throw new TypeError('Duplicate public item IDs')
  const itemsById = new Map(items.map(row => [row.item.id, row.item]))
  const sourceNames = new Map<string, string>()
  const sourceGroups = new Map<string, string>()
  for (const unknownSource of sources) {
    const source = parsePublicSourceRecord(unknownSource)
    if (!source && !hasExactKeys(unknownSource, ['sourceId', 'independentPublisherGroupId'])) throw new TypeError('Invalid public source identity fields')
    const sourceId = source?.sourceId ?? (unknownSource as SourceGroupInput).sourceId
    const publisherGroup = source?.independentPublisherGroupId ?? (unknownSource as SourceGroupInput).independentPublisherGroupId
    validId(sourceId, 'source ID'); validId(publisherGroup, 'publisher group ID')
    if (sourceGroups.has(sourceId)) throw new TypeError(`Duplicate source metadata ${sourceId}`)
    sourceGroups.set(sourceId, publisherGroup)
    if (source) sourceNames.set(sourceId, source.publisherName)
  }
  for (const [sourceId, publisherName] of Object.entries(options.publisherNames ?? {})) {
    validId(sourceId, 'source ID')
    if (typeof publisherName !== 'string' || publisherName.length === 0 || publisherName.length > 512) throw new TypeError('Invalid configured publisher name')
    sourceNames.set(sourceId, publisherName)
  }
  for (const { item } of items) if (!sourceGroups.has(item.sourceId)) throw new TypeError(`Missing public source identity ${item.sourceId}`)
  const indexedEvidence = validateAnnotations(annotations, itemsById, sourceNames, placeLookup, options)

  const { groups, eventIds, lineageEvidence, contentLineageIds } = buildEventGroups(items.map(row => row.item), options.reviewedMappings ?? [])
  const itemResults = items.map(({ item, observedAt, publicationStatus: suppliedPublicationStatus }) => {
    const indexed = [...(indexedEvidence.get(item.id) ?? [])]
    const evidence = indexed.map(entry => entry.evidence)
    const anchors: ResolvedLocationAnchor[] = []
    for (const location of item.aboutLocations) {
      anchors.push({ placeId: location.placeId, latitude: location.lat, longitude: location.lon, radiusKm: location.radiusKm, confidence: location.confidence, precision: 'contract-radius' })
      evidence.push({ itemId: item.id, field: 'contract-aboutLocations', ruleId: 'public-item-about-location', relation: 'about_location', confidence: location.confidence, resolution: 'not-looked-up', candidatePlaceIds: [location.placeId] })
    }
    anchors.push(...indexed.flatMap(entry => entry.anchor ? [entry.anchor] : []))
    const approvedGlobal = evidence.some(row => row.scope === 'approved-global-rule')
    const ambiguous = evidence.some(row => row.relation === 'about_location' && row.resolution === 'ambiguous')
    const resolvedAboutPlace = evidence.some(row => row.relation === 'about_location' && row.resolution === 'resolved')
    const hasNormalizedContractLocation = item.aboutLocations.length > 0
    const hasSubjectLocation = resolvedAboutPlace || hasNormalizedContractLocation
    const geography = ambiguous || (approvedGlobal && hasSubjectLocation) ? 'ambiguous' : hasSubjectLocation ? 'localized' : approvedGlobal ? 'global' : 'unknown'
    return {
      itemId: item.id,
      eventId: eventIds.get(item.id)!,
      topicIds: sortedUnique(item.topicIds),
      observedAt,
      publicationStatus: suppliedPublicationStatus ?? publicationStatus(item, observedAt),
      ...(item.publishedAt ? { eventAt: normalizeTimestamp(item.publishedAt, 'publishedAt') } : {}),
      anchors: anchors.sort((a, b) => compare(a.placeId, b.placeId)),
      evidence: evidence.sort((a, b) => compare(a.field, b.field) || (a.start ?? -1) - (b.start ?? -1) || compare(a.ruleId, b.ruleId)),
      geography,
    } satisfies ItemGeographyResult
  })

  const itemResultsById = new Map(itemResults.map(result => [result.itemId, result]))
  const eventResults = groups.map(group => {
    const groupItems = group.map(item => itemResultsById.get(item.id)!)
    const anchors = groupItems.flatMap(result => result.anchors)
    const evidence = groupItems.flatMap(result => result.evidence)
    const states = new Set(groupItems.map(result => result.geography))
    const geography: ItemGeographyResult['geography'] = states.has('ambiguous') || (states.has('global') && states.size > 1) ? 'ambiguous'
      : states.has('localized') ? 'localized' : states.has('global') ? 'global' : 'unknown'
    const dates = groupItems.filter(result => result.publicationStatus === 'valid' && result.eventAt).map(result => result.eventAt!).sort((a, b) => Date.parse(a) - Date.parse(b))
    const eventId = eventIds.get(group[0]!.id)!
    return {
      eventId,
      itemIds: group.map(item => item.id).sort(compare),
      topicIds: sortedUnique(group.flatMap(item => item.topicIds)),
      ...(dates.length ? { eventAt: dates[0] } : {}),
      geography,
      anchors: uniqueAnchors(anchors),
      evidence: evidence.sort((a, b) => compare(a.itemId, b.itemId) || compare(a.field, b.field) || (a.start ?? -1) - (b.start ?? -1)),
      distributingPublisherGroupIds: sortedUnique(group.map(item => sourceGroups.get(item.sourceId)!)),
      deduplicatedReportLineageCount: new Set(group.map(item => contentLineageIds.get(item.id)!)).size,
      originAttribution: 'unknown' as const,
      lineageEvidence: sortedUnique(group.flatMap(item => lineageEvidence.get(item.id) ?? [])),
    }
  })
  return { schemaVersion: 'intoponet.event-geography.v1', events: eventResults, items: itemResults }
}

function uniqueAnchors(anchors: ResolvedLocationAnchor[]): ResolvedLocationAnchor[] {
  const byKey = new Map<string, ResolvedLocationAnchor>()
  for (const anchor of anchors) {
    const key = `${anchor.placeId}|${anchor.latitude ?? ''}|${anchor.longitude ?? ''}|${anchor.radiusKm ?? ''}`
    if (!byKey.has(key)) byKey.set(key, anchor)
  }
  return [...byKey.values()].sort((a, b) => compare(a.placeId, b.placeId) || (a.latitude ?? 0) - (b.latitude ?? 0))
}

/** Convenience adapter for an already validated public history snapshot. */
export function mapPublicHistoryGeography(
  history: FeedHistorySnapshot,
  annotations: GeographyAnnotation[],
  placeLookup: PlaceNameLookup,
  options: EventGeographyOptions = {},
): PublicEventGeography {
  const snapshot = parseFeedHistorySnapshot(history)
  if (!snapshot) throw new TypeError('Invalid public feed history snapshot')
  return mapPublicItemGeography(
    snapshot.items.map(entry => ({ item: entry.item, observedAt: entry.latestItemObservedAt, publicationStatus: entry.publicationStatus })),
    snapshot.sources,
    annotations,
    placeLookup,
    options,
  )
}

