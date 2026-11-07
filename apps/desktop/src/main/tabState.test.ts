import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { capTitle, capUrl, coalesce, MAX_SNAPSHOT_URL, persistedActiveUrl, restoredActiveTab } from './tabState'

describe('snapshot limits', () => {
  it('keeps ordinary addresses and shortens huge ones to a valid address on the same site', () => {
    expect(capUrl('https://a.test/x?q=1')).toBe('https://a.test/x?q=1')
    expect(capUrl(`https://a.test/x?q=${'a'.repeat(MAX_SNAPSHOT_URL)}`)).toBe('https://a.test/x')
    expect(capUrl(`https://a.test/${'p'.repeat(MAX_SNAPSHOT_URL)}`)).toBe('https://a.test/')
    expect(capTitle('t'.repeat(2000))).toHaveLength(512)
  })

  it('coalesces bursts to one send now and one at the end of the pause', () => {
    vi.useFakeTimers()
    try {
      const send = vi.fn()
      const emit = coalesce(send, 16)
      for (let i = 0; i < 500; i += 1) emit()
      expect(send).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(16)
      expect(send).toHaveBeenCalledTimes(2)
      vi.advanceTimersByTime(16)
      expect(send).toHaveBeenCalledTimes(2)
      emit()
      expect(send).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })
})

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

describe('restoredActiveTab', () => {
  // A pinned tab and an open tab at the same address; the open one was shown when the app quit.
  const tabs = [{ id: 'pin', url: 'https://mail.example/' }, { id: 'other', url: 'https://news.example/' }, { id: 'shown', url: 'https://mail.example/' }]

  it('brings back the tab that was shown, not the first at its address', () => {
    expect(restoredActiveTab(tabs, 'shown', 'https://mail.example/')?.id).toBe('shown')
  })

  it('falls back to the first tab at the saved address, then the first tab (older saves have no shown tab)', () => {
    expect(restoredActiveTab(tabs, undefined, 'https://news.example')?.id).toBe('other')
    expect(restoredActiveTab(tabs, 'gone', 'https://elsewhere.example/')?.id).toBe('pin')
    expect(restoredActiveTab([], 'shown', '')).toBeUndefined()
  })
})
