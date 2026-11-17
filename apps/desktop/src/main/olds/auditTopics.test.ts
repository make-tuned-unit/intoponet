import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isRelevantCandidate, titleWordsIn } from './headline'
import { headlineCountries, isWorkOrThing, OldsService } from './oldsService'
import { relatedQueries } from './relatedTopics'

// Wrong topics from the live audit of 16 November 2026 (44 headlines; 15 were confidently wrong).
// Each case is the real headline and the real Wikipedia title that was shown for it.
describe('topics the headline does not name (2026-11-16 audit)', () => {
  it('does not take a body of the country for one of its words', () => {
    // Shown: United States Secret Service, for a bank outage.
    expect(isRelevantCandidate('United States Secret Service', 'Technical failure affects services of major banks in the United States', 'United States', 2026)).toBe(false)
    // Shown: a 2022 court case, for a journalist's murder.
    expect(isRelevantCandidate('Journalists of La Nación v. Costa Rica', 'Journalist who denounced cases related to drug trafficking murdered in Costa Rica', 'Costa Rica', 2026)).toBe(false)
    // Still the topic when the headline has its name; the kind of body may go unsaid.
    expect(isRelevantCandidate('United States Secret Service', 'Secret Service agent shot outside the White House', 'United States', 2026)).toBe(true)
    expect(isRelevantCandidate('New Zealand Labour Party', 'Labour pledges free dental care if elected', 'New Zealand', 2026)).toBe(true)
    expect(isRelevantCandidate('Central Bank of Somalia', 'Somalia central bank governor resigns', 'Somalia', 2026)).toBe(true)
  })

  it('does not take one named thing for another of its kind', () => {
    // Shown: West Bank, for the World Bank and Somalia.
    expect(isRelevantCandidate('West Bank', 'World Bank weighs suspension of budget support to Somalia', 'Somalia', 2026)).toBe(false)
    expect(isRelevantCandidate('West Bank', 'Settlers torch homes in West Bank village', 'Israel', 2026)).toBe(true)
  })

  it('does not read a plural acronym as another acronym', () => {
    // Shown: SOS incident (Japan, 1989), for standing orders in Trinidad and Tobago.
    expect(titleWordsIn('SOS incident', 'Central business chambers divided on SOs for their regions')).toBe(0)
    expect(titleWordsIn('SOS incident', 'Hikers rescued after SOS message spotted')).toBe(1)
  })

  it('does not offer a band for a figure of speech', () => {
    // Shown: Above the Law (group), for "No one is above the law".
    expect(isWorkOrThing('American hip hop group')).toBe(true)
    expect(isWorkOrThing('ethnic group in Nigeria')).toBe(false)
    expect(isWorkOrThing('Japanese conglomerate group')).toBe(false)
  })

  it('does not move a story to the country that paid for something', () => {
    // Shown: Crime in Australia, for a prison in Solomon Islands.
    expect(headlineCountries('Australian-funded fence and landslip works handed over at Gizo prison')).toEqual([])
    expect(headlineCountries('Australian court jails man over Gizo fraud')).toEqual(['AU'])
  })

  it('does not take what a headline rules out as its subject', () => {
    // Shown: Energy in Singapore, for non-oil exports.
    const { titles } = relatedQueries('Singapore’s non-oil exports surge 79.8% in October, driven by pharmaceuticals and ship structures', 'Singapore')
    expect(titles).not.toContain('Energy in Singapore')
    expect(relatedQueries('Singapore oil exports surge in October', 'Singapore').titles).toContain('Energy in Singapore')
    // Shown behind the story: Judiciary of Italy and Law of Italy, for an appeal to Israel to let aid in.
    expect(relatedQueries('Italy joins UK, Australia, Canada in appeal to Israel to allow aid to get to Gaza', 'Italy').titles).not.toContain('Judiciary of Italy')
    expect(relatedQueries('Gérard Depardieu drops appeal against sexual assault conviction', 'France').titles).toContain('Judiciary of France')
  })
})

