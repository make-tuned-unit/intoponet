import { buildNewsDigest, type CoverageIntervals, type NewsFeedHealth, type NewsItemInput, type NewsSourceMeta, type WikiNewsItem } from '../../shared/news/newsDigest'
import { buildGlobalStories } from '../../shared/news/globalStories'
import { buildSpreadingStories } from '../../shared/news/spreadingStories'
import { buildStoryMountains, type StoryMemory } from '../../shared/news/storyMountains'
import { placeTrends, type PlaceQuery, type PlaceTrends } from '../../shared/news/placeTrends'

/**
 * What changed since the last update. The model keeps every feed's headlines, so only feeds
 * whose items changed are sent (a fresh start holds ~110,000 headlines, ~40 MB).
 */
export type DigestUpdate = {
  /** Replace everything: the first update, and after the model lost its state. */
  full: boolean
  schemaVersion: number
  /** Sent with full updates. */
  sources?: NewsSourceMeta[]
  /** Storable headlines of feeds that changed (all feeds when full). An empty list clears a feed. */
  changed: Record<string, NewsItemInput[]>
  /** Headlines from no-store feeds: shown now, never written. Always complete. */
  memoryOnly: NewsItemInput[]
  health: Record<string, NewsFeedHealth>
  coverage: CoverageIntervals
  inTheNews: WikiNewsItem[]
  now: number
}

/** The digest to show now, and (when no-store feeds are present) the one to keep on disk. */
export type DigestOutput = { latest: string; disk: string | null; ms: number; items: number }

/** The model's state was lost (its worker restarted): send a full update. */
export class NeedsFullUpdate extends Error {
  constructor() {
    super('The news digest needs a full update.')
  }
}

/** Every feed's headlines, and the digests and place trends built from them. CPU-heavy: run it off the main thread. */
export class DigestModel {
  private ready = false
  private schemaVersion = 0
  private sources: NewsSourceMeta[] = []
  private stored = new Map<string, NewsItemInput[]>()
  private memoryOnly: NewsItemInput[] = []
  private health: Record<string, NewsFeedHealth> = {}
  private coverage: CoverageIntervals = {}
  private mountainMemory: StoryMemory[] = []
  private inTheNews: WikiNewsItem[] = []

  apply(update: DigestUpdate): void {
    if (!update.full && !this.ready) throw new NeedsFullUpdate()
    if (update.full) {
      this.stored = new Map()
      this.sources = update.sources ?? []
    } else if (update.sources) {
      this.sources = update.sources
    }
    for (const [sourceId, items] of Object.entries(update.changed)) {
      if (items.length) this.stored.set(sourceId, items)
      else this.stored.delete(sourceId)
    }
    this.schemaVersion = update.schemaVersion
    this.memoryOnly = update.memoryOnly
    this.health = update.health
    this.coverage = update.coverage
    this.inTheNews = update.inTheNews
    this.ready = true
  }

  build(now: number): DigestOutput {
    const started = performance.now()
    const stored = [...this.stored.values()].flat()
    const build = (items: NewsItemInput[], remember: boolean): string => {
      // The last build's stories keep their ids and summits, so mountains don't jump between updates.
      const mountains = buildStoryMountains({ sources: this.sources, items, now, previous: this.mountainMemory })
      if (remember) this.mountainMemory = mountains.memory
      return JSON.stringify({
      coverageSchemaVersion: this.schemaVersion,
      ...buildNewsDigest({ sources: this.sources, items, health: this.health, now, coverage: this.coverage }),
      global: buildGlobalStories({ sources: this.sources, items, now }),
      spreading: buildSpreadingStories({ sources: this.sources, items, now }),
      inTheNews: this.inTheNews,
      mountains: mountains.stories,
      })
    }
    const all = this.memoryOnly.length ? [...stored, ...this.memoryOnly] : stored
    const latest = build(all, true)
    const disk = this.memoryOnly.length ? build(stored, false) : null
    return { latest, disk, ms: performance.now() - started, items: all.length }
  }

  trends(place: PlaceQuery, now: number): PlaceTrends {
    if (!this.ready) throw new NeedsFullUpdate()
    const items = [...[...this.stored.values()].flat(), ...this.memoryOnly]
    return placeTrends({ sources: this.sources, items, coverage: this.coverage, health: this.health, now, place })
  }
}

export type DigestBuilder = {
  /** Apply the update, then build. Rejects with NeedsFullUpdate when the model lost its state. */
  build: (update: DigestUpdate) => Promise<DigestOutput>
  trends: (place: PlaceQuery, now: number) => Promise<PlaceTrends>
  close: () => void
}

/** Same thread (tests, and the fallback if the worker cannot start). */
export function inlineDigestBuilder(): DigestBuilder {
  const model = new DigestModel()
  return {
    build: async (update) => { model.apply(update); return model.build(update.now) },
    trends: async (place, now) => model.trends(place, now),
    close: () => undefined,
  }
}
