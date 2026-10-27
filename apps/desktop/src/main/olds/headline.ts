/**
 * From a news headline to the topic it is about, and from that topic back
 * through history. Pure helpers; the network lives in OldsService.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 'as', 'is', 'are', 'was', 'were', 'be',
  'been', 'it', 'its', 'this', 'that', 'these', 'those', 'after', 'before', 'over', 'into', 'about', 'says', 'said', 'say', 'new', 'will',
  'could', 'would', 'may', 'might', 'has', 'have', 'had', 'not', 'no', 'up', 'out', 'more', 'than', 'how', 'why', 'what', 'who', 'when',
  'where', 'amid', 'against', 'his', 'her', 'their', 'our', 'we', 'they', 'he', 'she', 'you', 'i', 'look', 'watch', 'live', 'update', 'updates',
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
    if ((capital && !(index === 0 && STOPWORDS.has(word.toLowerCase()))) || lowerJoin) current.push(word)
    else flush()
    if (/[,.;:!?]$/.test(raw)) flush()
  })
  flush()
  return [...new Set(phrases.map((phrase) => phrase.replace(/\s+(of|the|de|del|la|and)$/i, '')).filter((phrase) => phrase.length > 2))]
}

/** Search queries to try, most specific first. */
export function searchQueries(headline: string): string[] {
  const clean = cleanHeadline(headline)
  const content = clean.split(/\s+/).filter((word) => !STOPWORDS.has(word.toLowerCase().replace(/[^\p{L}\d]/gu, ''))).join(' ')
  const names = properPhrases(clean)
  // Scripts without capitals (Arabic, Chinese, …) give no names: search short windows of the headline instead.
  const words = content.split(/\s+/).filter(Boolean)
  const windows = names.length ? [] : [words.slice(0, 3), words.slice(3, 6), words.slice(-3)].map((window) => window.join(' '))
  const queries = [content, names.slice(0, 3).join(' '), ...names.slice(0, 2), ...windows]
  return [...new Set(queries.map((query) => query.trim()).filter((query) => query.length >= 3))].slice(0, 5)
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
}

/** Capitalised words in a title that never appear in the headline. */
export function foreignNamesIn(title: string, headline: string): number {
  const said = cleanHeadline(headline).toLowerCase()
  return title.replace(/\(.*?\)/g, '').split(/[\s–—\-/]+/)
    .map((word) => word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''))
    .filter((word) => /^\p{Lu}/u.test(word) && word.length > 2 && !STOPWORDS.has(word.toLowerCase()))
    .filter((word) => !said.includes(word.toLowerCase().slice(0, Math.max(4, word.length - 2))))
    .length
}

/** Title words the headline also uses, matching stems ("Brazilian" ~ "Brazil"). */
export function titleWordsIn(title: string, headline: string): number {
  const stem = (word: string): string => word.slice(0, Math.max(4, Math.min(word.length, 6)))
  const words = new Set(cleanHeadline(headline).toLowerCase().split(/[^\p{L}\d]+/u).filter((word) => word.length > 2 && !STOPWORDS.has(word)).map(stem))
  return title.toLowerCase().replace(/\(.*?\)/g, '').split(/[^\p{L}\d]+/u).filter((word) => word.length > 2 && !STOPWORDS.has(word) && words.has(stem(word))).length
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
