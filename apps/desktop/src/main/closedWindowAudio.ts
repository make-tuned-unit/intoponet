/**
 * Pages silenced because the app window closed. Their tabs stay alive for the Dock to bring back, and
 * pausing their videos and audio elements (autoPip.ts) cannot reach everything that makes sound: a Web
 * Audio player has no element to pause, and a player inside a closed shadow root cannot be found. So
 * every page that could be heard is also muted as a whole, and stays muted when the window comes back:
 * it is heard again only once the person acts in that tab (a click or a key in its page, its play
 * control, its mute control). A tab the person had muted themselves is left alone, and stays muted.
 */
export type HushedPage = {
  isDestroyed: () => boolean
  isAudioMuted: () => boolean
  setAudioMuted: (muted: boolean) => void
}

export class ClosedWindowAudio<Page extends HushedPage & object> {
  /** Muted by this, not by the person. Weak: a page that goes away is forgotten with it. */
  private readonly hushed = new WeakSet<Page>()

  /** The app window closed: nothing in these pages is heard until the person acts in them. */
  windowClosed(pages: Iterable<Page>): void {
    for (const page of pages) {
      if (page.isDestroyed() || page.isAudioMuted()) continue
      page.setAudioMuted(true)
      this.hushed.add(page)
    }
  }

  /** The person acted in that tab: it is heard again. True when it had been silenced by the window closing. */
  personActed(page: Page): boolean {
    if (!this.hushed.delete(page)) return false
    if (!page.isDestroyed()) page.setAudioMuted(false)
    return true
  }

  /** The person muted or unmuted the tab themselves: their choice stands. */
  mutedByPerson(page: Page): void {
    this.hushed.delete(page)
  }

  /** Muted only by the window having closed (the tab strip shows the person's choice, not this). */
  silenced(page: Page): boolean {
    return this.hushed.has(page)
  }
}
