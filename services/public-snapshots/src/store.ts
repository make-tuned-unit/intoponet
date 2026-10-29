import { createHash, randomUUID } from 'node:crypto'
import {
  mkdirSync,
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  renameSync,
  linkSync,
  unlinkSync,
  openSync,
  closeSync,
  fsyncSync,
} from 'node:fs'
import path from 'node:path'
import { fieldSnapshotSchema, isUtcTimestamp, parseFieldSnapshot, type FieldSnapshot } from '@intoponet/field-snapshot'

export const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024
export const MAX_SNAPSHOT_SOURCES = 10_000
const snapshotIdPattern = /^snapshot-v1-[a-f0-9]{64}$/
const manifestSchema = 'intoponet.shared-public-snapshot-latest.v1'

export type LatestManifest = {
  schema: typeof manifestSchema
  snapshotId: string
  sha256: string
  evaluationTime: string
  snapshotPath: string
}

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function snapshotPath(storeDir: string, id: string): string {
  if (!snapshotIdPattern.test(id)) throw new Error('Invalid canonical snapshot ID.')
  return path.join(storeDir, `${id}.json`)
}

function boundedText(value: unknown, maxLength: number, field: string, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && !value.trim())) {
    throw new Error(`Public snapshot ${field} must be a non-empty string of at most ${maxLength} characters.`)
  }
}

function validatePublicSource(source: unknown, index: number): void {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error(`Public source ${index} must be an object.`)
  }
  const record = source as Record<string, unknown>
  boundedText(record.id, 300, `source ${index} ID`)
  boundedText(record.title, 500, `source ${index} title`)
  boundedText(record.url, 2_048, `source ${index} URL`)
  boundedText(record.attribution, 500, `source ${index} attribution`)
  boundedText(record.retrievedAt, 32, `source ${index} retrieval time`)
  boundedText(record.publishedAt, 32, `source ${index} publication time`)
  if (!isUtcTimestamp(record.retrievedAt) || !isUtcTimestamp(record.publishedAt)) {
    throw new Error(`Public source ${index} timestamps must be valid UTC timestamps.`)
  }
  if (typeof record.lat !== 'number' || !Number.isFinite(record.lat) || record.lat < -90 || record.lat > 90
    || typeof record.lon !== 'number' || !Number.isFinite(record.lon) || record.lon < -180 || record.lon > 180) {
    throw new Error(`Public source ${index} coordinates are outside latitude/longitude bounds.`)
  }
  if (typeof record.radiusKm !== 'number' || !Number.isFinite(record.radiusKm)
    || record.radiusKm <= 0 || record.radiusKm > 20_040) {
    throw new Error(`Public source ${index} radius must be positive and at most 20,040 km.`)
  }
  if (!Array.isArray(record.topics) || record.topics.length === 0 || record.topics.length > 40
    || record.topics.some((topic) => typeof topic !== 'string' || !topic.trim() || topic.length > 100)) {
    throw new Error(`Public source ${index} topics are invalid or exceed the limit.`)
  }
  if (typeof record.weight !== 'number' || !Number.isFinite(record.weight) || record.weight <= 0 || record.weight > 5) {
    throw new Error(`Public source ${index} weight must be finite and between 0 and 5.`)
  }
  const measurement = record.measurement
  if (!measurement || typeof measurement !== 'object' || Array.isArray(measurement)) {
    throw new Error(`Public source ${index} measurement is missing.`)
  }
  const metric = measurement as Record<string, unknown>
  if (metric.kind === 'synthetic-fixture' || (typeof metric.kind === 'string' && metric.kind.startsWith('legacy-'))) {
    throw new Error(`Public source ${index} cannot use synthetic or legacy measurement data.`)
  }
  boundedText(metric.unit, 100, `source ${index} measurement unit`)
  boundedText(metric.sourceId, 300, `source ${index} measurement source ID`)
  boundedText(metric.sourceUrl, 2_048, `source ${index} measurement URL`)
  boundedText(metric.transformation, 500, `source ${index} measurement transformation`)
  if (metric.value !== null && (typeof metric.value !== 'number' || !Number.isFinite(metric.value))) {
    throw new Error(`Public source ${index} measurement value must be finite or null.`)
  }
  for (const key of ['scale'] as const) {
    if (metric[key] !== undefined) boundedText(metric[key], 100, `source ${index} measurement ${key}`)
  }
  for (const key of ['windowStart', 'windowEnd'] as const) {
    if (metric[key] !== undefined && !isUtcTimestamp(metric[key])) {
      throw new Error(`Public source ${index} measurement ${key} must be a valid UTC timestamp.`)
    }
  }
  if (record.summary !== undefined) boundedText(record.summary, 2_048, `source ${index} summary`, true)
  if (record.placeLabel !== undefined) boundedText(record.placeLabel, 1_024, `source ${index} place label`, true)
  if (record.thumbnail !== undefined) boundedText(record.thumbnail, 2_048, `source ${index} thumbnail URL`)
  if (record.endedAt !== undefined && !isUtcTimestamp(record.endedAt)) {
    throw new Error(`Public source ${index} end time must be a valid UTC timestamp.`)
  }
  if (record.previousValue !== undefined && record.previousValue !== null
    && (typeof record.previousValue !== 'number' || !Number.isFinite(record.previousValue) || record.previousValue < 0)) {
    throw new Error(`Public source ${index} previous value must be non-negative and finite or null.`)
  }
}

