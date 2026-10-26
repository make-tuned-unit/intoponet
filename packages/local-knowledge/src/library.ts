export const privateLibrarySchema = 'intoponet.private-library.v1' as const

export type AbsorbRecord = {
  id: string
  url: string
  title: string
  excerpt: string
  topic: string
  absorbedAt: string
  citationUrl: string
  citationTitle: string
}

export type StoredBookmark = {
  url: string
  title: string
  topic: string
  savedAt: string
  note?: string
  fieldAnchor?: StoredFieldAnchor
}

export type StoredFieldAnchor = {
  lat: number
  lon: number
  label: string
}

export type StoredCollection = {
  id: string
  label: string
  createdAt: string
  memberUrls: string[]
}

export type StoredRecent = {
  url: string
  title: string
  visitedAt: string
}

export type PrivateLibraryDocument = {
  schema: typeof privateLibrarySchema
  bookmarks: StoredBookmark[]
  collections: StoredCollection[]
  recents: StoredRecent[]
  absorbed: AbsorbRecord[]
}

const sensitiveHosts = [
  'paypal.com',
  'wellsfargo.com',
  'chase.com',
  'bankofamerica.com',
  'hsbc.com',
  'patient.info',
  'mychart.com',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function httpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//.test(value) && value.length <= 8_192
}

function fieldAnchorFrom(value: unknown): StoredFieldAnchor | null {
  if (!isRecord(value)) return null
  const { lat, lon, label } = value
  if (
    typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180 ||
    typeof label !== 'string' || label.length > 160 || label.trim().length === 0
  ) return null
  return { lat, lon, label: label.trim() }
}

export function isSensitiveUrl(value: string): boolean {
  let host = ''
  try {
    host = new URL(value).hostname.toLowerCase()
  } catch {
    return true
  }
  if (sensitiveHosts.some((item) => host === item || host.endsWith(`.${item}`))) return true
  return /(^|\.)((bank|banking|clinic|hospital|healthcare|health|wallet|brokerage))(\.|$)/.test(host)
}

export function absorbPage(input: {
  url: string
  title: string
  excerpt: string
  topic: string
  now?: string
}): AbsorbRecord | { error: string } {
  if (!httpUrl(input.url)) return { error: 'Only an HTTP or HTTPS page can be absorbed.' }
  if (isSensitiveUrl(input.url)) {
    return { error: 'Banking, health, and account pages are not absorbed.' }
  }
  const excerpt = input.excerpt.replace(/\s+/g, ' ').trim()
  if (excerpt.length < 8 || excerpt.length > 2_000) {
    return { error: 'Write a short excerpt you want to keep. It stays on this device.' }
  }
  const title = input.title.trim() || input.url
  return {
    id: `absorb-${input.url}`,
    url: input.url,
    title: title.slice(0, 180),
    excerpt,
    topic: input.topic.trim() || 'Open knowledge',
    absorbedAt: input.now ?? new Date().toISOString(),
    citationUrl: input.url,
    citationTitle: title.slice(0, 180),
  }
}

export function searchAbsorbed(records: AbsorbRecord[], query: string): AbsorbRecord[] {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 1)
  if (terms.length === 0) return records
  return records.filter((record) => {
    const haystack = `${record.title} ${record.excerpt} ${record.topic} ${record.citationTitle}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}

function bookmarksFrom(value: unknown): StoredBookmark[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): StoredBookmark[] => {
    if (!isRecord(item) || !httpUrl(item['url'])) return []
    if (typeof item['title'] !== 'string' || typeof item['topic'] !== 'string') return []
    if (typeof item['savedAt'] !== 'string') return []
    const note = item['note']
    if (note !== undefined && (typeof note !== 'string' || note.length > 500)) return []
    const rawFieldAnchor = item['fieldAnchor']
    const fieldAnchor = rawFieldAnchor === undefined ? undefined : fieldAnchorFrom(rawFieldAnchor)
    if (rawFieldAnchor !== undefined && !fieldAnchor) return []
    return [
      {
        url: item['url'],
        title: item['title'].slice(0, 180),
        topic: item['topic'].slice(0, 80),
        savedAt: item['savedAt'],
        ...(typeof note === 'string' ? { note } : {}),
        ...(fieldAnchor ? { fieldAnchor } : {}),
      },
    ]
  })
}

function collectionsFrom(value: unknown): StoredCollection[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): StoredCollection[] => {
    if (!isRecord(item) || typeof item['id'] !== 'string' || typeof item['label'] !== 'string') return []
    if (typeof item['createdAt'] !== 'string' || !Array.isArray(item['memberUrls'])) return []
    const memberUrls = item['memberUrls'].filter(httpUrl)
    return [
      {
        id: item['id'].slice(0, 80),
        label: item['label'].slice(0, 80),
        createdAt: item['createdAt'],
        memberUrls,
      },
    ]
  })
}

function recentsFrom(value: unknown): StoredRecent[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): StoredRecent[] => {
    if (!isRecord(item) || !httpUrl(item['url'])) return []
    if (typeof item['title'] !== 'string' || typeof item['visitedAt'] !== 'string') return []
    return [
      {
        url: item['url'],
        title: item['title'].slice(0, 180),
        visitedAt: item['visitedAt'],
      },
    ]
  })
}

function absorbedFrom(value: unknown): AbsorbRecord[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): AbsorbRecord[] => {
    if (!isRecord(item) || !httpUrl(item['url']) || !httpUrl(item['citationUrl'])) return []
    if (isSensitiveUrl(item['url'])) return []
    if (typeof item['excerpt'] !== 'string' || item['excerpt'].length > 2_000) return []
    if (typeof item['title'] !== 'string' || typeof item['id'] !== 'string') return []
    return [
      {
        id: item['id'].slice(0, 200),
        url: item['url'],
        title: item['title'].slice(0, 180),
        excerpt: item['excerpt'],
        topic: typeof item['topic'] === 'string' ? item['topic'].slice(0, 80) : 'Open knowledge',
        absorbedAt: typeof item['absorbedAt'] === 'string' ? item['absorbedAt'] : '',
        citationUrl: item['citationUrl'],
        citationTitle:
          typeof item['citationTitle'] === 'string' ? item['citationTitle'].slice(0, 180) : item['title'],
      },
    ]
  })
}

export function emptyPrivateLibrary(): PrivateLibraryDocument {
  return {
    schema: privateLibrarySchema,
    bookmarks: [],
    collections: [],
    recents: [],
    absorbed: [],
  }
}

export function parsePrivateLibrary(raw: string): PrivateLibraryDocument | null {
  try {
    const value = JSON.parse(raw) as unknown
    if (!isRecord(value) || value['schema'] !== privateLibrarySchema) return null
    return {
      schema: privateLibrarySchema,
      bookmarks: bookmarksFrom(value['bookmarks']),
      collections: collectionsFrom(value['collections']),
      recents: recentsFrom(value['recents']),
      absorbed: absorbedFrom(value['absorbed']),
    }
  } catch {
    return null
  }
}

export function serializePrivateLibrary(library: PrivateLibraryDocument): string {
  return JSON.stringify(parsePrivateLibrary(JSON.stringify(library)) ?? emptyPrivateLibrary())
}
