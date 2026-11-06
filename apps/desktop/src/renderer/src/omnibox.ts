import { resolveNavigationIntent } from '@intoponet/browser-api'
import type { Place } from '../../shared/places/places'
import type { PlaceMatch } from './globe/PlaceSuggestions'
import { inferUnifiedLauncherIntent, type ExploreTopic } from './launcherIntent'

/**
 * The address bar's suggestions, ranked on this Mac from what is already here:
 * open tabs, bookmarks, recent pages and globe places. Nothing typed leaves the
 * device (no remote search suggestions) and nothing about typing is recorded.
 */

export type OmniboxTab = {
  id: string
  url: string
  title: string
  favicon?: string
  isPrivate?: boolean
  isStartPage?: boolean
  lastShownAt?: number
}
export type OmniboxPage = { url: string; title: string }
export type OmniboxRecent = { url: string; title: string; visitedAt: string }

/** A browser action offered in command mode (⌘K, or ">" typed first). */
export type OmniboxAction = {
  id: string
  label: string
  /** Other words it answers to ("pdf", "screenshot"…). */
  keywords?: string
  /** The key chord shown beside it, e.g. "⇧⌘C". */
  shortcut?: string
}

/** Command mode: the text starts with ">" (what follows is matched against actions). */
export function commandQuery(text: string): string | null {
  const match = /^\s*>\s*(.*)$/s.exec(text)
  return match ? match[1]!.trim() : null
}

export type OmniboxSources = {
  tabs: readonly OmniboxTab[]
  bookmarks: readonly OmniboxPage[]
  recents: readonly OmniboxRecent[]
  places: PlaceMatch
  topics: readonly ExploreTopic[]
  /** Private browsing is on: private tabs may be offered (they are this session's own). */
  privateMode?: boolean
  /** Settings › ⌃Tab "Recently used first": among equally good matches, recently used tabs come first. */
  recentTabs?: boolean
  /** Browser actions for command mode. */
  actions?: readonly OmniboxAction[]
  /** Tabs that tidied themselves away (Archived tabs): offered to reopen. */
  archived?: readonly { id: string; url: string; title: string; favicon?: string; archivedAt: number }[]
  now?: number
}

export type OmniboxSiteSuggestion = {
  kind: 'tab' | 'archived' | 'bookmark' | 'history'
  key: string
  url: string
  title: string
  /** The address as shown: host without www., then path. */
  display: string
  tabId?: string
  /** An archived tab: reopened (with its back/forward list) rather than loaded afresh. */
  archivedId?: string
  favicon?: string
  bookmarked: boolean
}

export type OmniboxSuggestion =
  | OmniboxSiteSuggestion
  | { kind: 'place'; key: string; place: Place }
  | { kind: 'url'; key: string; value: string; url: string; display: string }
  | { kind: 'search'; key: string; value: string }
  | { kind: 'topic'; key: string; value: string }
  | { kind: 'action'; key: string; id: string; label: string; shortcut?: string }

export type OmniboxResult = {
  /** Best first: Enter (with nothing highlighted) takes row 0. */
  suggestions: OmniboxSuggestion[]
  /** Text to append to what was typed and select, or '' for none. */
  inlineCompletion: string
}

export const OMNIBOX_LIMIT = 8
const SITE_LIMIT = 5
const PLACE_LIMIT = 3

/** Typed text compared against addresses: lower case, no scheme, no leading www. */
export function normalizeTyped(text: string): string {
  return text.trim().toLocaleLowerCase('en').replace(/^[a-z][a-z\d+.-]*:\/\//, '').replace(/^www\./, '')
}

/** "https://www.Example.org/a/?q#x" → "example.org/a/?q": host without www., path (no lone "/"), query. */
export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const host = parsed.host.toLocaleLowerCase('en').replace(/^www\./, '')
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    return `${host}${path}${parsed.search}`
  } catch {
    return url
  }
}

