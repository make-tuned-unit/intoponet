import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { COVERAGE_OUTLETS, type CoverageOutletId, type OldsCoverage, type OldsCoverageItem, type OldsCoverageTopic } from '@intoponet/browser-api'
import { COUNTRY_ROWS } from '../../shared/places/placeData'
import { decodeEntities } from '../articlePreview'
import { terms } from './currentEvents'

/**
 * An outlet's earlier coverage of a story, from its own topic pages: the live
 * page first, then Internet Archive Wayback Machine snapshots of it, each one
 * taken just before the oldest headline already found, so the thread runs back
 * without gaps. Only outlets that have not asked the archive to exclude them.
 */

type OutletPages = {
  id: CoverageOutletId
  /** Topic or tag pages the outlet links its articles to (path only). */
  topicPath: RegExp
  /** Topic page paths for one of the article's own keywords (when the article lists keywords but not links). */
  keywordPaths?: (slug: string, keyword: string) => string[]
  /** Article links on a topic page (path only). */
  articlePath: RegExp
  /** Publication date written in an article's path, as YYYY-MM-DD. */
  pathDate?: (path: string) => string | null
  /** Other hosts the same topic page has lived on (BBC: .co.uk and .com). */
  alternateHosts?: string[]
  /** Cards write dates day first (05/11/2026 is 5 November). */
  dayFirst?: boolean
  /**
   * Where a topic page's own list sits, when not in its <main> element: the
   * site's featured stories, "most read" and recommendations sit outside it.
   */
  region?: { from?: RegExp; to?: RegExp; skipMain?: boolean }
  /** Topic pages for a place below a country (ABC: /news/topic/sydney-2000, a suburb or city by its postcode). */
  placePath?: RegExp
}

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' }
const pad = (value: string | number): string => String(value).padStart(2, '0')
const ymdSlash = (path: string): string | null => {
  const match = path.match(/\/(20\d{2}|19\d{2})\/(\d{1,2})\/(\d{1,2})\//)
  return match ? `${match[1]}-${pad(match[2]!)}-${pad(match[3]!)}` : null
}

export type OutletProfile = OutletPages & { name: string; host: RegExp }

const COUNTRY_NAMES = new Set(COUNTRY_ROWS.map((row) => row[1].toLowerCase()))
const isCountry = (keyword: string): boolean => COUNTRY_NAMES.has(keyword.toLowerCase())

const PAGES: OutletPages[] = [
  {
    id: 'bbc',
    topicPath: /^\/news\/topics\/[a-z0-9]{10,14}\/?$/,
    articlePath: /^\/news\/(articles\/[a-z0-9]{8,14}|[a-z]+(-[a-z]+)*-\d{6,9})\/?$/,
    alternateHosts: ['www.bbc.co.uk', 'www.bbc.com'],
  },
  {
    id: 'aljazeera',
    topicPath: /^\/(tag|where)\/[a-z0-9-]+\/?$/,
    keywordPaths: (slug, keyword) => [isCountry(keyword) ? `/where/${slug}/` : `/tag/${slug}/`],
    // The tag's feed follows <main> (which holds featured stories); the sidebar ends it.
    region: { from: /class="[^"]*\bsection-feed\b/, to: /<div[^>]*class="sidebar\b/, skipMain: true },
    articlePath: /^\/(news|features|economy|opinions|sports|gallery|video\/[a-z-]+|program\/[a-z-]+)\/\d{4}\/\d{1,2}\/\d{1,2}\/[a-z0-9-]+\/?$/,
    pathDate: ymdSlash,
  },
  {
    id: 'dw',
    topicPath: /^\/en\/[a-z0-9-]+\/t-\d+$/,
    articlePath: /^\/en\/[a-z0-9-]+\/a-\d+$/,
    region: { to: /\bats-dw-recommends\b|\bdw-recommends\b/ },
  },
  {
    id: 'npr',
    // Older tags are numbered (/tags/1014/sudan), newer ones are not (/tags/g-s1-100949/2026-midterms).
    topicPath: /^\/tags\/(\d+|g-s1-\d+)\/[a-z0-9-]+\/?$/,
    articlePath: /^\/(sections\/[a-z0-9-]+\/)?\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/[a-z0-9-]+\/?$/,
    pathDate: ymdSlash,
  },
  {
    id: 'cna',
    topicPath: /^\/topic\/[a-z0-9-]+$/,
    keywordPaths: (slug) => [`/topic/${slug}`],
    dayFirst: true,
    articlePath: /^\/(asia|world|singapore|business|sport|east-asia|commentary|cna-insider|interactives|today|dining|style-beauty|experiences|women|wellness|entertainment)\/[a-z0-9-]+-\d{5,8}$/,
  },
  {
    id: 'rfi',
    topicPath: /^\/en\/tag\/[^/]+\/?$/,
    keywordPaths: (slug) => [`/en/tag/${slug}/`],
    articlePath: /^\/en\/[a-z0-9-]+(\/[a-z0-9-]+)?\/\d{8}-[^/]+$/,
    pathDate: (path) => {
      const match = path.match(/\/(\d{4})(\d{2})(\d{2})-/)
      return match ? `${match[1]}-${match[2]}-${match[3]}` : null
    },
  },
  {
    id: 'euronews',
    topicPath: /^\/tag\/[a-z0-9-]+$/,
    keywordPaths: (slug) => [`/tag/${slug}`],
    articlePath: /^\/([a-z-]+\/){0,2}\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+$/,
    pathDate: (path) => {
      const match = path.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//)
      return match ? `${match[1]}-${match[2]}-${match[3]}` : null
    },
  },
  {
    id: 'abc-au',
    topicPath: /^\/news\/topic\/[a-z0-9-]+$/,
    placePath: /^\/news\/topic\/[a-z-]+-\d{4}$/,
    articlePath: /^\/news\/(\d{4}-\d{2}-\d{2})\/[a-z0-9-]+\/\d+$/,
    pathDate: (path) => path.match(/^\/news\/(\d{4}-\d{2}-\d{2})\//)?.[1] ?? null,
  },
  {
    id: 'africanews',
    topicPath: /^\/(tag|country)\/[a-z0-9-]+\/?$/,
    keywordPaths: (slug, keyword) => [isCountry(keyword) ? `/country/${slug}/` : `/tag/${slug}/`],
    articlePath: /^\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/?$/,
    pathDate: ymdSlash,
  },
  {
    id: 'mee',
    topicPath: /^\/(countries|topics|tags)\/[a-z0-9-]+$/,
    keywordPaths: (slug, keyword) => [isCountry(keyword) ? `/countries/${slug}` : `/topics/${slug}`],
    articlePath: /^\/(news|explainers|opinion|big-story|discover|video|live-blog\/live-blog-update)\/[a-z0-9-]+$/,
  },
]

export const OUTLETS: OutletProfile[] = PAGES.map((pages) => {
  const outlet = COVERAGE_OUTLETS.find((item) => item.id === pages.id)!
  return { ...pages, name: outlet.name, host: outlet.host }
})

export function outletFor(url: string): OutletProfile | null {
  let host: string
  try { host = new URL(url).hostname.toLowerCase() } catch { return null }
  return OUTLETS.find((outlet) => outlet.host.test(host)) ?? null
}

// ── Reading pages ────────────────────────────────────────────────────────────

const text = (html: string): string => decodeEntities(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/­/g, '').replace(/\s+/g, ' ').trim()
export const slugify = (keyword: string): string => keyword.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const slugLabel = (path: string): string => {
  const last = path.replace(/\/$/, '').split('/').filter((part) => !/^t-\d+$|^\d+$/.test(part)).pop() ?? ''
  const words = decodeURIComponent(last).replace(/-\d+$/, '').split('-')
  // "european-union-eu": the last word only abbreviates the others.
  const tail = words[words.length - 1] ?? ''
  if (words.length > 2 && tail.length >= 2 && tail === words.slice(0, -1).map((word) => word[0]).join('').slice(0, tail.length) && tail.length === words.length - 1) words.pop()
  return words.join(' ').replace(/^\w/, (c) => c.toUpperCase())
}

type Anchor = { href: string; inner: string; end: number; attrs: string }
function anchors(html: string): Anchor[] {
  const out: Anchor[] = []
  const pattern = /<a\b([^>]*?)\bhref\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    out.push({ href: decodeEntities(match[3]!), inner: match[5]!, end: pattern.lastIndex, attrs: `${match[1]} ${match[4]}` })
    if (out.length > 4000) break
  }
  return out
}

/** The article's own keywords: article:tag, keywords and news_keywords metas, and JSON-LD keywords. */
export function articleKeywords(html: string): string[] {
  const found: string[] = []
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0]
    const name = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase()
    if (!name || !['article:tag', 'keywords', 'news_keywords', 'parsely-tags'].includes(name)) continue
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1]
    if (content) found.push(...decodeEntities(content).split(/[,|]/))
  }
  for (const match of html.matchAll(/"keywords"\s*:\s*(\[[^\]]*\]|"[^"]*")/g)) {
    try {
      const value = JSON.parse(match[1]!) as unknown
      if (typeof value === 'string') found.push(...value.split(','))
      else if (Array.isArray(value)) for (const item of value) {
        if (typeof item === 'string') found.push(item)
        else if (item && typeof item === 'object' && typeof (item as { title?: unknown }).title === 'string') found.push((item as { title: string }).title)
      }
    } catch { /* not JSON */ }
  }
  const seen = new Set<string>()
  return found.map((item) => decodeEntities(item).replace(/\s+/g, ' ').trim()).filter((item) => {
    const key = item.toLowerCase()
    if (item.length < 2 || item.length > 60 || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 30)
}

/** Paragraph text, for counting how often the story names a topic. */
export function bodyText(html: string): string {
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => text(match[1]!)).filter((line) => line.length > 40)
  return paragraphs.join(' ').slice(0, 60_000)
}

