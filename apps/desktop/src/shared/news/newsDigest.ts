import { headlineLanguage } from '../translate/detect'
import type { GlobalStory } from './globalStories'
import { countryPlace, normalizePlaceText, placesInCountry, type Place } from '../places/places'
import { COUNTRY_ROWS } from '../places/placeData'

/**
 * News digest: what each country's own outlets are publishing now.
 *
 * Built only from feed metadata (headline, link, publish time). A story is
 * placed at a city only when the headline names that city, or when the feed
 * is a declared city/regional outlet; otherwise it counts toward its country
 * as a whole and is drawn at country scale. Publisher location is never used
 * as the story's location.
 */
export const NEWS_DIGEST_SCHEMA = 'intoponet.news-digest.v1' as const

export type NewsSourceMeta = {
  sourceId: string
  countryCode: string
  publisherName: string
  publisherGroupId: string
  scope: 'national' | 'regional' | 'local' | 'international'
  cityName?: string | null
  regionName?: string | null
  /** Feed's declared language (BCP 47), e.g. 'es-AR'. */
  language?: string | null
}

export type NewsItemInput = {
  sourceId: string
  title: string
  url: string
  publishedAt?: string | undefined
  discoveredAt: string
}

export type NewsFeedHealth = 'pending' | 'healthy' | 'stale' | 'error'

export type NewsHeadline = {
  title: string
  url: string
  publisher: string
  publishedAt: string
  /** City or region named in the headline, if any. */
  place?: string
  /** The feed's declared language (BCP 47), when known. */
  lang?: string
}

export type NewsCountry = {
  countryCode: string
  name: string
  lat: number
  lon: number
  radiusKm: number
  /** Distinct stories (duplicate headlines merged) in the window. */
  storyCount: number
  outletCount: number
  feedCount: number
  healthyFeedCount: number
  latestAt: string | null
  /** Distinct stories in the last 24 h, from comparable feeds only. */
  recentCount: number
  /** Distinct stories in the 24 h before that, from comparable feeds only. */
  previousCount: number
  /** (recent − previous) / (recent + previous + 4), or null without comparable coverage. */
  momentum: number | null
  /** Feeds whose observed coverage spans both 24 h windows. */
  comparableFeeds: number
  headlines: NewsHeadline[]
}

export type NewsPlace = {
  id: string
  name: string
  countryCode: string
  lat: number
  lon: number
  radiusKm: number
  storyCount: number
  /** Why stories are placed here: headlines name it, a city outlet covers it, or both. */
  evidence: 'named-in-headline' | 'local-outlet' | 'both'
  /** Distinct stories in the last 24 h, from comparable feeds only. */
  recentCount: number
  /** Distinct stories in the 24 h before that, from comparable feeds only. */
  previousCount: number
  /** (recent − previous) / (recent + previous + 4), or null without comparable coverage. */
  momentum: number | null
  /** Feeds whose observed coverage spans both 24 h windows. */
  comparableFeeds: number
  headlines: NewsHeadline[]
}

export type NewsDigest = {
  schema: typeof NEWS_DIGEST_SCHEMA
  generatedAt: string
  windowHours: number
  feedCount: number
  healthyFeedCount: number
  countries: NewsCountry[]
  places: NewsPlace[]
  /** Countries in the registry whose feeds returned nothing usable. */
  quietCountryCodes: string[]
  /** Terms used by more countries' outlets today than the day before. */
  rising: RisingTerm[]
  /** Stories covered by outlets in many countries at once (see globalStories.ts). */
  global?: GlobalStory[]
  /** Wikipedia's editor-curated "In the news". */
  inTheNews?: WikiNewsItem[]
}

export type WikiNewsItem = {
  /** Wikipedia's own date note, e.g. 'Oct 25'. */
  date: string | null
  story: string
  /** The story's main (bold) article. */
  mainTitle: string | null
  links: Array<{ title: string; url: string }>
}

export type RisingTerm = {
  term: string
  /** Countries (ISO2) whose outlets used the term in the last 24 h (all feeds). */
  recentCountries: string[]
  /** Countries using it in the last 24 h, counting only feeds observed on both days. */
  recentComparableCount: number
  /** Countries using it in the previous 24 h (comparable feeds only). */
  previousCountryCount: number
  /** (recent − previous) / (recent + previous + 2) over comparable feeds. */
  momentum: number
  headlines: NewsHeadline[]
}

