#!/usr/bin/env node
// Builds the small place directory bundled with the desktop renderer, used by
// the launcher to fly to countries, regions and large cities without any
// location permission (PRD EXP-005).
//
// Usage (GeoNames dump files, CC BY 4.0, https://www.geonames.org/):
//   node packages/place-catalog/scripts/build-bundled-places.mjs \
//     --cities cities15000.txt --countries countryInfo.txt --admin1 admin1CodesASCII.txt \
//     --out apps/desktop/src/shared/places/placeData.ts
import { readFileSync, writeFileSync } from 'node:fs'

const CITY_MIN_POPULATION = 250_000
const CAPITAL_MIN_POPULATION = 0
// Countries large enough that a first-level region is a useful destination.
const REGION_COUNTRIES = new Set(['US', 'CA', 'AU', 'BR', 'IN', 'CN', 'MX', 'RU', 'DE'])

// A short, hand-picked alias list for common English shorthands only.
const ALIASES = {
  'country:US': ['USA', 'US', 'United States of America', 'America'],
  'country:GB': ['UK', 'Britain', 'Great Britain', 'England'],
  'country:AE': ['UAE'],
  'country:NL': ['Holland'],
  'country:DE': ['Deutschland'],
  'country:KR': ['Korea'],
  'country:CZ': ['Czech Republic'],
  'country:CI': ["Cote d'Ivoire"],
  'country:MM': ['Burma'],
}
const CITY_ALIASES = {
  'New York City': ['NYC', 'New York'],
  'Los Angeles': ['LA'],
  'San Francisco': ['SF'],
  'Washington': ['Washington DC', 'DC'],
  'Mexico City': ['CDMX'],
  'Saint Petersburg': ['St Petersburg'],
  'Ho Chi Minh City': ['Saigon'],
  'Mumbai': ['Bombay'],
  'Kolkata': ['Calcutta'],
  'Chennai': ['Madras'],
  'Beijing': ['Peking'],
  'Kyiv': ['Kiev'],
}

function args(argv) {
  const result = {}
  for (let i = 0; i < argv.length; i += 2) result[argv[i].replace(/^--/, '')] = argv[i + 1]
  for (const key of ['cities', 'countries', 'admin1', 'out']) {
    if (!result[key]) throw new Error(`Missing --${key}`)
  }
  return result
}

const lines = (path) => readFileSync(path, 'utf8').split('\n').filter((line) => line && !line.startsWith('#'))
const round = (value) => Math.round(value * 100) / 100
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const opts = args(process.argv.slice(2))

const countries = new Map()
for (const line of lines(opts.countries)) {
  const f = line.split('\t')
  countries.set(f[0], { code: f[0], name: f[4], capital: f[5], area: Number(f[6]) || 0, population: Number(f[7]) || 0 })
}

const admin1 = new Map()
for (const line of lines(opts.admin1)) {
  const f = line.split('\t')
  admin1.set(f[0], f[1])
}

const allCities = lines(opts.cities).map((line) => {
  const f = line.split('\t')
  return {
    id: Number(f[0]),
    name: f[1],
    lat: Number(f[4]),
    lon: Number(f[5]),
    featureCode: f[7],
    cc: f[8],
    admin1Code: f[10],
    population: Number(f[14]) || 0,
  }
}).filter((city) => Number.isFinite(city.lat) && Number.isFinite(city.lon) && countries.has(city.cc))

// Representative country point: the capital, else the population-weighted
// centre of its listed cities.
const countryRows = []
for (const country of countries.values()) {
  const cities = allCities.filter((city) => city.cc === country.code)
  const capital = cities.find((city) => city.featureCode === 'PPLC') ??
    cities.find((city) => city.name === country.capital)
  let point = capital ? { lat: capital.lat, lon: capital.lon } : null
  if (!point && cities.length) {
    const weight = cities.reduce((sum, city) => sum + Math.max(1, city.population), 0)
    point = {
      lat: cities.reduce((sum, city) => sum + city.lat * Math.max(1, city.population), 0) / weight,
      lon: cities.reduce((sum, city) => sum + city.lon * Math.max(1, city.population), 0) / weight,
    }
  }
  if (!point) continue
  const radiusKm = Math.round(clamp(Math.sqrt(country.area) / 2, 80, 2500))
  countryRows.push([country.code, country.name, round(point.lat), round(point.lon), radiusKm, country.population])
}

