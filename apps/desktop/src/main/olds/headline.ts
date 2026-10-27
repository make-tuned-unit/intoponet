/**
 * From a news headline to the topic it is about, and from that topic back
 * through history. Pure helpers; the network lives in OldsService.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 'as', 'is', 'are', 'was', 'were', 'be',
  'been', 'it', 'its', 'this', 'that', 'these', 'those', 'after', 'before', 'over', 'into', 'about', 'says', 'said', 'say', 'new', 'will',
  'could', 'would', 'may', 'might', 'has', 'have', 'had', 'not', 'no', 'up', 'out', 'more', 'than', 'how', 'why', 'what', 'who', 'when',
  'where', 'amid', 'against', 'his', 'her', 'their', 'our', 'we', 'they', 'he', 'she', 'you', 'i', 'look', 'watch', 'live', 'update', 'updates',
  // Function words of other languages, so untranslated headlines match on content words.
  ...'de del la las los el en y o un una unos unas por para con sin sobre entre que se su sus al lo como más tras ante desde hasta da do das dos na nas nos em um uma pelo pela le les des du au aux et ou une pour par avec sans sur dans qui sa ses ce cette est sont il gli della delle dei degli nel nella tra fra che der den dem des das und oder ein eine einer mit von zu im für auf dan di ke dari yang untuk dengan pada ini itu het een van voor met op els amb'.split(' '),
])

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bU\.?S\.?A?\b(?!\.\w)/g, 'United States'],
  [/\bU\.?K\.?\b/g, 'United Kingdom'],
  [/\bEU\b/g, 'European Union'],
  [/\bU\.?N\.?\b/g, 'United Nations'],
  [/\bNATO\b/g, 'NATO'],
]

/** Strip outlet suffixes ("… - Reuters"), quotes and markup noise; expand US/UK/EU/UN. */
export function cleanHeadline(text: string): string {
  let out = text
  for (const [pattern, full] of ABBREVIATIONS) out = out.replace(pattern, full)
  return out
    .replace(/\s+[-–—|]\s+[^-–—|]{2,40}$/, '') // "… - Reuters"
    .replace(/^[A-ZÀ-Ý ]{2,20}:\s+/, '') // "UPDATE: …", "TASS: …"
    // Column and section labels: "Reader Q&A:", "International News:", "Sport |", "iciHaïti -".
    .replace(/^((Reader )?Q&A|Opinion|Analysis|Explainer|Editorial|Live|Watch|Video|Podcast|Interview|Review|Comment|Exclusive|Breaking( News)?|Factbox|Fact check|In pictures|Photos|Letters?|Long read|((International|World|Local|National|Regional|Business|Sports?|Political|Entertainment|Health|Tech|Science|Breaking|Latest|Top) )?News|Politics|Business|Sports?|World|Entertainment|Lifestyle|Health|Technology|Tech|Science|Culture|Economy|Crime|Weather|Update)\s*[:|–—]\s+/i, '') // column labels
    .replace(/(\p{L})['’]s\b/gu, '$1') // "Germany's Merz" → "Germany Merz"
    .replace(/["“”«»‘’„]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Runs of capitalised words (names of places, people, organisations), skipping the first word's capital. */
export function properPhrases(text: string): string[] {
  const words = text.split(/\s+/)
  const phrases: string[] = []
  let current: string[] = []
  const flush = (): void => {
    if (current.length) phrases.push(current.join(' '))
    current = []
  }
  words.forEach((raw, index) => {
    const word = raw.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '')
    const capital = /^\p{Lu}/u.test(word) && word.length > 1
    const lowerJoin = current.length > 0 && ['of', 'the', 'de', 'del', 'la', 'and'].includes(word)
    // The first word, and the first after a colon ("Q&A: After Lula…"), is capitalised by grammar, not because it's a name.
    const opensSentence = index === 0 || /[:;]$/.test(words[index - 1] ?? '')
    if ((capital && !(opensSentence && STOPWORDS.has(word.toLowerCase()))) || lowerJoin) current.push(word)
    else flush()
    if (/[,.;:!?]$/.test(raw)) flush()
  })
  flush()
  return [...new Set(phrases.map((phrase) => phrase.replace(/\s+(of|the|de|del|la|and)$/i, '')).filter((phrase) => phrase.length > 2))]
}

/** Named events in a headline ("Cyclone Arnab", "Operation Southern Spear"); title-case headlines run on, so the one-word name comes first. */
export function namedEvents(headline: string): string[] {
  const clean = cleanHeadline(headline)
  return [...new Set([...clean.matchAll(/\b(Cyclone|Hurricane|Typhoon|Tropical Storm|Storm|Operation|Battle of|Siege of|Blockade of|Treaty of) ((?:\p{Lu}[\p{L}'-]+ ?){1,3})/gu)]
    .flatMap((match) => [`${match[1]} ${match[2]!.trim().split(' ')[0]}`, `${match[1]} ${match[2]!.trim()}`]))]
}

/** Search queries to try, most specific first. */
export function searchQueries(headline: string, year?: number): string[] {
  const clean = cleanHeadline(headline)
  const content = clean.split(/\s+/).filter((word) => !STOPWORDS.has(word.toLowerCase().replace(/[^\p{L}\d]/gu, ''))).join(' ')
  const names = properPhrases(clean)
  // Scripts without capitals (Arabic, Chinese, …) give no names: search short windows of the headline instead.
  const words = content.split(/\s+/).filter(Boolean)
  const windows = names.length ? [] : [words.slice(0, 3), words.slice(3, 6), words.slice(-3)].map((window) => window.join(' '))
  // "2026 Ebola …": news is usually about this year's event, not the famous old one.
  const current = year && names.length ? [`${year} ${names.slice(0, 2).join(' ')}`] : []
  // Named events ("Cyclone Arnab", "Operation Southern Spear") are searched on their own first.
  const named = namedEvents(headline)
  // The last name is often the place the story happened ("… Begins in Ukrainian City of Oleshky").
  const queries = [...named, content, ...current, names.slice(0, 3).join(' '), ...names.slice(0, 2), ...(names.length > 2 ? names.slice(-1) : []), ...windows]
  return [...new Set(queries.map((query) => query.trim()).filter((query) => query.length >= 3))].slice(0, 7)
}

export type CandidateFacts = {
  rank: number
  eventLike: boolean
  inCountry: boolean
  isPerson: boolean
  isCountry: boolean
  isDisambiguation: boolean
  titleWordsInHeadline: number
  /** Names in the topic's title that the headline does not mention (e.g. "Rafah"). */
  foreignNames: number
  /** The topic is stated to be in other countries, not the headline's. */
  otherCountry: boolean
  /** Years since the topic happened (from a leading year in its title, or its start date); null when unknown. */
  ageYears?: number | null
}

/**
 * Prefer events and topics that happen in the headline's country and whose
 * title words appear in the headline; people and whole countries are weaker
 * starting points for a history.
 */
export function scoreCandidate(facts: CandidateFacts): number {
  if (facts.isDisambiguation) return -Infinity
  return (8 - Math.min(8, facts.rank)) * 0.5
    + (facts.eventLike ? 3 : 0)
    + (facts.inCountry ? 2 : 0)
    + facts.titleWordsInHeadline * 1.5
    - (facts.isPerson ? 2 : 0)
    - (facts.isCountry ? 3 : 0)
    - facts.foreignNames * 1.5
    - (facts.otherCountry ? 2 : 0)
    // A headline is news: this year's outbreak, not the one from 1976.
    + (facts.ageYears == null ? 0 : facts.ageYears <= 1 ? 2 : facts.ageYears > 5 ? -2 : 0)
}

/** Kinds of event in a title → words in a headline that point to one ("Lula's win" → an election). */
const EVENT_HINTS: Array<[RegExp, RegExp]> = [
  [/\b(election|elections|referendum|primary|primaries)\b/i, /\b(win|wins|won|victory|victorious|vote|votes|voters|voting|poll|polls|ballot|elected|re-?elect\w*|campaign\w*|candidate\w*|runoff|landslide|defeat\w*)\b/i],
  [/\b(war|offensive|counteroffensive|incursion|invasion|conflict|insurgency|battle|clashes)\b/i, /\b(attack\w*|troops|soldiers|fighting|fight|war|offensive|army|forces|shelling|strikes?|rebels?|militants?|front ?line|ceasefire|killed)\b/i],
  [/\b(crisis|collapse|scandal)\b/i, /\b(crisis|collapse\w*|resign\w*|turmoil|scandal|no-confidence|coalition|snap)\b/i],
  [/\b(protests?|riots?|unrest|uprising|strikes?)\b/i, /\b(protest\w*|riot\w*|unrest|march\w*|demonstrat\w*|clashes|strike\w*|walkout)\b/i],
  [/\b(epidemic|outbreak|pandemic)\b/i, /\b(cases|outbreak|epidemic|virus|infections?|deaths|vaccin\w*|disease)\b/i],
  [/\b(earthquake|flood\w*|cyclone|hurricane|typhoon|wildfires?|season)\b/i, /\b(quake|earthquake|flood\w*|storm|cyclone|hurricane|typhoon|wildfire|fire|evacuat\w*|landfall)\b/i],
]

/** Whether a headline's words point to the kind of event a title names. */
export function eventKindMatches(title: string, headline: string): boolean {
  return EVENT_HINTS.some(([kind, hint]) => kind.test(title) && hint.test(headline))
}

/** Years since a topic happened: a leading year in its title ("1976 Zaire …"), else its start date for events. */
export function topicAge(title: string, startIso: string | null | undefined, eventLike: boolean, currentYear: number, endIso?: string | null): number | null {
  const leading = Number(title.match(/^(\d{4})\b/)?.[1] ?? NaN)
  if (Number.isFinite(leading)) return currentYear - leading
  const start = Number(startIso?.match(/^-?(\d{4})/)?.[1] ?? NaN)
  if (!eventLike || !Number.isFinite(start)) return null
  const end = Number(endIso?.match(/^-?(\d{4})/)?.[1] ?? NaN)
  if (Number.isFinite(end)) return currentYear - end
  // Begun in the last few years with no end: still going ("Blockade of Oleshky", since 2022).
  return currentYear - start <= 5 ? 0 : currentYear - start
}

/** Capitalised words in a title that never appear in the headline. */
export function foreignNamesIn(title: string, headline: string): number {
  const said = cleanHeadline(headline).toLowerCase()
  return title.replace(/\(.*?\)/g, '').split(/[\s–—\-/]+/)
    .map((word) => word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''))
    .filter((word) => /^\p{Lu}/u.test(word) && word.length > 2 && !STOPWORDS.has(word.toLowerCase()))
    .filter((word) => !said.includes(word.toLowerCase().slice(0, Math.max(4, Math.min(word.length - 2, 6)))))
    .length
}

/** Title words the headline also uses, matching stems ("Brazilian" ~ "Brazil"). */
/** Combining forms in compound names ("Russo-Ukrainian war", "Sino-Indian") → the country word they stand for. */
const COMBINING_FORMS: Record<string, string> = { russo: 'russia', sino: 'china', franco: 'france', anglo: 'england', indo: 'india', greco: 'greece', austro: 'austria', turco: 'turkey', italo: 'italy', polono: 'poland', hispano: 'spain', luso: 'portugal', nippo: 'japan' }

/** Month names date a story; they are not its subject ("September 30 attack" ≠ "September 11 attacks"). */
const MONTH_WORDS = new Set(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'])

export function titleWordsIn(title: string, headline: string): number {
  const stem = (raw: string): string => {
    const word = COMBINING_FORMS[raw] ?? raw
    return word.slice(0, Math.max(4, Math.min(word.length, 6)))
  }
  const words = [...new Set(cleanHeadline(headline).toLowerCase().split(/[^\p{L}\d]+/u).filter((word) => word.length > 2 && !STOPWORDS.has(word)).map(stem))]
  // Same stem, or one a 5+ letter prefix of the other ("India" ~ "Indian").
  const matches = (a: string): boolean => words.some((b) => a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a))))
  return title.toLowerCase().replace(/\(.*?\)/g, '').split(/[^\p{L}\d]+/u).filter((word) => word.length > 2 && !STOPWORDS.has(word) && !MONTH_WORDS.has(word) && matches(stem(word))).length
}

/** Content words of a title (parenthetical qualifiers dropped). */
export function titleContentWords(title: string): string[] {
  return title.toLowerCase().replace(/\(.*?\)/g, '').split(/[^\p{L}\d]+/u).filter((word) => word.length > 2 && !STOPWORDS.has(word))
}

/**
 * Whether a search result is plausibly what the headline is about: it must
 * share at least a third of its title words with the headline (at least one),
 * and not carry more unexplained names than shared words. Search engines
 * always return something; this keeps "2012 Delhi gang rape and murder" away
 * from a Honduran story about hospitals.
 */
/** Capitalised words in titles that name a kind of event, not a person or place ("Trial of …", "… Crisis"). */
const GENERIC_TITLE_WORDS = new Set('trial trials case cases affair scandal crisis war wars election elections referendum protests protest riots massacre attack attacks bombing assassination murder killing shooting investigation inquiry impeachment indictment summit treaty agreement accord deal ceasefire truce conflict invasion occupation siege battle campaign movement revolution coup independence partition reform reforms act law policy controversy dispute strike disaster earthquake flood hurricane cyclone pandemic outbreak epidemic government cabinet premiership presidency administration ministry party history timeline blockade offensive counteroffensive negotiations talks sanctions embargo standoff raid uprising crackdown evacuation ceasefire peace'.split(' '))

/** Unexplained names in a title, ignoring generic event words and a first name beside a matched surname. */
function unexplainedNames(title: string, said: string): number {
  const lower = cleanHeadline(said).toLowerCase()
  const words = title.replace(/\(.*?\)/g, '').split(/[\s–—\-/]+/).map((word) => word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''))
  const matched = (word: string): boolean => lower.includes(word.toLowerCase().slice(0, Math.max(4, Math.min(word.length - 2, 6))))
  let count = 0
  words.forEach((word, index) => {
    if (!/^\p{Lu}/u.test(word) || word.length <= 2 || STOPWORDS.has(word.toLowerCase()) || GENERIC_TITLE_WORDS.has(word.toLowerCase()) || matched(word)) return
    const next = words[index + 1]
    if (next && /^\p{Lu}/u.test(next) && matched(next)) return // "Benjamin" before a matched "Netanyahu"
    count += 1
  })
  return count
}

export function isRelevantCandidate(title: string, headline: string, countryName?: string, currentYear?: number): boolean {
  const said = countryName ? `${headline} ${countryName}` : headline
  const total = titleContentWords(title).length
  // News is about now: this year's event ("2026 Brazilian general election") shares the headline's time.
  const leading = Number(title.match(/^(\d{4})\b/)?.[1] ?? NaN)
  const words = titleWordsIn(title, said)
  // The year only helps the share of words; it never turns one shared word into two ("2026 Presidents Cup").
  const shared = words + (currentYear && leading >= currentYear - 1 && leading <= currentYear + 1 && words > 0 ? 1 : 0)
  if (words < 1 || shared < Math.ceil(total / 3)) return false
  if (unexplainedNames(title, said) > shared) return false
  if (words > 1) return true
  // One shared word is only enough when it is a name (capitalised after the headline's first word, or the country)
  // and the title adds no other names ("Education in Honduras" is not a story about a drug seizure in Honduras).
  if (unexplainedNames(title, said) > 0) return false
  const names = cleanHeadline(headline).split(/\s+/).slice(1)
    .map((word) => word.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, ''))
    .filter((word) => /^\p{Lu}/u.test(word))
  return titleWordsIn(title, [...names, countryName ?? ''].join(' ')) >= 1
}

/** Classes that are calendar units or whole states: never a topic or a step on a path. */
export const NOT_A_TOPIC = new Set([
  'Q39911', // decade
  'Q578', // century
  'Q36507', // millennium
  'Q577', // year
  'Q3186692', // calendar year
  'Q14795564', // point in time with respect to recurrent timeframe
  'Q12138', // Gregorian calendar
  'Q6256', // country
  'Q3624078', // sovereign state
  'Q11032', // newspaper
  'Q1002697', // periodical
  'Q41298', // magazine
  'Q1110794', // daily newspaper
  'Q783794', // company
  'Q4830453', // business
  'Q891723', // public company
  'Q270791', // state-owned enterprise
  'Q18340514', // events in a specific year ("2026 in Ukraine"): a list, not a topic
  'Q28640', // occupation ("Soldier")
  'Q15617994', // type of administrative division ("U.S. state")
  'Q13406463', // Wikimedia list article ("List of states and territories …")
  'Q4167410', // disambiguation page
  'Q101352', // family name ("Putin (surname)")
  'Q202444', // given name
  'Q12308941', // male given name
  'Q11879590', // female given name
  'Q12737077', // occupation
])

/**
 * Whether an article's text names another topic: the exact title, the title
 * without a trailing "in/of <place>", or all of its longer words together in
 * one sentence.
 */
export function mentions(articleText: string, title: string, rootLabel?: string): boolean {
  if (!articleText || !title) return false
  const text = articleText.toLowerCase()
  const base = title.toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').trim()
  if (base.length >= 4 && text.includes(base)) return true
  const root = rootLabel ? escapeRegExp(rootLabel.toLowerCase()) : null
  // "Norse settlements in Greenland" / "Greenland in World War II": drop the root place from either end.
  const trimmed = root ? base.replace(new RegExp(`\\s+(in|of|on)\\s+${root}$`), '').replace(new RegExp(`^${root}\\s+(in|during|and)\\s+`), '') : base
  if (trimmed !== base && trimmed.length >= 4 && text.includes(trimmed)) return true
  // "Norse settlements in Greenland" → "norse" + "settlement" in one sentence.
  const words = trimmed.split(/[^\p{L}\d]+/u).filter((word) => word.length >= 4 && !STOPWORDS.has(word)).map((word) => word.replace(/(ies|es|s)$/, ''))
  if (words.length < 2) return false
  return text.split(/(?<=[.!?])\s+/).some((sentence) => words.every((word) => sentence.includes(word)))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Which link to follow back from a topic, best first. */
export const PATH_PROPERTIES = [
  { property: 'P828', relation: 'was caused by' },
  { property: 'P1478', relation: 'was caused by' },
  { property: 'P361', relation: 'is part of' },
  { property: 'P155', relation: 'came after' },
  { property: 'P1365', relation: 'replaced' },
] as const
