/**
 * Pages side by side, kept apart from Electron so the layout and the pairing rules can be tested.
 * A split is two tabs in the same workspace, each naming the other (`split.partnerId`) and its side.
 * Both carry the same ratio: the left side's share of the width the two sides share (the gap is not shared).
 * The shell draws each side's header strip above its page; the divider sits in the gap between them.
 */

export type SplitSide = 'left' | 'right'
export type TabSplit = { partnerId: string; side: SplitSide; ratio: number }
export type Rect = { x: number; y: number; width: number; height: number }

/** What a split needs to know about a tab (OpenTab in index.ts satisfies it). */
export type SplitTab = {
  id: string
  pinned?: boolean
  folderId?: string
  isPrivate?: boolean
  split?: TabSplit
}

export const SPLIT_GAP = 8
export const SPLIT_MIN_WIDTH = 320
export const SPLIT_HEADER = 28
export const DEFAULT_SPLIT_RATIO = 0.5

export type SplitOptions = { gap?: number; minWidth?: number; header?: number }

export type SplitLayout = {
  /** The page views: below their header strips. */
  left: Rect
  right: Rect
  /** The gap between the two pages, full height: the shell draws the divider here. */
  divider: Rect
  /** Each side's header strip (origin, security, focus ring, Unsplit), above its page. */
  leftHeader: Rect
  rightHeader: Rect
  /** The left side's share of the width the two sides share (what the divider shows). */
  ratio: number
}

/** A ratio the pair can store: finite, between 0 and 1 (the layout keeps each side wide enough). */
export function storableRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO
  return Math.min(1, Math.max(0, ratio))
}

/**
 * Keeps the left side at least `minWidth` wide, and the right side too, of the width the two
 * sides share (`available`). A non-finite ratio is the middle. When even two minimum sides do not
 * fit, the answer is the middle too (splitBounds then gives both sides half of what there is).
 */
export function clampRatio(ratio: number, available: number, minWidth = SPLIT_MIN_WIDTH): number {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO
  if (available <= 0 || available < 2 * minWidth) return DEFAULT_SPLIT_RATIO
  const low = minWidth / available
  return Math.min(1 - low, Math.max(low, ratio))
}

/**
 * Where the two sides and the divider go inside `area` (the page area the shell reserves). The
 * sides share `area.width - gap`; each keeps `minWidth`. If the area is narrower than two minimum
 * sides and the gap, both sides take half of what is left, whatever the ratio.
 */
export function splitBounds(area: Rect, ratio: number, options: SplitOptions = {}): SplitLayout {
  const gap = Math.max(0, Math.floor(options.gap ?? SPLIT_GAP))
  const minWidth = Math.max(0, Math.floor(options.minWidth ?? SPLIT_MIN_WIDTH))
  const header = Math.max(0, Math.floor(options.header ?? SPLIT_HEADER))
  const x = Math.floor(area.x)
  const y = Math.floor(area.y)
  const width = Math.max(0, Math.floor(area.width))
  const height = Math.max(0, Math.floor(area.height))
  const available = Math.max(0, width - gap)
  const share = clampRatio(ratio, available, minWidth)
  const leftWidth = available < 2 * minWidth
    ? Math.floor(available / 2)
    : Math.min(available - minWidth, Math.max(minWidth, Math.round(available * share)))
  const rightWidth = available - leftWidth
  const headerHeight = Math.min(header, height)
  const bodyHeight = height - headerHeight
  const rightX = x + leftWidth + gap
  return {
    left: { x, y: y + headerHeight, width: leftWidth, height: bodyHeight },
    right: { x: rightX, y: y + headerHeight, width: rightWidth, height: bodyHeight },
    divider: { x: x + leftWidth, y, width: gap, height },
    leftHeader: { x, y, width: leftWidth, height: headerHeight },
    rightHeader: { x: rightX, y, width: rightWidth, height: headerHeight },
    ratio: available > 0 ? leftWidth / available : DEFAULT_SPLIT_RATIO,
  }
}

/**
 * Two tabs can be side by side only when both are private or both not, both pinned or both not,
 * and in the same sidebar folder: a pair is one row of the sidebar.
 */
export function canSplit(tab: SplitTab, partner: SplitTab): boolean {
  if (tab.id === partner.id) return false
  return !!tab.isPrivate === !!partner.isPrivate &&
    !!tab.pinned === !!partner.pinned &&
    (tab.folderId ?? null) === (partner.folderId ?? null)
}

/** The tab a split tab is paired with, if it is among `tabs` and names it back. */
export function partnerOf<T extends SplitTab>(tabs: readonly T[], tab: SplitTab): T | undefined {
  if (!tab.split) return undefined
  const partner = tabs.find((other) => other.id === tab.split!.partnerId)
  return partner && partner.split?.partnerId === tab.id ? partner : undefined
}

