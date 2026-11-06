import { describe, expect, it } from 'vitest'
import { cleanHeadline, personNameAtStart, explicitPlacePhrases, fullPersonNameMentioned, entityNameAtStart, personActivityConflicts, eventKindMatches, eventNameConflicts, eventKindConflicts, foreignNamesIn, mentions, properPhrases, scoreCandidate, searchQueries, localLegislativeSubject, scopedSubjectMatches, titleWordsIn, isRelevantCandidate, topicAge } from './headline'
import { headlineCountries, isWorkOrThing, keepCandidate, withoutCountryNames } from './oldsService'

describe('overviews of a subject in a country', () => {
  it('need the whole subject in the headline', () => {
    expect(isRelevantCandidate('Video games in Malaysia', '3 arrested over viral assault video along Jalan Petanak', 'Malaysia', 2026)).toBe(false)
    expect(isRelevantCandidate('Banking in Uganda', 'Nedbank buys its way into Uganda banking battle', 'Uganda', 2026)).toBe(true)
  })
})

describe('sports do not cross', () => {
  it('keeps a cricket story off a racing series, and a sport on its own sport', () => {
    expect(eventKindConflicts('2026 Aussie Racing Car Series', 'Series set for epic finale as Aussie batters must stand up')).toBe(true)
    expect(eventKindConflicts('2026 Ashes series', 'Aussie batters must stand up as Ashes series reaches its finale')).toBe(false)
    expect(eventKindConflicts('2026 Formula One World Championship', 'Grand Prix: Verstappen wins in Mexico')).toBe(false)
    expect(eventKindConflicts('2026 FIFA World Cup', 'Election day in Ohio')).toBe(true)
    expect(eventKindConflicts("Florida's 22nd congressional district", "Florida's 27th Congressional District race between Salazar and her challenger")).toBe(true)
    expect(eventKindConflicts("Florida's 27th congressional district", "Florida's 27th Congressional District race tightens")).toBe(false)
  })
})

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
  it('keeps names preserved through translation without inventing namesakes', () => {
    expect(personNameAtStart('Kylian Mbappé', 'Mbappé controversy in China: Real Madrid apologizes', 'Polémique Mbappé en Chine : le Real Madrid s’excuse')).toBe(true)
    expect(personNameAtStart('Claude Rains', 'Rains cause flooding in Peru', 'Lluvias en Perú')).toBe(false)
    // A role opening a headline is not a surname.
    expect(personNameAtStart('Mike Judge', 'Judge rejects Trump administration bid to set aside 20,000 California ballots')).toBe(false)
    expect(personNameAtStart('Doug Mayor', 'Mayor says the bridge will reopen')).toBe(false)
    expect(personNameAtStart('Stephen King', 'King returns to Maine for his new novel')).toBe(true)
    expect(personNameAtStart('Kylian Mbappé', 'Mbappé apologizes', 'Polémique Mbappéville')).toBe(false)
  })
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
  it('distinguishes a film premiere fundraiser from a sporting league', () => {
    expect(eventKindConflicts('Jamaica Premier League', "Jamaica Association to host fundraiser with premiere of thriller 'Stew Peas'")).toBe(true)
    expect(eventKindConflicts('Jamaica Premier League', 'Jamaica football clubs prepare for the season')).toBe(false)
  })
  it('does not substitute a named person’s funeral for a story about their remarks', () => {
    const title = 'Death and state funeral of Mao Zedong'
    expect(eventKindConflicts(title, 'Mbappe apologises for Mao Zedong comment after Chinese sponsors drop him')).toBe(true)
    expect(eventKindConflicts(title, 'China marks anniversary of Mao Zedong’s death')).toBe(false)
    expect(eventKindConflicts('Death of John Smith', 'John Smith killed in crash')).toBe(false)
    expect(eventKindConflicts('Death of John Smith', 'John Smith wins election')).toBe(true)
  })
})


