import type { DatabaseSync } from 'node:sqlite'
import { httpUrl } from './chromiumBookmarks'
import { hasColumns } from './sqliteCopy'

/** At most this many pages come over from another browser's history (the newest). */
export const HISTORY_IMPORT_LIMIT = 5_000

export type ImportedVisit = { url: string; title: string; visitedAt: number }

const WEB_PAGES = `hidden = 0 AND (url LIKE 'https://%' OR url LIKE 'http://%')`

function checkSchema(db: DatabaseSync): void {
  if (!hasColumns(db, 'urls', ['id', 'url', 'title', 'last_visit_time', 'hidden'])) throw new Error('This is not a Chromium history file.')
}

/** How many web pages the history holds. */
export function countHistory(db: DatabaseSync): number {
  checkSchema(db)
  const row = db.prepare(`SELECT COUNT(*) AS n FROM urls WHERE ${WEB_PAGES}`).get() as { n?: unknown } | undefined
  return Number(row?.n ?? 0)
}

/**
 * The newest pages, one per address, with the time of their last visit (from `visits` when it
 * is there, otherwise the page's own last_visit_time).
 */
export function readHistory(db: DatabaseSync, limit = HISTORY_IMPORT_LIMIT): { visits: ImportedVisit[]; total: number } {
  checkSchema(db)
  const total = countHistory(db)
  const visitsTable = hasColumns(db, 'visits', ['url', 'visit_time'])
  const time = visitsTable ? `COALESCE((SELECT MAX(visit_time) FROM visits WHERE visits.url = urls.id), last_visit_time)` : 'last_visit_time'
  // Chromium's microseconds since 1601 are too large for a JavaScript number; milliseconds since 1970 are not.
  const rows = db.prepare(`SELECT url, title, ${time} / 1000 - 11644473600000 AS at FROM urls WHERE ${WEB_PAGES} ORDER BY at DESC LIMIT ?`).all(limit) as Array<{ url?: unknown; title?: unknown; at?: unknown }>
  const visits: ImportedVisit[] = []
  for (const row of rows) {
    const at = typeof row.at === 'number' && Number.isFinite(row.at) && row.at > 0 && row.at < 4_102_444_800_000 ? Math.round(row.at) : null
    if (!httpUrl(row.url) || at === null) continue
    visits.push({ url: row.url, title: typeof row.title === 'string' ? row.title.slice(0, 1_000) : '', visitedAt: at })
  }
  return { visits, total }
}
