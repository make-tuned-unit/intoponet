import { lookup } from 'node:dns/promises'
import { createHash, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { isPrivateAddress } from './publicAddress'
export { privateIpv4 } from './publicAddress'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { FEED_ADAPTER_LIMITS, FEED_SANITIZE_LIMITS, feedCharset, isUtcTimestamp, parseFeedXml, parsePublicItem, sanitizeFeedXml, type PublicItem } from '@intoponet/field-snapshot'

const CACHE_SCHEMA_VERSION = 1
const MAX_CACHE_BYTES = 16 * 1024 * 1024
/** Hard ceiling for reading/writing any feed cache file. */
const MAX_STORED_CACHE_BYTES = 256 * 1024 * 1024
const MAX_ENABLED_SOURCES = 32
/** Ceiling for callers that opt into a larger registry (the per-country news layer). */
const MAX_ENABLED_SOURCES_CEILING = 6_000
const MAX_ITEMS_PER_SOURCE = 500
const MAX_DEAD_LETTERS = 20
const MIN_POLL_MS = 300_000
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1_000
const MAX_RETRY_AFTER_MS = 30 * 24 * 60 * 60 * 1_000
const DEFAULT_TIMEOUT_MS = 12_000
const MAX_REDIRECTS = 3
const REQUIRED_APPROVED_FIELDS = ['title', 'canonicalItemUrl', 'guid', 'publishedAt'] as const

type RegistryState = 'candidate' | 'admitted-disabled' | 'admitted-enabled' | 'blocked'

export type FeedRegistrySource = {
  sourceId: string
  kind: 'rss' | 'atom'
  url: string
  publisherName: string
  languageTags: string[]
  candidateState: RegistryState
  licenseStatus: 'approved' | 'review_required' | 'blocked'
  approvedFields: string[]
  proposedPollingMinSeconds?: number
  activePollingMinSeconds?: number | null
  pollingMinSeconds?: number
  retentionDays?: number
}

export type FeedRegistry = {
  enabledSourceIds: string[]
  sources: FeedRegistrySource[]
}

export type FeedDeadLetter = {
  at: string
  code: 'timeout' | 'network' | 'http-status' | 'redirect' | 'unsafe-url' | 'oversized' | 'invalid-feed' | 'storage'
  message: string
  status?: number
}

export type FeedSourceState = {
  health: 'pending' | 'healthy' | 'stale' | 'error'
  etag?: string
  lastModified?: string
  lastAttemptAt?: string
  lastSuccessfulFetchAt?: string
  lastObservedItemAt?: string
  nextAttemptAt?: string
  failures: number
  items: PublicItem[]
  deadLetters: FeedDeadLetter[]
}

export type FeedCacheSnapshot = {
  schemaVersion: 1
  updatedAt: string
  sources: Record<string, FeedSourceState>
}

export type FeedStorage = {
  read(): Promise<string | null>
  write(serialized: string): Promise<void>
}

export type FeedFetchResult = {
  sourceId: string
  status: 'updated' | 'not-modified' | 'error' | 'deferred'
  /** Newly parsed rows, empty on 304/error; retained rows are in the cache snapshot. */
  receivedItems: PublicItem[]
  itemCount: number
  nextAttemptAt?: string
  health: FeedSourceState['health']
  /** False means a no-store response was returned transiently and must not enter history. */
  persistenceAllowed: boolean
}

type TimerHandle = ReturnType<typeof setTimeout>
type FeedServiceOptions = {
  registry: FeedRegistry
  storage: FeedStorage
  mode?: 'production' | 'fixture'
  fetchImpl?: typeof fetch
  now?: () => number
  resolveHost?: (hostname: string) => Promise<string[]>
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle
  clearTimer?: (timer: TimerHandle) => void
  maxConcurrency?: number
  timeoutMs?: number
  maxResponseBytes?: number
  /** Raise the enabled-source cap (default 32, at most 800). */
  maxEnabledSources?: number
  /** Called after every completed refresh, including scheduled ones. */
  onResult?: (result: FeedFetchResult) => void
  /** Coalesce cache writes; 0 (default) writes after every refresh. */
  persistDebounceMs?: number
  /** Persistent cache size limit in bytes (default 16 MB, at most 64 MB). */
  maxCacheBytes?: number
  /**
   * Real-world mode for the news layer: accept larger responses, decode the
   * declared charset, and strip bodies/media before the strict parser.
   */
  tolerant?: boolean
}

/**
 * A feed that fails is ordinary: of a few thousand, hundreds time out or answer badly at every start. The failure
 * carries its code and message only, never a stack trace (collecting one for each is work nobody reads).
 */
class FetchFailure extends Error {
  constructor(
    readonly code: FeedDeadLetter['code'],
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    const limit = Error.stackTraceLimit
    Error.stackTraceLimit = 0
    try {
      super(message)
    } finally {
      Error.stackTraceLimit = limit
    }
  }
}

/** Why a request that ran out of time was stopped: one shared reason, not a new error for every slow feed. */
const TIMED_OUT = new FetchFailure('timeout', 'Feed request timed out.')

/** Two hashes per headline, a hundred thousand headlines at a start: computed here, not as a job on another thread each. */
const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex')

const defaultNow = (): number => Date.now()
const defaultSetTimer = (callback: () => void, delayMs: number): TimerHandle =>
  setTimeout(callback, delayMs)
const defaultClearTimer = (timer: TimerHandle): void => clearTimeout(timer)

function timestamp(value: number): string {
  return new Date(value).toISOString()
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)
}

function loopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized === '::1') return true
  return isIP(normalized) === 4 && Number(normalized.split('.')[0]) === 127
}

function publicHostName(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (!host || isIP(host) !== 0 || !host.includes('.') ||
      host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || host.endsWith('.test') || host.endsWith('.example')) {
    return false
  }
  return true
}

function parseHttpUrl(value: string, base?: string): URL {
  let url: URL
  try {
    url = base ? new URL(value, base) : new URL(value)
  } catch {
    throw new FetchFailure('unsafe-url', 'Feed URL is invalid.')
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new FetchFailure('unsafe-url', 'Feed URLs must use HTTP(S) without credentials.')
  }
  return url
}

function optionInt(value: number | undefined, fallback: number, minimum: number, maximum: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || !Number.isInteger(value)) throw new Error(`${name} must be a finite integer.`)
  return Math.max(minimum, Math.min(maximum, value))
}

function retryAfterMs(value: string | null, now: number): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_AFTER_MS, seconds * 1_000)
  const when = Date.parse(value)
  return Number.isFinite(when) ? Math.min(MAX_RETRY_AFTER_MS, Math.max(0, when - now)) : undefined
}

function cacheMaxAgeMs(cacheControl: string | null, ageHeader: string | null): number | undefined {
  if (!cacheControl || /(?:^|,)\s*(?:no-cache|no-store)(?:\s*(?:,|$))/i.test(cacheControl)) return undefined
  const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/i.exec(cacheControl)?.[1]
  if (!maxAge) return undefined
  const age = Math.max(0, Number(ageHeader) || 0)
  const seconds = Math.max(0, Number(maxAge) - age)
  return Math.min(MAX_RETRY_AFTER_MS, seconds * 1_000)
}

function stateFor(source: FeedRegistrySource): FeedSourceState {
  return {
    health: 'pending',
    failures: 0,
    items: [],
    deadLetters: [],
  }
}

function safeValidator(value: string | null, maxLength: number): string | undefined {
  if (!value || value.length > maxLength || /[\r\n]/.test(value)) return undefined
  return value
}

function deadLetter(
  at: string,
  error: unknown,
): FeedDeadLetter {
  if (error instanceof FetchFailure) {
    return {
      at,
      code: error.code,
      message: error.message.slice(0, 240),
      ...(error.status === undefined ? {} : { status: error.status }),
    }
  }
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return { at, code: 'timeout', message: 'Feed request timed out.' }
  }
  return { at, code: 'network', message: 'Feed request failed.' }
}