/** fromKeyword: the article tags itself with it; inText: its own paragraphs link to it; event: the outlet marks it a running story. */
export type TopicCandidate = { label: string; url: string; fromKeyword: boolean; inText?: boolean; event?: boolean }

/** Topic pages an article links to, and topic pages named by its keywords. */
export function articleTopics(html: string, pageUrl: string, outlet: OutletProfile, keywords = articleKeywords(html)): TopicCandidate[] {
  const base = new URL(pageUrl)
  const byUrl = new Map<string, TopicCandidate>()
  const topicUrl = (href: string): string | null => {
    let url: URL
    try { url = new URL(href, base) } catch { return null }
    return outlet.host.test(url.hostname) && outlet.topicPath.test(url.pathname) ? `https://${url.hostname}${url.pathname}` : null
  }
  // Links inside the story's own paragraphs ("the Chinese territory's courts" → China) are named by the text.
  const inText = new Set<string>()
  for (const paragraph of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    for (const anchor of anchors(paragraph[1]!)) {
      const key = topicUrl(anchor.href)
      if (key) inText.add(key)
    }
  }
  for (const anchor of anchors(html)) {
    const key = topicUrl(anchor.href)
    if (!key) continue
    const named = inText.has(key)
    const anchorText = text(anchor.inner).replace(/^(topics?|tags?)\s*:\s*/i, '').slice(0, 80)
    const fromSlug = slugLabel(new URL(key).pathname)
    // A link in the text reads "the Chinese territory's" for China: its address names it better, unless the words agree.
    const agrees = (): boolean => { const slugStems = new Set(stemsOf(fromSlug)); return stemsOf(anchorText).some((stem) => slugStems.has(stem)) }
    const label = named
      ? anchorText && anchorText.split(' ').length <= 5 && agrees() ? anchorText : fromSlug.split(' ').slice(0, 5).join(' ')
      : anchorText || fromSlug
    // Tag chips the outlet marks as the article's own: ABC's "Related topics" (data-component="Tag") and the
    // subject chip by its headline; NPR's class="tag tag--story". ABC's related-story cards carry SubjectTag chips too.
    const tagChip = /data-component\s*=\s*["']Tag["']/i.test(anchor.attrs)
      || /data-component\s*=\s*["']SubjectTag["']/i.test(anchor.attrs) && /ArticleHeadline/.test(anchor.attrs)
      || /class\s*=\s*["'][^"']*\btag--story\b/i.test(anchor.attrs)
    const existing = byUrl.get(key)
    if (!existing || !named && existing.label.length < label.length && label.length < 60) byUrl.set(key, { label, url: key, fromKeyword: tagChip || !!existing?.fromKeyword, ...(named ? { inText: true } : {}) })
    else if (tagChip) existing.fromKeyword = true
  }
  // Topics in the page's own data (BBC: "topics":[{"title","url","isEvent"}]) are the article's tags.
  for (const match of html.matchAll(/\\?"title\\?"\s*:\s*\\?"([^"\\]{2,80})\\?"\s*,\s*\\?"url\\?"\s*:\s*\\?"([^"\\]+)\\?"(?:\s*,\s*\\?"isEvent\\?"\s*:\s*(true|false))?/g)) {
    const key = topicUrl(match[2]!)
    if (!key) continue
    const label = decodeEntities(match[1]!)
    byUrl.set(key, { label, url: key, fromKeyword: true, ...(match[3] === 'true' ? { event: true } : {}) })
  }
  if (outlet.keywordPaths) {
    for (const keyword of keywords) {
      const slug = slugify(keyword)
      if (!slug) continue
      for (const path of outlet.keywordPaths(slug, keyword)) {
        const key = `https://${base.hostname}${path}`
        const existing = byUrl.get(key)
        if (existing) existing.fromKeyword = true
        else byUrl.set(key, { label: keyword, url: key, fromKeyword: true })
      }
    }
  }
  return [...byUrl.values()]
}

/** Section and format tags that describe how a story is told, not what it is about. */
const GENERIC_TOPICS = new Set(['news', 'video', 'videos', 'explainer', 'explainers', 'opinion', 'opinions', 'analysis', 'features', 'feature', 'world', 'world news', 'politics', 'world politics', 'economy', 'business', 'human rights', 'science and technology', 'podcast', 'podcasts', 'live', 'live blog', 'interview', 'interviews', 'in pictures', 'media', 'government', 'government and politics', 'elections', 'conflict', 'military', 'society', 'culture', 'health', 'environment', 'crime', 'law', 'courts', 'police', 'sport', 'sports', 'top stories', 'breaking news', 'cna explains', 'middle east', 'europe', 'asia', 'africa', 'americas', 'us & canada', 'us and canada', 'asia pacific', 'latin america', 'south america', 'north america', 'oceania', 'video', 'nocomment', 'the americas', 'war', 'wars', 'president', 'regulation', 'business and economy'])

/** An article's keywords that say what it is about, not where it is filed ("News", "Asia Pacific"). */
const storyKeywords = (keywords: string[]): string[] => keywords.filter((item) => !GENERIC_TOPICS.has(item.toLowerCase()))

const stemsOf = (value: string): string[] => [...terms(value).keys()]
/** Countries, their peoples and regions: shared by many stories, so they never tie a headline to this one alone. */
const COUNTRY_STEMS = new Set(COUNTRY_ROWS.filter((row) => !row[1].includes(' ')).flatMap((row) => stemsOf(row[1])))
const PLACES = new Set([
  ...COUNTRY_STEMS,
  ...stemsOf('palestine palestinian korea korean saudi arabia zealand lanka hong kong congo french british american chinese iranian iraqi turkish spanish italian polish greek dutch swiss irish filipino thai danish swedish finnish emirati qatari english scottish welsh european asian african arab western eastern northern southern asia europe africa america latin pacific middle east west north south global world international gulf'),
])
/** Common verbs the shared stop list keeps ("Does the ceasefire…", "What does the Kremlin…"): they tie nothing together. */
const FILLER = new Set(stemsOf('does doing done come comes coming came goes going gone gets getting make makes making made take takes taking took give gives giving gave tell tells telling show shows showing shown look looks looking want wants need needs keep keeps call calls back next ahead amid behind still'))
/** Offices and institutions ("transport minister", "court"): the same in every story about a country. */
const OFFICES = new Set(stemsOf('minister ministers president prime government court parliament party police army official officials state national congress senate'))

export type ScoredTopic = TopicCandidate & { score: number; specific: boolean }

/**
 * The topics the story is about: its own keywords, words of its headline, and
 * names its text repeats. Navigation links (site-wide tags) fail all three.
 * Story-specific tags rank above countries, so the thread stays on the story.
 */
export function chooseTopics(candidates: TopicCandidate[], headline: string, body: string, keywords: string[], limit = 2): ScoredTopic[] {
  const headlineStems = new Set(stemsOf(headline))
  const bodyLower = body.toLowerCase()
  const bodyStems = new Set(stemsOf(body))
  const keywordSet = new Set(keywords.map((item) => item.toLowerCase()))
  const scored: ScoredTopic[] = []
  for (const candidate of candidates) {
    const label = candidate.label.replace(/\s+/g, ' ').trim().replace(/[.,:;!?]+$/, '')
    const lower = label.toLowerCase()
    if (!label || GENERIC_TOPICS.has(lower) || /^\d+$/.test(lower)) continue
    const stems = stemsOf(label)
    if (!stems.length) continue
    // Short names the stems drop ("US Elections") must be in the story too, or "electoral" matches US elections.
    const story = `${headline} ${body}`
    const shortNames = label.match(/\b[A-Z]{2,3}\b/g) ?? []
    const tagged = keywordSet.has(lower) || candidate.fromKeyword
    if (!tagged && shortNames.some((name) => !new RegExp(`\\b${name}\\b`).test(story))) continue
    const inHeadline = stems.filter((stem) => headlineStems.has(stem)).length / stems.length
    const inBody = stems.filter((stem) => bodyStems.has(stem)).length / stems.length
    // Mentions of the whole name, or of its last long word ("Vucic" for "Former President Aleksandar Vucic").
    const count = (phrase: string): number => phrase.length >= 4 ? bodyLower.split(phrase).length - 1 : 0
    const last = stems.length > 1 ? lower.split(/[^\p{L}\d]+/u).filter((word) => word.length >= 5).pop() : undefined
    const mentions = Math.min(3, Math.max(count(lower), last ? count(last) : 0))
    const own = keywordSet.has(lower) || candidate.fromKeyword || !!candidate.inText
    const ownWeight = keywordSet.has(lower) || candidate.fromKeyword ? 3 : candidate.inText ? 2 : 0
    const specific = !isCountry(label) && stems.length >= 1 && !/^(united states|us|uk|eu)$/i.test(label)
    const score = ownWeight + inHeadline * 3 + inBody * 1.5 + mentions * 0.5 + (specific && (own || inHeadline > 0) ? 1 : 0)
    // A link the article does not tag itself with must be named by the headline or repeated in the text.
    if (!own && inHeadline < 0.5 && mentions < 2) continue
    if (score < 3) continue
    // Keywords and links written in lower case ("paraguay", "war in Ukraine") are names on screen.
    scored.push({ ...candidate, label: /^\p{Ll}+\b/u.test(label) ? label.replace(/^\p{L}/u, (c) => c.toUpperCase()) : label, score, specific })
  }
  // The article's own running-story tags ("US-Israel war on Iran") before its countries and broad subjects;
  // one its text merely links to ("US midterms" in a Ukraine story) must be named by the headline or score well.
  const storyTag = (topic: ScoredTopic): boolean => (topic.event || isStoryTag(topic.label))
    && (topic.fromKeyword || topic.score >= 6 || topic.label.split(/[^\p{L}\d]+/u).some((word) => !EVENT_WORDS.test(word) && stemsOf(word).some((stem) => headlineStems.has(stem) && !PLACES.has(stem))))
  scored.sort((a, b) => Number(storyTag(b)) - Number(storyTag(a)) || b.score - a.score)
  const out: ScoredTopic[] = []
  for (const topic of scored) {
    if (out.some((kept) => kept.url === topic.url || kept.label.toLowerCase() === topic.label.toLowerCase())) continue
    // "Iran" adds nothing beside "US-Israel war on Iran": its words are all in a topic already kept.
    const stems = stemsOf(topic.label)
    if (out.some((kept) => { const keptStems = new Set(stemsOf(kept.label)); return stems.every((stem) => keptStems.has(stem)) })) continue
    out.push(topic)
    if (out.length >= limit) break
  }
  return out
}

/** framed: read from the page's own list (its region was found), so a sidebar could not have supplied it. */
export type FoundHeadline = { title: string; url: string; date: string; dated: 'published' | 'seen'; framed?: boolean }

const DATE_IN_CARD = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i
const RELATIVE = /\b(\d{1,2})\s*(min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\s+ago\b/i

/** A date for one card: <time datetime>, written dates, then "3 hours ago" against the page date. */
export function cardDate(cardHtml: string, pageDate: string, dayFirst = false): string | null {
  const iso = cardHtml.match(/\bdatetime\s*=\s*["'](\d{4}-\d{2}-\d{2})/i)?.[1]
  if (iso) return iso
  const stamp = cardHtml.match(/\bdata-(?:lastupdated|timestamp|published|date)\s*=\s*["'](1\d{9})["']/i)?.[1]
  if (stamp) return new Date(Number(stamp) * 1000).toISOString().slice(0, 10)
  const plain = text(cardHtml)
  // Dotted dates are day first everywhere (DW's older cards: "26.08.2020").
  const numeric = plain.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/) ?? (dayFirst ? plain.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/) : null)
  if (numeric && Number(numeric[2]) <= 12 && Number(numeric[1]) <= 31) return `${numeric[3]}-${pad(numeric[2]!)}-${pad(numeric[1]!)}`
  const written = plain.match(DATE_IN_CARD)
  if (written) {
    const [day, month, year] = written[1] ? [written[1], written[2]!, written[3]!] : [written[5]!, written[4]!, written[6]!]
    const mm = MONTHS[month.slice(0, 3).toLowerCase()]
    if (mm && Number(day) >= 1 && Number(day) <= 31) return `${year}-${mm}-${pad(day)}`
  }
  const relative = plain.match(RELATIVE)
  if (relative) {
    const unit = relative[2]!.toLowerCase()
    const days = /^d/.test(unit) ? Number(relative[1]) : 0
    const at = new Date(`${pageDate}T12:00:00Z`)
    at.setUTCDate(at.getUTCDate() - days)
    return at.toISOString().slice(0, 10)
  }
  return null
}

const HEADING = /<(h[1-4])\b[^>]*>([\s\S]*?)<\/\1>|<[a-z]+\b[^>]*(?:data-testid|class)\s*=\s*["'][^"']*(?:headline|title)[^"']*["'][^>]*>([\s\S]*?)<\/[a-z]+>/i

/**
 * The part of a topic page that lists its own stories: the outlet's marked
 * region, else its <main> element, without <aside> blocks. Pages without the
 * markers (older layouts in the archive) are read whole.
 */
export function listRegion(html: string, outlet: OutletProfile): { page: string; framed: boolean } {
  let page = html
  let framed = false
  const region = outlet.region
  if (!region?.skipMain) {
    const start = page.search(/<main\b/i)
    const end = page.lastIndexOf('</main>')
    if (start >= 0 && end > start) { page = page.slice(start, end); framed = true }
  }
  if (region?.from) {
    const start = page.search(region.from)
    if (start >= 0) { page = page.slice(start); framed = true }
  }
  if (region?.to) {
    const end = page.search(region.to)
    if (end > 0) page = page.slice(0, end)
  }
  return { page: page.replace(/<aside\b[\s\S]*?<\/aside>/gi, ' '), framed }
}

/** Headline links on one capture of a topic page, with the best date each card gives. */
export function extractHeadlines(html: string, pageUrl: string, outlet: OutletProfile, pageDate: string): FoundHeadline[] {
  const base = new URL(pageUrl)
  const byPath = new Map<string, FoundHeadline>()
  const { page, framed } = listRegion(html.slice(0, 4_000_000), outlet)
  const links = anchors(page).map((anchor) => {
    let url: URL | null = null
    try { url = new URL(anchor.href.replace(/^https?:\/\/web\.archive\.org\/web\/\d+(id_)?\//, ''), base) } catch { /* not a link */ }
    return { anchor, url: url && outlet.host.test(url.hostname) && outlet.articlePath.test(url.pathname) ? url : null }
  })
  const starts = links.filter((link) => link.url).map((link) => link.anchor.end)
  for (const { anchor, url } of links) {
    if (!url) continue
    const heading = anchor.inner.match(HEADING)
    let title = text(heading ? heading[2] ?? heading[3] ?? '' : anchor.inner)
    // A card whose own heading is short ("Macau profile", "Macau media guide") is a guide, not a headline;
    // read whole, it would run into its date and summary.
    if (heading && (heading[1] || /data-testid\s*=\s*["'][^"']*headline/i.test(heading[0])) && title.split(' ').length < 4) continue
    if (title.split(' ').length < 4 || title.length < 20) title = text(anchor.inner)
    title = title.replace(/^(video|watch|live|analysis|explainer|opinion|exclusive|update[sd]?)\s*[:|-]\s*/i, '')
      // A date written after the headline in the same link (DW's older cards) is the card's date, not its title.
      .replace(/\s+\d{1,2}\.\d{1,2}\.\d{4}$/, '')
    if (title.split(' ').length < 4 || title.length < 20 || title.length > 220) continue
    const key = url.pathname.replace(/\/$/, '')
    // The card is the anchor plus what follows it up to the next headline link (where dates usually sit).
    const nextStart = starts.find((end) => end > anchor.end)
    const following = page.slice(anchor.end, Math.min(anchor.end + 1_500, nextStart ?? Infinity))
    const card = anchor.inner + following.slice(0, following.search(/<a\b[^>]*href=[^>]*>[^<]{25,}/i) >= 0 ? following.search(/<a\b[^>]*href=[^>]*>[^<]{25,}/i) : following.length)
    const published = outlet.pathDate?.(url.pathname) ?? cardDate(card, pageDate, outlet.dayFirst)
    const date = published && published <= pageDate ? published : pageDate
    const found: FoundHeadline = { title: title.slice(0, 200), url: `https://${url.hostname}${url.pathname}`, date, dated: published && published <= pageDate ? 'published' : 'seen', ...(framed ? { framed: true } : {}) }
    const existing = byPath.get(key)
    // Keep the clearest title (a heading over a teaser), and a published date over a seen one.
    if (!existing || existing.dated === 'seen' && found.dated === 'published' || existing.title.length > 150 && found.title.length < existing.title.length) byPath.set(key, existing ? { ...found, title: existing.title.length <= 150 ? existing.title : found.title } : found)
  }
  return [...byPath.values()]
}

/**
 * How closely an earlier headline tells the same story: words shared with the
 * current headline and the article's keywords, names counting double. Words
 * every headline on the page shares (the topic's own name) say little.
 * Anchors: shared headline words that are not a place or an office; the
 * topic's own name anchors (without scoring) when the headline names it too.
 */
export function storyOverlap(title: string, headline: string, keywords: string[], options: { ignore?: Set<string>; common?: Set<string> } = {}): { score: number; words: number; anchors: number } {
  const wanted = terms(`${headline} ${keywords.join(' ')}`)
  const inHeadline = terms(headline)
  let score = 0
  let words = 0
  let anchors = 0
  for (const [stem, weight] of terms(title)) {
    const want = wanted.get(stem)
    if (!want) continue
    const anchor = inHeadline.has(stem) && !PLACES.has(stem) && !OFFICES.has(stem) && !FILLER.has(stem)
    if (anchor) anchors += 1
    if (options.ignore?.has(stem)) continue
    words += 1
    // A name the page shares because the page follows this story ("Lamarre-Condon") is not halved.
    score += Math.max(want, weight) * (options.common?.has(stem) && !anchor ? 0.5 : 1)
  }
  return { score, words, anchors }
}

const EVENT_WORDS = /\b(wars?|conflict|crisis|elections?|midterms?|protests?|invasion|attacks?|ceasefire|talks|trial|summit|referendum|earthquake|floods?|hurricane|typhoon|cyclone|wildfires?|bushfires?|pandemic|outbreak|coup|siege|genocide|strikes?|shutdown|tariffs?|negotiations|deal|uprising|occupation|blockade|famine|drought|olympics|world cup|cop\d+)\b/i
const ACTORS = new Set(['us', 'uk', 'eu', 'un', 'nato', 'gaza', 'west bank', 'hamas', 'hezbollah', 'rsf', 'brexit'])

/**
 * A tag for one running story ("Sudan war", "US Midterm Elections 2026",
 * "War in Ukraine"), not a broad subject ("Banking", "Protests") or a country:
 * it names a place, actor or year and an event.
 */
export function isStoryTag(label: string): boolean {
  const lower = label.toLowerCase()
  if (!EVENT_WORDS.test(lower) || lower.split(/[\s-]+/).length < 2) return false
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean)
  // A country by name or by its people ("Israeli elections").
  const named = /\b(19|20)\d{2}\b/.test(lower) || [...COUNTRY_NAMES].some((country) => new RegExp(`\\b${country}\\b`).test(lower)) || stemsOf(label).some((stem) => COUNTRY_STEMS.has(stem))
    || words.some((word) => ACTORS.has(word)) || [...ACTORS].some((actor) => actor.includes(' ') && lower.includes(actor))
  return named
}

export type Relevance = 'story' | 'related' | 'unrelated'

/**
 * Sorts a page of earlier headlines: the same story (two or more telling
 * words in common, one of them a headline word that is not a place or an
 * office), related (shares a word with the topic or the story), or unrelated
 * (a sidebar's "most read" list).
 */
export function classifyHeadlines(titles: string[], headline: string, keywords: string[], topicLabels: string[], fromStoryTag: boolean[] = [], topicOf: number[] = []): Relevance[] {
  const ignore = new Set(topicLabels.flatMap(stemsOf))
  const ownTopic = topicLabels.map((label) => new Set(stemsOf(label)))
  const counts = new Map<string, number>()
  const each = titles.map((title) => new Set(stemsOf(title)))
  for (const stems of each) for (const stem of stems) counts.set(stem, (counts.get(stem) ?? 0) + 1)
  const common = new Set([...counts].filter(([, count]) => titles.length >= 8 && count / titles.length > 0.2).map(([stem]) => stem))
  const headlineStems = new Set(stemsOf(headline))
  const near = new Set([...ignore, ...headlineStems, ...keywords.flatMap(stemsOf)])
  return titles.map((title, index) => {
    // A headline's own topic page says nothing about it; the other topic's words still count.
    const overlap = storyOverlap(title, headline, keywords, { ignore: topicOf[index] !== undefined ? ownTopic[topicOf[index]!] ?? ignore : ignore, common })
    if (overlap.words >= 2 && overlap.score >= 3 && overlap.anchors >= 1) return 'story'
    const related = [...each[index]!].some((stem) => near.has(stem) && !FILLER.has(stem))
    // On the outlet's own page for this running story, a related headline is part of it when it shares a word
    // with the headline, or more than a place with the tag ("Gaza", "midterms"; not only "Israel" on the
    // Israel-Palestine page, where US politics and olive harvests are filed too).
    const told = [...each[index]!].some((stem) => !OFFICES.has(stem) && !FILLER.has(stem) && (headlineStems.has(stem) || near.has(stem) && !PLACES.has(stem)))
    return related ? fromStoryTag[index] && told ? 'story' : 'related' : 'unrelated'
  })
}

export function parseCdx(body: string): Array<{ timestamp: string; original: string }> {
  return body.split('\n').map((line) => line.trim().split(/\s+/)).filter((parts) => /^\d{14}$/.test(parts[0] ?? '') && parts[1]).map((parts) => ({ timestamp: parts[0]!, original: parts[1]! }))
}

// ── The service ──────────────────────────────────────────────────────────────

const ARCHIVE_SPACING_MS = 8_000
/** At most this many archive requests in any ten minutes (it refuses connections well before that pace is sustained). */
const ARCHIVE_WINDOW = { requests: 25, ms: 10 * 60_000 }
/** Bumped when reading pages changes, so captures read the old way are read again. */
const PARSER_VERSION = 4
/** Archive reads one "further back" may make in all (topic pages × skipped captures). */
const READS_PER_PAGE = 3
const ARCHIVE_PAUSE_MS = 5 * 60_000
/** The archive is asked as Intoponet; outlets' pages are read as the browser that shows them (some refuse anything else). */
const USER_AGENT = 'Intoponet/0.1 (+https://intoponet.com; The Olds outlet history)'
const BROWSER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Intoponet/0.1'
export const COVERAGE_NOTE = 'Earlier headlines from the outlet’s own topic pages, as saved by the Internet Archive’s Wayback Machine.'

class ArchiveBusy extends Error {}

type ArchiveStep = { topic: string; before: string }
type CoverageCursor = ArchiveStep[]

export function encodeCursor(steps: CoverageCursor): string | null {
  return steps.length ? steps.map((step) => `${step.topic}@${step.before}`).join(';') : null
}

export function decodeCursor(cursor: string | undefined): CoverageCursor | null {
  if (!cursor) return null
  const steps = cursor.split(';').map((part) => part.match(/^(\d)@(\d{4}-\d{2}-\d{2})$/)).filter((match): match is RegExpMatchArray => !!match)
  return steps.length ? steps.map((match) => ({ topic: match[1]!, before: match[2]! })) : null
}

type Article = { keywords: string[]; topics: ScoredTopic[]; at: number }
type Months = { rows: Array<{ timestamp: string; original: string }>; blocked: boolean; at: number }

export type OutletArchiveOptions = {
  cacheDir: string
  fetchImpl?: typeof fetch
  now?: () => number
  /** Wait between archive requests (tests make it 0). */
  spacingMs?: number
  sleep?: (ms: number) => Promise<void>
}

export class OutletArchive {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly spacing: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly articles = new Map<string, Promise<Article>>()
  private readonly livePages = new Map<string, { at: number; value: Promise<FoundHeadline[]> }>()
  private readonly months = new Map<string, Promise<Months>>()
  private readonly shown = new Map<string, Set<string>>()
  private archiveQueue: Promise<void> = Promise.resolve()
  private lastArchiveAt = 0
  private pausedUntil = 0
  private readonly recent: number[] = []

  constructor(private readonly options: OutletArchiveOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.now = options.now ?? Date.now
    this.spacing = options.spacingMs ?? ARCHIVE_SPACING_MS
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  /** One page of an outlet's coverage, newest first: the live topic pages, or (with a cursor) the next archive snapshots back. */
  async coverage(query: { url: string; headline: string; cursor?: string }): Promise<OldsCoverage> {
    const outlet = outletFor(query.url)
    const base = { note: COVERAGE_NOTE }
    if (!outlet) return { ...base, outlet: null, topics: [], items: [], cursor: null, status: 'unsupported' }
    // An article that cannot be read is an error (the reader can try again), not a story without topics.
    const article = await this.article(query.url, query.headline, outlet)
    if (!article.topics.length) return { ...base, outlet: { id: outlet.id, name: outlet.name }, topics: [], items: [], cursor: null, status: 'no-topics' }
    const topics: OldsCoverageTopic[] = article.topics.map((topic) => ({ label: topic.label, url: topic.url }))
    const current = new URL(query.url).pathname.replace(/\/$/, '')
    const steps = decodeCursor(query.cursor)
    // What this reader has already been shown of the thread, so going back skips pages that add nothing.
    const shownKey = `${query.url}|${query.headline}`
    if (!steps) this.shown.delete(shownKey)
    const shown = this.shown.get(shownKey) ?? new Set<string>([current])
    this.shown.delete(shownKey)
    this.shown.set(shownKey, shown)
    if (this.shown.size > 50) this.shown.delete(this.shown.keys().next().value!)
    const found: Array<FoundHeadline & { topic: number; archiveTimestamp: string | null }> = []
    const next: ArchiveStep[] = []
    let status: OldsCoverage['status'] = 'ok'

    if (!steps) {
      // First page: the outlet's live topic pages (no archive request), then where the archive should pick up.
      const today = new Date(this.now()).toISOString().slice(0, 10)
      await Promise.all(article.topics.map(async (topic, index) => {
        const live = await this.livePage(topic.url, outlet, today).catch(() => [] as FoundHeadline[])
        for (const item of live) found.push({ ...item, topic: index, archiveTimestamp: null })
        const oldest = live.filter((item) => item.dated === 'published').map((item) => item.date).sort()[0]
        next.push({ topic: String(index), before: oldest ?? today })
      }))
      // A live page that could not be read (or lists no dates): start from the archive's newest capture now.
      if (!found.length) {
        const first = await this.archiveSteps(article, outlet, next.splice(0), found, shown).catch((error: unknown) => { if (error instanceof ArchiveBusy) status = 'busy'; return [] as ArchiveStep[] })
        next.push(...first)
      }
    } else {
      const more = await this.archiveSteps(article, outlet, steps, found, shown).catch((error: unknown) => { if (error instanceof ArchiveBusy) status = 'busy'; return steps })
      next.push(...more)
    }

    const fresh: typeof found = []
    for (const item of found.sort((a, b) => b.date.localeCompare(a.date))) {
      const key = new URL(item.url).pathname.replace(/\/$/, '')
      // The same report filed twice (RFI: as a video and as a podcast) is shown once.
      const title = `title:${item.title.toLowerCase()}`
      if (shown.has(key) || shown.has(title)) continue
      shown.add(key)
      shown.add(title)
      fresh.push(item)
    }
    const storyTags = article.topics.map((topic) => !!topic.event || isStoryTag(topic.label))
    const keywords = storyKeywords(article.keywords)
    const relevance = classifyHeadlines(fresh.map((item) => item.title), query.headline, keywords, topics.map((topic) => topic.label), fresh.map((item) => storyTags[item.topic] ?? false), fresh.map((item) => item.topic))
    const items: OldsCoverageItem[] = []
    // A place's page (a country, a city) beside another topic ("Death Penalty" and "United States") gives
    // only the headlines that share something with this story, not all of that place's news.
    const broad = article.topics.map((topic) => isCountry(topic.label) || /^(us|uk|eu|united states)$/i.test(topic.label) || !!outlet.placePath?.test(new URL(topic.url).pathname))
    const narrowed = article.topics.length > 1
    fresh.forEach((item, index) => {
      // Off-topic headlines are dropped only from pages read whole, where a sidebar could have supplied them.
      if (relevance[index] === 'unrelated' && !item.framed) return
      if (narrowed && broad[item.topic] && relevance[index] !== 'story'
        && storyOverlap(item.title, query.headline, keywords, { ignore: new Set(stemsOf(topics[item.topic]?.label ?? '')) }).words === 0) return
      items.push({
        title: item.title,
        url: item.url,
        archiveUrl: `https://web.archive.org/web/${item.date.replace(/-/g, '')}/${item.url}`,
        date: item.date,
        dated: item.dated,
        topic: topics[item.topic]?.label ?? '',
        story: relevance[index] === 'story',
      })
    })
    // Every topic page's archive index refused us: the outlet has asked the archive to exclude it.
    if (status === 'ok' && !items.length && next.length === 0) {
      const lists = await Promise.all(article.topics.map((topic) => this.months.get(topic.url)?.catch(() => null) ?? Promise.resolve(null)))
      if (lists.length && lists.every((list) => list?.blocked)) status = 'blocked'
    }
    next.sort((a, b) => a.topic.localeCompare(b.topic))
    return { ...base, outlet: { id: outlet.id, name: outlet.name }, topics, items, cursor: encodeCursor(next), status }
  }

  /**
   * For each topic: the newest capture before its cursor, read; the next cursor is just before
   * its oldest headline. A capture that adds nothing new (an undated page that rarely changes)
   * is followed by one further back — 3, then 6 months — at most three reads per topic.
   */
  private async archiveSteps(article: Article, outlet: OutletProfile, steps: ArchiveStep[], found: Array<FoundHeadline & { topic: number; archiveTimestamp: string | null }>, shown: Set<string>): Promise<ArchiveStep[]> {
    const next: ArchiveStep[] = []
    let budget = READS_PER_PAGE
    for (const step of steps) {
      const index = Number(step.topic)
      const topic = article.topics[index]
      if (!topic) continue
      if (budget <= 0) { next.push(step); continue }
      const months = await this.monthList(topic.url, outlet)
      let before = step.before
      let resumeAt: string | null = step.before
      for (let read = 0; read < 3 && budget > 0; read += 1) {
        budget -= 1
        const capture = [...months.rows].reverse().find((row) => row.timestamp.slice(0, 8) < before.replace(/-/g, ''))
        if (!capture) { resumeAt = null; break }
        const captureDate = `${capture.timestamp.slice(0, 4)}-${capture.timestamp.slice(4, 6)}-${capture.timestamp.slice(6, 8)}`
        // A capture that cannot be played back is passed over, not retried forever.
        const headlines = await this.snapshot(capture.timestamp, capture.original, outlet, captureDate).catch((error: unknown) => {
          if (error instanceof ArchiveBusy) throw error
          return [] as FoundHeadline[]
        })
        for (const item of headlines) found.push({ ...item, topic: index, archiveTimestamp: capture.timestamp })
        // Pick up again before the oldest dated headline here (pages keep a backlog), or before this capture.
        const oldest = headlines.filter((item) => item.dated === 'published' && item.date < captureDate).map((item) => item.date).sort()[0]
        resumeAt = oldest && oldest < before ? oldest : captureDate
        const added = headlines.some((item) => !shown.has(new URL(item.url).pathname.replace(/\/$/, '')))
        if (added) break
        before = monthsBefore(captureDate, read === 0 ? 3 : 6)
        resumeAt = before
      }
      if (resumeAt && months.rows.some((row) => row.timestamp.slice(0, 8) < resumeAt!.replace(/-/g, ''))) next.push({ topic: step.topic, before: resumeAt })
    }
    return next
  }

  private article(url: string, headline: string, outlet: OutletProfile): Promise<Article> {
    const key = `${url}|${headline}`
    const cached = this.articles.get(key)
    if (cached) return cached
    const value = (async (): Promise<Article> => {
      const html = await this.fetchText(url, 15_000)
      const keywords = articleKeywords(html)
      const topics = chooseTopics(articleTopics(html, url, outlet, keywords), headline, bodyText(html), keywords)
      return { keywords, topics, at: this.now() }
    })()
    this.articles.set(key, value)
    value.catch(() => this.articles.delete(key))
    if (this.articles.size > 200) this.articles.delete(this.articles.keys().next().value!)
    return value
  }

  private livePage(url: string, outlet: OutletProfile, today: string): Promise<FoundHeadline[]> {
    const cached = this.livePages.get(url)
    if (cached && this.now() - cached.at < 15 * 60_000) return cached.value
    const value = this.fetchText(url, 15_000).then((html) => extractHeadlines(html, url, outlet, today))
    this.livePages.set(url, { at: this.now(), value })
    value.catch(() => this.livePages.delete(url))
    return value
  }

  /** The first good capture of each month of a topic page (cached a day; the current month changes). */
  private monthList(pageUrl: string, outlet: OutletProfile): Promise<Months> {
    const cached = this.months.get(pageUrl)
    if (cached) return cached
    const value = (async (): Promise<Months> => {
      const file = this.cacheFile('months', pageUrl)
      const stored = await readFile(file, 'utf8').then((raw) => JSON.parse(raw) as Months).catch(() => null)
      if (stored && this.now() - stored.at < 24 * 3_600_000) return stored
      const hosts = [new URL(pageUrl).hostname, ...(outlet.alternateHosts ?? []).filter((host) => host !== new URL(pageUrl).hostname)]
      let rows: Months['rows'] = []
      let blocked = false
      for (const host of hosts) {
        const page = new URL(pageUrl)
        page.hostname = host
        const cdx = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(page.toString().replace(/^https?:\/\//, ''))}&fl=timestamp,original,statuscode&collapse=timestamp:6&filter=statuscode:200`
        const response = await this.archiveFetch(cdx, 65_000)
        if (response.status === 403) { blocked = true; continue }
        if (!response.ok) throw new Error(`Archive index ${response.status}`)
        rows = [...rows, ...parseCdx(await response.text())]
        if (rows.length >= 3) break
      }
      rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      const result = { rows, blocked: blocked && !rows.length, at: this.now() }
      await this.store(file, result)
      return result
    })()
    this.months.set(pageUrl, value)
    value.catch(() => this.months.delete(pageUrl))
    return value
  }

  /** One capture's headlines. A capture never changes, so it is read once and kept. */
  private async snapshot(timestamp: string, original: string, outlet: OutletProfile, captureDate: string): Promise<FoundHeadline[]> {
    const file = this.cacheFile('snapshot', `v${PARSER_VERSION}|${outlet.id}|${timestamp}|${original}`)
    const stored = await readFile(file, 'utf8').then((raw) => JSON.parse(raw) as FoundHeadline[]).catch(() => null)
    if (stored) return stored
    const response = await this.archiveFetch(`https://web.archive.org/web/${timestamp}id_/${original}`, 30_000)
    if (!response.ok) throw new Error(`Archive capture ${response.status}`)
    const html = await decodeBody(response)
    const headlines = extractHeadlines(html, original, outlet, captureDate)
    await this.store(file, headlines)
    return headlines
  }

  /** Archive requests go one at a time, a few seconds apart; a refusal pauses them for five minutes. */
  private archiveFetch(url: string, timeoutMs: number): Promise<Response> {
    const run = this.archiveQueue.then(async () => {
      if (this.now() < this.pausedUntil) throw new ArchiveBusy('The archive is busy.')
      while (this.recent.length && this.recent[0]! < this.now() - ARCHIVE_WINDOW.ms) this.recent.shift()
      if (this.recent.length >= ARCHIVE_WINDOW.requests) throw new ArchiveBusy('Resting between archive requests.')
      const wait = this.lastArchiveAt + this.spacing - this.now()
      if (wait > 0) await this.sleep(wait)
      this.lastArchiveAt = this.now()
      this.recent.push(this.lastArchiveAt)
      let response: Response
      try {
        response = await this.fetchImpl(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
      } catch (error) {
        if (!(error instanceof Error && error.name === 'TimeoutError')) this.pausedUntil = this.now() + ARCHIVE_PAUSE_MS
        throw new ArchiveBusy(error instanceof Error ? error.message : 'The archive could not be reached.')
      }
      // 504 is one slow query (the caller passes over that capture); 429 and 503 are the archive asking us to stop.
      if ([429, 503].includes(response.status)) {
        this.pausedUntil = this.now() + ARCHIVE_PAUSE_MS
        throw new ArchiveBusy(`The archive is busy (${response.status}).`)
      }
      return response
    })
    this.archiveQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private async fetchText(url: string, timeoutMs: number): Promise<string> {
    const response = await this.fetchImpl(url, { headers: { 'user-agent': BROWSER_AGENT, accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
    if (!response.ok) throw new Error(`${response.status}`)
    return decodeBody(response)
  }

  private cacheFile(kind: string, key: string): string {
    return join(this.options.cacheDir, 'outlet-archive', `${kind}-${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`)
  }

  private async store(file: string, value: unknown): Promise<void> {
    await mkdir(join(this.options.cacheDir, 'outlet-archive'), { recursive: true }).catch(() => undefined)
    await writeFile(file, JSON.stringify(value)).catch(() => undefined)
  }
}

function monthsBefore(date: string, months: number): string {
  const at = new Date(`${date}T12:00:00Z`)
  at.setUTCMonth(at.getUTCMonth() - months)
  return at.toISOString().slice(0, 10)
}

/** The page text in its declared character set (older captures are often Latin-1), at most 5 MB. */
async function decodeBody(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer()).subarray(0, 5_000_000)
  const declared = response.headers.get('content-type')?.match(/charset=([\w-]+)/i)?.[1]
    ?? new TextDecoder('latin1').decode(bytes.subarray(0, 2048)).match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1]
  try { return new TextDecoder(declared?.toLowerCase() || 'utf-8').decode(bytes) } catch { return new TextDecoder('utf-8').decode(bytes) }
}
