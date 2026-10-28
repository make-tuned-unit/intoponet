/**
 * Wikipedia's Portal:Current events as a map from today's news to the
 * ongoing stories it belongs to. Editors file each item under its thread:
 *
 *   '''Armed conflicts and attacks'''
 *   *[[Sudanese civil war (2023–present)|Sudanese civil war]]
 *   **The casualty toll from yesterday's drone strike at a market in [[Nyala, Sudan|Nyala]] …
 *
 * so matching a headline to an item gives its thread (and the thread's
 * parents), and every item filed under that thread is a dated step in the
 * story's recent past. See docs/research/olds-linking.md.
 */

export type CurrentEventItem = {
  /** The day page's date, YYYY-MM-DD. */
  date: string
  category: string
  /** The item in plain text. */
  text: string
  /** Articles the item links to, in order. */
  links: string[]
  /** Threads it is filed under, outermost first (nearest last). */
  threads: string[]
  /** The day page. */
  url: string
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "Portal:Current events/2026 October 27" for each of the `days` days ending on `end` (newest first). */
export function dayPages(end: Date, days: number): Array<{ title: string; date: string }> {
  const out: Array<{ title: string; date: string }> = []
  for (let i = 0; i < days; i += 1) {
    const day = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - i))
    const iso = day.toISOString().slice(0, 10)
    out.push({ title: `Portal:Current events/${day.getUTCFullYear()} ${MONTH_NAMES[day.getUTCMonth()]} ${day.getUTCDate()}`, date: iso })
  }
  return out
}

