import { cleanHeadline, properPhrases } from './headline'

/**
 * "Topics behind this story": the subject areas a headline is about, as
 * Wikipedia topics in the story's country ("Incarceration in Canada", "Crime
 * in Canada"), rather than the place it happened. Two sources of queries:
 * families of common news subjects (justice, health, housing, …) triggered by
 * words in the headline, and the headline's own subject words.
 */

/** Subject families: trigger word stems → Wikipedia title patterns ({C} = country). */
export const TOPIC_FAMILIES: Array<{ triggers: RegExp; topics: string[] }> = [
  { triggers: /\b(prison|jail|inmate|correctional|penitentiar|incarcerat|parole|custody|detention|detainee|solitary)/i, topics: ['Incarceration in {C}', 'Prisons in {C}', 'Crime in {C}', 'Criminal justice system of {C}'] },
  { triggers: /\b(police|polic|officer|rcmp|arrest|shooting|homicide|murder|stabbing|assault|robbery|crime|criminal|gang)/i, topics: ['Crime in {C}', 'Law enforcement in {C}', 'Gun politics in {C}'] },
  { triggers: /\b(court|judge|trial|lawsuit|sentenc|charter|supreme court|verdict|appeal|lawyer|class action)/i, topics: ['Judiciary of {C}', 'Law of {C}', 'Criminal justice system of {C}'] },
  { triggers: /\b(hospital|health|patient|doctor|nurse|clinic|medic|emergency room|pharmac|disease|outbreak|vaccin)/i, topics: ['Health care in {C}', 'Healthcare in {C}', 'Public health in {C}'] },
  { triggers: /\b(overdose|opioid|fentanyl|drug|addiction|narcotic)/i, topics: ['Opioid epidemic in {C}', 'Drug policy of {C}', 'Opioid epidemic'] },
  { triggers: /\b(mental health|suicide|psychiatr)/i, topics: ['Mental health in {C}', 'Suicide in {C}'] },
  { triggers: /\b(school|student|teacher|universit|college|educat|tuition)/i, topics: ['Education in {C}'] },
  { triggers: /\b(housing|rent|tenant|landlord|homeless|mortgage|home prices)/i, topics: ['Housing in {C}', 'Homelessness in {C}', 'Affordable housing in {C}'] },
  { triggers: /\b(election|vote|voter|ballot|parliament|legislat|premier|prime minister|minister|mp |mla|senate|party)/i, topics: ['Politics of {C}', 'Elections in {C}', 'Government of {C}'] },
  { triggers: /\b(economy|econom|inflation|interest rate|recession|gdp|jobs|unemploy|wage|tariff|trade|budget|tax)/i, topics: ['Economy of {C}', 'Taxation in {C}', 'Unemployment in {C}'] },
  { triggers: /\b(xenophob|anti-immigra|foreigners)/i, topics: ['Xenophobia in {C}', 'Immigration to {C}'] },
  { triggers: /\b(immigra|refugee|migrant|asylum|deport|citizenship)/i, topics: ['Immigration to {C}', 'Refugees in {C}', 'Xenophobia in {C}'] },
  { triggers: /\b(bank|banking|card issu|payment|fintech|mastercard|mobile money|lender|lending|loan|credit|central bank|currency|stock exchange|investor)/i, topics: ['Banking in {C}', 'Economy of {C}', 'Financial services in {C}'] },
  { triggers: /\b(indigenous|first nation|aboriginal|métis|metis|inuit|native|reserve|treaty|residential school)/i, topics: ['Indigenous peoples in {C}', 'Indigenous rights', 'Canadian Indian residential school system'] },
  { triggers: /\b(wildfire|flood|hurricane|cyclone|typhoon|tornado|landslide|tsunami|monsoon|storm|drought|heat wave|earthquake|climate|emission|carbon)/i, topics: ['Climate change in {C}', 'Natural disasters in {C}', 'Environment of {C}'] },
  { triggers: /\b(oil|gas|pipeline|energy|electric|power plant|nuclear|hydro|mining|mine)/i, topics: ['Energy in {C}', 'Energy policy of {C}', 'Mining in {C}'] },
  { triggers: /\b(army|military|soldier|defence|defense|navy|air force|veteran|nato|troops)/i, topics: ['Military of {C}', 'Armed Forces of {C}', 'Foreign relations of {C}'] },
  { triggers: /\b(fish|fisher|lobster|farm|agricultur|crop|harvest)/i, topics: ['Fishing in {C}', 'Agriculture in {C}'] },
  { triggers: /\b(child|children|youth|foster|daycare|child care)/i, topics: ['Child welfare in {C}', 'Child care in {C}'] },
  { triggers: /\b(women|gender|domestic violence|intimate partner|femicide|sexual assault)/i, topics: ['Women in {C}', 'Domestic violence in {C}'] },
]

