import { headlineLanguage } from '../translate/detect'
import { COUNTRY_ALIASES, COUNTRY_ROWS } from '../places/placeData'
import { countryPlace, normalizePlaceText } from '../places/places'
import { clusterHeadlines, storyTokens } from './globalStories'
import { capitalEvidence, declaredPlace, placeNamedIn, type NewsItemInput, type NewsSourceMeta } from './newsDigest'

/**
 * Story mountains: the stories outlets are covering now, each raised as one
 * mountain over the country it is about.
 *
 * Height is recent independent-outlet coverage: each publisher group counts
 * once per story, weighted by how recent its latest matching headline is
 * (halving every 12 hours). It is on a fixed scale (never re-ranked against the
 * day's other stories), so a quiet day stays low and the tallest summit is
 * always the story the most outlets are carrying. It measures how widely a
 * story is covered in the monitored feeds, not its importance or truth.
 */

export type StoryCountryCoverage = {
  countryCode: string
  /** Independent outlets in this country that carried it. */
  outlets: number
  articles: number
  /** When the story first appeared in this country's feeds (publication time when given). */
  firstAt: string
  headline: { title: string; url: string; publisher: string; publishedAt: string; lang?: string }
}

export type StoryAnchor = { lat: number; lon: number; radiusKm: number; weight: number; name: string }

export type StoryMountain = {
  id: string
  /** A short name for the summit when one can be said plainly ("US midterm elections"); otherwise the headline is used. */
  label: string | null
  title: string
  url: string
  publisher: string
  terms: string[]
  /** Recency-weighted independent outlets (the height measure). */
  coverage: number
  /** Independent outlets anywhere in the window, international desks included. */
  outlets: number
  internationalDesks: number
  articles: number
  /** Relief on the fixed scale, 0..1. */
  height: number
  /** Outlets in the last 6 h vs the 6 h before, -1..1; null with too little to compare. */
  momentum: number | null
  /** The country the story is about. */
  countryCode: string
  summit: { lat: number; lon: number; name: string }
  /** Where in that country the coverage is (outlets' home places and places named), strongest first. */
  footprint: StoryAnchor[]
  /** Other countries whose own outlets covered it, earliest first. */
  countries: StoryCountryCoverage[]
  /** Outlets in the home country. */
  homeOutlets: number
  firstAt: string
  latestAt: string
}

export const STORY_MOUNTAIN_LIMITS = { stories: 60, anchors: 24, countries: 40, windowHours: 36, halfLifeHours: 12, minOutlets: 2 } as const

const HOUR = 3_600_000
/** An election is the story most often told in several languages at once: these are one event word. */
const ELECTION_WORDS = new Set(['midterm', 'midterms', 'election', 'elections', 'elecciones', 'eleccion', 'eleicoes', 'eleicao', 'elections', 'election', 'elezioni', 'wahl', 'wahlen', 'verkiezingen', 'wybory', 'valg', 'val', 'vote', 'voters', 'votacion', 'ballot'])
/** Cosine between two same-country clusters' vocabularies at which they are one event. */
export const STORY_MERGE_SIMILARITY = 0.42
let debugMerges: ((a: { terms: Map<string, number> }, b: { terms: Map<string, number> }, similarity: number) => void) | null = null
/** Tests and tuning only. */
export function debugStoryMerges(hook: typeof debugMerges): void { debugMerges = hook }

/** Fixed, strictly increasing and bounded: 2 outlets ≈ 0.14, 10 ≈ 0.34, 40 ≈ 0.50, 200 ≈ 0.62, 500 ≈ 0.67. */
export function storyHeight(coverage: number): number {
  if (!(coverage > 0)) return 0
  const lift = Math.log1p(coverage / 4)
  return lift / (lift + Math.log(11))
}

type Entry = {
  title: string
  url: string
  publisher: string
  at: number
  countryCode: string
  group: string
  sourceId: string
  international: boolean
  lang: string | null
  tokens: string[]
}

type CountryMatcher = { code: string; needle: string; exact: boolean }
let countryMatchers: Map<string, CountryMatcher[]> | null = null

