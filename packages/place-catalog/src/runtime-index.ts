/** Node-only disk-backed GeoNames catalog index. Keep this subpath out of renderer bundles. */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, link, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { basename, dirname, join, resolve } from 'node:path'

export const PLACE_INDEX_SCHEMA_VERSION = 1
export const PLACE_INDEX_LIMITS = {
  inputBytes: 4_000_000_000,
  maxLineBytes: 1_000_000,
  maxResults: 50,
  maxChildren: 100,
  maxAncestors: 16,
} as const

export type IndexedPlace = {
  id: string
  geonameId: number
  kind: 'country' | 'admin1' | 'admin2' | 'populated-place'
  name: string
  asciiName: string
  countryCode: string
  parentId?: string
  admin1Code?: string
  admin2Code?: string
  featureCode?: string
  latitude?: number
  longitude?: number
  population?: number
  precision: 'country' | 'admin1-point' | 'admin2-point' | 'populated-place-point'
}

export type PlaceIndexMetadata = {
  schemaVersion: 1
  provider: 'geonames'
  snapshotDate: string
  scope: 'allCountries-populated-features' | 'cities15000-subset'
  coverageNote: string
  license: 'CC-BY-4.0'
  attribution: 'GeoNames (https://www.geonames.org/)'
  sourceManifestSha256: string
  sourceDataSha256: string
  sourceNodeCount: number
  indexedNodeCount: number
  indexedPlaceCount: number
  generatedAt: string
}

export type ExactSearchResult =
  | { status: 'resolved'; place: IndexedPlace; coverage: 'catalog-scope' }
  | { status: 'ambiguous'; candidates: IndexedPlace[]; truncated: boolean; coverage: 'catalog-scope' }
  | { status: 'not-found'; coverage: 'catalog-scope' | 'country-not-in-catalog'; scope: PlaceIndexMetadata['scope'] }
  | { status: 'unsupported-country'; coverage: 'country-not-in-catalog'; countryCode: string; scope: PlaceIndexMetadata['scope'] }

export type PlaceChildrenCursor = { nameNorm: string; kind: IndexedPlace['kind']; geonameId: number }
export type PlaceChildrenPage = { children: IndexedPlace[]; nextCursor?: PlaceChildrenCursor }

export type IndexBuildOptions = {
  catalogDirectory: string
  outputPath: string
  now?: () => number
  onProgress?: (progress: { indexedRows: number; bytesRead: number }) => void
}

type RawIndexManifest = {
  formatVersion: number
  dataset: string
  snapshotDate: string
  sourceScope: string
  coverageNote: string
  output: { file: string; sha256: string }
  counts: { countries: number; admin1: number; admin2: number; populatedPlaces: number }
}

export type PlaceIndexReconciliation = {
  previous: Pick<PlaceIndexMetadata, 'snapshotDate' | 'scope' | 'sourceDataSha256' | 'indexedNodeCount' | 'indexedPlaceCount'>
  next: Pick<PlaceIndexMetadata, 'snapshotDate' | 'scope' | 'sourceDataSha256' | 'indexedNodeCount' | 'indexedPlaceCount'>
  addedCount: number
  removedCount: number
  changedCount: number
  samples: { added: string[]; removed: string[]; changed: string[] }
  sampleLimit: number
}

const countryCodePattern = /^[A-Z]{2}$/
const idPattern = /^geonames:[1-9]\d{0,15}$/
const shaPattern = /^[a-f0-9]{64}$/i
const maxManifestBytes = 64 * 1024

export function normalizePlaceName(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function validateManifest(value: unknown): RawIndexManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Catalog manifest must be an object.')
  const raw = value as Partial<RawIndexManifest>
  if (raw.formatVersion !== 1 || raw.dataset !== 'GeoNames place catalog' ||
      typeof raw.snapshotDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.snapshotDate) ||
      !['allCountries-populated-features', 'cities15000-subset'].includes(raw.sourceScope ?? '') ||
      typeof raw.coverageNote !== 'string' || !raw.coverageNote.trim() || raw.coverageNote.length > 2_000 ||
      !raw.output || raw.output.file !== 'places.ndjson' || !shaPattern.test(raw.output.sha256) ||
      !raw.counts || !['countries', 'admin1', 'admin2', 'populatedPlaces'].every((key) => {
        const count = raw.counts?.[key as keyof RawIndexManifest['counts']]
        return Number.isSafeInteger(count) && (count as number) >= 0
      })) {
    throw new Error('Catalog manifest has unsupported or malformed metadata.')
  }
  const date = new Date(`${raw.snapshotDate}T00:00:00.000Z`)
  if (date.toISOString().slice(0, 10) !== raw.snapshotDate) throw new Error('Catalog snapshot date is invalid.')
  return raw as RawIndexManifest
}

