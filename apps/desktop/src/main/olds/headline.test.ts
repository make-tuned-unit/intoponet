import { describe, expect, it } from 'vitest'
import { cleanHeadline, personNameAtStart, eventKindMatches, eventKindConflicts, foreignNamesIn, mentions, properPhrases, scoreCandidate, searchQueries, titleWordsIn, isRelevantCandidate, topicAge } from './headline'
import { headlineCountries, isWorkOrThing, keepCandidate, withoutCountryNames } from './oldsService'

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

describe('candidate relevance', () => {
  const honduras = 'After 48 days of assemblies, patients crowd hospitals and cry out for decent care'
  it('rejects topics that share nothing with the headline', () => {
    expect(isRelevantCandidate('2012 Delhi gang rape and murder', honduras, 'Honduras')).toBe(false)
    expect(isRelevantCandidate('List of Hazel episodes', honduras, 'Honduras')).toBe(false)
    expect(isRelevantCandidate('Billy Sunday', honduras, 'Honduras')).toBe(false)
  })
  it('rejects a single shared word in a long title full of other names', () => {
    expect(isRelevantCandidate('Great National Assembly (Romania)', 'National strike in Honduras', 'Honduras')).toBe(false)
  })
  it('keeps topics the headline is about', () => {
    expect(isRelevantCandidate('2026 Brazilian general election', 'Lula leads as Brazil election nears', 'Brazil')).toBe(true)
    expect(isRelevantCandidate('Greenland independence movement', 'Greenland independence vote looms', 'Denmark')).toBe(true)
    expect(isRelevantCandidate('Healthcare in Honduras', 'Healthcare workers strike for a seventh week', 'Honduras')).toBe(true)
  })
})

describe('meaning check (Laya)', () => {
  it('uses words alone when Laya is off', () => {
    expect(keepCandidate(true, null)).toBe(true)
    expect(keepCandidate(false, null)).toBe(false)
  })
  it('rescues a close meaning only for a topic that passed every other check, and vetoes an unrelated one', () => {
    expect(keepCandidate(false, 0.6, true)).toBe(true)
    // "BPA Worldwide" for a Barbados police association: close-ish meaning, but it failed the rules.
    expect(keepCandidate(false, 0.6, false)).toBe(false)
    expect(keepCandidate(true, 0.1)).toBe(false)
    expect(keepCandidate(true, 0.3)).toBe(true)
    expect(keepCandidate(false, 0.3)).toBe(false)
  })
  it('never vetoes a topic the headline names in full', () => {
    // "Dubai" for "What's new at Dubai Fitness Challenge": a city's description reads nothing like a fitness story.
    expect(keepCandidate(true, 0.1, false, true)).toBe(true)
    expect(keepCandidate(false, 0.1, false, true)).toBe(false)
  })
})

describe('single-word matches', () => {
  it('ignores a match on just the headline’s first word', () => {
    expect(isRelevantCandidate('Tras De Mí', 'Tras 48 días de asambleas, pacientes abarrotan hospitales y claman atención digna', 'Honduras')).toBe(false)
    expect(isRelevantCandidate('Defender (video game)', 'Defender los pequeños negocios chinos es un deber del pueblo', 'Honduras')).toBe(false)
    expect(isRelevantCandidate('Las Capitalinas', 'Capitalinos se organizan contra privatización del servicio del agua', 'Honduras')).toBe(false)
  })
  it('accepts a single shared name', () => {
    expect(isRelevantCandidate('Greenland', 'US renews push to buy Greenland', 'Denmark')).toBe(true)
    expect(isRelevantCandidate('Hurricane Mitch', 'Hurricane Mitch anniversary: Honduras remembers', 'Honduras')).toBe(true)
  })
  it('rejects a generic country overview matched only by the country name', () => {
    expect(isRelevantCandidate('Education in Honduras', 'Detienen en Honduras a guatemalteco y decomisan medicamentos', 'Honduras')).toBe(false)
  })
})

describe('event titles', () => {
  it('matches "Trial of Benjamin Netanyahu" without Laya, but not unrelated events', () => {
    expect(isRelevantCandidate('Trial of Benjamin Netanyahu', 'Israel to give verdict on Netanyahu in pivotal election', 'Israel')).toBe(true)
    expect(isRelevantCandidate('2026 Bangladeshi general election', 'Israel to give verdict on Netanyahu in pivotal election', 'Israel')).toBe(false)
    expect(isRelevantCandidate('Education in Honduras', 'Detienen en Honduras a guatemalteco y decomisan medicamentos', 'Honduras')).toBe(false)
  })
})

