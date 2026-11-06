import { describe, expect, it } from 'vitest'
import { placeMatches } from './globe/PlaceSuggestions'
import { displayUrl, normalizeTyped, OMNIBOX_LIMIT, pageKey, rankOmnibox, rankSites, type OmniboxSources } from './omnibox'

const NOW = Date.parse('2026-11-05T12:00:00Z')
const hoursAgo = (hours: number): string => new Date(NOW - hours * 3_600_000).toISOString()
const noPlaces = { places: [], preferred: -1 }

const sources = (overrides: Partial<OmniboxSources> = {}): OmniboxSources => ({
  tabs: [],
  bookmarks: [],
  recents: [],
  places: noPlaces,
  topics: [],
  now: NOW,
  ...overrides,
})

const keys = (text: string, input: OmniboxSources, allowInline = true) =>
  rankOmnibox(text, input, { allowInline }).suggestions.map((row) => row.kind === 'place' ? `place:${row.place.name}` : row.kind === 'search' || row.kind === 'topic' ? `${row.kind}:${row.value}` : `${row.kind}:${row.url}`)

describe('address helpers', () => {
  it('normalizes typed text and addresses alike', () => {
    expect(normalizeTyped('  HTTPS://www.GitHub.com ')).toBe('github.com')
    expect(normalizeTyped('www.iana')).toBe('iana')
    expect(displayUrl('https://www.Example.org/')).toBe('example.org')
    expect(displayUrl('http://localhost:5173/a/b?x=1#top')).toBe('localhost:5173/a/b?x=1')
    expect(pageKey('https://www.example.org/docs/')).toBe(pageKey('http://example.org/docs#intro'))
  })
})

describe('site ranking', () => {
  it('ranks host prefix, then title word prefix, then substring', () => {
    const input = sources({
      recents: [
        { url: 'https://news.example.com/github-roundup', title: 'Weekly roundup', visitedAt: hoursAgo(1) },
        { url: 'https://docs.dev/guide', title: 'GitHub Actions guide', visitedAt: hoursAgo(1) },
        { url: 'https://github.com/', title: 'GitHub', visitedAt: hoursAgo(200) },
      ],
    })
    expect(rankSites('git', input).map((row) => row.suggestion.url)).toEqual([
      'https://github.com/',
      'https://docs.dev/guide',
      'https://news.example.com/github-roundup',
    ])
    expect(rankSites('git', input)[0]?.prefix).toBe(true)
    expect(rankSites('git', input)[1]?.prefix).toBe(false)
  })

  it('ignores www. and the scheme on both sides', () => {
    const input = sources({ recents: [{ url: 'https://www.iana.org/', title: 'IANA', visitedAt: hoursAgo(1) }] })
    expect(rankSites('ian', input)[0]?.prefix).toBe(true)
    expect(rankSites('www.ian', input)[0]?.prefix).toBe(true)
    expect(rankSites('https://ia', input)[0]?.prefix).toBe(true)
  })

  it('needs three letters before matching inside words', () => {
    const input = sources({ recents: [{ url: 'https://example.org/', title: 'Example', visitedAt: hoursAgo(1) }] })
    expect(rankSites('am', input)).toEqual([])
    expect(rankSites('amp', input).length).toBe(1)
  })

  it('matches every typed word against the title', () => {
    const input = sources({ bookmarks: [{ url: 'https://a.test/x', title: 'Pacific water report' }] })
    expect(rankSites('wat rep', input).length).toBe(1)
    expect(rankSites('wat zzz', input)).toEqual([])
  })

  it('prefers the site root, bookmarks, open tabs and recent, frequent visits', () => {
    const root = sources({
      recents: [
        { url: 'https://github.com/anthropics/claude', title: 'Repo', visitedAt: hoursAgo(1) },
        { url: 'https://github.com/', title: 'GitHub', visitedAt: hoursAgo(1) },
      ],
    })
    expect(rankSites('gi', root)[0]?.suggestion.url).toBe('https://github.com/')

    const recency = sources({
      recents: [
        { url: 'https://gitlab.com/', title: 'GitLab', visitedAt: hoursAgo(300) },
        { url: 'https://gitea.io/', title: 'Gitea', visitedAt: hoursAgo(1) },
      ],
    })
    expect(rankSites('git', recency)[0]?.suggestion.url).toBe('https://gitea.io/')

    const frequency = sources({
      recents: [
        { url: 'https://gitlab.com/', title: 'GitLab', visitedAt: hoursAgo(5) },
        { url: 'https://gitea.io/', title: 'Gitea', visitedAt: hoursAgo(5) },
        { url: 'https://gitea.io/a', title: 'Gitea A', visitedAt: hoursAgo(50) },
        { url: 'https://gitea.io/b', title: 'Gitea B', visitedAt: hoursAgo(50) },
      ],
    })
    expect(rankSites('git', frequency)[0]?.suggestion.url).toBe('https://gitea.io/')

    const bookmark = sources({
      recents: [{ url: 'https://gitlab.com/', title: 'GitLab', visitedAt: hoursAgo(300) }],
      bookmarks: [{ url: 'https://gitea.io/', title: 'Gitea' }],
    })
    expect(rankSites('git', bookmark)[0]?.suggestion.kind).toBe('bookmark')
  })

  it('dedupes one page from tabs, bookmarks and recents into a "switch to tab" row', () => {
    const input = sources({
      tabs: [{ id: 't1', url: 'https://www.iana.org/', title: 'IANA — home', favicon: 'data:x' }],
      bookmarks: [{ url: 'https://iana.org/', title: 'IANA bookmark' }],
      recents: [{ url: 'http://iana.org/#top', title: 'IANA recent', visitedAt: hoursAgo(1) }],
    })
    const rows = rankSites('iana', input)
    expect(rows.length).toBe(1)
    expect(rows[0]?.suggestion).toMatchObject({ kind: 'tab', tabId: 't1', bookmarked: true, title: 'IANA — home', favicon: 'data:x' })
  })

  it('skips start-page tabs, non-web addresses, and private tabs outside private browsing', () => {
    const tabs = [
      { id: 'a', url: 'https://private.test/', title: 'Private', isPrivate: true },
      { id: 'b', url: 'about:blank', title: 'Start', isStartPage: true },
    ]
    const input = sources({ tabs, recents: [{ url: 'file:///etc/hosts', title: 'hosts', visitedAt: hoursAgo(1) }] })
    expect(rankSites('priv', input)).toEqual([])
    expect(rankSites('hosts', input)).toEqual([])
    expect(rankSites('priv', sources({ tabs, privateMode: true }))[0]?.suggestion.tabId).toBe('a')
  })
})

