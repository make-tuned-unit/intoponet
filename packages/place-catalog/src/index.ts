/** Bounded, pure readers for GeoNames TSV exports. No network or filesystem access. */

export type GazetteerScope = 'allCountries-populated-features' | 'cities15000-subset'
export type PlaceKind = 'country' | 'admin1' | 'admin2' | 'populated-place'
export type PlacePrecision = 'country' | 'admin1-point' | 'admin2-point' | 'populated-place-point'

export interface GazetteerMetadata {
  provider: 'geonames'
  snapshotDate: string
  scope: GazetteerScope
  /** Always explicitly partial with respect to real-world settlement coverage. */
  coverageNote: string
  license: 'CC-BY'
  attribution: 'GeoNames (https://www.geonames.org/)'
}

export interface Place {
  id: string
  geonameId: number
  kind: PlaceKind
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
  precision: PlacePrecision
}

export interface CountryRecord { code: string; name: string; geonameId: number }
export interface AdminRecord { code: string; name: string; asciiName: string; geonameId: number }
export interface PlaceCatalogInput {
  metadata: GazetteerMetadata
  countries: CountryRecord[]
  admin1: AdminRecord[]
  admin2: AdminRecord[]
  populatedPlaces: Place[]
}

export interface LookupOptions { countryCode?: string; admin1Code?: string }
export type LookupResult =
  | { status: 'resolved'; place: Place; coverage: 'catalog-scope' }
  | { status: 'ambiguous'; candidates: Place[]; coverage: 'catalog-scope' }
  | { status: 'not-found'; coverage: 'catalog-scope' | 'country-not-in-catalog'; scope: GazetteerScope }
  | { status: 'unsupported-country'; coverage: 'country-not-in-catalog'; countryCode: string; scope: GazetteerScope }

export interface ParseLimits { maxBytes?: number; maxRows?: number }
const DEFAULT_MAX_BYTES = 8_000_000
const DEFAULT_MAX_ROWS = 100_000

function boundedLines(text: string, limits: ParseLimits = {}): string[] {
  const maxBytes = limits.maxBytes ?? DEFAULT_MAX_BYTES
  const maxRows = limits.maxRows ?? DEFAULT_MAX_ROWS
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError('maxBytes must be a finite positive integer')
  if (!Number.isSafeInteger(maxRows) || maxRows <= 0) throw new RangeError('maxRows must be a finite positive integer')
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new RangeError(`TSV exceeds maxBytes (${maxBytes})`)
  const lines = text.split(/\r?\n/).filter(line => line.length > 0 && !line.startsWith('#'))
  if (lines.length > maxRows) throw new RangeError(`TSV exceeds maxRows (${maxRows})`)
  return lines
}

function positiveId(value: string | undefined): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result <= 0) throw new TypeError(`Invalid GeoNames ID: ${value ?? ''}`)
  return result
}

/** Parse countryInfo.txt (commented, tab-separated GeoNames export). */
export function parseCountryInfoTsv(text: string, limits?: ParseLimits): CountryRecord[] {
  return boundedLines(text, limits).map(line => {
    const columns = line.split('\t')
    const code = columns[0]?.trim().toUpperCase()
    const name = columns[4]?.trim()
    if (!code || !/^[A-Z]{2}$/.test(code) || !name) throw new TypeError('Malformed countryInfo row')
    return { code, name, geonameId: positiveId(columns[16]) }
  })
}

/** Parse admin1CodesASCII.txt or admin2Codes.txt without guessing their hierarchy. */
export function parseAdminCodesTsv(text: string, limits?: ParseLimits): AdminRecord[] {
  return boundedLines(text, limits).map(line => {
    const [code, name, asciiName, id] = line.split('\t')
    if (!code?.trim() || !name?.trim() || !asciiName?.trim()) throw new TypeError('Malformed admin code row')
    return { code: code.trim(), name: name.trim(), asciiName: asciiName.trim(), geonameId: positiveId(id) }
  })
}

