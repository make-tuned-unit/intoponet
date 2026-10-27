import type { WikiNewsItem } from '../../shared/news/newsDigest'

/**
 * Wikipedia's "In the news": a short list of major current stories chosen by
 * Wikipedia editors, each with its main article. CC BY-SA 4.0; text is
 * attributed and linked. Fetched from the public REST feed in the main process.
 */
const USER_AGENT = 'Intoponet/0.1 (+https://github.com/make-tuned-unit/intoponet; In the news)'

function decode(text: string): string {
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
}

/** One featured-feed news entry → plain text, its date note and its main (bold) article. */
export function parseNewsEntry(entry: unknown): WikiNewsItem | null {
  if (typeof entry !== 'object' || entry === null) return null
  const value = entry as { story?: unknown; links?: unknown }
  if (typeof value.story !== 'string') return null
  const date = value.story.match(/^<!--\s*([^>]{1,20}?)\s*-->/)?.[1] ?? null
  const story = decode(value.story.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim().slice(0, 400)
  const bold = value.story.match(/<b[^>]*>[\s\S]*?<a[^>]*title="([^"]+)"/)?.[1]
  const links = (Array.isArray(value.links) ? value.links : []).flatMap((link): Array<{ title: string; url: string }> => {
    if (typeof link !== 'object' || link === null) return []
    const l = link as { normalizedtitle?: unknown; title?: unknown; content_urls?: { desktop?: { page?: unknown } } }
    const title = typeof l.normalizedtitle === 'string' ? l.normalizedtitle : typeof l.title === 'string' ? l.title.replace(/_/g, ' ') : null
    const url = l.content_urls?.desktop?.page
    return title && typeof url === 'string' && url.startsWith('https://en.wikipedia.org/') ? [{ title: title.slice(0, 200), url }] : []
  }).slice(0, 5)
  if (!story) return null
  return { date, story, mainTitle: bold ? decode(bold).slice(0, 200) : links[0]?.title ?? null, links }
}

export async function fetchInTheNews(now: Date, fetchImpl: typeof fetch = fetch): Promise<WikiNewsItem[]> {
  // Today's feed carries "In the news"; fall back to yesterday's (UTC) when it doesn't yet.
  for (const offset of [0, 1]) {
    const day = new Date(now.getTime() - offset * 86_400_000)
    const path = `${day.getUTCFullYear()}/${String(day.getUTCMonth() + 1).padStart(2, '0')}/${String(day.getUTCDate()).padStart(2, '0')}`
    const response = await fetchImpl(`https://en.wikipedia.org/api/rest_v1/feed/featured/${path}`, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) continue
    const payload = await response.json() as { news?: unknown[] }
    const items = (payload.news ?? []).map(parseNewsEntry).filter((item): item is WikiNewsItem => item !== null)
    if (items.length) return items.slice(0, 8)
  }
  return []
}