/** Countries named in a headline ("Paraguay", "US", "Britain"). Short upper-case names must match exactly. */
function countriesNamed(title: string): string[] {
  if (!countryMatchers) {
    countryMatchers = new Map()
    const add = (code: string, name: string): void => {
      const exact = name.length <= 3
      const needle = exact ? name : normalizePlaceText(name)
      const first = exact ? needle : needle.split(' ')[0]!
      if (!first) return
      const list = countryMatchers!.get(first) ?? []
      list.push({ code, needle, exact })
      countryMatchers!.set(first, list)
    }
    for (const row of COUNTRY_ROWS) {
      add(row[0], row[1])
      // English demonyms: Kenya → Kenyan, Iran → Iranian, Israel → Israeli, China → Chinese, Portugal → Portuguese.
      const name = row[1]
      if (name.includes(' ') || name.length < 4) continue
      const stem = name.replace(/[aeiouy]$/i, '')
      for (const demonym of new Set([`${name}n`, `${name}an`, `${name}ian`, `${stem}ian`, `${stem}an`, `${name}i`, `${stem}ese`, `${name}ese`])) add(row[0], demonym)
    }
    for (const [key, names] of Object.entries(COUNTRY_ALIASES)) {
      // "America" is as often Latin America as the US.
      for (const name of names) if (name !== 'America') add(key.replace(/^country:/, ''), name)
    }
    for (const name of ['Estados Unidos', 'EEUU', 'EUA', 'Etats-Unis', 'Stati Uniti', 'Vereinigte Staaten']) add('US', name)
  }
  const raw = title.split(/[^\p{L}\d]+/u).filter(Boolean)
  const plain = normalizePlaceText(title)
  const padded = ` ${plain} `
  const found = new Set<string>()
  for (const word of new Set([...raw, ...plain.split(' ')])) {
    for (const matcher of countryMatchers.get(word) ?? []) {
      if (matcher.exact ? raw.includes(matcher.needle) : padded.includes(` ${matcher.needle} `)) found.add(matcher.code)
    }
  }
  return [...found]
}

const COUNTRY_BY_CODE = new Map(COUNTRY_ROWS.map((row) => [row[0], row]))
const SHORT_COUNTRY: Record<string, string> = { US: 'US', GB: 'UK', AE: 'UAE', KR: 'South Korea', KP: 'North Korea', CD: 'DR Congo', RU: 'Russia' }

/** Headlines' shared URLs decide whether a story is one seen before (so its id and summit stay put). */
export type StoryMemory = { id: string; urls: Set<string>; summit: StoryMountain['summit']; countryCode: string }