/** One page however it was reached: http/https, www., trailing slash and #fragment don't matter. */
export function pageKey(url: string): string {
  return displayUrl(url).replace(/\/$/, '')
}

const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url)
const words = (text: string): string[] => text.toLocaleLowerCase('en').split(/[^\p{L}\p{N}]+/u).filter(Boolean)

type Candidate = OmniboxSiteSuggestion & { visitedAt: number; isRoot: boolean; host: string; tabRecency?: number }

function gatherCandidates(sources: OmniboxSources): Candidate[] {
  const byKey = new Map<string, Candidate>()
  const add = (url: string, title: string, update: (candidate: Candidate) => void): void => {
    if (!isWebUrl(url)) return
    const key = pageKey(url)
    let candidate = byKey.get(key)
    if (!candidate) {
      const display = displayUrl(url)
      let host = ''
      let isRoot = false
      try {
        const parsed = new URL(url)
        host = parsed.host.toLocaleLowerCase('en').replace(/^www\./, '')
        isRoot = parsed.pathname === '/' && !parsed.search
      } catch { /* isWebUrl passed; URL still unparsable */ return }
      candidate = { kind: 'history', key: `site:${key}`, url, title: '', display, bookmarked: false, visitedAt: 0, isRoot, host }
      byKey.set(key, candidate)
    }
    if (!candidate.title && title.trim()) candidate.title = title.trim()
    update(candidate)
  }
  const recent = sources.recentTabs
    ? [...sources.tabs].sort((a, b) => (b.lastShownAt ?? 0) - (a.lastShownAt ?? 0)).map((tab) => tab.id)
    : []
  for (const tab of sources.tabs) {
    if (tab.isStartPage || (tab.isPrivate && !sources.privateMode)) continue
    const rank = recent.indexOf(tab.id)
    add(tab.url, tab.title, (candidate) => {
      if (rank >= 0) candidate.tabRecency = Math.max(candidate.tabRecency ?? 0, 1 - rank / recent.length)
      candidate.kind = 'tab'
      candidate.tabId ??= tab.id
      candidate.url = tab.url
      if (tab.favicon) candidate.favicon ??= tab.favicon
      if (tab.title.trim()) candidate.title = tab.title.trim()
    })
  }
  for (const entry of sources.archived ?? []) {
    add(entry.url, entry.title, (candidate) => {
      if (candidate.kind === 'tab') return
      candidate.kind = 'archived'
      candidate.archivedId ??= entry.id
      candidate.visitedAt = Math.max(candidate.visitedAt, entry.archivedAt)
      if (entry.favicon) candidate.favicon ??= entry.favicon
      if (entry.title.trim()) candidate.title = entry.title.trim()
    })
  }
  for (const bookmark of sources.bookmarks) {
    add(bookmark.url, bookmark.title, (candidate) => {
      candidate.bookmarked = true
      if (candidate.kind === 'history') candidate.kind = 'bookmark'
    })
  }
  for (const recent of sources.recents) {
    const at = Date.parse(recent.visitedAt)
    add(recent.url, recent.title, (candidate) => {
      if (Number.isFinite(at)) candidate.visitedAt = Math.max(candidate.visitedAt, at)
    })
  }
  return [...byKey.values()]
}

type Scored = { candidate: Candidate; score: number; prefix: boolean }