describe('news is about now', () => {
  const base = { rank: 0, eventLike: true, inCountry: false, isPerson: false, isCountry: false, isDisambiguation: false, titleWordsInHeadline: 1, foreignNames: 0, otherCountry: false }
  it('prefers this year\'s outbreak over a famous old one', () => {
    expect(topicAge('1976 Zaire Ebola virus outbreak', '1976', true, 2026)).toBe(50)
    expect(topicAge('2026 Ebola epidemic', null, true, 2026)).toBe(0)
    expect(topicAge('Ebola', null, false, 2026)).toBeNull()
    expect(scoreCandidate({ ...base, ageYears: 0 })).toBeGreaterThan(scoreCandidate({ ...base, ageYears: 50 }) + 3)
  })
  it('searches for this year\'s event too', () => {
    expect(searchQueries('DR Congo reports over 10,000 Ebola cases', 2026)).toContain('2026 DR Congo Ebola')
  })
})

describe('countries a headline names', () => {
  it('finds the story\'s country, not people named like countries', () => {
    expect(headlineCountries('South Africa Deploys 500 Soldiers to Quell Anti-Immigration Violence')).toEqual(['ZA'])
    expect(headlineCountries('DR Congo reports over 10,000 Ebola cases as the outbreak spreads abroad')).toEqual(['CD'])
    expect(headlineCountries('Lula’s win in Brazil deals blow to Trump’s Latin America push')).toEqual(['BR'])
    expect(headlineCountries('States seeks interest for possible housing sites')).toEqual([])
    expect(headlineCountries('Jordan Peterson speaks at a rally in the capital')).toEqual([])
    expect(headlineCountries('Subsidized housing in the United States')).toEqual(['US'])
    expect(headlineCountries('2026 United States Senate elections')).toEqual(['US'])
    expect(headlineCountries('Germany\'s Merz says erosion of global order means middle powers must act')).toEqual(['DE'])
  })
  it('matches compound names to the countries they stand for', () => {
    expect(titleWordsIn('Peace negotiations in the Russo-Ukrainian war', 'Who brokered Russia-Ukraine ceasefire')).toBe(2)
    expect(isRelevantCandidate('Blockade of Oleshky', 'Melania or the pope: Who brokered Russia-Ukraine ceasefire in Oleshky?')).toBe(true)
  })
})

describe('country-only matches', () => {
  it('removes the countries a headline names, with their adjectives', () => {
    const subject = withoutCountryNames('Germany\'s Merz says erosion of global order means middle powers must act')
    expect(titleWordsIn('German economic crisis (2022–present)', subject)).toBe(0)
    expect(titleWordsIn('Merz cabinet', subject)).toBe(1)
    expect(titleWordsIn('History of South Africa', withoutCountryNames('South Africa Deploys 500 Soldiers'))).toBe(0)
    expect(titleWordsIn('Blockade of Oleshky', withoutCountryNames('Who brokered Russia-Ukraine ceasefire in Oleshky?'))).toBe(1)
  })
})

describe('works and things are not news topics', () => {
  it('spots films, series and foods by their description', () => {
    expect(isWorkOrThing('2026 documentary film directed by Brett Ratner')).toBe(true)
    expect(isWorkOrThing('British television drama series')).toBe(true)
    expect(isWorkOrThing('species of tree')).toBe(true)
    expect(isWorkOrThing('annual film festival held in Cannes')).toBe(false)
    expect(isWorkOrThing('annual championship series of Major League Baseball')).toBe(false)
    expect(isWorkOrThing('outbreak of Ebola virus disease')).toBe(false)
  })
  it('finds named events and US by its short name', () => {
    expect(searchQueries('India Evacuates Tens of Thousands as Cyclone Arnab Approaches', 2026)[0]).toMatch(/^Cyclone Arnab/)
    expect(headlineCountries('US says five dead in strike on alleged drug-smuggling boat')).toEqual(['US'])
    expect(headlineCountries('Cease-Fire Brokered by Melania Trump Begins in Ukrainian City of Oleshky')).toEqual(['UA'])
    expect(headlineCountries('Indian Ocean storms intensify')).toEqual([])
    expect(headlineCountries('Países de América Latina exigen que el próximo secretario general de la ONU sea de la región')).toEqual([])
    expect(headlineCountries('The Key Election Issues Dividing Israelis as They Vote')).toEqual(['IL'])
    expect(titleWordsIn('2026 North Indian Ocean cyclone season', 'India Evacuates as Cyclone Arnab Approaches')).toBe(2)
  })
})

describe('current events need a matching kind', () => {
  it('links a win to an election, not a card deal to an offensive', () => {
    expect(eventKindMatches('2026 Brazilian general election', 'Lula’s win in Brazil deals blow to Trump’s Latin America push')).toBe(true)
    expect(eventKindMatches('2026 Ethiopian offensive', 'Kacha, Mastercard Ink Deal to Expand Card Issuance in Ethiopia')).toBe(false)
    expect(eventKindMatches('2026 Brazilian general election', 'Flavio Bolsonaro flees Brazil for US amid investigation')).toBe(false)
  })
})

describe('column labels', () => {
  it('drops "Reader Q&A:" and the capital after a colon', () => {
    expect(cleanHeadline('Reader Q&A: After Lula’s sensational victory in Brazil’s presidential election')).toBe('After Lula sensational victory in Brazil presidential election')
    expect(properPhrases('Analysts say: After Lula won, markets rose')).not.toContain('After Lula')
    expect(searchQueries('Reader Q&A: After Lula’s sensational victory in Brazil’s presidential election', 2026)).toContain('2026 Lula Brazil')
  })
})

