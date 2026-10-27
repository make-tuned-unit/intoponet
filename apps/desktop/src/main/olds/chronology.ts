import type { OldsChronicleEntry, OldsDate } from '@intoponet/browser-api'
import { splitSections, stripWikitext } from './historyArticle'

/**
 * "How we got here": dated events quoted from a topic's own Wikipedia
 * article, in time order. Only sentences that state an explicit date are
 * kept ("On 21 November 2019, …", "In January 2017, …"), each with the
 * section it comes from and the first article it links to. Nothing is
 * paraphrased or inferred; the reader can open every section.
 */

const SKIP = /^(see also|notes|references|bibliography|sources|further reading|external links|gallery|footnotes|citations|works cited|explanatory notes|in popular culture|filmography|discography|awards|honours|honors)$/i
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const MONTH = '(January|February|March|April|May|June|July|August|September|October|November|December)'
const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The date a sentence is about, when it states one plainly. */
export function sentenceDate(sentence: string, currentYear: number, impliedYear?: number): OldsDate | null {
  const ok = (year: number): boolean => year >= 1000 && year <= currentYear
  const pad = (n: number): string => String(n).padStart(2, '0')
  let m = sentence.match(new RegExp(`\\b(\\d{1,2}) ${MONTH},? (\\d{4})\\b`))
  if (m && ok(Number(m[3]))) {
    const month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1
    return { iso: `${m[3]}-${pad(month)}-${pad(Number(m[1]))}`, precision: 'day', label: `${Number(m[1])} ${SHORT_MONTH[month - 1]} ${m[3]}` }
  }
  m = sentence.match(new RegExp(`\\b${MONTH} (\\d{1,2}),? (\\d{4})\\b`))
  if (m && ok(Number(m[3]))) {
    const month = MONTHS.indexOf(m[1]!.toLowerCase()) + 1
    return { iso: `${m[3]}-${pad(month)}-${pad(Number(m[2]))}`, precision: 'day', label: `${Number(m[2])} ${SHORT_MONTH[month - 1]} ${m[3]}` }
  }
  m = sentence.match(new RegExp(`\\b(?:[Ii]n|[Bb]y|[Ss]ince|[Ii]n early|[Ii]n late|[Ii]n mid-|[Dd]uring) ?${MONTH} (\\d{4})\\b`))
    ?? sentence.match(new RegExp(`^${MONTH} (\\d{4})\\b`))
  if (m && ok(Number(m[2]))) {
    const month = MONTHS.indexOf(m[1]!.toLowerCase()) + 1
    return { iso: `${m[2]}-${pad(month)}`, precision: 'month', label: `${SHORT_MONTH[month - 1]} ${m[2]}` }
  }
  // "In 2016, …" / "By 1998 the …" at the start of a sentence: the sentence is about that year.
  m = sentence.match(/^(?:In|By|Since|During|From|After|Before|Until|On|Throughout|Between|Early in|Late in|In early|In late|In mid-)\s*(\d{4})\b/)
  if (m && ok(Number(m[1]))) return { iso: m[1]!, precision: 'year', label: m[1]! }
  // Articles about one year ("2026 … cyclone season") write "On 7 January, …" without it.
  if (impliedYear && ok(impliedYear)) {
    m = sentence.match(new RegExp(`^(?:On|By|Early on|Late on|Later on|Around|From)?\\s*(\\d{1,2}) ${MONTH}\\b(?!,? \\d{4})`)) ?? sentence.match(new RegExp(`(?:^|, )on (\\d{1,2}) ${MONTH}\\b(?!,? \\d{4})`))
    if (m) {
      const month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1
      return { iso: `${impliedYear}-${pad(month)}-${pad(Number(m[1]))}`, precision: 'day', label: `${Number(m[1])} ${SHORT_MONTH[month - 1]} ${impliedYear}` }
    }
    m = sentence.match(new RegExp(`^(?:On|By|Early on|Later on)?\\s*${MONTH} (\\d{1,2})\\b(?!,? \\d{4})`))
    if (m) {
      const month = MONTHS.indexOf(m[1]!.toLowerCase()) + 1
      return { iso: `${impliedYear}-${pad(month)}-${pad(Number(m[2]))}`, precision: 'day', label: `${Number(m[2])} ${SHORT_MONTH[month - 1]} ${impliedYear}` }
    }
  }
  return null
}

/**
 * Sentences that can't stand alone on a timeline: bibliography lines
 * ("Kodansha America. 1 February 1999. 606 pages."), text with a dropped link
 * ("The , the first newspaper"), and ones that lean on the sentence before
 * ("Since then, …", "The act also …").
 */
export function isDebris(text: string): boolean {
  if (/\b\d+ pages\b|\bISBN\b|\bRetrieved\b|\bUniversity Press\b|\bpp?\. \d/.test(text)) return true
  if (/\s[,.;:]|\(\s*\)|\b(The|A|An|the|a|an) [,.;]/.test(text)) return true
  return /^(Since then|Then|This|These|That|Those|It|Its|He|She|They|His|Her|Their|Both|The act also|The two|Subsequently)\b/.test(text)
}

/**
 * The year an article is about, for dates written without one: the year in its
 * title ("2026 … season"), else the year most of its full dates use (a storm or
 * event article), when that is clear.
 */