export function buildStoryMountains(input: {
  sources: NewsSourceMeta[]
  items: NewsItemInput[]
  now: number
  previous?: StoryMemory[]
  limit?: number
}): { stories: StoryMountain[]; memory: StoryMemory[] } {
  const windowMs = STORY_MOUNTAIN_LIMITS.windowHours * HOUR
  const since = input.now - windowMs
  const sources = new Map(input.sources.map((source) => [source.sourceId, source]))
  const entries: Entry[] = []
  const seen = new Set<string>()
  for (const item of input.items) {
    const source = sources.get(item.sourceId)
    if (!source) continue
    const published = Date.parse(item.publishedAt ?? '')
    const at = Number.isFinite(published) && published <= input.now + 10 * 60_000 ? published : Date.parse(item.discoveredAt)
    if (!Number.isFinite(at) || at < since) continue
    const title = item.title.trim()
    const key = `${source.publisherGroupId}|${normalizePlaceText(title)}`
    if (!title || seen.has(key) || seen.has(item.url)) continue
    seen.add(key)
    seen.add(item.url)
    entries.push({
      title,
      url: item.url,
      publisher: source.publisherName,
      at: Math.min(at, input.now),
      countryCode: source.countryCode,
      group: source.publisherGroupId,
      sourceId: source.sourceId,
      international: source.scope === 'international',
      lang: headlineLanguage(source.language, title),
      tokens: storyTokens(title),
    })
  }
  if (entries.length < 10) return { stories: [], memory: [] }

  const groupsOf = (indices: Iterable<number>): Set<string> => {
    const groups = new Set<string>()
    for (const index of indices) groups.add(entries[index]!.group)
    return groups
  }
  const limit = input.limit ?? STORY_MOUNTAIN_LIMITS.stories
  const clusters = clusterHeadlines(entries, (indices) => {
    const groups = groupsOf(indices).size
    return groups >= STORY_MOUNTAIN_LIMITS.minOutlets ? groups : null
  }, limit * 4, { mergeLeadingNames: false })

  // Which country each story is about: its own outlets count, and other countries' headlines naming it count double.
  const homeOf = (indices: Iterable<number>): string | null => {
    const local = new Map<string, Set<string>>()
    const named = new Map<string, Set<string>>()
    for (const index of indices) {
      const member = entries[index]!
      if (!member.international) {
        const set = local.get(member.countryCode) ?? new Set<string>()
        set.add(member.group)
        local.set(member.countryCode, set)
      }
      for (const code of countriesNamed(member.title)) {
        if (!COUNTRY_BY_CODE.has(code) || code === member.countryCode) continue
        const set = named.get(code) ?? new Set<string>()
        set.add(member.group)
        named.set(code, set)
      }
    }
    let home: string | null = null
    let best = 0
    for (const code of new Set([...local.keys(), ...named.keys()])) {
      const score = (local.get(code)?.size ?? 0) + 2 * (named.get(code)?.size ?? 0)
      if (score > best || (score === best && home !== null && code < home)) { best = score; home = code }
    }
    // "Midterms" told only from abroad is the US election, whatever else those headlines name
    // ("Vance blames Iran war for midterm losses"). A country covering its own midterms keeps them.
    let midterms = 0
    let total = 0
    for (const index of indices) { total += 1; if (/\bmidterms?\b/i.test(entries[index]!.title)) midterms += 1 }
    if (home && home !== 'US' && !local.has(home) && midterms >= Math.max(2, total * 0.25)) return 'US'
    return home
  }

  // One event told several ways ("trump midterms", "democrats midterms"): stories about the same
  // country that share an event word among their leading terms are one mountain. Names alone never
  // merge (Trump is in many unrelated stories).
  const homes = clusters.map((cluster) => homeOf(cluster.indices))
  const stem = (term: string): string => ELECTION_WORDS.has(term) ? 'election' : term.replace(/(?<=\p{L}{4})(es|s)$/u, '')
  const nameLike = (term: string, cluster: (typeof clusters)[number]): boolean => {
    let capital = 0
    let seen = 0
    for (const index of cluster.indices) {
      const evidence = capitalEvidence(entries[index]!.title)
      for (const [word, isCapital] of evidence) if (normalizePlaceText(word) === term) { seen += 1; if (isCapital) capital += 1 }
      if (seen >= 12) break
    }
    return seen > 0 && capital / seen >= 0.6
  }
  // Same-country clusters whose headline vocabulary overlaps strongly are one event told in several
  // angles (results, seats, a senate race): cosine of idf-weighted token counts.
  const df = new Map<string, number>()
  for (const entry of entries) for (const token of entry.tokens) df.set(token, (df.get(token) ?? 0) + 1)
  const bagOf = (cluster: (typeof clusters)[number]): Map<string, number> => {
    const bag = new Map<string, number>()
    for (const index of cluster.indices) {
      for (const token of entries[index]!.tokens) {
        const key = stem(token)
        bag.set(key, (bag.get(key) ?? 0) + Math.log(entries.length / (df.get(token) ?? 1)))
      }
    }
    return bag
  }
  const cosine = (a: Map<string, number>, b: Map<string, number>): number => {
    let dot = 0
    let na = 0
    let nb = 0
    for (const [key, value] of a) { na += value * value; const other = b.get(key); if (other) dot += value * other }
    for (const value of b.values()) nb += value * value
    return na && nb ? dot / Math.sqrt(na * nb) : 0
  }
  const bags = clusters.map(bagOf)
  // Share of a cluster's headlines about an election: two same-country clusters both mostly about one are one election.
  const electionShare = (cluster: (typeof clusters)[number]): number => {
    let hits = 0
    for (const index of cluster.indices) if (storyTokens(entries[index]!.title).some((token) => ELECTION_WORDS.has(token))) hits += 1
    return hits / Math.max(1, cluster.indices.size)
  }
  const elections = clusters.map(electionShare)
  const leads = clusters.map((cluster) => new Set([...cluster.terms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([term]) => stem(term))))
  const eventWords = clusters.map((cluster) => new Set([...cluster.terms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([term]) => term).filter((term) => !nameLike(term, cluster)).map(stem)))
  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = clusters.length - 1; j > i; j -= 1) {
      if (!homes[i] || homes[i] !== homes[j]) continue
      const similarity = cosine(bags[i]!, bags[j]!)
      if (debugMerges) debugMerges(clusters[i]!, clusters[j]!, similarity)
      // Vocabulary alone pairs unrelated local stories ("fraud probe" and "rail accident"): also share a leading term.
      const sharesLead = [...leads[j]!].some((word) => leads[i]!.has(word))
      const oneElection = elections[i]! >= 0.2 && elections[j]! >= 0.2
      if (!((similarity >= STORY_MERGE_SIMILARITY && sharesLead) || oneElection || [...eventWords[j]!].some((word) => eventWords[i]!.has(word)))) continue
      for (const index of clusters[j]!.indices) clusters[i]!.indices.add(index)
      for (const [term, weight] of clusters[j]!.terms) clusters[i]!.terms.set(term, (clusters[i]!.terms.get(term) ?? 0) + weight)
      for (const [key, value] of bags[j]!) bags[i]!.set(key, (bags[i]!.get(key) ?? 0) + value)
      for (const word of eventWords[j]!) eventWords[i]!.add(word)
      for (const word of leads[j]!) leads[i]!.add(word)
      clusters.splice(j, 1)
      homes.splice(j, 1)
      eventWords.splice(j, 1)
      bags.splice(j, 1)
      leads.splice(j, 1)
      elections[i] = electionShare(clusters[i]!)
      elections.splice(j, 1)
    }
  }

  const decay = (at: number): number => 2 ** (-(input.now - at) / (STORY_MOUNTAIN_LIMITS.halfLifeHours * HOUR))
  const previous = input.previous ?? []
  const urlsById = new Map<string, Set<string>>()
  const usedIds = new Set<string>()
  const stories: StoryMountain[] = []
  clusters.forEach((cluster, clusterIndex) => {
    const countryCode = homes[clusterIndex]
    if (!countryCode) return
    const members = [...cluster.indices].map((index) => entries[index]!).sort((a, b) => a.at - b.at)
    // One unit per publisher group, at the weight of its latest matching headline.
    const latestByGroup = new Map<string, Entry>()
    for (const member of members) latestByGroup.set(member.group, member)
    if (latestByGroup.size < STORY_MOUNTAIN_LIMITS.minOutlets) return
    let coverage = 0
    for (const member of latestByGroup.values()) coverage += decay(member.at)
    const homeGroups = new Set(members.filter((member) => !member.international && member.countryCode === countryCode).map((member) => member.group))
    const home = countryPlace(countryCode)
    const row = COUNTRY_BY_CODE.get(countryCode)
    if (!home && !row) return
    const homeLat = home?.lat ?? row![2]
    const homeLon = home?.lon ?? row![3]
    const homeName = home?.name ?? row![1]
    const homeRadius = home?.radiusKm ?? row![4]

    // Footprint: places in the home country that its headlines name, or where its local outlets are based.
    const places = new Map<string, { anchor: StoryAnchor; groups: Set<string> }>()
    for (const member of members) {
      const source = sources.get(member.sourceId)!
      const inHome = member.countryCode === countryCode && !member.international
      const place = placeNamedIn(member.title, countryCode) ?? (inHome ? declaredPlace(source) : null)
      if (!place || place.kind === 'country') continue
      const entry = places.get(place.id) ?? { anchor: { lat: place.lat, lon: place.lon, radiusKm: place.kind === 'region' ? 520 : 300, weight: 0, name: place.name }, groups: new Set<string>() }
      entry.groups.add(member.group)
      places.set(place.id, entry)
    }
    const footprint = [...places.values()]
      .map(({ anchor, groups }) => ({ ...anchor, weight: groups.size }))
      .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
      .slice(0, STORY_MOUNTAIN_LIMITS.anchors)
    const topWeight = footprint[0]?.weight ?? 0
    for (const anchor of footprint) anchor.weight = anchor.weight / topWeight

    // Keep the id and summit of the same story from the last build (most shared headline URLs).
    const urls = new Set(members.map((member) => member.url))
    let match: StoryMemory | null = null
    let shared = 0
    for (const memory of previous) {
      if (usedIds.has(memory.id)) continue
      let count = 0
      for (const url of urls) if (memory.urls.has(url)) count += 1
      if (count > shared && count >= Math.min(3, Math.ceil(memory.urls.size * 0.3))) { shared = count; match = memory }
    }
    // Summit: the place most of the coverage names; a national story stands at the country's own anchor.
    const strongest = footprint[0]
    const summit = match && match.countryCode === countryCode
      ? match.summit
      : strongest && (places.size === 1 || (footprint[1]?.weight ?? 0) < 0.6) && topWeight >= 2
        ? { lat: strongest.lat, lon: strongest.lon, name: strongest.name }
        : { lat: homeLat, lon: homeLon, name: homeName }
    let id = match?.id ?? `sm-${hashText([...urls].sort().slice(0, 4).join('|'))}`
    if (usedIds.has(id)) id = `${id}-${usedIds.size}`
    usedIds.add(id)
    urlsById.set(id, urls)

    const terms = [...cluster.terms.entries()].sort((a, b) => b[1] - a[1]).map(([term]) => term).slice(0, 4)
    const covers = (member: Entry): number => terms.filter((term) => member.tokens.includes(term)).length

    // Other countries' own outlets, earliest first. Each country is shown by its first headline that names
    // the story (two of its words) when it has one: an older headline that only shares a word or two with
    // it (León the city in a story about Pope Leo) is not how that country covered it.
    const byCountry = new Map<string, Entry[]>()
    for (const member of members) {
      if (member.international || member.countryCode === countryCode) continue
      const list = byCountry.get(member.countryCode) ?? []
      list.push(member)
      byCountry.set(member.countryCode, list)
    }
    const countries: StoryCountryCoverage[] = [...byCountry.entries()].map(([code, list]) => {
      const first = list.find((member) => covers(member) >= 2) ?? list[0]!
      return {
        countryCode: code,
        outlets: new Set(list.map((member) => member.group)).size,
        articles: list.length,
        firstAt: new Date(first.at).toISOString(),
        headline: { title: first.title, url: first.url, publisher: first.publisher, publishedAt: new Date(first.at).toISOString(), ...(first.lang ? { lang: first.lang } : {}) },
      }
    }).sort((a, b) => a.firstAt.localeCompare(b.firstAt) || b.outlets - a.outlets).slice(0, STORY_MOUNTAIN_LIMITS.countries)

    // Momentum: outlets in the last 6 h against the 6 h before.
    const recent = new Set<string>()
    const earlier = new Set<string>()
    for (const member of members) {
      if (member.at >= input.now - 6 * HOUR) recent.add(member.group)
      else if (member.at >= input.now - 12 * HOUR) earlier.add(member.group)
    }
    const compared = recent.size + earlier.size
    const english = (member: Entry): boolean => (member.lang ?? 'en').startsWith('en')
    const representative = [...members].sort((a, b) =>
      Math.min(2, covers(b)) - Math.min(2, covers(a)) || Number(english(b)) - Number(english(a)) ||
      Number(b.countryCode === countryCode) - Number(a.countryCode === countryCode) || b.at - a.at)[0]!
    // An election family is named for what it is, not by one of its many headlines.
    const electionHeadlines = members.filter((member) => storyTokens(member.title).some((token) => ELECTION_WORDS.has(token)))
    const midterm = electionHeadlines.filter((member) => /\bmidterms?\b/i.test(member.title)).length
    const short = SHORT_COUNTRY[countryCode] ?? COUNTRY_BY_CODE.get(countryCode)?.[1] ?? homeName
    const label = electionHeadlines.length >= Math.max(3, members.length * 0.3)
      ? `${short} ${midterm >= electionHeadlines.length * 0.25 ? 'midterm elections' : 'elections'}`
      : null
    stories.push({
      id,
      label,
      title: representative.title,
      url: representative.url,
      publisher: representative.publisher,
      terms,
      coverage: Math.round(coverage * 100) / 100,
      outlets: latestByGroup.size,
      internationalDesks: new Set(members.filter((member) => member.international).map((member) => member.group)).size,
      articles: members.length,
      height: storyHeight(coverage),
      momentum: compared >= 5 ? (recent.size - earlier.size) / (recent.size + earlier.size + 2) : null,
      countryCode,
      summit,
      footprint: footprint.length ? footprint : [{ lat: homeLat, lon: homeLon, radiusKm: Math.max(300, homeRadius), weight: 1, name: homeName }],
      countries,
      homeOutlets: homeGroups.size,
      firstAt: new Date(members[0]!.at).toISOString(),
      latestAt: new Date(members[members.length - 1]!.at).toISOString(),
    })
  })
  stories.sort((a, b) => b.height - a.height || a.id.localeCompare(b.id))
  const kept = stories.slice(0, limit)
  const memory = kept.map((story) => ({
    id: story.id,
    urls: urlsById.get(story.id) ?? new Set<string>(),
    summit: story.summit,
    countryCode: story.countryCode,
  }))
  return { stories: kept, memory }
}

/** Short stable hash (FNV-1a, base 36). */
function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