/** Read UTF-8 lines while enforcing the byte limit before a whole line is assembled. */
async function* boundedUtf8Lines(path: string, maxLineBytes: number): AsyncGenerator<{ line: string; bytes: number }> {
  let fragments: Buffer[] = []
  let lineBytes = 0
  let pendingCR = false
  for await (const rawChunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
    const chunk = rawChunk as Buffer
    let start = 0
    for (let i = 0; i < chunk.length; i += 1) {
      if (chunk[i] !== 10) continue
      const piece = chunk.subarray(start, i)
      lineBytes += piece.length
      if (lineBytes > maxLineBytes) throw new Error('GeoNames NDJSON line exceeds the 1 MB limit.')
      if (piece.length) fragments.push(piece)
      let bytes = lineBytes
      let raw = fragments.length === 1 ? fragments[0]! : Buffer.concat(fragments, lineBytes)
      if (raw.length && raw[raw.length - 1] === 13) { raw = raw.subarray(0, raw.length - 1); bytes -= 1 }
      yield { line: raw.toString('utf8'), bytes }
      fragments = []
      lineBytes = 0
      pendingCR = false
      start = i + 1
    }
    const tail = chunk.subarray(start)
    if (tail.length) {
      lineBytes += tail.length
      if (lineBytes > maxLineBytes) throw new Error('GeoNames NDJSON line exceeds the 1 MB limit.')
      fragments.push(tail)
      pendingCR = tail[tail.length - 1] === 13
    }
  }
  if (lineBytes || fragments.length) {
    const raw = fragments.length === 1 ? fragments[0]! : Buffer.concat(fragments, lineBytes)
    const bytes = lineBytes - (pendingCR ? 1 : 0)
    yield { line: raw.toString('utf8').replace(/\r$/, ''), bytes }
  }
}

function validatePlace(value: unknown): IndexedPlace {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('NDJSON row must be a place object.')
  const row = value as Record<string, unknown>
  const kinds = ['country', 'admin1', 'admin2', 'populated-place']
  const precision = ['country', 'admin1-point', 'admin2-point', 'populated-place-point']
  if (typeof row['id'] !== 'string' || !idPattern.test(row['id']) ||
      !Number.isSafeInteger(row['geonameId']) || (row['geonameId'] as number) <= 0 ||
      row['geonameId'] !== Number(row['id'].slice('geonames:'.length)) ||
      typeof row['kind'] !== 'string' || !kinds.includes(row['kind']) ||
      typeof row['name'] !== 'string' || row['name'].length === 0 || row['name'].length > 1_000 ||
      typeof row['asciiName'] !== 'string' || row['asciiName'].length === 0 || row['asciiName'].length > 1_000 ||
      typeof row['countryCode'] !== 'string' || !countryCodePattern.test(row['countryCode']) ||
      typeof row['precision'] !== 'string' || !precision.includes(row['precision']) ||
      ('parentId' in row && (typeof row['parentId'] !== 'string' || !idPattern.test(row['parentId']))) ||
      ('latitude' in row && (typeof row['latitude'] !== 'number' || !Number.isFinite(row['latitude']) || row['latitude'] < -90 || row['latitude'] > 90)) ||
      ('longitude' in row && (typeof row['longitude'] !== 'number' || !Number.isFinite(row['longitude']) || row['longitude'] < -180 || row['longitude'] > 180)) ||
      (row['kind'] === 'populated-place' && (!('latitude' in row) || !('longitude' in row)))) {
    throw new Error('NDJSON row does not satisfy the bounded place record contract.')
  }
  const precisionForKind: Record<string, string> = { country: 'country', admin1: 'admin1-point', admin2: 'admin2-point', 'populated-place': 'populated-place-point' }
  if (row['precision'] !== precisionForKind[row['kind'] as string]) throw new Error('Place kind and precision do not match.')
  for (const key of ['admin1Code', 'admin2Code', 'featureCode'] as const) {
    if (key in row && (typeof row[key] !== 'string' || row[key].length > 128)) throw new Error(`Invalid ${key} in place record.`)
  }
  if ('population' in row && (typeof row['population'] !== 'number' || !Number.isFinite(row['population']) || row['population'] < 0)) {
    throw new Error('Invalid population in place record.')
  }
  return row as unknown as IndexedPlace
}