const cityRows = allCities
  .filter((city) => city.population >= CITY_MIN_POPULATION ||
    (city.featureCode === 'PPLC' && city.population >= CAPITAL_MIN_POPULATION))
  .sort((a, b) => b.population - a.population)
  .map((city) => [city.id, city.name, city.cc, admin1.get(`${city.cc}.${city.admin1Code}`) ?? '', round(city.lat), round(city.lon), city.population])

// First-level regions: population-weighted centre of their listed cities,
// radius from the spread of those cities.
const regionGroups = new Map()
for (const city of allCities) {
  if (!REGION_COUNTRIES.has(city.cc) || !city.admin1Code) continue
  const key = `${city.cc}.${city.admin1Code}`
  if (!admin1.has(key)) continue
  const group = regionGroups.get(key) ?? []
  group.push(city)
  regionGroups.set(key, group)
}
const regionRows = []
for (const [key, cities] of regionGroups) {
  const weight = cities.reduce((sum, city) => sum + Math.max(1, city.population), 0)
  const lat = cities.reduce((sum, city) => sum + city.lat * Math.max(1, city.population), 0) / weight
  const lon = cities.reduce((sum, city) => sum + city.lon * Math.max(1, city.population), 0) / weight
  const spread = Math.max(...cities.map((city) => Math.hypot((city.lat - lat) * 111, (city.lon - lon) * 111 * Math.cos(lat * Math.PI / 180))))
  const population = cities.reduce((sum, city) => sum + city.population, 0)
  regionRows.push([key, admin1.get(key), key.slice(0, 2), round(lat), round(lon), Math.round(clamp(spread, 100, 1200)), population])
}
regionRows.sort((a, b) => b[6] - a[6])

const date = new Date().toISOString().slice(0, 10)
const out = `// Generated by packages/place-catalog/scripts/build-bundled-places.mjs on ${date}. Do not edit.
// Source: GeoNames cities15000, countryInfo and admin1CodesASCII dumps.
// Licence: GeoNames, CC BY 4.0, https://www.geonames.org/
// Regenerate: node packages/place-catalog/scripts/build-bundled-places.mjs \\
//   --cities cities15000.txt --countries countryInfo.txt --admin1 admin1CodesASCII.txt \\
//   --out apps/desktop/src/shared/places/placeData.ts

/** [iso2, name, lat, lon, radiusKm, population] */
export type CountryRow = [string, string, number, number, number, number]
/** [geonameId, name, iso2, admin1 name, lat, lon, population] */
export type CityRow = [number, string, string, string, number, number, number]
/** [admin1 key, name, iso2, lat, lon, radiusKm, listed-city population] */
export type RegionRow = [string, string, string, number, number, number, number]

export const COUNTRY_ROWS: CountryRow[] = ${JSON.stringify(countryRows)}

export const CITY_ROWS: CityRow[] = ${JSON.stringify(cityRows)}

export const REGION_ROWS: RegionRow[] = ${JSON.stringify(regionRows)}

export const COUNTRY_ALIASES: Record<string, string[]> = ${JSON.stringify(ALIASES)}

/** Aliases keyed by city name; applied to the most populous city with that name. */
export const CITY_ALIASES: Record<string, string[]> = ${JSON.stringify(CITY_ALIASES)}
`
writeFileSync(opts.out, out)
process.stdout.write(`countries ${countryRows.length}, cities ${cityRows.length}, regions ${regionRows.length}, ${Buffer.byteLength(out)} bytes\n`)
