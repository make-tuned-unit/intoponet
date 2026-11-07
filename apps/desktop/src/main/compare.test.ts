import { describe, expect, it } from 'vitest'
import { compareCountryName, compareHost, compareLabelFor, savedCompareOf, tabCompareFor } from './compare'

const story = { id: 'story-1', title: 'Ferry fire off Lisbon' }
const side = { url: 'https://www.publico.pt/2026/11/07/ferry', outlet: 'Público', countryCode: 'PT', lang: 'pt' }

describe('compareHost', () => {
  it('lowercases and drops www.', () => {
    expect(compareHost('https://WWW.Publico.PT/a')).toBe('publico.pt')
  })
  it('refuses anything but http(s)', () => {
    expect(compareHost('file:///etc/hosts')).toBeNull()
    expect(compareHost('javascript:alert(1)')).toBeNull()
    expect(compareHost('not a url')).toBeNull()
  })
})

describe('compareCountryName', () => {
  it('names the country through the lookup, and falls back to the code', () => {
    const names = (code: string) => (code === 'PT' ? 'Portugal' : undefined)
    expect(compareCountryName({ countryCode: 'PT' }, names)).toBe('Portugal')
    expect(compareCountryName({ countryCode: 'XQ' }, names)).toBe('XQ')
  })
  it('labels an international desk as one', () => {
    expect(compareCountryName({ countryCode: 'INT', international: true }, () => 'Nowhere')).toBe('International desk')
  })
})

describe('tabCompareFor', () => {
  it('records the outlet, country, story and the article host', () => {
    expect(tabCompareFor(side, story, 'Portugal')).toEqual({
      outlet: 'Público',
      countryCode: 'PT',
      country: 'Portugal',
      storyId: 'story-1',
      storyTitle: 'Ferry fire off Lisbon',
      host: 'publico.pt',
      lang: 'pt',
    })
  })
  it('refuses an address that is not http(s)', () => {
    expect(tabCompareFor({ ...side, url: 'file:///x' }, story, 'Portugal')).toBeNull()
  })
})

describe('compareLabelFor', () => {
  const compare = tabCompareFor(side, story, 'Portugal')!
  it('keeps the label while the page is on the article\'s site', () => {
    expect(compareLabelFor(compare, 'https://publico.pt/2026/11/07/ferry?page=2')).toEqual({ outlet: 'Público', country: 'Portugal', storyId: 'story-1', lang: 'pt' })
  })
  it('drops the label once the page navigates elsewhere', () => {
    expect(compareLabelFor(compare, 'https://example.org/')).toBeUndefined()
    expect(compareLabelFor(compare, 'https://sub.publico.pt/')).toBeUndefined()
  })
  it('has no label without a compare record', () => {
    expect(compareLabelFor(undefined, 'https://publico.pt/')).toBeUndefined()
  })
})

describe('savedCompareOf', () => {
  it('reads a complete record back', () => {
    const compare = tabCompareFor(side, story, 'Portugal')!
    expect(savedCompareOf(JSON.parse(JSON.stringify(compare)))).toEqual(compare)
  })
  it('drops damaged records', () => {
    expect(savedCompareOf(null)).toBeUndefined()
    expect(savedCompareOf([])).toBeUndefined()
    expect(savedCompareOf({ outlet: 'Público' })).toBeUndefined()
    expect(savedCompareOf({ outlet: 'x'.repeat(500), countryCode: 'PT', country: 'Portugal', storyId: 's', storyTitle: 't', host: 'publico.pt' })).toBeUndefined()
  })
})