function validateRegistry(registry: FeedRegistry, maxEnabled = MAX_ENABLED_SOURCES): Map<string, FeedRegistrySource> {
  if (!registry || !Array.isArray(registry.enabledSourceIds) || !Array.isArray(registry.sources)) {
    throw new Error('Feed registry must contain enabledSourceIds and sources arrays.')
  }
  if (new Set(registry.enabledSourceIds).size !== registry.enabledSourceIds.length) {
    throw new Error('Feed registry contains duplicate enabled source IDs.')
  }
  if (registry.sources.some((source) => !source || !validId(source.sourceId))) {
    throw new Error('Feed registry contains an invalid source ID.')
  }
  const rows = new Map(registry.sources.map((source) => [source.sourceId, source]))
  if (rows.size !== registry.sources.length) throw new Error('Feed registry contains duplicate source IDs.')
  if (registry.enabledSourceIds.length > maxEnabled) {
    throw new Error(`At most ${maxEnabled} feed sources may be enabled.`)
  }

  const enabled = new Map<string, FeedRegistrySource>()
  for (const sourceId of registry.enabledSourceIds) {
    if (!validId(sourceId)) throw new Error('Enabled feed source ID is invalid.')
    const source = rows.get(sourceId)
    if (!source) throw new Error(`Enabled source ${sourceId} is absent from the registry.`)
    if (source.candidateState !== 'admitted-enabled' || source.licenseStatus !== 'approved') {
      throw new Error(`Enabled source ${sourceId} is not admitted and approved.`)
    }
    if (!['rss', 'atom'].includes(source.kind)) throw new Error(`Enabled source ${sourceId} is not RSS or Atom.`)
    if (!Array.isArray(source.approvedFields) || REQUIRED_APPROVED_FIELDS.some((field) => !source.approvedFields.includes(field))) {
      throw new Error(`Enabled source ${sourceId} has not approved all required metadata fields.`)
    }
    const pollingSeconds = source.activePollingMinSeconds ?? source.pollingMinSeconds ?? source.proposedPollingMinSeconds
    if (!Number.isSafeInteger(pollingSeconds) || (pollingSeconds ?? 0) < MIN_POLL_MS / 1_000) {
      throw new Error(`Enabled source ${sourceId} must poll no faster than 300 seconds.`)
    }
    const retentionDays = source.retentionDays ?? 30
    if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 30) {
      throw new Error(`Enabled source ${sourceId} retention must be between 1 and 30 days.`)
    }
    if (!Array.isArray(source.languageTags) || !source.languageTags.length || source.languageTags.some((tag) => !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(tag))) {
      throw new Error(`Enabled source ${sourceId} must declare BCP 47 language tags.`)
    }
    parseHttpUrl(source.url)
    enabled.set(sourceId, source)
  }
  return enabled
}

export function createAtomicFeedStorage(filePath: string, maxBytes = MAX_CACHE_BYTES): FeedStorage {
  return {
    async read() {
      try {
        const info = await stat(filePath)
        if (info.size > Math.min(maxBytes, MAX_STORED_CACHE_BYTES)) return null
        return await readFile(filePath, 'utf8')
      } catch {
        return null
      }
    },
    async write(serialized) {
      if (Buffer.byteLength(serialized, 'utf8') > Math.min(maxBytes, MAX_STORED_CACHE_BYTES)) {
        throw new Error('Feed cache exceeds its persistent size limit.')
      }
      const temporary = `${filePath}.${randomUUID()}.tmp`
      await mkdir(dirname(filePath), { recursive: true })
      try {
        await writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        await rename(temporary, filePath)
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined)
        throw error
      }
    },
  }
}

function isState(value: unknown): value is FeedSourceState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const state = value as Record<string, unknown>
  if (!['pending', 'healthy', 'stale', 'error'].includes(String(state['health'])) ||
      !Number.isSafeInteger(state['failures']) || (state['failures'] as number) < 0 ||
      !Array.isArray(state['items']) || state['items'].length > MAX_ITEMS_PER_SOURCE ||
      !Array.isArray(state['deadLetters']) || state['deadLetters'].length > MAX_DEAD_LETTERS) return false
  for (const key of ['etag', 'lastModified', 'lastAttemptAt', 'lastSuccessfulFetchAt', 'lastObservedItemAt', 'nextAttemptAt']) {
    if (key in state && typeof state[key] !== 'string') return false
  }
  if (typeof state['etag'] === 'string' && (state['etag'].length > 1_024 || /[\r\n]/.test(state['etag']))) return false
  if (typeof state['lastModified'] === 'string' && (state['lastModified'].length > 128 || /[\r\n]/.test(state['lastModified']))) return false
  return state['deadLetters'].every((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false
    const record = entry as Record<string, unknown>
    return typeof record['at'] === 'string' && typeof record['code'] === 'string' &&
      typeof record['message'] === 'string' && record['message'].length <= 240
  })
}

