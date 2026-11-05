// Where a dragged tab lands, and which keys move a focused tab. Plain functions so they can be tested.

export type TabAxis = 'x' | 'y'
export type TabBox = { left: number; top: number; width: number; height: number }

function sharesRow(a: TabBox, b: TabBox): boolean {
  return a.top < b.top + b.height && b.top < a.top + a.height && Math.abs(a.left - b.left) > 1
}

/**
 * The index a dragged tab takes when dropped at `point`: the number of other tabs that come
 * before the point in reading order. `boxes` are every tab's place before the drag, in tab order.
 * On the vertical rail, tabs sharing a row (pinned icons side by side) are ordered left to right.
 */
export function dropIndex(boxes: readonly TabBox[], from: number, point: { x: number; y: number }, axis: TabAxis): number {
  let before = 0
  boxes.forEach((box, index) => {
    if (index === from) return
    const centerX = box.left + box.width / 2
    const centerY = box.top + box.height / 2
    if (axis === 'x') {
      if (centerX < point.x) before += 1
      return
    }
    const inRow = point.y >= box.top && point.y <= box.top + box.height
    // The dragged tab's own starting place counts: it shared the row before it moved.
    const hasRowmates = boxes.some((other) => other !== box && sharesRow(box, other))
    if (inRow && hasRowmates ? centerX < point.x : centerY < point.y) before += 1
  })
  return before
}

/**
 * Keyboard reorder of the focused tab: ⌥⇧ with the arrows along the tab list, or ⌃⇧ Page Up / Page Down.
 * -1 moves it earlier, 1 later, 0 is not a move.
 */
export function reorderDelta(event: { key: string; altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, axis: TabAxis): -1 | 0 | 1 {
  if (!event.shiftKey || event.metaKey) return 0
  if (event.ctrlKey && !event.altKey) {
    if (event.key === 'PageUp') return -1
    if (event.key === 'PageDown') return 1
    return 0
  }
  if (!event.altKey || event.ctrlKey) return 0
  const [earlier, later] = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
  if (event.key === earlier) return -1
  if (event.key === later) return 1
  return 0
}
