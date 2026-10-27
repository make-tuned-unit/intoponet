import { describe, expect, it } from 'vitest'
import { alternativeCoverage, hostIsPaywalled, storyTitle } from './paywall'
import { parseAccess } from '../../main/access/pageAccess'

describe('paywalls', () => {
  it('labels known and learned paywalled outlets by host', () => {
    expect(hostIsPaywalled('https://www.nytimes.com/2026/10/26/world/x.html')).toBe(true)
    expect(hostIsPaywalled('https://cooking.nytimes.com/r')).toBe(true)
    expect(hostIsPaywalled('https://www.bbc.com/news/x')).toBe(false)
    expect(hostIsPaywalled('https://example-paper.com/a', ['example-paper.com'])).toBe(true)
    expect(hostIsPaywalled('not a url')).toBe(false)
  })

  it('finds the same story elsewhere, free outlets first', () => {
    const page = 'María Corina Machado Returns to Venezuela After Exile - The New York Times'
    expect(storyTitle(page)).toBe('María Corina Machado Returns to Venezuela After Exile')
    const found = alternativeCoverage(page, 'https://www.nytimes.com/x', [
      { title: 'Maria Corina Machado returns to Venezuela', url: 'https://www.wsj.com/a', publisher: 'WSJ' },
      { title: 'Machado returns to Venezuela to cheers in Caracas', url: 'https://www.aljazeera.com/b', publisher: 'Al Jazeera' },
      { title: 'Venezuela inflation hits new high', url: 'https://www.bbc.com/c', publisher: 'BBC' },
      { title: 'María Corina Machado regresa a Venezuela', url: 'https://www.nytimes.com/es', publisher: 'NYT (same site)' },
    ])
    expect(found.map((item) => item.publisher)).toEqual(['Al Jazeera', 'WSJ'])
    expect(found[1]!.paywalled).toBe(true)
  })

  it('reads the publisher’s own restriction markers', () => {
    expect(parseAccess({ url: 'https://a.example/x', title: 'T', signals: ['isAccessibleForFree: false'], doi: null })?.paywalled).toBe(true)
    expect(parseAccess({ url: 'https://a.example/x', title: 'T', signals: [], doi: '10.1000/xyz123' })).toEqual({ url: 'https://a.example/x', title: 'T', paywalled: false, signals: [], doi: '10.1000/xyz123' })
    expect(parseAccess({ url: 'https://a.example/x', title: 'T', signals: [], doi: 'javascript:alert(1)' })?.doi).toBeNull()
  })
})