/** [startMs, endMs] spans during which a feed's output was continuously observed. */
export type CoverageIntervals = Record<string, Array<[number, number]>>

export const NEWS_DIGEST_LIMITS = {
  headlinesPerCountry: 12,
  headlinesPerPlace: 8,
  placesPerCountry: 12,
  titleChars: 220,
  risingTerms: 12,
  risingHeadlines: 4,
} as const

const HOUR = 3_600_000
/** Smoothing so a handful of stories can't swing momentum to ±1. */
export const MOMENTUM_SMOOTHING = 4
/** Coverage gaps shorter than this are tolerated (polling cadence, clock skew). */
export const NEWS_COVERAGE_TOLERANCE_MS = 90 * 60_000

/**
 * Coverage-aware change between the last 24 h and the 24 h before:
 * (recent − previous) / (recent + previous + 4). Null when no feed observed
 * both windows, or when fewer than 4 stories make the comparison meaningless —
 * lost coverage is never reported as fading.
 */
export function momentumOf(recent: number, previous: number, comparableFeeds: number): number | null {
  if (comparableFeeds <= 0 || recent + previous < 4) return null
  return Math.max(-1, Math.min(1, (recent - previous) / (recent + previous + MOMENTUM_SMOOTHING)))
}

/** Whether merged intervals cover [from, to] apart from small gaps. */
export function coversWindow(intervals: Array<[number, number]>, from: number, to: number): boolean {
  const sorted = [...intervals].filter(([a, b]) => b >= from && a <= to).sort((x, y) => x[0] - y[0])
  let reached = from
  for (const [start, end] of sorted) {
    if (start - reached > NEWS_COVERAGE_TOLERANCE_MS) return false
    reached = Math.max(reached, end)
  }
  return to - reached <= NEWS_COVERAGE_TOLERANCE_MS
}

/** Add one observation span to a feed's intervals, merging overlaps; drops spans older than `keepAfter`. */
export function addCoverage(intervals: Array<[number, number]>, span: [number, number], keepAfter: number): Array<[number, number]> {
  const all = [...intervals, span].filter(([, end]) => end >= keepAfter).sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [start, end] of all) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1] + NEWS_COVERAGE_TOLERANCE_MS) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

/** Place names that are also everyday words in headlines; never matched. */
const AMBIGUOUS_NAMES = new Set([
  'nice', 'mobile', 'reading', 'orange', 'victoria', 'independence', 'concord', 'split', 'hope', 'union',
  'enterprise', 'paradise', 'sale', 'wells', 'bath', 'march', 'may', 'police', 'mission', 'surprise',
  'gold coast', 'central', 'capital', 'eastern', 'western', 'northern', 'southern', 'north', 'south', 'east', 'west',
  'santa', 'san', 'leon', 'linz', 'bar', 'mons', 'aba', 'ede', 'bo', 'goes', 'hof', 'sur', 'tema', 'kids',
])

/** Matched against accent-preserving text when the name itself has accents. */
type Matcher = { place: Place; needle: string; accented: boolean }

/** Lowercase, punctuation to spaces, accents kept (so "Pará" never matches "para"). */
function accentText(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}
/** Matchers bucketed by their first word, longest names first within a bucket. */
const matcherCache = new Map<string, Map<string, Matcher[]>>()

function matchersFor(countryCode: string): Map<string, Matcher[]> {
  const cached = matcherCache.get(countryCode)
  if (cached) return cached
  const seen = new Set<string>()
  const byFirstWord = new Map<string, Matcher[]>()
  for (const place of placesInCountry(countryCode)) {
    const plain = normalizePlaceText(place.name)
    const accented = accentText(place.name) !== plain
    const needle = accented ? accentText(place.name) : plain
    if (plain.length < 4 || AMBIGUOUS_NAMES.has(plain) || seen.has(needle)) continue
    seen.add(needle)
    const first = needle.split(' ')[0]!
    byFirstWord.set(first, [...(byFirstWord.get(first) ?? []), { place, needle, accented }])
  }
  // Longer names first, so "New York" wins over "York".
  for (const list of byFirstWord.values()) list.sort((a, b) => b.needle.length - a.needle.length)
  matcherCache.set(countryCode, byFirstWord)
  return byFirstWord
}

