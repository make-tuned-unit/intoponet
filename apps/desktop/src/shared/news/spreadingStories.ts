import { headlineLanguage } from '../translate/detect'
import type { Place } from '../places/places'
import { clusterHeadlines, storyTokens } from './globalStories'
import { declaredPlace, placeNamedIn, type NewsHeadline, type NewsItemInput, type NewsSourceMeta } from './newsDigest'

/**
 * Local stories that spread: a story that first appears in one place's news
 * (a city or a state) and is then picked up by outlets in other places.
 *
 * The origin is the place the coverage names most (by independent outlets),
 * or, when headlines don't name one, the home of the first local outlet to
 * carry it. Pickups are the other places whose own outlets covered it, in the
 * order they did. National desks count towards reach but have no place of
 * their own. This measures how far a story travelled through local news, not
 * its importance.
 */

export type SpreadPlace = {
  id: string
  name: string
  countryCode: string
  lat: number
  lon: number
  radiusKm: number
  /** When the story first appeared here. */
  firstAt: string
  /** Independent outlets here that carried it. */
  outlets: number
}

export type SpreadHeadline = NewsHeadline & { placeName: string | null }

export type SpreadingStory = {
  id: string
  title: string
  url: string
  publisher: string
  terms: string[]
  origin: SpreadPlace
  /** Where it was picked up, earliest first. */
  pickups: SpreadPlace[]
  /** Independent outlets anywhere, and national desks among them. */
  outletCount: number
  nationalOutlets: number
  firstAt: string
  latestAt: string
  /** The first headline at the origin, then one per pickup in order. */
  headlines: SpreadHeadline[]
}

export const SPREADING_LIMITS = { stories: 12, pickups: 24, headlines: 12, windowHours: 48 } as const

const HOUR = 3_600_000

type Entry = {
  title: string
  url: string
  publisher: string
  at: number
  group: string
  place: Place | null
  named: Place | null
  national: boolean
  lang: string | null
  tokens: string[]
}

// Calendar and routine words recur in unrelated headlines every day.
const ROUTINE = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'today', 'tonight', 'morning', 'night', 'weekend', 'week', 'live', 'watch', 'update', 'updates', 'latest', 'news', 'video', 'photos',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'halloween'])

const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().trim()

