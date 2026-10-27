import { describe, expect, it } from 'vitest'
import { cleanHeadline, foreignNamesIn, mentions, properPhrases, scoreCandidate, searchQueries, titleWordsIn } from './headline'

describe('headline matching', () => {
  it('cleans outlet suffixes and expands abbreviations', () => {
    expect(cleanHeadline('Lula rejects US tariffs - Reuters')).toBe('Lula rejects United States tariffs')
    expect(cleanHeadline('“EU” talks stall')).toBe('European Union talks stall')
  })

  it('finds names and builds search queries', () => {
    expect(properPhrases('Protesters return to streets of Tbilisi over Georgian Dream vote')).toEqual(['Protesters', 'Tbilisi', 'Georgian Dream'])
    const queries = searchQueries('Syria announced the closure of the crossing on the border with Jordan')
    expect(queries[0]).toBe('Syria announced closure crossing border Jordan')
    expect(queries).toContain('Syria')
    // No capitals (Arabic): short windows instead.
    expect(searchQueries('التعليم العالي السورية تمدد التقدم إلى مفاضلة').length).toBeGreaterThan(1)
  })

  it('prefers in-country events named by the headline over far-away or generic pages', () => {
    const headline = 'Syria announced the closure of the crossing on the border with Jordan'
    const border = scoreCandidate({ rank: 3, eventLike: false, inCountry: true, isPerson: false, isCountry: false, isDisambiguation: false, titleWordsInHeadline: titleWordsIn('Jordan–Syria border', headline), foreignNames: foreignNamesIn('Jordan–Syria border', headline), otherCountry: false })
    const rafah = scoreCandidate({ rank: 0, eventLike: false, inCountry: false, isPerson: false, isCountry: false, isDisambiguation: false, titleWordsInHeadline: titleWordsIn('Rafah Border Crossing', headline), foreignNames: foreignNamesIn('Rafah Border Crossing', headline), otherCountry: true })
    expect(border).toBeGreaterThan(rafah)
    expect(scoreCandidate({ rank: 0, eventLike: true, inCountry: true, isPerson: false, isCountry: false, isDisambiguation: true, titleWordsInHeadline: 3, foreignNames: 0, otherCountry: false })).toBe(-Infinity)
    expect(titleWordsIn('2022 Brazilian general election', 'Brazil votes')).toBe(1)
  })

  it('checks whether article text names a topic', () => {
    const text = 'The first Norse settlements on the island began around 985. Later, during World War II, the United States built bases.'
    expect(mentions(text, 'Greenland in World War II', 'Greenland')).toBe(true)
    expect(mentions(text, 'Norse settlements in Greenland', 'Greenland')).toBe(true)
    expect(mentions(text, 'Thule Air Base B-52 crash')).toBe(false)
  })
})