/** Parse one bounded chunk from allCountries.txt or cities15000.txt; only feature class P is retained. */
export function parsePopulatedPlaceChunk(text: string, limits?: ParseLimits): Place[] {
  const records: Place[] = []
  for (const line of boundedLines(text, limits)) {
    const c = line.split('\t')
    if (c.length < 19) throw new TypeError('Malformed GeoNames feature row: expected 19 columns')
    if (c[6] !== 'P') continue
    const countryCode = c[8]?.trim().toUpperCase()
    if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) continue
    if (!c[4]?.trim() || !c[5]?.trim()) throw new TypeError(`Missing coordinates in GeoNames record ${c[0] ?? ''}`)
    const latitude = Number(c[4]); const longitude = Number(c[5]); const population = Number(c[14])
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new TypeError(`Invalid coordinates in GeoNames record ${c[0] ?? ''}`)
    }
    const name = c[1]?.trim(); const asciiName = c[2]?.trim()
    if (!name || !asciiName) throw new TypeError('Missing place name')
    const admin1Code = c[10]?.trim() || undefined; const admin2Code = c[11]?.trim() || undefined
    records.push({
      id: `geonames:${positiveId(c[0])}`, geonameId: positiveId(c[0]), kind: 'populated-place', name, asciiName,
      countryCode, ...(admin1Code ? { admin1Code } : {}), ...(admin2Code ? { admin2Code } : {}),
      ...(c[7]?.trim() ? { featureCode: c[7].trim() } : {}), latitude, longitude,
      ...(Number.isFinite(population) && population >= 0 ? { population } : {}), precision: 'populated-place-point',
    })
  }
  return records
}

