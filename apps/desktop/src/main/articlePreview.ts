import { lookup } from 'node:dns/promises'
import { isIconHost } from './faviconCache'
import { isPrivateAddress } from './publicAddress'

/**
 * What a news article says about itself (Open Graph, article: tags and JSON-LD), for the
 * sources carousel: its main image, outlet, title, writers, dates and a summary.
 * Pages are fetched without cookies; images reach the app only as small data URLs.
 */
export type ArticlePreview = {
  url: string
  title: string | null
  siteName: string | null
  description: string | null
  image: string | null
  imageAlt: string | null
  authors: string[]
  publishedAt: string | null
  modifiedAt: string | null
  section: string | null
  keywords: string[]
  readingMinutes: number | null
  lang: string | null
  live: boolean
  /** The page says it is not free to read (isAccessibleForFree: false). */
  paywalled: boolean
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const value = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : match
    }
    return ENTITIES[code.toLowerCase()] ?? match
  })
}

const clean = (value: unknown, limit = 400): string | null => {
  if (typeof value !== 'string') return null
  const text = decodeEntities(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, limit) : null
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of tag.matchAll(/([a-zA-Z_:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    out[match[1]!.toLowerCase()] = match[3] ?? match[4] ?? match[5] ?? ''
  }
  return out
}

function absolute(value: string | null, base: string): string | null {
  if (!value) return null
  try {
    const url = new URL(decodeEntities(value.trim()), base)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

type Json = Record<string, unknown>
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])

/** Article-like objects in JSON-LD, including inside @graph. */
function jsonLdArticles(html: string): Json[] {
  const found: Json[] = []
  for (const match of html.matchAll(/<script[^>]+type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown
    try {
      data = JSON.parse(match[1]!.trim())
    } catch {
      continue
    }
    const queue = asArray(data)
    while (queue.length && found.length < 10) {
      const item = queue.shift()
      if (!item || typeof item !== 'object') continue
      const node = item as Json
      queue.push(...asArray(node['@graph']))
      const types = asArray(node['@type']).map(String)
      if (types.some((type) => /Article|BlogPosting|LiveBlogPosting|Report/i.test(type))) found.push(node)
    }
  }
  return found
}

function names(value: unknown): string[] {
  return asArray(value).flatMap((item) => {
    if (typeof item === 'string') return [item]
    if (item && typeof item === 'object' && typeof (item as Json)['name'] === 'string') return [(item as Json)['name'] as string]
    return []
  })
}

function imageOf(value: unknown): string | null {
  for (const item of asArray(value)) {
    if (typeof item === 'string') return item
    if (item && typeof item === 'object') {
      const url = (item as Json)['url'] ?? (item as Json)['contentUrl']
      if (typeof url === 'string') return url
    }
  }
  return null
}

const isoDate = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

/** A writer's name, not a profile link, outlet or placeholder. */
function personName(value: string): string | null {
  const text = clean(value, 80)
  if (!text || /^https?:/i.test(text) || /@|\bstaff\b|\bredac|\bredaç|^admin$/i.test(text) || text.length < 3) return null
  return text.replace(/^(by|por|par|von|di|door|af|av)\s+/i, '').slice(0, 60)
}

/** Section values that name no section. */
const NO_SECTION = /^(uncategori[sz]ed|sin categor[ií]a|sem categoria|non class[ée]e?|default|none|null|undefined|article|articles|post|posts|home|index|page)$/i

/**
 * A section name a reader can read on a card chip ("Monde", "America latina"): the first of several,
 * a feed's slug as words ("america-latina", "world_news"), a lowercase name capitalised. Ids,
 * numbers and placeholders ("uncategorized") are no section.
 */
export function sectionLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let text = clean(value.split(/\s*[,|;/]\s*/).find((part) => part.trim()), 80)
  if (!text) return null
  // One word with no spaces and a run of digits is an id ("sec-48213", "a1029"), not a name.
  if (/^\S+$/.test(text) && /\d{3}/.test(text)) return null
  if (text === text.toLowerCase() && !/\s/.test(text)) text = text.replace(/[-_.+]+/g, ' ').trim()
  if (!/\p{L}{2}/u.test(text) || NO_SECTION.test(text)) return null
  if (text === text.toLowerCase()) text = text.charAt(0).toLocaleUpperCase() + text.slice(1)
  return text.slice(0, 40)
}

/** Outlets often fall back to their logo or a stock placeholder: those say nothing about the story. */
export function storyImage(url: string | null): string | null {
  if (!url) return null
  const path = url.toLowerCase().split('?')[0]!
  return /(logo|placeholder|default[-_]?(image|og|share)?|fallback|og[-_]?default|share[-_]?default|social[-_]?share|blank)[^/]*\.(png|jpe?g|webp|gif|svg)$/.test(path) || /\/(logos?|brand|icons?)\//.test(path) || path.endsWith('.svg') ? null : url
}

export function parseArticlePreview(html: string, pageUrl: string): ArticlePreview {
  const head = html.slice(0, 600_000)
  const meta = new Map<string, string[]>()
  for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0])
    const key = (attrs['property'] ?? attrs['name'] ?? attrs['itemprop'] ?? '').toLowerCase()
    const content = attrs['content']
    if (!key || content === undefined) continue
    meta.set(key, [...(meta.get(key) ?? []), content])
  }
  const first = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = meta.get(key)?.find((item) => item.trim())
      if (value) return value
    }
    return null
  }
  const articles = jsonLdArticles(head)
  const ld = (key: string): unknown => articles.map((item) => item[key]).find((value) => value !== undefined && value !== null && value !== '')
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null

  // Bylines live in many places: JSON-LD, meta tags of several dialects, or a rel="author" link.
  const relAuthors = [...head.matchAll(/<a\b[^>]*\brel\s*=\s*["']?author\b[^>]*>([\s\S]{1,200}?)<\/a>/gi)].map((match) => match[1]!)
  const authorNames = [
    ...names(ld('author')),
    ...names(ld('creator')),
    ...(meta.get('author') ?? []),
    ...(meta.get('article:author') ?? []),
    ...(meta.get('parsely-author') ?? []),
    ...(meta.get('sailthru.author') ?? []),
    ...(meta.get('dc.creator') ?? []),
    ...(meta.get('dcterms.creator') ?? []),
    ...(meta.get('byl') ?? []),
    ...(meta.get('cxenseparse:author') ?? []),
    ...(meta.get('twitter:creator') ?? []).filter((name) => !name.startsWith('@')),
    ...relAuthors,
  ]
  // Last resort: a byline element in the page itself (not a photo credit or an author bio).
  if (!authorNames.length) {
    for (const match of html.slice(0, 900_000).matchAll(/<(\w+)\b[^>]*\bclass\s*=\s*["']([^"']*)["'][^>]*>([\s\S]{1,300}?)<\/\1>/gi)) {
      const classes = match[2]!.toLowerCase()
      if (!/(^|[\s_-])(byline|author|authors|writer|reporter|journalist)s?($|[\s_-])/.test(classes) || /(picture|photo|image|img|avatar|bio|caption|credit|label|title|icon)/.test(classes)) continue
      const text = clean(match[3], 120)
      if (text && text.length <= 80) authorNames.push(text)
      if (authorNames.length >= 2) break
    }
  }
  const authors: string[] = []
  for (const raw of authorNames) {
    for (const part of raw.split(/\s*(?:,|;|\band\b|\by\b|\bet\b|\be\b|\bund\b)\s*/i)) {
      const name = personName(part)
      if (name && !authors.some((known) => known.toLowerCase() === name.toLowerCase())) authors.push(name)
    }
    if (authors.length >= 3) break
  }

  const wordCount = Number(ld('wordCount'))
  const keywordsRaw = ld('keywords') ?? first('keywords', 'news_keywords')
  const keywords = (Array.isArray(keywordsRaw) ? keywordsRaw.map(String) : typeof keywordsRaw === 'string' ? keywordsRaw.split(',') : [])
    .map((word) => clean(word, 40)).filter((word): word is string => !!word).slice(0, 5)
  const types = articles.flatMap((item) => asArray(item['@type']).map(String))
  const free = ld('isAccessibleForFree')

  return {
    url: pageUrl,
    title: clean(first('og:title', 'twitter:title') ?? (ld('headline') as string | undefined) ?? titleTag, 300),
    siteName: clean(first('og:site_name', 'application-name') ?? names(ld('publisher'))[0], 80),
    description: clean(first('og:description', 'twitter:description', 'description') ?? ld('description'), 400),
    image: storyImage(absolute(first('og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src') ?? imageOf(ld('image')), pageUrl)),
    imageAlt: clean(first('og:image:alt', 'twitter:image:alt'), 200),
    authors,
    publishedAt: isoDate(first('article:published_time', 'datepublished', 'pubdate', 'publish-date', 'date') ?? ld('datePublished')),
    modifiedAt: isoDate(first('article:modified_time', 'og:updated_time', 'datemodified') ?? ld('dateModified')),
    section: sectionLabel(first('article:section') ?? asArray(ld('articleSection'))[0]),
    keywords,
    readingMinutes: Number.isFinite(wordCount) && wordCount > 50 ? Math.max(1, Math.round(wordCount / 230)) : null,
    lang: clean(head.match(/<html[^>]*\blang\s*=\s*["']?([a-zA-Z-]{2,12})/i)?.[1], 12),
    live: types.some((type) => /LiveBlogPosting/i.test(type)) || /^(live|en direct|en vivo|ao vivo|live-ticker|liveblog)\b/i.test(clean(first('og:title'), 40) ?? ''),
    paywalled: free === false || free === 'False' || free === 'false',
  }
}

const PAGE_BYTES = 700_000
const IMAGE_BYTES = 4_000_000
const CACHE_MS = 6 * 3_600_000
const CONCURRENCY = 4
const MAX_REDIRECTS = 5
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
/** A desktop browser's request, without cookies: some outlets refuse unknown clients. */
const HEADERS = {
  accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
  'accept-language': 'en;q=0.9,*;q=0.5',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
}

export function previewableUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && isIconHost(parsed.hostname)
  } catch {
    return false
  }
}

async function readCapped(response: Response, limit: number): Promise<Buffer | null> {
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > limit * 4) return null
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
    if (total >= limit) {
      void reader.cancel().catch(() => undefined)
      break
    }
  }
  return Buffer.concat(chunks)
}

export type ImageShrinker = (bytes: Buffer, mime: string) => { data: Buffer; mime: string } | null

/** A hostname's addresses (all of them), for the public-address check. */
export type ResolveHost = (hostname: string) => Promise<string[]>

const resolveHost: ResolveHost = async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((result) => result.address)

export class ArticlePreviews {
  private readonly cache = new Map<string, { preview: ArticlePreview | null; at: number }>()
  private readonly inflight = new Map<string, Promise<ArticlePreview | null>>()
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly shrink: ImageShrinker, private readonly fetchImpl: typeof fetch = fetch, private readonly resolve: ResolveHost = resolveHost) {}

  get(url: string): Promise<ArticlePreview | null> {
    if (!previewableUrl(url)) return Promise.resolve(null)
    const cached = this.cache.get(url)
    if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.preview)
    const running = this.inflight.get(url)
    if (running) return running
    const job = this.slot(() => this.load(url)).then((preview) => {
      this.cache.set(url, { preview, at: Date.now() })
      if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value!)
      return preview
    }).finally(() => this.inflight.delete(url))
    this.inflight.set(url, job)
    return job
  }

  private async slot<T>(run: () => Promise<T>): Promise<T> {
    if (this.active >= CONCURRENCY) await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.active += 1
    try {
      return await run()
    } finally {
      this.active -= 1
      this.waiting.shift()?.()
    }
  }

  /** A public web address whose name resolves only to public addresses (not this Mac or the local network). */
  private async isPublic(url: string): Promise<boolean> {
    if (!previewableUrl(url)) return false
    try {
      const addresses = await this.resolve(new URL(url).hostname)
      return addresses.length > 0 && !addresses.some(isPrivateAddress)
    } catch {
      return false
    }
  }

  /**
   * Fetch, following redirects one hop at a time so each address is checked: a feed item or an
   * og:image must not lead the main process to a router page or a service on this Mac.
   */
  private async fetchPublic(url: string, init: RequestInit): Promise<{ response: Response; url: string } | null> {
    let current = url
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!(await this.isPublic(current))) return null
      const response = await this.fetchImpl(current, { ...init, redirect: 'manual' })
      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel().catch(() => undefined)
        const location = response.headers.get('location')
        if (!location) return null
        try {
          current = new URL(location, current).toString()
        } catch {
          return null
        }
        continue
      }
      // A transport that followed redirects anyway: its final address must pass the same check.
      const final = response.url || current
      if (response.type === 'opaqueredirect' || (final !== current && !(await this.isPublic(final)))) {
        await response.body?.cancel().catch(() => undefined)
        return null
      }
      return { response, url: final }
    }
    return null
  }

  private async load(url: string): Promise<ArticlePreview | null> {
    try {
      const fetched = await this.fetchPublic(url, { credentials: 'omit', signal: AbortSignal.timeout(8_000), headers: HEADERS })
      if (!fetched) return null
      const { response } = fetched
      if (!response.ok || !/html/i.test(response.headers.get('content-type') ?? 'text/html')) return null
      const bytes = await readCapped(response, PAGE_BYTES)
      if (!bytes) return null
      const charset = /charset=["']?([\w-]+)/i.exec(response.headers.get('content-type') ?? '')?.[1]
        ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(bytes.subarray(0, 4096).toString('latin1'))?.[1]
        ?? 'utf-8'
      let html: string
      try {
        html = new TextDecoder(charset.toLowerCase()).decode(bytes)
      } catch {
        html = bytes.toString('utf8')
      }
      const preview = parseArticlePreview(html, fetched.url)
      preview.url = url
      preview.image = preview.image ? await this.image(preview.image) : null
      return preview
    } catch {
      return null
    }
  }

  private async image(url: string): Promise<string | null> {
    try {
      const fetched = await this.fetchPublic(url, { credentials: 'omit', signal: AbortSignal.timeout(8_000), headers: { ...HEADERS, accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5' } })
      if (!fetched) return null
      const { response } = fetched
      if (!response.ok) return null
      const mime = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
      if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(mime)) return null
      const bytes = await readCapped(response, IMAGE_BYTES)
      if (!bytes || bytes.byteLength >= IMAGE_BYTES) return null
      const small = this.shrink(bytes, mime)
      if (!small) return null
      return `data:${small.mime};base64,${small.data.toString('base64')}`
    } catch {
      return null
    }
  }
}
