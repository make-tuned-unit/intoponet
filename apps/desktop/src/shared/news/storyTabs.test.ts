import { describe, expect, it } from 'vitest'
import { canonicalAddress, matchTabsToStories, sameHeadline, titleKeys, type StoryHeadlines } from './storyTabs'

const HEADLINE = 'Flood waters rise across the northern river delta as rescue teams reach villages'
const STORIES: StoryHeadlines[] = [
  {
    id: 'flood',
    label: 'Delta floods',
    headlines: [
      { title: HEADLINE, url: 'https://www.example-news.com/world/delta-floods?utm_source=feed' },
      { title: 'Rescue boats reach stranded families in the delta region', url: 'https://other-paper.org/2026/delta-rescue/' },
    ],
  },
  {
    id: 'vote',
    label: 'Coastal election',
    headlines: [{ title: 'Voters queue for the coastal election count in Harbour City today', url: 'https://harbour-times.net/vote' }],
  },
]

const tab = (id: string, url: string, title: string, extra: { isPrivate?: boolean } = {}) => ({ id, url, title, ...extra })

describe('canonicalAddress', () => {
  it('drops tracking, the www, m and amp prefixes, the amp suffix, fragments and trailing slashes', () => {
    expect(canonicalAddress('https://www.Example-News.com/world/delta-floods/?utm_source=x#top')).toBe('example-news.com/world/delta-floods')
    expect(canonicalAddress('https://m.example-news.com/world/delta-floods/amp/')).toBe('example-news.com/world/delta-floods')
    expect(canonicalAddress('https://amp.example-news.com/world/delta-floods/amp')).toBe('example-news.com/world/delta-floods')
    expect(canonicalAddress('http://example-news.com/world/delta-floods')).toBe('example-news.com/world/delta-floods')
  })

  it('keeps the parameters that say which page it is, and refuses non-web addresses', () => {
    expect(canonicalAddress('https://example.org/read?id=7&utm_medium=x')).toBe('example.org/read?id=7')
    expect(canonicalAddress('https://example.org/read?id=8')).not.toBe(canonicalAddress('https://example.org/read?id=7'))
    expect(canonicalAddress('file:///Users/x/story.html')).toBeNull()
    expect(canonicalAddress('not a link')).toBeNull()
  })
})

describe('titleKeys', () => {
  it('offers the whole title and the title without its outlet name', () => {
    const keys = titleKeys(`${HEADLINE} | Example News`)
    expect(keys).toContain(keys[0])
    expect(keys.some((key) => key === 'flood waters rise across the northern river delta as rescue teams reach villages')).toBe(true)
  })

  it('folds accents, case and punctuation', () => {
    expect(titleKeys('Café — Ünïcode Story’s “end”')[0]).toBe('cafe unicode story end')
  })
})

describe('sameHeadline', () => {
  it('matches equal titles and titles with the same almost-all words', () => {
    expect(sameHeadline('voters queue for the coastal election count', 'voters queue for the coastal election count')).toBe(true)
    // Seven of eight content words shared (Jaccard 0.875).
    expect(sameHeadline('voters queue coastal election count harbour today', 'voters queue coastal election count harbour today morning')).toBe(true)
  })

  it('does not match near misses', () => {
    expect(sameHeadline('election results announced in ohio tonight', 'election results announced in iowa tonight')).toBe(false)
    expect(sameHeadline('flood waters rise', 'flood waters rise across the northern delta')).toBe(false)
    expect(sameHeadline('stock markets fall again after rate decision', 'stock markets rise again after rate decision')).toBe(false)
  })
})

describe('matchTabsToStories', () => {
  it('matches a tab whose title is a headline, with an outlet suffix', () => {
    const matches = matchTabsToStories([tab('a', 'https://news.example/x', `${HEADLINE} | Some Outlet`)], STORIES)
    expect(matches.get('a')).toEqual({ storyId: 'flood', label: 'Delta floods' })
  })

  it('matches by address, including AMP and mobile versions of a headline address', () => {
    const matches = matchTabsToStories([
      tab('amp', 'https://amp.example-news.com/world/delta-floods/amp/', 'Something unrelated'),
      tab('mobile', 'https://m.other-paper.org/2026/delta-rescue?utm_campaign=x', 'Else'),
    ], STORIES)
    expect(matches.get('amp')?.storyId).toBe('flood')
    expect(matches.get('mobile')?.storyId).toBe('flood')
  })

  it('does not match near-miss titles, an unrelated control page or a page with no words in common', () => {
    const matches = matchTabsToStories([
      tab('near', 'https://elsewhere.example/a', 'Flood waters rise across the southern river delta as rescue crews reach towns'),
      tab('control', 'https://elsewhere.example/b', 'Cooking pasta for a crowd: ten easy sauces'),
      tab('short', 'https://elsewhere.example/c', 'Flood waters'),
    ], STORIES)
    expect(matches.size).toBe(0)
  })

  it('never matches a private tab, even one with a matching title or address', () => {
    const matches = matchTabsToStories([
      tab('private', 'https://www.example-news.com/world/delta-floods', HEADLINE, { isPrivate: true }),
      tab('public', 'https://harbour-times.net/vote', 'Anything'),
    ], STORIES)
    expect(matches.has('private')).toBe(false)
    expect(matches.get('public')?.storyId).toBe('vote')
  })

  it('leaves a tab alone when it fits two stories', () => {
    const shared: StoryHeadlines[] = [
      { id: 'one', label: 'One', headlines: [{ title: HEADLINE, url: 'https://a.example/1' }] },
      { id: 'two', label: 'Two', headlines: [{ title: HEADLINE, url: 'https://b.example/2' }] },
    ]
    expect(matchTabsToStories([tab('t', 'https://c.example/3', HEADLINE)], shared).has('t')).toBe(false)
  })

  it('returns nothing without stories or tabs', () => {
    expect(matchTabsToStories([tab('a', 'https://x.example', HEADLINE)], []).size).toBe(0)
    expect(matchTabsToStories([], STORIES).size).toBe(0)
  })
})
