import { describe, expect, it } from 'vitest'
import type { OldsChronicleEntry } from '@intoponet/browser-api'
import { historicalArticles, historicalSeriesArticles, olderContext } from './historicalContext'

const event = (year: number, text = `A distinct sourced event in ${year}.`): OldsChronicleEntry => ({ at: { iso: String(year), label: String(year), precision: 'year' }, text, section: 'History', url: 'https://en.wikipedia.org/wiki/Elections_in_Israel#History', link: null })

describe('historical context from explicit subject articles', () => {
  it('finds earlier editions linked directly from the current event article', () => {
    const currentArticle = '== Previous elections ==\n[[2020 Israeli legislative election]]\n[[2019 Israeli legislative election]]\n[[2019 Israeli local elections]]'
    expect(historicalSeriesArticles('2026 Israeli legislative election', currentArticle, 2026)).toEqual([
      '2019 Israeli legislative election',
      '2020 Israeli legislative election',
    ])
  })
  it('samples only exact earlier editions of a documented event series', () => {
    const links = [1949, 1951, 1977, 1984, 2003, 2015, 2026].map((year) => `[[${year} Israeli legislative election|${year}]]`).join('\n')
    expect(historicalSeriesArticles('2026 Israeli legislative election', links + '[[1948 Israeli war]]', 2026)).toEqual(['1949 Israeli legislative election', '1977 Israeli legislative election', '2015 Israeli legislative election'])
    expect(historicalSeriesArticles('Israel', links, 2026)).toEqual([])
  })
  it('follows the election subject, not the country, parties, references or recent elections', () => {
    const text = `== Electoral system ==
{{further|Elections in Israel}}
{{main|2022 Israeli legislative election}}
{{see also|List of political parties in Israel}}
[[History of Israel]] is an ordinary link.
== References ==
{{main|Election fraud}}
<!-- {{main|Election misinformation}} -->`
    expect(historicalArticles('2026 Israeli legislative election', text, 'Israel')).toEqual(['Elections in Israel'])
  })
  it('requires a subject match and caps secondary articles', () => {
    expect(historicalArticles('2026 Ebola epidemic', '{{main|Ebola virus disease}}{{see also|Kivu conflict}}')).toEqual(['Ebola virus disease'])
    expect(historicalArticles('Angola', '{{main|History of Angola}}', 'Angola')).toEqual([])
    expect(historicalArticles('Elections', '{{main|Elections in A|Elections in B|Elections in C|Elections in D}}')).toHaveLength(3)
  })
  it('keeps older context across periods without duplicating recent events', () => {
    const old = Array.from({ length: 12 }, (_, i) => event(1900 + i * 10))
    const selected = olderContext([event(2022)], [...old, event(1901), event(2022), event(2025)], 2026)
    expect(selected).toHaveLength(6)
    expect(selected[0]!.at.iso).toBe('1900')
    expect(selected.at(-1)!.at.iso).toBe('2010')
    expect(new Set(selected.map((item) => item.at.iso.slice(0, 3))).size).toBe(6)
  })
  it('does not relabel recent passages as historical context', () => {
    expect(olderContext([event(2022)], [event(2022), event(2024), event(2026)], 2026)).toEqual([])
    expect(olderContext([], [event(2025)], 2026)).toEqual([])
  })
})
