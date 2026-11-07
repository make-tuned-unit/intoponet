import { describe, expect, it } from 'vitest'
import { compareCountryName, compareHost, compareLabelFor, landedCompare, savedCompareOf, tabCompareFor } from './compare'

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

describe('landedCompare', () => {
  const compare = tabCompareFor(side, story, 'Portugal')!
  it('keeps the label on the host the article redirected to as it first loaded, and on the linked host', () => {
    const landed = landedCompare(compare, 'https://edition.publico.pt/2026/11/07/ferry')
    expect(landed.landedHost).toBe('edition.publico.pt')
    const label = { outlet: 'Público', country: 'Portugal', storyId: 'story-1', lang: 'pt' }
    expect(compareLabelFor(landed, 'https://edition.publico.pt/2026/11/07/ferry')).toEqual(label)
    // A consent page that sends the reader back to the linked site keeps it there too.
    expect(compareLabelFor(landed, 'https://www.publico.pt/2026/11/07/ferry')).toEqual(label)
    // Moving on to another site still drops it.
    expect(compareLabelFor(landed, 'https://example.org/')).toBeUndefined()
  })
  it('is kept with the saved record', () => {
    const landed = landedCompare(compare, 'https://edition.publico.pt/2026/11/07/ferry')
    expect(savedCompareOf(JSON.parse(JSON.stringify(landed)))).toEqual(landed)
  })
  it('changes nothing when the article loads where it was linked, or at an address that is not http(s)', () => {
    expect(landedCompare(compare, 'https://www.publico.pt/2026/11/07/ferry')).toBe(compare)
    expect(landedCompare(compare, 'chrome-error://chromewebdata/')).toBe(compare)
    expect(landedCompare(compare, '')).toBe(compare)
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
