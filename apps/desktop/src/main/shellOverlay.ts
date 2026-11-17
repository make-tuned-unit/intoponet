import type { BrowserPanelBounds } from '@intoponet/browser-api'

/** The address the floated copy of the suggestions "goes to" when a row is clicked (it is never followed). */
export const SHELL_OVERLAY_PICK_SCHEME = 'intoponet-overlay:'

/**
 * Whether the address bar's suggestions need their floated copy: only while a shown page is under the list's box.
 * Over the globe or a panel of the app window the list shows as it is.
 */
export function shellOverlayNeeded(list: BrowserPanelBounds, pages: readonly BrowserPanelBounds[]): boolean {
  if (list.width <= 0 || list.height <= 0) return false
  return pages.some((page) => page.width > 0 && page.height > 0
    && list.x < page.x + page.width && list.x + list.width > page.x
    && list.y < page.y + page.height && list.y + list.height > page.y)
}

/** The row a click in the floated copy chose, from the address it asked for; null for anything else. */
export function shellOverlayPick(url: string): { index: number; meta: boolean; alt: boolean } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== SHELL_OVERLAY_PICK_SCHEME) return null
  const match = /^pick\/(\d{1,3})$/.exec(parsed.pathname.replace(/^\/+/, ''))
  if (!match) return null
  const index = Number(match[1])
  if (!Number.isInteger(index) || index > 99) return null
  return { index, meta: parsed.searchParams.get('meta') === '1', alt: parsed.searchParams.get('alt') === '1' }
}
