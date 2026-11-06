import { describe, expect, it } from 'vitest'
import type { OldsChronicleEntry } from '@intoponet/browser-api'
import { adultLife, impliedCountries, spreadRecent } from './oldsService'

const entry = (iso: string, text: string): OldsChronicleEntry => ({ at: { iso, label: iso }, text } as OldsChronicleEntry)

describe('the country a headline points to without naming it', () => {
  it('reads a leader or seat of government', () => {
    expect(impliedCountries('Trump names Stephen Miller as new chief of staff')).toEqual(['US'])
    expect(impliedCountries('White House defends National Guard deployment')).toEqual(['US'])
    expect(impliedCountries('Kremlin rejects European peace plan')).toEqual(['RU'])
    expect(impliedCountries('Downing Street denies reshuffle')).toEqual(['GB'])
  })

  it('does not read party names that many countries share', () => {
    expect(impliedCountries('Democrats win as Republicans lose seats')).toEqual([])
    expect(impliedCountries('Liberal Democrats call for inquiry')).toEqual([])
    // With Congress or the midterms they are the American parties.
    expect(impliedCountries('Democrats win control of the House as Republicans lose seats')).toEqual(['US'])
  })
})

describe('a person in the news', () => {
  it('keeps their adult life and birth line, not their school years', () => {
    const life = [
      entry('1985-08-23', 'Miller (born August 23, 1985) is an American political advisor'),
      entry('1999', 'In 1999, he began attending Santa Monica High School.'),
      entry('2002', 'In 2002, he ran for student announcer'),
      entry('2007', 'After graduating in 2007, he worked as press secretary'),
      entry('2016-01', 'In January 2016, Miller joined the campaign'),
    ]
    expect(adultLife(life, 1985).map((item) => item.at.iso)).toEqual(['1985-08-23', '2007', '2016-01'])
  })

  it('keeps the latest half and spreads the rest over earlier years', () => {
    const years = Array.from({ length: 30 }, (_, index) => entry(String(1990 + index), `Event ${index}`))
    const picked = spreadRecent(years, 10)
    expect(picked).toHaveLength(10)
    expect(picked.slice(-5).map((item) => item.at.iso)).toEqual(['2015', '2016', '2017', '2018', '2019'])
    expect(picked[0]!.at.iso).toBe('1990')
    expect(spreadRecent(years.slice(0, 4), 10)).toHaveLength(4)
  })
})
