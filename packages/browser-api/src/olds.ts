/**
 * The Olds: source-backed historical threads (PRD §4.7). Every edge is a
 * Wikidata statement with its references; nothing is inferred. A
 * chronology-only edge says one thing came before another — never that it
 * caused it. Lookups go to Wikidata/Wikipedia from the main process.
 */

export const oldsChannels = {
  command: 'intoponet:olds',
} as const

export const OLDS_LIMITS = {
  nodes: 60,
  labelLength: 200,
  descriptionLength: 300,
  titleLength: 300,
  citationsPerEdge: 3,
} as const

export type OldsEdgeType =
  | 'preceded_by'
  | 'followed_by'
  | 'contributed_to'
  | 'influenced'
  | 'responded_to'
  | 'analogous_to'
  | 'disputed_link'
  | 'located_at'
  | 'part_of'
  | 'significant_event'

export type OldsEpistemic = 'source-stated' | 'chronology-only' | 'disputed'

export type OldsDate = {
  /** e.g. '1989-11-09' or '-0044-03-15'. */
  iso: string
  precision: 'millennium' | 'century' | 'decade' | 'year' | 'month' | 'day'
  /** Human label, e.g. '9 Nov 1989', '44 BC', '1960s'. */
  label: string
}

export type OldsNode = {
  /** Wikidata QID. */
  id: string
  label: string
  description: string | null
  start: OldsDate | null
  end: OldsDate | null
  wikipediaUrl: string | null
  wikidataUrl: string
  imageUrl?: string | null
}

export type OldsCitation = { url: string; title: string | null }

/**
 * How well one link is sourced, checked when the thread is built.
 * - referenced: the Wikidata statement cites an outside source (stated in / URL).
 * - wiki-imported: its only reference is "imported from Wikipedia".
 * - unreferenced: no reference at all.
 * - article: it comes from a Wikipedia article's own structure (a history chapter).
 * corroborated: the other side is also named in the Wikipedia article text that was checked.
 */
export type OldsSupport = {
  level: 'referenced' | 'wiki-imported' | 'unreferenced' | 'article'
  corroborated: boolean | null
  /** Title of the Wikipedia article whose text was checked, if any. */
  checkedIn: string | null
}

export type OldsEdge = {
  from: string
  to: string
  type: OldsEdgeType
  epistemic: OldsEpistemic
  /** Wikidata property, e.g. 'P828'. */
  property: string
  /** e.g. 'has cause'. */
  propertyLabel: string
  statementUrl: string
  /** Up to 3, from the statement's references. */
  citations: OldsCitation[]
  referenceCount: number
  support?: OldsSupport
}

/**
 * A chapter of a place's history, as its Wikipedia "History of …" article
 * lays it out. Dates are the span of years the section's text names
 * (approximate, marked 'c.') unless the heading gives them.
 */
export type OldsChapter = {
  id: string
  title: string
  /** 1 = top-level section, 2 = subsection. */
  level: 1 | 2
  start: OldsDate | null
  end: OldsDate | null
  summary: string | null
  /** Link to the section in the article. */
  url: string
  mainArticle: { title: string; url: string } | null
}

export type OldsThread = {
  rootId: string
  nodes: OldsNode[]
  edges: OldsEdge[]
  /** Chapters from the history article, in the article's order. */
  chapters?: OldsChapter[]
  chaptersSource?: { title: string; url: string }
  /** Key facts for a country thread (from Wikidata, latest values). */
  facts?: OldsCountryFacts
  /** True when part of the thread (its history article) could not be fetched; not cached, so the next open retries. */
  partial?: boolean
  /** Present when the thread was opened from a news headline. */
  context?: OldsContext
  /** Attributed, competing readings of this topic from its Wikipedia article (OLD-005), unranked. */
  interpretations?: OldsInterpretation[]
  /** "How we got here": dated passages from the topic and linked historical context, oldest first. */
  chronicle?: OldsChronicleEntry[]
  /** Limits of the dated narrative, distinct from a country's founding date. */
  historyNote?: string
  fetchedAt: string
  attribution: string
  note: string
}

export type OldsChronicleEntry = {
  at: OldsDate
  /** The sentence as written in the article. */
  text: string
  section: string
  /** Wider context from an explicitly linked subject article or its documented event series. */
  sourceTitle?: string
  /** The article section it comes from. */
  url: string
  /** The first article the sentence links to (open its history). */
  link: string | null
}

export type OldsInterpretation = {
  /** Who holds the view: a named scholar or a school ("Revisionist historians"). */
  who: string
  /** The sentence that states it, as written in the article. */
  view: string
  /** Article section it comes from, and a link to it. */
  section: string
  url: string
}

export type OldsCountryFacts = {
  population: { value: number; year: string | null } | null
  gdpUsd: { value: number; year: string | null } | null
  capital: string | null
  headOfState: string | null
  headOfGovernment: string | null
  languages: string[]
  currency: string | null
  inception: OldsDate | null
}