function linkTargets(text: string): string[] {
  return [...text.matchAll(/\[\[([^|\]#]+)(?:#[^|\]]*)?(?:\|[^\]]*)?\]\]/g)]
    .map((match) => match[1]!.trim())
    .filter((target) => target && !/^(File|Image|Category|wikt|w):/i.test(target))
    .map((target) => target.charAt(0).toUpperCase() + target.slice(1))
}

function plainText(text: string): string {
  return text
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+(?: [^\]]*)?\]/g, '')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Items from one day page's wikitext. */
export function parseDayPage(wikitext: string, date: string, title = ''): CurrentEventItem[] {
  const start = wikitext.indexOf('<!-- All news items below this line -->')
  const end = wikitext.indexOf('<!-- All news items above this line -->')
  const body = start >= 0 ? wikitext.slice(start, end > start ? end : undefined) : wikitext
  const url = `https://en.wikipedia.org/wiki/${encodeURIComponent((title || date).replace(/ /g, '_'))}`
  const items: CurrentEventItem[] = []
  const stack: string[][] = []
  let category = ''
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    const bold = line.match(/^'''([^']+)'''\s*$/) ?? line.match(/^;\s*(.+)$/)
    if (bold) {
      category = bold[1]!.trim()
      stack.length = 0
      continue
    }
    const bullet = line.match(/^(\*+)\s*(.*)$/)
    if (!bullet) continue
    const depth = bullet[1]!.length
    const content = bullet[2]!
    const links = linkTargets(content)
    // A thread line is only links ("[[A]], [[B]]"); anything else is a news item.
    const rest = content.replace(/\[\[[^\]]*\]\]/g, '').replace(/[,;&]|\band\b/g, '').trim()
    stack.length = Math.min(stack.length, depth - 1)
    if (!rest && links.length && !/\[https?:/.test(content)) {
      stack[depth - 1] = links
      continue
    }
    const text = plainText(content)
    if (text.length < 20) continue
    items.push({ date, category, text, links, threads: stack.slice(0, depth - 1).flat(), url })
  }
  return items
}

// Institution words are capitalised but name no one in particular.
const INSTITUTIONAL = new Set('president presid national natio assembly assem ministry minis minister secretary secre state government gover parliament parli parliamentary council counc court party union army police polic department depar office agency agenc commission commi committee bureau authority autho division divis senate house chamber federal republic republ democratic democ people peopl'.split(' '))

const STOP = new Set('but yet so the a an and or of in on at to for from by with as is are was were be been it its this that these those after before over into about says said say new will could would may might has have had not no up out more than how why what who when where amid against his her their our we they he she you i over under during while also just still into onto upon via per one two three four five six seven eight nine ten first last year years day days week weeks month months people killed dead report reports reported according least more most some many'.split(' '))

/** Content words of a text, as stems ("evacuates" ~ "evacuate", "votes" ~ "vote"), with names marked 2. */
/** One-word country names, which are names wherever they stand in a headline. */
const COUNTRY_NAMES = new Set(COUNTRY_ROWS.map((row) => row[1]).filter((name) => !name.includes(' ')))

export function terms(text: string): Map<string, number> {
  const out = new Map<string, number>()
  const words = text.replace(/[’']s\b/g, '').split(/[^\p{L}\d]+/u).filter(Boolean)
  // In a title-case headline every word is capitalised, so capitals say nothing about names.
  const titleCase = isTitleCase(text)
  words.forEach((word, index) => {
    const lower = word.toLowerCase()
    if (lower.length < 3 || STOP.has(lower) || /^\d+$/.test(lower)) return
    const stem = stemOf(lower)
    // The first word is capitalised anyway, so it says nothing, unless it is a country ("Norway, Finland's leaders…").
    const capitalised = /^\p{Lu}/u.test(word) && (index > 0 || COUNTRY_NAMES.has(word))
    const weight = !titleCase && capitalised && !INSTITUTIONAL.has(lower) && !INSTITUTIONAL.has(stem) ? 2 : 1
    out.set(stem, Math.max(out.get(stem) ?? 0, weight))
  })
  return out
}

function stemOf(word: string): string {
  const singular = word.length <= 3 ? word : word.replace(/ies$/, 'y').replace(/(?<=ch|sh|ss|x|z)es$/, '').replace(/(?<=[^s])s$/, '')
  return singular.slice(0, 5)
}

export type CurrentEventMatch = { item: CurrentEventItem; score: number; matched: string[] }

/**
 * The items that tell the same story as a headline: most of the headline's
 * weighted words appear in the item (or the titles it links to), including a
 * name (capitalised in the item's own sentence-case text) or three words in
 * all. Newer items win ties.
 */
export { isTitleCase } from './headline'
import { isTitleCase } from './headline'
import { COUNTRY_ROWS } from '../../shared/places/placeData'

/** `minNames`: names that must match (untranslated headlines are matched on names alone). */
/**
 * Thresholds for matching by meaning (Laya, all-MiniLM-L6-v2 cosine). Calibrated
 * on the Olds sample sets (docs/research/olds-linking.md): the same story told
 * two ways scores ~0.55–0.8; different stories sharing a place or institution
 * words ~0.15–0.4.
 */
export const CE_MEANING = { veto: 0.35, withWords: 0.5, alone: 0.62 } as const

/**
 * The items worth comparing by meaning: those sharing the most words with the
 * headline (Laya is ~0.1 s per text, so it reads a shortlist, not 800 items).
 */
export function shortlist(items: CurrentEventItem[], headline: string, size = 24): number[] {
  const wanted = terms(headline)
  return items
    .map((item, index) => {
      const have = terms(`${item.text} ${item.links.join(' ')} ${item.threads.join(' ')}`)
      return { index, weight: [...wanted.entries()].reduce((sum, [stem, weight]) => sum + (have.has(stem) ? weight : 0), 0) }
    })
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, size)
    .map((entry) => entry.index)
}

export function matchHeadline(items: CurrentEventItem[], headline: string, today: string, minNames = 0, country: string | null = null, meaning?: number[] | null): CurrentEventMatch[] {
  const wanted = terms(headline)
  // A word is a name if the headline writes it as one; in a title-case headline, if the item does.
  const titleCase = isTitleCase(headline)
  const total = [...wanted.values()].reduce((sum, weight) => sum + weight, 0)
  if (wanted.size < 2) return []
  const todayMs = Date.parse(today)
  const out: CurrentEventMatch[] = []
  items.forEach((item, index) => {
    const have = terms(`${item.text} ${item.links.join(' ')}`)
    for (const thread of item.threads) for (const [stem] of terms(thread)) if (!have.has(stem)) have.set(stem, 1)
    const matched = [...wanted.keys()].filter((stem) => have.has(stem))
    const weightOf = (stem: string): number => (titleCase ? Math.max(wanted.get(stem)!, have.get(stem) ?? 1) : wanted.get(stem)!)
    const weight = matched.reduce((sum, stem) => sum + weightOf(stem), 0)
    const names = matched.filter((stem) => weightOf(stem) === 2).length
    const coverage = Math.min(1, weight / (total + names))
    // An item that never mentions the story's country (a local paper's story) needs a much closer match.
    const mentionsCountry = !country || `${item.text} ${item.links.join(' ')} ${item.threads.join(' ')}`.toLowerCase().includes(country.toLowerCase().slice(0, Math.max(4, country.length - 2)))
    const byWords = matched.length >= 2 && (names >= 1 || matched.length >= 3) && names >= minNames && coverage >= 0.45 && (mentionsCountry || (coverage >= 0.7 && names >= 2))
    const ageDays = Math.max(0, (todayMs - Date.parse(item.date)) / 86_400_000)
    const cosine = meaning?.[index]
    if (cosine === undefined || cosine === null) {
      if (byWords) out.push({ item, score: coverage - ageDays * 0.004, matched })
      return
    }
    // With Laya: the same story in other words is found by meaning; a word match whose meaning is clearly different is not.
    // Medium meaning needs the headline's people and places too: "Norway, Finland talk with Putin" is not
    // the item about a US envoy meeting Putin (same name, cosine 0.6).
    const headlineNames = [...wanted.values()].filter((weight) => weight === 2).length
    const namesAgree = headlineNames === 0 || names >= Math.ceil(headlineNames / 2)
    const byMeaning = (cosine >= CE_MEANING.alone && matched.length >= 1 && namesAgree) || (cosine >= CE_MEANING.withWords && matched.length >= 2 && namesAgree && (mentionsCountry || names >= 1))
    if ((byWords && cosine >= CE_MEANING.veto) || byMeaning) out.push({ item, score: cosine + coverage * 0.5 - ageDays * 0.004, matched })
  })
  return out.sort((a, b) => b.score - a.score)
}

/** Items filed under a thread, oldest first: the story's recent steps. */
export function threadItems(items: CurrentEventItem[], thread: string): CurrentEventItem[] {
  const key = thread.toLowerCase()
  return items.filter((item) => item.threads.some((title) => title.toLowerCase() === key)).sort((a, b) => a.date.localeCompare(b.date))
}
