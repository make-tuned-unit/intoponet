import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fieldSnapshotSchema, isUtcTimestamp, parseFieldSnapshot, type FieldSnapshot } from '@intoponet/field-snapshot'

export const MAX_SHARED_MANIFEST_BYTES = 2_048
export const MAX_SHARED_SNAPSHOT_BYTES = 5 * 1024 * 1024
export const SHARED_SNAPSHOT_TIMEOUT_MS = 10_000
/** Keep shared-source status in sync with the globe's stale threshold. */
export const SHARED_SNAPSHOT_STALE_AFTER_MS = 2 * 60 * 60 * 1000
/** Allow modest publisher/client clock skew, but reject future-dated artifacts. */
export const MAX_SHARED_SNAPSHOT_FUTURE_SKEW_MS = 5 * 60 * 1000

const manifestSchema = 'intoponet.shared-public-snapshot-latest.v1'
const cacheSchema = 'intoponet.shared-public-snapshot-cache.v1'
const snapshotIdPattern = /^snapshot-v1-[a-f0-9]{64}$/
const digestPattern = /^[a-f0-9]{64}$/

export type SharedSnapshotManifest = {
  schema: typeof manifestSchema
  snapshotId: string
  sha256: string
  evaluationTime: string
  snapshotPath: string
}

export type SharedSnapshotStatus = {
  configured: true
  state: 'fresh' | 'cached' | 'stale' | 'error' | 'invalid-configuration'
  endpointOrigin: string | null
  evaluationTime: string | null
  checkedAt: string | null
  message: string
}

export type SharedSnapshotResult = {
  snapshot: FieldSnapshot | null
  status: SharedSnapshotStatus
}

type ClientOptions = {
  endpoint: string
  cachePath: string
  fetchImpl?: typeof fetch
  now?: () => number
}

type VerifiedArtifact = { manifest: SharedSnapshotManifest; snapshot: FieldSnapshot; bytes: string }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function parseEndpoint(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('Shared snapshot URL is invalid.')
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Shared snapshot URL must be an HTTPS origin without credentials, path, query, or fragment.')
  }
  return url
}

function validateManifest(value: unknown): SharedSnapshotManifest {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'evaluationTime,schema,sha256,snapshotId,snapshotPath'
    || value.schema !== manifestSchema || typeof value.snapshotId !== 'string' || !snapshotIdPattern.test(value.snapshotId)
    || typeof value.sha256 !== 'string' || !digestPattern.test(value.sha256)
    || typeof value.evaluationTime !== 'string' || !isUtcTimestamp(value.evaluationTime)
    || value.snapshotPath !== `/snapshots/${value.snapshotId}`) {
    throw new Error('Shared snapshot manifest failed validation.')
  }
  return value as SharedSnapshotManifest
}

async function boundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) {
    throw new Error('Shared snapshot response exceeds the byte limit.')
  }
  if (!response.body) throw new Error('Shared snapshot response has no body.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error('Shared snapshot response exceeds the byte limit.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Shared snapshot response is not valid UTF-8.')
  }
}

