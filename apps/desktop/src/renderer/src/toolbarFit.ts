/**
 * The page toolbar names its tools ("Protected", "Capture", "Bookmarks"…) while they fit, and drops every
 * label at once to icons (their names stay in tooltips and accessible names) before any two would touch.
 * Measured rather than set by a fixed width, so it holds whatever tools show (passwords, a translation
 * offer, a recording) and whatever room the sidebar leaves.
 */

/** Do items of these natural widths, `gap` apart, fit in `available` pixels? */
export function labelsFit(widths: readonly number[], gap: number, available: number): boolean {
  if (widths.length === 0) return true
  const needed = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1)
  return needed <= available + 0.5
}

/** An item's width with its label shown. More tools counts with its tools out, so opening them never drops the labels. */
function naturalWidth(item: HTMLElement): number {
  if (!item.classList.contains('chrome-more')) return item.getBoundingClientRect().width
  const toggle = item.querySelector<HTMLElement>('.chrome-more-toggle')
  const tools = item.querySelector<HTMLElement>('.chrome-more-tools')
  const gap = parseFloat(getComputedStyle(item).columnGap) || 0
  return (toggle?.getBoundingClientRect().width ?? item.getBoundingClientRect().width) + (tools ? tools.scrollWidth + gap : 0)
}

/**
 * Keeps `actions` (the toolbar's tools) labelled while every tool fits with its label, and icons only
 * (the `is-icons` class) otherwise; again whenever its room or its tools change. A ref callback: it
 * returns the cleanup for when the toolbar goes.
 */
export function fitToolbarLabels(actions: HTMLElement | null): (() => void) | undefined {
  if (!actions) return undefined
  const measure = (): void => {
    // Measured with the labels shown, then decided before anything is drawn (no flicker).
    actions.classList.remove('is-icons')
    const items = [...actions.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.getClientRects().length > 0)
    const gap = parseFloat(getComputedStyle(actions).columnGap) || 0
    if (!labelsFit(items.map(naturalWidth), gap, actions.clientWidth)) actions.classList.add('is-icons')
  }
  const resize = new ResizeObserver(measure)
  resize.observe(actions)
  // A tool shown or hidden, or a label that changed ("Translated", a recording's time).
  const changes = new MutationObserver(measure)
  changes.observe(actions, { childList: true, subtree: true, characterData: true })
  measure()
  return () => {
    resize.disconnect()
    changes.disconnect()
  }
}
