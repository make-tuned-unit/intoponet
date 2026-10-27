import { describe, expect, it } from 'vitest'
import { chronologyFromWikitext, impliedYearOf, isDebris, sentenceDate } from './chronology'

describe('chronology from an article', () => {
  it('reads plain dates only', () => {
    expect(sentenceDate('On 19 December 2018, the prosecutor recommended charges.', 2026)).toMatchObject({ iso: '2018-12-19', precision: 'day' })
    expect(sentenceDate('In January 2017 the unit began work.', 2026)).toMatchObject({ iso: '2017-01', precision: 'month' })
    expect(sentenceDate('In 2016, police opened the case.', 2026)).toMatchObject({ iso: '2016', precision: 'year' })
    expect(sentenceDate('He was born in a small town and studied law.', 2026)).toBeNull()
    expect(sentenceDate('Smith (2019) argued the opposite.', 2026)).toBeNull()
  })
  it('quotes dated sentences in time order, with section links and the first linked article', () => {
    const wikitext = `The '''trial''' began in [[May 2020]]. Police began investigating in December 2016 after a [[State Comptroller]] report.<ref>x</ref>

== Indictment ==
On 21 November 2019, the [[Attorney General of Israel|attorney general]] announced indictments in three cases.
He denied wrongdoing.

== References ==
In 2021, someone wrote a book.`
    const chronicle = chronologyFromWikitext('Trial of X', wikitext, 2026)
    expect(chronicle.map((entry) => entry.at.iso)).toEqual(['2016-12', '2019-11-21'])
    expect(chronicle[1]).toMatchObject({ section: 'Indictment', link: 'Attorney General of Israel', url: 'https://en.wikipedia.org/wiki/Trial_of_X#Indictment' })
    expect(chronicle[0]!.text).not.toMatch(/ref|\[\[/)
  })
})

describe('focused chronology for broad topics', () => {
  it('keeps only events about the story’s subject', async () => {
    const { chronologyFromWikitext } = await import('./chronology')
    const wikitext = `== History ==
In 1620, there were 100,000 Spaniards in the clergy across the colonies.
In October 2022, Lula won the Brazilian presidential election against Bolsonaro.
On 1 January 2023, Lula was inaugurated as president of Brazil.`
    const all = chronologyFromWikitext('Latin America', wikitext, 2026)
    const focused = chronologyFromWikitext('Latin America', wikitext, 2026, 'en', 18, ['lula', 'brazi', 'elect'])
    expect(all).toHaveLength(3)
    expect(focused.map((entry) => entry.at.iso)).toEqual(['2022-10', '2023-01-01'])
  })
})

describe('timeline debris', () => {
  it('drops sentences that cannot stand alone', () => {
    expect(isDebris('Kodansha America. 1 February 1999. 606 pages.')).toBe(true)
    expect(isDebris('The , the first newspaper published in the country, began to circulate on 10 September 1808.')).toBe(true)
    expect(isDebris('Since then, the archipelago has suffered from recurrent power outages since June 2021.')).toBe(true)
    expect(isDebris('In 2024, the ANC lost its parliamentary majority for the first time since the transition to democracy.')).toBe(false)
    expect(isDebris('Italy joined the war in June 1940.')).toBe(false)
  })
})

describe('dates without a year', () => {
  it('takes the year from a one-year article', () => {
    expect(impliedYearOf('2026 North Indian Ocean cyclone season', '', 2026)).toBe(2026)
    expect(impliedYearOf('Brazil (1900–2000)', '', 2026)).toBeUndefined()
    expect(sentenceDate('On 7 January, a low-pressure area intensified into a depression over the Bay of Bengal.', 2026, 2026)?.iso).toBe('2026-01-07')
    expect(sentenceDate('On 7 January, a low-pressure area intensified.', 2026)).toBeNull()
    expect(sentenceDate('After nearly half a year of inactivity, on 5 July, the IMD classified a depression.', 2026, 2026)?.iso).toBe('2026-07-05')
  })
  it('infers it from an event article whose dates agree', () => {
    const text = 'It formed on 20 October 2026. It peaked on 22 October 2026. It hit land on 24 October 2026. Earlier, a storm hit on 1 May 2019.'
    expect(impliedYearOf('Cyclone Arnab', text, 2026)).toBe(2026)
    const entries = chronologyFromWikitext('2026 North Indian Ocean cyclone season', '== Systems ==\n=== Cyclone Arnab ===\nOn 20 October, a low-pressure area formed over the Andaman Sea near Myanmar.\nOn 24 October, Arnab made landfall over Odisha as a very severe cyclonic storm.', 2026)
    expect(entries.map((e) => e.at.iso)).toEqual(['2026-10-20', '2026-10-24'])
  })
})
