import { describe, expect, it } from 'vitest'

describe('recent events for the bigger picture', () => {
  const entry = (iso: string, text: string) => ({ at: { iso, precision: 'year' as const, label: iso }, text, section: 's', url: 'u', link: null })
  it('prefers events over statistics, keeps one cultural item, newest first', async () => {
    const { pickRecentEvents } = await import('./BiggerPicture')
    const picked = pickRecentEvents([
      entry('2022', 'In 2022, the governments signed an agreement to establish a radar system.'),
      entry('2023', 'In 2023, the longest tunnel opened, linking Sandoy to the road network.'),
      entry('2023', 'In 2023, Reiley became the first Faroese artist at the Eurovision Song Contest.'),
      entry('2024', 'In 2024, healthcare spending reached 12.4 percent of GDP.'),
      entry('2025', 'In 2025, Sissal became the second Faroese artist at the Eurovision Song Contest.'),
      entry('1990', 'In 1990, the parliament was elected.'),
    ], 2026)
    expect(picked.map((item) => item.at.iso)).toEqual(['2025', '2023', '2022'])
    expect(picked.some((item) => /spending/.test(item.text))).toBe(false)
  })
})
