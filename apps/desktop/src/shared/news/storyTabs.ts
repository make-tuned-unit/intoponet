import { cleanAddress } from '../cleanAddress'
import { STOPWORDS } from './newsDigest'

/**
 * Open tabs that are articles of a world story. Matching runs on this Mac against the digest the
 * shell already has: nothing about a tab is sent anywhere. A wrong label is worse than none, so a
 * tab that could be two stories, or whose match is weak, gets no label.
 */

export type StoryTabInput = { id: string; url: string; title: string; isPrivate?: boolean | undefined }

/** A story as the digest describes it: its label and the headlines that make it up. */
export type StoryHeadlines = { id: string; label: string; headlines: Array<{ title: string; url: string }> }

export type StoryMatch = { storyId: string; label: string }

const SEPARATORS = [' | ', ' - ', ' — ', ' – ']

/**
 * An address as the story's headline would have it: tracking parameters off, lowercase host, no
 * www./m./amp. prefix, no /amp suffix, no fragment and no trailing slash. Null when not a web address.
 */
export function canonicalAddress(value: string): string | null {
  const cleaned = cleanAddress(value)
  let url: URL
  try {
    url = new URL(cleaned)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase().replace(/^(www|m|amp)\./, '')
  const path = url.pathname.replace(/\/amp\/?$/i, '').replace(/\/+$/, '')
  return `${host}${path}${url.search}`
}

/** Letters and digits of a title, accents and case folded, as words. */
function words(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/** Folded title as one key, the site's name removed when the title ends in one. */
export function titleKeys(title: string): string[] {
  const full = words(title).join(' ')
  const keys = new Set<string>([full])
  // "Headline | Outlet": the last separator splits off the outlet's name.
  let cut = -1
  for (const separator of SEPARATORS) cut = Math.max(cut, title.lastIndexOf(separator))
  if (cut > 0) keys.add(words(title.slice(0, cut)).join(' '))
  return [...keys].filter((key) => key.length > 0)
}

function contentWords(key: string): Set<string> {
  return new Set(key.split(' ').filter((word) => word.length >= 3 && !STOPWORDS.has(word)))
}

/** Titles name the same story: equal once folded, or nearly the same words (Jaccard ≥ 0.8 over six or more content words). */
export function sameHeadline(tabKey: string, headlineKey: string): boolean {
  if (tabKey === headlineKey) return true
  const a = contentWords(tabKey)
  const b = contentWords(headlineKey)
  if (a.size < 6 || b.size < 6) return false
  let shared = 0
  for (const word of a) if (b.has(word)) shared += 1
  const union = a.size + b.size - shared
  return union > 0 && shared / union >= 0.8
}

/**
 * Match open tabs to stories. A tab belongs to a story when its address is one of the story's
 * headline addresses, else when its title is one of the headlines. A tab that fits two stories
 * belongs to neither. Private tabs are skipped before anything else is read.
 */
export function matchTabsToStories(tabs: StoryTabInput[], stories: StoryHeadlines[]): Map<string, StoryMatch> {
  const addresses = new Map<string, Set<string>>()
  const headlines: Array<{ storyId: string; keys: string[] }> = []
  for (const story of stories) {
    for (const headline of story.headlines) {
      const address = canonicalAddress(headline.url)
      if (address) addresses.set(address, (addresses.get(address) ?? new Set()).add(story.id))
      const keys = titleKeys(headline.title)
      if (keys.length) headlines.push({ storyId: story.id, keys })
    }
  }
  const labels = new Map(stories.map((story) => [story.id, story.label]))
  const matches = new Map<string, StoryMatch>()
  for (const tab of tabs) {
    if (tab.isPrivate) continue
    const byAddress = new Set<string>()
    const address = canonicalAddress(tab.url)
    if (address) for (const id of addresses.get(address) ?? []) byAddress.add(id)
    let found = byAddress
    if (!found.size) {
      const keys = titleKeys(tab.title)
      found = new Set<string>()
      for (const headline of headlines) {
        if (keys.some((key) => headline.keys.some((other) => sameHeadline(key, other)))) found.add(headline.storyId)
      }
    }
    if (found.size !== 1) continue
    const storyId = [...found][0]!
    matches.set(tab.id, { storyId, label: labels.get(storyId) ?? '' })
  }
  return matches
}
