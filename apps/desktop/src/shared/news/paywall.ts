/**
 * Paywalls: which outlets restrict reading, so the app can point to free
 * coverage of the same story. Nothing here gets around a paywall; it only
 * labels outlets and finds other sources.
 */

/** Outlets with hard or metered paywalls on most news articles (host suffixes). */
export const KNOWN_PAYWALLED = [
  'nytimes.com', 'wsj.com', 'ft.com', 'washingtonpost.com', 'economist.com', 'bloomberg.com', 'theatlantic.com', 'newyorker.com',
  'thetimes.co.uk', 'telegraph.co.uk', 'thetimes.com', 'theglobeandmail.com', 'latimes.com', 'bostonglobe.com', 'barrons.com',
  'businessinsider.com', 'wired.com', 'foreignpolicy.com', 'foreignaffairs.com', 'theaustralian.com.au', 'afr.com', 'smh.com.au',
  'nzherald.co.nz', 'lemonde.fr', 'lefigaro.fr', 'liberation.fr', 'spiegel.de', 'zeit.de', 'faz.net', 'sueddeutsche.de', 'welt.de',
  'elpais.com', 'elmundo.es', 'corriere.it', 'repubblica.it', 'folha.uol.com.br', 'estadao.com.br', 'oglobo.globo.com', 'clarin.com',
  'lanacion.com.ar', 'eltiempo.com', 'scmp.com', 'japantimes.co.jp', 'nikkei.com', 'asia.nikkei.com', 'straitstimes.com', 'haaretz.com',
  'thehindu.com', 'hindustantimes.com', 'nrc.nl', 'volkskrant.nl', 'aftenposten.no', 'dn.se', 'politiken.dk', 'hs.fi', 'nzz.ch',
  'derstandard.at', 'lesoir.be', 'irishtimes.com', 'independent.ie', 'mg.co.za', 'businesslive.co.za', 'thenationalnews.com',
]

export function hostIsPaywalled(url: string, learned: Iterable<string> = []): boolean {
  let host: string
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return false
  }
  for (const suffix of [...KNOWN_PAYWALLED, ...learned]) if (host === suffix || host.endsWith(`.${suffix}`)) return true
  return false
}

const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'to', 'for', 'and', 'with', 'at', 'by', 'from', 'after', 'as', 'is', 'are', 'was', 'says', 'said', 'new', 'how', 'why', 'what', 'over', 'amid', 'will', 'its', 'his', 'her', 'their', 'into', 'about', 'more', 'than', 'that', 'this', 'live', 'news', 'video', 'opinion'])

function words(title: string): Set<string> {
  return new Set(title.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().split(/[^\p{L}\d]+/u).filter((word) => word.length > 2 && !STOP.has(word)))
}

/** Title of a page minus its outlet suffix ("… - The New York Times"). */
export function storyTitle(pageTitle: string): string {
  return pageTitle.replace(/\s+[-–—|:]\s+[^-–—|:]{2,60}$/, '').trim()
}

export type Candidate = { title: string; url: string; publisher: string; publishedAt?: string; countryCode?: string }

/**
 * Other outlets' headlines about the same story: they share at least three
 * distinctive words with the page's title (or two when the title is short),
 * come from a different site, and free outlets rank first.
 */
export function alternativeCoverage(pageTitle: string, pageUrl: string, candidates: Candidate[], learned: Iterable<string> = [], limit = 5): Array<Candidate & { shared: number; paywalled: boolean }> {
  const target = words(storyTitle(pageTitle))
  if (target.size < 2) return []
  let pageHost = ''
  try {
    pageHost = new URL(pageUrl).hostname.replace(/^www\./, '')
  } catch {
    // ignore
  }
  const learnedList = [...learned]
  const needed = target.size <= 4 ? 2 : 3
  const seen = new Set<string>()
  return candidates
    .flatMap((candidate) => {
      let host = ''
      try {
        host = new URL(candidate.url).hostname.replace(/^www\./, '')
      } catch {
        return []
      }
      if (!host || host === pageHost || seen.has(candidate.url)) return []
      seen.add(candidate.url)
      const shared = [...words(candidate.title)].filter((word) => target.has(word)).length
      return shared >= needed ? [{ ...candidate, shared, paywalled: hostIsPaywalled(candidate.url, learnedList) }] : []
    })
    .sort((a, b) => Number(a.paywalled) - Number(b.paywalled) || b.shared - a.shared || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, limit)
}
