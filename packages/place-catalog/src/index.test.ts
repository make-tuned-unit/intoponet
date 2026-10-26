import { describe, expect, it } from 'vitest'
import { createPlaceCatalog, distanceKm, parseAdminCodesTsv, parseCountryInfoTsv, parsePopulatedPlaceChunk } from './index'

const countriesTsv = [
  'US\tUSA\t840\tUS\tUnited States\tWashington\t\t\tNA\t.us\tUSD\tDollar\t1\t\t\ten\t6252001\tCA,MX\t',
  'CA\tCAN\t124\tCA\tCanada\tOttawa\t\t\tNA\t.ca\tCAD\tDollar\t1\t\t\ten,fr\t6251999\tUS\t',
].join('\n')
const placeRow = (id: number, name: string, country: string, admin1: string, admin2: string, lat: number, lon: number) =>
  [id, name, name, '', lat, lon, 'P', 'PPL', country, '', admin1, admin2, '', '', 1000, '', 0, 'America/New_York', '2025-01-01'].join('\t')

describe('GeoNames bounded place catalog', () => {
  const countries = parseCountryInfoTsv(countriesTsv)
  const admin1 = parseAdminCodesTsv('US.NY\tNew York\tNew York\t5128638\nCA.NS\tNova Scotia\tNova Scotia\t6091530')
  const admin2 = parseAdminCodesTsv('US.NY.001\tAlbany County\tAlbany County\t5106834')
  const places = parsePopulatedPlaceChunk([
    placeRow(1, 'Springfield', 'US', 'NY', '001', 42.1, -73.8),
    placeRow(2, 'Springfield', 'CA', 'NS', '', 45.0, -63.0),
    placeRow(3, 'Harbor Point', 'CA', 'NS', '', 44.9, -62.9),
  ].join('\n'))
  const catalog = createPlaceCatalog({ metadata: { provider: 'geonames', snapshotDate: '2025-01-01', scope: 'cities15000-subset', coverageNote: 'Population/admin-seat subset; not all populated places.', license: 'CC-BY', attribution: 'GeoNames (https://www.geonames.org/)' }, countries, admin1, admin2, populatedPlaces: places })

  it('preserves same-name cities as ambiguous, with country scoping and parent hierarchy', () => {
    expect(catalog.lookup('Springfield').status).toBe('ambiguous')
    const result = catalog.lookup('Springfield', { countryCode: 'US' })
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.place.parentId).toBe('geonames:5106834')
  })
  it('distinguishes unsupported country from a no-match within a represented country', () => {
    expect(catalog.lookup('X', { countryCode: 'ZZ' }).status).toBe('unsupported-country')
    expect(catalog.lookup('X', { countryCode: 'US' })).toMatchObject({ status: 'not-found', coverage: 'catalog-scope', scope: 'cities15000-subset' })
  })
  it('enforces bounded imports and validates GeoNames coordinates', () => {
    expect(() => parsePopulatedPlaceChunk(placeRow(4, 'X', 'US', 'NY', '', 91, 0), { maxBytes: 1000 })).toThrow(/coordinates/i)
    expect(() => parseCountryInfoTsv(countriesTsv, { maxBytes: 10 })).toThrow(/maxBytes/)
    expect(() => parseCountryInfoTsv(countriesTsv, { maxBytes: Number.POSITIVE_INFINITY })).toThrow(/finite positive integer/)
    expect(() => parseCountryInfoTsv(countriesTsv, { maxRows: Number.NaN })).toThrow(/finite positive integer/)
    expect(() => parsePopulatedPlaceChunk(placeRow(5, 'No coordinates', 'US', 'NY', '', 0, 0).replace('\t0\t0\tP\t', '\t\t0\tP\t'))).toThrow(/missing coordinates/i)
  })
  it('marks place records as point precision, not neighborhood coverage', () => {
    expect(places[0]?.precision).toBe('populated-place-point')
    expect(catalog.lookup('Harbor Point')).toMatchObject({ status: 'resolved' })
  })
  it('uses shortest longitude path across the antimeridian', () => {
    expect(distanceKm({ latitude: 0, longitude: 179.9 }, { latitude: 0, longitude: -179.9 })).toBeCloseTo(22.24, 0)
  })
  it('validates catalog metadata and refuses duplicate or conflicting source IDs', () => {
    const base = { metadata: { provider: 'geonames' as const, snapshotDate: '2025-01-01', scope: 'cities15000-subset' as const, coverageNote: 'Partial place subset.', license: 'CC-BY' as const, attribution: 'GeoNames (https://www.geonames.org/)' as const }, countries, admin1, admin2, populatedPlaces: places }
    expect(() => createPlaceCatalog({ ...base, metadata: { ...base.metadata, snapshotDate: '2025-02-31' } })).toThrow(/snapshotDate/)
    expect(() => createPlaceCatalog({ ...base, metadata: { ...base.metadata, coverageNote: ' ' } })).toThrow(/coverageNote/)
    expect(() => createPlaceCatalog({ ...base, countries: [...countries, { ...countries[0]!, name: 'Conflicting country' }] })).toThrow(/GeoNames ID 6252001/)
  })
})
