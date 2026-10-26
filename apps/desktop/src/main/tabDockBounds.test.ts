import { describe, expect, it } from 'vitest'
import {
  dockReserveAt,
  dockReserveTarget,
  easeOutCubic,
  pageViewBoundsForDock,
  shouldCloseTabDockFromNativeMouse,
  TAB_DOCK_HEIGHT_PX,
  TAB_DOCK_REVEAL_PX,
  TAB_DOCK_TWEEN_MS,
} from './tabDockBounds'

const panel = { x: 0, y: 50, width: 1200, height: 850 }
const viewportHeight = 900

describe('native page bounds for the hover tab dock', () => {
  it('exposes a 12px renderer reveal rail at the viewport bottom while closed', () => {
    const bounds = pageViewBoundsForDock(panel, viewportHeight, true, false)
    expect(bounds.y + bounds.height).toBe(viewportHeight - TAB_DOCK_REVEAL_PX)
    expect(bounds.width).toBe(panel.width)
  })

  it('exposes the full search-and-tabs dock on hover or focus', () => {
    const bounds = pageViewBoundsForDock(panel, viewportHeight, true, true)
    expect(bounds.y + bounds.height).toBe(viewportHeight - TAB_DOCK_HEIGHT_PX)
    expect(bounds.width).toBe(panel.width)
  })

  it('retains the dock opening across native tab switches and restores viewport on exit', () => {
    const switchedTabBounds = pageViewBoundsForDock({ ...panel, width: 1200 }, viewportHeight, true, true)
    expect(switchedTabBounds.y + switchedTabBounds.height).toBe(viewportHeight - TAB_DOCK_HEIGHT_PX)

    const exitedBounds = pageViewBoundsForDock(panel, viewportHeight, false, true)
    expect(exitedBounds).toEqual(panel)
  })

  it('clamps page content to the viewport when renderer bounds extend past it', () => {
    const bounds = pageViewBoundsForDock({ ...panel, height: 1000 }, viewportHeight, true, false)
    expect(bounds.y + bounds.height).toBe(viewportHeight - TAB_DOCK_REVEAL_PX)
  })

  it('never lets the native page view overflow a short available viewport', () => {
    const bounds = pageViewBoundsForDock({ x: 0, y: 590, width: 900, height: 180 }, 620, true, true)
    expect(bounds.height).toBe(0)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(620)
  })

  it('closes only when mouse movement or a click enters the active native page', () => {
    expect(shouldCloseTabDockFromNativeMouse({
      isActivePage: true, fullWidth: true, dockOpen: true, eventType: 'mouseMove',
    })).toBe(true)
    expect(shouldCloseTabDockFromNativeMouse({
      isActivePage: true, fullWidth: true, dockOpen: true, eventType: 'mouseDown',
    })).toBe(true)
    expect(shouldCloseTabDockFromNativeMouse({
      isActivePage: false, fullWidth: true, dockOpen: true, eventType: 'mouseMove',
    })).toBe(false)
    expect(shouldCloseTabDockFromNativeMouse({
      isActivePage: true, fullWidth: false, dockOpen: true, eventType: 'mouseMove',
    })).toBe(false)
    expect(shouldCloseTabDockFromNativeMouse({
      isActivePage: true, fullWidth: true, dockOpen: false, eventType: 'mouseDown',
    })).toBe(false)
    expect(shouldCloseTabDockFromNativeMouse({
      isActivePage: true, fullWidth: true, dockOpen: true, eventType: 'mouseWheel',
    })).toBe(false)
  })

  it('keeps a held dock (search focused) open while the pointer crosses the page', () => {
    const held = { isActivePage: true, fullWidth: true, dockOpen: true, held: true }
    expect(shouldCloseTabDockFromNativeMouse({ ...held, eventType: 'mouseMove' })).toBe(false)
    // A click on the page still dismisses it, as clicking elsewhere would.
    expect(shouldCloseTabDockFromNativeMouse({ ...held, eventType: 'mouseDown' })).toBe(true)
  })
})

describe('dock reservation tween', () => {
  it('eases out from the reveal rail to the open dock and lands exactly', () => {
    const from = TAB_DOCK_REVEAL_PX
    const to = TAB_DOCK_HEIGHT_PX
    expect(dockReserveAt(from, to, 0)).toBe(from)
    expect(dockReserveAt(from, to, TAB_DOCK_TWEEN_MS)).toBe(to)
    expect(dockReserveAt(from, to, TAB_DOCK_TWEEN_MS * 4)).toBe(to)
    // Ease-out: more than half the travel in the first third.
    expect(dockReserveAt(from, to, TAB_DOCK_TWEEN_MS / 3)).toBeGreaterThan(from + (to - from) / 2)
    let previous = from
    for (let t = 0; t <= TAB_DOCK_TWEEN_MS; t += 8) {
      const value = dockReserveAt(from, to, t)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })

  it('reverses symmetrically and never overshoots', () => {
    for (let t = 0; t <= TAB_DOCK_TWEEN_MS; t += 8) {
      const value = dockReserveAt(TAB_DOCK_HEIGHT_PX, TAB_DOCK_REVEAL_PX, t)
      expect(value).toBeLessThanOrEqual(TAB_DOCK_HEIGHT_PX)
      expect(value).toBeGreaterThanOrEqual(TAB_DOCK_REVEAL_PX)
    }
    expect(easeOutCubic(-1)).toBe(0)
    expect(easeOutCubic(2)).toBe(1)
  })

  it('uses the tween value in place of the resting reservation', () => {
    expect(dockReserveTarget(false, true)).toBe(0)
    const bounds = pageViewBoundsForDock(panel, viewportHeight, true, true, 60)
    expect(bounds.y + bounds.height).toBe(viewportHeight - 60)
    expect(pageViewBoundsForDock(panel, viewportHeight, false, true, 60)).toEqual(panel)
  })
})
