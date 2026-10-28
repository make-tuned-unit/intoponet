import { describe, expect, it } from 'vitest'
import { countryAt, countryInFocus, countryShape } from './countryAt'
import { COUNTRY_SHAPES } from './countryShapes'
import { COUNTRY_ROWS } from './placeData'

describe('country under a point', () => {
  it('finds countries, enclaves and overseas parts', () => {
    expect(countryAt(46.6, 2.4)?.code).toBe('FR') // France
    expect(countryAt(42.1, 9.1)?.code).toBe('FR') // Corsica
    expect(countryAt(4.0, -53.0)?.code).toBe('GF') // French Guiana, not France
    expect(countryAt(-29.5, 28.2)?.code).toBe('LS') // Lesotho inside South Africa's outline
    expect(countryAt(-30.5, 24.5)?.code).toBe('ZA')
    expect(countryAt(46.25, -63.13)?.code).toBe('CA') // Charlottetown, PEI
    expect(countryAt(41.9029, 12.4534)?.code).toBe('VA') // Vatican City
    expect(countryAt(78.2, 15.6)?.code).toBe('SJ') // Svalbard
    expect(countryAt(64.0, 150.0)?.code).toBe('RU')
    expect(countryAt(41.8967, 12.4822)?.code).toBe('IT') // central Rome, outside the Vatican
  })
  it('reaches tiny islands and leaves open sea empty', () => {
    expect(countryAt(-0.53, 166.93)?.code).toBe('NR') // Nauru
    expect(countryAt(36.14, -5.35)?.code).toBe('GI') // Gibraltar, a point
    expect(countryAt(0, -30)).toBeNull() // mid-Atlantic
  })
  it('accounts for every country the app knows, with a label', () => {
    const missing = COUNTRY_ROWS.filter(([code]) => !countryShape(code))
    expect(missing.map(([code]) => code)).toEqual([])
    expect(COUNTRY_SHAPES.filter((shape) => shape.name).length).toBeGreaterThanOrEqual(COUNTRY_ROWS.length)
  })
})

describe('every country can be named', () => {
  it('finds each country at its own label point and capital, so centring on it names it', () => {
    // Zoomed in on a country (about 2° of view around the centre).
    const wrong = COUNTRY_SHAPES.filter((shape) => shape.name).filter((shape) => countryInFocus(shape.lat, shape.lon, 2)?.code !== shape.code)
    expect(wrong.map((shape) => `${shape.code} ${shape.name} → ${countryInFocus(shape.lat, shape.lon, 2)?.code}`)).toEqual([])
    // Flying to a country aims at this label point (not the capital: Rome sits beside Vatican City).
  })
})