/** First city/region of the country named in a headline, matched on word boundaries. */
export function placeNamedIn(title: string, countryCode: string): Place | null {
  const buckets = matchersFor(countryCode)
  const plainWords = normalizePlaceText(title).split(' ')
  const accentWords = accentText(title).split(' ')
  const plain = ` ${plainWords.join(' ')} `
  const accented = ` ${accentWords.join(' ')} `
  let best: Matcher | null = null
  for (const word of new Set([...plainWords, ...accentWords])) {
    for (const matcher of buckets.get(word) ?? []) {
      if (best && matcher.needle.length <= best.needle.length) continue
      if ((matcher.accented ? accented : plain).includes(` ${matcher.needle} `)) best = matcher
    }
  }
  return best?.place ?? null
}

function declaredPlace(source: NewsSourceMeta): Place | null {
  if (source.scope === 'national') return null
  const wanted = normalizePlaceText(source.cityName ?? source.regionName ?? '')
  if (!wanted) return null
  return placesInCountry(source.countryCode).find((place) => normalizePlaceText(place.name) === wanted) ?? null
}

function storyKey(title: string): string {
  return normalizePlaceText(title).slice(0, 120)
}

function cleanTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().slice(0, NEWS_DIGEST_LIMITS.titleChars)
}

export function buildNewsDigest(input: {
  sources: NewsSourceMeta[]
  items: NewsItemInput[]
  health: Record<string, NewsFeedHealth>
  now: number
  windowHours?: number
  /** Observed coverage per feed; without it, a feed counts as comparable when its oldest item predates the previous window. */
  coverage?: CoverageIntervals
}): NewsDigest {
  const windowHours = input.windowHours ?? 48
  const recentStart = input.now - 24 * HOUR
  const previousStart = input.now - 48 * HOUR
  const oldestBySource = new Map<string, number>()
  for (const item of input.items) {
    const published = Date.parse(item.publishedAt ?? '')
    const at = Number.isFinite(published) ? published : Date.parse(item.discoveredAt)
    if (Number.isFinite(at)) oldestBySource.set(item.sourceId, Math.min(oldestBySource.get(item.sourceId) ?? Infinity, at))
  }
  const comparable = new Set(input.sources.filter((source) => {
    // A stale/error feed can leave old coverage intervals behind. Those intervals
    // describe past observations, not current availability for this comparison.
    const health = input.health[source.sourceId]
    if (health !== undefined && health !== 'healthy') return false
    const intervals = input.coverage?.[source.sourceId]
    if (input.coverage) return intervals ? coversWindow(intervals, previousStart, input.now) : false
    return (oldestBySource.get(source.sourceId) ?? Infinity) <= previousStart
  }).map((source) => source.sourceId))
  const horizon = input.now - windowHours * 3_600_000
  const sourceById = new Map(input.sources.map((source) => [source.sourceId, source]))

  type Story = NewsHeadline & { at: number; countryCode: string; publisherGroupId: string; placeRef: Place | null; evidence: 'named-in-headline' | 'local-outlet' | null; comparable: boolean }
  const stories = new Map<string, Story>()
  for (const item of input.items) {
    const source = sourceById.get(item.sourceId)
    // International desks feed world stories only, never a country's local news.
    if (!source || source.scope === 'international') continue
    const title = cleanTitle(item.title)
    if (title.length < 8 || !/^https?:\/\//.test(item.url)) continue
    const published = Date.parse(item.publishedAt ?? '')
    // Undated items count from when we first saw them.
    const at = Number.isFinite(published) && published <= input.now + 10 * 60_000 ? published : Date.parse(item.discoveredAt)
    if (!Number.isFinite(at) || at < horizon) continue
    const key = `${source.countryCode}|${storyKey(title)}`
    const existing = stories.get(key)
    if (existing) {
      if (comparable.has(source.sourceId)) existing.comparable = true
      continue
    }
    const named = placeNamedIn(title, source.countryCode)
    const declared = named ? null : declaredPlace(source)
    const placeRef = named ?? declared
    stories.set(key, {
      title,
      url: item.url,
      publisher: source.publisherName,
      publishedAt: new Date(at).toISOString(),
      ...(placeRef ? { place: placeRef.name } : {}),
      // The headline's own language: its feed's, unless the headline plainly says otherwise (or the feed declares none).
      ...((): { lang?: string } => { const lang = headlineLanguage(source.language, title); return lang ? { lang } : {} })(),
      at,
      countryCode: source.countryCode,
      publisherGroupId: source.publisherGroupId,
      placeRef,
      evidence: named ? 'named-in-headline' : declared ? 'local-outlet' : null,
      comparable: comparable.has(source.sourceId),
    })
  }

  const byCountry = new Map<string, Story[]>()
  for (const story of stories.values()) {
    const list = byCountry.get(story.countryCode) ?? []
    list.push(story)
    byCountry.set(story.countryCode, list)
  }
  const strip = ({ title, url, publisher, publishedAt, place, lang }: Story): NewsHeadline => ({ title, url, publisher, publishedAt, ...(place ? { place } : {}), ...(lang ? { lang } : {}) })
  const newestFirst = (a: Story, b: Story): number => b.at - a.at
  const change = (list: Story[], comparableFeeds: number): Pick<NewsCountry, 'recentCount' | 'previousCount' | 'momentum' | 'comparableFeeds'> => {
    const counted = list.filter((story) => story.comparable)
    const recentCount = counted.filter((story) => story.at >= recentStart).length
    const previousCount = counted.filter((story) => story.at < recentStart && story.at >= previousStart).length
    return { recentCount, previousCount, momentum: momentumOf(recentCount, previousCount, comparableFeeds), comparableFeeds }
  }

  const registryCountries = [...new Set(input.sources.filter((source) => source.scope !== 'international').map((source) => source.countryCode))].sort()
  const countries: NewsCountry[] = []
  const places: NewsPlace[] = []
  const quietCountryCodes: string[] = []
  for (const code of registryCountries) {
    const feeds = input.sources.filter((source) => source.countryCode === code)
    const list = (byCountry.get(code) ?? []).sort(newestFirst)
    const anchor = countryPlace(code)
    if (!list.length || !anchor) {
      quietCountryCodes.push(code)
      continue
    }
    // Alternate outlets so one prolific publisher can't fill the list.
    const queues = new Map<string, Story[]>()
    for (const story of list) queues.set(story.publisherGroupId, [...(queues.get(story.publisherGroupId) ?? []), story])
    const mixed: Story[] = []
    for (let i = 0; mixed.length < Math.min(list.length, NEWS_DIGEST_LIMITS.headlinesPerCountry); i += 1) {
      for (const queue of queues.values()) if (queue[i] && mixed.length < NEWS_DIGEST_LIMITS.headlinesPerCountry) mixed.push(queue[i]!)
    }
    countries.push({
      countryCode: code,
      name: anchor.name,
      lat: anchor.lat,
      lon: anchor.lon,
      radiusKm: Math.min(900, Math.max(250, anchor.radiusKm)),
      storyCount: list.length,
      outletCount: new Set(list.map((story) => story.publisherGroupId)).size,
      feedCount: feeds.length,
      healthyFeedCount: feeds.filter((feed) => input.health[feed.sourceId] === 'healthy').length,
      latestAt: new Date(list[0]!.at).toISOString(),
      ...change(list, feeds.filter((feed) => comparable.has(feed.sourceId)).length),
      headlines: mixed.map(strip),
    })
    const byPlace = new Map<string, Story[]>()
    for (const story of list) {
      if (!story.placeRef) continue
      byPlace.set(story.placeRef.id, [...(byPlace.get(story.placeRef.id) ?? []), story])
    }
    const placeEntries = [...byPlace.values()]
      .sort((a, b) => b.length - a.length || b[0]!.at - a[0]!.at)
      .slice(0, NEWS_DIGEST_LIMITS.placesPerCountry)
    for (const group of placeEntries) {
      const place = group[0]!.placeRef!
      places.push({
        id: place.id,
        name: place.name,
        countryCode: code,
        lat: place.lat,
        lon: place.lon,
        radiusKm: Math.min(250, Math.max(60, place.radiusKm * 2)),
        storyCount: group.length,
        evidence: group.every((story) => story.evidence === 'named-in-headline')
          ? 'named-in-headline'
          : group.every((story) => story.evidence === 'local-outlet') ? 'local-outlet' : 'both',
        ...change(group, feeds.filter((feed) => comparable.has(feed.sourceId)).length),
        headlines: group.slice(0, NEWS_DIGEST_LIMITS.headlinesPerPlace).map(strip),
      })
    }
  }
  const healthyFeedCount = input.sources.filter((source) => input.health[source.sourceId] === 'healthy').length
  return {
    schema: NEWS_DIGEST_SCHEMA,
    generatedAt: new Date(input.now).toISOString(),
    windowHours,
    feedCount: input.sources.length,
    healthyFeedCount,
    countries,
    places,
    quietCountryCodes,
    rising: risingTerms([...stories.values()], recentStart, previousStart, strip),
  }
}

/** Common headline words across major feed languages; never reported as rising. */
export const STOPWORDS = new Set(`
about after again against also amid among another around back been before being best between both could during each first from have here into just last like more most much must news next only other over says said still such than that their them then there these they this those three through today under until very want week were what when where which while will with without would year years your
government president minister police people world city state country national public million billion percent report reports update live video photos watch latest breaking official officials says
wins plan plans food health ministry service services court case deal talks meeting visit calls urges warns held holds second third record high game match team season league home life help support death dead killed amid early late part make takes take gets well need needs show shows open opens plus free full
contre face lors chez vers ainsi contra ante tras sino cada otro otra sobre
cómo como qué local locales january february march april june july august september october november december enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre janvier février mars avril juin juillet août septembre octobre novembre décembre janeiro fevereiro março maio junho julho setembro outubro novembro dezembro
para como pero sobre entre desde hasta tras donde cuando porque este esta estos estas todos todo años año gobierno presidente ministro policía país nacional según hace sido será puede nuevo nueva hoy
pour avec dans sont plus mais leur tout tous après avant entre sans sous être fait faire gouvernement président ministre police pays selon depuis cette alors aussi encore nouveau nouvelle
para pelo pela pelos pelas como mais sobre entre após antes quando onde está estão governo presidente ministro polícia país segundo também ainda novo nova hoje anos
nicht sich eine einer einem einen sind wird werden wurde nach über unter auch noch beim gegen ohne durch zwischen schon mehr jahr jahre regierung präsident minister polizei land neue neuen heute
della delle degli anche dopo prima sono stato stata tutti tutto governo presidente ministro polizia paese secondo nuovo nuova oggi anni
этот этого после перед также более года году лет может будет были было который которые правительство президент министр полиция страны россии сегодня новости
bersama untuk dengan dari yang akan sudah dalam pada oleh kepada tahun pemerintah presiden menteri polisi negara baru hari
için olan olarak sonra önce daha kadar gibi ancak yeni hükümet bakan polis ülke bugün
`.split(/\s+/).filter(Boolean))

const NO_SPACE_SCRIPTS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u
let countryWords: Set<string> | null = null

function isCountryWord(token: string): boolean {
  if (!countryWords) {
    countryWords = new Set()
    for (const [, name] of COUNTRY_ROWS) {
      for (const word of name.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{M}]+/u)) if ([...word].length >= 4) countryWords.add(word)
    }
  }
  return countryWords.has(token)
}