function parseStoredCache(serialized: string | null, sourceIds: Set<string>): FeedCacheSnapshot | null {
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > MAX_STORED_CACHE_BYTES) return null
  try {
    const raw = JSON.parse(serialized) as Record<string, unknown>
    if (raw['schemaVersion'] !== CACHE_SCHEMA_VERSION || typeof raw['updatedAt'] !== 'string' ||
        !isUtcTimestamp(raw['updatedAt']) || typeof raw['sources'] !== 'object' || raw['sources'] === null || Array.isArray(raw['sources'])) {
      return null
    }
    const sources: Record<string, FeedSourceState> = {}
    for (const [sourceId, value] of Object.entries(raw['sources'] as Record<string, unknown>)) {
      if (!sourceIds.has(sourceId) || !isState(value)) continue
      const state = value
      const items = state.items.flatMap((entry) => {
        const item = parsePublicItem(entry)
        return item?.sourceId === sourceId ? [item] : []
      })
      const validLetters = state.deadLetters.filter((entry): entry is FeedDeadLetter => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false
        const letter = entry as Record<string, unknown>
        return typeof letter['at'] === 'string' && isUtcTimestamp(letter['at']) &&
          ['timeout', 'network', 'http-status', 'redirect', 'unsafe-url', 'oversized', 'invalid-feed', 'storage'].includes(String(letter['code'])) &&
          typeof letter['message'] === 'string' && letter['message'].length <= 240 &&
          (!('status' in letter) || Number.isSafeInteger(letter['status']))
      }).slice(-MAX_DEAD_LETTERS)
      const result: FeedSourceState = {
        health: state.health,
        failures: state.failures,
        items,
        deadLetters: validLetters,
      }
      for (const key of ['etag', 'lastModified', 'lastAttemptAt', 'lastSuccessfulFetchAt', 'lastObservedItemAt', 'nextAttemptAt'] as const) {
        const value = state[key]
        if (typeof value === 'string' && (key === 'etag' || key === 'lastModified' || isUtcTimestamp(value))) {
          result[key] = value
        }
      }
      sources[sourceId] = result
    }
    return { schemaVersion: CACHE_SCHEMA_VERSION, updatedAt: raw['updatedAt'], sources }
  } catch {
    return null
  }
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true, verbatim: true })
  return results.map((result) => result.address)
}

function mergeItems(existing: PublicItem[], incoming: PublicItem[], discoveredBefore: number): PublicItem[] {
  const byId = new Map<string, PublicItem>()
  for (const item of [...existing, ...incoming]) {
    if (Date.parse(item.discoveredAt) < discoveredBefore) continue
    const old = byId.get(item.id)
    const oldVersion = old?.updatedAt ?? old?.publishedAt ?? ''
    const newVersion = item.updatedAt ?? item.publishedAt ?? ''
    if (!old || newVersion > oldVersion || (newVersion === oldVersion && item.sourceContentHash > old.sourceContentHash)) {
      byId.set(item.id, item)
    }
  }
  const byUrl = new Map<string, PublicItem>()
  for (const item of byId.values()) {
    const old = byUrl.get(item.canonicalUrl)
    if (!old || (item.updatedAt ?? item.publishedAt ?? '') > (old.updatedAt ?? old.publishedAt ?? '') ||
        ((item.updatedAt ?? item.publishedAt ?? '') === (old.updatedAt ?? old.publishedAt ?? '') && item.id < old.id)) {
      byUrl.set(item.canonicalUrl, item)
    }
  }
  return [...byUrl.values()].sort((left, right) => left.id.localeCompare(right.id)).slice(-MAX_ITEMS_PER_SOURCE)
}

async function readLimitedBody(response: Response, maxBytes: number, tolerant = false): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new FetchFailure('oversized', 'Feed response exceeded the byte limit.')
  }
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      if (!next.value) continue
      size += next.value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new FetchFailure('oversized', 'Feed response exceeded the byte limit.')
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (tolerant) {
    const charset = feedCharset(response.headers.get('content-type'), bytes)
    try {
      return new TextDecoder(charset === 'utf8' ? 'utf-8' : charset).decode(bytes)
    } catch {
      return new TextDecoder('utf-8').decode(bytes)
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new FetchFailure('invalid-feed', 'Feed response is not valid UTF-8.')
  }
}

function asResult(sourceId: string, state: FeedSourceState, status: FeedFetchResult['status'], receivedItems: PublicItem[] = [], persistenceAllowed = true): FeedFetchResult {
  return {
    sourceId,
    status,
    receivedItems,
    itemCount: state.items.length,
    ...(state.nextAttemptAt ? { nextAttemptAt: state.nextAttemptAt } : {}),
    health: state.health,
    persistenceAllowed,
  }
}

export class FeedFetchService {
  private readonly sources: Map<string, FeedRegistrySource>
  private readonly mode: 'production' | 'fixture'
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly resolveHost: (hostname: string) => Promise<string[]>
  private readonly setTimer: (callback: () => void, delayMs: number) => TimerHandle
  private readonly clearTimer: (timer: TimerHandle) => void
  private readonly maxConcurrency: number
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number
  private readonly queue: Array<{ sourceId: string; resolve: (result: FeedFetchResult) => void; reject: (error: unknown) => void }> = []
  private readonly inFlight = new Map<string, Promise<FeedFetchResult>>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly timers = new Map<string, TimerHandle>()
  private cache: FeedCacheSnapshot = { schemaVersion: CACHE_SCHEMA_VERSION, updatedAt: timestamp(Date.now()), sources: {} }
  private loaded: Promise<void> | null = null
  /** The saved cache has been read into `cache` (until then `cache` is empty and must never be written). */
  private cacheRead = false
  private persistQueue: Promise<void> = Promise.resolve()
  private activeRequests = 0
  private running = false

