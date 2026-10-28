import { headlineLanguage } from '../translate/detect'
import { capitalEvidence, STOPWORDS, type NewsHeadline, type NewsItemInput, type NewsSourceMeta } from './newsDigest'

/**
 * Stories covered across many countries at once, found in the headlines of
 * every feed (local outlets in 200+ countries plus international desks).
 *
 * A story is a pair of names or keywords that appear together in headlines
 * from at least three countries and three independent outlets in the last
 * 24 hours; overlapping pairs merge. Ranked by how many countries covered it,
 * then outlets, then international desks. This measures breadth of coverage,
 * not importance or truth. Scripts without capital letters (Arabic, Chinese)
 * rarely contribute, because names are recognised by capitalisation.
 */

export type GlobalStoryHeadline = NewsHeadline & { countryCode: string; international: boolean }

export type GlobalStory = {
  id: string
  /** A representative headline (English and an international desk preferred). */
  title: string
  url: string
  publisher: string
  /** The shared names/keywords that define the story. */
  terms: string[]
  /** Countries whose own (local) outlets covered it, most first. International desks are counted separately. */
  countries: string[]
  outletCount: number
  internationalDesks: number
  latestAt: string
  headlines: GlobalStoryHeadline[]
}

export const GLOBAL_STORY_LIMITS = { stories: 20, headlinesPerStory: 12, minCountries: 3, minOutlets: 3 } as const

const HOUR = 3_600_000

