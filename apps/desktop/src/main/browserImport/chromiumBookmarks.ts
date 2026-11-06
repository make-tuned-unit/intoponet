/**
 * Chromium's "Bookmarks" file: JSON with `roots` (bookmark_bar, other, synced), each a folder
 * of `url` and `folder` nodes. Folders become collections named after their path, so nesting
 * stays readable ("Travel › Japan"); pages straight in a root go into a collection named after it.
 */

export type ImportedFolder = {
  /** Collection name, at most 80 characters. */
  label: string
  pages: Array<{ url: string; title: string; addedAt: string | null }>
}

const ROOT_LABELS: Record<string, string> = {
  bookmark_bar: 'Bookmarks bar',
  other: 'Other bookmarks',
  synced: 'Mobile bookmarks',
}

export const MAX_BOOKMARKS = 20_000
const MAX_DEPTH = 24

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function httpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8_192) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch {
    return false
  }
}

/** Chromium times are microseconds since 1601-01-01 (as decimal strings in Bookmarks). */
export function chromiumTime(value: unknown): number | null {
  const micros = typeof value === 'string' && /^\d{1,20}$/.test(value) ? Number(value) : typeof value === 'number' ? value : NaN
  if (!Number.isFinite(micros) || micros <= 0) return null
  const ms = micros / 1000 - 11_644_473_600_000
  return ms > 0 && ms < 4_102_444_800_000 ? Math.round(ms) : null
}

export const joinLabel = (parts: string[]): string => parts.map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' › ').slice(0, 80)

/**
 * Parse a Bookmarks file. Throws when it is not one (a file that cannot be read whole is not
 * imported in part). Addresses other than http(s) (javascript:, chrome:, file:) are counted as skipped.
 */
export function parseChromiumBookmarks(text: string): { folders: ImportedFolder[]; skipped: number } {
  const raw = JSON.parse(text) as unknown
  if (!isRecord(raw) || !isRecord(raw['roots'])) throw new Error('This is not a Chromium bookmarks file.')
  const roots = raw['roots']
  const byLabel = new Map<string, ImportedFolder>()
  let skipped = 0
  let total = 0
  const folderFor = (label: string): ImportedFolder => {
    let folder = byLabel.get(label)
    if (!folder) {
      folder = { label, pages: [] }
      byLabel.set(label, folder)
    }
    return folder
  }
  const walk = (node: Record<string, unknown>, path: string[], rootLabel: string, depth: number): void => {
    if (depth > MAX_DEPTH) return
    const children = Array.isArray(node['children']) ? node['children'] : []
    for (const child of children) {
      if (!isRecord(child)) continue
      if (child['type'] === 'url') {
        const url = child['url']
        if (!httpUrl(url) || total >= MAX_BOOKMARKS) {
          skipped += 1
          continue
        }
        total += 1
        const label = path.length ? joinLabel(path) : rootLabel
        const added = chromiumTime(child['date_added'])
        const folder = folderFor(label)
        if (!folder.pages.some((page) => page.url === url)) {
          folder.pages.push({ url, title: typeof child['name'] === 'string' ? child['name'].slice(0, 180) : '', addedAt: added ? new Date(added).toISOString() : null })
        }
      } else if (child['type'] === 'folder') {
        const name = typeof child['name'] === 'string' && child['name'].trim() ? child['name'] : 'Untitled folder'
        walk(child, [...path, name], rootLabel, depth + 1)
      }
    }
  }
  for (const [key, node] of Object.entries(roots)) {
    if (!isRecord(node) || node['type'] !== 'folder') continue
    const rootLabel = ROOT_LABELS[key] ?? (typeof node['name'] === 'string' && node['name'].trim() ? node['name'].slice(0, 80) : 'Bookmarks')
    walk(node, [], rootLabel, 0)
  }
  return { folders: [...byLabel.values()].filter((folder) => folder.pages.length > 0), skipped }
}
