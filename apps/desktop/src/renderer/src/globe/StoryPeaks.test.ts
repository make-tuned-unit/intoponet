import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { StoryMountain } from '../../../shared/news/storyMountains'
import { coverageLine, rankedPeaks, StoryPanel, StoryPeakList } from './StoryPeaks'

const story = (label: string | null): StoryMountain => ({
  id: 'sm-1', label, title: 'Paraguay’s prosecutors charge Santiago Peña over the Ueno Bank collapse', url: 'https://abc.com.py/a', publisher: 'ABC Color',
  terms: ['ueno', 'pena'], coverage: 4, outlets: 4, internationalDesks: 0, articles: 5, height: 0.2, momentum: null, countryCode: 'PY',
  summit: { lat: -25.3, lon: -57.6, name: 'Paraguay' }, footprint: [{ lat: -25.3, lon: -57.6, radiusKm: 300, weight: 1, name: 'Paraguay' }],
  countries: [{ countryCode: 'AR', outlets: 1, articles: 1, firstAt: '2026-11-07T10:00:00Z', headline: { title: 'Imputan a Santiago Peña por la quiebra del banco Ueno', url: 'https://clarin.com/b', publisher: 'Clarín', publishedAt: '2026-11-07T10:00:00Z' } }],
  homeOutlets: 3, firstAt: '2026-11-07T09:00:00Z', latestAt: '2026-11-07T11:00:00Z',
})

const panel = (mountain: StoryMountain): string => renderToStaticMarkup(createElement(StoryPanel, { story: mountain, rank: 3, onClose: () => undefined, onOpen: () => undefined }))
/** Times `text` is shown (in the panel's text, not its attributes). */
const count = (html: string, text: string): number => html.replace(/<[^>]*>/g, ' ').split(text).length - 1

describe('story panel', () => {
  it('shows the headline once when it is the title, with its outlet as the link to the article', () => {
    const html = panel(story(null))
    expect(count(html, 'Paraguay’s prosecutors charge Santiago Peña')).toBe(1)
    expect(html).toContain('aria-label="Open the article from ABC Color"')
    expect(html).toContain('ABC Color')
  })

  it('shows the headline under a short label', () => {
    const html = panel(story('Paraguay elections'))
    expect(count(html, 'Paraguay elections')).toBe(1)
    expect(count(html, 'Paraguay’s prosecutors charge Santiago Peña')).toBe(1)
  })
})

describe('peaks list', () => {
  const peaks = rankedPeaks([
    { ...story('Paraguay banking crisis'), id: 'sm-a', outlets: 40, homeOutlets: 18, height: 0.5, momentum: 0.4 },
    { ...story(null), id: 'sm-b', title: 'Pope Leo XIV ends his visit to Uruguay', outlets: 12, homeOutlets: 5, height: 0.33, momentum: -0.3 },
    { ...story(null), id: 'sm-c', title: 'Krakow shooting', outlets: 6, homeOutlets: 6, height: 0.24, momentum: 0 },
  ])
  const list = (pinnedId: string | null): string => renderToStaticMarkup(createElement(StoryPeakList, { peaks, pinnedId, onFind: () => undefined, label: 'Peaks' }))

  it('lists the summits in the globe’s order with their coverage, the highest marked', () => {
    const html = list(null)
    const text = html.replace(/<[^>]*>/g, ' ')
    expect(text.indexOf('Paraguay banking crisis')).toBeLessThan(text.indexOf('Pope Leo XIV ends'))
    expect(text.indexOf('Pope Leo XIV ends')).toBeLessThan(text.indexOf('Krakow shooting'))
    expect(html).toContain('aria-label="Highest peak"')
    expect(html).toContain('aria-label="Peak 2"')
    expect(text).toContain('40 outlets · 18 in Paraguay · 1 other country')
  })

  it('shows momentum only when there is some, and marks the pinned summit', () => {
    const html = list('sm-b')
    expect(html.match(/globe-trend is-rising/g)?.length).toBe(1)
    expect(html.match(/globe-trend is-fading/g)?.length).toBe(1)
    expect(html.match(/aria-current="true"/g)?.length).toBe(1)
    expect(html.indexOf('aria-current="true"')).toBeLessThan(html.indexOf('Pope Leo XIV ends'))
    expect(html.indexOf('aria-current="true"')).toBeGreaterThan(html.indexOf('Paraguay banking crisis'))
  })
})

describe('coverage line', () => {
  it('says where a story is covered, and what it is about when its own country’s outlets have not covered it', () => {
    expect(coverageLine({ ...story(null), outlets: 40, homeOutlets: 18 })).toBe('40 outlets · 18 in Paraguay · 1 other country')
    expect(coverageLine({ ...story(null), outlets: 39, homeOutlets: 0, countryCode: 'IL', countries: Array.from({ length: 19 }, (_, i) => ({ ...story(null).countries[0]!, countryCode: `C${i}` })) })).toBe('39 outlets in 19 countries · about Israel')
  })
})
