import type { KnowledgeHit } from './contract'

/**
 * Offline keyword retrieval over absorbed paragraphs (PRD LAY-003 without a
 * model): an in-memory inverted index with BM25 scoring, a phrase boost, and
 * one cited paragraph per page.
 */
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'be', 'it', 'at', 'by', 'with', 'as', 'that', 'this', 'from'])
const TOKEN = /[\p{L}\p{N}]+/gu
const K1 = 1.2
const B = 0.75
const SNIPPET_CHARS = 240

/** Normalise and lightly stem one word. */
export function stem(word: string): string {
  let value = word.normalize('NFKC').toLowerCase()
  if (value.length > 4 && value.endsWith('ies')) value = `${value.slice(0, -3)}y`
  else if (value.length > 4 && value.endsWith('es') && /(sh|ch|x|ss)es$/.test(value)) value = value.slice(0, -2)
  else if (value.length > 3 && value.endsWith('s') && !value.endsWith('ss') && !value.endsWith('us')) value = value.slice(0, -1)
  return value
}

export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const match of text.matchAll(TOKEN)) {
    const token = stem(match[0])
    if (token.length < 2 || STOP.has(token)) continue
    out.push(token)
  }
  return out
}

type Paragraph = { recordId: string; index: number; text: string; length: number; terms: Map<string, number> }
type Entry = { url: string; title: string; titleTerms: Set<string>; paragraphs: Paragraph[] }

export class KnowledgeIndex {
  private readonly entries = new Map<string, Entry>()
  private readonly postings = new Map<string, Set<Paragraph>>()
  private totalLength = 0
  private paragraphCount = 0

  add(recordId: string, url: string, title: string, paragraphs: string[]): void {
    this.remove(recordId)
    const entry: Entry = { url, title, titleTerms: new Set(tokenize(title)), paragraphs: [] }
    paragraphs.forEach((text, index) => {
      const tokens = tokenize(text)
      if (!tokens.length) return
      const terms = new Map<string, number>()
      for (const token of tokens) terms.set(token, (terms.get(token) ?? 0) + 1)
      const paragraph: Paragraph = { recordId, index, text, length: tokens.length, terms }
      entry.paragraphs.push(paragraph)
      for (const term of terms.keys()) {
        let set = this.postings.get(term)
        if (!set) this.postings.set(term, (set = new Set()))
        set.add(paragraph)
      }
      this.totalLength += tokens.length
      this.paragraphCount += 1
    })
    this.entries.set(recordId, entry)
  }

  remove(recordId: string): void {
    const entry = this.entries.get(recordId)
    if (!entry) return
    for (const paragraph of entry.paragraphs) {
      for (const term of paragraph.terms.keys()) {
        const set = this.postings.get(term)
        set?.delete(paragraph)
        if (set && set.size === 0) this.postings.delete(term)
      }
      this.totalLength -= paragraph.length
      this.paragraphCount -= 1
    }
    this.entries.delete(recordId)
  }

  clear(): void {
    this.entries.clear()
    this.postings.clear()
    this.totalLength = 0
    this.paragraphCount = 0
  }

  search(query: string, limit = 20): KnowledgeHit[] {
    const queryTerms = [...new Set(tokenize(query))]
    if (!queryTerms.length || !this.paragraphCount) return []
    const avg = this.totalLength / this.paragraphCount
    const phrase = query.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
    const scores = new Map<Paragraph, { score: number; matched: Set<string> }>()
    for (const term of queryTerms) {
      const set = this.postings.get(term)
      if (!set) continue
      const idf = Math.log(1 + (this.paragraphCount - set.size + 0.5) / (set.size + 0.5))
      for (const paragraph of set) {
        const tf = paragraph.terms.get(term)!
        const value = idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (paragraph.length / avg)))
        const current = scores.get(paragraph) ?? { score: 0, matched: new Set<string>() }
        current.score += value
        current.matched.add(term)
        scores.set(paragraph, current)
      }
    }
    const best = new Map<string, { paragraph: Paragraph; score: number }>()
    for (const [paragraph, { score, matched }] of scores) {
      const entry = this.entries.get(paragraph.recordId)!
      let total = score * (0.4 + 0.6 * (matched.size / queryTerms.length))
      if (queryTerms.length > 1 && phrase.length > 3 && paragraph.text.toLowerCase().includes(phrase)) total *= 1.6
      const titleHits = queryTerms.filter((term) => entry.titleTerms.has(term)).length
      total *= 1 + 0.25 * titleHits
      const previous = best.get(paragraph.recordId)
      if (!previous || total > previous.score || (total === previous.score && paragraph.index < previous.paragraph.index)) {
        best.set(paragraph.recordId, { paragraph, score: total })
      }
    }
    const terms = new Set(queryTerms)
    return [...best.values()]
      .sort((a, b) => b.score - a.score || a.paragraph.recordId.localeCompare(b.paragraph.recordId))
      .slice(0, limit)
      .map(({ paragraph, score }) => {
        const entry = this.entries.get(paragraph.recordId)!
        const { snippet, matches } = snippetFor(paragraph.text, terms)
        return { recordId: paragraph.recordId, url: entry.url, title: entry.title, paragraphIndex: paragraph.index, snippet, matches, score: Math.round(score * 1000) / 1000 }
      })
  }
}

/** A ~240-char window around the first match, with offsets of every matched word. */
export function snippetFor(text: string, terms: Set<string>): { snippet: string; matches: Array<[number, number]> } {
  let first = -1
  for (const match of text.matchAll(TOKEN)) {
    if (terms.has(stem(match[0]))) {
      first = match.index!
      break
    }
  }
  let start = 0
  if (text.length > SNIPPET_CHARS && first > 60) {
    start = Math.min(first - 60, text.length - SNIPPET_CHARS)
    const space = text.indexOf(' ', start)
    if (space > -1 && space < first) start = space + 1
  }
  let end = Math.min(text.length, start + SNIPPET_CHARS)
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end)
    if (space > start + SNIPPET_CHARS / 2) end = space
  }
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  const body = text.slice(start, end)
  const matches: Array<[number, number]> = []
  for (const match of body.matchAll(TOKEN)) {
    if (terms.has(stem(match[0]))) matches.push([prefix.length + match.index!, prefix.length + match.index! + match[0].length])
  }
  return { snippet: `${prefix}${body}${suffix}`, matches }
}
