// Pieces shared by the horizontal tab strip and the vertical tab rail: the tab's icon (or a
// loading spinner), its speaker button, its context menu, and drag / keyboard reordering.
import { Globe2, House, Volume2, VolumeX } from 'lucide-react'
import { useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import type { PageTabSnapshot } from '@intoponet/browser-api'
import { dropIndex, reorderDelta, type TabBox, type TabAxis } from './tabReorder'
import { splitDropSide } from '../../shared/splitDrop'
import './tabControls.css'

type SplitSide = 'left' | 'right'

/** The tab's favicon, or a spinner while its page loads. */
export function TabIcon({ tab, size }: { tab: PageTabSnapshot; size: number }) {
  if (tab.loading) return <span className="tab-spinner" style={{ width: size, height: size }} aria-hidden="true" />
  // Only data: icons (main fetched them through the page's own session): the shell never loads a page-chosen URL.
  if (tab.favicon?.startsWith('data:image/')) return <img src={tab.favicon} alt="" width={size} height={size} />
  return <Globe2 size={size - 2} aria-hidden="true" />
}

/** A tab's state beyond its sound, as assistive technology reads it. */
export function tabStateLabel(tab: PageTabSnapshot): string {
  return `${tab.asleep ? ', asleep' : ''}${tab.awayFromHome ? ', away from its pinned page' : ''}`
}

/**
 * A pinned tab now on another site: a way back to the page it was pinned at. Like the speaker it is a
 * pointer shortcut, out of the tab list for assistive technology; the tab menu has "Go to Pinned Page".
 */
export function TabHomeButton({ tab, className }: { tab: PageTabSnapshot; className: string }) {
  if (!tab.awayFromHome) return null
  return (
    <button
      type="button"
      className={className}
      tabIndex={-1}
      aria-hidden="true"
      title="Back to the pinned page"
      onClick={(event) => {
        event.stopPropagation()
        void window.intoponet.browserHost.goTabHome(tab.id)
      }}
    >
      <House size={12} />
    </button>
  )
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
  /** The tab ids of `boxes`, in the same order. */
  ids: string[]
  /** The edge of the page the dragged tab is over (its drop would split the page), if any. */
  preview: SplitSide | null
}

/**
 * Where a tab dragged to (x, y) would be split in beside the shown page: the page's left or right
 * edge. Null over the sidebar, in the page's middle, or for the shown tab itself.
 */
function splitDropFor(x: number, y: number, draggedId: string, shownId: string | undefined): SplitSide | null {
  if (!shownId || draggedId === shownId) return null
  const body = document.querySelector('.browser-body')
  // Only where the page area is what the pointer is over (not the sidebar laid over it).
  if (!body || !document.elementFromPoint(x, y)?.closest('.browser-body')) return null
  const rect = body.getBoundingClientRect()
  return splitDropSide({ x, y }, { x: rect.x, y: rect.y, width: rect.width, height: rect.height })
}

/**
 * Drag a tab to a new place with the pointer. Spread `handlers(tab, index)` on the tab's button;
 * the element carrying `data-tab-id` (the whole tab) follows the pointer while dragging.
 */
/**
 * Drag tabs to reorder them. `indexOf` maps a tab (by id) to its place among all tabs, for lists
 * that do not show every tab (folders folded away). Dropped on a folder (an element with
 * data-folder-drop), the tab goes into that folder.
 */
export function useTabDrag(axis: TabAxis, options: { indexOf?: (id: string) => number; shownId?: string | undefined } = {}) {
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
    if (state.preview) {
      // Dropped on a page's edge: the tab is split in beside the shown page (or the page is left as it was).
      void window.intoponet.browserHost.splitPreview(null)
      if (commit && options.shownId) void window.intoponet.browserHost.splitTab(state.id, options.shownId, state.preview)
      return
    }
    if (!commit) return
    const folder = document.elementsFromPoint(event.clientX, event.clientY)
      .map((element) => element.closest<HTMLElement>('[data-folder-drop]'))
      .find((element): element is HTMLElement => !!element)
    if (folder?.dataset['folderDrop']) {
      void window.intoponet.browserHost.moveTabToFolder(state.id, folder.dataset['folderDrop'] === 'none' ? null : folder.dataset['folderDrop'])
      return
    }
    const to = dropIndex(state.boxes, state.index, { x: event.clientX, y: event.clientY }, axis)
    if (to === state.index) return
    const target = state.ids[to]
    const index = target && options.indexOf ? options.indexOf(target) : to
    void window.intoponet.browserHost.moveTab(state.id, index >= 0 ? index : to)
  }

  return (tab: PageTabSnapshot, index: number) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || event.pointerType === 'touch') return
      const item = event.currentTarget.closest<HTMLElement>('[data-tab-id]')
      if (!item) return
      drag.current = { id: tab.id, index, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, item, boxes: null, ids: [], preview: null }
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const state = drag.current
      if (!state || state.pointerId !== event.pointerId) return
      const dx = event.clientX - state.startX
      const dy = event.clientY - state.startY
      if (!state.boxes) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        // Where every tab sits before anything moves (in the whole sidebar, across its folders).
        const list = state.item.closest('[data-tab-container]') ?? state.item.closest('[role="tablist"]')
        const elements = [...(list?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? [])]
        state.ids = elements.map((element) => element.dataset['tabId'] ?? '')
        // Its place among the elements measured: a pair is one element, so this can differ from its place among the tabs.
        const at = elements.indexOf(state.item)
        if (at >= 0) state.index = at
        state.boxes = elements.map((element) => {
          const rect = element.getBoundingClientRect()
          return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        })
        event.currentTarget.setPointerCapture(event.pointerId)
        state.item.classList.add('is-dragging')
      }
      state.item.style.setProperty('translate', axis === 'x' ? `${dx}px 0` : `${dx}px ${dy}px`)
      // Over a page's edge: offer to split it there (the page makes room; see SplitPages.tsx).
      const side = splitDropFor(event.clientX, event.clientY, state.id, options.shownId)
      if (side !== state.preview) {
        state.preview = side
        void window.intoponet.browserHost.splitPreview(side)
      }
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
