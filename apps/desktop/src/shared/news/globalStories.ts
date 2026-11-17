import { headlineLanguage } from '../translate/detect'
import { memoize, TITLE_CACHE_LIMIT } from '../memo'
import { countriesIn, countryMentions, countryOfToken } from '../places/countryNames'
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

const titleKey = (title: string, lang?: string | null): string => (lang ? `${lang}\u0000${title}` : title)

/**
 * Content words of a headline (four letters or more, not stop words), folded. A country is one token whatever
 * it is called in the headline's language (`lang`, when known) and however many words that takes: "Estados Unidos"
 * and "United States" are both "united-states", not two words that happen to sit together.
 * Shared result: do not mutate.
 */
export const storyTokens = memoize(storyTokensUncached, titleKey, TITLE_CACHE_LIMIT)

function storyTokensUncached(title: string, lang?: string | null): string[] {
  const words = title.normalize('NFKC').split(/[^\p{L}\p{M}\d]+/u).filter(Boolean)
  const folded = words.map(fold)
  const tokens = new Set<string>()
  const countries = countryMentions(words, folded, lang)
  let next = 0
  for (let i = 0; i < words.length; i += 1) {
    const country = countries[next]
    if (country && country.start === i) {
      tokens.add(country.token)
      i += country.length - 1
      next += 1
      continue
    }
    const word = folded[i]!
    if ([...word].length < 4 || STOPWORDS.has(word) || /^\d+$/.test(word)) continue
    tokens.add(word)
  }
  return [...tokens]
}

/**
 * capitalEvidence with each word folded the way tokens are (a country's token is always a name), remembered per
 * title: the folded word, whether it has a capital, and whether it is written with accents ("Peña", not "pena").
 */
