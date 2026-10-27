import { describe, expect, it } from 'vitest'
import { chaptersFromWikitext, stripWikitext, yearsIn } from './historyArticle'

const ARTICLE = `Lead text about the island.
== Early cultures ==
[[File:Map.png|thumb|A map of [[Sites]] and [[Routes|routes]]]] The first people arrived around 2500 BC. Later groups came around 800 BC and stayed until about 1 AD.
== Norse settlement ==
{{Main|Norse settlements in Greenland}}
Erik the Red founded a colony in 985. It lasted until about 1450.<ref>{{cite book|year=1999|title=Sagas}}</ref>
== Paleolithic ==
Fossils show primates lived here 20 million years ago. Remains were found in 1984 (Leakey 1984: 12) and studied in 2018.
== Colonisation (1721–1953) ==
Hans Egede arrived in 1721.
=== World War II ===
{{See also|Greenland in World War II|Denmark–United States relations#Greenland}}
The occupation of Denmark in 1940 cut the island off until 1945.
== See also ==
* [[Something]]
== Further reading ==
=== Primary sources ===
* Smith, J. (2006). A book. pp. 11–31.
`

describe('history chapters', () => {
  const chapters = chaptersFromWikitext('History of Testland', ARTICLE, 2026)

  it('keeps narrative sections in order and skips reference sections', () => {
    expect(chapters.map((chapter) => chapter.title)).toEqual(['Early cultures', 'Norse settlement', 'Paleolithic', 'Colonisation (1721–1953)', 'World War II'])
    expect(chapters.find((chapter) => chapter.title === 'World War II')?.level).toBe(2)
  })

  it('dates chapters from their headings, or approximately from the years named', () => {
    const [early, norse, paleo, colony, war] = chapters
    expect(early!.start?.label).toBe('c. 2500 BC')
    expect(norse!.start?.label).toBe('c. 985')
    expect(norse!.end?.label).toBe('c. 1450')
    expect(paleo!.start).toBeNull() // deep time; 1984/2018 are discovery and citation years
    expect(colony!.start?.label).toBe('1721')
    expect(colony!.end?.label).toBe('1953')
    expect(war!.start?.label).toBe('c. 1940')
  })

  it('links main articles, falling back to See also', () => {
    expect(chapters[1]!.mainArticle?.title).toBe('Norse settlements in Greenland')
    expect(chapters[4]!.mainArticle?.title).toBe('Greenland in World War II')
    expect(chapters[1]!.url).toBe('https://en.wikipedia.org/wiki/History_of_Testland#Norse_settlement')
  })

  it('summarises without markup', () => {
    expect(chapters[0]!.summary).toBe('The first people arrived around 2500 BC. Later groups came around 800 BC and stayed until about 1 AD.')
    expect(chapters[1]!.summary).not.toMatch(/cite|ref|\{|\[/)
  })

  it('keeps abbreviations and drops galleries and code from summaries', async () => {
    const { leadSentences, stripWikitext: strip } = await import('./historyArticle')
    const reign = leadSentences(strip('During the reign of Peter I (r. 927–969) a heretical movement arose. It spread.'))!
    expect(reign.startsWith('During the reign of Peter I (r. 927–969) a heretical movement arose.')).toBe(true)
    expect(leadSentences('Remains date to (c. 800,000 BCE). Excavations followed in 1993.')!.startsWith('Remains date to (c. 800,000 BCE).')).toBe(true)
    expect(leadSentences('The Dutch feared that the East Indies (i.e. Indonesia) might fall to France. Britain moved in.')!.startsWith('The Dutch feared that the East Indies (i.e. Indonesia) might fall')).toBe(true)
    const body = '<gallery>\nCopan.jpg|Ball Court of Copán\n</gallery>\nFile:Map.png|thumb\nThe Maya built cities here. Later came others.'
    expect(leadSentences(strip(body))!.startsWith('The Maya built cities here.')).toBe(true)
  })

  it('gives an empty heading the sections that follow it, and keeps language-template text', async () => {
    const { sectionWithSubsections, stripWikitext: strip } = await import('./historyArticle')
    const text = '== Modern ==\nIntro.\n=== 2010s ===\nA [[2016 election]].\n=== 2020s ===\n=== COVID-19 Pandemic ===\nThe [[COVID-19 pandemic in Jamaica]].\n=== Hurricane Melissa ===\n[[Hurricane Melissa]] struck.\n== See also =='
    const body = sectionWithSubsections(text, '2020s')!
    expect(body).toContain('COVID-19 pandemic in Jamaica')
    expect(body).toContain('Hurricane Melissa')
    expect(body).not.toContain('2016 election')
    expect(sectionWithSubsections(text, '2010s')).not.toContain('COVID')
    expect(strip('{{lang|fr|Les Nouvelles calédoniennes}} is the only daily newspaper.')).toBe('Les Nouvelles calédoniennes is the only daily newspaper.')
    expect(strip('A {{convert|80|km|mi}} canal.')).toBe('A 80 km canal.')
  })

  it('reads years and strips wikitext', () => {
    expect(yearsIn('From 800 BC to AD 1000, then (1999) and 2030.', 2026)).toEqual([-800, 1000])
    expect(stripWikitext("'''Bold''' [[Target|shown]] {{cite|x}} <ref>gone</ref>")).toBe('Bold shown')
  })
})