export function impliedYearOf(title: string, wikitext: string, currentYear: number): number | undefined {
  // Exactly one year in the title ("2026 … season"); a range ("1900–2000") says nothing about a single date.
  const titleYears = [...new Set([...title.matchAll(/\b(1\d{3}|20\d{2})\b/g)].map((match) => Number(match[1])))]
  if (titleYears.length === 1 && titleYears[0]! <= currentYear) return titleYears[0]
  const prose = wikitext.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '').replace(/\{\{[^{}]*\}\}/g, '')
  const years = [...prose.matchAll(new RegExp(`\\b\\d{1,2} ${MONTH},? (\\d{4})\\b|\\b${MONTH} \\d{1,2},? (\\d{4})\\b`, 'g'))].map((match) => Number(match[2] ?? match[4]))
  if (years.length < 3) return undefined
  const counts = new Map<number, number>()
  for (const year of years) counts.set(year, (counts.get(year) ?? 0) + 1)
  const [best, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!
  return count / years.length >= 0.6 && best <= currentYear ? best : undefined
}

/** Wikitext with references, templates and files removed, but [[links]] kept. */
function proseWithLinks(text: string): string {
  let out = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
  for (let i = 0; i < 6; i += 1) {
    const next = out.replace(/\{\{[^{}]*\}\}/g, '').replace(/\{\|[^{}]*?\|\}/g, '')
    if (next === out) break
    out = next
  }
  return out.replace(/\[\[(?:File|Image):[^\]]*(?:\[\[[^\]]*\]\][^\]]*)*\]\]/gi, '').replace(/^[*#:;].*$/gm, (line) => line.replace(/^[*#:;]+\s*/, ''))
}

function firstLink(sentence: string, exclude: string): string | null {
  for (const match of sentence.matchAll(/\[\[([^|\]#]+)(?:#[^|\]]*)?(?:\|[^\]]*)?\]\]/g)) {
    const target = match[1]!.trim()
    if (!target || /^\d{3,4}s?$/.test(target) || /^(January|February|March|April|May|June|July|August|September|October|November|December)( \d{1,2})?$/.test(target)) continue
    if (target.toLowerCase() === exclude.toLowerCase() || /:/.test(target)) continue
    return target.charAt(0).toUpperCase() + target.slice(1)
  }
  return null
}

/**
 * `focus`: subject word stems from a headline. For broad topics (a country or
 * region), only events that mention the story's subject are kept, so the
 * chronology is about the news rather than the whole history of the place.
 */
export function chronologyFromWikitext(title: string, wikitext: string, currentYear: number, lang = 'en', limit = 18, focus: string[] = [], yearHint?: number): OldsChronicleEntry[] {
  const lead = wikitext.split(/\n==[^=]/)[0] ?? ''
  const sections = [{ level: 1, title: 'Introduction', body: lead }, ...splitSections(wikitext)]
  const entries: Array<OldsChronicleEntry & { order: number }> = []
  const seen = new Set<string>()
  let order = 0
  const impliedYear = impliedYearOf(title, wikitext, currentYear) ?? yearHint
  for (const section of sections) {
    if (SKIP.test(section.title.trim())) continue
    const prose = proseWithLinks(section.body)
    for (const raw of prose.split(/(?<=[.!?])\s+(?=[A-Z[“"])/)) {
      order += 1
      // Drop link debris left at the start of a sentence ("…|start=2:11:11]] On 26 June …").
      const text = stripWikitext(raw).replace(/^[^[\]]*\]\]\s*/, '').replace(/\[\[|\]\]/g, '').trim()
      // Whole sentences only: a fragment ("in Brazil among …") means the split went wrong.
      if (text.length < 40 || text.length > 360 || !/^[\p{Lu}\d“"(]/u.test(text)) continue
      if (isDebris(text)) continue
      const at = sentenceDate(text, currentYear, impliedYear)
      if (!at) continue
      const key = text.toLowerCase().slice(0, 80)
      if (seen.has(key)) continue
      seen.add(key)
      const anchor = section.title === 'Introduction' ? '' : `#${encodeURIComponent(section.title.replace(/ /g, '_'))}`
      entries.push({
        at,
        text,
        section: section.title,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}${anchor}`,
        link: firstLink(raw, title),
        order,
      })
    }
  }
  const relevant = focus.length
    ? entries.filter((entry) => {
        const words = entry.text.toLowerCase().split(/[^\p{L}\d]+/u)
        return focus.filter((stem) => words.some((word) => word.startsWith(stem))).length >= Math.min(2, focus.length)
      })
    : entries
  const sorted = relevant.sort((a, b) => a.at.iso.localeCompare(b.at.iso) || a.order - b.order)
  // Spread across the whole span rather than crowding one busy year: at most 3 entries per year
  // (per month for an article about one year, like a storm season).
  const perYear = new Map<string, number>()
  const kept = sorted.filter((entry) => {
    const year = entry.at.iso.slice(0, impliedYear && entry.at.iso.startsWith(String(impliedYear)) ? 7 : 4)
    const count = perYear.get(year) ?? 0
    perYear.set(year, count + 1)
    return count < 3
  })
  // Keep the latest events (closest to the news) and the earliest background.
  const chosen = kept.length <= limit ? kept : [...kept.slice(0, Math.ceil(limit / 3)), ...kept.slice(-(limit - Math.ceil(limit / 3)))]
  return chosen.map(({ order: _order, ...entry }) => entry)
}
