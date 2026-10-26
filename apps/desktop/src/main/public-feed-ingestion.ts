import { createHash } from 'node:crypto'
import {
  emptyFeedHistory,
  FEED_HISTORY_LIMITS,
  parseFeedHistorySnapshot,
  reduceFeedHistory,
  snapshotFeedHistory,
  type FeedHistorySnapshot,
  type ProvenanceManifest,
  type PublicItem,
  type PublicSourceRecord,
} from '@intoponet/field-snapshot'
import type { FeedFetchResult, FeedRegistrySource, FeedSourceState } from './feed-service'

export type AdmittedIngestionSource = FeedRegistrySource & {
  independentPublisherGroupId: string
  declaredCoverage: { countryCodes: string[]; regionIds: string[]; cityIds: string[] }
  geographicScope: 'local' | 'regional' | 'national' | 'international' | 'unknown'
  termsUrl: string
  licenseUrl: string
  attribution: string
  rightsEvidence: string
}

export type IngestionStorage = {
  read(): Promise<string | null>
  write(value: string): Promise<void>
}

export type SourceOutcome = {
  sourceId: string
  fetchStatus: FeedFetchResult['status']
  /** Transport result only. This layer does not infer activity or decline from feed contents. */
  outcome: 'updated' | 'unchanged' | 'outage' | 'deferred'
  receivedItemCount: number
  retainedItemCount: number
  persistenceAllowed: boolean
  observedAt: string
}

