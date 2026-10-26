import type { BrowserPanelBounds } from '@intoponet/browser-api'

export const TAB_DOCK_REVEAL_PX = 12
/** Search bar row + tab row. Keep in sync with `--dock-open-height` in tabDock.css. */
export const TAB_DOCK_HEIGHT_PX = 128
/** Keep in sync with `--dock-duration` / `--dock-ease` (ease-out cubic) in tabDock.css. */
export const TAB_DOCK_TWEEN_MS = 240

/** Ease-out cubic, matching CSS cubic-bezier(0.33, 1, 0.68, 1). */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return 1 - (1 - clamped) ** 3
}

/** Reserved dock height at `elapsedMs` into a tween from `from` to `to`. */
export function dockReserveAt(from: number, to: number, elapsedMs: number, durationMs = TAB_DOCK_TWEEN_MS): number {
  if (durationMs <= 0) return to
  return Math.round(from + (to - from) * easeOutCubic(elapsedMs / durationMs))
}

export function dockReserveTarget(fullWidth: boolean, dockOpen: boolean): number {
  return fullWidth ? dockOpen ? TAB_DOCK_HEIGHT_PX : TAB_DOCK_REVEAL_PX : 0
}

/**
 * Bounds for the opaque native page view, leaving renderer space for its dock.
 * `reservedPx` overrides the resting reservation while a dock tween is running.
 */
export function pageViewBoundsForDock(
  bounds: BrowserPanelBounds,
  viewportHeight: number,
  fullWidth: boolean,
  dockOpen: boolean,
  reservedPx?: number,
): BrowserPanelBounds {
  const viewportLimitedHeight = Math.min(bounds.height, Math.max(0, viewportHeight - bounds.y))
  const reserved = fullWidth ? reservedPx ?? dockReserveTarget(fullWidth, dockOpen) : 0
  return {
    ...bounds,
    height: Math.max(0, viewportLimitedHeight - reserved),
  }
}

/**
 * Pointer activity on the page dismisses the dock. A held dock (its search
 * field has focus) survives pointer movement, but a click on the page still
 * dismisses it, as clicking elsewhere would.
 */
export function shouldCloseTabDockFromNativeMouse(input: {
  isActivePage: boolean
  fullWidth: boolean
  dockOpen: boolean
  eventType: string
  held?: boolean
}): boolean {
  if (!input.isActivePage || !input.fullWidth || !input.dockOpen) return false
  if (input.eventType === 'mouseDown') return true
  return input.eventType === 'mouseMove' && !input.held
}