/** Kept unigrams and adjacent-pair bigrams of a headline. */
export function headlineTerms(title: string): string[] {
  const raw = title.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{M}]+/u).filter(Boolean)
  const kept: Array<string | null> = raw.map((token) =>
    [...token].length >= 4 && !NO_SPACE_SCRIPTS.test(token) && !STOPWORDS.has(token) && !isCountryWord(token) ? token : null)
  const terms = new Set<string>()
  for (let i = 0; i < kept.length; i += 1) {
    const token = kept[i]
    if (!token) continue
    terms.add(token)
    const next = kept[i + 1]
    if (next) terms.add(`${token} ${next}`)
    // Bridge one short connector ("Lula da Silva" → "lula silva").
    else if (raw[i + 1] && [...raw[i + 1]!].length <= 3 && kept[i + 2]) terms.add(`${token} ${kept[i + 2]}`)
  }
  return [...terms]
}

type StoryLike = NewsHeadline & { at: number; countryCode: string; comparable: boolean }

const CASED = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}\p{M}]+$/u

/**
 * Proper-noun evidence from sentence-case headlines: how often each word is
 * capitalised when it is not the first word. Title Case headlines carry no
 * evidence ("Storm Hits Coast"), so they are skipped.
 */
export function capitalEvidence(title: string): Map<string, boolean> {
  const words = title.normalize('NFKC').split(/[^\p{L}\p{M}]+/u).filter((word) => [...word].length >= 4 && CASED.test(word))
  const evidence = new Map<string, boolean>()
  if (words.length < 3) return evidence
  const capitalised = words.filter((word) => word[0] !== word[0]!.toLowerCase()).length
  if (capitalised / words.length > 0.5) return evidence
  words.forEach((word, index) => {
    if (index === 0 && title.trimStart().startsWith(word)) return
    const key = word.toLowerCase()
    evidence.set(key, (evidence.get(key) ?? false) || word[0] !== word[0]!.toLowerCase())
  })
  return evidence
}