const NEWS_WORDS = new Set(('after before amid over under into from with about against says said say told report reports reported dies died dead death deaths day days week weeks month year years new news live update first last more most less than this that these those their they them there here what when where which while who whose will would could should may might also just still even only into onto upon via per its it’s it\'s been being have has had were was are is the and for but not you your our out off down then than very much many some any each every').split(' '))

/** Subject words and two-word phrases from a headline, leaving out places, names and newsy filler. */
export function subjectTerms(headline: string, exclude: string[] = []): string[] {
  const clean = cleanHeadline(headline)
  const names = new Set(properPhrases(clean).flatMap((phrase) => phrase.toLowerCase().split(/\s+/)))
  const skip = new Set(exclude.flatMap((item) => item.toLowerCase().split(/\s+/)))
  const words = clean.toLowerCase().replace(/[’']s\b/g, '').split(/[^\p{L}-]+/u).filter(Boolean)
  const keep = words.map((word) => (word.length >= 4 && !NEWS_WORDS.has(word) && !names.has(word) && !skip.has(word) ? word : null))
  const out: string[] = []
  for (let i = 0; i < keep.length; i += 1) {
    if (keep[i] && keep[i + 1]) out.push(`${keep[i]} ${keep[i + 1]}`)
  }
  for (const word of keep) if (word) out.push(word)
  return [...new Set(out)].slice(0, 6)
}

/** Leaders named in headlines → their country (as of late 2026), for "Norway–Russia relations" from "call with Putin". */
const LEADERS: Record<string, string> = {
  Putin: 'Russia', Xi: 'China', Trump: 'United States', Modi: 'India', Zelensky: 'Ukraine', Zelenskyy: 'Ukraine', Netanyahu: 'Israel',
  Erdogan: 'Turkey', Erdoğan: 'Turkey', Macron: 'France', Starmer: 'United Kingdom', Carney: 'Canada', Lula: 'Brazil', Merz: 'Germany',
  Meloni: 'Italy', Sheinbaum: 'Mexico', Milei: 'Argentina', Khamenei: 'Iran', Pezeshkian: 'Iran', Takaichi: 'Japan', Albanese: 'Australia',
  Ramaphosa: 'South Africa', Orbán: 'Hungary', Orban: 'Hungary', Lukashenko: 'Belarus', Maduro: 'Venezuela', Sisi: 'Egypt', Tinubu: 'Nigeria',
}

/** Other countries a headline brings in, by name or by their leader. */
export function otherCountries(headline: string, country: string | null, named: string[]): string[] {
  const leaders = Object.entries(LEADERS).filter(([name]) => new RegExp(`\\b${name}\\b`).test(headline)).map(([, place]) => place)
  return [...new Set([...named, ...leaders])].filter((name) => name !== country).slice(0, 3)
}

/** Title candidates to look up, most specific first. */
export function relatedQueries(headline: string, country: string | null, exclude: string[] = [], regions: string[] = [], others: string[] = []): { titles: string[]; searches: string[]; stems: string[] } {
  const titles: string[] = []
  // Province or state first (the story's own level), then the country.
  for (const scope of [...regions.slice(0, 1), country]) {
    for (const family of TOPIC_FAMILIES) {
      if (!family.triggers.test(headline)) continue
      for (const pattern of family.topics) {
        if (pattern.includes('{C}') && !scope) continue
        if (!pattern.includes('{C}') && scope !== country) continue
        titles.push(pattern.replace('{C}', scope ?? ''))
      }
    }
  }
  // Two countries in one story: their relations ("Norway–Russia relations"); Wikipedia orders the names alphabetically.
  if (country) for (const other of others) titles.push(`${[country, other].sort().join('–')} relations`)
  const terms = subjectTerms(headline, exclude)
  const searches = terms.slice(0, 3).map((term) => (country ? `${term} ${country}` : term))
  const stems = [...new Set(terms.flatMap((term) => term.split(' ')).map((word) => word.slice(0, 5)))]
  return { titles: [...new Set(titles)], searches, stems }
}
