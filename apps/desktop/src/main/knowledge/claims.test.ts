import { describe, expect, it } from 'vitest'
import type { KnowledgeDocument } from '@intoponet/browser-api'
import { extractClaims, figuresIn, labelClaims } from './claims'

const doc = (id: string, url: string, paragraphs: string[]): KnowledgeDocument => ({
  id, url, title: id, siteName: null, lang: 'en', publishedAt: null, absorbedAt: '2026-10-27T00:00:00Z', scope: 'article',
  wordCount: 100, paragraphCount: paragraphs.length, entities: [], places: [], dates: [], note: null, paragraphs,
})

describe('claims', () => {
  it('finds figures with units, not bare years', () => {
    expect(figuresIn('Global temperatures rose 1.2 °C since 1850, and 3.6 billion people are exposed.').map((f) => [f.value, f.unit])).toEqual([[1.2, '°c'], [3.6e9, 'count']])
    expect(figuresIn('In 2023 the summit met.')).toEqual([])
  })
  it('keeps sentences with figures, quotes or dispute language, with attribution', () => {
    const claims = extractClaims(doc('a', 'https://a.test', [
      'According to the World Meteorological Organization, 2024 was 1.55 °C warmer than pre-industrial levels. The meeting was in Baku.',
      '“The future is not something we enter, it is something we create,” the minister said at the opening.',
      'The company denied the report, calling it misleading and unverified by any regulator.',
    ]))
    expect(claims.map((claim) => claim.kind)).toEqual(['figure', 'quote', 'statement'])
    expect(claims[0]!.attributedTo).toBe('the World Meteorological Organization')
    expect(claims[2]!.flagged).toBe(true)
  })
  it('labels corroborated, disputed and stated claims against other sites only', () => {
    const target = doc('t', 'https://news.one/x', [
      'According to the WMO, global average temperature in 2024 was 1.55 °C above pre-industrial levels, the warmest year recorded.',
      'Sea level along the Pacific coast has risen 15 cm across the islands since monitoring began, officials reported.',
      'Emissions from shipping rose 2 percent last year, according to the agency.',
    ])
    const agree = doc('o1', 'https://science.two/y', ['The WMO confirmed global average temperature in 2024 reached 1.55 °C above pre-industrial levels, the warmest year on record.'])
    const conflict = doc('o2', 'https://blog.three/z', ['Islands monitoring shows Pacific coast sea level has risen 40 cm since monitoring began across the islands.'])
    const sameSite = doc('o3', 'https://news.one/other', ['Emissions from shipping rose 2 percent last year, according to the agency.'])
    const labelled = labelClaims(target, [agree, conflict, sameSite])
    expect(labelled.map((claim) => claim.status)).toEqual(['corroborated', 'disputed', 'stated'])
    expect(labelled[0]!.evidence[0]).toMatchObject({ recordId: 'o1', site: 'science.two', relation: 'agrees' })
    expect(labelled[1]!.evidence[0]).toMatchObject({ recordId: 'o2', relation: 'conflicts' })
  })
})

describe('claims: false alarms', () => {
  it('ignores citation markers and does not call loosely related numbers a dispute', async () => {
    const { figuresIn, labelClaims } = await import('./claims')
    expect(figuresIn('Heat waves are becoming more common.[8] Arctic warming has thawed permafrost.2 Most')).toEqual([])
    expect(figuresIn('risen about 2 degrees Fahrenheit (1 degrees Celsius) since 1880').map((f) => f.unit)).toEqual(['°f', '°c'])
    const a = doc('a', 'https://one.test', ['Global surface temperature has risen about 1.1 °C since the late 19th century, scientists reported widely.'])
    const b = doc('b', 'https://two.test', ['Arctic sea ice has declined by 13 % per decade since satellite records, scientists reported for the Arctic region.'])
    expect(labelClaims(a, [b])[0]!.status).toBe('stated')
  })
})

describe('attribution', () => {
  it('keeps multi-word bodies with "on/of" in their names', async () => {
    const { extractClaims } = await import('./claims')
    const [claim] = extractClaims({ paragraphs: ['According to the Intergovernmental Panel on Climate Change, warming reached 1.1 °C over the period studied.'] })
    expect(claim!.attributedTo).toBe('the Intergovernmental Panel on Climate Change')
  })
})