  constructor(private readonly options: FeedServiceOptions) {
    this.sources = validateRegistry(options.registry, optionInt(options.maxEnabledSources, MAX_ENABLED_SOURCES, 1, MAX_ENABLED_SOURCES_CEILING, 'maxEnabledSources'))
    this.mode = options.mode ?? 'production'
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.now = options.now ?? defaultNow
    this.resolveHost = options.resolveHost ?? defaultResolveHost
    this.setTimer = options.setTimer ?? defaultSetTimer
    this.clearTimer = options.clearTimer ?? defaultClearTimer
    this.maxConcurrency = optionInt(options.maxConcurrency, 3, 1, 16, 'maxConcurrency')
    this.timeoutMs = optionInt(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000, 'timeoutMs')
    this.maxResponseBytes = optionInt(
      options.maxResponseBytes,
      options.tolerant ? FEED_SANITIZE_LIMITS.rawBytes : FEED_ADAPTER_LIMITS.bytes,
      1_024,
      options.tolerant ? FEED_SANITIZE_LIMITS.rawBytes : FEED_ADAPTER_LIMITS.bytes,
      'maxResponseBytes',
    )
  }

  async start(): Promise<void> {
    if (this.running) return
    await this.ensureLoaded()
    this.running = true
    // A restart after a spell offline tries those feeds again now (see retryNetworkFailures).
    this.retryNetworkFailures()
    for (const sourceId of this.sources.keys()) this.scheduleSource(sourceId)
  }

  /**
   * Feeds whose last attempt failed for want of a network (no connection, a timeout) are tried again
   * now instead of when their backoff ends: after a night offline every feed has backed off for hours.
   * Feeds that failed any other way (an HTTP error, a bad feed) keep their backoff, and one that fails
   * again backs off as before. Called on start, and when the Mac wakes or comes back online.
   */
  retryNetworkFailures(): number {
    const now = this.now()
    let retried = 0
    for (const [sourceId, state] of Object.entries(this.cache.sources)) {
      const last = state.deadLetters.at(-1)
      if (state.health === 'healthy' || (last?.code !== 'network' && last?.code !== 'timeout')) continue
      const due = state.nextAttemptAt ? Date.parse(state.nextAttemptAt) : Number.NaN
      if (!(due > now) || this.inFlight.has(sourceId)) continue
      state.nextAttemptAt = timestamp(now)
      retried += 1
      const timer = this.timers.get(sourceId)
      if (timer) {
        this.clearTimer(timer)
        this.timers.delete(sourceId)
      }
      this.scheduleSource(sourceId)
    }
    return retried
  }

  stop(): void {
    this.running = false
    for (const timer of this.timers.values()) this.clearTimer(timer)
    this.timers.clear()
    for (const controller of this.controllers.values()) controller.abort()
    for (const queued of this.queue.splice(0)) {
      this.inFlight.delete(queued.sourceId)
      queued.reject(new Error('Feed service stopped before the queued request started.'))
    }
  }

  async refreshSource(sourceId: string): Promise<FeedFetchResult> {
    if (!this.sources.has(sourceId)) throw new Error(`Feed source ${sourceId} is not enabled and approved.`)
    await this.ensureLoaded()
    const current = this.inFlight.get(sourceId)
    if (current) return current
    const currentState = this.cache.sources[sourceId]
    const dueAt = currentState?.nextAttemptAt ? Date.parse(currentState.nextAttemptAt) : Number.NEGATIVE_INFINITY
    if (Number.isFinite(dueAt) && dueAt > this.now()) {
      this.scheduleSource(sourceId)
      return asResult(sourceId, currentState!, 'deferred')
    }
    const scheduled = this.timers.get(sourceId)
    if (scheduled) {
      this.clearTimer(scheduled)
      this.timers.delete(sourceId)
    }

    let resolve!: (result: FeedFetchResult) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<FeedFetchResult>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    this.inFlight.set(sourceId, promise)
    this.queue.push({ sourceId, resolve, reject })
    this.drainQueue()
    return promise
  }

  async refreshAll(): Promise<FeedFetchResult[]> {
    return Promise.all([...this.sources.keys()].map((sourceId) => this.refreshSource(sourceId)))
  }

