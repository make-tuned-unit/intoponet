import { useEffect, useState } from 'react'
import { ChevronRight, History, Loader2, Newspaper } from 'lucide-react'
import { normalizeLanguage, type OldsChapter, type OldsChronicleEntry, type OldsCountryFacts, type OldsNode, type OldsThread } from '@intoponet/browser-api'
import type { NewsHeadline } from '../../../shared/news/newsDigest'
import { RELATED_MODEL } from '../translate/useTranslate'

const year = (iso: string | undefined): number | null => {
  const match = iso?.match(/^(-?\d{1,6})/)
  return match ? Number(match[1]) : null
}

/** The chapter a country is in now: the one that began most recently (later sections win ties). */
export function currentChapter(chapters: OldsChapter[], now = new Date().getFullYear()): OldsChapter | null {
  let best: { chapter: OldsChapter; start: number } | null = null
  for (const chapter of chapters) {
    const start = year(chapter.start?.iso)
    if (start === null || start > now) continue
    // Skip chapters whose own heading says they ended long ago ("President de Gaulle, 1958–1969").
    const end = chapter.title.match(/\d{3,4}\s*[–-]\s*(\d{3,4})\s*\)?\s*$/)?.[1]
    if (end && Number(end) < now - 25) continue
    if (!best || start >= best.start) best = { chapter, start }
  }
  return best?.chapter ?? null
}

/** Recent, dated events linked to the country, newest first (the threads worth following now). */
export function recentConnections(thread: OldsThread, now = new Date().getFullYear(), limit = 4): OldsNode[] {
  return thread.nodes
    .filter((node) => node.id !== thread.rootId)
    .map((node) => ({ node, at: year(node.start?.iso) }))
    .filter((item): item is { node: OldsNode; at: number } => item.at !== null && item.at >= now - 15 && item.at <= now)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((item) => item.node)
}

const COMMON = new Set([
  'the', 'a', 'an', 'in', 'on', 'of', 'to', 'for', 'and', 'with', 'at', 'by', 'from', 'after', 'as', 'is', 'are', 'was', 'will', 'says', 'said',
  'new', 'how', 'why', 'what', 'who', 'when', 'over', 'amid', 'live', 'video', 'watch', 'update', 'breaking', 'news', 'opinion', 'analysis',
  'president', 'minister', 'prime', 'government', 'police', 'court', 'state', 'city', 'national', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december', 'this', 'that', 'there', 'they', 'his', 'her', 'its', 'their', 'our', 'we', 'it', 'he', 'she',
  // Articles and small words in other Latin-script languages (untranslated headlines).
  'el', 'la', 'los', 'las', 'un', 'una', 'del', 'de', 'en', 'y', 'con', 'por', 'para', 'tras', 'según', 'le', 'les', 'du', 'des', 'et',
  'au', 'aux', 'une', 'der', 'die', 'das', 'und', 'ein', 'eine', 'im', 'o', 'os', 'as', 'do', 'da', 'dos', 'das', 'em', 'il', 'lo',
  'gli', 'di', 'della', 'nel', 'het', 'een', 'van',
])

/**
 * Names that keep coming up in a set of headlines: runs of capitalised words
 * and acronyms (NATO, EU), counted once per headline, the country's own name
 * left out. A shared name is a lead into history, not proof of one story.
 */