function verifyArtifact(manifest: SharedSnapshotManifest, bytes: string, now: number): VerifiedArtifact {
  const rawBytes = Buffer.from(bytes, 'utf8')
  if (rawBytes.length === 0 || rawBytes.length > MAX_SHARED_SNAPSHOT_BYTES) {
    throw new Error('Shared snapshot artifact is empty or exceeds the byte limit.')
  }
  if (sha256(rawBytes) !== manifest.sha256) throw new Error('Shared snapshot artifact digest does not match its manifest.')
  let raw: unknown
  try {
    raw = JSON.parse(bytes) as unknown
  } catch {
    throw new Error('Shared snapshot artifact is malformed JSON.')
  }
  if (!record(raw) || raw.schema !== fieldSnapshotSchema || raw.algorithm !== 'log1p-separated-v3'
    || typeof raw.id !== 'string' || raw.id !== manifest.snapshotId
    || !Array.isArray(raw.sources) || raw.sources.length === 0
    || raw.sources.some((source) => !record(source) || source.kind !== 'public-record')
    || !Array.isArray(raw.bands) || raw.bands.some((band) => !record(band) || band.sourceType !== 'public-aggregate')) {
    throw new Error('Shared snapshot artifact must be canonical public-only v3 content.')
  }
  const snapshot = parseFieldSnapshot(bytes)
  if (!snapshot || snapshot.schema !== fieldSnapshotSchema || snapshot.algorithm !== 'log1p-separated-v3'
    || snapshot.id !== manifest.snapshotId || snapshot.createdAt !== manifest.evaluationTime
    || snapshot.sources.length !== raw.sources.length || snapshot.sources.some((source) => source.kind !== 'public-record')
    || snapshot.bands.length !== raw.bands.length || snapshot.bands.some((band) => band.sourceType !== 'public-aggregate')) {
    throw new Error('Shared snapshot identity or evaluation time does not match its manifest.')
  }
  if (Date.parse(snapshot.createdAt) > now + MAX_SHARED_SNAPSHOT_FUTURE_SKEW_MS) {
    throw new Error('Shared snapshot evaluation time is unreasonably far in the future.')
  }
  // parseFieldSnapshot validates and deterministically derives bands at the
  // artifact's createdAt. Require the server's complete serialized snapshot
  // to equal that result so no unrecognized fields or altered bands survive.
  const canonicalBytes = `${JSON.stringify(snapshot)}\n`
  if (canonicalBytes !== bytes || canonicalJson(raw) !== canonicalJson(snapshot)) {
    throw new Error('Shared snapshot artifact is not the canonical normalized snapshot.')
  }
  if (raw.coverageNote !== snapshot.coverageNote || snapshot.sources.some((source) => !source.attribution.trim())) {
    throw new Error('Shared snapshot attribution or coverage is invalid.')
  }
  return { manifest, snapshot, bytes }
}

export class SharedPublicSnapshotClient {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly endpoint: URL | null
  private readonly endpointError: Error | null
  private artifact: VerifiedArtifact | null = null
  private checkedAt: string | null = null
  private state: SharedSnapshotStatus['state']
  private message: string

  constructor(private readonly options: ClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.now = options.now ?? Date.now
    try {
      this.endpoint = parseEndpoint(options.endpoint)
      this.endpointError = null
      this.state = 'cached'
      this.message = 'Shared public snapshot is configured; checking for the latest artifact.'
    } catch (error) {
      this.endpoint = null
      this.endpointError = error instanceof Error ? error : new Error('Shared snapshot URL is invalid.')
      this.state = 'invalid-configuration'
      this.message = this.endpointError.message
    }
    this.loadCache()
  }

  status(now = this.now()): SharedSnapshotStatus {
    const evaluatedAt = this.artifact ? Date.parse(this.artifact.snapshot.createdAt) : null
    const clockBehind = evaluatedAt !== null && evaluatedAt > now + MAX_SHARED_SNAPSHOT_FUTURE_SKEW_MS
    const stale = evaluatedAt !== null && now - evaluatedAt > SHARED_SNAPSHOT_STALE_AFTER_MS
    let state = this.state
    let message = this.message
    if (clockBehind) {
      state = 'error'
      message = 'The device clock is more than five minutes behind the verified shared snapshot; keeping the artifact available and showing this clock discrepancy.'
    } else if (stale && state !== 'invalid-configuration') {
      state = 'stale'
      if (!/stale/i.test(message)) message = `${message} The verified shared snapshot is older than 2 hours.`
    }
    return {
      configured: true,
      state,
      endpointOrigin: this.endpoint?.origin ?? null,
      evaluationTime: this.artifact?.snapshot.createdAt ?? null,
      checkedAt: this.checkedAt,
      message,
    }
  }

  cached(now = this.now()): SharedSnapshotResult {
    if (this.artifact && this.state === 'cached') {
      this.message = 'Shared source has not been checked yet; showing the last verified shared snapshot.'
    }
    return { snapshot: this.artifact?.snapshot ?? null, status: this.status(now) }
  }