export function createPlaceCatalog(input: PlaceCatalogInput) {
  const date = new Date(`${input.metadata.snapshotDate}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.metadata.snapshotDate) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== input.metadata.snapshotDate) {
    throw new TypeError('snapshotDate must be a valid UTC YYYY-MM-DD date')
  }
  if (!['allCountries-populated-features', 'cities15000-subset'].includes(input.metadata.scope)) throw new TypeError('Unsupported gazetteer scope')
  if (!input.metadata.coverageNote.trim()) throw new TypeError('coverageNote must be nonempty')
  const identityRows = [
    ...input.countries.map(row => ({ id: row.geonameId, signature: `country|${row.code}|${row.name}` })),
    ...input.admin1.map(row => ({ id: row.geonameId, signature: `admin1|${row.code}|${row.name}|${row.asciiName}` })),
    ...input.admin2.map(row => ({ id: row.geonameId, signature: `admin2|${row.code}|${row.name}|${row.asciiName}` })),
    ...input.populatedPlaces.map(row => ({ id: row.geonameId, signature: `populated-place|${row.id}|${row.name}|${row.countryCode}|${row.latitude}|${row.longitude}` })),
  ]
  const ids = new Map<number, string>()
  for (const row of identityRows) {
    const previous = ids.get(row.id)
    if (previous !== undefined && previous !== row.signature) throw new TypeError(`Conflicting GeoNames ID ${row.id}`)
    if (previous !== undefined) throw new TypeError(`Duplicate GeoNames ID ${row.id}`)
    ids.set(row.id, row.signature)
  }
  for (const [label, keys] of [
    ['country code', input.countries.map(row => row.code.toUpperCase())],
    ['admin1 code', input.admin1.map(row => row.code)],
    ['admin2 code', input.admin2.map(row => row.code)],
  ] as const) {
    if (new Set(keys).size !== keys.length) throw new TypeError(`Duplicate ${label}`)
  }
  const countries = new Map(input.countries.map(row => [row.code.toUpperCase(), row]))
  const admin1 = new Map(input.admin1.map(row => [row.code, row]))
  const admin2 = new Map(input.admin2.map(row => [row.code, row]))
  const countryNodes: Place[] = input.countries.map(row => ({ id: `geonames:${row.geonameId}`, geonameId: row.geonameId, kind: 'country', name: row.name, asciiName: row.name, countryCode: row.code, precision: 'country' }))
  const admin1Nodes: Place[] = input.admin1.map(row => {
    const countryCode = row.code.split('.')[0]!.toUpperCase()
    const country = countries.get(countryCode)
    return { id: `geonames:${row.geonameId}`, geonameId: row.geonameId, kind: 'admin1', name: row.name, asciiName: row.asciiName, countryCode, ...(country ? { parentId: `geonames:${country.geonameId}` } : {}), precision: 'admin1-point' }
  })
  const admin2Nodes: Place[] = input.admin2.map(row => {
    const [countryRaw, admin1Code] = row.code.split('.')
    const countryCode = countryRaw!.toUpperCase()
    const parent = admin1.get(`${countryRaw}.${admin1Code}`)
    const country = countries.get(countryCode)
    return { id: `geonames:${row.geonameId}`, geonameId: row.geonameId, kind: 'admin2', name: row.name, asciiName: row.asciiName, countryCode, ...(parent ? { parentId: `geonames:${parent.geonameId}` } : country ? { parentId: `geonames:${country.geonameId}` } : {}), precision: 'admin2-point' }
  })
  const places = input.populatedPlaces.map(place => {
    const admin2Key = place.admin2Code ? `${place.countryCode}.${place.admin1Code ?? ''}.${place.admin2Code}` : undefined
    const admin1Key = place.admin1Code ? `${place.countryCode}.${place.admin1Code}` : undefined
    const parentId = (admin2Key && admin2.has(admin2Key) ? `geonames:${admin2.get(admin2Key)!.geonameId}` : undefined)
      ?? (admin1Key && admin1.has(admin1Key) ? `geonames:${admin1.get(admin1Key)!.geonameId}` : undefined)
      ?? (countries.has(place.countryCode) ? `geonames:${countries.get(place.countryCode)!.geonameId}` : undefined)
    return { ...place, ...(parentId ? { parentId } : {}) }
  })
  const normalize = (name: string) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return {
    metadata: input.metadata,
    places,
    nodes: [...countryNodes, ...admin1Nodes, ...admin2Nodes, ...places],
    lookup(name: string, options: LookupOptions = {}): LookupResult {
      const countryCode = options.countryCode?.toUpperCase()
      if (countryCode && !countries.has(countryCode)) return { status: 'unsupported-country', coverage: 'country-not-in-catalog', countryCode, scope: input.metadata.scope }
      const target = normalize(name)
      const candidates = places.filter(place => (normalize(place.name) === target || normalize(place.asciiName) === target)
        && (!countryCode || place.countryCode === countryCode)
        && (!options.admin1Code || place.admin1Code === options.admin1Code))
        .sort((a, b) => a.countryCode.localeCompare(b.countryCode) || a.id.localeCompare(b.id))
      if (candidates.length === 1) return { status: 'resolved', place: candidates[0]!, coverage: 'catalog-scope' }
      if (candidates.length > 1) return { status: 'ambiguous', candidates, coverage: 'catalog-scope' }
      return { status: 'not-found', coverage: 'catalog-scope', scope: input.metadata.scope }
    },
  }
}

/** WGS84 great-circle distance using the shortest wrapped longitude delta. */
export function distanceKm(a: Pick<Place, 'latitude' | 'longitude'>, b: Pick<Place, 'latitude' | 'longitude'>): number {
  if (a.latitude === undefined || a.longitude === undefined || b.latitude === undefined || b.longitude === undefined) throw new TypeError('Coordinates required')
  const rad = (degrees: number) => degrees * Math.PI / 180
  const dLat = rad(b.latitude - a.latitude)
  const rawLon = b.longitude - a.longitude
  const dLon = rad(((rawLon + 540) % 360) - 180)
  const lat1 = rad(a.latitude); const lat2 = rad(b.latitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, h)))
}

/** A coarse point anchor is not a boundary or a neighborhood polygon. */
export function isCoarserThanPopulatedPlace(place: Place): boolean { return place.precision !== 'populated-place-point' }