export function buildSpreadingStories(input: { sources: NewsSourceMeta[]; items: NewsItemInput[]; now: number; limit?: number }): SpreadingStory[] {
  const since = input.now - SPREADING_LIMITS.windowHours * HOUR
  const sources = new Map(input.sources.map((source) => [source.sourceId, source]))
  const homes = new Map<string, Place | null>()
  const entries: Entry[] = []
  const seen = new Set<string>()
  for (const item of input.items) {
    const source = sources.get(item.sourceId)
    // International desks tell world stories; this is about local news travelling.
    if (!source || source.scope === 'international') continue
    const published = Date.parse(item.publishedAt ?? '')
    const at = Number.isFinite(published) && published <= input.now + 10 * 60_000 ? published : Date.parse(item.discoveredAt)
    if (!Number.isFinite(at) || at < since) continue
    const title = item.title.trim()
    const key = `${source.publisherGroupId}|${fold(title)}`
    if (!title || seen.has(key)) continue
    seen.add(key)
    if (!homes.has(source.sourceId)) homes.set(source.sourceId, declaredPlace(source))
    const named = placeNamedIn(title, source.countryCode)
    entries.push({
      title,
      url: item.url,
      publisher: source.publisherName,
      at,
      group: source.publisherGroupId,
      place: homes.get(source.sourceId) ?? null,
      named: named && named.kind !== 'country' ? named : null,
      national: source.scope === 'national',
      lang: headlineLanguage(source.language, title),
      tokens: storyTokens(title, headlineLanguage(source.language, title)),
    })
  }
  if (entries.length < 10) return []

  // How many headlines use each word, and which words are parts of place names ("north", "carolina", "west", "side").
  const usage = new Map<string, number>()
  const placeWords = new Set<string>()
  for (const entry of entries) {
    for (const token of entry.tokens) usage.set(token, (usage.get(token) ?? 0) + 1)
    for (const place of [entry.place, entry.named]) if (place) for (const word of storyTokens(`${place.name} ${place.region ?? ''}`)) placeWords.add(word)
  }
  // A story is anchored on a distinctive word ("peltola", "huerta", "brewers"): not a place, and in few of today's headlines.
  const anchorCeiling = Math.max(40, entries.length * 0.004)
  const anchorable = (term: string): boolean => !placeWords.has(term) && !ROUTINE.has(term) && (usage.get(term) ?? 0) <= anchorCeiling

  // A candidate needs outlets in at least two places and two independent publishers.
  const clusters = clusterHeadlines(entries, (indices) => {
    const places = new Set<string>()
    const groups = new Set<string>()
    for (const index of indices) {
      const entry = entries[index]!
      if (entry.place) places.add(entry.place.id)
      groups.add(entry.group)
    }
    return places.size >= 2 && groups.size >= 2 ? places.size * 1000 + groups.size : null
  }, SPREADING_LIMITS.stories * 8)

  const stories = clusters.flatMap((cluster): Array<SpreadingStory & { score: number; members: Set<Entry> }> => {
    const terms = [...cluster.terms.entries()].sort((a, b) => b[1] - a[1]).map(([term]) => term).slice(0, 6)
    const anchor = terms.find(anchorable)
    if (!anchor) return []
    // Pairs chain loosely: a headline belongs only if it uses the anchor and one more of the story's main words.
    const others = terms.filter((term) => term !== anchor).slice(0, 4)
    const members = [...cluster.indices].map((index) => entries[index]!)
      .filter((entry) => entry.tokens.includes(anchor) && others.some((term) => entry.tokens.includes(term)))
      .sort((a, b) => a.at - b.at)
    const first = members[0]
    if (!first) return []

    // The place the coverage names, counted once per publisher.
    const namedBy = new Map<string, { place: Place; groups: Set<string>; firstAt: number }>()
    for (const member of members) {
      if (!member.named) continue
      const tally = namedBy.get(member.named.id) ?? { place: member.named, groups: new Set<string>(), firstAt: member.at }
      tally.groups.add(member.group)
      namedBy.set(member.named.id, tally)
    }
    const mostNamed = [...namedBy.values()].sort((a, b) => b.groups.size - a.groups.size || a.firstAt - b.firstAt)[0]
    let origin: Place | null = null
    if (mostNamed && mostNamed.groups.size >= 2) origin = mostNamed.place
    else {
      // Without a named place, a story national desks carried from the start is national news, not a local one spreading.
      const firstLocal = members.find((member) => member.place)
      const earlyNational = members.some((member) => member.national && member.at <= (firstLocal?.at ?? 0) + 3 * HOUR)
      if (firstLocal && !earlyNational) {
        // Where its own outlets covered it most (a wire copy can surface anywhere first), else where it first appeared.
        const outletsAt = new Map<string, { place: Place; groups: Set<string> }>()
        for (const member of members) {
          if (!member.place) continue
          const tally = outletsAt.get(member.place.id) ?? { place: member.place, groups: new Set<string>() }
          tally.groups.add(member.group)
          outletsAt.set(member.place.id, tally)
        }
        const busiest = [...outletsAt.values()].sort((a, b) => b.groups.size - a.groups.size)[0]
        origin = busiest && busiest.groups.size >= 2 ? busiest.place : firstLocal.place
      }
    }
    if (!origin) return []

    // Every place whose own outlets carried it.
    const byPlace = new Map<string, { place: Place; firstAt: number; groups: Set<string>; first: Entry }>()
    for (const member of members) {
      if (!member.place) continue
      const tally = byPlace.get(member.place.id) ?? { place: member.place, firstAt: member.at, groups: new Set<string>(), first: member }
      tally.groups.add(member.group)
      byPlace.set(member.place.id, tally)
    }
    const atOrigin = byPlace.get(origin.id)
    const namedAt = namedBy.get(origin.id)?.firstAt
    const originAt = Math.min(atOrigin?.firstAt ?? Infinity, namedAt ?? Infinity, first.at)
    const pickups = [...byPlace.values()]
      .filter((tally) => tally.place.id !== origin!.id)
      .sort((a, b) => a.firstAt - b.firstAt)
    if (!pickups.length) return []

    const groups = new Set(members.map((member) => member.group))
    if (groups.size < 2) return []
    const nationalGroups = new Set(members.filter((member) => member.national).map((member) => member.group))
    // The representative headline: the first at the origin that names the story's main words, else the first anywhere.
    const covers = (entry: Entry): number => terms.filter((term) => entry.tokens.includes(term)).length
    const originEntries = members.filter((member) => member.place?.id === origin!.id || member.named?.id === origin!.id)
    const representative = [...(originEntries.length ? originEntries : members)].sort((a, b) => covers(b) - covers(a) || a.at - b.at)[0]!
    const toPlace = (place: Place, at: number, outlets: number): SpreadPlace => ({
      id: place.id, name: place.name, countryCode: place.countryCode, lat: place.lat, lon: place.lon, radiusKm: place.radiusKm,
      firstAt: new Date(at).toISOString(), outlets,
    })
    const headline = (entry: Entry): SpreadHeadline => ({
      title: entry.title,
      url: entry.url,
      publisher: entry.publisher,
      publishedAt: new Date(entry.at).toISOString(),
      placeName: entry.place?.name ?? null,
      ...(entry.lang ? { lang: entry.lang } : {}),
    })
    const latest = members[members.length - 1]!.at
    return [{
      id: `sp-${origin.id.replace(/[^\w]+/g, '')}-${terms.slice(0, 2).join('-').replace(/[^\p{L}\d-]+/gu, '')}`,
      title: representative.title,
      url: representative.url,
      publisher: representative.publisher,
      terms,
      origin: toPlace(origin, originAt, atOrigin?.groups.size ?? 0),
      pickups: pickups.slice(0, SPREADING_LIMITS.pickups).map((tally) => toPlace(tally.place, tally.firstAt, tally.groups.size)),
      outletCount: groups.size,
      nationalOutlets: nationalGroups.size,
      firstAt: new Date(originAt).toISOString(),
      latestAt: new Date(latest).toISOString(),
      headlines: [representative, ...pickups.map((tally) => tally.first)].filter((entry, i, all) => all.indexOf(entry) === i).slice(0, SPREADING_LIMITS.headlines).map(headline),
      score: pickups.length * 2 + groups.size + Math.max(0, 1 - (input.now - latest) / (24 * HOUR)),
      members: new Set(members),
    }]
  })

  // The same story found twice (same id, or mostly the same headlines): keep the widest.
  const kept: Array<SpreadingStory & { score: number; members: Set<Entry> }> = []
  for (const story of stories.sort((a, b) => b.score - a.score)) {
    const duplicate = kept.some((other) => {
      if (other.id === story.id) return true
      let shared = 0
      for (const member of story.members) if (other.members.has(member)) shared += 1
      return shared / story.members.size >= 0.4
    })
    if (!duplicate) kept.push(story)
  }
  return kept.slice(0, input.limit ?? SPREADING_LIMITS.stories).map(({ score: _score, members: _members, ...story }) => story)
}

/** How a story has grown: places that picked it up in the last 6 hours, and before. */
export function spreadGrowth(story: SpreadingStory, now: number): { recent: number; earlier: number } {
  let recent = 0
  for (const pickup of story.pickups) if (now - Date.parse(pickup.firstAt) <= 6 * HOUR) recent += 1
  return { recent, earlier: story.pickups.length - recent }
}
