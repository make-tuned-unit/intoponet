import { describe, expect, it } from 'vitest'
import { parseBrowsingSettingsFile, sleepAfterMs, tabsDueForSleep, type SleepCandidate } from './tabSleep'

const tab = (id: string, extra: Partial<SleepCandidate> = {}): SleepCandidate => ({
  id, active: false, asleep: false, start: false, lastShownAt: 0, audible: false, capturing: false, downloading: false, ...extra,
})

describe('tab sleep', () => {
  it('maps the setting to a wait, or never', () => {
    expect(sleepAfterMs('never')).toBeNull()
    expect(sleepAfterMs('15m')).toBe(15 * 60_000)
    expect(sleepAfterMs('1h')).toBe(3_600_000)
    expect(sleepAfterMs('4h', 1_000)).toBe(240_000)
  })

  it('sleeps only background tabs out of sight long enough, never exempt ones', () => {
    const now = 10 * 3_600_000
    const tabs = [
      tab('old'),
      tab('recent', { lastShownAt: now - 60_000 }),
      tab('active', { active: true }),
      tab('asleep', { asleep: true }),
      tab('start', { start: true }),
      tab('music', { audible: true }),
      tab('call', { capturing: true }),
      tab('download', { downloading: true }),
    ]
    expect(tabsDueForSleep(tabs, now, 3_600_000)).toEqual(['old'])
    expect(tabsDueForSleep(tabs, now, null)).toEqual([])
  })

  it('reads the settings file with defaults', () => {
    expect(parseBrowsingSettingsFile(null)).toEqual({ pageAppearance: 'system', tabSleep: '1h', tabSwitchOrder: 'strip', tabArchive: 'off' })
    expect(parseBrowsingSettingsFile({ pageAppearance: 'dark', tabSleep: '15m', tabSwitchOrder: 'recent', tabArchive: '1w' })).toEqual({ pageAppearance: 'dark', tabSleep: '15m', tabSwitchOrder: 'recent', tabArchive: '1w' })
    expect(parseBrowsingSettingsFile({ tabSleep: '3d', tabSwitchOrder: 'random' })).toEqual({ pageAppearance: 'system', tabSleep: '1h', tabSwitchOrder: 'strip', tabArchive: 'off' })
  })
})