export function headlineNames(titles: string[], exclude: string[], limit = 5): Array<{ name: string; count: number }> {
  const skip = new Set(exclude.map((word) => word.toLowerCase()))
  const counts = new Map<string, { name: string; count: number }>()
  for (const title of titles) {
    const seen = new Set<string>()
    const words = title.replace(/[“”"«»‘’]/g, ' ').split(/\s+/)
    let run: string[] = []
    const flush = (): void => {
      const name = run.join(' ').replace(/['’]s$/, '')
      run = []
      const key = name.toLowerCase()
      if (name.length < 2 || COMMON.has(key) || skip.has(key) || [...skip].some((word) => key === `${word}n` || key === `${word}'s`) || seen.has(key)) return
      seen.add(key)
      const entry = counts.get(key) ?? { name, count: 0 }
      entry.count += 1
      counts.set(key, entry)
    }
    for (const raw of words) {
      const word = raw.replace(/^[^\p{L}\d]+|[^\p{L}\d'’]+$/gu, '')
      const capital = /^\p{Lu}/u.test(word) && !COMMON.has(word.toLowerCase())
      if (capital) run.push(word)
      else flush()
      if (/[,.;:!?]$/.test(raw)) flush()
    }
    flush()
  }
  return [...counts.values()].filter((entry) => entry.count >= 2).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, limit)
}

function compact(value: number): string {
  return new Intl.NumberFormat(navigator.language, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

/** Things that happened, not statistics: a sentence about an act or event scores higher. */
const EVENT = /\b(signed|began|begun|started|elected|won|opened|ratified|declared|announced|confirmed|launched|passed|adopted|became|joined|left|withdrew|invaded|attacked|struck|erupted|killed|died|resigned|appointed|sworn|protests?|referendum|election|agreement|treaty|crisis|war|independence|coup|outbreak|reform|law|ban|strike|disaster|earthquake|flood|hurricane|cyclone)\b/i
const STATISTIC = /(%|\bper cent\b|\bpercent\b|\bper capita\b|\branked\b|\bestimated\b|\bratio\b|\baverage\b|\bspending\b|\bGDP\b|\bstatistics\b)/i
const CULTURE = /\b(Eurovision|song contest|album|film|festival|championship|olympic|world cup|football|singer|artist)\b/i

/** The most newsworthy dated events of the last 25 years, newest first (at most one cultural item). */
export function pickRecentEvents(chronicle: OldsChronicleEntry[], thisYear: number, limit = 4): OldsChronicleEntry[] {
  const score = (entry: OldsChronicleEntry): number => (EVENT.test(entry.text) ? 2 : 0) - (STATISTIC.test(entry.text) ? 3 : 0) - (CULTURE.test(entry.text) ? 1 : 0)
  let culture = 0
  return chronicle
    .filter((entry) => (year(entry.at.iso) ?? 0) >= thisYear - 25 && score(entry) >= 0)
    .sort((a, b) => score(b) - score(a) || b.at.iso.localeCompare(a.at.iso))
    .filter((entry) => !CULTURE.test(entry.text) || culture++ < 1)
    .slice(0, limit)
    .sort((a, b) => b.at.iso.localeCompare(a.at.iso))
}

const memory = new Map<string, OldsThread>()

/**
 * Context for what you're reading: key facts, the names behind today's
 * headlines (each a way into its history), and recent connected events.
 * Facts and history come from Wikidata and Wikipedia via The Olds.
 */
export function BiggerPicture({
  countryCode,
  countryName,
  headlines,
  onOpenCountry,
  onOpenTopic,
  onOpenName,
}: {
  countryCode: string
  countryName: string
  headlines: NewsHeadline[]
  onOpenCountry: () => void
  onOpenTopic: (node: OldsNode) => void
  /** Open the history behind a name in this country's news (e.g. NATO, in Russia's context). */
  onOpenName: (name: string) => void
}) {
  const [thread, setThread] = useState<OldsThread | null>(memory.get(countryCode) ?? null)
  const [failed, setFailed] = useState(false)
  const [names, setNames] = useState<Array<{ name: string; count: number }>>([])

  useEffect(() => {
    if (memory.has(countryCode)) {
      setThread(memory.get(countryCode)!)
      return
    }
    let cancelled = false
    setThread(null)
    setFailed(false)
    window.intoponet.olds.thread({ kind: 'country', countryCode }).then((result) => {
      memory.set(countryCode, result)
      if (!cancelled) setThread(result)
    }, () => {
      if (!cancelled) setFailed(true)
    })
    return () => { cancelled = true }
  }, [countryCode])

  // Names in today's headlines; translated to English first when that language is installed on this Mac.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const titles = headlines.map((headline) => headline.title)
      const english = [...titles]
      try {
        const status = await window.intoponet.translate.status()
        const ready = new Set(['en', ...status.languages.filter((language) => language.downloaded).map((language) => language.code)])
        const byLang = new Map<string, number[]>()
        headlines.forEach((headline, index) => {
          const own = normalizeLanguage(headline.lang)
          // Languages without a model (Faroese) go through their closest relative (Icelandic), roughly.
          const code = own && !ready.has(own) && RELATED_MODEL[own] ? RELATED_MODEL[own] : own
          if (code && code !== 'en' && ready.has(code)) byLang.set(code, [...(byLang.get(code) ?? []), index])
        })
        for (const [code, indices] of byLang) {
          const out = await window.intoponet.translate.translate({ from: code, to: 'en', texts: indices.map((index) => titles[index]!) })
          indices.forEach((index, i) => { english[index] = out[i] ?? titles[index]! })
        }
      } catch {
        // Untranslated names still work for Latin-script headlines.
      }
      if (!cancelled) setNames(headlineNames(english, [countryName, ...countryName.split(' ')]))
    })()
    return () => { cancelled = true }
  }, [headlines, countryName])

  // Many countries have few recent Wikidata events: fall back to the dated events their latest chapters link to.
  const [chapterRecent, setChapterRecent] = useState<OldsNode[]>([])
  useEffect(() => {
    setChapterRecent([])
    if (!thread || recentConnections(thread).length >= 2 || !thread.chapters?.length || !thread.chaptersSource) return
    let cancelled = false
    const chapters = thread.chapters
    const source = thread.chaptersSource.title
    const start = currentChapter(chapters)
    const from = start ? chapters.indexOf(start) : chapters.length - 1
    void (async () => {
      const found = new Map<string, OldsNode>()
      for (let index = from, tried = 0; index >= 0 && tried < 3 && found.size < 4; index -= 1, tried += 1) {
        const chapter = chapters[index]!
        try {
          const result = await window.intoponet.olds.thread({ kind: 'chapter', article: source, section: chapter.title })
          for (const node of result.nodes) if (node.id !== result.rootId && node.start) found.set(node.id, node)
        } catch {
          // Try the chapter before.
        }
      }
      if (!cancelled) setChapterRecent([...found.values()].sort((a, b) => (year(b.start?.iso) ?? 0) - (year(a.start?.iso) ?? 0)).slice(0, 4))
    })()
    return () => { cancelled = true }
  }, [thread])

  const facts: OldsCountryFacts | undefined = thread?.facts
  const recent = thread ? recentConnections(thread) : []
  const connections = recent.length >= 2 ? recent : [...recent, ...chapterRecent.filter((node) => !recent.some((item) => item.id === node.id))].slice(0, 4)
  // Recent events quoted from the country's own article (newest first), when there are any.
  const thisYear = new Date().getFullYear()
  const recentChronicle = pickRecentEvents(thread?.chronicle ?? [], thisYear)
  const newestConnection = connections.reduce((max, node) => Math.max(max, year(node.start?.iso) ?? 0), 0)
  const leaders = facts ? [facts.headOfState, facts.headOfGovernment].filter((name, index, all): name is string => !!name && all.indexOf(name) === index) : []

  return (
    <section className="globe-context" aria-label={`Context: ${countryName}`}>
      <div className="globe-context-top">
        <span className="globe-context-eyebrow"><History size={12} aria-hidden="true" /> The bigger picture</span>
        <button type="button" className="globe-context-open" onClick={onOpenCountry} title={`The Olds: the sourced history of ${countryName}`}>
          Its history <ChevronRight size={13} aria-hidden="true" />
        </button>
      </div>
      {!thread && !failed && <p className="globe-context-status"><Loader2 size={12} className="olds-spin" aria-hidden="true" /> Looking up the bigger picture…</p>}
      {failed && <p className="globe-context-status">Context is unavailable right now (it needs Wikidata and Wikipedia).</p>}
      {facts && (
        <dl className="globe-context-facts" title="From Wikidata (latest values)">
          {facts.population && <div><dt>Population</dt><dd>{compact(facts.population.value)}{facts.population.year ? <small> ({facts.population.year})</small> : null}</dd></div>}
          {facts.capital && <div><dt>Capital</dt><dd>{facts.capital}</dd></div>}
          {leaders.length > 0 && <div><dt>{leaders.length > 1 ? 'Leaders' : 'Leader'}</dt><dd>{leaders.join(' · ')}</dd></div>}
          {facts.gdpUsd && <div><dt>Economy</dt><dd>${compact(facts.gdpUsd.value)} GDP{facts.gdpUsd.year ? <small> ({facts.gdpUsd.year})</small> : null}</dd></div>}
          {facts.languages.length > 0 && <div><dt>Language</dt><dd>{facts.languages.slice(0, 2).map((name) => name.replace(/ language$/, '')).join(', ')}</dd></div>}
        </dl>
      )}
      {names.length > 0 && (
        <div className="globe-context-links" aria-label="Names in today's headlines">
          <small><Newspaper size={11} aria-hidden="true" /> Behind today's headlines</small>
          <div>
            {names.map(({ name, count }) => (
              <button key={name} type="button" onClick={() => onOpenName(name)} title={`In ${count} of ${countryName}'s current headlines. Opens the history behind it, in ${countryName}'s context.`}>
                <span>{name}</span>
                <em>{count}×</em>
              </button>
            ))}
          </div>
        </div>
      )}
      {recentChronicle.length >= 2 ? (
        <div className="globe-context-recent" aria-label="Recent history">
          <small title={`Dated events quoted from Wikipedia’s “${countryName}” article.`}>Recent history</small>
          <ol>
            {recentChronicle.map((entry, index) => (
              <li key={`${entry.at.iso}-${index}`}>
                <button type="button" onClick={() => (entry.link ? onOpenName(entry.link) : onOpenCountry())} title={entry.text}>
                  <time dateTime={entry.at.iso}>{entry.at.label}</time>
                  <span>{entry.text.length > 140 ? `${entry.text.slice(0, 138)}…` : entry.text}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : connections.length > 0 && (
        <div className="globe-context-links" aria-label="History worth exploring">
          <small>{newestConnection >= thisYear - 30 ? 'Recent history' : 'Earlier history'}</small>
          <div>
            {connections.map((node) => (
              <button key={node.id} type="button" onClick={() => onOpenTopic(node)} title={node.description ?? node.label}>
                <span>{node.label}</span>
                {node.start && <em>{node.start.label.replace(/^\d{1,2} /, '')}</em>}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
