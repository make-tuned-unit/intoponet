import type { OldsChronicleEntry } from '@intoponet/browser-api'
import { splitSections } from './historyArticle'

const words = (value: string): string[] => value.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().split(/[^\p{L}]+/u).filter((word) => word.length >= 4).map((word) => word.slice(0, 5))
const generic = new Set(['histo', 'gener', 'natio', 'inter', 'legis', 'curre', 'state', 'count', 'world', 'list'])

/** Follow only explicit editorial Main/Further/See also pointers that share the
 * topic's subject, not arbitrary links to countries, people or earlier news. */
export function historicalArticles(title: string, wikitext: string, country?: string | null): string[] {
  const countryWords = new Set(words(country ?? ''))
  const subject = new Set(words(title).filter((word) => !generic.has(word) && !countryWords.has(word)))
  const sections = [{ title: 'Introduction', body: wikitext.split(/\n==[^=]/)[0] ?? '' }, ...splitSections(wikitext)]
  const candidates: Array<{ title: string; priority: number }> = []
  for (const section of sections) {
    if (/references|external links|bibliography|notes/i.test(section.title)) continue
    const body = section.body.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '')
    for (const match of body.matchAll(/\{\{\s*(main|further|see also)\s*\|([^{}]+)\}\}/gi)) {
      for (const raw of match[2]!.split('|')) {
        const target = raw.split('#')[0]!.trim()
        if (!target || /[=:\[\]<>]/.test(target) || target === title || /^\d{4}\b/.test(target)) continue
        if (!words(target).some((word) => subject.has(word))) continue
        candidates.push({ title: target, priority: (/background|history|origin|electoral system/i.test(section.title) ? 2 : 0) + (/main|further/i.test(match[1]!) ? 1 : 0) })
      }
    }
  }
  return [...new Set(candidates.sort((a, b) => b.priority - a.priority).map((candidate) => candidate.title))].slice(0, 3)
}

/** Exact links to earlier editions of the event series named by the root. */
export function linkedHistoricalSeriesEditions(title: string, wikitext: string, currentYear: number): string[] {
  const series = title.match(/^\d{4}\s+(.+)$/)?.[1]
  if (!series) return []
  return [...new Set([...wikitext.matchAll(/\[\[(\d{4}\s+[^|\]#]+)(?:[^\]]*)\]\]/g)].map((match) => match[1]!.trim()))]
    .filter((target) => target.slice(5).toLowerCase() === series.toLowerCase() && Number(target.slice(0, 4)) < currentYear)
    .sort()
}

/** For a dated recurring event, sample older editions across its span; exact
 * series identity is required, so a shared country or word never qualifies. */
export function historicalSeriesArticles(title: string, wikitext: string, currentYear: number): string[] {
  const entries = linkedHistoricalSeriesEditions(title, wikitext, currentYear)
    .filter((target) => Number(target.slice(0, 4)) < currentYear - 5)
  return entries.length <= 3 ? entries : [entries[0]!, entries[Math.round((entries.length - 1) / 2)]!, entries.at(-1)!]
}

/** Reserve room for older context across distinct periods, without replacing
 * the recent sequence or pretending the wider history caused today's story. */
export function olderContext(existing: OldsChronicleEntry[], candidates: OldsChronicleEntry[], currentYear: number): OldsChronicleEntry[] {
  const earliest = existing.length ? Math.min(...existing.map((entry) => Number(entry.at.iso.slice(0, 4)))) : currentYear
  const cutoff = Math.min(currentYear - 5, earliest)
  const seen = new Set(existing.map((entry) => entry.text.toLowerCase().replace(/\W+/g, ' ')))
  const decades = new Set<string>()
  const eligible = candidates.filter((entry) => Number(entry.at.iso.slice(0, 4)) < cutoff)
    .sort((a, b) => a.at.iso.localeCompare(b.at.iso))
    .filter((entry) => {
      const key = entry.text.toLowerCase().replace(/\W+/g, ' ')
      const decade = entry.at.iso.slice(0, 3)
      if (seen.has(key) || decades.has(decade)) return false
      seen.add(key); decades.add(decade)
      return true
    })
  // Spread the six available positions across the full period, including both ends.
  return eligible.length <= 6 ? eligible : Array.from({ length: 6 }, (_, i) => eligible[Math.round(i * (eligible.length - 1) / 5)]!)
}