export type PublicFeedIngestionArtifact = {
  schemaVersion: '1.0'
  generatedAt: string
  dataPolicy: 'public-metadata-only-no-descriptions-or-media'
  history: FeedHistorySnapshot
  sources: Array<{
    sourceId: string
    publisherName: string
    sourceUrl: string
    termsUrl: string
    licenseUrl: string
    attribution: string
    rightsEvidence: string
    retentionDays: number
    approvedFields: string[]
  }>
  provenance: ProvenanceManifest
  outcomes: SourceOutcome[]
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`
}

function sourceRecord(source: AdmittedIngestionSource, state: FeedSourceState, observedAt: string): PublicSourceRecord {
  const health = state.health === 'pending' ? 'disabled' : state.health
  return {
    schemaVersion: '1.0',
    sourceId: source.sourceId,
    kind: source.kind,
    url: source.url,
    publisherName: source.publisherName,
    languageTags: source.languageTags,
    declaredCoverage: source.declaredCoverage,
    geographicScope: source.geographicScope,
    licenseStatus: 'approved',
    termsUrl: source.termsUrl,
    pollingMinSeconds: source.activePollingMinSeconds ?? source.pollingMinSeconds ?? source.proposedPollingMinSeconds ?? 300,
    ...(state.etag ? { etag: state.etag } : {}),
    ...(state.lastModified ? { lastModified: state.lastModified } : {}),
    ...(state.lastSuccessfulFetchAt ? { lastSuccessfulFetchAt: state.lastSuccessfulFetchAt } : {}),
    ...(state.lastObservedItemAt ? { lastObservedItemAt: state.lastObservedItemAt } : {}),
    health,
    independentPublisherGroupId: source.independentPublisherGroupId,
  }
}

function provenanceFor(history: FeedHistorySnapshot, generatedAt: string): ProvenanceManifest {
  const grouped = new Map<string, typeof history.items>()
  for (const entry of history.items) {
    const group = grouped.get(entry.item.sourceId) ?? []
    group.push(entry)
    grouped.set(entry.item.sourceId, group)
  }
  const entries = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([sourceId, rows]) => {
    const sorted = [...rows].sort((left, right) => left.item.id.localeCompare(right.item.id))
    const itemIds = sorted.map((entry) => entry.item.id)
    const observedAt = sorted.reduce((latest, entry) => entry.lastSeenAt > latest ? entry.lastSeenAt : latest, sorted[0]?.lastSeenAt ?? generatedAt)
    return {
      provenanceId: stableId('provenance', `${sourceId}\n${itemIds.join('\n')}\n${observedAt}`),
      sourceId,
      itemIds,
      canonicalUrls: [...new Set(sorted.map((entry) => entry.item.canonicalUrl))].sort(),
      observedAt,
    }
  })
  const canonical = JSON.stringify(entries)
  return { schemaVersion: '1.0', id: stableId('manifest', canonical), generatedAt, entries }
}

function outcomeOf(result: FeedFetchResult, observedAt: string, retainedItemCount: number): SourceOutcome {
  const outcome = result.status === 'deferred' ? 'deferred'
    : result.status === 'error' ? 'outage'
      : result.status === 'not-modified' ? 'unchanged' : 'updated'
  return {
    sourceId: result.sourceId,
    fetchStatus: result.status,
    outcome,
    receivedItemCount: result.receivedItems.length,
    retainedItemCount,
    persistenceAllowed: result.persistenceAllowed,
    observedAt,
  }
}

/**
 * Apply one scheduler batch to public-only history. no-store is treated as a
 * deletion instruction for the source's previously retained metadata; outages
 * update health but preserve item history.
 */
export async function ingestPublicFeedBatch(options: {
  sources: AdmittedIngestionSource[]
  results: FeedFetchResult[]
  fetchStates: Record<string, FeedSourceState>
  storage: IngestionStorage
  now?: () => number
}): Promise<PublicFeedIngestionArtifact> {
  const now = options.now ?? Date.now
  const generatedAtMs = now()
  const generatedAt = new Date(generatedAtMs).toISOString()
  const bySource = new Map(options.sources.map((source) => [source.sourceId, source]))
  if (bySource.size !== options.sources.length) throw new Error('Ingestion source IDs must be unique.')
  for (const source of options.sources) {
    const required = ['title', 'canonicalItemUrl', 'guid', 'publishedAt']
    if (source.candidateState !== 'admitted-enabled' || source.licenseStatus !== 'approved' ||
        !required.every((field) => source.approvedFields.includes(field)) ||
        source.approvedFields.some((field) => ['description', 'body', 'content', 'media', 'image', 'logo'].includes(field.toLowerCase())) ||
        !source.independentPublisherGroupId || !source.termsUrl || !source.licenseUrl || !source.attribution || !source.rightsEvidence ||
        (source.retentionDays ?? 30) < 1 || (source.retentionDays ?? 30) > 30) {
      throw new Error(`Source ${source.sourceId} does not satisfy the admitted public-metadata contract.`)
    }
  }
  if (options.results.some((result) => !bySource.has(result.sourceId)) || new Set(options.results.map((result) => result.sourceId)).size !== options.results.length) {
    throw new Error('Fetch results must contain unique admitted source IDs only.')
  }

  let previous = emptyFeedHistory()
  const serialized = await options.storage.read()
  if (serialized !== null) {
    const parsed = parseFeedHistorySnapshot(serialized)
    if (!parsed) throw new Error('Stored public feed history is malformed; refusing to overwrite it.')
    previous = parsed
  }
  let working = snapshotFeedHistory(previous)
  const admittedIds = new Set(bySource.keys())
  working = {
    ...working,
    items: working.items.filter((entry) => admittedIds.has(entry.item.sourceId)),
    sources: working.sources.filter((source) => admittedIds.has(source.sourceId)),
  }
  const resultById = new Map(options.results.map((result) => [result.sourceId, result]))
  const observationsAt = generatedAt
  const sourceObservations = [] as Array<{ observedAt: string; source: PublicSourceRecord }>
  const itemObservations = [] as Array<{ observedAt: string; item: PublicItem }>
  const outcomes: SourceOutcome[] = []

  for (const source of options.sources) {
    const result = resultById.get(source.sourceId)
    if (!result) continue
    const state = options.fetchStates[source.sourceId]
    if (!state) throw new Error(`Missing fetch state for ${source.sourceId}.`)

    if (!result.persistenceAllowed) {
      working = { ...working, items: working.items.filter((entry) => entry.item.sourceId !== source.sourceId) }
    } else if (result.status === 'updated') {
      const oldById = new Map(working.items.filter((entry) => entry.item.sourceId === source.sourceId).map((entry) => [entry.item.id, entry]))
      for (const item of result.receivedItems) {
        const old = oldById.get(item.id)
        itemObservations.push({
          observedAt: observationsAt,
          item: { ...item, discoveredAt: old?.firstSeenAt ?? item.discoveredAt },
        })
      }
    }
    sourceObservations.push({ observedAt: observationsAt, source: sourceRecord(source, state, observationsAt) })
    outcomes.push(outcomeOf(result, observationsAt, 0))
  }

  let history = reduceFeedHistory(working, { sources: sourceObservations, items: itemObservations }, {
    retentionDays: 30,
    retentionDaysBySource: Object.fromEntries(options.sources.map((source) => [source.sourceId, source.retentionDays ?? 30])),
  })
  // Retention is rolling from current wall time even during outages or deferred polls.
  history = {
    ...history,
    items: history.items.filter((entry) => {
      const retentionDays = bySource.get(entry.item.sourceId)?.retentionDays ?? 30
      return Date.parse(entry.lastSeenAt) >= generatedAtMs - retentionDays * 86_400_000
    }),
  }
  for (const outcome of outcomes) {
    outcome.retainedItemCount = history.items.filter((entry) => entry.item.sourceId === outcome.sourceId).length
  }
  const artifact: PublicFeedIngestionArtifact = {
    schemaVersion: '1.0',
    generatedAt,
    dataPolicy: 'public-metadata-only-no-descriptions-or-media',
    history,
    sources: options.sources.map((source) => ({
      sourceId: source.sourceId,
      publisherName: source.publisherName,
      sourceUrl: source.url,
      termsUrl: source.termsUrl,
      licenseUrl: source.licenseUrl,
      attribution: source.attribution,
      rightsEvidence: source.rightsEvidence,
      retentionDays: source.retentionDays ?? 30,
      approvedFields: [...source.approvedFields].sort(),
    })).sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
    provenance: provenanceFor(history, generatedAt),
    outcomes: outcomes.sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
  }
  await options.storage.write(JSON.stringify(history))
  return artifact
}

export function createAtomicIngestionStorage(filePath: string): IngestionStorage {
  return {
    async read() {
      const { readFile, stat } = await import('node:fs/promises')
      try {
        const info = await stat(filePath)
        if (info.size > FEED_HISTORY_LIMITS.snapshotBytes) throw new Error('Stored public feed history exceeds its size limit.')
        return await readFile(filePath, 'utf8')
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null
        throw error
      }
    },
    async write(value) {
      const { mkdir, rename, rm, writeFile } = await import('node:fs/promises')
      const { dirname } = await import('node:path')
      const { randomUUID } = await import('node:crypto')
      if (Buffer.byteLength(value, 'utf8') > FEED_HISTORY_LIMITS.snapshotBytes) {
        throw new Error('Public feed history exceeds its persistent size limit.')
      }
      const temporary = `${filePath}.${randomUUID()}.tmp`
      await mkdir(dirname(filePath), { recursive: true })
      try {
        await writeFile(temporary, value, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        await rename(temporary, filePath)
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined)
        throw error
      }
    },
  }
}
