import type { BrowserPanelBounds } from '@intoponet/browser-api'

export const TAB_DOCK_REVEAL_PX = 12
export const TAB_DOCK_HEIGHT_PX = 80

/** Bounds for the opaque native page view, leaving renderer space for its dock. */
export function pageViewBoundsForDock(
  bounds: BrowserPanelBounds,
  viewportHeight: number,
  fullWidth: boolean,
  dockOpen: boolean,
): BrowserPanelBounds {
  const viewportLimitedHeight = Math.min(bounds.height, Math.max(0, viewportHeight - bounds.y))
  const reserved = fullWidth ? dockOpen ? TAB_DOCK_HEIGHT_PX : TAB_DOCK_REVEAL_PX : 0
  return {
    ...bounds,
    height: Math.max(0, viewportLimitedHeight - reserved),
  }
}

export function shouldCloseTabDockFromNativeMouse(input: {
  isActivePage: boolean
  fullWidth: boolean
  dockOpen: boolean
  eventType: string
}): boolean {
  return input.isActivePage && input.fullWidth && input.dockOpen &&
    (input.eventType === 'mouseMove' || input.eventType === 'mouseDown')
}