/** How well a page matches: address prefix, then title word prefix, then anywhere. Null: no match. */
function scoreCandidate(candidate: Candidate, typed: string, hostVisits: Map<string, number>, now: number): Scored | null {
  const tokens = words(typed)
  const display = candidate.display.toLocaleLowerCase('en')
  const titleWords = words(candidate.title)
  const addressWords = words(display)
  let score: number
  let prefix = false
  if (display.startsWith(typed)) {
    prefix = true
    // Within the host ("gith" of github.com) beats into the path ("github.com/ant").
    score = typed.length <= candidate.host.length ? 1000 : 950
    if (typed === candidate.host || typed === display) score += 100
    if (candidate.isRoot) score += 60
  } else if (tokens.length && tokens.every((token) => titleWords.some((word) => word.startsWith(token)) || addressWords.some((word) => word.startsWith(token)))) {
    score = 600
  } else if (typed.length >= 3 && tokens.length && tokens.every((token) => display.includes(token) || candidate.title.toLocaleLowerCase('en').includes(token))) {
    score = 300
  } else {
    return null
  }
  if (candidate.bookmarked) score += 40
  if (candidate.kind === 'tab') score += 30 + 25 * (candidate.tabRecency ?? 0)
  if (candidate.visitedAt) {
    const hours = Math.max(0, now - candidate.visitedAt) / 3_600_000
    score += 80 * Math.exp(-hours / 48)
  }
  // Recents keep one entry per page, so "frequently visited" is how many pages of the site were visited.
  score += Math.min(5, Math.max(0, (hostVisits.get(candidate.host) ?? 0) - 1)) * 12
  return { candidate, score, prefix }
}

function strip(candidate: Candidate): OmniboxSiteSuggestion {
  const { visitedAt: _visitedAt, isRoot: _isRoot, host: _host, tabRecency: _tabRecency, ...suggestion } = candidate
  return suggestion
}

/** Ranked pages (tabs, bookmarks, recents) matching the typed text. */
export function rankSites(text: string, sources: OmniboxSources): Array<{ suggestion: OmniboxSiteSuggestion; prefix: boolean }> {
  const typed = normalizeTyped(text)
  if (!typed) return []
  const now = sources.now ?? Date.now()
  const candidates = gatherCandidates(sources)
  const hostVisits = new Map<string, number>()
  for (const candidate of candidates) if (candidate.visitedAt) hostVisits.set(candidate.host, (hostVisits.get(candidate.host) ?? 0) + 1)
  return candidates
    .flatMap((candidate) => {
      const scored = scoreCandidate(candidate, typed, hostVisits, now)
      return scored ? [scored] : []
    })
    .sort((a, b) => b.score - a.score || a.candidate.display.length - b.candidate.display.length || a.candidate.url.localeCompare(b.candidate.url))
    .map(({ candidate, prefix }) => ({ suggestion: strip(candidate), prefix }))
}

/**
 * Everything the address bar offers for `text`. With `allowInline` (the person
 * is typing forward at the end) a page whose address starts with the text is
 * completed inline and goes first; a place named outright still wins, so
 * "Canada" + Enter flies the globe.
 */
/** Rows shown in command mode (actions first, then matching tabs, archived tabs, bookmarks and places). */
export const COMMAND_LIMIT = 12

/** Actions matching `query`: every word typed starts a word of the action's name or keywords. */
export function rankActions(query: string, actions: readonly OmniboxAction[]): OmniboxAction[] {
  const tokens = query.toLocaleLowerCase('en').split(/\s+/).filter(Boolean)
  if (!tokens.length) return [...actions]
  const scored = actions.flatMap((action, order) => {
    const label = action.label.toLocaleLowerCase('en')
    const words = `${label} ${action.keywords ?? ''}`.toLocaleLowerCase('en').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    const joined = tokens.join(' ')
    let score: number
    if (label.startsWith(joined)) score = 1000
    else if (tokens.every((token) => words.some((word) => word.startsWith(token)))) score = 600 + (label.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(tokens[0]!)) ? 100 : 0)
    else if (joined.length >= 3 && words.join(' ').includes(joined)) score = 300
    else return []
    return [{ action, score, order }]
  })
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((item) => item.action)
}

