import { describe, expect, it } from 'vitest'
import { CITY_ROWS, COUNTRY_ROWS, REGION_ROWS } from './placeData'
import { normalizePlaceText, placeLabel, searchPlaces } from './places'

describe('searchPlaces', () => {
  it('finds major cities first', () => {
    expect(placeLabel(searchPlaces('tokyo')[0]!)).toBe('Tokyo, Japan')
    expect(placeLabel(searchPlaces('paris')[0]!)).toBe('Paris, France')
    expect(placeLabel(searchPlaces('Halifax')[0]!)).toBe('Halifax, Nova Scotia, Canada')
  })

  it('puts an exactly named country first', () => {
    const [first] = searchPlaces('japan')
    expect(first).toMatchObject({ kind: 'country', countryCode: 'JP', name: 'Japan' })
  })

  it('ignores case and diacritics', () => {
    expect(searchPlaces('sao paulo')[0]?.name).toBe('São Paulo')
    expect(searchPlaces('ZÜRICH')[0]?.name).toBe('Zürich')
  })

  it('matches prefixes and aliases', () => {
    expect(searchPlaces('nyc')[0]?.name).toBe('New York City')
    expect(searchPlaces('uk')[0]?.id).toBe('country:GB')
    expect(searchPlaces('buenos')[0]?.name).toBe('Buenos Aires')
  })

  it('needs at least two characters and respects the limit', () => {
    expect(searchPlaces('x')).toEqual([])
    expect(searchPlaces(' ')).toEqual([])
    expect(searchPlaces('san', 3)).toHaveLength(3)
  })

  it('finds first-level regions of large countries', () => {
    const region = searchPlaces('british columbia').find((place) => place.kind === 'region')
    expect(region && placeLabel(region)).toBe('British Columbia, Canada')
  })

  it('formats labels', () => {
    const portland = searchPlaces('portland').find((place) => place.countryCode === 'US')
    expect(portland && placeLabel(portland)).toBe('Portland, Oregon, United States')
  })

  it('is fast once indexed', () => {
    searchPlaces('warm up')
    const start = performance.now()
    for (const query of ['lon', 'new', 'sa', 'ber', 'mexico']) searchPlaces(query)
    expect((performance.now() - start) / 5).toBeLessThan(10)
  })
})

describe('bundled place data', () => {
  it('is sane', () => {
    expect(COUNTRY_ROWS.length).toBeGreaterThanOrEqual(195)
    expect(CITY_ROWS.length).toBeGreaterThan(1000)
    const ids = new Set<string>()
    for (const [code, , lat, lon] of COUNTRY_ROWS) {
      ids.add(`country:${code}`)
      expect(Math.abs(lat)).toBeLessThanOrEqual(90)
      expect(Math.abs(lon)).toBeLessThanOrEqual(180)
    }
    for (const [id, , , , lat, lon] of CITY_ROWS) {
      ids.add(`city:${id}`)
      expect(Math.abs(lat)).toBeLessThanOrEqual(90)
      expect(Math.abs(lon)).toBeLessThanOrEqual(180)
    }
    for (const [key] of REGION_ROWS) ids.add(`region:${key}`)
    expect(ids.size).toBe(COUNTRY_ROWS.length + CITY_ROWS.length + REGION_ROWS.length)
  })

  it('normalizes text', () => {
    expect(normalizePlaceText("  Côte d'Ivoire ")).toBe('cote d ivoire')
  })
})

describe('nearestCountry', () => {
  it('names the country under a point', async () => {
    const { nearestCountry } = await import('./places')
    expect(nearestCountry(48.86, 2.35)?.place.countryCode).toBe('FR')
    expect(nearestCountry(-1.29, 36.82)?.place.countryCode).toBe('KE')
    expect(nearestCountry(35.68, 139.7)?.place.countryCode).toBe('JP')
  })
})

describe('placesNamedIn', () => {
  it('finds places in page titles and addresses', async () => {
    const { placesNamedIn } = await import('./places')
    expect(placesNamedIn('History of Vanuatu - Wikipedia https://en.wikipedia.org/wiki/History_of_Vanuatu').map((place) => place.name)).toEqual(['Vanuatu'])
    expect(placesNamedIn('Flooding hits Port Vila as cyclone nears New Caledonia')[0]?.name).toBe('Port-Vila')
    expect(placesNamedIn('Best restaurants in Paris, France').map((place) => place.name)).toEqual(['Paris', 'France'])
    expect(placesNamedIn('How to make sourdough at home')).toEqual([])
    expect(placesNamedIn('Reading list: Nice ideas for March')).toEqual([])
  })
})

describe('placesNamedIn homonyms', () => {
  it('does not put a Texas story in California', async () => {
    const { placesNamedIn } = await import('./places')
    const names = placesNamedIn('CBP weighs border wall through Santa Ana wildlife refuge', 4, 'texastribune').map((place) => `${place.name}|${place.region ?? place.kind}`)
    expect(names.some((name) => name.includes('California'))).toBe(false)
    expect(names.some((name) => name.startsWith('Texas'))).toBe(true)
  })
  it('keeps the largest homonym when nothing says otherwise', async () => {
    const { placesNamedIn } = await import('./places')
    expect(placesNamedIn('Protests in Santa Ana tonight')[0]?.region).toBe('California')
  })
})

describe('fly-to with a province or state', () => {
  it('finds provincial capitals and accepts qualifiers people type', async () => {
    const { searchPlaces, placeLabel, placesNamedIn } = await import('./places')
    const first = (q: string) => { const p = searchPlaces(q, 1)[0]; return p ? placeLabel(p) : null }
    expect(first('Charlottetown')).toBe('Charlottetown, Prince Edward Island, Canada')
    expect(first('Charlottetown PEI')).toBe('Charlottetown, Prince Edward Island, Canada')
    expect(first('Charlottetown, PE')).toBe('Charlottetown, Prince Edward Island, Canada')
    expect(first('Fredericton NB')).toBe('Fredericton, New Brunswick, Canada')
    expect(first('Springfield IL')).toBe('Springfield, Illinois, United States')
    expect(first('London ON')).toBe('London, Ontario, Canada')
    expect(first('P.E.I.')).toBe('Prince Edward Island, Canada')
    // Two-letter codes never stand alone in running text.
    expect(placesNamedIn('In Mobile, OK, a man said').map((p) => p.name)).not.toContain('Oklahoma')
  })
})
