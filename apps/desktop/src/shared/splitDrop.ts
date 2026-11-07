/**
 * Where a tab dragged over the page would be split in (shared by the shell, which tracks the pointer,
 * and the main process, which lays the page out). Pure, so both sides agree and it can be tested.
 */

export type SplitDropSide = 'left' | 'right'
export type DropRect = { x: number; y: number; width: number; height: number }

/**
 * The side a tab dragged to this pointer would take, when the pointer is within `zone` pixels of
 * the page's left or right edge (and inside the page's height). Null elsewhere.
 */
export function splitDropSide(pointer: { x: number; y: number }, page: DropRect, zone = 96): SplitDropSide | null {
  if (pointer.y < page.y || pointer.y > page.y + page.height) return null
  if (pointer.x < page.x || pointer.x > page.x + page.width) return null
  const reach = Math.min(zone, page.width / 4)
  if (pointer.x - page.x <= reach) return 'left'
  if (page.x + page.width - pointer.x <= reach) return 'right'
  return null
}
