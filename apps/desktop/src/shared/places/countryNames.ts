import { COUNTRY_NAMES_BY_LANGUAGE } from './countryNameData'
import { COUNTRY_ALIASES, COUNTRY_ROWS } from './placeData'

/**
 * Countries as headlines name them, in the languages the news feeds are written in: "Rwanda", "Ruanda",
 * "Estados Unidos", "Pays-Bas", "Südafrika". A country is one name however many words it takes and whatever
 * the language, so each has one token (its English name, words joined by "-": "south-africa").
 *
 * English names and aliases (the place catalogue's) are read in every headline; another language's names
 * (Unicode CLDR, countryNameData.ts) only in headlines written in it: "Island" is Iceland in German and
 * an island in English.
 */

/** Read as a country only by people who already know which one is meant, or as often something else. */
const NOT_A_NAME = new Set(['America', 'England', 'Korea', 'Aussie', 'Aussies'])
/** Shorter than the catalogue's name, and what headlines say. */
const TOKEN: Record<string, string> = { CD: 'dr-congo', CG: 'congo-brazzaville', NL: 'netherlands', PS: 'palestine', VA: 'vatican' }
/** Feeds tagged Norwegian without saying which. */
const SAME_LANGUAGE: Record<string, string> = { no: 'nb', nn: 'nb' }

function fold(word: string): string {
  return word.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
}

/** A name's words as story tokens see them (accents and case folded). */
function wordsOf(name: string): string[] {
  return name.normalize('NFKC').split(/[^\p{L}\p{M}\d]+/u).filter(Boolean).map(fold)
}

type Phrase = { words: string[]; code: string; token: string }
type PhraseIndex = Map<string, Phrase[]>

let tokenOf: Map<string, string> | null = null
let codeOf: Map<string, string> | null = null
let english: PhraseIndex | null = null
const byLanguage = new Map<string, PhraseIndex | null>()

function tokens(): Map<string, string> {
  if (!tokenOf) {
    tokenOf = new Map()
    codeOf = new Map()
    for (const [code, name] of COUNTRY_ROWS) {
      const token = TOKEN[code] ?? wordsOf(name).join('-')
      tokenOf.set(code, token)
      codeOf.set(token, code)
    }
  }
  return tokenOf
}

function indexOf(names: Array<[string, string[]]>): PhraseIndex {
  const byFirst: PhraseIndex = new Map()
  const seen = new Set<string>()
  for (const [code, words] of names) {
    const token = tokens().get(code)
    const key = words.join(' ')
    // A few letters ("US", "UK") are too easily another word. The first country to claim a name keeps it.
    if (!token || [...words.join('')].length < 4 || seen.has(key)) continue
    seen.add(key)
    const list = byFirst.get(words[0]!)
    if (list) list.push({ words, code, token })
    else byFirst.set(words[0]!, [{ words, code, token }])
  }
  // Longest first, so "Guinea-Bissau" is not read as Guinea.
  for (const list of byFirst.values()) list.sort((a, b) => b.words.length - a.words.length)
  return byFirst
}

function englishIndex(): PhraseIndex {
  if (!english) {
    const names: Array<[string, string[]]> = COUNTRY_ROWS.map(([code, name]) => [code, wordsOf(name)])
    for (const [key, aliases] of Object.entries(COUNTRY_ALIASES)) {
      for (const alias of aliases) if (!NOT_A_NAME.has(alias)) names.push([key.replace(/^country:/, ''), wordsOf(alias)])
    }
    english = indexOf(names)
  }
  return english
}

function languageIndex(lang: string | null | undefined): PhraseIndex | null {
  const primary = lang?.split('-')[0]?.toLowerCase()
  if (!primary) return null
  const language = SAME_LANGUAGE[primary] ?? primary
  let index = byLanguage.get(language)
  if (index === undefined) {
    const rows = COUNTRY_NAMES_BY_LANGUAGE[language]
    index = rows
      ? indexOf(rows.split('|').flatMap((row): Array<[string, string[]]> => {
          const [code, names] = row.split('=') as [string, string]
          return names.split(';').map((name) => [code, name.split(' ')])
        }))
      : null
    byLanguage.set(language, index)
  }
  return index
}

export type CountryMention = { code: string; token: string; start: number; length: number }

/**
 * Countries named in a headline's words. `words` are the headline's words as written, `folded` the same
 * words with accents and case folded, `lang` the headline's language when known. A name counts only when
 * written with a capital: "Catar" is Qatar, "catar" is tasting wine.
 */
export function countryMentions(words: readonly string[], folded: readonly string[], lang?: string | null): CountryMention[] {
  const indexes = [languageIndex(lang), englishIndex()]
  const found: CountryMention[] = []
  for (let i = 0; i < folded.length; i += 1) {
    const initial = words[i]![0]!
    if (initial === initial.toLowerCase()) continue
    let match: Phrase | undefined
    for (const index of indexes) {
      const candidate = index?.get(folded[i]!)?.find((phrase) => phrase.words.every((word, offset) => folded[i + offset] === word))
      if (candidate && (!match || candidate.words.length > match.words.length)) match = candidate
    }
    if (!match) continue
    found.push({ code: match.code, token: match.token, start: i, length: match.words.length })
    i += match.words.length - 1
  }
  return found
}

/** Countries named in a headline, in its own language's names for them and in English. */
export function countriesIn(title: string, lang?: string | null): CountryMention[] {
  const words = title.normalize('NFKC').split(/[^\p{L}\p{M}\d]+/u).filter(Boolean)
  return countryMentions(words, words.map(fold), lang)
}

/** The country a story token names ("south-africa" → "ZA"), or null when it is not a country's token. */
export function countryOfToken(token: string): string | null {
  tokens()
  return codeOf!.get(token) ?? null
}
