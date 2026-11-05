// Geometry for the sources carousel: where each card sits relative to the one in front,
// and where the browser's page will appear, so the chosen card can land exactly on it.

export type CarouselSlot = { x: number; z: number; rotateY: number; scale: number; opacity: number; brightness: number; zIndex: number }

/** Cards beyond this many places from the front are hidden. */
export const VISIBLE_SIDE = 3

/** A card `offset` places from the front (negative: to the left), for cards `cardWidth` wide. */
export function carouselSlot(offset: number, cardWidth: number): CarouselSlot {
  const distance = Math.abs(offset)
  const side = Math.sign(offset)
  // The neighbours step out by most of a card; further ones tuck in behind them.
  const reach = distance <= 1 ? distance * 0.66 : 0.66 + (distance - 1) * 0.3
  return {
    x: side * reach * cardWidth,
    z: -Math.min(distance, VISIBLE_SIDE + 1) * 110,
    rotateY: -side * Math.min(distance, 1) * 34,
    scale: 1 - Math.min(distance, VISIBLE_SIDE) * 0.07,
    // Cards stay solid (no text showing through from behind); further ones are dimmed instead.
    opacity: distance > VISIBLE_SIDE + 0.5 ? 0 : 1,
    brightness: 1 - Math.min(distance, VISIBLE_SIDE) * 0.2,
    zIndex: 100 - Math.round(distance * 2),
  }
}

export type Rect = { left: number; top: number; width: number; height: number }

/** The page view's rectangle for the browser body's box (mirrors App's setBounds: 12 px inset unless full width). */
export function pageRectFrom(body: { x: number; y: number; right: number; bottom: number }, fullWidth: boolean): Rect {
  const inset = fullWidth ? 0 : 12
  const left = Math.ceil(body.x) + inset
  const top = Math.ceil(body.y)
  return {
    left,
    top,
    width: Math.max(280, Math.floor(body.right) - left - inset),
    height: Math.max(180, Math.floor(body.bottom) - top - inset),
  }
}

/** The next front card after a step, clamped to the ends. */
export function stepIndex(index: number, step: number, count: number): number {
  return Math.max(0, Math.min(count - 1, index + step))
}
