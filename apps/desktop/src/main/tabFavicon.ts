import { publicIconUrl, readAtMost, sniffImageType } from './faviconCache'

/**
 * Tab icons for the app window. A page chooses its icon address, so the app window (whose
 * session is the shell's own) must never load it: main fetches it through the page's own
 * session (a private tab's stays in memory), from public addresses only, and hands the shell
 * a small data: URL — or nothing.
 */
export const TAB_ICON_MAX_BYTES = 64 * 1024
/** Inline data: icons a page reports are passed on only up to this length. */
export const TAB_ICON_MAX_DATA_URL = 16 * 1024

/** A page-reported data: icon small enough to pass on as is, or null (not a data: image). '' when too large. */
export function inlineTabIcon(value: string): string | null {
  if (!/^data:image\//i.test(value)) return null
  return value.length <= TAB_ICON_MAX_DATA_URL ? value : ''
}

/** The icon as a data: URL, fetched with `fetchImpl` (the page's session); '' when it cannot be had safely. */
export async function fetchTabIcon(iconUrl: string, fetchImpl: (url: string, init: RequestInit) => Promise<Response>): Promise<string> {
  const inline = inlineTabIcon(iconUrl)
  if (inline !== null) return inline
  if (!publicIconUrl(iconUrl)) return ''
  try {
    const response = await fetchImpl(iconUrl, { redirect: 'follow', credentials: 'omit', signal: AbortSignal.timeout(5_000), headers: { accept: 'image/*' } })
    if ((response.url && !publicIconUrl(response.url)) || !response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return ''
    }
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    const bytes = await readAtMost(response, TAB_ICON_MAX_BYTES)
    if (!bytes?.byteLength) return ''
    const mime = type.startsWith('image/') ? type : sniffImageType(bytes)
    if (!mime || !/^image\/[a-z0-9.+-]+$/.test(mime)) return ''
    return `data:${mime};base64,${bytes.toString('base64')}`
  } catch {
    return ''
  }
}

/** Per-tab memory of icons already converted, so a page flipping between icons is not refetched. */
export class TabIconMemory {
  private readonly icons = new Map<string, string>()
  constructor(private readonly limit = 8) {}
  get(url: string): string | undefined {
    return this.icons.get(url)
  }
  set(url: string, data: string): void {
    this.icons.delete(url)
    this.icons.set(url, data)
    while (this.icons.size > this.limit) this.icons.delete(this.icons.keys().next().value!)
  }
}