describe('named events without country metadata', () => {
  it('requires the organiser or competition name, not just a shared event type', () => {
    expect(eventNameConflicts("Mickey's Halloween Party", 'BUEI To Host Annual Halloween Party', 'Bermuda')).toBe(true)
    expect(eventNameConflicts('2026 European Motocross Championship', 'Round 8 of the 2026 Guam Monster Energy Motocross Championship', 'Guam')).toBe(true)
    expect(eventNameConflicts('2026 GB3 Championship', 'Guam Motocross Championship', 'Guam')).toBe(true)
    expect(eventNameConflicts('Zambia at the 2026 Commonwealth Games', 'Team Zambia kit for Dakar 2026 Games', 'Zambia')).toBe(true)
    expect(eventNameConflicts('Zambia national football team', 'Team Zambia kit for Dakar Games', 'Zambia')).toBe(true)
    expect(eventNameConflicts("Jamaica Teachers' Association", 'Jamaica Association to host fundraiser', 'Bermuda')).toBe(true)
  })
  it('keeps explicitly named competitions and teams', () => {
    expect(eventNameConflicts('2026 Summer Youth Olympics', 'Cayman athletes depart for Dakar Youth Olympic Games', 'Cayman Islands')).toBe(false)
    expect(eventNameConflicts('2026 European Motocross Championship', 'European Motocross Championship resumes')).toBe(false)
    expect(eventNameConflicts('2026 GB3 Championship', 'GB3 Championship resumes')).toBe(false)
    expect(eventNameConflicts('Zambia national football team', 'Zambia football team wins')).toBe(false)
    expect(eventNameConflicts("Mickey's Halloween Party", "Mickey's Halloween Party returns")).toBe(false)
  })
})


describe('current activity and deceased namesakes', () => {
  it('rejects current actions attributed to long-deceased people', () => {
    expect(personActivityConflicts('Wilson das Neves', 'Wilson Neves launches book for the banking sector', 2017, 2026)).toBe(true)
    expect(personActivityConflicts('Bernardo Bernardo', 'Bernardo on saying Jinggoy got millions in kickbacks', 2018, 2026)).toBe(true)
  })
  it('keeps historical accounts, recent deaths, unknown dates and other subjects', () => {
    expect(personActivityConflicts('Wilson das Neves', 'Wilson Neves launches book in 2010', 2017, 2026)).toBe(false)
    expect(personActivityConflicts('Bernardo Bernardo', 'Bernardo says goodbye: archive interview', 2018, 2026)).toBe(false)
    expect(personActivityConflicts('Wilson das Neves', 'Wilson Neves launches book', 2026, 2026)).toBe(false)
    expect(personActivityConflicts('Wilson das Neves', 'Wilson Neves launches book', null, 2026)).toBe(false)
    expect(personActivityConflicts('Mao Zedong', 'Mbappe apologises for Mao comment', 1976, 2026)).toBe(false)
  })
})


describe('opening organisation identity', () => {
  it('allows exact names and company suffixes, not affiliated places or people', () => {
    expect(entityNameAtStart('FNB Stadium', 'FNB')).toBe(false)
    expect(entityNameAtStart('FNB Stadium (Johannesburg)', 'FNB')).toBe(false)
    expect(entityNameAtStart('Nedbank Cup', 'Nedbank')).toBe(false)
    expect(entityNameAtStart('FNB (Eswatini)', 'FNB')).toBe(true)
    expect(entityNameAtStart('Nedbank Group', 'Nedbank')).toBe(true)
    expect(entityNameAtStart('Acme Holdings Ltd.', 'Acme')).toBe(true)
    expect(entityNameAtStart('First National Bank', 'First National Bank')).toBe(true)
  })
})


describe('foreign full-name identity', () => {
  it('does not identify a foreign namesake from a partial full name', () => {
    expect(fullPersonNameMentioned('Wilson das Neves', 'Wilson Neves lança livro para o sector bancário')).toBe(false)
    expect(fullPersonNameMentioned('Wilson Pires Neves', 'Wilson Neves lança livro')).toBe(false)
    expect(fullPersonNameMentioned('Mao Zedong', 'Remarks about Mao Zedong')).toBe(true)
    expect(fullPersonNameMentioned('Kylian Mbappé', 'Club apologises for Kylian Mbappe')).toBe(true)
    expect(fullPersonNameMentioned('Ann Lee', 'Joann Leeway speaks')).toBe(false)
  })
  it('searches named holidays within their country', () => {
    expect(searchQueries('In Photos: China Begins Its Weeklong National Day Holiday', 2026, 'China')).toContain('China National Day')
    expect(searchQueries('India prepares for Republic Day', 2026, 'India')).toContain('India Republic Day')
  })
})


