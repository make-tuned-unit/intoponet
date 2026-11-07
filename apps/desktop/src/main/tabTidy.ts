import { STOPWORDS } from '../shared/news/newsDigest'
import { distinctiveTerms, dot } from './laya/retrieval'

/**
 * Tidy: folders for loose tabs, suggested from their titles and addresses with Laya (on this Mac).
 * The pure parts here decide which tabs are considered, what text the model is given, how the
 * vectors cluster and what the folders are called. Nothing here moves a tab.
 */

export type TidyTab = {
  id: string
  url: string
  title: string
  pinned?: boolean | undefined
  folderId?: string | undefined
  isPrivate?: boolean | undefined
  isStartPage?: boolean | undefined
}

export type TidyGroup = { name: string; tabIds: string[] }

/**
 * Average-linkage cosine similarity two groups must reach to be merged. Measured with Laya on short
 * titles plus hosts: same-topic tabs score about 0.42 to 0.68, different topics 0.19 to 0.36, so 0.4
 * separates them. (0.6 merged only the most alike tabs and left one topic unsorted.)
 */
export const TIDY_SIMILARITY = 0.4
export const TIDY_MAX_GROUPS = 8
/** Titles longer than this are cut before the model sees them. */
const TITLE_LIMIT = 200

function webHost(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/**
 * The loose web tabs Tidy may suggest for: not pinned, not in a folder, not private, not a start
 * page, and http(s) only. Private tabs are dropped here, before any of their text is read.
 */
export function tidyCandidates(tabs: readonly TidyTab[]): TidyTab[] {
  return tabs.filter((tab) => !tab.isPrivate && !tab.pinned && !tab.folderId && !tab.isStartPage && webHost(tab.url) !== null)
}

/** What the model reads for a tab: its title and its host. */
export function tidyText(tab: TidyTab): string {
  const host = webHost(tab.url) ?? ''
  const title = tab.title.replace(/\s+/g, ' ').trim().slice(0, TITLE_LIMIT)
  return [title, host].filter(Boolean).join(' ')
}

function termsOf(tab: TidyTab): string[] {
  const seen = new Set<string>()
  for (const word of tab.title.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length >= 4 && !STOPWORDS.has(word)) seen.add(word)
  }
  return [...seen]
}

/** The second-level name of a host ("nytimes" for news.nytimes.com), or null for addresses and local hosts. */
function siteName(url: string): string | null {
  const host = webHost(url)
  if (!host || /^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) return null
  const labels = host.split('.')
  return labels[labels.length - 2] ?? null
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** A folder's name: the distinctive words its titles share, else the shared site, else "Tabs". */
function nameFor(members: TidyTab[], others: TidyTab[]): string {
  const memberTerms = members.map(termsOf)
  const shared = new Set(memberTerms.flat().filter((term) => memberTerms.filter((terms) => terms.includes(term)).length >= 2))
  const terms = distinctiveTerms(memberTerms, others.map(termsOf), 3).filter((term) => shared.has(term.toLowerCase()))
  if (terms.length) return terms.slice(0, 2).map(capitalise).join(' · ')
  const sites = new Set(members.map((tab) => siteName(tab.url)))
  const [site] = [...sites]
  if (sites.size === 1 && site) return capitalise(site)
  return 'Tabs'
}

/**
 * Group tabs by their vectors (one per candidate, in order), average linkage, merging while the
 * average similarity reaches TIDY_SIMILARITY. Groups of two or more, at most TIDY_MAX_GROUPS,
 * largest first. Names are unique within the suggestion.
 */
export function suggestGroups(vectors: readonly Float32Array[], candidates: readonly TidyTab[]): TidyGroup[] {
  const n = candidates.length
  if (vectors.length !== n) throw new Error('Each tab needs one vector.')
  // Pairwise similarity between the tabs' own vectors (average linkage updates it as clusters merge).
  const similarity: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : dot(vectors[i]!, vectors[j]!))))
  let clusters: number[][] = candidates.map((_, index) => [index])
  for (;;) {
    let best = -Infinity
    let pair: [number, number] | null = null
    for (let a = 0; a < clusters.length; a += 1) {
      for (let b = a + 1; b < clusters.length; b += 1) {
        const value = mean(clusters[a]!, clusters[b]!, similarity)
        if (value > best) {
          best = value
          pair = [a, b]
        }
      }
    }
    if (!pair || best < TIDY_SIMILARITY) break
    const [a, b] = pair
    const merged = [...clusters[a]!, ...clusters[b]!]
    clusters = clusters.filter((_, index) => index !== a && index !== b)
    clusters.push(merged)
  }
  const groups = clusters
    .filter((cluster) => cluster.length >= 2)
    .sort((x, y) => y.length - x.length || Math.min(...x) - Math.min(...y))
    .slice(0, TIDY_MAX_GROUPS)
  const used = new Set<string>()
  return groups.map((cluster) => {
    const members = cluster.map((index) => candidates[index]!)
    const inside = new Set(cluster)
    const others = candidates.filter((_, index) => !inside.has(index))
    const base = nameFor(members, others)
    let name = base
    for (let copy = 2; used.has(name); copy += 1) name = `${base} ${copy}`
    used.add(name)
    return { name, tabIds: members.map((tab) => tab.id) }
  })
}

function mean(a: number[], b: number[], similarity: number[][]): number {
  let total = 0
  for (const i of a) for (const j of b) total += similarity[i]![j]!
  return total / (a.length * b.length)
}
