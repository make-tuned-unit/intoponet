import type { NowPlayingSnapshot } from '@intoponet/browser-api'

/**
 * Video follows you: when a tab that is playing a video is left, its largest visible video floats
 * in picture-in-picture; returning to the tab docks it again. The scripts run in an isolated world
 * with a user gesture (Chromium only allows picture-in-picture after one).
 */

/** Isolated world for the picture-in-picture and now-playing scripts (others: popups, keys, pdf…). */
export const AUTO_PIP_WORLD_ID = 1313

/** The result of asking a page to float its video. A refusal leaves playback where it was. */
export type PipEnterResult = 'entered' | 'none' | 'refused'

/** Floats the page's largest playing, visible video. Any error resolves 'refused' and playback is untouched. */
export const ENTER_PIP_SCRIPT = `(async () => {
  try {
    if (document.pictureInPictureElement) return 'entered'
    if (!document.pictureInPictureEnabled) return 'refused'
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const area = (box) => box.width * box.height
    const candidates = [...document.querySelectorAll('video')].filter((video) => {
      if (video.paused || video.ended || video.readyState < 2 || video.disablePictureInPicture) return false
      const box = video.getBoundingClientRect()
      return box.width > 0 && box.height > 0 && box.right > 0 && box.bottom > 0 && box.left < viewport.width && box.top < viewport.height
    }).sort((a, b) => area(b.getBoundingClientRect()) - area(a.getBoundingClientRect()))
    if (!candidates.length) return 'none'
    await candidates[0].requestPictureInPicture()
    return 'entered'
  } catch (error) {
    return 'refused'
  }
})()`

/** Docks the video again when its tab is shown. Harmless when nothing floats. */
export const EXIT_PIP_SCRIPT = `(async () => {
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture()
    return true
  } catch (error) {
    return false
  }
})()`

/**
 * Resolves once the floating video is back in its page: the person closed the small window (or used
 * its back-to-tab button), or it was docked. Resolves at once when nothing floats.
 */
export const PIP_LEFT_SCRIPT = `new Promise((resolve) => {
  const video = document.pictureInPictureElement
  if (!video) { resolve('left'); return }
  video.addEventListener('leavepictureinpicture', () => resolve('left'), { once: true })
})`

/** Plays the page's paused media again, or pauses what is playing. Resolves what it did. */
export const TOGGLE_PLAYBACK_SCRIPT = `(() => {
  const media = [...document.querySelectorAll('video, audio')]
  const playing = media.filter((element) => !element.paused && !element.ended)
  if (playing.length) {
    for (const element of playing) element.pause()
    return 'paused'
  }
  const area = (element) => element.getBoundingClientRect().width * element.getBoundingClientRect().height
  const next = media.filter((element) => element.readyState >= 1 && !element.ended).sort((a, b) => area(b) - area(a))[0]
  if (!next) return 'none'
  next.play().catch(() => undefined)
  return 'playing'
})()`

/**
 * Pauses every video and audio playing in a document (open shadow roots too), for one frame. Nothing
 * is played again later: the person starts it. Resolves how many it paused.
 */
export const PAUSE_ALL_MEDIA_SCRIPT = `(() => {
  let paused = 0
  const visit = (root) => {
    for (const media of root.querySelectorAll('video, audio')) {
      if (!media.paused) { media.pause(); paused += 1 }
    }
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot) visit(element.shadowRoot)
  }
  visit(document)
  return paused
})()`

/** What the now-playing control shows about one tab (read from the tab, not stored). */
export type NowPlayingInfo = { title: string; muted: boolean }

type Entry = { playing: boolean; pip: boolean; held: boolean; since: number }

/**
 * Which tab the now-playing control stands for. A tab is listed while its media plays, while it
 * floats in picture-in-picture, or while the control paused it (so it can be played again).
 * Tabs that are not listed are forgotten when they close or move to another page.
 * The most recent listed tab that is not the one in front wins; the one in front only when nothing else is listed.
 */
export class NowPlaying {
  private readonly entries = new Map<string, Entry>()

  /** Records a change for a tab. A flag turning on counts as the tab's most recent activity. */
  update(tabId: string, change: Partial<Pick<Entry, 'playing' | 'pip' | 'held'>>, now: number): void {
    const entry = this.entries.get(tabId) ?? { playing: false, pip: false, held: false, since: now }
    const turnedOn = (key: 'playing' | 'pip' | 'held'): boolean => change[key] === true && !entry[key]
    const next: Entry = { ...entry, ...change }
    if (turnedOn('playing') || turnedOn('pip') || turnedOn('held')) next.since = now
    if (next.playing || next.pip || next.held) this.entries.set(tabId, next)
    else this.entries.delete(tabId)
  }

  /** The tab closed, or its page moved on: nothing is listed for it any more. */
  forget(tabId: string): void {
    this.entries.delete(tabId)
  }

  /** The tab the control shows, or null when nothing is listed. `info` returns null for a tab that is gone. */
  snapshot(shownTabId: string | null, info: (tabId: string) => NowPlayingInfo | null): NowPlayingSnapshot | null {
    const listed = [...this.entries.entries()]
      .filter(([id]) => id !== shownTabId && info(id) !== null)
      .sort((a, b) => b[1].since - a[1].since)
    const chosen = listed[0] ?? (shownTabId !== null && this.entries.has(shownTabId) && info(shownTabId) !== null ? [shownTabId, this.entries.get(shownTabId)!] as const : null)
    if (!chosen) return null
    const [tabId, entry] = chosen
    const meta = info(tabId)!
    return { tabId, title: meta.title, playing: entry.playing, muted: meta.muted, pip: entry.pip }
  }
}
