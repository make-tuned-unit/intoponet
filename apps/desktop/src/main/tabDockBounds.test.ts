import { describe, expect, it } from 'vitest'
import {
  pageViewBoundsForDock,
  shouldCloseTabDockFromNativeMouse,
  TAB_DOCK_HEIGHT_PX,
  TAB_DOCK_REVEAL_PX,
} from './tabDockBounds'

const panel = { x: 0, y: 50, width: 1200, height: 850 }
const viewportHeight = 900

describe('native page bounds for the hover tab dock', () => {
  it('exposes a 12px renderer reveal rail at the viewport bottom while closed', () => {
    const bounds = pageViewBoundsForDock(panel, viewportHeight, true, false)
    expect(bounds.y + bounds.height).toBe(viewportHeight - TAB_DOCK_REVEAL_PX)
    expect(bounds.width).toBe(panel.width)
  })

  it('exposes the 80px renderer dock on hover or focus', () => {
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
})