function createSchema(database: DatabaseSync): void {
  database.exec(`
    PRAGMA page_size = 4096;
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA temp_store = FILE;
    PRAGMA cache_size = -64000;
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
    CREATE TABLE places (
      id TEXT PRIMARY KEY,
      geonameId INTEGER NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK(kind IN ('country','admin1','admin2','populated-place')),
      name TEXT NOT NULL,
      asciiName TEXT NOT NULL,
      nameNorm TEXT NOT NULL,
      asciiNorm TEXT NOT NULL,
      countryCode TEXT NOT NULL,
      parentId TEXT REFERENCES places(id),
      admin1Code TEXT,
      admin2Code TEXT,
      featureCode TEXT,
      latitude REAL,
      longitude REAL,
      population REAL,
      precision TEXT NOT NULL
    );
  `)
}

function encodePlace(row: Record<string, unknown>): string {
  const fields = ['id','geonameId','kind','name','asciiName','nameNorm','asciiNorm','countryCode','parentId','admin1Code','admin2Code','featureCode','latitude','longitude','population','precision'] as const
  return JSON.stringify(Object.fromEntries(fields.flatMap((field) => field in row ? [[field, row[field]]] : [])))
}

/** Stream the global NDJSON catalog into a new, immutable SQLite index. */
export async function buildSqlitePlaceIndex(options: IndexBuildOptions): Promise<PlaceIndexMetadata> {
  const catalogDirectory = resolve(options.catalogDirectory)
  const outputPath = resolve(options.outputPath)
  if (catalogDirectory === outputPath || outputPath.startsWith(`${catalogDirectory}/`)) {
    throw new Error('Place index output must be outside the immutable imported catalog directory.')
  }
  try { await access(outputPath); throw new Error('Place index output already exists; build a new versioned path.') } catch (error) {
    if (error instanceof Error && error.message.includes('already exists')) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const manifestPath = join(catalogDirectory, 'manifest.json')
  const placesPath = join(catalogDirectory, 'places.ndjson')
  const inputStat = await stat(placesPath)
  if (inputStat.size > PLACE_INDEX_LIMITS.inputBytes) throw new Error('GeoNames input exceeds the 4 GB indexed import limit.')
  const manifestBytes = await readFile(manifestPath)
  if (manifestBytes.length > maxManifestBytes) throw new Error('GeoNames manifest exceeds the 64 KB limit.')
  const rawManifest = validateManifest(JSON.parse(manifestBytes.toString('utf8')))
  if (rawManifest.sourceScope !== 'allCountries-populated-features' && rawManifest.sourceScope !== 'cities15000-subset') {
    throw new Error('Unsupported source scope.')
  }
  const dataHash = await sha256File(placesPath)
  if (dataHash !== rawManifest.output.sha256) throw new Error('GeoNames NDJSON hash does not match the imported manifest.')
  const manifestHash = createHash('sha256').update(manifestBytes).digest('hex')
  const expectedRows = rawManifest.counts.countries + rawManifest.counts.admin1 + rawManifest.counts.admin2 + rawManifest.counts.populatedPlaces
  if (!Number.isSafeInteger(expectedRows) || expectedRows <= 0 || expectedRows > 6_000_000) throw new Error('Manifest record count exceeds the supported index bounds.')

  await mkdir(dirname(outputPath), { recursive: true })
  const stagingPath = join(dirname(outputPath), `.${basename(outputPath)}.${randomUUID()}.staging`)
  const database = new DatabaseSync(stagingPath)
  let indexedRows = 0
  let bytesRead = 0
  let insert: ReturnType<DatabaseSync['prepare']> | undefined
  const now = options.now ?? Date.now
  try {
    createSchema(database)
    insert = database.prepare(`INSERT INTO places
      (id,geonameId,kind,name,asciiName,nameNorm,asciiNorm,countryCode,parentId,admin1Code,admin2Code,featureCode,latitude,longitude,population,precision)
      VALUES (@id,@geonameId,@kind,@name,@asciiName,@nameNorm,@asciiNorm,@countryCode,@parentId,@admin1Code,@admin2Code,@featureCode,@latitude,@longitude,@population,@precision)`)
    database.exec('BEGIN IMMEDIATE')
    for await (const { line, bytes } of boundedUtf8Lines(placesPath, PLACE_INDEX_LIMITS.maxLineBytes)) {
        bytesRead += bytes + 1
        if (bytesRead > PLACE_INDEX_LIMITS.inputBytes) throw new Error('GeoNames input exceeds the 4 GB indexed import limit.')
        if (!line) continue
        const place = validatePlace(JSON.parse(line))
        const row = {
          ...place,
          nameNorm: normalizePlaceName(place.name),
          asciiNorm: normalizePlaceName(place.asciiName),
          parentId: place.parentId ?? null,
          admin1Code: place.admin1Code ?? null,
          admin2Code: place.admin2Code ?? null,
          featureCode: place.featureCode ?? null,
          latitude: place.latitude ?? null,
          longitude: place.longitude ?? null,
          population: place.population ?? null,
        }
        insert.run(row)
        indexedRows += 1
        if (indexedRows % 100_000 === 0) options.onProgress?.({ indexedRows, bytesRead })
    }
    if (indexedRows !== expectedRows) throw new Error(`Catalog row count mismatch: expected ${expectedRows}, indexed ${indexedRows}.`)
    database.exec(`COMMIT;
      CREATE INDEX places_name_country_admin1_idx ON places(nameNorm, countryCode, admin1Code, kind, geonameId);
      CREATE INDEX places_ascii_country_admin1_idx ON places(asciiNorm, countryCode, admin1Code, kind, geonameId);
      CREATE INDEX places_name_parent_idx ON places(parentId, nameNorm, kind, geonameId);
      CREATE INDEX places_ascii_parent_idx ON places(parentId, asciiNorm, kind, geonameId);
      CREATE INDEX places_country_kind_idx ON places(countryCode, kind, geonameId);`)
    const dangling = database.prepare('SELECT COUNT(*) AS count FROM places child LEFT JOIN places parent ON parent.id=child.parentId WHERE child.parentId IS NOT NULL AND parent.id IS NULL').get() as { count: number }
    if (dangling.count !== 0) throw new Error(`Index contains ${dangling.count} unresolved parent IDs.`)
    const populated = database.prepare("SELECT COUNT(*) AS count FROM places WHERE kind='populated-place'").get() as { count: number }
    const metadata: PlaceIndexMetadata = {
      schemaVersion: PLACE_INDEX_SCHEMA_VERSION,
      provider: 'geonames',
      snapshotDate: rawManifest.snapshotDate,
      scope: rawManifest.sourceScope,
      coverageNote: rawManifest.coverageNote,
      license: 'CC-BY-4.0',
      attribution: 'GeoNames (https://www.geonames.org/)',
      sourceManifestSha256: manifestHash,
      sourceDataSha256: dataHash,
      sourceNodeCount: expectedRows,
      indexedNodeCount: indexedRows,
      indexedPlaceCount: populated.count,
      generatedAt: new Date(now()).toISOString(),
    }
    database.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run('place-index-metadata', JSON.stringify(metadata))
    database.exec('PRAGMA optimize;')
    const integrity = database.prepare('PRAGMA quick_check').get() as { quick_check: string }
    if (integrity.quick_check !== 'ok') throw new Error(`SQLite quick_check failed: ${integrity.quick_check}`)
    database.close()
    const afterStat = await stat(placesPath)
    if (afterStat.size !== inputStat.size || afterStat.mtimeMs !== inputStat.mtimeMs || await sha256File(placesPath) !== dataHash) {
      throw new Error('GeoNames input changed during indexing; staging index discarded.')
    }
    const handle = await open(stagingPath, 'r')
    try { await handle.sync() } finally { await handle.close() }
    await link(stagingPath, outputPath)
    await rm(stagingPath, { force: true })
    return metadata
  } catch (error) {
    try { database.close() } catch { /* already closed */ }
    await rm(stagingPath, { force: true }).catch(() => undefined)
    await rm(`${stagingPath}-journal`, { force: true }).catch(() => undefined)
    throw error
  }
}

export class IndexedPlaceCatalog {
  readonly metadata: PlaceIndexMetadata
  private readonly database: DatabaseSync
  private readonly countryExists: ReturnType<DatabaseSync['prepare']>
  private readonly byId: ReturnType<DatabaseSync['prepare']>
  private readonly children: ReturnType<DatabaseSync['prepare']>
  private readonly exactName: ReturnType<DatabaseSync['prepare']>
  private closed = false

  constructor(path: string) {
    this.database = new DatabaseSync(resolve(path), { readOnly: true })
    try {
      this.database.exec('PRAGMA query_only = ON; PRAGMA foreign_keys = ON;')
      const row = this.database.prepare("SELECT value FROM metadata WHERE key='place-index-metadata'").get() as { value?: string } | undefined
      let metadata: PlaceIndexMetadata | undefined
      try { metadata = row?.value ? JSON.parse(row.value) as PlaceIndexMetadata : undefined } catch { /* validation below */ }
      if (!metadata || metadata.schemaVersion !== PLACE_INDEX_SCHEMA_VERSION || metadata.provider !== 'geonames' ||
          !shaPattern.test(metadata.sourceDataSha256) || !shaPattern.test(metadata.sourceManifestSha256) ||
          !Number.isSafeInteger(metadata.indexedNodeCount) || !Number.isSafeInteger(metadata.indexedPlaceCount) ||
          !['allCountries-populated-features', 'cities15000-subset'].includes(metadata.scope)) {
        throw new Error('SQLite place index metadata is missing or unsupported.')
      }
      this.metadata = metadata
      this.countryExists = this.database.prepare("SELECT 1 AS present FROM places WHERE kind='country' AND countryCode=? LIMIT 1")
      this.byId = this.database.prepare('SELECT * FROM places WHERE id=? LIMIT 1')
      this.children = this.database.prepare('SELECT * FROM places WHERE parentId=? ORDER BY nameNorm,kind,geonameId LIMIT ?')
      this.exactName = this.database.prepare(`SELECT * FROM (
        SELECT * FROM places WHERE nameNorm=? AND (? IS NULL OR countryCode=?) AND (? IS NULL OR admin1Code=?)
        UNION
        SELECT * FROM places WHERE asciiNorm=? AND (? IS NULL OR countryCode=?) AND (? IS NULL OR admin1Code=?)
      ) ORDER BY countryCode,kind,geonameId LIMIT ?`)
    } catch (error) {
      try { this.database.close() } catch { /* sqlite open/prepare failure */ }
      throw error
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.database.close()
  }

  getById(id: string): IndexedPlace | null {
    this.assertOpen()
    if (!idPattern.test(id)) return null
    const row = this.byId.get(id) as Record<string, unknown> | undefined
    return row ? this.toPlace(row) : null
  }

  coverageForCountry(countryCode: string): 'catalog-scope' | 'country-not-in-catalog' {
    this.assertOpen()
    const code = countryCode.toUpperCase()
    if (!countryCodePattern.test(code)) return 'country-not-in-catalog'
    return this.countryExists.get(code) ? 'catalog-scope' : 'country-not-in-catalog'
  }

  searchExactName(name: string, options: { countryCode?: string; admin1Code?: string; limit?: number } = {}): ExactSearchResult {
    this.assertOpen()
    if (typeof name !== 'string' || name.length > 1_000) throw new RangeError('name must be a string of at most 1000 characters')
    if (options.countryCode !== undefined && !countryCodePattern.test(options.countryCode.toUpperCase())) throw new TypeError('countryCode must be a two-letter code')
    if (options.admin1Code !== undefined && options.admin1Code.length > 128) throw new RangeError('admin1Code exceeds the 128 character limit')
    const normalized = normalizePlaceName(name)
    const countryCode = options.countryCode?.toUpperCase() ?? null
    const admin1Code = options.admin1Code ?? null
    const limit = options.limit ?? 20
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > PLACE_INDEX_LIMITS.maxResults) throw new RangeError(`limit must be between 1 and ${PLACE_INDEX_LIMITS.maxResults}`)
    if (!normalized) return { status: 'not-found', coverage: countryCode && this.coverageForCountry(countryCode) === 'country-not-in-catalog' ? 'country-not-in-catalog' : 'catalog-scope', scope: this.metadata.scope }
    if (countryCode && this.coverageForCountry(countryCode) === 'country-not-in-catalog') {
      return { status: 'unsupported-country', coverage: 'country-not-in-catalog', countryCode, scope: this.metadata.scope }
    }
    const rows = this.exactName.all(normalized, countryCode, countryCode, admin1Code, admin1Code, normalized, countryCode, countryCode, admin1Code, admin1Code, limit + 1) as Array<Record<string, unknown>>
    const truncated = rows.length > limit
    const candidates = rows.slice(0, limit).map((row) => this.toPlace(row))
    if (candidates.length === 1 && !truncated) return { status: 'resolved', place: candidates[0]!, coverage: 'catalog-scope' }
    if (candidates.length > 0) return { status: 'ambiguous', candidates, truncated, coverage: 'catalog-scope' }
    return { status: 'not-found', coverage: 'catalog-scope', scope: this.metadata.scope }
  }

  getChildren(parentId: string, options: { limit?: number } = {}): IndexedPlace[] {
    return this.getChildrenPage(parentId, options).children
  }

  /** Fetch one child page; use nextCursor until it is absent to traverse every sibling. */
  getChildrenPage(parentId: string, options: { limit?: number; cursor?: PlaceChildrenCursor } = {}): PlaceChildrenPage {
    this.assertOpen()
    if (!idPattern.test(parentId)) return { children: [] }
    const limit = options.limit ?? 50
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > PLACE_INDEX_LIMITS.maxChildren) throw new RangeError(`limit must be between 1 and ${PLACE_INDEX_LIMITS.maxChildren}`)
    const cursor = options.cursor
    if (cursor && (typeof cursor.nameNorm !== 'string' || cursor.nameNorm.length > 2_000 ||
        !['country', 'admin1', 'admin2', 'populated-place'].includes(cursor.kind) ||
        !Number.isSafeInteger(cursor.geonameId) || cursor.geonameId <= 0)) throw new TypeError('Invalid child-page cursor')
    const rows = (cursor
      ? this.database.prepare('SELECT * FROM places WHERE parentId=? AND (nameNorm,kind,geonameId) > (?, ?, ?) ORDER BY nameNorm,kind,geonameId LIMIT ?').all(parentId, cursor.nameNorm, cursor.kind, cursor.geonameId, limit + 1)
      : this.children.all(parentId, limit + 1)) as Array<Record<string, unknown>>
    const hasMore = rows.length > limit
    const children = rows.slice(0, limit).map((row) => this.toPlace(row))
    const last = children.at(-1)
    return {
      children,
      ...(hasMore && last ? { nextCursor: { nameNorm: normalizePlaceName(last.name), kind: last.kind, geonameId: last.geonameId } } : {}),
    }
  }

  getAncestors(id: string): IndexedPlace[] {
    this.assertOpen()
    if (!idPattern.test(id)) return []
    const result: IndexedPlace[] = []
    const visited = new Set<string>([id])
    let current = this.getById(id)
    for (let hops = 0; current?.parentId && hops < PLACE_INDEX_LIMITS.maxAncestors; hops += 1) {
      if (visited.has(current.parentId)) throw new Error('Place index contains a parent cycle.')
      visited.add(current.parentId)
      const parent = this.getById(current.parentId)
      if (!parent) break
      result.push(parent)
      current = parent
    }
    return result
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Place index is closed.')
  }

  private toPlace(row: Record<string, unknown>): IndexedPlace {
    const place = {
      id: row['id'], geonameId: row['geonameId'], kind: row['kind'], name: row['name'], asciiName: row['asciiName'],
      countryCode: row['countryCode'], precision: row['precision'],
      ...(row['parentId'] === null ? {} : { parentId: row['parentId'] }),
      ...(row['admin1Code'] === null ? {} : { admin1Code: row['admin1Code'] }),
      ...(row['admin2Code'] === null ? {} : { admin2Code: row['admin2Code'] }),
      ...(row['featureCode'] === null ? {} : { featureCode: row['featureCode'] }),
      ...(row['latitude'] === null ? {} : { latitude: row['latitude'] }),
      ...(row['longitude'] === null ? {} : { longitude: row['longitude'] }),
      ...(row['population'] === null ? {} : { population: row['population'] }),
    }
    return place as IndexedPlace
  }
}

