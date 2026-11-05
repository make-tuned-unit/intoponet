import type { DownloadEntry, HistoryDay } from '@intoponet/browser-api'

/** "YYYY-MM-DD" for a time in this Mac's time zone (matches the main process's grouping). */
export function localDayKey(time: number): string {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** "Today", "Yesterday", or a date ("Monday, 3 November"). */
export function dayLabel(day: string, now = Date.now()): string {
  if (day === localDayKey(now)) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (day === localDayKey(yesterday.getTime())) return 'Yesterday'
  const [year, month, date] = day.split('-').map(Number)
  const value = new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1)
  return value.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(value.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}),
  })
}

/** Append a further page of results (its first day may continue the last one). */
export function mergeDays(existing: HistoryDay[], incoming: HistoryDay[]): HistoryDay[] {
  const merged = existing.map((day) => ({ ...day, visits: [...day.visits] }))
  for (const day of incoming) {
    const last = merged.at(-1)
    if (last?.day === day.day) last.visits.push(...day.visits)
    else merged.push({ ...day, visits: [...day.visits] })
  }
  return merged
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1_000) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1_000
  let unit = 0
  while (value >= 1_000 && unit < units.length - 1) {
    value /= 1_000
    unit += 1
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** 0–1, or null when the size is unknown. */
export function downloadFraction(entry: Pick<DownloadEntry, 'receivedBytes' | 'totalBytes' | 'state'>): number | null {
  if (entry.state === 'completed') return 1
  if (!entry.totalBytes) return null
  return Math.max(0, Math.min(1, entry.receivedBytes / entry.totalBytes))
}

/** One line under the filename. */
export function downloadStatus(entry: DownloadEntry): string {
  if (entry.attention === 'dangerous-type') return 'This type of file can harm your Mac.'
  if (entry.attention === 'multiple-downloads') return 'This site wants to download multiple files.'
  const size = entry.totalBytes ? `${formatBytes(entry.receivedBytes)} of ${formatBytes(entry.totalBytes)}` : formatBytes(entry.receivedBytes)
  switch (entry.state) {
    case 'progressing': {
      if (!entry.bytesPerSecond) return size
      const left = entry.totalBytes > entry.receivedBytes ? (entry.totalBytes - entry.receivedBytes) / entry.bytesPerSecond : null
      return `${size} · ${formatBytes(entry.bytesPerSecond)}/s${left !== null ? ` · ${formatRemaining(left)} left` : ''}`
    }
    case 'paused': return `Paused · ${size}`
    case 'completed': return entry.exists ? formatBytes(entry.totalBytes || entry.receivedBytes) : 'Moved or deleted'
    case 'cancelled': return entry.error ?? 'Cancelled'
    case 'interrupted': return entry.error ?? 'Failed'
  }
}

export function formatRemaining(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`
  if (seconds < 3_600) return `${Math.round(seconds / 60)} min`
  return `${Math.round(seconds / 3_600)} h`
}

/** Progress for the toolbar ring: active downloads together (null when sizes are unknown). */
export function overallProgress(entries: DownloadEntry[]): { active: number; fraction: number | null } {
  const active = entries.filter((entry) => entry.state === 'progressing' || entry.state === 'paused')
  if (!active.length) return { active: 0, fraction: null }
  if (active.some((entry) => !entry.totalBytes)) return { active: active.length, fraction: null }
  const total = active.reduce((sum, entry) => sum + entry.totalBytes, 0)
  const received = active.reduce((sum, entry) => sum + entry.receivedBytes, 0)
  return { active: active.length, fraction: total ? Math.min(1, received / total) : null }
}

/** The library's recent pages without what was just removed from history. */
export function forgetRecentPages<T extends { url: string; visitedAt: string }>(
  recents: T[],
  forget: { urls: string[] } | { day: string } | { since: number },
): T[] {
  const next = recents.filter((page) => {
    if ('urls' in forget) return !forget.urls.includes(page.url)
    const time = Date.parse(page.visitedAt)
    if (!Number.isFinite(time)) return true
    if ('day' in forget) return localDayKey(time) !== forget.day
    return time < forget.since
  })
  return next.length === recents.length ? recents : next
}
