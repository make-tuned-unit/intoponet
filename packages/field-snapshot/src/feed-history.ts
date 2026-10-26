import {
  isUtcTimestamp,
  parsePublicItem,
  parsePublicSourceRecord,
  type FeedHealth,
  type PublicItem,
  type PublicSourceRecord,
} from './interest-contract'

export interface ItemObservation { observedAt: string; item: unknown }
export interface SourceObservation { observedAt: string; source: unknown }
export interface FeedHistoryBatch { items: ItemObservation[]; sources: SourceObservation[] }
export interface FeedHistoryConfig {
  /** Default rolling public metadata retention: 30 days. */
  retentionDays?: number
  /** Optional source-specific retention overrides for sources with shorter published terms. */
  retentionDaysBySource?: Record<string, number>
  maxItems?: number
  maxSources?: number
  maxRevisionsPerItem?: number
}
export interface ItemRevision { sourceContentHash: string; observedAt: string }
export interface FeedHistoryItem {
  item: PublicItem
  firstSeenAt: string
  lastSeenAt: string
  latestItemObservedAt: string
  latestVersionAt: string
  publicationStatus: 'valid' | 'missing' | 'future'
  revisions: ItemRevision[]
  revisionCount: number
}
export interface FeedSourceHealth {
  sourceId: string
  independentPublisherGroupId: string
  health: FeedHealth
  observedAt: string
  lastSuccessfulFetchAt?: string
}
export interface FeedHistorySnapshot {
  schemaVersion: '1.0'
  asOf: string | null
  items: FeedHistoryItem[]
  sources: FeedSourceHealth[]
}
export interface ActivityLineage {
  lineageId: string
  publishedAt: string
  itemIds: string[]
  topicIds: string[]
  distributingPublisherGroupIds: string[]
  /** One deduplicated lineage; GeoNames/RSS metadata does not establish the original author. */
  qualifiedIndependentOriginCount: 1
  originAttribution: 'unknown'
}

const DEFAULTS: Required<FeedHistoryConfig> = {
  retentionDays: 30,
  retentionDaysBySource: {},
  maxItems: 20_000,
  maxSources: 2_000,
  maxRevisionsPerItem: 8,
}
export const FEED_HISTORY_LIMITS = { snapshotBytes: 32_000_000, replayObservations: 100_000 } as const

