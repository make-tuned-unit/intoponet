/**
 * Compare (COMPARE_COVERAGE): two outlets' articles for one story, side by side. Pure, so the
 * labels and the rule for dropping them can be tested without Electron.
 *
 * A side keeps its outlet and country while its page is still on the article's site; once it
 * navigates elsewhere the label goes, because it no longer says what the page is.
 */

export type CompareSideInput = { url: string; outlet: string; countryCode: string; international?: boolean; lang?: string }
export type CompareStoryInput = { id: string; title: string }

/** What a Compare tab remembers about its side (OpenTab.compare, SavedTab.compare). */
export type TabCompare = {
  outlet: string
  countryCode: string
  /** The country's name (or "International desk"), fixed when the pair was opened. */
  country: string
  storyId: string
  storyTitle: string
  /** The article's host without "www.": the label stays while the page is on this site. */
  host: string
  lang?: string
}

/** The label a split side shows (SplitSideSnapshot.compare in browser-api). */
export type CompareLabel = { outlet: string; country: string; storyId: string; lang?: string }

/** The host of an http(s) address, lowercase and without "www.", or null. */
export function compareHost(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    return host.length > 0 ? host : null
  } catch {
    return null
  }
}

/**
 * A country's name for the label. `names` looks a code up (Intl.DisplayNames in the app); a code it
 * does not know is shown as it is, and an international desk says so.
 */
export function compareCountryName(side: { countryCode: string; international?: boolean }, names?: (code: string) => string | undefined): string {
  if (side.international) return 'International desk'
  const code = side.countryCode.trim()
  return names?.(code) || code
}

/** What a Compare tab remembers, from the side the shell chose and the story it came from. */
export function tabCompareFor(side: CompareSideInput, story: CompareStoryInput, country: string): TabCompare | null {
  const host = compareHost(side.url)
  if (!host) return null
  return {
    outlet: side.outlet,
    countryCode: side.countryCode,
    country,
    storyId: story.id,
    storyTitle: story.title,
    host,
    ...(side.lang ? { lang: side.lang } : {}),
  }
}

/**
 * The label for a side whose page is at `currentUrl`: shown while the page is on the article's
 * site (the same host, "www." aside), and dropped once it navigates somewhere else.
 */
export function compareLabelFor(compare: TabCompare | undefined, currentUrl: string): CompareLabel | undefined {
  if (!compare) return undefined
  if (compareHost(currentUrl) !== compare.host) return undefined
  return {
    outlet: compare.outlet,
    country: compare.country,
    storyId: compare.storyId,
    ...(compare.lang ? { lang: compare.lang } : {}),
  }
}

/** A saved Compare record, checked. Anything damaged is dropped (no label, never a crash). */
export function savedCompareOf(value: unknown): TabCompare | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const text = (key: string, max: number): string | null => {
    const field = record[key]
    return typeof field === 'string' && field.length > 0 && field.length <= max ? field : null
  }
  const outlet = text('outlet', 120)
  const countryCode = text('countryCode', 8)
  const country = text('country', 120)
  const storyId = text('storyId', 200)
  const storyTitle = text('storyTitle', 300)
  const host = text('host', 253)
  const lang = text('lang', 35)
  if (!outlet || !countryCode || !country || !storyId || !storyTitle || !host) return undefined
  return { outlet, countryCode, country, storyId, storyTitle, host, ...(lang ? { lang } : {}) }
}
