import { describe, expect, it } from 'vitest'
import { countriesIn, countryOfToken } from './countryNames'

const codes = (title: string, lang?: string): string[] => countriesIn(title, lang).map((mention) => mention.code)

describe('country names in headlines', () => {
  it('reads a country in the headline’s own language', () => {
    expect(codes('Cinco países europeus preparam centro de repatriamento de migrantes africanos no Ruanda', 'pt')).toEqual(['RW'])
    expect(codes('Alemania destroza a Países Bajos; aseguran su pase a cuartos de final de la UEFA Nations League', 'es-MX')).toEqual(['DE', 'NL'])
    expect(codes('Hancurkan Belanda 5-0, Jerman ke perempat final sebagai juara grup', 'id')).toEqual(['NL', 'DE'])
    expect(codes('Cinq pays européens, dont l’Allemagne et les Pays-Bas, vont envoyer des migrants au Rwanda', 'fr')).toEqual(['DE', 'NL', 'RW'])
    expect(codes('Fallas en bancos de EE.UU. impiden acceso a cuentas', 'es')).toEqual(['US'])
    expect(codes('Falla en bancos EEUU congela transferencias y golpea a Bank of America y Wells Fargo', 'es')).toEqual(['US'])
  })

  it('gives a country one token whatever it is called, however many words that takes', () => {
    const tokens = (title: string, lang: string): string[] => countriesIn(title, lang).map((mention) => mention.token)
    expect(tokens('Two mass shootings in South Africa leave 17 dead', 'en')).toEqual(['south-africa'])
    expect(tokens('FOOTBALL – Madagascar s’incline face à l’Afrique du Sud', 'fr')).toEqual(['madagascar', 'south-africa'])
    expect(tokens('Presidente do Equador nega que o país tenha uma base militar dos Estados Unidos', 'pt')).toEqual(['ecuador', 'united-states'])
    expect(countryOfToken('south-africa')).toBe('ZA')
    expect(countryOfToken('united-states')).toBe('US')
    expect(countryOfToken('trump')).toBeNull()
  })

  it('reads another language’s names only in that language', () => {
    // "Island" is Iceland in German, an island in English.
    expect(codes('Searching for the Last Stoats of Waiheke Island', 'en')).toEqual([])
    expect(codes('Island: Vulkan auf der Halbinsel Reykjanes bricht erneut aus', 'de')).toEqual(['IS'])
    // "Columbia" is Colombia in Romanian, a university in English.
    expect(codes('Mamdani to disband NYPD unit deployed at Columbia protests', 'en')).toEqual([])
    expect(codes('Hancurkan Belanda 5-0, Jerman ke perempat final', 'en')).toEqual([])
    expect(codes('Hancurkan Belanda 5-0, Jerman ke perempat final')).toEqual([])
  })

  it('needs a capital letter, and leaves names that are more often something else', () => {
    expect(codes('Catar acoge la cumbre del Golfo', 'es')).toEqual(['QA'])
    expect(codes('Aprende a catar un vino en cinco pasos', 'es')).toEqual([])
    // Granada the city, not Grenada; a meeting, not Réunion; Maurice the man, not Mauritius.
    expect(codes('Granada entrega de los Premios Internacionales del Flamenco', 'es')).toEqual([])
    expect(codes('La reunión entre Lula y Sánchez termina sin acuerdo', 'es')).toEqual([])
    expect(codes('Cameroun : Maurice Kamto appelle à la valorisation de la mémoire des héros nationaux', 'fr')).toEqual(['CM'])
    // "Congo" alone is either of two countries.
    expect(codes('Congo struggles to tame ebola outbreak six months into response', 'en')).toEqual([])
    expect(codes('DR Congo Ebola outbreak still out of control six months on, Africa CDC warns', 'en')).toEqual(['CD'])
  })
})