function configOf(config: FeedHistoryConfig = {}): Required<FeedHistoryConfig> {
  const result = { ...DEFAULTS, ...config }
  for (const name of ['retentionDays', 'maxItems', 'maxSources', 'maxRevisionsPerItem'] as const) {
    const value = result[name]
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a finite positive integer`)
  }
  if (result.retentionDaysBySource === null || typeof result.retentionDaysBySource !== 'object' || Array.isArray(result.retentionDaysBySource)) throw new TypeError('retentionDaysBySource must be a source ID map')
  for (const [sourceId, days] of Object.entries(result.retentionDaysBySource)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(sourceId) || !Number.isSafeInteger(days) || days <= 0) throw new RangeError('Per-source retention requires source IDs and finite positive integer days')
  }
  if (result.maxItems > 20_000 || result.maxSources > 2_000 || result.maxRevisionsPerItem > 64) throw new RangeError('History limits exceed public contract bounds')
  return result
}

function timestamp(value: unknown, label: string): string {
  if (!isUtcTimestamp(value)) throw new TypeError(`${label} must be a valid UTC timestamp`)
  return new Date(Date.parse(value)).toISOString()
}

function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0 }
function compareObservation(a: ItemObservation, b: ItemObservation): number {
  const left = parsePublicItem(a.item); const right = parsePublicItem(b.item)
  return compareText(a.observedAt, b.observedAt) || compareText(left?.id ?? '', right?.id ?? '') || compareText(left?.sourceContentHash ?? '', right?.sourceContentHash ?? '') || compareText(JSON.stringify(left), JSON.stringify(right))
}
function compareSourceObservation(a: SourceObservation, b: SourceObservation): number {
  const left = parsePublicSourceRecord(a.source); const right = parsePublicSourceRecord(b.source)
  return compareText(a.observedAt, b.observedAt) || compareText(left?.sourceId ?? '', right?.sourceId ?? '') || compareText(JSON.stringify(left), JSON.stringify(right))
}

export function emptyFeedHistory(): FeedHistorySnapshot {
  return { schemaVersion: '1.0', asOf: null, items: [], sources: [] }
}

const MAX_HISTORY_JSON_BYTES = FEED_HISTORY_LIMITS.snapshotBytes
function exactKeys(value: unknown, required: string[], optional: string[] = []): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return required.every(key => keys.includes(key)) && keys.every(key => [...required, ...optional].includes(key))
}

export function parseFeedHistorySnapshot(value: unknown): FeedHistorySnapshot | null {
  let encoded: string
  try {
    encoded = typeof value === 'string' ? value : JSON.stringify(value)
    if (typeof encoded !== 'string' || new TextEncoder().encode(encoded).byteLength > MAX_HISTORY_JSON_BYTES) return null
  } catch { return null }
  let raw: unknown
  try { raw = JSON.parse(encoded) } catch { return null }
  if (!exactKeys(raw, ['schemaVersion', 'asOf', 'items', 'sources']) || raw.schemaVersion !== '1.0' ||
    (raw.asOf !== null && !isUtcTimestamp(raw.asOf)) || !Array.isArray(raw.items) || raw.items.length > 20_000 ||
    !Array.isArray(raw.sources) || raw.sources.length > 2_000) return null
  const items: FeedHistoryItem[] = []
  for (const entry of raw.items) {
    if (!exactKeys(entry, ['item', 'firstSeenAt', 'lastSeenAt', 'latestItemObservedAt', 'latestVersionAt', 'publicationStatus', 'revisions', 'revisionCount'])) return null
    const item = parsePublicItem(entry.item)
    if (!item || !isUtcTimestamp(entry.firstSeenAt) || !isUtcTimestamp(entry.lastSeenAt) || !isUtcTimestamp(entry.latestItemObservedAt) ||
      !isUtcTimestamp(entry.latestVersionAt) || Date.parse(entry.firstSeenAt) > Date.parse(entry.lastSeenAt) ||
      Date.parse(entry.latestItemObservedAt as string) > Date.parse(entry.lastSeenAt as string) ||
      !['valid', 'missing', 'future'].includes(String(entry.publicationStatus)) ||
      !Number.isSafeInteger(entry.revisionCount) || (entry.revisionCount as number) < 0 || !Array.isArray(entry.revisions) || entry.revisions.length > 64) return null
    const revisions: ItemRevision[] = []
    for (const revision of entry.revisions) {
      if (!exactKeys(revision, ['sourceContentHash', 'observedAt']) || typeof revision.sourceContentHash !== 'string' ||
        !/^[a-fA-F0-9]{32,128}$/.test(revision.sourceContentHash) || !isUtcTimestamp(revision.observedAt)) return null
      revisions.push({ sourceContentHash: revision.sourceContentHash, observedAt: timestamp(revision.observedAt, 'revision observedAt') })
    }
    const expectedStatus = item.publishedAt === undefined ? 'missing' : Date.parse(item.publishedAt) > Date.parse(entry.latestItemObservedAt as string) ? 'future' : 'valid'
    if (entry.publicationStatus !== expectedStatus) return null
    items.push({ item, firstSeenAt: timestamp(entry.firstSeenAt, 'firstSeenAt'), lastSeenAt: timestamp(entry.lastSeenAt, 'lastSeenAt'),
      latestItemObservedAt: timestamp(entry.latestItemObservedAt, 'latestItemObservedAt'), latestVersionAt: timestamp(entry.latestVersionAt, 'latestVersionAt'),
      publicationStatus: expectedStatus, revisions, revisionCount: entry.revisionCount as number })
  }
  const sources: FeedSourceHealth[] = []
  for (const source of raw.sources) {
    if (!exactKeys(source, ['sourceId', 'independentPublisherGroupId', 'health', 'observedAt'], ['lastSuccessfulFetchAt']) ||
      typeof source.sourceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(source.sourceId) ||
      typeof source.independentPublisherGroupId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(source.independentPublisherGroupId) ||
      !['healthy', 'stale', 'error', 'disabled'].includes(String(source.health)) || !isUtcTimestamp(source.observedAt) ||
      ('lastSuccessfulFetchAt' in source && !isUtcTimestamp(source.lastSuccessfulFetchAt))) return null
    sources.push({ sourceId: source.sourceId, independentPublisherGroupId: source.independentPublisherGroupId,
      health: source.health as FeedHealth, observedAt: timestamp(source.observedAt, 'source observedAt'),
      ...('lastSuccessfulFetchAt' in source ? { lastSuccessfulFetchAt: timestamp(source.lastSuccessfulFetchAt, 'lastSuccessfulFetchAt') } : {}) })
  }
  const sourceIds = new Set(sources.map(source => source.sourceId))
  if (items.some(item => !sourceIds.has(item.item.sourceId) || (raw.asOf !== null && Date.parse(item.lastSeenAt) > Date.parse(raw.asOf as string))) ||
    sources.some(source => raw.asOf !== null && Date.parse(source.observedAt) > Date.parse(raw.asOf as string))) return null
  if (items.some((entry, index) => index > 0 && items[index - 1]!.item.id >= entry.item.id) ||
    sources.some((entry, index) => index > 0 && sources[index - 1]!.sourceId >= entry.sourceId)) return null
  return { schemaVersion: '1.0', asOf: raw.asOf === null ? null : timestamp(raw.asOf, 'asOf'), items, sources }
}

function copySnapshot(state: FeedHistorySnapshot): FeedHistorySnapshot {
  const snapshot = parseFeedHistorySnapshot(state)
  if (!snapshot) throw new TypeError('Invalid public feed history snapshot')
  return snapshot
}

/** Apply one public-only observation batch. Inputs are parsed through closed allow-list contracts. */
export function reduceFeedHistory(
  previous: FeedHistorySnapshot,
  batch: FeedHistoryBatch,
  config?: FeedHistoryConfig,
): FeedHistorySnapshot {
  const limits = configOf(config)
  const state = copySnapshot(previous)
  if (batch === null || typeof batch !== 'object' || !exactKeys(batch, ['items', 'sources'])) throw new TypeError('Invalid feed history batch')
  if (!Array.isArray(batch.items) || batch.items.length > 20_000 || !Array.isArray(batch.sources) || batch.sources.length > 2_000) {
    throw new RangeError('Feed history batch exceeds public contract bounds')
  }
  const batchBytes = new TextEncoder().encode(JSON.stringify(batch)).byteLength
  if (batchBytes > MAX_HISTORY_JSON_BYTES) throw new RangeError('Feed history batch exceeds byte limit')

  const sourceMap = new Map(state.sources.map(source => [source.sourceId, source]))
  for (const observed of [...batch.sources].sort(compareSourceObservation)) {
    const record: PublicSourceRecord | null = parsePublicSourceRecord(observed.source)
    if (!record) throw new TypeError('Invalid public source record')
    if (!exactKeys(observed, ['observedAt', 'source'])) throw new TypeError('Invalid source observation fields')
    const observedAt = timestamp(observed.observedAt, 'source observedAt')
    const prior = sourceMap.get(record.sourceId)
    if (prior && prior.independentPublisherGroupId !== record.independentPublisherGroupId) {
      throw new TypeError(`Publisher group identity changed for ${record.sourceId}; use a new source identity or reviewed migration`)
    }
    const lastSuccessfulFetchAt = record.lastSuccessfulFetchAt ?? prior?.lastSuccessfulFetchAt
    const candidateHealth: FeedSourceHealth = {
      sourceId: record.sourceId,
      independentPublisherGroupId: record.independentPublisherGroupId,
      health: record.health,
      observedAt,
      ...(lastSuccessfulFetchAt ? { lastSuccessfulFetchAt: timestamp(lastSuccessfulFetchAt, 'lastSuccessfulFetchAt') } : {}),
    }
    if (!prior || observedAt > prior.observedAt || (observedAt === prior.observedAt && compareText(JSON.stringify(candidateHealth), JSON.stringify(prior)) > 0)) {
      sourceMap.set(record.sourceId, candidateHealth)
    }
    state.asOf = state.asOf && state.asOf > observedAt ? state.asOf : observedAt
  }

  const itemMap = new Map(state.items.map(entry => [entry.item.id, entry]))
  for (const observed of [...batch.items].sort(compareObservation)) {
    if (!exactKeys(observed, ['observedAt', 'item'])) throw new TypeError('Invalid item observation fields')
    const item = parsePublicItem(observed.item)
    if (!item) throw new TypeError('Invalid public item; private or unknown fields are not accepted')
    const observedAt = timestamp(observed.observedAt, 'item observedAt')
    if (!sourceMap.has(item.sourceId)) throw new TypeError(`Missing declared source and publisher group for ${item.sourceId}`)
    const prior = itemMap.get(item.id)
    if (prior && prior.item.sourceId !== item.sourceId) throw new TypeError(`Item ID ${item.id} changed source identity`)
    const firstSeenAt = prior && prior.firstSeenAt < observedAt ? prior.firstSeenAt : observedAt
    const lastSeenAt = prior && prior.lastSeenAt > observedAt ? prior.lastSeenAt : observedAt
    let latestItem = prior?.item ?? item
    const versionAt = item.updatedAt ? timestamp(item.updatedAt, 'item updatedAt') : observedAt
    let latestObservedAt = prior?.latestItemObservedAt ?? observedAt
    let latestVersionAt = prior?.latestVersionAt ?? versionAt
    const latestOrder = prior?.latestVersionAt ?? latestVersionAt
    if (Date.parse(versionAt) > Date.parse(latestOrder) || (versionAt === latestOrder &&
      (compareText(item.sourceContentHash, latestItem.sourceContentHash) > 0 || (item.sourceContentHash === latestItem.sourceContentHash && compareText(JSON.stringify(item), JSON.stringify(latestItem)) > 0)))) {
      latestItem = item
      latestObservedAt = observedAt
      latestVersionAt = versionAt
    }
    const revisions = prior ? [...prior.revisions] : []
    const hashKnown = revisions.some(revision => revision.sourceContentHash === item.sourceContentHash)
    if (!hashKnown) revisions.push({ sourceContentHash: item.sourceContentHash, observedAt })
    revisions.sort((a, b) => compareText(a.observedAt, b.observedAt) || compareText(a.sourceContentHash, b.sourceContentHash))
    const keptRevisions = revisions.slice(-limits.maxRevisionsPerItem)
    itemMap.set(item.id, {
      item: latestItem,
      firstSeenAt,
      lastSeenAt,
      latestItemObservedAt: latestObservedAt,
      latestVersionAt,
      publicationStatus: latestItem.publishedAt === undefined ? 'missing' : Date.parse(latestItem.publishedAt) > Date.parse(latestObservedAt) ? 'future' : 'valid',
      revisions: keptRevisions,
      revisionCount: (prior?.revisionCount ?? 0) + (hashKnown || !prior ? 0 : 1),
    })
    state.asOf = state.asOf && state.asOf > observedAt ? state.asOf : observedAt
  }

  const retainedSourceStates = [...sourceMap.values()]
    .sort((a, b) => compareText(b.observedAt, a.observedAt) || compareText(a.sourceId, b.sourceId))
    .slice(0, limits.maxSources)
    .sort((a, b) => compareText(a.sourceId, b.sourceId))
  const retainedSourceIds = new Set(retainedSourceStates.map(source => source.sourceId))
  const retainedItems = [...itemMap.values()]
    .filter(entry => retainedSourceIds.has(entry.item.sourceId))
    .filter(entry => state.asOf === null || Date.parse(entry.lastSeenAt) >= Date.parse(state.asOf) - (limits.retentionDaysBySource[entry.item.sourceId] ?? limits.retentionDays) * 86_400_000)
    .sort((a, b) => compareText(b.lastSeenAt, a.lastSeenAt) || compareText(a.item.id, b.item.id))
    .slice(0, limits.maxItems)
    .sort((a, b) => compareText(a.item.id, b.item.id))
  return { schemaVersion: '1.0', asOf: state.asOf, items: retainedItems, sources: retainedSourceStates }
}

/** Return a detached serializable snapshot suitable for persistence and deterministic replay. */
export function snapshotFeedHistory(state: FeedHistorySnapshot): FeedHistorySnapshot { return copySnapshot(state) }

/**
 * Replay at most 100,000 observations in bounded reducer chunks. Inputs are sorted globally
 * first, so callers may provide ordinary multi-day poll batches without hitting per-batch caps.
 */
export function replayFeedHistory(batches: FeedHistoryBatch[], config?: FeedHistoryConfig): FeedHistorySnapshot {
  const events: Array<{ at: string; kind: 'source' | 'item'; id: string; value: SourceObservation | ItemObservation }> = []
  for (const batch of batches) {
    if (batch === null || typeof batch !== 'object' || !exactKeys(batch, ['items', 'sources']) || !Array.isArray(batch.items) || !Array.isArray(batch.sources)) throw new TypeError('Invalid replay batch')
    for (const source of batch.sources) {
      if (!exactKeys(source, ['observedAt', 'source'])) throw new TypeError('Invalid source observation fields')
      const record = parsePublicSourceRecord(source.source)
      if (!record) throw new TypeError('Invalid public source record')
      events.push({ at: timestamp(source.observedAt, 'source observedAt'), kind: 'source', id: record.sourceId, value: source })
    }
    for (const item of batch.items) {
      if (!exactKeys(item, ['observedAt', 'item'])) throw new TypeError('Invalid item observation fields')
      const record = parsePublicItem(item.item)
      if (!record) throw new TypeError('Invalid public item')
      events.push({ at: timestamp(item.observedAt, 'item observedAt'), kind: 'item', id: record.id, value: item })
    }
    if (events.length > FEED_HISTORY_LIMITS.replayObservations) throw new RangeError(`Replay exceeds ${FEED_HISTORY_LIMITS.replayObservations} observations`)
  }
  events.sort((a, b) => compareText(a.at, b.at) || (a.kind === b.kind ? 0 : a.kind === 'source' ? -1 : 1) || compareText(a.id, b.id) || compareText(JSON.stringify(a.value), JSON.stringify(b.value)))
  let state = emptyFeedHistory()
  let chunk: FeedHistoryBatch = { sources: [], items: [] }
  let chunkBytes = 2
  const flush = () => {
    if (chunk.sources.length || chunk.items.length) state = reduceFeedHistory(state, chunk, config)
    chunk = { sources: [], items: [] }
    chunkBytes = 2
  }
  for (const event of events) {
    const eventBytes = new TextEncoder().encode(JSON.stringify(event.value)).byteLength + 64
    if ((event.kind === 'source' && chunk.sources.length >= 2_000) || (event.kind === 'item' && chunk.items.length >= 20_000) || chunkBytes + eventBytes > MAX_HISTORY_JSON_BYTES) flush()
    if (event.kind === 'source') chunk.sources.push(event.value as SourceObservation)
    else chunk.items.push(event.value as ItemObservation)
    chunkBytes += eventBytes
  }
  flush()
  return state
}

function canonicalLineageKey(item: PublicItem): string {
  const url = new URL(item.canonicalUrl)
  url.hash = ''
  return `url:${url.href}`
}

/** Deduplicate only exact canonical URLs and explicit syndication cluster IDs; similar titles are not linked. */
export function activityLineages(input: FeedHistorySnapshot): ActivityLineage[] {
  const state = copySnapshot(input)
  const sources = new Map(state.sources.map(source => [source.sourceId, source]))
  const entries = state.items.filter(entry => entry.publicationStatus === 'valid' && entry.item.publishedAt !== undefined &&
    state.asOf !== null && Date.parse(entry.item.publishedAt) <= Date.parse(state.asOf!))
  const parent = entries.map((_entry, index) => index)
  const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]!))
  const join = (a: number, b: number) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb) }
  const aliases = new Map<string, number>()
  entries.forEach((entry, index) => {
    const keys = [canonicalLineageKey(entry.item), ...(entry.item.syndicationClusterId ? [`syndication:${entry.item.syndicationClusterId}`] : [])]
    for (const key of keys) {
      const prior = aliases.get(key)
      if (prior === undefined) aliases.set(key, index)
      else join(index, prior)
    }
  })
  const groups = new Map<number, FeedHistoryItem[]>()
  entries.forEach((entry, index) => {
    const root = find(index)
    groups.set(root, [...(groups.get(root) ?? []), entry])
  })
  return [...groups.values()].map(group => {
    const canonicalKeys = group.map(entry => canonicalLineageKey(entry.item)).sort()
    const clusterKeys = group.map(entry => entry.item.syndicationClusterId).filter((value): value is string => value !== undefined).sort()
    const lineageId = clusterKeys.length ? `syndication:${clusterKeys[0]}` : canonicalKeys[0]!
    const validPublishedAt = group.map(entry => entry.item.publishedAt!).sort((a, b) => Date.parse(a) - Date.parse(b))[0]!
    return {
      lineageId,
      publishedAt: timestamp(validPublishedAt, 'publishedAt'),
      itemIds: [...new Set(group.map(entry => entry.item.id))].sort(),
      topicIds: [...new Set(group.flatMap(entry => entry.item.topicIds))].sort(),
      distributingPublisherGroupIds: [...new Set(group.map(entry => sources.get(entry.item.sourceId)?.independentPublisherGroupId).filter((value): value is string => value !== undefined))].sort(),
      qualifiedIndependentOriginCount: 1 as const,
      originAttribution: 'unknown' as const,
    }
  }).sort((a, b) => compareText(a.publishedAt, b.publishedAt) || compareText(a.lineageId, b.lineageId))
}
