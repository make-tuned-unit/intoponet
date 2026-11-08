/**
 * A tab opened out of sight (behind the shown tab, or in a workspace not shown) loads at the speed of a
 * shown one, and stays silent until it is shown.
 *
 * Chromium treats a page that is not on screen as hidden: its timers wake at most once a second, its
 * pictures load a few at a time and its renderer runs at background priority. A page whose loading
 * waits on a chain of short timers (as script loaders do) took 33 s instead of 1.5 s, and a busy Mac
 * starved a hidden renderer (25 s against 2.4 s). So while a tab that has never been shown loads,
 * throttling is off; it is back on once the page stops loading (or after `limitMs`, for a page that
 * never stops), when the page is hidden and throttled like any background tab.
 *
 * Without throttling Chromium also stops holding back the page's media, which it otherwise starts only
 * once the tab is first shown. So a tab is muted until it is first shown, and media that starts before
 * then is paused (with throttling back on at once); it plays, and is heard, when the tab is shown. A
 * tab the person mutes or unmutes keeps their choice.
 */
export type UnseenPage = {
  isDestroyed: () => boolean
  setBackgroundThrottling: (allowed: boolean) => void
  isAudioMuted: () => boolean
  setAudioMuted: (muted: boolean) => void
}

export type UnseenMedia<Page> = {
  /** Pauses the page's playing media, remembering it so `resume` can play it again. */
  pause: (page: Page) => void
  resume: (page: Page) => void
}

type Entry = {
  /** Throttling is off until this fires (null while it is on). */
  limit: ReturnType<typeof setTimeout> | null
  /** Muted by this (not by the person), to be heard again when shown. */
  muted: boolean
  /** Its media started out of sight and was paused, to play when shown. */
  held: boolean
}

export class UnseenTabs<Page extends UnseenPage> {
  /** Tabs made out of sight and not shown since. */
  private readonly entries = new Map<Page, Entry>()

  constructor(private readonly media: UnseenMedia<Page>, private readonly limitMs = 60_000) {}

  /**
   * A tab was made out of sight: muted until it is shown. Throttling goes off when its first load starts
   * (turned off earlier, before the page had a document, it sometimes never reached the renderer the
   * page loaded in, which then took 23 s and over a minute, as before).
   */
  opened(page: Page): void {
    if (page.isDestroyed() || this.entries.has(page)) return
    const entry: Entry = { limit: null, muted: false, held: false }
    this.entries.set(page, entry)
    if (!page.isAudioMuted()) {
      page.setAudioMuted(true)
      entry.muted = true
    }
  }

  /** Its page started loading a new document: unthrottled until it stops, if it has never been shown. */
  loadStarted(page: Page): void {
    const entry = this.entries.get(page)
    if (!entry || entry.held || page.isDestroyed()) return
    if (entry.limit) clearTimeout(entry.limit)
    else page.setBackgroundThrottling(false)
    entry.limit = setTimeout(() => this.loadStopped(page), this.limitMs)
    entry.limit.unref?.()
  }

  /** It stopped loading: throttled again, as any tab out of sight. */
  loadStopped(page: Page): void {
    const entry = this.entries.get(page)
    if (entry) this.throttle(page, entry)
  }

  /**
   * Its media started playing. True when the tab has never been shown: the media is paused (and
   * throttling back on) until the tab is shown, so it is not listed as playing.
   */
  mediaStarted(page: Page): boolean {
    const entry = this.entries.get(page)
    if (!entry || page.isDestroyed()) return false
    this.throttle(page, entry)
    entry.held = true
    this.media.pause(page)
    return true
  }

  /** It is on screen: as any shown tab, heard, and its held media plays. */
  shown(page: Page): void {
    const entry = this.entries.get(page)
    if (!entry) return
    this.forget(page)
    if (entry.held && !page.isDestroyed()) this.media.resume(page)
  }

  /** The person muted or unmuted it: their choice stays when it is shown. */
  mutedByPerson(page: Page): void {
    const entry = this.entries.get(page)
    if (entry) entry.muted = false
  }

  /** Muted only by this until it is shown (the tab strip shows the person's choice, not this). */
  mutedUntilShown(page: Page): boolean {
    return this.entries.get(page)?.muted === true
  }

  /** It closed, or sleeps until shown: throttled and heard as any tab, and nothing is kept for it. */
  forget(page: Page): void {
    const entry = this.entries.get(page)
    if (!entry) return
    this.entries.delete(page)
    this.throttle(page, entry)
    if (entry.muted && !page.isDestroyed()) page.setAudioMuted(false)
  }

  /** Tabs loading without throttling now. */
  get loading(): number {
    return [...this.entries.values()].filter((entry) => entry.limit !== null).length
  }

  /** Tabs not shown since they were made out of sight. */
  get size(): number {
    return this.entries.size
  }

  private throttle(page: Page, entry: Entry): void {
    if (!entry.limit) return
    clearTimeout(entry.limit)
    entry.limit = null
    if (!page.isDestroyed()) page.setBackgroundThrottling(true)
  }
}