function rankCommands(query: string, sources: OmniboxSources): OmniboxResult {
  const actions = rankActions(query, sources.actions ?? []).map((action): OmniboxSuggestion => ({
    kind: 'action', key: `action:${action.id}`, id: action.id, label: action.label, ...(action.shortcut ? { shortcut: action.shortcut } : {}),
  }))
  // With words typed, the tabs, archived tabs, bookmarks and places they match follow the actions.
  const sites = query ? rankSites(query, sources).map((site) => site.suggestion) : []
  const places: OmniboxSuggestion[] = query ? sources.places.places.slice(0, PLACE_LIMIT).map((place) => ({ kind: 'place', key: `place:${place.id}`, place })) : []
  const siteRows = sites.slice(0, SITE_LIMIT)
  const actionRows = actions.slice(0, Math.max(COMMAND_LIMIT - siteRows.length - places.length, 4))
  return { suggestions: [...actionRows, ...siteRows, ...places].slice(0, COMMAND_LIMIT), inlineCompletion: '' }
}

export function rankOmnibox(text: string, sources: OmniboxSources, options: { allowInline?: boolean } = {}): OmniboxResult {
  const command = commandQuery(text)
  if (command !== null) return rankCommands(command, sources)
  const value = text.trim()
  if (!value) return { suggestions: [], inlineCompletion: '' }
  let intent: ReturnType<typeof inferUnifiedLauncherIntent> | null
  try {
    intent = inferUnifiedLauncherIntent(value, sources.topics)
  } catch {
    intent = null
  }
  const sites = rankSites(value, sources)
  const places = sources.places.places
  const placeFirst = sources.places.preferred >= 0 ? places[sources.places.preferred] ?? null : null

  const typed = normalizeTyped(value)
  const top = sites[0]
  const completable = options.allowInline === true && !/\s/.test(text) && !!top?.prefix && !sources.places.certain
  const completion = completable && top ? top.suggestion.display.slice(typed.length) : ''

  // A typed address: "Go to" it, or the open tab / known page that is that address.
  let urlRow: OmniboxSuggestion | null = null
  let sameAsTyped: OmniboxSiteSuggestion | undefined
  if (intent?.kind === 'url') {
    try {
      const url = resolveNavigationIntent(intent)
      sameAsTyped = sites.find((site) => pageKey(site.suggestion.url) === pageKey(url))?.suggestion
      if (!sameAsTyped) urlRow = { kind: 'url', key: `url:${pageKey(url)}`, value: intent.value, url, display: displayUrl(url) }
    } catch { /* not a web address after all: searched instead */ }
  }
  const searchValue = intent?.kind === 'search' ? intent.value : value.replace(/^(?:search|web):\s*/i, '') || value
  const searchRow: OmniboxSuggestion = { kind: 'search', key: `search:${searchValue}`, value: searchValue }

  let first: OmniboxSuggestion
  if (placeFirst && (sources.places.certain || !completable)) first = { kind: 'place', key: `place:${placeFirst.id}`, place: placeFirst }
  else if (completable && top) first = top.suggestion
  else if (intent?.kind === 'topic') first = { kind: 'topic', key: `topic:${intent.value}`, value: intent.value }
  else if (sameAsTyped) first = sameAsTyped
  else if (urlRow) first = urlRow
  else first = searchRow

  const tail: OmniboxSuggestion[] = []
  if (urlRow && first !== urlRow) tail.push(urlRow)
  if (first !== searchRow) tail.push(searchRow)
  const budget = OMNIBOX_LIMIT - 1 - tail.length
  const placeRows: OmniboxSuggestion[] = places
    .filter((place) => first.kind !== 'place' || place.id !== first.place.id)
    .slice(0, Math.min(PLACE_LIMIT, budget))
    .map((place) => ({ kind: 'place', key: `place:${place.id}`, place }))
  const siteRows = sites
    .map((site) => site.suggestion)
    .filter((site) => site.key !== first.key)
    .slice(0, Math.min(SITE_LIMIT, budget - placeRows.length))
  const suggestions = [first, ...siteRows, ...placeRows, ...tail]
  return { suggestions, inlineCompletion: first.kind === 'place' ? '' : completion }
}