describe('through the service (2026-11-16 audit)', () => {
  const claim = (value: unknown) => [{ rank: 'normal', mainsnak: { snaktype: 'value', datavalue: { value } } }]
  const dirs: string[] = []
  afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })
  const item = (id: string, label: string, description: string, claims: Record<string, unknown>) => ({ id, labels: { en: { value: label } }, descriptions: { en: { value: description } }, sitelinks: { enwiki: { title: label } }, claims })
  const country = (id: string, label: string, code: string) => item(id, label, 'sovereign state', { P31: claim({ id: 'Q6256' }), P297: claim(code) })
  const COUNTRIES: Record<string, string> = { FR: 'Q142', CF: 'Q929', BF: 'Q965', NE: 'Q1032', CR: 'Q800', IR: 'Q794', RU: 'Q159', CD: 'Q974' }
  const everyCountry = {
    Q142: country('Q142', 'France', 'FR'), Q929: country('Q929', 'Central African Republic', 'CF'), Q965: country('Q965', 'Burkina Faso', 'BF'),
    Q1032: country('Q1032', 'Niger', 'NE'), Q800: country('Q800', 'Costa Rica', 'CR'), Q794: country('Q794', 'Iran', 'IR'), Q159: country('Q159', 'Russia', 'RU'), Q974: country('Q974', 'Democratic Republic of the Congo', 'CD'),
  }

  /** The topic The Olds settles on when the wiki's search returns `titles` (title → item) for the headline. */
  async function topic(query: { text: string; countryCode: string; lang?: string }, titles: Record<string, string>, items: Record<string, unknown>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'olds-audit-'))
    dirs.push(dir)
    const entities: Record<string, unknown> = { ...everyCountry, ...items }
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input))
      const params = url.searchParams
      let payload: unknown = {}
      if (params.get('action') === 'wbgetentities') payload = { entities: Object.fromEntries((params.get('ids') ?? '').split('|').filter((id) => id in entities).map((id) => [id, entities[id]])) }
      else if (params.get('list') === 'search' && url.hostname === 'www.wikidata.org') payload = { query: { search: [{ title: COUNTRIES[params.get('srsearch')?.match(/P297=([A-Z]{2})/)?.[1] ?? ''] ?? 'Q0' }] } }
      else if (params.get('list') === 'search') payload = { query: { search: Object.keys(titles).map((title) => ({ title })) } }
      else if (url.hostname === 'query.wikidata.org') payload = { results: { bindings: [] } }
      else if (params.get('prop')?.includes('pageprops')) payload = { query: { pages: (params.get('titles') ?? '').split('|').map((title) => ({ title, ...(title in titles ? { pageprops: { wikibase_item: titles[title] } } : { missing: true }) })) } }
      else if (params.get('action') === 'parse') payload = { parse: { wikitext: '' } }
      return new Response(JSON.stringify(payload))
    }
    const service = new OldsService({ cacheDir: dir, fetchImpl, now: () => Date.parse('2026-11-16T12:00:00Z') })
    const thread = await service.thread({ kind: 'headline', ...query })
    return thread.nodes.find((node) => node.id === thread.rootId)?.label ?? ''
  }

  // "UEFA backs France’s Diallo…" is Philippe Diallo, the federation president; Abdou Diallo, a footballer, was shown.
  const diallo = { text: 'UEFA backs France’s Diallo to stand against Infantino in FIFA election', countryCode: 'FR' }
  const person = (id: string, label: string, description: string) => item(id, label, description, { P31: claim({ id: 'Q5' }), P27: claim({ id: 'Q142' }) })
  const people = { Q100: person('Q100', 'Abdou Diallo', 'French-Senegalese footballer (born 1996)'), Q101: person('Q101', 'Philippe Diallo', 'French football executive') }

  it('a surname several of the people found share names none of them', async () => {
    expect(await topic(diallo, { 'Abdou Diallo': 'Q100', 'Philippe Diallo': 'Q101' }, people)).toBe('France')
  }, 30_000)

  it('…and still names the only person of that name found', async () => {
    expect(await topic(diallo, { 'Abdou Diallo': 'Q100' }, people)).toBe('Abdou Diallo')
  }, 30_000)

  it('…or the one of them the world knows', async () => {
    // From the labelled set: the president, though a relative of the same name is among the results.
    const wikis = Object.fromEntries(Array.from({ length: 70 }, (_, index) => [`x${index}wiki`, { title: 'Masoud Pezeshkian' }]))
    const pezeshkians = {
      Q500: { ...item('Q500', 'Masoud Pezeshkian', 'President of Iran since 2024', { P31: claim({ id: 'Q5' }), P27: claim({ id: 'Q794' }) }), sitelinks: { enwiki: { title: 'Masoud Pezeshkian' }, ...wikis } },
      Q501: item('Q501', 'Yousef Pezeshkian', 'Iranian physicist', { P31: claim({ id: 'Q5' }), P27: claim({ id: 'Q794' }) }),
    }
    expect(await topic({ text: 'Iran’s Pezeshkian tells Putin Middle East can solve problems without US', countryCode: 'IR' }, { 'Masoud Pezeshkian': 'Q500', 'Yousef Pezeshkian': 'Q501' }, pezeshkians)).toBe('Masoud Pezeshkian')
  }, 30_000)

  // Untranslated headlines are matched against titles in their own language's Wikipedia.
  const office = { Q200: item('Q200', 'Prime Minister of France', 'head of government of France', { P31: claim({ id: 'Q4164871' }), P17: claim({ id: 'Q142' }), P1001: claim({ id: 'Q142' }) }) }

  it('another country’s office is not the story because the headline uses the office’s words', async () => {
    // Shown: Prime Minister of France, for the death of a former prime minister of the Central African Republic.
    const tiangaye = { text: 'Flash info : c’est confirmé, l’ancien Premier ministre Nicolas Tiangaye, ancien bâtonnier de l’Ordre des avocats centrafricains, est décédé', countryCode: 'CF', lang: 'fr' }
    expect(await topic(tiangaye, { 'Premier ministre français': 'Q200' }, office)).toBe('Central African Republic')
    // The same article is the topic of a story in France that names it.
    expect(await topic({ text: 'Le Premier ministre français présente sa démission au président', countryCode: 'FR', lang: 'fr' }, { 'Premier ministre français': 'Q200' }, office)).toBe('Prime Minister of France')
  }, 30_000)

  it('a title qualified as something the headline never mentions is not the story', async () => {
    // Shown: Niger River ("Niger (fleuve)"), for the bishops' conference of Burkina Faso and Niger.
    const bishops = { text: "Conférence épiscopale Burkina-Niger : Révision des statuts, appel à la solidarité et engagement citoyen au cœur d'une assemblée plénière ordinaire", countryCode: 'BF', lang: 'fr' }
    const river = { Q300: item('Q300', 'Niger River', 'river in West Africa', { P31: claim({ id: 'Q4022' }), P17: [...claim({ id: 'Q1032' }), ...claim({ id: 'Q912' }), ...claim({ id: 'Q1033' })], P625: claim({ latitude: 5.3, longitude: 6.4 }) }) }
    expect(await topic(bishops, { 'Niger (fleuve)': 'Q300' }, river)).not.toBe('Niger River')
    expect(await topic({ text: 'Crue du fleuve Niger : des milliers de sinistrés à Niamey', countryCode: 'NE', lang: 'fr' }, { 'Niger (fleuve)': 'Q300' }, river)).toBe('Niger River')
  }, 30_000)

  it('a place qualified as a province is still that place', async () => {
    // From the labelled set: an early form of the rule above gave this up for the whole country.
    const province = { Q700: item('Q700', 'Kasaï Province', 'province of the Democratic Republic of the Congo', { P31: claim({ id: 'Q24746' }), P17: claim({ id: 'Q974' }), P625: claim({ latitude: -5.3, longitude: 21.4 }) }) }
    expect(await topic({ text: 'Fin des travaux de signalisation sur 605 kilomètres de la rivière Kasaï', countryCode: 'CD', lang: 'fr' }, { 'Kasaï (province)': 'Q700' }, province)).toBe('Kasaï Province')
  }, 30_000)

  it('a year in brackets does not make a title something else', async () => {
    // A bracketed year says when, not what.
    const attack = { Q600: item('Q600', '2026 Trappes and La Verrière shootings', 'attack in France', { P31: claim({ id: 'Q2223653' }), P17: claim({ id: 'Q142' }), P585: claim({ time: '+2026-10-20T00:00:00Z', precision: 11 }) }) }
    const headline = { text: "Kévin T., suspect de l'attentat de Trappes, un profil nourri d'idéologie raciste", countryCode: 'FR', lang: 'fr' }
    expect(await topic(headline, { 'Attentat de Trappes (2026)': 'Q600' }, attack)).toBe('2026 Trappes and La Verrière shootings')
  }, 30_000)

  it('sharing only the country’s name is not enough', async () => {
    // Shown (untranslated): President of Costa Rica, for the murder of a journalist in Costa Rica.
    const murder = { text: 'Asesinan a un periodista que denunciaba casos relacionados con el narcotráfico en Costa Rica', countryCode: 'CR', lang: 'es' }
    const president = { Q400: item('Q400', 'President of Costa Rica', 'head of state and head of government of Costa Rica', { P31: claim({ id: 'Q4164871' }), P17: claim({ id: 'Q800' }) }) }
    expect(await topic(murder, { 'Presidente de Costa Rica': 'Q400' }, president)).toBe('Costa Rica')
    expect(await topic({ text: 'El presidente de Costa Rica veta la reforma fiscal', countryCode: 'CR', lang: 'es' }, { 'Presidente de Costa Rica': 'Q400' }, president)).toBe('President of Costa Rica')
  }, 30_000)
})
