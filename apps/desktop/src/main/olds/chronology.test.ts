import { describe, expect, it } from 'vitest'
import { chronologyFromWikitext, impliedYearOf, isDebris, sentenceDate } from './chronology'

describe('chronology from an article', () => {
  it('reads plain dates only', () => {
    expect(sentenceDate('On 19 December 2018, the prosecutor recommended charges.', 2026)).toMatchObject({ iso: '2018-12-19', precision: 'day' })
    expect(sentenceDate('In January 2017 the unit began work.', 2026)).toMatchObject({ iso: '2017-01', precision: 'month' })
    expect(sentenceDate('In 2016, police opened the case.', 2026)).toMatchObject({ iso: '2016', precision: 'year' })
    expect(sentenceDate('He was born in a small town and studied law.', 2026)).toBeNull()
    expect(sentenceDate('Smith (2019) argued the opposite.', 2026)).toBeNull()
    expect(sentenceDate('The first election was held in 1949.', 2026)?.iso).toBe('1949')
    expect(sentenceDate('The system introduced in 1949 was changed in 1992.', 2026)).toBeNull()
    expect(sentenceDate('Reuters reported in November that construction began at a base abandoned in 2004.', 2026)).toBeNull()
    expect(sentenceDate('The government withdrew from an agreement it had established in 2015.', 2026)).toBeNull()
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

describe('timeline articles', () => {
  it('dates undated lines by their day heading, and day headings by a year heading', () => {
    const text = '== 2026 ==\n=== 14 October ===\n* The Rapid Support Forces shell El Fasher, killing at least 12 civilians in the market.\n=== 27 October ===\n* A drone strike on a market in Nyala kills over 100 people, according to local officials.'
    const entries = chronologyFromWikitext('Timeline of the Sudanese civil war (2023–present)', text, 2026)
    expect(entries.map((e) => e.at.iso)).toEqual(['2026-10-14', '2026-10-27'])
  })
})

// Real cases from the live audit of 16 November 2026 (44 headlines, 325 dated events).
describe('dates the source states (2026-11-16 audit)', () => {
  it('dates a year-page item by the day it opens with, not a year it mentions', () => {
    // Was shown at 1916.
    const wikitext = '==Events==\n=== March ===\n* 13 March – France returns a [[talking drum]] looted in 1916 at a ceremony in [[Abidjan]], the first time it has repatriated a cultural artefact to Ivory Coast.<ref>{{Cite web |date=14 March 2026 |title=France returns talking drum}}</ref>'
    const entries = chronologyFromWikitext('2026 in Ivory Coast', wikitext, 2026)
    expect(entries.map((entry) => entry.at.iso)).toEqual(['2026-03-13'])
    expect(sentenceDate('On 13 March, France returned a talking drum looted in 1916 at a ceremony in Abidjan.', 2026, 2026)?.iso).toBe('2026-03-13')
  })

  it('makes each list item its own event, and leaves out the deaths listed by month', () => {
    // Were one event dated 10 Feb holding both items; and "7 Nov 2026: Ritsuko Nakayama, bowler … November 13 – Masaaki Yamazaki".
    const wikitext = `==Events==
===February===
* 10 February – Prosecutors raid legislator [[Kao Chin Su-mei]]'s office and summon her for questioning on suspicion of misappropriating her aides' salaries.<ref>x</ref>
* 12 February – Taiwan agrees to remove or reduce 99% of its tariffs as part of a trade agreement with the United States.<ref>y</ref>
==Deaths==
=== November ===
* November 7 – [[Ritsuko Nakayama]], bowler and television personality (b. 1942)
* November 13 – [[Masaaki Yamazaki]], politician (b. 1942) and speaker of the House of Councillors
==See also==`
    const entries = chronologyFromWikitext('2026 in Taiwan', wikitext, 2026)
    expect(entries.map((entry) => [entry.at.iso, entry.text.slice(0, 14)])).toEqual([['2026-02-10', '10 February – '], ['2026-02-12', '12 February – ']])
    expect(entries[0]!.text).not.toMatch(/12 February/)
  })

  it('dates a sentence by the year it opens with, or else the first date it states', () => {
    // Was shown at June 1947.
    expect(sentenceDate('In 1920 John Maynard Keynes proposed a European customs union for the struggling post-war European economies, and in 1923 the oldest organisation for European integration, the Paneuropean Union was founded, led by Richard von Coudenhove-Kalergi, who would later found in June 1947 the European Parliamentary Union.', 2026)?.iso).toBe('1920')
    expect(sentenceDate('In June 2015, Diallo was loaned out to Zulte Waregem, and on 14 July 2017 he moved to Mainz 05.', 2026)?.iso).toBe('2015-06')
    // Unchanged: a full date in the same year as the opening one refines it; a lone full date is used wherever it stands.
    expect(sentenceDate('In 2019, the agreement was signed on 5 May 2019 in Geneva.', 2026)?.iso).toBe('2019-05-05')
    expect(sentenceDate('The last recorded was the Hōei eruption which started on December 16, 1707, and ended about January 1, 1708 (16 days).', 2026)?.iso).toBe('1707-12-16')
    // An opening that only sets the scene ("Since", "After") leaves the stated date as the event's.
    expect(sentenceDate('Since 2007, Israel and Hamas have fought four wars, and on 7 October 2023 Hamas led an attack on southern Israel.', 2026)?.iso).toBe('2023-10-07')
    expect(sentenceDate('After 1945 the peninsula was divided, and on 25 June 1950 the North invaded the South.', 2026)?.iso).toBe('1950-06-25')
    expect(sentenceDate('Since 2007, Israel and Hamas have engaged in conflict, including four wars.', 2026)?.iso).toBe('2007')
  })
})

describe('quotes that are whole (2026-11-16 audit)', () => {
  it('does not cut a sentence at an initial or a numbered club name', () => {
    // Were "…loaned out to Belgian club S.V." and "…moved to Bundesliga club 1."
    const wikitext = '== Club career ==\nIn June 2015, Diallo was loaned out to Belgian club S.V. Zulte Waregem for the 2015–16 season.<ref>a</ref> On 14 July 2017, Diallo moved to [[Bundesliga]] club 1. FSV Mainz 05, and signed a five-year contract.<ref>b</ref>'
    const entries = chronologyFromWikitext('Abdou Diallo', wikitext, 2026)
    expect(entries.map((entry) => entry.text)).toEqual([
      'In June 2015, Diallo was loaned out to Belgian club S.V. Zulte Waregem for the 2015–16 season.',
      'On 14 July 2017, Diallo moved to Bundesliga club 1. FSV Mainz 05, and signed a five-year contract.',
    ])
  })

  it('keeps a measurement written with a template, and drops a sentence a template left a hole in', () => {
    // Was "…earthquake with a shallow depth of occurred in the Pacific Ocean, east-southeast of Nikolskoye…".
    const wikitext = '== Geology ==\nA significant 7.7-magnitude earthquake with a shallow depth of {{convert|10|km|ft|sigfig=2}} occurred in the Pacific Ocean, {{convert|202|km|nmi}} east-southeast of [[Nikolskoye, Kamchatka Krai|Nikolskoye]], on July 18, 2017.<ref>{{cite web|title=M 7.7}}</ref> The volcano, which rises to {{height|m=4750}} above the sea, last erupted on 2 August 2020 according to observers.'
    const entries = chronologyFromWikitext('Kamchatka Peninsula', wikitext, 2026)
    expect(entries.map((entry) => entry.text)).toEqual(['A significant 7.7-magnitude earthquake with a shallow depth of 10 km occurred in the Pacific Ocean, 202 km east-southeast of Nikolskoye, on July 18, 2017.'])
  })

  it('drops a piece cut out of a quotation, and a file caption run into a sentence', () => {
    expect(isDebris('October 2023 to July 2024] are consistent with the characteristics of genocide."')).toBe(true)
    expect(isDebris('The most recent death of a former prime minister was that of Édouard Balladur (1993–1995), on 31 August 2026. File:17.10.27 Recepción Tribunales Constitucionales.')).toBe(true)
    expect(isDebris('In September 2024, a UN Special Committee concluded that "the policies and practices of Israel" were consistent with it.')).toBe(false)
  })
})

describe('section links that open the section (2026-11-16 audit)', () => {
  it('uses the heading’s id as Wikipedia renders it', () => {
    // Was #Initial_years_and_the_Paris_Treaty_(19481957), which is no section of the article.
    const wikitext = '==History==\n===Initial years and the Paris Treaty (1948{{Non breaking en dash}}1957)===\nOn 9 May 1950, French Foreign Minister Robert Schuman proposed a community to integrate the coal and steel industries of Europe.\n=== The {{lang|fr|Acquis}} today ===\nIn 2004, ten further countries joined the union under the terms that had been agreed.'
    const entries = chronologyFromWikitext('European Union', wikitext, 2026)
    expect(entries[0]).toMatchObject({ section: 'Initial years and the Paris Treaty (1948–1957)', url: `https://en.wikipedia.org/wiki/European_Union#${encodeURIComponent('Initial_years_and_the_Paris_Treaty_(1948‍–‍1957)')}` })
    // A heading whose rendering cannot be told links to the article rather than to a section that may not exist.
    expect(entries[1]!.url).toBe('https://en.wikipedia.org/wiki/European_Union')
  })

  it('reads a fifth-level heading as a heading', () => {
    // Was #=_Anti-drug_legislation= (Crime in Costa Rica).
    const wikitext = '== Drugs ==\n===== Anti-drug legislation =====\nThe Narcotics and Psychotropic Substances law (Law 8204) was reformed in 2009 to cover money laundering as well.'
    expect(chronologyFromWikitext('Crime in Costa Rica', wikitext, 2026)[0]).toMatchObject({ section: 'Anti-drug legislation', url: 'https://en.wikipedia.org/wiki/Crime_in_Costa_Rica#Anti-drug_legislation' })
  })
})
