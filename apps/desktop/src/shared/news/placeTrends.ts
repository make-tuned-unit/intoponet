import { coversWindow, headlineTerms, type CoverageIntervals, type NewsFeedHealth, type NewsHeadline, type NewsItemInput, type NewsSourceMeta } from './newsDigest'
import { headlineLanguage } from '../translate/detect'

/**
 * What is rising and fading in one place (a country, or a city such as Goma,
 * New York City or Rome): the words and names its news used more, or less, in
 * the last 24 hours than in the 24 before. Counted in distinct stories, and
 * only from feeds observed across both days, so a feed that was down never
 * reads as a fading story.
 */

export type PlaceTrend = {
  term: string
  /** Distinct stories using it in the last 24 h (comparable feeds only). */
  recent: number
  /** …and in the 24 h before. */
  previous: number
  /** (recent − previous) / (recent + previous + 2): −1…1. */
  momentum: number
  /** The latest headlines using it (the earlier day's, for a fading term). */
  headlines: NewsHeadline[]
}

export type PlaceTrends = {
  rising: PlaceTrend[]
  fading: PlaceTrend[]
  /** Distinct stories about the place in each window (from feeds watched across both days), and the outlets covering it. */
  recentStories: number
  previousStories: number
  outlets: number
  /** Stories from feeds not watched across both days: shown, but not compared. */
  uncompared: number
  /** The place's latest stories in each window (all feeds), for when nothing clearly rises or fades. */
  latest: NewsHeadline[]
  earlier: NewsHeadline[]
}

export type PlaceQuery = {
  countryCode: string
  /** A city or region: stories from its own outlets, and any that name it. */
  name?: string | null
  /** Other names to recognise it by ("NYC", "New York"). */
  aliases?: string[]
}

const HOUR = 3_600_000
const LIMIT = 8

const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()

/** Whether a title names a place (whole words, accents folded). */
function names(title: string, place: string[]): boolean {
  const text = ` ${fold(title).replace(/[^\p{L}\d]+/gu, ' ')} `
  return place.some((name) => name.length >= 3 && text.includes(` ${fold(name).replace(/[^\p{L}\d]+/gu, ' ').trim()} `))
}