function normalizedBytes(snapshot: FieldSnapshot): Buffer {
  return Buffer.from(`${JSON.stringify(snapshot)}\n`, 'utf8')
}

function projectKnownBandFields(band: unknown): unknown {
  if (!band || typeof band !== 'object' || Array.isArray(band)) return band
  const input = band as Record<string, unknown>
  const measurement = input.measurement
  const normalizedMeasurement = measurement && typeof measurement === 'object' && !Array.isArray(measurement)
    ? {
        kind: (measurement as Record<string, unknown>).kind,
        unit: (measurement as Record<string, unknown>).unit,
        ...((measurement as Record<string, unknown>).scale === undefined
          ? {}
          : { scale: (measurement as Record<string, unknown>).scale }),
      }
    : measurement
  return {
    id: input.id,
    topicIds: input.topicIds,
    lat: input.lat,
    lon: input.lon,
    amplitude: input.amplitude,
    confidence: input.confidence,
    sourceIds: input.sourceIds,
    sourceType: input.sourceType,
    measurement: normalizedMeasurement,
  }
}

function validateForPublication(raw: string): FieldSnapshot {
  const bytes = Buffer.byteLength(raw, 'utf8')
  if (bytes === 0 || bytes > MAX_SNAPSHOT_BYTES) throw new Error('Snapshot payload is empty or exceeds the size limit.')
  let input: unknown
  try {
    input = JSON.parse(raw) as unknown
  } catch {
    throw new Error('Snapshot payload must be valid JSON.')
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Snapshot payload must be an object.')
  const advertised = input as Record<string, unknown>
  if (advertised.schema !== fieldSnapshotSchema || advertised.algorithm !== 'log1p-separated-v3') {
    throw new Error('Only the canonical field-snapshot v3 format can be published.')
  }
  if (!Array.isArray(advertised.sources) || advertised.sources.length === 0
    || advertised.sources.length > MAX_SNAPSHOT_SOURCES) {
    throw new Error('Snapshot source count is outside the publication limits.')
  }
  if (advertised.sources.some((source) => !source || typeof source !== 'object'
    || (source as Record<string, unknown>).kind !== 'public-record')) {
    throw new Error('Shared snapshots may contain public records only.')
  }
  advertised.sources.forEach(validatePublicSource)
  if (typeof advertised.id !== 'string' || !snapshotIdPattern.test(advertised.id)) {
    throw new Error('Snapshot must advertise a canonical content-addressed ID.')
  }
  const parsed = parseFieldSnapshot(raw)
  if (!parsed || parsed.schema !== fieldSnapshotSchema || parsed.algorithm !== 'log1p-separated-v3') {
    throw new Error('Snapshot does not satisfy the canonical field-snapshot contract.')
  }
  if (parsed.sources.length !== advertised.sources.length
    || parsed.sources.some((source) => source.kind !== 'public-record')) {
    throw new Error('Snapshot contains invalid or non-public source records.')
  }
  if (advertised.id !== parsed.id) throw new Error('Advertised snapshot ID does not match normalized public content.')
  if (!Array.isArray(advertised.bands) || advertised.bands.length !== parsed.bands.length) {
    throw new Error('Snapshot bands do not match normalized public content.')
  }
  if (stableJson(advertised.bands.map(projectKnownBandFields)) !== stableJson(parsed.bands)) {
    throw new Error('Snapshot band values do not match normalized public content.')
  }
  if (parsed.bands.some((band) => band.sourceType !== 'public-aggregate')) {
    throw new Error('Shared snapshots cannot contain synthetic aggregate bands.')
  }
  return parsed
}

function writeAtomicTemp(storeDir: string, namePrefix: string, bytes: Buffer): string {
  const temp = path.join(storeDir, `.${namePrefix}.${process.pid}.${randomUUID()}.tmp`)
  const fd = openSync(temp, 'wx', 0o600)
  try {
    writeFileSync(fd, bytes)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  return temp
}

function fsyncDirectory(storeDir: string): void {
  const fd = openSync(storeDir, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function storeSnapshotImmutable(storeDir: string, snapshot: FieldSnapshot, bytes: Buffer): void {
  const target = snapshotPath(storeDir, snapshot.id)
  const temp = writeAtomicTemp(storeDir, snapshot.id, bytes)
  try {
    try {
      // link is create-if-absent, so a concurrent publisher cannot replace an
      // immutable artifact after it becomes visible.
      linkSync(temp, target)
      fsyncDirectory(storeDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = readFileSync(target)
      if (!existing.equals(bytes)) throw new Error('An existing immutable snapshot ID has different bytes.')
    }
  } finally {
    unlinkSync(temp)
  }
}

function replaceLatestAtomically(storeDir: string, manifest: LatestManifest): void {
  const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8')
  const temp = writeAtomicTemp(storeDir, 'latest', bytes)
  try {
    renameSync(temp, path.join(storeDir, 'latest.json'))
    fsyncDirectory(storeDir)
  } finally {
    if (existsSync(temp)) unlinkSync(temp)
  }
}

export function publishSnapshot(raw: string, storeDirInput: string): LatestManifest {
  const snapshot = validateForPublication(raw)
  const storeDir = path.resolve(storeDirInput)
  mkdirSync(storeDir, { recursive: true, mode: 0o700 })
  const bytes = normalizedBytes(snapshot)
  if (bytes.byteLength > MAX_SNAPSHOT_BYTES) throw new Error('Normalized snapshot exceeds the size limit.')
  storeSnapshotImmutable(storeDir, snapshot, bytes)
  const manifest: LatestManifest = {
    schema: manifestSchema,
    snapshotId: snapshot.id,
    sha256: digest(bytes),
    evaluationTime: snapshot.createdAt,
    snapshotPath: `/snapshots/${snapshot.id}`,
  }
  replaceLatestAtomically(storeDir, manifest)
  return manifest
}

function readVerifiedSnapshot(storeDir: string, id: string, expectedHash?: string): { snapshot: FieldSnapshot; bytes: Buffer } | null {
  const file = snapshotPath(storeDir, id)
  if (!existsSync(file)) return null
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SNAPSHOT_BYTES) throw new Error('Stored snapshot is invalid.')
  const bytes = readFileSync(file)
  if (expectedHash && digest(bytes) !== expectedHash) throw new Error('Latest snapshot digest does not match its manifest.')
  const parsed = parseFieldSnapshot(bytes.toString('utf8'))
  if (!parsed || parsed.id !== id || parsed.algorithm !== 'log1p-separated-v3'
    || parsed.sources.length === 0 || parsed.sources.some((source) => source.kind !== 'public-record')
    || parsed.bands.some((band) => band.sourceType !== 'public-aggregate')) {
    throw new Error('Stored snapshot failed canonical public-snapshot validation.')
  }
  if (!normalizedBytes(parsed).equals(bytes)) throw new Error('Stored snapshot bytes are not canonical.')
  return { snapshot: parsed, bytes }
}

function readLatest(storeDir: string): { manifest: LatestManifest; snapshot: FieldSnapshot; bytes: Buffer } | null {
  const file = path.join(storeDir, 'latest.json')
  if (!existsSync(file)) return null
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.size <= 0 || stat.size > 2_048) throw new Error('Latest manifest is invalid.')
  const bytes = readFileSync(file)
  let value: unknown
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown
  } catch {
    throw new Error('Latest manifest is malformed.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Latest manifest is malformed.')
  const manifest = value as Record<string, unknown>
  const keys = Object.keys(manifest).sort().join(',')
  if (keys !== 'evaluationTime,schema,sha256,snapshotId,snapshotPath'
    || manifest.schema !== manifestSchema
    || typeof manifest.snapshotId !== 'string'
    || !snapshotIdPattern.test(manifest.snapshotId)
    || typeof manifest.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(manifest.sha256)
    || typeof manifest.evaluationTime !== 'string'
    || manifest.snapshotPath !== `/snapshots/${manifest.snapshotId}`) {
    throw new Error('Latest manifest failed schema validation.')
  }
  const verified = readVerifiedSnapshot(storeDir, manifest.snapshotId, manifest.sha256)
  if (!verified || verified.snapshot.createdAt !== manifest.evaluationTime) {
    throw new Error('Latest manifest points to a missing or inconsistent snapshot.')
  }
  if (!Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8').equals(bytes)) {
    throw new Error('Latest manifest bytes are not canonical.')
  }
  return { manifest: manifest as LatestManifest, ...verified }
}

export function createPublicSnapshotHandler(storeDirInput: string) {
  const storeDir = path.resolve(storeDirInput)
  return (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => {
    const method = request.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD', 'content-length': '0' })
      response.end()
      return
    }
    let pathname: string
    try {
      pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    } catch {
      response.writeHead(400, { 'content-length': '0' })
      response.end()
      return
    }
    let body: Buffer
    let cacheControl: string
    try {
      if (pathname === '/latest') {
        const latest = readLatest(storeDir)
        if (!latest) {
          response.writeHead(503, { 'content-length': '0', 'cache-control': 'no-store' })
          response.end()
          return
        }
        body = Buffer.from(`${JSON.stringify(latest.manifest)}\n`, 'utf8')
        cacheControl = 'no-store'
      } else {
        const match = /^\/snapshots\/(snapshot-v1-[a-f0-9]{64})$/.exec(pathname)
        if (!match) {
          response.writeHead(404, { 'content-length': '0' })
          response.end()
          return
        }
        const snapshot = readVerifiedSnapshot(storeDir, match[1]!)
        if (!snapshot) {
          response.writeHead(404, { 'content-length': '0' })
          response.end()
          return
        }
        body = snapshot.bytes
        cacheControl = 'public, max-age=31536000, immutable'
      }
    } catch {
      response.writeHead(503, { 'content-length': '0', 'cache-control': 'no-store' })
      response.end()
      return
    }
    const etag = `"sha256-${digest(body)}"`
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(body.byteLength),
      'cache-control': cacheControl,
      etag,
      'x-content-type-options': 'nosniff',
    }
    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304, headers)
      response.end()
      return
    }
    response.writeHead(200, headers)
    response.end(method === 'HEAD' ? undefined : body)
  }
}

export const publicSnapshotManifestSchema = manifestSchema