  async refresh(now = this.now()): Promise<SharedSnapshotResult> {
    this.checkedAt = new Date(now).toISOString()
    try {
      if (this.endpointError || !this.endpoint) throw this.endpointError ?? new Error('Shared snapshot URL is invalid.')
      const latestUrl = new URL('/latest', this.endpoint)
      const manifestBytes = await this.fetchText(latestUrl, MAX_SHARED_MANIFEST_BYTES)
      const manifest = validateManifest(JSON.parse(manifestBytes) as unknown)
      if (`${JSON.stringify(manifest)}\n` !== manifestBytes) throw new Error('Shared snapshot manifest is not canonical JSON.')
      const artifactUrl = new URL(manifest.snapshotPath, this.endpoint)
      if (artifactUrl.origin !== this.endpoint.origin || artifactUrl.pathname !== manifest.snapshotPath) {
        throw new Error('Shared snapshot path is outside the configured origin.')
      }
      const bytes = await this.fetchText(artifactUrl, MAX_SHARED_SNAPSHOT_BYTES)
      this.artifact = verifyArtifact(manifest, bytes, now)
      let cacheError: string | null = null
      try { this.saveCache(this.artifact) } catch (error) { cacheError = safeError(error) }
      const stale = now - Date.parse(this.artifact.snapshot.createdAt) > SHARED_SNAPSHOT_STALE_AFTER_MS
      this.state = stale ? 'stale' : cacheError ? 'error' : 'fresh'
      this.message = cacheError
        ? `The shared snapshot was verified but could not be cached on this device (${cacheError}).`
        : stale
        ? 'The shared source returned its latest artifact, but the artifact is more than 2 hours old.'
        : 'Using the verified shared public snapshot and its published evaluation time.'
    } catch (error) {
      const reason = safeError(error)
      if (this.artifact) {
        const stale = now - Date.parse(this.artifact.snapshot.createdAt) > SHARED_SNAPSHOT_STALE_AFTER_MS
        this.state = stale ? 'stale' : 'error'
        this.message = stale
          ? `Shared source unavailable (${reason}); showing the last verified shared snapshot, which is stale.`
          : `Shared source unavailable (${reason}); showing the last verified shared snapshot.`
      } else {
        this.state = this.endpointError ? 'invalid-configuration' : 'error'
        this.message = `No verified shared public snapshot is available (${reason}).`
      }
    }
    return { snapshot: this.artifact?.snapshot ?? null, status: this.status(now) }
  }

  private async fetchText(url: URL, maxBytes: number): Promise<string> {
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: AbortSignal.timeout(SHARED_SNAPSHOT_TIMEOUT_MS),
    })
    if (response.status !== 200) throw new Error(`Shared source responded ${response.status}.`)
    return boundedText(response, maxBytes)
  }

  private loadCache(): void {
    try {
      if (!existsSync(this.options.cachePath)) return
      const stat = statSync(this.options.cachePath)
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SHARED_SNAPSHOT_BYTES + MAX_SHARED_MANIFEST_BYTES + 2_048) return
      const value = JSON.parse(readFileSync(this.options.cachePath, 'utf8')) as unknown
      if (!record(value) || Object.keys(value).sort().join(',') !== 'endpointOrigin,manifest,schema,snapshot'
        || value.schema !== cacheSchema || value.endpointOrigin !== this.endpoint?.origin) return
      const manifest = validateManifest(value.manifest)
      const bytes = `${JSON.stringify(value.snapshot)}\n`
      this.artifact = verifyArtifact(manifest, bytes, this.now())
    } catch {
      this.artifact = null
    }
  }

  private saveCache(artifact: VerifiedArtifact): void {
    const directory = dirname(this.options.cachePath)
    const text = `${JSON.stringify({ schema: cacheSchema, endpointOrigin: this.endpoint?.origin, manifest: artifact.manifest, snapshot: JSON.parse(artifact.bytes) })}\n`
    if (Buffer.byteLength(text, 'utf8') > MAX_SHARED_SNAPSHOT_BYTES + MAX_SHARED_MANIFEST_BYTES + 2_048) {
      throw new Error('Shared snapshot cache exceeds the byte limit.')
    }
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const temp = `${this.options.cachePath}.${process.pid}.${randomUUID()}.tmp`
    try {
      writeFileSync(temp, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      renameSync(temp, this.options.cachePath)
    } catch (error) {
      try { unlinkSync(temp) } catch { /* The write may have failed before creating the temporary file. */ }
      throw new Error(`Could not cache the verified shared snapshot: ${safeError(error)}`)
    }
  }
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'request failed'
  return message.replace(/[\r\n\u0000-\u001f]/g, ' ').slice(0, 240)
}
