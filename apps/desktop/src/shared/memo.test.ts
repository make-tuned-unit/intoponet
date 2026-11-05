import { describe, expect, it } from 'vitest'
import { memoize } from './memo'

describe('memoize', () => {
  it('computes each key once, including null results, and starts over when full', () => {
    let calls = 0
    const f = memoize((x: string) => { calls += 1; return x === 'none' ? null : x.length }, (x) => x, 2)
    expect([f('ab'), f('ab'), f('none'), f('none')]).toEqual([2, 2, null, null])
    expect(calls).toBe(2)
    f('abc') // full: starts over
    f('ab')
    expect(calls).toBe(4)
  })
})