describe('local legislative subjects', () => {
  it('searches the local assembly rather than moving it to the visitor’s country', () => {
    const headline = 'The President of the National Assembly receives the Parliamentary Secretary of State at the German Ministry of Justice'
    expect(localLegislativeSubject(headline)).toBe('National Assembly')
    expect(searchQueries(headline, 2026, 'Mauritania')[0]).toBe('National Assembly Mauritania')
    expect(localLegislativeSubject('Germany’s President visits Mauritania')).toBeNull()
    expect(localLegislativeSubject('President Trump visits China')).toBeNull()
    expect(localLegislativeSubject('The President of the National Assembly of Germany visits Mauritania')).toBeNull()
    expect(localLegislativeSubject('The Speaker of Parliament (Germany) visits Mauritania')).toBeNull()
  })
})


describe('explicit local event focus', () => {
  it('extracts place phrases that need geocoded confirmation', () => {
    expect(explicitPlacePhrases('Who brokered Russia-Ukraine ceasefire in Oleshky?')).toEqual(['Oleshky'])
    expect(explicitPlacePhrases('Troops clash near New York')).toEqual(['New York'])
    expect(explicitPlacePhrases('Oleshky discusses a ceasefire')).toEqual([])
    expect(eventKindMatches('Blockade of Oleshky', 'Russia-Ukraine ceasefire in Oleshky')).toBe(true)
    expect(eventKindMatches('Blockade of Oleshky', 'Oleshky hosts a music festival')).toBe(false)
  })
})


describe('country-specific headline subjects', () => {
  it('recognises the exact holiday or local legislature, not generic overlapping words', () => {
    expect(scopedSubjectMatches("National Day of the People's Republic of China", 'China begins its National Day holiday')).toBe(true)
    expect(scopedSubjectMatches('China National Maritime Day', 'China begins its National Day holiday')).toBe(false)
    expect(scopedSubjectMatches('National Assembly (Mauritania)', 'The President of the National Assembly receives a German visitor')).toBe(true)
    expect(scopedSubjectMatches('President of Germany', 'The President of the National Assembly receives a German visitor')).toBe(false)
  })
})

describe('subjects that word overlap alone misses (live sample, 30 Oct 2026)', () => {
  it('matches an accident article to a crash headline, and rejects storms named like people', async () => {
    const { eventKindMatches, eventKindConflicts } = await import('./headline')
    expect(eventKindMatches('2026 Toledo train collision', 'Traffic Control Errors Caused Spain’s Deadly Train Crash, Official Says')).toBe(true)
    expect(eventKindMatches('2026 Adamuz rail disaster', 'Train derails near Córdoba')).toBe(true)
    expect(eventKindMatches('2026 Toledo train collision', 'Spain unveils new train timetable')).toBe(false)
    expect(eventKindConflicts('Hurricane Isaias (2026)', 'Sputnik Africa interview with President Isaias')).toBe(true)
    expect(eventKindConflicts('Hurricane Isaias (2026)', 'Hurricane Isaias makes landfall in Mexico')).toBe(false)
  })

  it('recognises a person named by their office only when their description holds it', async () => {
    const { officeHolderNamed } = await import('./headline')
    expect(officeHolderNamed('Isaias Afwerki', 'president of Eritrea since 1993', 'Sputnik Africa interview with President Isaias')).toBe(true)
    expect(officeHolderNamed('Isaías Medina Angarita', 'Venezuelan general and politician', 'Sputnik Africa interview with President Isaias')).toBe(false)
    expect(officeHolderNamed('Mark Carney', 'Prime Minister of Canada since 2025', 'Prime Minister Carney meets premiers')).toBe(true)
    expect(officeHolderNamed('Isaias Afwerki', null, 'President Isaias speaks')).toBe(false)
  })

  it('treats a newspaper as the story only when the headline is about the paper', async () => {
    const { outletIsSubject } = await import('./headline')
    expect(outletIsSubject('Novaya Gazeta', 'Russian independent newspaper Novaya Gazeta says it will shut down following pressure from Kremlin')).toBe(true)
    expect(outletIsSubject('Novaya Gazeta', 'Novaya Gazeta reports troop movements near Kharkiv')).toBe(false)
    expect(outletIsSubject('Sputnik (news agency)', 'Sputnik Africa interview with President Isaias')).toBe(false)
    expect(outletIsSubject('The Guardian', 'Guardian journalists strike over sale')).toBe(false)
  })
})

