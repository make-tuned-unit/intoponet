import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UnseenTabs } from './backgroundLoad'

function page(muted = false) {
  const calls: string[] = []
  let destroyed = false
  let audioMuted = muted
  return {
    calls,
    destroy: () => { destroyed = true },
    isDestroyed: () => destroyed,
    setBackgroundThrottling: (allowed: boolean) => { calls.push(allowed ? 'throttled' : 'unthrottled') },
    isAudioMuted: () => audioMuted,
    setAudioMuted: (value: boolean) => { audioMuted = value; calls.push(value ? 'muted' : 'unmuted') },
  }
}
type Page = ReturnType<typeof page>

/** Made out of sight, then its first load starts (as createBrowserTab and loadURL do). */
function openAndLoad(unseen: UnseenTabs<Page>, tab: Page): void {
  unseen.opened(tab)
  unseen.loadStarted(tab)
}

function tabs(limitMs = 60_000) {
  const media: string[] = []
  const unseen = new UnseenTabs<Page>({ pause: () => { media.push('pause') }, resume: () => { media.push('resume') } }, limitMs)
  return { unseen, media }
}

describe('tabs opened out of sight', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('are muted when made, load unthrottled, and are throttled again once they stop loading', () => {
    const { unseen } = tabs()
    const tab = page()
    unseen.opened(tab)
    expect(tab.calls).toEqual(['muted'])
    expect(unseen.loading).toBe(0)
    unseen.loadStarted(tab)
    expect(tab.calls).toEqual(['muted', 'unthrottled'])
    expect(unseen.loading).toBe(1)
    // A redirect changes nothing more.
    unseen.loadStarted(tab)
    expect(tab.calls).toEqual(['muted', 'unthrottled'])
    unseen.loadStopped(tab)
    expect(tab.calls).toEqual(['muted', 'unthrottled', 'throttled'])
    expect(unseen.loading).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    // A stop with no load out of sight changes nothing.
    unseen.loadStopped(tab)
    expect(tab.calls).toHaveLength(3)
  })

  it('stay muted until shown, and are then heard as any tab', () => {
    const { unseen, media } = tabs()
    const tab = page()
    openAndLoad(unseen, tab)
    unseen.loadStopped(tab)
    expect(unseen.mutedUntilShown(tab)).toBe(true)
    unseen.shown(tab)
    expect(tab.calls).toEqual(['muted', 'unthrottled', 'throttled', 'unmuted'])
    expect(unseen.mutedUntilShown(tab)).toBe(false)
    expect(unseen.size).toBe(0)
    expect(media).toEqual([])
  })

  it('leave tabs that were made on screen, or shown since, as they are', () => {
    const { unseen, media } = tabs()
    const front = page()
    unseen.loadStarted(front)
    unseen.loadStopped(front)
    expect(unseen.mediaStarted(front)).toBe(false)
    const later = page()
    openAndLoad(unseen, later)
    unseen.shown(later)
    unseen.loadStarted(later)
    expect(unseen.mediaStarted(later)).toBe(false)
    expect(front.calls).toEqual([])
    expect(later.calls).toEqual(['muted', 'unthrottled', 'throttled', 'unmuted'])
    expect(media).toEqual([])
    expect(unseen.size).toBe(0)
  })

  it('unthrottle each new document before the tab is shown, once per load', () => {
    const { unseen } = tabs()
    const tab = page()
    openAndLoad(unseen, tab)
    vi.advanceTimersByTime(50_000)
    unseen.loadStarted(tab)
    // The limit starts again with the new document.
    vi.advanceTimersByTime(50_000)
    expect(tab.calls).toEqual(['muted', 'unthrottled'])
    unseen.loadStopped(tab)
    // The page navigates again on its own, still unseen.
    unseen.loadStarted(tab)
    expect(tab.calls).toEqual(['muted', 'unthrottled', 'throttled', 'unthrottled'])
  })

  it('are throttled again after the time limit when a page never stops loading', () => {
    const { unseen } = tabs()
    const tab = page()
    openAndLoad(unseen, tab)
    vi.advanceTimersByTime(59_999)
    expect(tab.calls).toEqual(['muted', 'unthrottled'])
    vi.advanceTimersByTime(1)
    expect(tab.calls).toEqual(['muted', 'unthrottled', 'throttled'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('pause media that starts before the tab is shown, and play it when shown', () => {
    const { unseen, media } = tabs()
    const tab = page()
    openAndLoad(unseen, tab)
    expect(unseen.mediaStarted(tab)).toBe(true)
    expect(media).toEqual(['pause'])
    expect(tab.calls).toEqual(['muted', 'unthrottled', 'throttled'])
    // Later documents load throttled, as Chromium no longer holds this page's media back.
    unseen.loadStopped(tab)
    unseen.loadStarted(tab)
    expect(tab.calls).toEqual(['muted', 'unthrottled', 'throttled'])
    // Media starting after the load (sound arrives after the page) is paused too.
    expect(unseen.mediaStarted(tab)).toBe(true)
    expect(media).toEqual(['pause', 'pause'])
    unseen.shown(tab)
    expect(tab.calls).toEqual(['muted', 'unthrottled', 'throttled', 'unmuted'])
    expect(media).toEqual(['pause', 'pause', 'resume'])
    // Shown, its media is its own business.
    expect(unseen.mediaStarted(tab)).toBe(false)
  })

  it('keep a mute the person chose, and the sound they turned back on', () => {
    const { unseen } = tabs()
    const quiet = page(true)
    openAndLoad(unseen, quiet)
    expect(quiet.calls).toEqual(['unthrottled'])
    expect(unseen.mutedUntilShown(quiet)).toBe(false)
    unseen.shown(quiet)
    expect(quiet.isAudioMuted()).toBe(true)

    const mutedLater = page()
    openAndLoad(unseen, mutedLater)
    unseen.mediaStarted(mutedLater)
    unseen.mutedByPerson(mutedLater)
    expect(unseen.mutedUntilShown(mutedLater)).toBe(false)
    unseen.shown(mutedLater)
    expect(mutedLater.calls).toEqual(['muted', 'unthrottled', 'throttled'])
    expect(mutedLater.isAudioMuted()).toBe(true)
  })

  it('leave no timer or entry behind when the page closes while loading', () => {
    const { unseen } = tabs()
    const tab = page()
    openAndLoad(unseen, tab)
    tab.destroy()
    unseen.forget(tab)
    expect(unseen.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    unseen.loadStarted(tab)
    expect(unseen.size).toBe(0)
  })

  it('give a tab put to sleep before it loads its sound back', () => {
    const { unseen } = tabs()
    const tab = page()
    unseen.opened(tab)
    unseen.forget(tab)
    expect(tab.calls).toEqual(['muted', 'unmuted'])
    expect(vi.getTimerCount()).toBe(0)
    // Loaded later (when shown), it is an ordinary tab.
    unseen.loadStarted(tab)
    expect(tab.calls).toHaveLength(2)
  })
})
