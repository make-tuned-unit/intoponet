import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dayPages, matchHeadline, parseDayPage, threadItems } from './currentEvents'

// Portal:Current events/2026 October 27 (CC BY-SA 4.0), fetched 2026-10-28.
const page = readFileSync(join(__dirname, '__fixtures__/current-events-2026-10-27.wikitext'), 'utf8')
const items = parseDayPage(page, '2026-10-27', 'Portal:Current events/2026 October 27')

describe('Current events day pages', () => {
  it('names day pages without zero padding', () => {
    expect(dayPages(new Date('2026-10-05T12:00:00Z'), 2).map((p) => p.title)).toEqual(['Portal:Current events/2026 October 5', 'Portal:Current events/2026 October 4'])
  })
  it('files each item under its thread', () => {
    const nyala = items.find((item) => item.text.includes('Nyala'))!
    expect(nyala.category).toBe('Armed conflicts and attacks')
    expect(nyala.threads).toEqual(['Sudanese civil war (2023–present)'])
    expect(nyala.text).not.toMatch(/\[\[|https?:/)
    const netherlands = items.find((item) => item.text.includes('withdraws the Netherlands'))!
    expect(netherlands.threads).toEqual(['Eurovision Song Contest 2027', 'Netherlands in the Eurovision Song Contest 2027'])
    const flood = items.find((item) => item.text.includes('Haiti'))!
    expect(flood.threads).toEqual([])
  })
})

describe('matching a headline', () => {
  const best = (headline: string) => matchHeadline(items, headline, '2026-10-28')[0]?.item
  it('finds the item that tells the same story', () => {
    expect(best('India Evacuates Tens of Thousands as Cyclone Arnab Approaches')?.threads).toEqual(['2026 North Indian Ocean cyclone season'])
    expect(best('Israel Votes, But Who Wins?')?.threads).toEqual(['2026 Israeli legislative election'])
    expect(best('Drone strike on Nyala market kills over 100')?.threads).toEqual(['Sudanese civil war (2023–present)'])
    expect(best('US says five dead in strike on alleged drug-smuggling boat')?.threads).toEqual(['United States strikes on alleged drug traffickers during Operation Southern Spear'])
  })
  it('matches nothing for unrelated news', () => {
    expect(best('Round 8 of the 2026 Guam Monster Energy Motocross Championship')).toBeUndefined()
    expect(best('Up-to-date national statistics still months away')).toBeUndefined()
  })
  it('collects a thread’s steps', () => {
    expect(threadItems(items, 'Sudanese civil war (2023–present)').length).toBe(1)
  })
})

import { mergeChronicles } from './oldsService'
import type { OldsChronicleEntry } from '@intoponet/browser-api'

describe('merging the deep past with recent steps', () => {
  const entry = (iso: string, text: string): OldsChronicleEntry => ({ at: { iso, precision: 'day', label: iso }, text, section: 's', url: 'u', link: null })
  it('keeps the earliest background and the latest steps, in time order, without repeats', () => {
    const article = Array.from({ length: 20 }, (_, i) => entry(`19${String(i + 10).padStart(2, '0')}-01-01`, `Background event number ${i}`))
    const recent = Array.from({ length: 12 }, (_, i) => entry(`2026-10-${String(i + 10).padStart(2, '0')}`, `Recent step ${i}`))
    const merged = mergeChronicles(article, [...recent, recent[11]!])
    expect(merged.length).toBe(20)
    expect(merged[0]!.text).toBe('Background event number 0')
    expect(merged.at(-1)!.text).toBe('Recent step 11')
    expect(merged.map((e) => e.at.iso)).toEqual([...merged.map((e) => e.at.iso)].sort())
  })
})
