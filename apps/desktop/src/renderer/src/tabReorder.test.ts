import { describe, expect, it } from 'vitest'
import { dropIndex, reorderDelta, type TabBox } from './tabReorder'

const row = (count: number, width = 100): TabBox[] =>
  Array.from({ length: count }, (_, index) => ({ left: index * (width + 6), top: 0, width, height: 30 }))
const column = (count: number, height = 44): TabBox[] =>
  Array.from({ length: count }, (_, index) => ({ left: 0, top: index * (height + 4), width: 230, height }))

describe('dropping a dragged tab', () => {
  it('lands in the strip by horizontal position', () => {
    const boxes = row(4)
    expect(dropIndex(boxes, 0, { x: 10, y: 15 }, 'x')).toBe(0)
    expect(dropIndex(boxes, 0, { x: 170, y: 15 }, 'x')).toBe(1)
    expect(dropIndex(boxes, 0, { x: 500, y: 15 }, 'x')).toBe(3)
    expect(dropIndex(boxes, 3, { x: 0, y: 15 }, 'x')).toBe(0)
    // Pointer drifting off the row still uses its horizontal position.
    expect(dropIndex(boxes, 3, { x: 120, y: 300 }, 'x')).toBe(1)
  })

  it('lands in the rail by vertical position', () => {
    const boxes = column(4)
    expect(dropIndex(boxes, 0, { x: 50, y: 120 }, 'y')).toBe(2)
    expect(dropIndex(boxes, 3, { x: 200, y: 5 }, 'y')).toBe(0)
  })

  it('orders pinned icons sharing a rail row left to right', () => {
    // Two pinned icons side by side, then two full-width tabs below.
    const boxes: TabBox[] = [
      { left: 0, top: 0, width: 44, height: 44 },
      { left: 48, top: 0, width: 44, height: 44 },
      { left: 0, top: 50, width: 230, height: 44 },
      { left: 0, top: 98, width: 230, height: 44 },
    ]
    expect(dropIndex(boxes, 0, { x: 80, y: 20 }, 'y')).toBe(1)
    expect(dropIndex(boxes, 1, { x: 5, y: 20 }, 'y')).toBe(0)
  })
})

describe('keyboard reorder', () => {
  const key = (k: string, mods: Partial<{ altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
    key: k, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, ...mods,
  })

  it('moves with ⌥⇧ and the arrows along the list', () => {
    expect(reorderDelta(key('ArrowLeft', { altKey: true, shiftKey: true }), 'x')).toBe(-1)
    expect(reorderDelta(key('ArrowRight', { altKey: true, shiftKey: true }), 'x')).toBe(1)
    expect(reorderDelta(key('ArrowUp', { altKey: true, shiftKey: true }), 'y')).toBe(-1)
    expect(reorderDelta(key('ArrowDown', { altKey: true, shiftKey: true }), 'y')).toBe(1)
    expect(reorderDelta(key('ArrowUp', { altKey: true, shiftKey: true }), 'x')).toBe(0)
  })

  it('moves with ⌃⇧ Page Up / Page Down', () => {
    expect(reorderDelta(key('PageUp', { ctrlKey: true, shiftKey: true }), 'y')).toBe(-1)
    expect(reorderDelta(key('PageDown', { ctrlKey: true, shiftKey: true }), 'x')).toBe(1)
  })

  it('leaves plain navigation keys alone', () => {
    expect(reorderDelta(key('ArrowDown'), 'y')).toBe(0)
    expect(reorderDelta(key('ArrowLeft', { altKey: true }), 'x')).toBe(0)
    expect(reorderDelta(key('ArrowLeft', { altKey: true, shiftKey: true, metaKey: true }), 'x')).toBe(0)
  })
})
