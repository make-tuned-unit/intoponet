/**
 * Reads whether the open page says its article is restricted, from the
 * publisher's own declarations: schema.org `isAccessibleForFree: false`
 * (the markup publishers add for search engines), `article:content_tier`,
 * and common paywall overlays. It only reads; it never removes anything.
 */
export const ACCESS_WORLD_ID = 1297

export const ACCESS_SCRIPT = `(() => {
  const signals = []
  for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
    const text = (node.textContent || '').slice(0, 200000)
    if (/"isAccessibleForFree"\\s*:\\s*("?false"?|"False")/i.test(text)) { signals.push('isAccessibleForFree: false'); break }
  }
  const tier = document.querySelector('meta[property="article:content_tier"]')?.getAttribute('content') || ''
  if (/locked|metered|premium|subscriber/i.test(tier)) signals.push('content tier: ' + tier.slice(0, 20))
  const overlay = document.querySelector('[class*="paywall" i], [id*="paywall" i], [data-testid*="paywall" i], .tp-modal, .tp-container-inner, #piano-root, [class*="subscribe-wall" i], [class*="regwall" i], [class*="meter-" i][class*="wall" i]')
  if (overlay) signals.push('paywall overlay')
  const doi = document.querySelector('meta[name="citation_doi"], meta[name="dc.identifier" i][content^="10."]')?.getAttribute('content') || null
  const og = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || ''
  return { url: location.href, title: (og || document.title || '').slice(0, 300), signals: signals.slice(0, 4), doi: doi ? doi.slice(0, 200) : null }
})()`

export type PageAccess = { url: string; title: string; paywalled: boolean; signals: string[]; doi: string | null }

export function parseAccess(value: unknown): PageAccess | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v['url'] !== 'string' || typeof v['title'] !== 'string') return null
  const signals = Array.isArray(v['signals']) ? v['signals'].filter((item): item is string => typeof item === 'string').slice(0, 4) : []
  const doi = typeof v['doi'] === 'string' && /^10\.\d{4,9}\/\S+$/.test(v['doi']) ? v['doi'] : null
  return { url: v['url'], title: v['title'], paywalled: signals.length > 0, signals, doi }
}