  /**
   * The live per-source state, without copying (snapshot() deep-copies tens of MB). Read only.
   * A source's `items` array is replaced, never changed in place, whenever its items change.
   */
  async liveSources(): Promise<Readonly<Record<string, Readonly<FeedSourceState>>>> {
    await this.ensureLoaded()
    return this.cache.sources
  }

  async snapshot(): Promise<FeedCacheSnapshot> {
    await this.ensureLoaded()
    return JSON.parse(JSON.stringify(this.cache)) as FeedCacheSnapshot
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.loaded = this.loadCache()
    }
    return this.loaded
  }

  private async loadCache(): Promise<void> {
    const ids = new Set(this.sources.keys())
    const stored = parseStoredCache(await this.options.storage.read(), ids)
    const now = this.now()
    const sources: Record<string, FeedSourceState> = {}
    for (const source of this.sources.values()) {
      const state = stored?.sources[source.sourceId] ?? stateFor(source)
      const retentionMs = (source.retentionDays ?? 30) * 24 * 60 * 60 * 1_000
      state.items = state.items.filter((item) => Date.parse(item.discoveredAt) >= now - retentionMs)
      sources[source.sourceId] = state
    }
    this.cache = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      updatedAt: timestamp(now),
      sources,
    }
    this.cacheRead = true
  }

  private scheduleSource(sourceId: string): void {
    if (!this.running || this.timers.has(sourceId)) return
    const state = this.cache.sources[sourceId]
    if (!state) return
    const due = state.nextAttemptAt ? Date.parse(state.nextAttemptAt) : this.now()
    const delay = Math.min(2_147_000_000, Math.max(0, due - this.now()))
    const timer = this.setTimer(() => {
      this.timers.delete(sourceId)
      if (!this.running) return
      if (due > this.now()) this.scheduleSource(sourceId)
      else void this.refreshSource(sourceId).catch(() => undefined)
    }, delay)
    this.timers.set(sourceId, timer)
  }

  private drainQueue(): void {
    while (this.activeRequests < this.maxConcurrency && this.queue.length > 0) {
      const queued = this.queue.shift()
      if (!queued) return
      this.activeRequests += 1
      void this.performRefresh(queued.sourceId).then((result) => {
        try { this.options.onResult?.(result) } catch { /* observers never break fetching */ }
        queued.resolve(result)
      }, queued.reject).finally(() => {
        this.activeRequests -= 1
        this.inFlight.delete(queued.sourceId)
        if (this.running) this.scheduleSource(queued.sourceId)
        this.drainQueue()
      })
    }
  }

  private persistTimer: TimerHandle | null = null

  private async persist(): Promise<void> {
    const debounce = this.options.persistDebounceMs ?? 0
    if (debounce > 0) {
      if (!this.persistTimer) {
        this.persistTimer = this.setTimer(() => {
          this.persistTimer = null
          void this.writeCache().catch(() => undefined)
        }, debounce)
      }
      return
    }
    await this.writeCache()
  }

  /**
   * Write any pending debounced cache state now (e.g. on quit). Before the saved cache has been read there is
   * nothing newer to write, and writing then would replace what was saved with an empty cache.
   */
  async flush(): Promise<void> {
    if (this.persistTimer) {
      this.clearTimer(this.persistTimer)
      this.persistTimer = null
    }
    if (!this.cacheRead) return
    await this.writeCache().catch(() => undefined)
  }

  private async writeCache(): Promise<void> {
    this.cache.updatedAt = timestamp(this.now())
    const serialized = JSON.stringify(this.cache)
    if (Buffer.byteLength(serialized, 'utf8') > optionInt(this.options.maxCacheBytes, MAX_CACHE_BYTES, 1_024, MAX_STORED_CACHE_BYTES, 'maxCacheBytes')) {
      throw new Error('Feed cache exceeds its persistent size limit.')
    }
    this.persistQueue = this.persistQueue.catch(() => undefined).then(() => this.options.storage.write(serialized))
    try {
      await this.persistQueue
    } catch {
      throw new FetchFailure('storage', 'Public feed cache could not be written.')
    }
  }

  private async validateTarget(url: URL, signal: AbortSignal): Promise<void> {
    if (this.mode === 'fixture') {
      if (!loopbackHost(url.hostname)) throw new FetchFailure('unsafe-url', 'Fixture mode accepts loopback URLs only.')
      return
    }
    if (url.protocol !== 'https:' || !publicHostName(url.hostname)) {
      throw new FetchFailure('unsafe-url', 'Production feed URLs must be public HTTPS hostnames, not local or literal IPs.')
    }
    let addresses: string[]
    try {
      // This is a fail-closed preflight. The global fetch transport resolves
      // again when it connects, so it does not pin these answers. Keep live
      // use behind a reviewed endpoint allowlist until a pinned transport is
      // selected and verified against DNS rebinding.
      if (signal.aborted) throw new FetchFailure('timeout', 'Feed request timed out.')
      let onAbort: (() => void) | undefined
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new FetchFailure('timeout', 'Feed request timed out.'))
        signal.addEventListener('abort', onAbort, { once: true })
      })
      try {
        addresses = await Promise.race([this.resolveHost(url.hostname), aborted])
      } finally {
        if (onAbort) signal.removeEventListener('abort', onAbort)
      }
    } catch {
      if (signal.aborted) throw new FetchFailure('timeout', 'Feed request timed out.')
      throw new FetchFailure('unsafe-url', 'Feed hostname could not be resolved safely.')
    }
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
      throw new FetchFailure('unsafe-url', 'Feed hostname resolves to a non-public address.')
    }
  }

  private async fetchResponse(source: FeedRegistrySource, signal: AbortSignal, headers: HeadersInit): Promise<{ response: Response; finalUrl: string }> {
    const registeredUrl = parseHttpUrl(source.url)
    await this.validateTarget(registeredUrl, signal)
    const allowedOrigin = registeredUrl.origin
    let currentUrl = registeredUrl
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await this.fetchImpl(currentUrl.toString(), {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal,
      })
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return { response, finalUrl: currentUrl.toString() }
      }
      const location = response.headers.get('location')
      if (!location || redirects === MAX_REDIRECTS) {
        await response.body?.cancel().catch(() => undefined)
        throw new FetchFailure('redirect', 'Feed exceeded the redirect limit.')
      }
      const next = parseHttpUrl(location, currentUrl.toString())
      if (next.origin !== allowedOrigin) {
        await response.body?.cancel().catch(() => undefined)
        throw new FetchFailure('redirect', 'Cross-origin feed redirect was blocked.')
      }
      await response.body?.cancel().catch(() => undefined)
      await this.validateTarget(next, signal)
      currentUrl = next
    }
    throw new FetchFailure('redirect', 'Feed exceeded the redirect limit.')
  }

  private async performRefresh(sourceId: string): Promise<FeedFetchResult> {
    const source = this.sources.get(sourceId)
    if (!source) throw new Error(`Feed source ${sourceId} is not enabled and approved.`)
    const state = this.cache.sources[sourceId] ?? stateFor(source)
    this.cache.sources[sourceId] = state
    const attemptAt = timestamp(this.now())
    state.lastAttemptAt = attemptAt
    const controller = new AbortController()
    this.controllers.set(sourceId, controller)
    const timeout = this.setTimer(() => controller.abort(TIMED_OUT), this.timeoutMs)
    const headers = new Headers({
      accept: source.kind === 'atom'
        ? 'application/atom+xml, application/xml;q=0.9, text/xml;q=0.8'
        : 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
      'user-agent': 'Intoponet/0.1 (news reader; +https://intoponet.com/publishers)',
    })
    if (state.etag) headers.set('if-none-match', state.etag)
    if (state.lastModified) headers.set('if-modified-since', state.lastModified)

    let result: FeedFetchResult
    try {
      const { response, finalUrl } = await this.fetchResponse(source, controller.signal, headers)
      if (response.status === 304) {
        const noStore = /(?:^|,)\s*no-store(?:\s*(?:,|$))/i.test(response.headers.get('cache-control') ?? '')
        if (noStore) {
          // Parsed items are not retained for no-store; only returned transiently on a 200.
          state.items = []
          delete state.etag
          delete state.lastModified
          delete state.lastObservedItemAt
        } else {
          const discoveredBefore = this.now() - (source.retentionDays ?? 30) * 24 * 60 * 60 * 1_000
          state.items = state.items.filter((item) => Date.parse(item.discoveredAt) >= discoveredBefore)
        }
        const etag = safeValidator(response.headers.get('etag'), 1_024)
        const lastModified = safeValidator(response.headers.get('last-modified'), 128)
        if (!noStore && etag) state.etag = etag
        if (!noStore && lastModified) state.lastModified = lastModified
        state.health = 'healthy'
        state.failures = 0
        state.lastSuccessfulFetchAt = timestamp(this.now())
        const maxAge = cacheMaxAgeMs(response.headers.get('cache-control'), response.headers.get('age')) ?? 0
        const minPoll = Math.max(MIN_POLL_MS, (source.activePollingMinSeconds ?? source.pollingMinSeconds ?? source.proposedPollingMinSeconds ?? 300) * 1_000)
        state.nextAttemptAt = timestamp(this.now() + Math.max(minPoll, maxAge))
        await this.persist()
        result = asResult(sourceId, state, 'not-modified', [], !noStore)
      } else if (!response.ok) {
        const retry = retryAfterMs(response.headers.get('retry-after'), this.now())
        await response.body?.cancel().catch(() => undefined)
        throw new FetchFailure('http-status', `Feed returned HTTP ${response.status}.`, response.status, retry)
      } else {
        const raw = await readLimitedBody(response, this.maxResponseBytes, this.options.tolerant)
        let body = raw
        if (this.options.tolerant) {
          try {
            body = sanitizeFeedXml(raw)
          } catch {
            throw new FetchFailure('oversized', 'Feed response exceeded the byte limit.')
          }
        }
        let receivedItems: PublicItem[]
        try {
          receivedItems = await parseFeedXml(body, {
            sourceId,
            feedUrl: finalUrl,
            discoveredAt: timestamp(this.now()),
            language: source.languageTags[0] ?? 'und',
            includePublisherTags: source.approvedFields.includes('publisherTags') || source.approvedFields.includes('category'),
            sha256Hex,
          })
        } catch {
          throw new FetchFailure('invalid-feed', 'Feed XML did not match the supported bounded RSS/Atom subset.')
        }
        const noStore = /(?:^|,)\s*no-store(?:\s*(?:,|$))/i.test(response.headers.get('cache-control') ?? '')
        const discoveredBefore = this.now() - (source.retentionDays ?? 30) * 24 * 60 * 60 * 1_000
        state.items = noStore ? [] : mergeItems(state.items, receivedItems, discoveredBefore)
        const etag = safeValidator(response.headers.get('etag'), 1_024)
        const lastModified = safeValidator(response.headers.get('last-modified'), 128)
        if (noStore) {
          delete state.etag
          delete state.lastModified
          delete state.lastObservedItemAt
        } else {
          if (etag) state.etag = etag
          else delete state.etag
          if (lastModified) state.lastModified = lastModified
          else delete state.lastModified
        }
        const publishedTimes = noStore ? [] : receivedItems.flatMap((item) => {
          const publishedAt = item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN
          return Number.isFinite(publishedAt) && publishedAt <= this.now() ? [publishedAt] : []
        })
        if (publishedTimes.length) {
          const latest = Math.max(...publishedTimes)
          const previous = state.lastObservedItemAt ? Date.parse(state.lastObservedItemAt) : Number.NEGATIVE_INFINITY
          state.lastObservedItemAt = timestamp(Math.max(latest, previous))
        }
        state.health = 'healthy'
        state.failures = 0
        state.lastSuccessfulFetchAt = timestamp(this.now())
        const maxAge = cacheMaxAgeMs(response.headers.get('cache-control'), response.headers.get('age')) ?? 0
        const minPoll = Math.max(MIN_POLL_MS, (source.activePollingMinSeconds ?? source.pollingMinSeconds ?? source.proposedPollingMinSeconds ?? 300) * 1_000)
        state.nextAttemptAt = timestamp(this.now() + Math.max(minPoll, maxAge))
        await this.persist()
        result = asResult(sourceId, state, 'updated', receivedItems, !noStore)
      }
    } catch (error) {
      const failure = error instanceof FetchFailure
        ? error
        : controller.signal.aborted
          ? new FetchFailure('timeout', 'Feed request timed out.')
          : new FetchFailure('network', 'Feed request failed.')
      state.failures += 1
      state.health = state.items.length ? 'stale' : 'error'
      const letter = deadLetter(timestamp(this.now()), failure)
      state.deadLetters = [...state.deadLetters, letter].slice(-MAX_DEAD_LETTERS)
      const exponential = Math.min(MAX_BACKOFF_MS, MIN_POLL_MS * (2 ** Math.min(state.failures - 1, 8)))
      const backoff = Math.max(exponential, failure.retryAfterMs ?? 0)
      state.nextAttemptAt = timestamp(this.now() + backoff)
      try {
        await this.persist()
      } catch {
        // Cache persistence failed; keep the bounded error only in memory.
      }
      result = asResult(sourceId, state, 'error')
    } finally {
      this.clearTimer(timeout)
      this.controllers.delete(sourceId)
    }
    return result
  }
}

export const FEED_FETCH_LIMITS = {
  cacheBytes: MAX_CACHE_BYTES,
  responseBytes: FEED_ADAPTER_LIMITS.bytes,
  enabledSources: MAX_ENABLED_SOURCES,
  itemsPerSource: MAX_ITEMS_PER_SOURCE,
  deadLettersPerSource: MAX_DEAD_LETTERS,
  minimumPollMs: MIN_POLL_MS,
  maxRedirects: MAX_REDIRECTS,
} as const

