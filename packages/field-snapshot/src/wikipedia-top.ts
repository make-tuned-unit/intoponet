import type { SourceRecord } from './types'
import { weightFromViews, wikipediaAttribution, wikipediaTitlePath } from './wikipedia'

/**
 * "Reading now": English Wikipedia's most-read articles for one UTC day,
 * mapped only when the article itself carries primary coordinates. Most top
 * articles (people, films, elections) have none and stay unmapped; we never
 * infer a location for them.
 */
export const READING_NOW_TOPIC = 'reading-now'
export const topPageviewsSourceId = 'wikimedia-top-pageviews-en'
/** Display footprint only; it is not a measured geographic spread. */
export const readingNowRadiusKm = 300
export const READING_NOW_LIMITS = { topArticles: 1000, located: 60, titlesPerLookup: 50 } as const

const topEndpoint = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access'
const nonArticlePrefix = /^(?:Special|Wikipedia|File|Portal|Help|Talk|User|Template|Category|Draft|Module|MediaWiki|Book|TimedText|Media)(?:_talk)?:/i

export type TopArticle = { title: string; views: number; rank: number }
export type PageInfo = { title: string; lat: number; lon: number; description?: string; thumbnail?: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** UTC day as YYYY/MM/DD path segments. */
export function utcDayPath(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '/')
}

export function wikipediaTopUrl(day: Date): string {
  return `${topEndpoint}/${utcDayPath(day)}`
}

export function wikipediaPageInfoUrl(titles: string[]): string {
  const url = new URL('https://en.wikipedia.org/w/api.php')
  url.searchParams.set('action', 'query')
  url.searchParams.set('format', 'json')
  url.searchParams.set('formatversion', '2')
  url.searchParams.set('prop', 'coordinates|description|pageimages')
  url.searchParams.set('coprimary', 'primary')
  url.searchParams.set('colimit', 'max')
  url.searchParams.set('piprop', 'thumbnail')
  url.searchParams.set('pithumbsize', '320')
  url.searchParams.set('pilimit', 'max')
  url.searchParams.set('redirects', '1')
  url.searchParams.set('titles', titles.join('|'))
  return url.toString()
}

/** Top articles for the day, without the main page and non-article namespaces. */
export function topArticlesFromPayload(payload: unknown, limit: number = READING_NOW_LIMITS.topArticles): TopArticle[] {
  if (!isRecord(payload) || !Array.isArray(payload['items'])) return []
  const first = payload['items'][0]
  if (!isRecord(first) || !Array.isArray(first['articles'])) return []
  return first['articles'].flatMap((item): TopArticle[] => {
    if (!isRecord(item) || typeof item['article'] !== 'string') return []
    const raw = item['article']
    if (raw === 'Main_Page' || nonArticlePrefix.test(raw) || raw.startsWith('-')) return []
    const views = item['views']
    const rank = item['rank']
    if (typeof views !== 'number' || !Number.isFinite(views) || views <= 0) return []
    const title = raw.replace(/_/g, ' ').trim()
    if (!title || title.length > 180) return []
    return [{ title, views, rank: typeof rank === 'number' ? rank : 0 }]
  }).slice(0, limit)
}

/**
 * Located pages from a coordinates/description/pageimages query, keyed by the
 * title that was requested (following normalization and redirects back).
 */
export function pageInfoFromPayload(payload: unknown): Map<string, PageInfo> {
  const result = new Map<string, PageInfo>()
  if (!isRecord(payload) || !isRecord(payload['query'])) return result
  const query = payload['query']
  const back = new Map<string, string[]>()
  const link = (from: unknown, to: unknown): void => {
    if (typeof from !== 'string' || typeof to !== 'string') return
    const sources = back.get(to) ?? []
    sources.push(from, ...(back.get(from) ?? []))
    back.set(to, sources)
  }
  for (const key of ['normalized', 'redirects']) {
    const list = query[key]
    if (Array.isArray(list)) for (const entry of list) if (isRecord(entry)) link(entry['from'], entry['to'])
  }
  if (!Array.isArray(query['pages'])) return result
  for (const page of query['pages']) {
    if (!isRecord(page) || typeof page['title'] !== 'string' || !Array.isArray(page['coordinates'])) continue
    const primary = page['coordinates'].find((entry) => isRecord(entry) && (entry['globe'] ?? 'earth') === 'earth')
    if (!isRecord(primary)) continue
    const lat = primary['lat']
    const lon = primary['lon']
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue
    const info: PageInfo = { title: page['title'], lat, lon }
    if (typeof page['description'] === 'string' && page['description'].trim()) {
      info.description = page['description'].trim().slice(0, 280)
    }
    const thumb = isRecord(page['thumbnail']) ? page['thumbnail']['source'] : undefined
    if (typeof thumb === 'string' && thumb.startsWith('https://')) info.thumbnail = thumb
    result.set(page['title'], info)
    for (const alias of back.get(page['title']) ?? []) result.set(alias, info)
  }
  return result
}

function dayStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

export function recordsFromTopArticles(
  articles: TopArticle[],
  pages: ReadonlyMap<string, PageInfo>,
  day: Date,
  retrievedAt: string,
  limit: number = READING_NOW_LIMITS.located,
): SourceRecord[] {
  const stamp = dayStamp(day)
  const seen = new Set<string>()
  const records: SourceRecord[] = []
  for (const article of [...articles].sort((a, b) => b.views - a.views)) {
    const page = pages.get(article.title)
    if (!page || seen.has(page.title)) continue
    seen.add(page.title)
    const path = wikipediaTitlePath(page.title)
    records.push({
      id: `wikitop-${path}`,
      kind: 'public-record',
      title: page.title,
      url: `https://en.wikipedia.org/wiki/${path}`,
      licence: 'cc-by-sa',
      attribution: wikipediaAttribution,
      retrievedAt,
      lat: page.lat,
      lon: page.lon,
      radiusKm: readingNowRadiusKm,
      topics: [READING_NOW_TOPIC],
      weight: weightFromViews(article.views),
      // The article is not "published" that day; the window end is the observation.
      publishedAt: `${day.toISOString().slice(0, 10)}T23:59:59.000Z`,
      measurement: {
        kind: 'wikimedia-pageviews',
        value: article.views,
        unit: 'pageviews',
        sourceId: topPageviewsSourceId,
        sourceUrl: wikipediaTopUrl(day),
        transformation: 'bounded-log10-pageviews-v1 (log10(value + 1), clamped to 0.2..5); one UTC day, all-access, en.wikipedia top 1000',
        windowStart: stamp,
        windowEnd: stamp,
        // Keeps one-day counts apart from older seven-day pageview records.
        scale: 'utc-day',
      },
      ...(page.description ? { summary: page.description } : {}),
      ...(page.thumbnail ? { thumbnail: page.thumbnail } : {}),
    })
    if (records.length >= limit) break
  }
  return records
}
