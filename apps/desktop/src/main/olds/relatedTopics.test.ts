import { describe, expect, it } from 'vitest'
import { otherCountries, relatedQueries, subjectTerms } from './relatedTopics'

describe('topics behind a story', () => {
  it('finds subject words, not places or filler', () => {
    expect(subjectTerms('Woman dies a day after release from New Brunswick correctional centre', ['New Brunswick'])).toEqual(['correctional centre', 'release', 'correctional', 'centre'])
  })
  it('maps headlines to subject families in the story’s country', () => {
    const prison = relatedQueries('Woman dies a day after release from New Brunswick correctional centre', 'Canada', ['New Brunswick'])
    expect(prison.titles.slice(0, 3)).toEqual(['Incarceration in Canada', 'Prisons in Canada', 'Crime in Canada'])
    expect(relatedQueries('Patients crowd hospitals and cry out for decent care', 'Honduras').titles).toContain('Health care in Honduras')
    expect(relatedQueries('Rents climb again as Toronto vacancy hits record low', 'Canada', ['Toronto']).titles).toContain('Housing in Canada')
  })
})

describe('province-level topics', () => {
  it('puts the named province first', () => {
    const titles = relatedQueries('Woman dies after release from New Brunswick correctional centre', 'Canada', [], ['New Brunswick']).titles
    expect(titles[0]).toBe('Incarceration in New Brunswick')
    expect(titles).toContain('Incarceration in Canada')
    expect(titles.indexOf('Incarceration in New Brunswick')).toBeLessThan(titles.indexOf('Incarceration in Canada'))
  })
})

describe('two countries in one story', () => {
  it('requires a relationship cue before inferring bilateral relations', () => {
    expect(otherCountries('Rains in Peru: forecast and northern regions on alert', 'Peru', ['Peru'], ['United Kingdom'])).toEqual([])
    expect(otherCountries('Bernardo on saying Jinggoy got millions in kickbacks', 'Philippines', [], ['Canada'])).toEqual([])
    expect(otherCountries('APNU+AFC’s undisclosed ExxonMobil signing bonus before PAC', 'Guyana', [], ['United Kingdom'])).toEqual([])
    expect(otherCountries('How Ethiopia became Russia’s longstanding partner', 'Ethiopia', ['Ethiopia', 'Russia'])).toEqual(['Russia'])
    expect(otherCountries('New trade agreement with Japan', 'Canada', ['Japan'])).toEqual(['Japan'])
  })
  it('looks up their relations, including the countries of people it names', () => {
    // Russia comes from Putin's citizenship on Wikidata (looked up at runtime).
    const others = otherCountries('Norway and Finland leaders hold rare call with Putin', 'Norway', ['Norway', 'Finland'], ['Russia'])
    expect(others).toEqual(['Finland', 'Russia'])
    const { titles } = relatedQueries('Norway and Finland leaders hold rare call with Putin', 'Norway', [], [], others)
    expect(titles).toContain('Finland–Norway relations')
    expect(titles).toContain('Norway–Russia relations')
  })
})

describe('topic families (2026-11-06 stress test)', () => {
  it('reads the subject, not institutions named after one', () => {
    const ageing = relatedQueries('Bhutan projected to become an ageing society by 2028: World Bank', 'Bhutan').titles
    expect(ageing).toContain('Demographics of Bhutan')
    expect(ageing).not.toContain('Banking in Bhutan')
    expect(relatedQueries('Pineapple farming transforms livelihoods in Pema Gatshel', 'Bhutan').titles[0]).toBe('Agriculture in Bhutan')
    // A treaty between states is not about Indigenous peoples, and Canada's schools are not Fiji's.
    expect(relatedQueries('Solicitor-General’s no-show raises treaty concerns', 'Fiji').titles).not.toContain('Indigenous rights')
    expect(relatedQueries('First Nations sign land rights agreement', 'Fiji').titles).not.toContain('Canadian Indian residential school system')
  })
})