describe('one shared word stays one', () => {
  it('does not let the year turn a single word into a match', () => {
    expect(isRelevantCandidate('2026 Presidents Cup', 'President honours flydubai crew for courage during September 30 mid-air attack', undefined, 2026)).toBe(false)
    expect(isRelevantCandidate('2026 Caribbean Premier League', "King acknowledges 'suffering of the past' as Caribbean tour begins", undefined, 2026)).toBe(false)
    expect(isRelevantCandidate('2026 Brazilian general election', 'Lula’s win in Brazil deals blow to Trump’s Latin America push', 'Brazil', 2026)).toBe(true)
    expect(isWorkOrThing('genus of tyrannosaurid dinosaur')).toBe(false)
    expect(isRelevantCandidate('September 11 attacks', 'President honours flydubai crew for courage during September 30 mid-air attack')).toBe(false)
    expect(isWorkOrThing('species of tree')).toBe(true)
  })
})

describe('generic cases from the 25-story review', () => {
  it('strips section labels', () => {
    expect(cleanHeadline('International News: US to issue visas to Flávio Bolsonaro and family')).toBe('United States to issue visas to Flávio Bolsonaro and family')
    expect(cleanHeadline('Sport | Drua unveil star-studded squad')).toBe('Drua unveil star-studded squad')
  })
  it('reads "North and South Korea" as two countries', () => {
    expect(headlineCountries('Tensions Between North and South Korea Stem From Decade-Old Border Dispute').sort()).toEqual(['KP', 'KR'])
  })
  it('removes abbreviated countries from the subject too', () => {
    expect(titleWordsIn('2025–2026 Iran–United States negotiations', withoutCountryNames('US to issue visas to Flávio Bolsonaro after election defeat'))).toBe(0)
  })
  it('matches untranslated headlines on content words, not function words', () => {
    expect(titleWordsIn('Conflicto del Sáhara Occidental', 'Sáhara Occidental | ¿Qué cambios se conocen ya en el proyecto de EEUU ante el Consejo de Seguridad?')).toBe(2)
    expect(titleWordsIn('Partido de la Gente', 'Dos hombres resultan heridos en ataques con machetes en el barrio de Alcaide')).toBe(0)
  })
})

describe('nationality words', () => {
  it('do not name a topic on their own, but countries do', () => {
    expect(isRelevantCandidate('English language', 'Where does Arsenal’s Fleetwood humiliation place in English cup shocks?')).toBe(false)
    expect(isRelevantCandidate('Iran', 'Talks with Iran resume in Oman')).toBe(true)
  })
})


describe('people opening a headline', () => {
  it('recognises exact surnames and full names without accents', () => {
    expect(personNameAtStart('Kylian Mbappé', 'Mbappe apologises for Mao Zedong comment')).toBe(true)
    expect(personNameAtStart('Kylian Mbappé', 'Kylian Mbappe apologises')).toBe(true)
    expect(personNameAtStart('Mao Zedong', 'Mbappe apologises for Mao Zedong comment')).toBe(false)
  })
  it('does not treat partial full-name overlap as the same person', () => {
    expect(personNameAtStart('Wilson das Neves', 'Wilson Neves launches banking book')).toBe(false)
    expect(personNameAtStart('Wilson Smith', 'Wilson Neves launches banking book')).toBe(false)
    expect(personNameAtStart('Wilson Neves', 'Wilson Neves launches banking book')).toBe(true)
    expect(personNameAtStart('Claude Rains', 'Rain causes flooding')).toBe(false)
  })
})

describe('quantities in headlines', () => {
  it('does not turn a shared count into a subject match', () => {
    const headline = 'Forty-two students honoured at Dominica’s inaugural National Schools’ Awards ceremony for academic excellence'
    expect(titleWordsIn('Forty-two Articles', headline)).toBe(0)
    expect(isRelevantCandidate('Forty-two Articles', headline, 'Dominica')).toBe(false)
    expect(titleWordsIn('Seven Years War', 'Seven students receive awards')).toBe(0)
    expect(titleWordsIn('Dominica', headline)).toBe(1)
  })
})

describe('death event relevance', () => {
  it('does not substitute a named person’s funeral for a story about their remarks', () => {
    const title = 'Death and state funeral of Mao Zedong'
    expect(eventKindConflicts(title, 'Mbappe apologises for Mao Zedong comment after Chinese sponsors drop him')).toBe(true)
    expect(eventKindConflicts(title, 'China marks anniversary of Mao Zedong’s death')).toBe(false)
    expect(eventKindConflicts('Death of John Smith', 'John Smith killed in crash')).toBe(false)
    expect(eventKindConflicts('Death of John Smith', 'John Smith wins election')).toBe(true)
  })
})
