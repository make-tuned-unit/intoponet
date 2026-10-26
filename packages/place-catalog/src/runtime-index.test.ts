import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSqlitePlaceIndex, openIndexedPlaceCatalog, openPublishedPlaceCatalog, publishPlaceIndexPointer, reconcilePlaceIndexes } from './runtime-index'

function node(overrides: Record<string, unknown>): Record<string, unknown> {
  const geonameId = Number(String(overrides['id']).replace('geonames:', ''))
  return {
    id: `geonames:${geonameId}`,
    geonameId,
    kind: 'populated-place',
    name: 'Springfield',
    asciiName: 'Springfield',
    countryCode: 'US',
    precision: 'populated-place-point',
    latitude: 40,
    longitude: -75,
    ...overrides,
  }
}

describe('disk-backed GeoNames runtime index', () => {
  const directories: string[] = []
  afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

  async function buildFixture(rowOverride?: Array<Record<string, unknown>>, snapshotDate = '2026-10-23') {
    const directory = await mkdtemp(join(tmpdir(), 'intoponet-place-index-'))
    directories.push(directory)
    const catalogDirectory = join(directory, 'catalog-global-v1')
    const outputPath = join(directory, 'runtime-index-2026-10-23.sqlite')
    const rows = [
      { id: 'geonames:6251999', geonameId: 6251999, kind: 'country', name: 'Canada', asciiName: 'Canada', countryCode: 'CA', precision: 'country' },
      { id: 'geonames:6252001', geonameId: 6252001, kind: 'country', name: 'United States', asciiName: 'United States', countryCode: 'US', precision: 'country' },
      { id: 'geonames:5128638', geonameId: 5128638, kind: 'admin1', name: 'New York', asciiName: 'New York', countryCode: 'US', parentId: 'geonames:6252001', precision: 'admin1-point' },
      { id: 'geonames:5106834', geonameId: 5106834, kind: 'admin2', name: 'Albany County', asciiName: 'Albany County', countryCode: 'US', parentId: 'geonames:5128638', precision: 'admin2-point' },
      node({ id: 'geonames:1', geonameId: 1, countryCode: 'US', admin1Code: 'NY', admin2Code: '001', parentId: 'geonames:5106834' }),
      node({ id: 'geonames:2', geonameId: 2, countryCode: 'US', admin1Code: 'NY', admin2Code: '001', parentId: 'geonames:5106834', name: 'Springfield', asciiName: 'Springfield' }),
      node({ id: 'geonames:3', geonameId: 3, countryCode: 'CA', admin1Code: 'NS', name: 'Springfield', asciiName: 'Springfield' }),
      node({ id: 'geonames:4', geonameId: 4, countryCode: 'US', admin1Code: 'NY', name: 'Saint John', asciiName: 'St John', parentId: 'geonames:5128638' }),
    ]
    const catalogRows = rowOverride ?? rows
    const data = `${catalogRows.map((row) => JSON.stringify(row)).join('\n')}\n`
    const dataHash = createHash('sha256').update(data).digest('hex')
    const manifest = {
      formatVersion: 1,
      dataset: 'GeoNames place catalog',
      snapshotDate,
      sourceScope: 'allCountries-populated-features',
      coverageNote: 'Populated features in the fixture scope; not all settlements.',
      output: { file: 'places.ndjson', sha256: dataHash },
      counts: { countries: 2, admin1: 1, admin2: 1, populatedPlaces: catalogRows.filter((row) => row['kind'] === 'populated-place').length },
    }
    await (await import('node:fs/promises')).mkdir(catalogDirectory, { recursive: true })
    await writeFile(join(catalogDirectory, 'places.ndjson'), data)
    await writeFile(join(catalogDirectory, 'manifest.json'), JSON.stringify(manifest))
    return { directory, catalogDirectory, outputPath }
  }

  it('builds an atomic, versioned index and serves bounded ID, exact-name, and parent queries', async () => {
    const fixture = await buildFixture()
    const metadata = await buildSqlitePlaceIndex({ catalogDirectory: fixture.catalogDirectory, outputPath: fixture.outputPath, now: () => Date.parse('2026-10-24T00:00:00Z') })
    expect(metadata).toMatchObject({ sourceNodeCount: 8, indexedNodeCount: 8, indexedPlaceCount: 4, scope: 'allCountries-populated-features' })
    const catalog = openIndexedPlaceCatalog(fixture.outputPath)
    expect(catalog.getById('geonames:5106834')).toMatchObject({ name: 'Albany County', kind: 'admin2', parentId: 'geonames:5128638' })
    expect(catalog.searchExactName('Springfield').status).toBe('ambiguous')
    expect(catalog.searchExactName('Springfield', { countryCode: 'US', admin1Code: 'NY' })).toMatchObject({ status: 'ambiguous', candidates: [{ id: 'geonames:1' }, { id: 'geonames:2' }] })
    expect(catalog.searchExactName('St John', { countryCode: 'US' })).toMatchObject({ status: 'resolved', place: { id: 'geonames:4' } })
    expect(catalog.getAncestors('geonames:1').map((place) => place.id)).toEqual(['geonames:5106834', 'geonames:5128638', 'geonames:6252001'])
    expect(catalog.getChildren('geonames:6252001', { limit: 10 }).map((place) => place.id)).toContain('geonames:5128638')
    const firstChildPage = catalog.getChildrenPage('geonames:5128638', { limit: 1 })
    expect(firstChildPage.children.map((place) => place.name)).toEqual(['Albany County'])
    expect(firstChildPage.nextCursor).toBeDefined()
    expect(catalog.getChildrenPage('geonames:5128638', { limit: 1, cursor: firstChildPage.nextCursor! }).children.map((place) => place.name)).toEqual(['Saint John'])
    catalog.close()
    await expect(buildSqlitePlaceIndex({ catalogDirectory: fixture.catalogDirectory, outputPath: fixture.outputPath })).rejects.toThrow('already exists')
  })

  it('keeps country coverage independent from place hits and bounds ambiguous result queries', async () => {
    const fixture = await buildFixture()
    await buildSqlitePlaceIndex({ catalogDirectory: fixture.catalogDirectory, outputPath: fixture.outputPath })
    const catalog = openIndexedPlaceCatalog(fixture.outputPath)
    expect(catalog.coverageForCountry('US')).toBe('catalog-scope')
    expect(catalog.coverageForCountry('ZZ')).toBe('country-not-in-catalog')
    expect(catalog.searchExactName('No Such Place', { countryCode: 'US' })).toMatchObject({ status: 'not-found', coverage: 'catalog-scope' })
    expect(catalog.searchExactName('No Such Place', { countryCode: 'ZZ' })).toMatchObject({ status: 'unsupported-country', coverage: 'country-not-in-catalog' })
    expect(catalog.searchExactName('Springfield', { countryCode: 'US', limit: 1 })).toMatchObject({ status: 'ambiguous', truncated: true, candidates: [{ id: 'geonames:1' }] })
    expect(() => catalog.searchExactName('X', { limit: 51 })).toThrow(/limit/)
    expect(() => catalog.getChildren('geonames:6252001', { limit: 101 })).toThrow(/limit/)
    catalog.close()
  })

  it('rejects input hash/count errors and atomically publishes a version pointer', async () => {
    const fixture = await buildFixture()
    const metadata = await buildSqlitePlaceIndex({ catalogDirectory: fixture.catalogDirectory, outputPath: fixture.outputPath })
    const pointerPath = join(fixture.directory, 'current.json')
    await publishPlaceIndexPointer(fixture.outputPath, pointerPath)
    expect(JSON.parse(await readFile(pointerPath, 'utf8'))).toMatchObject({ snapshotDate: '2026-10-23', sourceDataSha256: metadata.sourceDataSha256 })
    const published = await openPublishedPlaceCatalog(pointerPath)
    expect(published.getById('geonames:1')?.name).toBe('Springfield')
    published.close()
    const nullPointer = join(fixture.directory, 'null.json')
    await writeFile(nullPointer, 'null')
    await expect(openPublishedPlaceCatalog(nullPointer)).rejects.toThrow(/JSON object/)
    const arrayPointer = join(fixture.directory, 'array.json')
    await writeFile(arrayPointer, '[]')
    await expect(openPublishedPlaceCatalog(arrayPointer)).rejects.toThrow(/JSON object/)
    const oversizedPointer = join(fixture.directory, 'oversized.json')
    await writeFile(oversizedPointer, ' '.repeat(4_097))
    await expect(openPublishedPlaceCatalog(oversizedPointer)).rejects.toThrow(/4 KB/)
    await expect(publishPlaceIndexPointer(fixture.outputPath, fixture.outputPath)).rejects.toThrow(/cannot overwrite/)
    await expect(publishPlaceIndexPointer(fixture.outputPath, join(fixture.directory, 'elsewhere', 'current.json'))).rejects.toThrow(/beside/)
    await expect(openPublishedPlaceCatalog(join(fixture.directory, 'missing.json'))).rejects.toThrow()
    const secondOutput = join(fixture.directory, 'bad-index.sqlite')
    await writeFile(join(fixture.catalogDirectory, 'places.ndjson'), '{"id":"broken"}\n')
    await expect(buildSqlitePlaceIndex({ catalogDirectory: fixture.catalogDirectory, outputPath: secondOutput })).rejects.toThrow(/hash/)
    const { access } = await import('node:fs/promises')
    await expect(access(secondOutput)).rejects.toThrow()
  })

  it('reconciles versioned snapshots by stable ID with bounded change samples', async () => {
    const first = await buildFixture()
    const firstMetadata = await buildSqlitePlaceIndex({ catalogDirectory: first.catalogDirectory, outputPath: first.outputPath })
    const secondRows = [
      { id: 'geonames:6251999', geonameId: 6251999, kind: 'country', name: 'Canada', asciiName: 'Canada', countryCode: 'CA', precision: 'country' },
      { id: 'geonames:6252001', geonameId: 6252001, kind: 'country', name: 'United States', asciiName: 'United States', countryCode: 'US', precision: 'country' },
      { id: 'geonames:5128638', geonameId: 5128638, kind: 'admin1', name: 'New York', asciiName: 'New York', countryCode: 'US', parentId: 'geonames:6252001', precision: 'admin1-point' },
      { id: 'geonames:5106834', geonameId: 5106834, kind: 'admin2', name: 'Albany County', asciiName: 'Albany County', countryCode: 'US', parentId: 'geonames:5128638', precision: 'admin2-point' },
      node({ id: 'geonames:1', geonameId: 1, countryCode: 'US', admin1Code: 'NY', admin2Code: '001', parentId: 'geonames:5106834', name: 'Springfield Heights', asciiName: 'Springfield Heights' }),
      node({ id: 'geonames:3', geonameId: 3, countryCode: 'CA', admin1Code: 'NS', name: 'Springfield', asciiName: 'Springfield' }),
      node({ id: 'geonames:4', geonameId: 4, countryCode: 'US', admin1Code: 'NY', name: 'Saint John', asciiName: 'St John', parentId: 'geonames:5128638' }),
      node({ id: 'geonames:5', geonameId: 5, countryCode: 'US', admin1Code: 'NY', name: 'New Hamlet', asciiName: 'New Hamlet' }),
    ]
    const second = await buildFixture(secondRows, '2026-10-24')
    await buildSqlitePlaceIndex({ catalogDirectory: second.catalogDirectory, outputPath: second.outputPath })
    expect(reconcilePlaceIndexes(first.outputPath, second.outputPath, { sampleLimit: 1 })).toMatchObject({
      previous: { snapshotDate: '2026-10-23' },
      next: { snapshotDate: '2026-10-24' },
      addedCount: 1,
      removedCount: 1,
      changedCount: 1,
      samples: { added: ['geonames:5'], removed: ['geonames:2'], changed: ['geonames:1'] },
      sampleLimit: 1,
    })
    expect(firstMetadata.sourceDataSha256).not.toEqual('')
    expect(() => reconcilePlaceIndexes(first.outputPath, second.outputPath, { sampleLimit: 1_001 })).toThrow(/sampleLimit/)
    const missingPath = join(first.directory, 'missing.sqlite')
    expect(() => reconcilePlaceIndexes(first.outputPath, missingPath)).toThrow()
    const { access } = await import('node:fs/promises')
    await expect(access(missingPath)).rejects.toThrow()
  })

  it('paginates more than 100 same-name siblings exactly once using GeoNames ID tie-breaks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'intoponet-place-pagination-'))
    directories.push(directory)
    const catalogDirectory = join(directory, 'catalog-global-v1')
    const outputPath = join(directory, 'runtime-index-pagination.sqlite')
    const rows = [
      { id: 'geonames:6252001', geonameId: 6252001, kind: 'country', name: 'United States', asciiName: 'United States', countryCode: 'US', precision: 'country' },
      { id: 'geonames:5128638', geonameId: 5128638, kind: 'admin1', name: 'New York', asciiName: 'New York', countryCode: 'US', parentId: 'geonames:6252001', precision: 'admin1-point' },
      ...Array.from({ length: 205 }, (_, index) => node({
        id: `geonames:${1000 + index}`,
        geonameId: 1000 + index,
        name: 'Same Name',
        asciiName: 'Same Name',
        parentId: 'geonames:5128638',
        countryCode: 'US',
        admin1Code: 'NY',
      })),
    ]
    const data = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`
    const { mkdir } = await import('node:fs/promises')
    await mkdir(catalogDirectory, { recursive: true })
    await writeFile(join(catalogDirectory, 'places.ndjson'), data)
    await writeFile(join(catalogDirectory, 'manifest.json'), JSON.stringify({
      formatVersion: 1,
      dataset: 'GeoNames place catalog',
      snapshotDate: '2026-10-24',
      sourceScope: 'allCountries-populated-features',
      coverageNote: 'Pagination fixture scope.',
      output: { file: 'places.ndjson', sha256: createHash('sha256').update(data).digest('hex') },
      counts: { countries: 1, admin1: 1, admin2: 0, populatedPlaces: 205 },
    }))
    await buildSqlitePlaceIndex({ catalogDirectory, outputPath })
    const catalog = openIndexedPlaceCatalog(outputPath)
    const seen: string[] = []
    let cursor: import('./runtime-index').PlaceChildrenCursor | undefined
    do {
      const page = catalog.getChildrenPage('geonames:5128638', { limit: 100, ...(cursor ? { cursor } : {}) })
      seen.push(...page.children.map((place) => place.id))
      cursor = page.nextCursor as typeof cursor
    } while (cursor)
    catalog.close()
    expect(seen).toHaveLength(205)
    expect(new Set(seen).size).toBe(205)
    expect(seen).toEqual(Array.from({ length: 205 }, (_, index) => `geonames:${1000 + index}`))
  })
})
