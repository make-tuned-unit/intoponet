import { describe, expect, it } from 'vitest'
import type { GlobalStoryHeadline } from '../../../shared/news/globalStories'
import { otherOutlets } from './compareOutlets'

const headline = (publisher: string, url: string, countryCode: string, extra: Partial<GlobalStoryHeadline> = {}): GlobalStoryHeadline => ({
  title: `${publisher} on the story`, url, publisher, publishedAt: '2026-11-07T10:00:00Z', countryCode, international: false, ...extra,
})
const names = (code: string): string => ({ PY: 'Paraguay', BO: 'Bolivia', AR: 'Argentina' })[code] ?? code

describe('other outlets for a Compare side whose article is gone', () => {
  const story = [
    headline('Brújula Digital', 'https://www.brujuladigital.net/404', 'BO'),
    headline('ABC Color', 'https://www.abc.com.py/a', 'PY', { lang: 'es' }),
    headline('ABC Color', 'https://www.abc.com.py/b', 'PY'),
    headline('Reuters', 'https://www.reuters.com/x', 'GB', { international: true }),
    headline('Clarín', 'https://www.clarin.com/y', 'AR'),
  ]

  it('leaves out the outlets on screen, lists each other outlet once, and says where it is', () => {
    expect(otherOutlets(story, ['Brújula Digital', 'Clarín'], names)).toEqual([
      { side: { url: 'https://www.abc.com.py/a', outlet: 'ABC Color', countryCode: 'PY', lang: 'es' }, where: 'Paraguay' },
      { side: { url: 'https://www.reuters.com/x', outlet: 'Reuters', countryCode: 'GB', international: true }, where: 'International desk' },
    ])
  })

  it('keeps to web addresses and to the limit', () => {
    const odd = [headline('Feed', 'javascript:alert(1)', 'PY'), headline('No country', 'https://example.org/', ''), ...story]
    expect(otherOutlets(odd, [undefined], names, 2).map((choice) => choice.side.outlet)).toEqual(['Brújula Digital', 'ABC Color'])
  })

  it('is empty when the story is no longer in the news', () => {
    expect(otherOutlets(undefined, ['ABC Color'], names)).toEqual([])
  })
})