function fold(word: string): string {
  return word.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/['’]s$/, '')
}

/** Content words of a headline (four letters or more, not stop words), folded. */
export function storyTokens(title: string): string[] {
  const words = title.normalize('NFKC').split(/[^\p{L}\p{M}\d]+/u).filter(Boolean)
  const tokens = new Set<string>()
  for (const word of words) {
    const folded = fold(word)
    if ([...folded].length < 4 || STOPWORDS.has(folded) || /^\d+$/.test(folded)) continue
    tokens.add(folded)
  }
  return [...tokens]
}

type Entry = {
  index: number
  title: string
  url: string
  publisher: string
  at: number
  countryCode: string
  group: string
  international: boolean
  english: boolean
  lang: string | null
  tokens: string[]
}

export function buildGlobalStories(input: { sources: NewsSourceMeta[]; items: NewsItemInput[]; now: number; windowHours?: number; limit?: number }): GlobalStory[] {
  const since = input.now - (input.windowHours ?? 24) * HOUR
  const sources = new Map(input.sources.map((source) => [source.sourceId, source]))
  const entries: Entry[] = []
  const seenTitles = new Set<string>()
  for (const item of input.items) {
    const source = sources.get(item.sourceId)
    if (!source) continue
    const published = Date.parse(item.publishedAt ?? '')
    const at = Number.isFinite(published) && published <= input.now + 10 * 60_000 ? published : Date.parse(item.discoveredAt)
    if (!Number.isFinite(at) || at < since) continue
    const title = item.title.trim()
    const key = `${source.publisherGroupId}|${fold(title)}`
    if (!title || seenTitles.has(key)) continue
    seenTitles.add(key)
    entries.push({
      index: entries.length,
      title,
      url: item.url,
      publisher: source.publisherName,
      at,
      countryCode: source.countryCode,
      group: source.publisherGroupId,
      international: source.scope === 'international',
      english: (headlineLanguage(source.language, title) ?? 'en').startsWith('en'),
      lang: headlineLanguage(source.language, title),
      tokens: storyTokens(title),
    })
  }
  if (entries.length < 10) return []

  // Words that look like names: capitalised mid-sentence most of the time.
  const caps = new Map<string, { cap: number; lower: number }>()
  for (const entry of entries) {
    for (const [word, capital] of capitalEvidence(entry.title)) {
      const key = fold(word)
      const tally = caps.get(key) ?? { cap: 0, lower: 0 }
      if (capital) tally.cap += 1
      else tally.lower += 1
      caps.set(key, tally)
    }
  }
  const isName = (token: string): boolean => {
    const tally = caps.get(token)
    return !!tally && tally.cap >= 2 && tally.cap / (tally.cap + tally.lower) >= 0.7
  }

  // Very common words define nothing; keep each headline's distinctive tokens.
  const df = new Map<string, number>()
  for (const entry of entries) for (const token of entry.tokens) df.set(token, (df.get(token) ?? 0) + 1)
  const ceiling = Math.max(25, entries.length * 0.04)
  for (const entry of entries) entry.tokens = entry.tokens.filter((token) => (df.get(token) ?? 0) <= ceiling && (df.get(token) ?? 0) >= 2).slice(0, 10)

  // Pairs of tokens (at least one a name) and the headlines that share them.
  const pairs = new Map<string, number[]>()
  for (const entry of entries) {
    const tokens = [...entry.tokens].sort()
    for (let i = 0; i < tokens.length; i += 1) {
      for (let j = i + 1; j < tokens.length; j += 1) {
        if (!isName(tokens[i]!) && !isName(tokens[j]!)) continue
        const key = `${tokens[i]} ${tokens[j]}`
        const list = pairs.get(key) ?? []
        list.push(entry.index)
        pairs.set(key, list)
      }
    }
  }
  // Breadth: countries of local outlets, plus international desks (each desk counts once, like a country).
  const breadth = (indices: Iterable<number>): { countries: Set<string>; desks: Set<string>; groups: Set<string>; reach: number } => {
    const countries = new Set<string>()
    const desks = new Set<string>()
    const groups = new Set<string>()
    for (const index of indices) {
      const entry = entries[index]!
      if (entry.international) desks.add(entry.group)
      else countries.add(entry.countryCode)
      groups.add(entry.group)
    }
    return { countries, desks, groups, reach: countries.size + desks.size }
  }
  const candidates = [...pairs.entries()]
    .map(([key, indices]) => ({ key, indices, ...breadth(indices) }))
    .filter((pair) => pair.reach >= GLOBAL_STORY_LIMITS.minCountries && pair.groups.size >= GLOBAL_STORY_LIMITS.minOutlets)
    .sort((a, b) => b.reach - a.reach || b.groups.size - a.groups.size)

  // Merge pairs that describe the same story (they share most of their headlines).
  type Cluster = { terms: Map<string, number>; indices: Set<number> }
  const clusters: Cluster[] = []
  for (const pair of candidates) {
    const set = new Set(pair.indices)
    const home = clusters.find((cluster) => {
      let shared = 0
      for (const index of set) if (cluster.indices.has(index)) shared += 1
      return shared / set.size >= 0.5 || shared / cluster.indices.size >= 0.5
    })
    const [a, b] = pair.key.split(' ') as [string, string]
    if (home) {
      for (const index of set) home.indices.add(index)
      home.terms.set(a, (home.terms.get(a) ?? 0) + set.size)
      home.terms.set(b, (home.terms.get(b) ?? 0) + set.size)
    } else {
      clusters.push({ terms: new Map([[a, set.size], [b, set.size]]), indices: set })
    }
    if (clusters.length >= GLOBAL_STORY_LIMITS.stories * 3) break
  }

  // Second pass: clusters led by the same name are one story told several ways ("lula bolsonaro", "lula silva").
  const top2 = (cluster: Cluster): string[] => [...cluster.terms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([term]) => term)
  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = clusters.length - 1; j > i; j -= 1) {
      const a = clusters[i]!
      const b = clusters[j]!
      const shared = top2(a).filter((term) => top2(b).includes(term) && isName(term))
      if (!shared.length) continue
      for (const index of b.indices) a.indices.add(index)
      for (const [term, weight] of b.terms) a.terms.set(term, (a.terms.get(term) ?? 0) + weight)
      clusters.splice(j, 1)
    }
  }

  const stories = clusters.map((cluster): GlobalStory & { score: number } => {
    const members = [...cluster.indices].map((index) => entries[index]!)
    const { countries, desks: deskSet, groups } = breadth(cluster.indices)
    const terms = [...cluster.terms.entries()].sort((a, b) => b[1] - a[1]).map(([term]) => term).slice(0, 4)
    const countryCounts = new Map<string, number>()
    for (const member of members) if (!member.international) countryCounts.set(member.countryCode, (countryCounts.get(member.countryCode) ?? 0) + 1)
    const desks = deskSet.size
    const covers = (member: Entry): number => terms.filter((term) => member.tokens.includes(term)).length
    // An English headline that names the story's two main words, from an international desk if possible.
    const best = Math.min(2, Math.max(...members.map(covers)))
    const representative = [...members].sort((a, b) =>
      Number(covers(b) >= best) - Number(covers(a) >= best) || Number(b.english) - Number(a.english) || Number(b.international) - Number(a.international) || covers(b) - covers(a) || b.at - a.at)[0]!
    // One headline per outlet, spread across countries, newest first.
    const byGroup = new Map<string, Entry>()
    for (const member of [...members].sort((a, b) => b.at - a.at)) if (!byGroup.has(member.group)) byGroup.set(member.group, member)
    const spread: Entry[] = []
    const usedCountries = new Set<string>()
    for (const member of byGroup.values()) if (!usedCountries.has(member.countryCode)) { spread.push(member); usedCountries.add(member.countryCode) }
    for (const member of byGroup.values()) if (!spread.includes(member)) spread.push(member)
    const latest = Math.max(...members.map((member) => member.at))
    return {
      id: `gs-${terms.slice(0, 2).join('-').replace(/[^\p{L}\d-]+/gu, '')}`,
      title: representative.title,
      url: representative.url,
      publisher: representative.publisher,
      terms,
      countries: [...countryCounts.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code),
      outletCount: groups.size,
      internationalDesks: desks,
      latestAt: new Date(latest).toISOString(),
      headlines: spread.slice(0, GLOBAL_STORY_LIMITS.headlinesPerStory).map((member) => ({
        title: member.title,
        url: member.url,
        publisher: member.publisher,
        publishedAt: new Date(member.at).toISOString(),
        countryCode: member.countryCode,
        international: member.international,
        ...(member.lang ? { lang: member.lang } : {}),
      })),
      score: countries.size * 2 + desks * 1.5 + groups.size * 0.5 + Math.max(0, 1 - (input.now - latest) / (24 * HOUR)),
    }
  })
  return stories
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? GLOBAL_STORY_LIMITS.stories)
    .map(({ score: _score, ...story }) => story)
}