/** One step on the path from a news story back through history (newest first). */
export type OldsPathStep = {
  node: OldsNode
  /** How the previous (newer) step relates to this one, e.g. 'is part of', 'was caused by'. Empty for the first step. */
  relation: string
  edge: OldsEdge | null
}

export type OldsContext = {
  headline: string
  /** The topic the headline was matched to (the thread's root). */
  topicId: string
  /** Other plausible topics, to switch to if the match is wrong. */
  candidates: Array<{ id: string; label: string; description: string | null }>
  /** Topic first, then back through sourced links. */
  path: OldsPathStep[]
  /** The chapter of the country's history the topic falls in, if a country was known. */
  chapter: OldsChapter | null
  chapterSource: { title: string; url: string } | null
  /** How the topic was found, in plain words. */
  matchedBy: string
  /** Subject topics behind the story in its country ("Incarceration in Canada"), with key figures from each article. */
  related?: OldsRelatedTopic[]
  /** Where Wikipedia's Current events filed this story: its thread(s), outermost first, and the matching item. */
  filedUnder?: { threads: string[]; item: string; date: string; url: string }
}

export type OldsRelatedTopic = {
  title: string
  description: string | null
  url: string
  /** Up to two recent sentences with figures, quoted from the article. */
  figures: string[]
}

export const OLDS_HEADLINE_MAX = 400

export type OldsQuery =
  | { kind: 'chapter'; article: string; section: string }
  | { kind: 'headline'; text: string; countryCode?: string; lang?: string; topic?: string }
  | { kind: 'wikipedia'; title: string; lang?: string }
  | { kind: 'qid'; qid: string }
  | { kind: 'country'; countryCode: string }

export type OldsCommand = { type: 'thread'; query: OldsQuery }

export interface OldsApi {
  thread(query: OldsQuery): Promise<OldsThread>
}

export const OLDS_NOTE = "Links are Wikidata statements with their references. 'Chronology only' means one came before another — not that it caused it."
export const OLDS_ATTRIBUTION = 'Wikidata (CC0) · Wikipedia (CC BY-SA 4.0)'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isQid(value: unknown): value is string {
  return typeof value === 'string' && /^Q[1-9]\d{0,11}$/.test(value)
}

export function parseOldsQuery(value: unknown): OldsQuery {
  if (!isRecord(value)) throw new Error('Invalid Olds query.')
  switch (value['kind']) {
    case 'chapter': {
      const article = value['article']
      const section = value['section']
      if (typeof article !== 'string' || !article.trim() || article.length > OLDS_LIMITS.titleLength || /[<>[\]{}|#]/.test(article)) throw new Error('Invalid article.')
      if (typeof section !== 'string' || !section.trim() || section.length > 200 || /[<>[\]{}|]/.test(section)) throw new Error('Invalid section.')
      return { kind: 'chapter', article: article.trim(), section: section.trim() }
    }
    case 'headline': {
      const text = value['text']
      if (typeof text !== 'string' || !text.trim() || text.length > OLDS_HEADLINE_MAX) throw new Error('Invalid headline.')
      const code = value['countryCode']
      if (code !== undefined && (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code))) throw new Error('Invalid country code.')
      const lang = value['lang']
      if (lang !== undefined && (typeof lang !== 'string' || !/^[a-z]{2,3}$/.test(lang))) throw new Error('Invalid language.')
      const topic = value['topic']
      if (topic !== undefined && !isQid(topic)) throw new Error('Invalid topic.')
      return { kind: 'headline', text: text.trim().replace(/\s+/g, ' '), ...(code ? { countryCode: code } : {}), ...(lang ? { lang } : {}), ...(topic ? { topic } : {}) }
    }
    case 'wikipedia': {
      const title = value['title']
      if (typeof title !== 'string' || !title.trim() || title.length > OLDS_LIMITS.titleLength || /[<>[\]{}|#]/.test(title)) {
        throw new Error('Invalid Wikipedia title.')
      }
      const lang = value['lang']
      if (lang !== undefined && (typeof lang !== 'string' || !/^[a-z]{2,3}(?:-[a-z]{2,8})?$/.test(lang))) throw new Error('Invalid language.')
      return { kind: 'wikipedia', title: title.trim(), ...(lang ? { lang } : {}) }
    }
    case 'qid':
      if (!isQid(value['qid'])) throw new Error('Invalid Wikidata id.')
      return { kind: 'qid', qid: value['qid'] }
    case 'country': {
      const code = value['countryCode']
      if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code)) throw new Error('Invalid country code.')
      return { kind: 'country', countryCode: code }
    }
    default:
      throw new Error('Invalid Olds query.')
  }
}

export function parseOldsCommand(value: unknown): OldsCommand {
  if (!isRecord(value) || value['type'] !== 'thread') throw new Error('Invalid Olds command.')
  return { type: 'thread', query: parseOldsQuery(value['query']) }
}
