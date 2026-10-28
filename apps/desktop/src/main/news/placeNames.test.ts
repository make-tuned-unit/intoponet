import { describe, expect, it } from 'vitest'
import { namesOf } from './placeNames'

describe('a city’s local names', () => {
  it('keeps the labels and short aliases a headline would use', () => {
    const names = namesOf({
      labels: { it: { value: 'Roma' }, en: { value: 'Rome' } },
      aliases: { it: [{ value: 'Urbe' }, { value: 'Comune di Roma Capitale e dintorni' }, { value: '00100' }], en: [{ value: 'Eternal City' }] },
    }, ['it', 'en'])
    expect(names).toEqual(['Roma', 'Rome', 'Urbe', 'Eternal City'])
  })
  it('copes with no entity', () => {
    expect(namesOf(undefined, ['fr'])).toEqual([])
  })
})