/** A rising term must look like a name: capitalised mid-sentence in cased scripts, or widely shared otherwise. */
function looksLikeName(term: string, caps: { cap: number; lower: number }, recentCountries: number): boolean {
  const first = term.split(' ')[0]!
  if (!CASED.test(first)) return recentCountries >= 5
  return caps.cap >= 2 && caps.cap / Math.max(1, caps.cap + caps.lower) >= 0.7
}

function risingTerms<T extends StoryLike>(stories: T[], recentStart: number, previousStart: number, strip: (story: T) => NewsHeadline): RisingTerm[] {
  type Tally = { recentAll: Map<string, T>; recentComparable: Set<string>; previousComparable: Set<string>; caps: { cap: number; lower: number } }
  const tallies = new Map<string, Tally>()
  for (const story of stories) {
    if (story.at < previousStart) continue
    const recent = story.at >= recentStart
    if (!recent && !story.comparable) continue
    const evidence = recent ? capitalEvidence(story.title) : null
    for (const term of headlineTerms(story.title)) {
      let tally = tallies.get(term)
      if (!tally) {
        tally = { recentAll: new Map(), recentComparable: new Set(), previousComparable: new Set(), caps: { cap: 0, lower: 0 } }
        tallies.set(term, tally)
      }
      const seen = evidence?.get(term.split(' ')[0]!)
      if (seen !== undefined) {
        if (seen) tally.caps.cap += 1
        else tally.caps.lower += 1
      }
      if (recent) {
        const current = tally.recentAll.get(story.countryCode)
        if (!current || story.at > current.at) tally.recentAll.set(story.countryCode, story)
        if (story.comparable) tally.recentComparable.add(story.countryCode)
      } else {
        tally.previousComparable.add(story.countryCode)
      }
    }
  }
  // Growth is judged on the same feeds for both days (comparable coverage only);
  // it must be clear growth, not one extra country.
  const candidates = [...tallies.entries()].filter(([term, tally]) => {
    const rc = tally.recentComparable.size
    const pc = tally.previousComparable.size
    return tally.recentAll.size >= 3 && rc >= 3 && rc - pc >= 2 && rc >= pc * 2 && looksLikeName(term, tally.caps, tally.recentAll.size)
  })
  // Prefer a qualifying bigram over the words inside it when they reach about as many countries.
  const bigrams = candidates.filter(([term]) => term.includes(' '))
  const suppressed = new Set<string>()
  for (const [term, tally] of bigrams) {
    for (const word of term.split(' ')) {
      const unigram = tallies.get(word)
      if (unigram && unigram.recentAll.size <= tally.recentAll.size + 1) suppressed.add(word)
    }
  }
  return candidates
    .filter(([term]) => !suppressed.has(term))
    .map(([term, tally]) => ({ term, tally }))
    .sort((a, b) =>
      (b.tally.recentComparable.size - b.tally.previousComparable.size) - (a.tally.recentComparable.size - a.tally.previousComparable.size) ||
      b.tally.recentAll.size - a.tally.recentAll.size ||
      a.term.localeCompare(b.term))
    .slice(0, NEWS_DIGEST_LIMITS.risingTerms)
    .map(({ term, tally }) => {
      const rc = tally.recentComparable.size
      const pc = tally.previousComparable.size
      return {
        term,
        recentCountries: [...tally.recentAll.keys()].sort(),
        previousCountryCount: pc,
        recentComparableCount: rc,
        momentum: Math.max(-1, Math.min(1, (rc - pc) / (rc + pc + 2))),
        headlines: [...tally.recentAll.values()].sort((a, b) => b.at - a.at).slice(0, NEWS_DIGEST_LIMITS.risingHeadlines).map(strip),
      }
    })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const httpsOrHttp = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\//.test(value) && value.length < 2_048
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const count = (value: unknown): number => (finite(value) && value >= 0 ? Math.floor(value) : 0)

/** Momentum fields; absent in digests cached before they existed. */
function parseChange(row: Record<string, unknown>): Pick<NewsCountry, 'recentCount' | 'previousCount' | 'momentum' | 'comparableFeeds'> {
  const momentum = row['momentum']
  return {
    recentCount: count(row['recentCount']),
    previousCount: count(row['previousCount']),
    momentum: finite(momentum) && momentum >= -1 && momentum <= 1 ? momentum : null,
    comparableFeeds: count(row['comparableFeeds']),
  }
}

function parseRising(value: unknown): RisingTerm[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row): RisingTerm[] => {
    if (!isRecord(row) || !text(row['term'], 120) || !Array.isArray(row['recentCountries']) || !finite(row['momentum'])) return []
    return [{
      term: row['term'],
      recentCountries: row['recentCountries'].filter((code): code is string => text(code, 3)).slice(0, 250),
      previousCountryCount: count(row['previousCountryCount']),
      recentComparableCount: count(row['recentComparableCount']),
      momentum: Math.max(-1, Math.min(1, row['momentum'])),
      headlines: parseHeadlines(row['headlines']).slice(0, NEWS_DIGEST_LIMITS.risingHeadlines),
    }]
  }).slice(0, NEWS_DIGEST_LIMITS.risingTerms)
}