export function placeTrends(input: { sources: NewsSourceMeta[]; items: NewsItemInput[]; coverage: CoverageIntervals; health?: Record<string, NewsFeedHealth>; now: number; place: PlaceQuery }): PlaceTrends {
  const { now, place } = input
  const recentStart = now - 24 * HOUR
  const previousStart = now - 48 * HOUR
  const byId = new Map(input.sources.map((source) => [source.sourceId, source]))
  const placeNames = place.name ? [place.name, ...(place.aliases ?? [])] : []
  // The place's own words ("goma", "rome", "york") are what every story shares, not a trend.
  const own = new Set(placeNames.flatMap((name) => headlineTerms(name)))
  // A feed is comparable when it was watched across both days (or, with no record, its items reach back that far).
  const comparable = (sourceId: string): boolean => {
    const health = input.health?.[sourceId]
    if (health !== undefined && health !== 'healthy') return false
    const intervals = input.coverage[sourceId]
    return intervals ? coversWindow(intervals, previousStart, now) : false
  }

  type Story = { key: string; at: number; comparable: boolean; headline: NewsHeadline; outlet: string }
  const stories = new Map<string, Story>()
  for (const item of input.items) {
    const source = byId.get(item.sourceId)
    if (!source) continue
    const at = Date.parse(item.publishedAt ?? item.discoveredAt)
    if (!Number.isFinite(at) || at < previousStart || at > now + HOUR) continue
    const local = source.countryCode === place.countryCode && source.scope !== 'international'
    const cityOutlet = !!place.name && !!source.cityName && placeNames.some((name) => fold(name) === fold(source.cityName!))
    // A country: its own outlets. A city: its own outlets, and stories anywhere that name it.
    const about = place.name ? cityOutlet || names(item.title, placeNames) : local
    if (!about) continue
    const key = fold(item.title).replace(/[^\p{L}\d]+/gu, ' ').trim().slice(0, 90)
    if (!key || stories.has(key)) continue
    const lang = headlineLanguage(source.language, item.title)
    stories.set(key, {
      key,
      at,
      comparable: comparable(item.sourceId),
      outlet: source.publisherGroupId,
      headline: { title: item.title.slice(0, 220), url: item.url, publisher: source.publisherName, publishedAt: new Date(at).toISOString(), ...(lang ? { lang } : {}) },
    })
  }

  type Tally = { recent: Set<string>; previous: Set<string>; recentHeadlines: Story[]; previousHeadlines: Story[]; outlets: Set<string> }
  const tallies = new Map<string, Tally>()
  for (const story of stories.values()) {
    const recent = story.at >= recentStart
    for (const term of headlineTerms(story.headline.title)) {
      if (own.has(term) || term.split(' ').some((word) => own.has(word))) continue
      let tally = tallies.get(term)
      if (!tally) tallies.set(term, tally = { recent: new Set(), previous: new Set(), recentHeadlines: [], previousHeadlines: [], outlets: new Set() })
      if (recent) tally.recentHeadlines.push(story)
      else tally.previousHeadlines.push(story)
      tally.outlets.add(story.outlet)
      // Growth is judged on the same feeds for both days.
      if (!story.comparable) continue
      if (recent) tally.recent.add(story.key)
      else tally.previous.add(story.key)
    }
  }

  const momentum = (recent: number, previous: number): number => Math.max(-1, Math.min(1, (recent - previous) / (recent + previous + 2)))
  const latest = (list: Story[]): NewsHeadline[] => [...list].sort((a, b) => b.at - a.at).slice(0, 3).map((story) => story.headline)
  const entries = [...tallies.entries()].map(([term, tally]) => ({ term, tally, recent: tally.recent.size, previous: tally.previous.size }))
  // A bigram ("power cut") says more than its words, when it is about as common.
  const prefer = (list: typeof entries): typeof entries => {
    const chosen = list.filter((entry) => entry.term.includes(' '))
    const covered = new Set(chosen.flatMap((entry) => entry.term.split(' ')))
    return [...chosen, ...list.filter((entry) => !entry.term.includes(' ') && !covered.has(entry.term))]
  }
  const rising = prefer(entries.filter((entry) => entry.recent >= 2 && entry.recent - entry.previous >= 2 && entry.recent >= entry.previous * 1.5 && entry.tally.outlets.size >= 1))
    .sort((a, b) => (b.recent - b.previous) - (a.recent - a.previous) || b.recent - a.recent || a.term.localeCompare(b.term))
    .slice(0, LIMIT)
    .map(({ term, tally, recent, previous }) => ({ term, recent, previous, momentum: momentum(recent, previous), headlines: latest(tally.recentHeadlines) }))
  const fading = prefer(entries.filter((entry) => entry.previous >= 3 && entry.recent * 2 <= entry.previous))
    .sort((a, b) => (b.previous - b.recent) - (a.previous - a.recent) || b.previous - a.previous || a.term.localeCompare(b.term))
    .slice(0, LIMIT)
    .map(({ term, tally, recent, previous }) => ({ term, recent, previous, momentum: momentum(recent, previous), headlines: latest(tally.previousHeadlines) }))
  const all = [...stories.values()]
  const compared = all.filter((story) => story.comparable)
  return {
    rising,
    fading,
    recentStories: compared.filter((story) => story.at >= recentStart).length,
    previousStories: compared.filter((story) => story.at < recentStart).length,
    outlets: new Set(all.map((story) => story.outlet)).size,
    uncompared: all.length - compared.length,
    latest: [...all].filter((story) => story.at >= recentStart).sort((a, b) => b.at - a.at).slice(0, 5).map((story) => story.headline),
    earlier: [...all].filter((story) => story.at < recentStart).sort((a, b) => b.at - a.at).slice(0, 5).map((story) => story.headline),
  }
}