describe('events and editions the headline does not point to (live sample 2, 30 Oct 2026)', () => {
  it('needs the headline to point to the kind of event a title names', async () => {
    const { eventKindNamed, eventKindMatches } = await import('./headline')
    expect(eventKindNamed('2027 Palestinian presidential election')).toBe(true)
    expect(eventKindMatches('2027 Palestinian presidential election', '‘Error rate’ in Palestinian visa refusals may point to wrongful denials, court told')).toBe(false)
    expect(eventKindNamed('Binance')).toBe(false)
  })
  it('finds numbered editions the headline never mentions', async () => {
    const { unmentionedEditions } = await import('./headline')
    expect(unmentionedEditions('Third plenary session of the 11th Central Committee of the Chinese Communist Party', 'CPC Central Committee holds press conference on plenary session')).toEqual(['third', '11th'])
    expect(unmentionedEditions('Fourth plenary session of the 20th Central Committee', 'Fourth plenary session of 20th CPC Central Committee opens')).toEqual([])
    expect(unmentionedEditions('Central Committee of the Chinese Communist Party', 'CPC Central Committee holds press conference')).toEqual([])
  })
})

describe('capitals standing for their country', () => {
  it('maps a named capital to its country, and leaves other cities alone', async () => {
    const { capitalCountries } = await import('./oldsService')
    expect(capitalCountries('Is Donald Trump’s ‘Chinamaxxing’ pushing Beijing’s soft power?')).toEqual(['CN'])
    expect(capitalCountries('Moscow says talks stalled')).toEqual(['RU'])
    expect(capitalCountries('Ottawa unveils budget')).toEqual(['CA'])
    expect(capitalCountries('Toronto rents rise')).toEqual([])
    expect(capitalCountries('Washington state wildfires spread')).toEqual([])
  })
})

describe('local headlines from the November 2026 sample', () => {
  it('a speech to Congress is not an election result', () => {
    expect(eventKindConflicts('2025 Donald Trump speech to a joint session of Congress', 'Democrats take Congress in historic sweep as voters rebuke Trump')).toBe(true)
  })
  it('New Mexico is not Mexico', () => {
    expect(eventKindConflicts('2026 New Mexico gubernatorial election', 'Potosino businessmen differ on the impact of United States elections for Mexico')).toBe(true)
    expect(eventKindConflicts('2026 New Mexico gubernatorial election', 'Haaland wins New Mexico governor race')).toBe(false)
  })
})

describe('stress-test guards (2026-11-06)', () => {
  it('a famous person matched by surname must fit the headline', async () => {
    const { occupationClashes } = await import('./headline')
    expect(occupationClashes('Scottish actor and film producer', 'Butler says investment return coming soon')).toBe(true)
    expect(occupationClashes('Scottish actor and film producer', 'Butler to star in new action film')).toBe(false)
    expect(occupationClashes('Barbadian netball player', 'Blackman wins gold at European Jiu-Jitsu Championships')).toBe(true)
    expect(occupationClashes('French footballer', 'Mbappe apologises after Real Madrid defeat in league match')).toBe(false)
    expect(occupationClashes('President of Eritrea', 'Isaias meets Chinese envoy')).toBe(false)
  })
  it('a qualified title needs its qualifier in the headline', async () => {
    const { unusedQualifier } = await import('./headline')
    expect(unusedQualifier('Long March (rocket family)', 'Foreign military attachés pay tribute to Long March martyrs')).toBe(true)
    expect(unusedQualifier('Long March (rocket family)', 'China launches Long March rocket with new satellite')).toBe(false)
    expect(unusedQualifier('Long March', 'anything')).toBe(false)
  })
})
