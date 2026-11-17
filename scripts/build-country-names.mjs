#!/usr/bin/env node
/**
 * Builds apps/desktop/src/shared/places/countryNameData.ts: what each country is called in the
 * languages the news feeds are written in ("Ruanda", "Pologne", "Estados Unidos"), so headlines in
 * different languages that name the same country can be recognised as naming it.
 *
 * Source: Unicode CLDR region names, read through Intl.DisplayNames of the Node that runs this script.
 * The table is checked in because runtimes disagree (Electron's ICU and Node's give different names for
 * some territories), and the app and its tests must read the same one.
 *
 * Usage: node scripts/build-country-names.mjs
 */
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '..')
const { COUNTRY_ROWS, CITY_ROWS, REGION_ROWS } = await import(join(repo, 'apps/desktop/src/shared/places/placeData.ts'))
const feeds = [
  ...(await import(join(repo, 'apps/desktop/src/main/news/newsFeeds.json'), { with: { type: 'json' } })).default.feeds,
  ...(await import(join(repo, 'apps/desktop/src/main/news/internationalFeeds.json'), { with: { type: 'json' } })).default.feeds,
]

/** Languages written without spaces between words are never split into words, so their names cannot be matched. */
const UNSPACED = new Set(['ja', 'zh', 'th', 'lo', 'km', 'my'])
/** Georgian has capital letters that its headlines never use. */
const UNCASED = new Set(['ka'])
const MIN_FEEDS = 3
const counts = new Map()
for (const feed of feeds) {
  const language = (feed.languageTags[0] ?? '').split('-')[0].toLowerCase()
  if (language) counts.set(language, (counts.get(language) ?? 0) + 1)
}
const languages = [...counts.entries()]
  .filter(([language, count]) => count >= MIN_FEEDS && language !== 'en' && !UNSPACED.has(language) && !UNCASED.has(language) && Intl.DisplayNames.supportedLocalesOf([language]).length > 0)
  .map(([language]) => language)
  .sort()

/** Words as story tokens see them: accents and case folded. */
const words = (name) => name.normalize('NFKC').split(/[^\p{L}\p{M}\d]+/u).filter(Boolean).map((word) => word.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase())
const phraseOf = (name) => words(name).join(' ')

const english = new Set(COUNTRY_ROWS.map(([, name]) => phraseOf(name)))
/** Cities and regions of the catalogue: "Granada" (Grenada in Spanish) is far more often the city. */
const places = new Set([...CITY_ROWS.map((row) => phraseOf(row[1])), ...REGION_ROWS.map((row) => phraseOf(row[1]))])
/**
 * Names that are more often something else in a headline: a meeting ("La reunión"), a person (Mauricio, Maurice,
 * Kenia), a saint's many places, or either of two countries ("Congo").
 */
const NOT_A_COUNTRY = new Set(['reunion', 'la reunion', 'congo', 'kongo', 'mauricio', 'maurice', 'kenia', 'norfolk', 'santa lucia', 'santa elena', 'santa helena', 'san martin', 'saint martin', 'sint maarten'])
/** Said in headlines, missing from CLDR. */
const EXTRA = { es: [['US', 'eeuu'], ['NL', 'holanda'], ['CI', 'costa de marfil']], pt: [['NL', 'holanda']], ca: [['NL', 'holanda']] }
/** CLDR's default script for Serbian is Cyrillic; Serbian outlets write in both. */
const VARIANTS = { sr: ['sr', 'sr-Latn'] }

const rows = {}
let total = 0
let left = 0
for (const language of languages) {
  /** phrase → codes this language calls by it. */
  const owners = new Map()
  for (const locale of VARIANTS[language] ?? [language]) {
    for (const style of ['long', 'short']) {
      const names = new Intl.DisplayNames([locale], { type: 'region', style, fallback: 'none' })
      for (const [code] of COUNTRY_ROWS) {
        let name
        try { name = names.of(code) } catch { continue }
        // "Congo - Kinshasa", "RAE de Hong Kong (China)": descriptions, not what a headline says.
        if (!name || /[()–—,&/]| - /.test(name)) continue
        // Names are told from other words by their capital letter: scripts without one (Arabic, Hindi, Korean) are left out.
        const initial = name.trim()[0]
        if (!initial || initial.toLowerCase() === initial.toUpperCase()) continue
        const phrase = phraseOf(name)
        // A few letters ("Fas", "Çin", "A.S.") are too easily another word; long official names never make a headline.
        if (!phrase || phrase.split(' ').length > 4 || [...phrase.replace(/ /g, '')].length < 4) continue
        owners.set(phrase, (owners.get(phrase) ?? new Set()).add(code))
      }
    }
  }
  for (const [code, name] of EXTRA[language] ?? []) owners.set(name, new Set([code]))
  const byCode = new Map()
  for (const [phrase, codes] of owners) {
    // English names are known already; a name two countries share, a city's name or a person's names neither.
    if (english.has(phrase)) continue
    if (codes.size !== 1 || places.has(phrase) || NOT_A_COUNTRY.has(phrase)) { left += 1; continue }
    const [code] = codes
    byCode.set(code, [...(byCode.get(code) ?? []), phrase])
    total += 1
  }
  if (byCode.size) rows[language] = [...byCode.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, names]) => `${code}=${names.sort().join(';')}`).join('|')
}
const out = `// Generated by scripts/build-country-names.mjs on ${new Date().toISOString().slice(0, 10)}. Do not edit.
// Source: Unicode CLDR ${process.versions.cldr} region names (through Intl.DisplayNames, Node ${process.versions.node}, ICU ${process.versions.icu}).
// Licence: Unicode License v3, https://www.unicode.org/license.txt
// Languages: those of at least ${MIN_FEEDS} news feeds, written with spaces and capital letters.

/**
 * Per language, what its headlines call each country where that differs from the English name:
 * "ISO2=name;name|ISO2=name". Names have accents and case folded, their words joined by a space.
 */
export const COUNTRY_NAMES_BY_LANGUAGE: Record<string, string> = ${JSON.stringify(rows, null, 1)}
`
writeFileSync(join(repo, 'apps/desktop/src/shared/places/countryNameData.ts'), out)
console.log(`${Object.keys(rows).length} languages, ${total} names (${left} left out as shared, a city's or a person's), ${Math.round(out.length / 1024)} KB`)
