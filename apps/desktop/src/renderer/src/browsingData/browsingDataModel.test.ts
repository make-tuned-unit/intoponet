import { describe, expect, it } from 'vitest'
import type { DownloadEntry } from '@intoponet/browser-api'
import { dayLabel, downloadFraction, downloadStatus, forgetRecentPages, formatBytes, localDayKey, mergeDays, overallProgress } from './browsingDataModel'

const NOON = new Date(2026, 10, 5, 12).getTime()
const entry = (patch: Partial<DownloadEntry>): DownloadEntry => ({
  id: 'a', filename: 'a.txt', origin: 'https://example.com', state: 'progressing', receivedBytes: 0, totalBytes: 0,
  bytesPerSecond: 0, startedAt: 0, endedAt: null, isPrivate: false, exists: false, live: true, canRetry: false,
  attention: null, note: null, error: null, ...patch,
})

describe('history presentation', () => {
  it('labels today and yesterday, and dates before that', () => {
    expect(dayLabel(localDayKey(NOON), NOON)).toBe('Today')
    expect(dayLabel(localDayKey(NOON - 86_400_000), NOON)).toBe('Yesterday')
    expect(dayLabel('2026-11-01', NOON)).not.toMatch(/Today|Yesterday/)
  })
  it('joins a page of results that continues the last day', () => {
    const visit = (id: string) => ({ id, url: 'https://x.example/', title: id, host: 'x.example', visitedAt: 0 })
    const merged = mergeDays([{ day: '2026-11-05', visits: [visit('1')] }], [{ day: '2026-11-05', visits: [visit('2')] }, { day: '2026-11-04', visits: [visit('3')] }])
    expect(merged.map((day) => [day.day, day.visits.map((v) => v.id)])).toEqual([['2026-11-05', ['1', '2']], ['2026-11-04', ['3']]])
  })
  it('drops the matching recent pages when history is removed', () => {
    const recents = [
      { url: 'https://a.example/', visitedAt: new Date(NOON).toISOString() },
      { url: 'https://b.example/', visitedAt: new Date(NOON - 86_400_000).toISOString() },
    ]
    expect(forgetRecentPages(recents, { urls: ['https://a.example/'] }).map((p) => p.url)).toEqual(['https://b.example/'])
    expect(forgetRecentPages(recents, { day: localDayKey(NOON) }).map((p) => p.url)).toEqual(['https://b.example/'])
    expect(forgetRecentPages(recents, { since: NOON - 3_600_000 }).map((p) => p.url)).toEqual(['https://b.example/'])
    expect(forgetRecentPages(recents, { since: 0 })).toEqual([])
    expect(forgetRecentPages(recents, { urls: [] })).toBe(recents)
  })
})

describe('download presentation', () => {
  it('formats sizes, progress and status lines', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1_500_000)).toBe('1.5 MB')
    expect(downloadFraction(entry({ receivedBytes: 50, totalBytes: 200 }))).toBe(0.25)
    expect(downloadFraction(entry({ totalBytes: 0 }))).toBeNull()
    expect(downloadStatus(entry({ receivedBytes: 500_000, totalBytes: 1_000_000, bytesPerSecond: 100_000 }))).toBe('500 KB of 1.0 MB · 100 KB/s · 5 s left')
    expect(downloadStatus(entry({ state: 'paused', receivedBytes: 10, totalBytes: 20 }))).toMatch(/^Paused/)
    expect(downloadStatus(entry({ attention: 'dangerous-type' }))).toMatch(/harm your Mac/)
    expect(downloadStatus(entry({ state: 'completed', exists: false }))).toBe('Moved or deleted')
  })
  it('sums active downloads for the toolbar ring', () => {
    expect(overallProgress([entry({ state: 'completed' })])).toEqual({ active: 0, fraction: null })
    expect(overallProgress([entry({ receivedBytes: 1, totalBytes: 4 }), entry({ id: 'b', receivedBytes: 3, totalBytes: 4 })])).toEqual({ active: 2, fraction: 0.5 })
    expect(overallProgress([entry({ totalBytes: 0 })]).fraction).toBeNull()
  })
})