/**
 * Keeps each pair together in `tabs`, left side first, at the place of the pair's first tab. The
 * array is reordered in place and returned. Tabs whose partner is not in `tabs` keep their place.
 */
export function pairOrder<T extends SplitTab>(tabs: T[]): T[] {
  const placed = new Set<string>()
  const result: T[] = []
  for (const tab of tabs) {
    if (placed.has(tab.id)) continue
    const partner = partnerOf(tabs, tab)
    if (!partner) {
      placed.add(tab.id)
      result.push(tab)
      continue
    }
    const [left, right] = tab.split!.side === 'left' ? [tab, partner] : [partner, tab]
    placed.add(left.id)
    placed.add(right.id)
    result.push(left, right)
  }
  tabs.splice(0, tabs.length, ...result)
  return tabs
}

/**
 * Pairs `id` with `partnerId`: `id` takes `side` (left by default), the partner the other side, and
 * the pair is put where `id` was, left side first. Both tabs must be free (not already split) and
 * able to pair (see canSplit). Mutates the tabs' `split` fields and reorders `tabs` in place.
 * Returns null, and changes nothing, when they cannot pair.
 */
export function splitWith<T extends SplitTab>(
  tabs: T[],
  id: string,
  partnerId: string,
  side: SplitSide = 'left',
  ratio: number = DEFAULT_SPLIT_RATIO,
): T[] | null {
  const tab = tabs.find((item) => item.id === id)
  const partner = tabs.find((item) => item.id === partnerId)
  if (!tab || !partner || !canSplit(tab, partner)) return null
  if (tab.split || partner.split) return null
  const shared = storableRatio(ratio)
  const at = tabs.indexOf(tab)
  const before = tabs.slice(0, at).filter((item) => item !== partner).length
  tab.split = { partnerId: partner.id, side, ratio: shared }
  partner.split = { partnerId: tab.id, side: side === 'left' ? 'right' : 'left', ratio: shared }
  const others = tabs.filter((item) => item !== tab && item !== partner)
  const [left, right] = side === 'left' ? [tab, partner] : [partner, tab]
  others.splice(before, 0, left, right)
  tabs.splice(0, tabs.length, ...others)
  return tabs
}

/** Ends a pair: both tabs are ordinary again. Mutates in place and returns the array. */
export function unsplit<T extends SplitTab>(tabs: T[], id: string): T[] {
  const tab = tabs.find((item) => item.id === id)
  if (!tab?.split) return tabs
  const partner = partnerOf(tabs, tab)
  delete tab.split
  if (partner) delete partner.split
  return tabs
}

/** Sets the ratio of a pair (both tabs). Returns false when `id` is not split with a tab in `tabs`. */
export function setSplitRatio<T extends SplitTab>(tabs: T[], id: string, ratio: number): boolean {
  const tab = tabs.find((item) => item.id === id)
  const partner = tab ? partnerOf(tabs, tab) : undefined
  if (!tab?.split || !partner) return false
  const shared = storableRatio(ratio)
  tab.split = { ...tab.split, ratio: shared }
  partner.split = { ...partner.split!, ratio: shared }
  return true
}

/**
 * Drops every pair that no longer holds: a partner that is missing, does not name the tab back,
 * can no longer pair (private, pinned or folder differ), or is not next to it. Used after tabs move,
 * change folder or leave a workspace. Mutates in place and returns the array.
 */
export function repairSplits<T extends SplitTab>(tabs: T[]): T[] {
  for (const tab of tabs) {
    if (!tab.split) continue
    const partner = partnerOf(tabs, tab)
    const distance = partner ? Math.abs(tabs.indexOf(partner) - tabs.indexOf(tab)) : -1
    if (!partner || !canSplit(tab, partner) || distance !== 1) {
      delete tab.split
      if (partner) delete partner.split
    }
  }
  return tabs
}

/**
 * While a tab is dragged onto an edge, the page gives up the half on that side so the shell can
 * draw the drop zone there. `side` is the side the dragged tab would take. Returns the page's rect
 * (the view, the other half) and the zone (the free half, full height).
 */
export function splitPreviewArea(area: Rect, side: SplitSide, options: SplitOptions = {}): { page: Rect; zone: Rect } {
  const layout = splitBounds(area, DEFAULT_SPLIT_RATIO, options)
  const full = (rect: Rect): Rect => ({ x: rect.x, y: area.y, width: rect.width, height: area.height })
  return side === 'left'
    ? { zone: full(layout.leftHeader), page: full(layout.right) }
    : { zone: full(layout.rightHeader), page: full(layout.left) }
}