describe('omnibox rows', () => {
  const visited = sources({
    recents: [
      { url: 'https://www.iana.org/', title: 'Internet Assigned Numbers Authority', visitedAt: hoursAgo(1) },
      { url: 'https://example.org/', title: 'Example Domain', visitedAt: hoursAgo(3) },
    ],
  })

  it('completes a typed host inline and puts that page first', () => {
    const result = rankOmnibox('ia', visited, { allowInline: true })
    expect(result.inlineCompletion).toBe('na.org')
    expect(result.suggestions[0]).toMatchObject({ kind: 'history', url: 'https://www.iana.org/' })
    expect(result.suggestions.at(-1)).toMatchObject({ kind: 'search', value: 'ia' })
  })

  it('keeps the casing and scheme the person typed', () => {
    expect(rankOmnibox('https://www.IA', visited, { allowInline: true }).inlineCompletion).toBe('na.org')
  })

  it('does not complete after a deletion: what was typed comes first', () => {
    const result = rankOmnibox('ia', visited, { allowInline: false })
    expect(result.inlineCompletion).toBe('')
    expect(result.suggestions[0]).toMatchObject({ kind: 'search', value: 'ia' })
    expect(result.suggestions[1]).toMatchObject({ kind: 'history', url: 'https://www.iana.org/' })
  })

  it('does not complete text with spaces or title-only matches', () => {
    expect(rankOmnibox('ia ', visited, { allowInline: true }).inlineCompletion).toBe('')
    const title = rankOmnibox('assigned', visited, { allowInline: true })
    expect(title.inlineCompletion).toBe('')
    expect(title.suggestions[0]).toMatchObject({ kind: 'search' })
    expect(title.suggestions[1]).toMatchObject({ kind: 'history', url: 'https://www.iana.org/' })
  })

  it('completes into the path of a known page', () => {
    const input = sources({ recents: [{ url: 'https://github.com/anthropics/claude', title: 'Repo', visitedAt: hoursAgo(1) }] })
    expect(rankOmnibox('github.com/an', input, { allowInline: true }).inlineCompletion).toBe('thropics/claude')
  })

  it('offers "Go to" for a typed address, first, with search below', () => {
    expect(keys('wikipedia.org', visited)).toEqual(['url:https://wikipedia.org/', 'search:wikipedia.org'])
  })

  it('uses the known page (or open tab) instead of a duplicate "Go to" row', () => {
    const tab = sources({ tabs: [{ id: 't', url: 'https://www.iana.org/', title: 'IANA' }] })
    expect(keys('iana.org', tab, false)).toEqual(['tab:https://www.iana.org/', 'search:iana.org'])
  })

  it('explores a matching topic first', () => {
    const input = sources({ topics: [{ id: 'water', label: 'Water' }] })
    expect(keys('water', input)[0]).toBe('topic:Water')
  })

  it('keeps search prefixes as search', () => {
    expect(keys('search: iana', visited)[0]).toBe('search:iana')
  })

  it('flies to a place named outright, even over a visited site that starts the same', () => {
    const input = sources({
      places: placeMatches('Canada'),
      recents: [{ url: 'https://canada.ca/', title: 'Government of Canada', visitedAt: hoursAgo(1) }],
    })
    const result = rankOmnibox('Canada', input, { allowInline: true })
    expect(result.inlineCompletion).toBe('')
    expect(result.suggestions[0]).toMatchObject({ kind: 'place', place: { name: 'Canada' } })
    expect(result.suggestions.some((row) => row.kind === 'history')).toBe(true)
  })

  it('flies on a partial or qualified place name when no visited site completes it', () => {
    for (const text of ['Fredericto', 'Charlottetown PEI', 'fly to Paris']) {
      const first = rankOmnibox(text, sources({ places: placeMatches(text) }), { allowInline: true }).suggestions[0]
      expect(first?.kind, text).toBe('place')
    }
  })

  it('lets a visited site win over a partial place name', () => {
    const input = sources({
      places: placeMatches('toro'),
      recents: [{ url: 'https://toronto.ca/', title: 'City of Toronto', visitedAt: hoursAgo(1) }],
    })
    expect(input.places.preferred).toBe(0)
    const typed = rankOmnibox('toro', input, { allowInline: true })
    expect(typed.suggestions[0]).toMatchObject({ kind: 'history', url: 'https://toronto.ca/' })
    expect(typed.inlineCompletion).toBe('nto.ca')
    expect(typed.suggestions.some((row) => row.kind === 'place' && row.place.name === 'Toronto')).toBe(true)
    // After a deletion the place flies again.
    expect(rankOmnibox('toro', input, { allowInline: false }).suggestions[0]).toMatchObject({ kind: 'place', place: { name: 'Toronto' } })
  })

  it('shows weak place matches below what was typed, and searches on Enter', () => {
    const match = placeMatches('Lon')
    expect(match.preferred).toBe(-1)
    const rows = rankOmnibox('Lon', sources({ places: match }), { allowInline: true }).suggestions
    expect(rows[0]?.kind).toBe('search')
    expect(rows.filter((row) => row.kind === 'place').length).toBe(Math.min(3, match.places.length))
  })

  it('caps the list and keeps the search row', () => {
    const recents = Array.from({ length: 30 }, (_, i) => ({ url: `https://site${i}.test/`, title: `Site ${i}`, visitedAt: hoursAgo(i) }))
    const rows = rankOmnibox('site', sources({ recents, places: placeMatches('Lon') }), { allowInline: true }).suggestions
    expect(rows.length).toBeLessThanOrEqual(OMNIBOX_LIMIT)
    expect(rows.at(-1)?.kind).toBe('search')
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
  })

  it('offers nothing for empty text', () => {
    expect(rankOmnibox('   ', visited, { allowInline: true })).toEqual({ suggestions: [], inlineCompletion: '' })
  })

  it('does not throw on absurdly long input', () => {
    const result = rankOmnibox('x'.repeat(9000), visited, { allowInline: true })
    expect(result.suggestions[0]?.kind).toBe('search')
  })

  it('lists open tabs most recently used first when ⌃Tab uses that order', () => {
    const tabs = [
      { id: 'a', url: 'https://news.example/a', title: 'News a', lastShownAt: 1 },
      { id: 'b', url: 'https://news.example/b', title: 'News b', lastShownAt: 3 },
      { id: 'c', url: 'https://news.example/c', title: 'News c', lastShownAt: 2 },
    ]
    const ids = (recentTabs: boolean) => rankSites('news', sources({ tabs, recentTabs })).map((row) => row.suggestion.tabId)
    expect(ids(true)).toEqual(['b', 'c', 'a'])
    expect(ids(false)).toEqual(['a', 'b', 'c'])
  })

  it('offers archived tabs to reopen, but an open tab wins for the same page', () => {
    const archived = [
      { id: 'x1', url: 'https://old.example/story', title: 'Old story', archivedAt: 5 },
      { id: 'x2', url: 'https://open.example/', title: 'Open one', archivedAt: 5 },
    ]
    const rows = rankSites('o', sources({ archived, tabs: [{ id: 't', url: 'https://open.example/', title: 'Open one' }] }))
    const story = rows.find((row) => row.suggestion.url === 'https://old.example/story')!.suggestion
    expect(story.kind).toBe('archived')
    expect(story.archivedId).toBe('x1')
    expect(rows.find((row) => row.suggestion.url === 'https://open.example/')!.suggestion.kind).toBe('tab')
  })
})