const foldedCapitalEvidence = memoize((title: string, lang?: string | null): Array<[string, boolean, boolean]> => {
  const evidence: Array<[string, boolean, boolean]> = [...capitalEvidence(title)].map(([word, capital]) => [fold(word), capital, fold(word) !== word.replace(/['’]s$/, '')])
  for (const country of new Set(countriesIn(title, lang).map((mention) => mention.token))) evidence.push([country, true, false])
  return evidence
}, titleKey, TITLE_CACHE_LIMIT)

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
      tokens: storyTokens(title, headlineLanguage(source.language, title)),
    })
  }
  if (entries.length < 10) return []

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
  const clusters = clusterHeadlines(entries, (indices) => {
    const reach = breadth(indices)
    return reach.reach >= GLOBAL_STORY_LIMITS.minCountries && reach.groups.size >= GLOBAL_STORY_LIMITS.minOutlets ? reach.reach * 1000 + reach.groups.size : null
  }, GLOBAL_STORY_LIMITS.stories * 3)

  const termsOf = (cluster: HeadlineCluster): string[] => [...cluster.terms.entries()].sort((a, b) => b[1] - a[1]).map(([term]) => term).slice(0, 4)
  // An English headline that names the story's two main words, from an international desk if possible.
  const representativeOf = (cluster: HeadlineCluster): Entry => {
    const terms = termsOf(cluster)
    const covers = (member: Entry): number => terms.filter((term) => member.tokens.includes(term)).length
    const members = [...cluster.indices].map((index) => entries[index]!)
    const best = Math.min(2, Math.max(...members.map(covers)))
    return members.sort((a, b) =>
      Number(covers(b) >= best) - Number(covers(a) >= best) || Number(b.english) - Number(a.english) || Number(b.international) - Number(a.international) || covers(b) - covers(a) || b.at - a.at)[0]!
  }
  // Two clusters whose best headline is the same article (and that share a few more) are one story: two rows
  // with one title would be the same story twice. One roundup headline naming two stories does not merge them.
  const representatives = clusters.map(representativeOf)
  const sharedCount = (a: HeadlineCluster, b: HeadlineCluster): number => {
    let shared = 0
    for (const index of b.indices) if (a.indices.has(index)) shared += 1
    return shared
  }
  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = clusters.length - 1; j > i; j -= 1) {
      if (representatives[i] !== representatives[j] || sharedCount(clusters[i]!, clusters[j]!) < 3) continue
      for (const index of clusters[j]!.indices) clusters[i]!.indices.add(index)
      for (const [term, weight] of clusters[j]!.terms) clusters[i]!.terms.set(term, (clusters[i]!.terms.get(term) ?? 0) + weight)
      clusters.splice(j, 1)
      representatives.splice(j, 1)
      representatives[i] = representativeOf(clusters[i]!)
    }
  }

  const stories = clusters.map((cluster, clusterIndex): GlobalStory & { score: number } => {
    const members = [...cluster.indices].map((index) => entries[index]!)
    const { countries, desks: deskSet, groups } = breadth(cluster.indices)
    const terms = termsOf(cluster)
    const countryCounts = new Map<string, number>()
    for (const member of members) if (!member.international) countryCounts.set(member.countryCode, (countryCounts.get(member.countryCode) ?? 0) + 1)
    const desks = deskSet.size
    const representative = representatives[clusterIndex]!
    // One headline per outlet, spread across countries, newest first, and one that names the story (two of its
    // words) when the outlet has one. The story's own headline is always one of them (its outlet's), so the
    // title has a language and a card to translate it with.
    const covers = (member: Entry): number => terms.filter((term) => member.tokens.includes(term)).length
    const byGroup = new Map<string, Entry>([[representative.group, representative]])
    for (const member of [...members].sort((a, b) => Number(covers(b) >= 2) - Number(covers(a) >= 2) || b.at - a.at)) if (!byGroup.has(member.group)) byGroup.set(member.group, member)
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

export type HeadlineCluster = { terms: Map<string, number>; indices: Set<number> }

/**
 * Group headlines that tell the same story: pairs of distinctive tokens (at least
 * one a name) shared across headlines, kept when `score` accepts the headlines that
 * share them (higher scores merge first), then merged when they share most headlines.
 * Mutates each entry's tokens down to its distinctive ones.
 */
export function clusterHeadlines(entries: Array<{ title: string; tokens: string[]; lang?: string | null; group?: string }>, score: (indices: number[]) => number | null, maxClusters: number, options: { mergeLeadingNames?: boolean } = {}): HeadlineCluster[] {
  // Words that look like names: capitalised mid-sentence most of the time.
  type Tally = { cap: number; lower: number }
  const caps = new Map<string, Tally>()
  // The same tally for each spelling of a word: without accents, and with them.
  const spellings = new Map<string, [Tally, Tally]>()
  for (const entry of entries) {
    for (const [key, capital, accented] of foldedCapitalEvidence(entry.title, entry.lang)) {
      const tally = caps.get(key) ?? { cap: 0, lower: 0 }
      let spelt = spellings.get(key)
      if (!spelt) spellings.set(key, spelt = [{ cap: 0, lower: 0 }, { cap: 0, lower: 0 }])
      if (capital) { tally.cap += 1; spelt[Number(accented)]!.cap += 1 } else { tally.lower += 1; spelt[Number(accented)]!.lower += 1 }
      caps.set(key, tally)
    }
  }
  const nameBy = (tally: Tally): boolean => tally.cap >= 2 && tally.cap / (tally.cap + tally.lower) >= 0.7
  // A name and an everyday word can fold to one token: "Peña" the former president and "pena" (a sentence, a
  // pity), "Cayo" and "cayó". Told apart by their accents, the name keeps its weight however often the word is
  // used, and a headline that only has the word (in lower case) does not carry the name.
  // token → whether the everyday word is the spelling with accents.
  const everyday = new Map<string, boolean>()
  for (const [token, [plain, accented]] of spellings) {
    if (nameBy(accented) && plain.lower > 0 && !nameBy(plain)) everyday.set(token, false)
    else if (nameBy(plain) && accented.lower > 0 && !nameBy(accented)) everyday.set(token, true)
  }
  if (everyday.size) {
    for (const entry of entries) {
      const evidence = foldedCapitalEvidence(entry.title, entry.lang)
      let word: Set<string> | null = null
      for (const [key, capital, accented] of evidence) if (!capital && everyday.get(key) === accented) (word ??= new Set()).add(key)
      if (!word) continue
      for (const [key, capital] of evidence) if (capital) word.delete(key)
      const dropped = word
      if (dropped.size) entry.tokens = entry.tokens.filter((token) => !dropped.has(token))
    }
  }
  const isName = (token: string): boolean => {
    const tally = caps.get(token)
    return everyday.has(token) || (!!tally && nameBy(tally))
  }
  /** Seen in lower case mid-sentence and not a name (a word that only ever opens headlines is neither). */
  const isOrdinary = (token: string): boolean => (caps.get(token)?.lower ?? 0) > 0 && !isName(token)

  // Very common words define nothing; keep each headline's distinctive tokens.
  const df = new Map<string, number>()
  for (const entry of entries) for (const token of entry.tokens) df.set(token, (df.get(token) ?? 0) + 1)
  const ceiling = Math.max(25, entries.length * 0.04)
  /** Each headline's words in the order it has them, before the common ones are dropped. */
  const worded = entries.map((entry) => entry.tokens)
  for (const entry of entries) entry.tokens = entry.tokens.filter((token) => (df.get(token) ?? 0) <= ceiling && (df.get(token) ?? 0) >= 2).slice(0, 10)

  // Pairs of tokens (at least one a name) and the headlines that share them. Tokens are numbered
  // in sorted order so a pair is one number (low id first), with no string built per pair.
  const vocabulary = [...df.keys()].filter((token) => (df.get(token) ?? 0) <= ceiling && (df.get(token) ?? 0) >= 2).sort()
  const ids = new Map(vocabulary.map((token, id) => [token, id]))
  const named = vocabulary.map(isName)
  const country = vocabulary.map((token) => countryOfToken(token) !== null)
  const span = vocabulary.length + 1
  // How many headlines have each pair as neighbouring words ("Black Friday", "Santa Cruz", "Robert Pattinson").
  const neighbours = new Map<number, number>()
  for (const tokens of worded) {
    for (let i = 0; i + 1 < tokens.length; i += 1) {
      const a = ids.get(tokens[i]!)
      const b = ids.get(tokens[i + 1]!)
      if (a === undefined || b === undefined) continue
      const key = a < b ? a * span + b : b * span + a
      neighbours.set(key, (neighbours.get(key) ?? 0) + 1)
    }
  }
  /**
   * Two countries say where, not what: a football match between Germany and the Netherlands and a plan both
   * signed are named by the same two words, as is every headline about a war. They never make a story by
   * themselves (what happened does: "Nations League", "deportation").
   *
   * Two words that are nearly always neighbours are one name, not two. One name is a story only when its
   * headlines share something more: three in ten of the outlets using it carry the same third word ("Bond"
   * with Robert Pattinson, "retrial" with Lindsay Clancy). "Black Friday", "Santa Cruz" or "América Latina"
   * head a day's unrelated stories, which share nothing else.
   */
  const namesNoStory = (pair: number, indices: number[]): boolean => {
    const first = Math.floor(pair / span)
    const second = pair % span
    if (country[first] && country[second]) return true
    if ((neighbours.get(pair) ?? 0) < indices.length * 0.9) return false
    const a = vocabulary[first]
    const b = vocabulary[second]
    // Outlets, so one outlet's ten headlines ("Black Friday deals") are not ten voices.
    const outlets = new Set<string>()
    const users = new Map<string, Set<string>>()
    let most = 0
    for (const index of indices) {
      const entry = entries[index]!
      const outlet = entry.group ?? String(index)
      outlets.add(outlet)
      for (const token of entry.tokens) {
        if (token === a || token === b) continue
        let set = users.get(token)
        if (!set) users.set(token, set = new Set())
        set.add(outlet)
        if (set.size > most) most = set.size
      }
    }
    return most < outlets.size * 0.3
  }
  const pairs = new Map<number, number[]>()
  entries.forEach((entry, index) => {
    const tokens = entry.tokens.map((token) => ids.get(token)!).sort((a, b) => a - b)
    for (let i = 0; i < tokens.length; i += 1) {
      const a = tokens[i]!
      for (let j = i + 1; j < tokens.length; j += 1) {
        const b = tokens[j]!
        if (!named[a] && !named[b]) continue
        const key = a * span + b
        const list = pairs.get(key)
        if (list) list.push(index)
        else pairs.set(key, [index])
      }
    }
  })
  // A story needs headlines from at least two outlets, so a pair seen once can never qualify (most pairs).
  const candidates: Array<{ key: string; indices: number[]; rank: number }> = []
  for (const [pair, indices] of pairs) {
    if (indices.length < 2 || namesNoStory(pair, indices)) continue
    const rank = score(indices)
    if (rank !== null) candidates.push({ key: `${vocabulary[Math.floor(pair / span)]} ${vocabulary[pair % span]}`, indices, rank })
  }
  candidates
    .sort((a, b) => b.rank - a.rank)

  // Merge pairs that describe the same story (they share most of their headlines).
  const clusters: HeadlineCluster[] = []
  // How many of each cluster's headlines carry each word (for weak pairs, below).
  const wordCounts = new Map<HeadlineCluster, Map<string, number>>()
  const count = (cluster: HeadlineCluster, index: number): void => {
    const counts = wordCounts.get(cluster)!
    for (const token of entries[index]!.tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  for (const pair of candidates) {
    const set = new Set(pair.indices)
    const home = clusters.find((cluster) => {
      let shared = 0
      for (const index of set) if (cluster.indices.has(index)) shared += 1
      return shared / set.size >= 0.5 || shared / cluster.indices.size >= 0.5
    })
    const [a, b] = pair.key.split(' ') as [string, string]
    if (home) {
      // A name with an ordinary word ("León" and "transporte", "Perú" and "vivo") is weak evidence. A headline it
      // would bring in that shares none of its other words with the pair's headlines already in the story, or
      // with the story's common words, is another story using both words (León the city, a rain alert's live
      // page), not this one.
      let belongs: ((token: string) => boolean) | null = null
      if (isOrdinary(a) || isOrdinary(b)) {
        const side = new Set<string>()
        for (const index of set) if (home.indices.has(index)) for (const token of entries[index]!.tokens) side.add(token)
        const counts = wordCounts.get(home)!
        const common = Math.max(2, Math.ceil(home.indices.size * 0.02))
        belongs = (token) => side.has(token) || (counts.get(token) ?? 0) >= common
      }
      let joined = 0
      for (const index of set) {
        if (belongs && !home.indices.has(index)) {
          const others = entries[index]!.tokens.filter((token) => token !== a && token !== b)
          if (others.length && !others.some(belongs)) continue
        }
        if (!home.indices.has(index)) count(home, index)
        home.indices.add(index)
        joined += 1
      }
      home.terms.set(a, (home.terms.get(a) ?? 0) + joined)
      home.terms.set(b, (home.terms.get(b) ?? 0) + joined)
    } else {
      const cluster: HeadlineCluster = { terms: new Map([[a, set.size], [b, set.size]]), indices: set }
      clusters.push(cluster)
      wordCounts.set(cluster, new Map())
      for (const index of set) count(cluster, index)
    }
    if (clusters.length >= maxClusters) break
  }

  // Second pass: clusters led by the same name are one story told several ways ("lula bolsonaro", "lula silva"),
  // and so are clusters that share a good part of their headlines and a leading word ("peña fiscalía" and
  // "ueno bank": the first pass only compares a pair with the clusters made before it, never two clusters).
  // Off for story mountains: one name in common does not make two events one story.
  if (options.mergeLeadingNames === false) return clusters
  const leading = (cluster: HeadlineCluster, count: number): string[] => [...cluster.terms.entries()].sort((a, b) => b[1] - a[1]).slice(0, count).map(([term]) => term)
  const sameHeadlines = (a: HeadlineCluster, b: HeadlineCluster): boolean => {
    let shared = 0
    for (const index of b.indices) if (a.indices.has(index)) shared += 1
    return shared >= 3 && shared / Math.min(a.indices.size, b.indices.size) >= 1 / 3 && leading(a, 4).some((term) => leading(b, 4).includes(term))
  }
  // A name that most of the day's headlines use elsewhere (a president, a country) leads many stories: it joins
  // two of them only when they are written in different languages, where no other word could be shared.
  const language = (cluster: HeadlineCluster): string => {
    const counts = new Map<string, number>()
    for (const index of cluster.indices) {
      const lang = (entries[index]!.lang ?? '').split('-')[0]!
      counts.set(lang, (counts.get(lang) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? ''
  }
  const theirOwn = (term: string, a: HeadlineCluster, b: HeadlineCluster): boolean => {
    let inside = 0
    for (const index of a.indices) if (entries[index]!.tokens.includes(term)) inside += 1
    for (const index of b.indices) if (!a.indices.has(index) && entries[index]!.tokens.includes(term)) inside += 1
    return inside >= (df.get(term) ?? 0) * 0.4
  }
  // Nor does it join them when one is led by a second name the other never mentions: "Rwanda" with the
  // Francophonie summit and with a deportation centre, "Trump" with Biden and with Putin.
  const share = (cluster: HeadlineCluster, term: string): number => {
    let count = 0
    for (const index of cluster.indices) if (entries[index]!.tokens.includes(term)) count += 1
    return count / Math.max(1, cluster.indices.size)
  }
  const ledElsewhere = (term: string, a: HeadlineCluster, b: HeadlineCluster): boolean =>
    [[a, b], [b, a]].some(([one, other]) => leading(one!, 2).some((name) => name !== term && isName(name) && share(one!, name) >= 0.75 && share(other!, name) === 0))
  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = clusters.length - 1; j > i; j -= 1) {
      const a = clusters[i]!
      const b = clusters[j]!
      const shared = leading(a, 2).filter((term) => leading(b, 2).includes(term) && isName(term) && (theirOwn(term, a, b) || language(a) !== language(b)) && !ledElsewhere(term, a, b))
      if (!shared.length && !sameHeadlines(a, b)) continue
      for (const index of b.indices) a.indices.add(index)
      for (const [term, weight] of b.terms) a.terms.set(term, (a.terms.get(term) ?? 0) + weight)
      clusters.splice(j, 1)
    }
  }

  return clusters
}
