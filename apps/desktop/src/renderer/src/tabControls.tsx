// Pieces shared by the horizontal tab strip and the vertical tab rail: the tab's icon (or a
// loading spinner), its speaker button, its context menu, and drag / keyboard reordering.
import { Globe2, Volume2, VolumeX } from 'lucide-react'
import { useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import type { PageTabSnapshot } from '@intoponet/browser-api'
import { dropIndex, reorderDelta, type TabBox, type TabAxis } from './tabReorder'
import './tabControls.css'

/** The tab's favicon, or a spinner while its page loads. */
export function TabIcon({ tab, size }: { tab: PageTabSnapshot; size: number }) {
  if (tab.loading) return <span className="tab-spinner" style={{ width: size, height: size }} aria-hidden="true" />
  if (tab.favicon) return <img src={tab.favicon} alt="" width={size} height={size} />
  return <Globe2 size={size - 2} aria-hidden="true" />
}

/** How a tab's sound reads to assistive technology (the speaker button itself is a pointer shortcut). */
export function tabSoundLabel(tab: PageTabSnapshot): string {
  return tab.muted ? ', muted' : tab.audible ? ', playing sound' : ''
}

/**
 * Speaker for a tab playing sound (or muted): clicking it mutes or unmutes the tab.
 * When not focusable it is also hidden from assistive technology (a tab list may only hold tabs);
 * keyboard users mute from the tab menu, and the tab's own name says it is playing or muted.
 */
export function TabAudioButton({ tab, className, focusable = true }: { tab: PageTabSnapshot; className: string; focusable?: boolean }) {
  if (!tab.audible && !tab.muted) return null
  const label = `${tab.muted ? 'Unmute' : 'Mute'} ${tab.title || 'tab'}`
  return (
    <button
      type="button"
      className={`${className}${tab.muted ? ' is-muted' : ''}`}
      aria-label={label}
      title={tab.muted ? 'Unmute this tab' : 'Mute this tab'}
      tabIndex={focusable ? undefined : -1}
      aria-hidden={focusable ? undefined : true}
      onClick={(event) => {
        event.stopPropagation()
        void window.intoponet.browserHost.setTabMuted(tab.id, !tab.muted)
      }}
    >
      {tab.muted ? <VolumeX size={12} aria-hidden="true" /> : <Volume2 size={12} aria-hidden="true" />}
    </button>
  )
}

/** Right-click (or the keyboard's context-menu key) on a tab: the native tab menu. */
export function openTabMenu(event: MouseEvent<HTMLElement>, id: string): void {
  event.preventDefault()
  let { clientX: x, clientY: y } = event
  if (x === 0 && y === 0) {
    // From the keyboard: under the tab.
    const box = event.currentTarget.getBoundingClientRect()
    x = box.left + 8
    y = box.bottom
  }
  void window.intoponet.browserHost.showTabMenu(id, { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) })
}

/** Keyboard reorder for a focused tab; returns the tab's new index, or null when the key was not a move. */
export function moveTabByKey(event: KeyboardEvent, tabs: PageTabSnapshot[], index: number, axis: TabAxis): number | null {
  const delta = reorderDelta(event, axis)
  const tab = tabs[index]
  if (delta === 0 || !tab) return null
  event.preventDefault()
  event.stopPropagation()
  const pinnedCount = tabs.filter((item) => item.pinned).length
  const [min, max] = tab.pinned ? [0, pinnedCount - 1] : [pinnedCount, tabs.length - 1]
  const to = Math.min(max, Math.max(min, index + delta))
  if (to !== index) void window.intoponet.browserHost.moveTab(tab.id, to)
  return to
}

const DRAG_THRESHOLD = 5

type Drag = {
  id: string
  index: number
  pointerId: number
  startX: number
  startY: number
  item: HTMLElement
  boxes: TabBox[] | null
}

/**
 * Drag a tab to a new place with the pointer. Spread `handlers(tab, index)` on the tab's button;
 * the element carrying `data-tab-id` (the whole tab) follows the pointer while dragging.
 */
export function useTabDrag(axis: TabAxis) {
  const drag = useRef<Drag | null>(null)
  const justDragged = useRef(false)

  const finish = (event: PointerEvent<HTMLElement>, commit: boolean): void => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    drag.current = null
    if (!state.boxes) return
    state.item.style.removeProperty('translate')
    state.item.classList.remove('is-dragging')
    justDragged.current = true
    window.setTimeout(() => { justDragged.current = false }, 0)
    if (!commit) return
    const to = dropIndex(state.boxes, state.index, { x: event.clientX, y: event.clientY }, axis)
    if (to !== state.index) void window.intoponet.browserHost.moveTab(state.id, to)
  }

  return (tab: PageTabSnapshot, index: number) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || event.pointerType === 'touch') return
      const item = event.currentTarget.closest<HTMLElement>('[data-tab-id]')
      if (!item) return
      drag.current = { id: tab.id, index, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, item, boxes: null }
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const state = drag.current
      if (!state || state.pointerId !== event.pointerId) return
      const dx = event.clientX - state.startX
      const dy = event.clientY - state.startY
      if (!state.boxes) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        // Where every tab sits before anything moves.
        const list = state.item.closest('[role="tablist"]')
        state.boxes = [...(list?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? [])].map((element) => {
          const rect = element.getBoundingClientRect()
          return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        })
        event.currentTarget.setPointerCapture(event.pointerId)
        state.item.classList.add('is-dragging')
      }
      state.item.style.setProperty('translate', axis === 'x' ? `${dx}px 0` : `${dx}px ${dy}px`)
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event, true),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, false),
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      // The click that ends a drag does not also select the tab.
      if (justDragged.current) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
  })
}