export function openIndexedPlaceCatalog(path: string): IndexedPlaceCatalog {
  return new IndexedPlaceCatalog(path)
}

/** Resolve the atomically published pointer and ensure it names the expected immutable index. */
export async function openPublishedPlaceCatalog(pointerPath: string): Promise<IndexedPlaceCatalog> {
  const absolutePointerPath = resolve(pointerPath)
  const pointerHandle = await open(absolutePointerPath, 'r')
  let pointerText: string
  try {
    const pointerStat = await pointerHandle.stat()
    if (!pointerStat.isFile() || pointerStat.size > 4_096) throw new Error('Place index pointer must be a regular file no larger than 4 KB.')
    const buffer = Buffer.alloc(4_097)
    const { bytesRead } = await pointerHandle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > 4_096) throw new Error('Place index pointer exceeds the 4 KB limit.')
    pointerText = buffer.subarray(0, bytesRead).toString('utf8')
  } finally { await pointerHandle.close() }
  let parsed: unknown
  try { parsed = JSON.parse(pointerText) } catch { throw new Error('Place index pointer is malformed.') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Place index pointer must be a JSON object.')
  const pointer = parsed as Record<string, unknown>
  if (pointer['schemaVersion'] !== PLACE_INDEX_SCHEMA_VERSION || typeof pointer['file'] !== 'string' ||
      pointer['file'].length > 255 || basename(pointer['file']) !== pointer['file'] || pointer['file'] === '.' || pointer['file'] === '..' ||
      typeof pointer['sourceDataSha256'] !== 'string' || !shaPattern.test(pointer['sourceDataSha256']) ||
      typeof pointer['sourceManifestSha256'] !== 'string' || !shaPattern.test(pointer['sourceManifestSha256'])) {
    throw new Error('Place index pointer has unsupported or unsafe metadata.')
  }
  const indexPath = join(dirname(absolutePointerPath), pointer['file'])
  const catalog = openIndexedPlaceCatalog(indexPath)
  if (catalog.metadata.sourceDataSha256 !== pointer['sourceDataSha256'] ||
      catalog.metadata.sourceManifestSha256 !== pointer['sourceManifestSha256'] ||
      catalog.metadata.snapshotDate !== pointer['snapshotDate']) {
    catalog.close()
    throw new Error('Place index pointer does not match the indexed catalog metadata.')
  }
  return catalog
}

