import { TAB_SLEEP_AFTER, TAB_SWITCH_ORDERS, type TabArchiveAfter, type TabSleepAfter, type TabSwitchOrder } from '@intoponet/browser-api'
import { DEFAULT_TAB_ARCHIVE, isTabArchiveAfter } from './tabArchive'
import { parsePageAppearanceFile } from './pageAppearance'

/**
 * Background tabs sleep: after the chosen time out of sight, a tab's page is unloaded (its
 * back/forward list and scroll position kept) and loads again where it was when shown. Tabs
 * playing sound, using the camera or microphone, downloading, or holding typed form text stay awake.
 */

const MINUTE = 60_000
const AFTER_MINUTES: Record<TabSleepAfter, number | null> = { never: null, '15m': 15, '1h': 60, '4h': 240 }
export const DEFAULT_TAB_SLEEP: TabSleepAfter = '1h'

/** How long a tab waits before sleeping, or null for never. `minuteMs` is shortened only by checks. */
export function sleepAfterMs(after: TabSleepAfter, minuteMs = MINUTE): number | null {
  const minutes = AFTER_MINUTES[after]
  return minutes === null ? null : minutes * minuteMs
}

export type SleepCandidate = {
  id: string
  /** The tab being shown (or last shown, with the globe in front): never put to sleep. */
  active: boolean
  asleep: boolean
  start: boolean
  /** When it was last shown or left. */
  lastShownAt: number
  audible: boolean
  /** Camera or microphone asked for by its page. */
  capturing: boolean
  downloading: boolean
}

/** Tabs out of sight long enough and free of the exemptions; typed form text is checked in the page afterwards. */
export function tabsDueForSleep(tabs: readonly SleepCandidate[], now: number, afterMs: number | null): string[] {
  if (afterMs === null) return []
  return tabs
    .filter((tab) => !tab.active && !tab.asleep && !tab.start && !tab.audible && !tab.capturing && !tab.downloading && now - tab.lastShownAt >= afterMs)
    .map((tab) => tab.id)
}

/** Run in the page (isolated world): has someone typed into a field that has not been sent? */
export const TYPED_FORM_SCRIPT = `(() => {
  const changed = (element) => {
    if (element instanceof HTMLTextAreaElement) return element.value !== element.defaultValue
    if (element instanceof HTMLSelectElement) return [...element.options].some((option) => option.selected !== option.defaultSelected)
    if (!(element instanceof HTMLInputElement) || element.type === 'hidden') return false
    if (element.type === 'checkbox' || element.type === 'radio') return element.checked !== element.defaultChecked
    return element.value !== element.defaultValue
  }
  if ([...document.querySelectorAll('input, textarea, select')].some(changed)) return true
  // A rich-text editor with focus is being written in.
  const active = document.activeElement
  return !!active && active.isContentEditable
})()`

export type BrowsingSettingsFile = { pageAppearance: ReturnType<typeof parsePageAppearanceFile>; tabSleep: TabSleepAfter; tabSwitchOrder: TabSwitchOrder; tabArchive: TabArchiveAfter }

/** browsing-settings.json, with defaults for anything missing or damaged. */
export function parseBrowsingSettingsFile(raw: unknown): BrowsingSettingsFile {
  const record = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const sleep = record['tabSleep']
  const order = record['tabSwitchOrder']
  return {
    pageAppearance: parsePageAppearanceFile(raw),
    tabSleep: typeof sleep === 'string' && (TAB_SLEEP_AFTER as readonly string[]).includes(sleep) ? sleep as TabSleepAfter : DEFAULT_TAB_SLEEP,
    tabSwitchOrder: typeof order === 'string' && (TAB_SWITCH_ORDERS as readonly string[]).includes(order) ? order as TabSwitchOrder : 'strip',
    tabArchive: isTabArchiveAfter(record['tabArchive']) ? record['tabArchive'] : DEFAULT_TAB_ARCHIVE,
  }
}