function parseHeadlines(value: unknown): NewsHeadline[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row): NewsHeadline[] => {
    if (!isRecord(row) || !text(row['title'], 400) || !httpsOrHttp(row['url']) || !text(row['publisher'], 200) || !text(row['publishedAt'], 40)) return []
    return [{
      title: row['title'],
      url: row['url'],
      publisher: row['publisher'],
      publishedAt: row['publishedAt'],
      ...(text(row['place'], 120) ? { place: row['place'] } : {}),
      ...(typeof row['lang'] === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}$/.test(row['lang']) ? { lang: row['lang'] } : {}),
    }]
  }).slice(0, 20)
}

/** Validate a digest crossing the IPC boundary; drops malformed rows. */
export function parseNewsDigest(raw: string | null): NewsDigest | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(value) || value['schema'] !== NEWS_DIGEST_SCHEMA || !text(value['generatedAt'], 40)) return null
  const countries = Array.isArray(value['countries']) ? value['countries'].flatMap((row): NewsCountry[] => {
    if (!isRecord(row) || !text(row['countryCode'], 3) || !text(row['name'], 120) || !finite(row['lat']) || !finite(row['lon']) ||
      !finite(row['radiusKm']) || !finite(row['storyCount']) || !finite(row['outletCount']) || !finite(row['feedCount']) || !finite(row['healthyFeedCount'])) return []
    return [{
      countryCode: row['countryCode'],
      name: row['name'],
      lat: row['lat'],
      lon: row['lon'],
      radiusKm: row['radiusKm'],
      storyCount: row['storyCount'],
      outletCount: row['outletCount'],
      feedCount: row['feedCount'],
      healthyFeedCount: row['healthyFeedCount'],
      latestAt: text(row['latestAt'], 40) ? row['latestAt'] : null,
      ...parseChange(row),
      headlines: parseHeadlines(row['headlines']),
    }]
  }) : []
  const places = Array.isArray(value['places']) ? value['places'].flatMap((row): NewsPlace[] => {
    if (!isRecord(row) || !text(row['id'], 80) || !text(row['name'], 120) || !text(row['countryCode'], 3) || !finite(row['lat']) ||
      !finite(row['lon']) || !finite(row['radiusKm']) || !finite(row['storyCount'])) return []
    return [{
      id: row['id'],
      name: row['name'],
      countryCode: row['countryCode'],
      lat: row['lat'],
      lon: row['lon'],
      radiusKm: row['radiusKm'],
      storyCount: row['storyCount'],
      evidence: row['evidence'] === 'local-outlet' || row['evidence'] === 'both' ? row['evidence'] : 'named-in-headline',
      ...parseChange(row),
      headlines: parseHeadlines(row['headlines']),
    }]
  }) : []
  return {
    schema: NEWS_DIGEST_SCHEMA,
    generatedAt: value['generatedAt'],
    windowHours: finite(value['windowHours']) ? value['windowHours'] : 48,
    feedCount: finite(value['feedCount']) ? value['feedCount'] : 0,
    healthyFeedCount: finite(value['healthyFeedCount']) ? value['healthyFeedCount'] : 0,
    countries,
    places,
    quietCountryCodes: Array.isArray(value['quietCountryCodes']) ? value['quietCountryCodes'].filter((code): code is string => text(code, 3)) : [],
    rising: parseRising(value['rising']),
    ...(Array.isArray(value['global']) ? { global: parseGlobal(value['global']) } : {}),
    ...(Array.isArray(value['inTheNews']) ? { inTheNews: parseInTheNews(value['inTheNews']) } : {}),
  }
}

