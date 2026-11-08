import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { StoryMountain } from '../../../shared/news/storyMountains'
import { StoryPanel } from './StoryPeaks'

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