/** Atomically publish a small current-version pointer after a new index passes checks. */
export async function publishPlaceIndexPointer(indexPath: string, pointerPath: string): Promise<void> {
  const absoluteIndex = resolve(indexPath)
  const destination = resolve(pointerPath)
  if (absoluteIndex === destination) throw new Error('Place index pointer cannot overwrite its SQLite index file.')
  if (dirname(absoluteIndex) !== dirname(destination)) throw new Error('Place index pointer must be published beside its immutable index file.')
  const catalog = openIndexedPlaceCatalog(absoluteIndex)
  const metadata = catalog.metadata
  catalog.close()
  const pointer = JSON.stringify({
    schemaVersion: PLACE_INDEX_SCHEMA_VERSION,
    file: basename(absoluteIndex),
    snapshotDate: metadata.snapshotDate,
    sourceDataSha256: metadata.sourceDataSha256,
    sourceManifestSha256: metadata.sourceManifestSha256,
  })
  await mkdir(dirname(destination), { recursive: true })
  const staging = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`)
  try {
    await writeFile(staging, pointer, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(staging, destination)
  } catch (error) {
    await rm(staging, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Compare two immutable snapshots by stable GeoNames ID without loading millions of nodes into memory. */
export function reconcilePlaceIndexes(previousPath: string, nextPath: string, options: { sampleLimit?: number } = {}): PlaceIndexReconciliation {
  const sampleLimit = options.sampleLimit ?? 100
  if (!Number.isSafeInteger(sampleLimit) || sampleLimit < 0 || sampleLimit > 1_000) throw new RangeError('sampleLimit must be between 0 and 1000')
  const previous = new DatabaseSync(resolve(previousPath), { readOnly: true })
  try {
    previous.exec('PRAGMA query_only=ON')
    const nextCatalog = openIndexedPlaceCatalog(nextPath)
    nextCatalog.close()
    const nextUriPath = resolve(nextPath).replaceAll('%', '%25').replaceAll('?', '%3f').replaceAll('#', '%23')
    const nextUri = `file:${nextUriPath}?mode=ro`.replaceAll("'", "''")
    previous.exec(`ATTACH DATABASE '${nextUri}' AS next_index`)
    previous.exec('PRAGMA next_index.query_only=ON')
    const readMetadata = (schema: string): PlaceIndexMetadata => {
      const row = previous.prepare(`SELECT value FROM ${schema}.metadata WHERE key='place-index-metadata'`).get() as { value?: string } | undefined
      let value: PlaceIndexMetadata | undefined
      try { value = row?.value ? JSON.parse(row.value) as PlaceIndexMetadata : undefined } catch { /* validated below */ }
      if (!value || value.schemaVersion !== PLACE_INDEX_SCHEMA_VERSION || value.provider !== 'geonames' ||
          !shaPattern.test(value.sourceDataSha256) || !shaPattern.test(value.sourceManifestSha256) ||
          !Number.isSafeInteger(value.indexedNodeCount) || !Number.isSafeInteger(value.indexedPlaceCount) ||
          !['allCountries-populated-features', 'cities15000-subset'].includes(value.scope)) {
        throw new Error(`SQLite place index metadata is missing or unsupported (${schema}).`)
      }
      return value
    }
    const old = readMetadata('main')
    const next = readMetadata('next_index')
    if (old.scope !== next.scope) throw new Error('Cannot reconcile place indexes with different source scopes.')
    const differences = `old.kind IS NOT new.kind OR old.name IS NOT new.name OR old.asciiName IS NOT new.asciiName OR
      old.countryCode IS NOT new.countryCode OR old.parentId IS NOT new.parentId OR old.admin1Code IS NOT new.admin1Code OR
      old.admin2Code IS NOT new.admin2Code OR old.featureCode IS NOT new.featureCode OR old.latitude IS NOT new.latitude OR
      old.longitude IS NOT new.longitude OR old.population IS NOT new.population OR old.precision IS NOT new.precision`
    const count = (sql: string): number => Number((previous.prepare(sql).get() as { count: number }).count)
    const addedCount = count('SELECT COUNT(*) AS count FROM next_index.places n LEFT JOIN main.places o USING(id) WHERE o.id IS NULL')
    const removedCount = count('SELECT COUNT(*) AS count FROM main.places o LEFT JOIN next_index.places n USING(id) WHERE n.id IS NULL')
    const changedCount = count(`SELECT COUNT(*) AS count FROM main.places old JOIN next_index.places new USING(id) WHERE ${differences}`)
    const samples = (sql: string): string[] => sampleLimit === 0 ? [] :
      (previous.prepare(sql).all(sampleLimit) as Array<{ id: string }>).map(row => row.id)
    return {
      previous: { snapshotDate: old.snapshotDate, scope: old.scope, sourceDataSha256: old.sourceDataSha256, indexedNodeCount: old.indexedNodeCount, indexedPlaceCount: old.indexedPlaceCount },
      next: { snapshotDate: next.snapshotDate, scope: next.scope, sourceDataSha256: next.sourceDataSha256, indexedNodeCount: next.indexedNodeCount, indexedPlaceCount: next.indexedPlaceCount },
      addedCount,
      removedCount,
      changedCount,
      samples: {
        added: samples('SELECT n.id FROM next_index.places n LEFT JOIN main.places o USING(id) WHERE o.id IS NULL ORDER BY n.geonameId LIMIT ?'),
        removed: samples('SELECT o.id FROM main.places o LEFT JOIN next_index.places n USING(id) WHERE n.id IS NULL ORDER BY o.geonameId LIMIT ?'),
        changed: samples(`SELECT old.id FROM main.places old JOIN next_index.places new USING(id) WHERE ${differences} ORDER BY old.geonameId LIMIT ?`),
      },
      sampleLimit,
    }
  } finally {
    try { previous.exec('DETACH DATABASE next_index') } catch { /* attachment may not have succeeded */ }
    previous.close()
  }
}
