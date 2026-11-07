import { describe, expect, it } from 'vitest'
import { freeCoverageFor } from './FreeCoverageBar'

describe('freeCoverageFor', () => {
  const page = { url: 'https://www.nytimes.com/2026/11/07/world/story.html', title: 'A story' }
  const found = { url: page.url, title: 'A story - The New York Times', signals: ['paywall'] }

  it('offers what the paywall check found, unless the bar was hidden for that site', () => {
    expect(freeCoverageFor(page, found, [], null)).toEqual(found)
    expect(freeCoverageFor(page, found, ['www.nytimes.com'], null)).toBeNull()
    // A finding for another page (the focus moved) is not this page's.
    expect(freeCoverageFor({ url: 'https://example.org/', title: 'Other' }, found, [], null)).toBeNull()
    expect(freeCoverageFor(page, null, [], null)).toBeNull()
  })

  it('shows it when asked from a Compare header, also for a hidden site and before the check reports', () => {
    expect(freeCoverageFor(page, found, ['www.nytimes.com'], page.url)).toEqual(found)
    expect(freeCoverageFor(page, null, ['www.nytimes.com'], page.url)).toEqual({ url: page.url, title: 'A story', signals: [] })
    // Asked for the other side: this page keeps its own rule.
    expect(freeCoverageFor(page, found, ['www.nytimes.com'], 'https://www.lemonde.fr/article')).toBeNull()
  })
})