function parseGlobal(value: unknown): GlobalStory[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row): GlobalStory[] => {
    if (!isRecord(row) || !text(row['id'], 120) || !text(row['title'], 400) || !httpsOrHttp(row['url']) || !text(row['publisher'], 200) ||
      !finite(row['outletCount']) || !finite(row['internationalDesks']) || !text(row['latestAt'], 40)) return []
    const headlines = Array.isArray(row['headlines']) ? row['headlines'].flatMap((item): GlobalStory['headlines'] => {
      if (!isRecord(item) || !text(item['title'], 400) || !httpsOrHttp(item['url']) || !text(item['publisher'], 200) || !text(item['publishedAt'], 40) || !text(item['countryCode'], 3)) return []
      return [{ title: item['title'], url: item['url'], publisher: item['publisher'], publishedAt: item['publishedAt'], countryCode: item['countryCode'], international: item['international'] === true, ...(typeof item['lang'] === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}$/.test(item['lang']) ? { lang: item['lang'] } : {}) }]
    }).slice(0, 12) : []
    return [{
      id: row['id'],
      title: row['title'],
      url: row['url'],
      publisher: row['publisher'],
      terms: Array.isArray(row['terms']) ? row['terms'].filter((term): term is string => text(term, 60)).slice(0, 6) : [],
      countries: Array.isArray(row['countries']) ? row['countries'].filter((code): code is string => text(code, 3)).slice(0, 250) : [],
      outletCount: row['outletCount'],
      internationalDesks: row['internationalDesks'],
      latestAt: row['latestAt'],
      headlines,
    }]
  }).slice(0, 30)
}

function parseInTheNews(value: unknown): WikiNewsItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row): WikiNewsItem[] => {
    if (!isRecord(row) || !text(row['story'], 500)) return []
    const links = Array.isArray(row['links']) ? row['links'].flatMap((link): WikiNewsItem['links'] => (
      isRecord(link) && text(link['title'], 200) && typeof link['url'] === 'string' && link['url'].startsWith('https://en.wikipedia.org/') ? [{ title: link['title'], url: link['url'] }] : []
    )).slice(0, 5) : []
    return [{ date: text(row['date'], 20) ? row['date'] : null, story: row['story'], mainTitle: text(row['mainTitle'], 200) ? row['mainTitle'] : null, links }]
  }).slice(0, 10)
}
