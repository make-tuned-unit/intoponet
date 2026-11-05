import { describe, expect, it } from 'vitest'
import { persistedActiveUrl } from './tabState'

describe('persistedActiveUrl', () => {
  const saved = [{ id: 'a', url: 'https://one.example/' }, { id: 'b', url: 'https://two.example/page' }]

  it('records the active tab when it is a saved (non-private) tab', () => {
    expect(persistedActiveUrl(saved, 'b', 'https://two.example/page')).toBe('https://two.example/page')
  })

  it('never records a private active tab: falls back to a saved tab', () => {
    // The active tab "p" is private, so it is not among the saved tabs; lastKnownUrl is its address.
    expect(persistedActiveUrl(saved, 'p', 'https://secret.example/')).toBe('https://one.example/')
  })

  it('uses the last page shown when it matches a saved tab', () => {
    expect(persistedActiveUrl(saved, null, 'https://two.example/page/')).toBe('https://two.example/page')
  })

  it('is empty when nothing may be saved', () => {
    expect(persistedActiveUrl([], 'p', 'https://secret.example/')).toBe('')
  })
})
