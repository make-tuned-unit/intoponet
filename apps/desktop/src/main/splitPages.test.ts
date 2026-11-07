import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SPLIT_RATIO,
  SPLIT_GAP,
  SPLIT_HEADER,
  SPLIT_MIN_WIDTH,
  canSplit,
  keepOutOfPairs,
  pairMoveTarget,
  clampRatio,
  pairOrder,
  partnerOf,
  repairSplits,
  setSplitRatio,
  splitBounds,
  splitPreviewArea,
  splitWith,
  unsplit,
  type SplitTab,
} from './splitPages'

const area = { x: 40, y: 104, width: 1000, height: 600 }
const tab = (id: string, extra: Partial<SplitTab> = {}): SplitTab => ({ id, ...extra })
const ids = (tabs: SplitTab[]): string[] => tabs.map((item) => item.id)

describe('splitBounds', () => {
  it('puts two sides and an 8 px divider side by side, with a header strip above each', () => {
    const layout = splitBounds(area, 0.5)
    expect(layout.left).toEqual({ x: 40, y: 104 + SPLIT_HEADER, width: 496, height: 600 - SPLIT_HEADER })
    expect(layout.divider).toEqual({ x: 536, y: 104, width: SPLIT_GAP, height: 600 })
    expect(layout.right).toEqual({ x: 544, y: 104 + SPLIT_HEADER, width: 496, height: 600 - SPLIT_HEADER })
    expect(layout.leftHeader).toEqual({ x: 40, y: 104, width: 496, height: SPLIT_HEADER })
    expect(layout.rightHeader).toEqual({ x: 544, y: 104, width: 496, height: SPLIT_HEADER })
    expect(layout.ratio).toBeCloseTo(0.5, 2)
  })

  it('leaves no overlap and no gap other than the divider', () => {
    for (const ratio of [0, 0.2, 0.37, 0.5, 0.81, 1]) {
      const layout = splitBounds(area, ratio)
      expect(layout.left.x + layout.left.width).toBe(layout.divider.x)
      expect(layout.divider.x + layout.divider.width).toBe(layout.right.x)
      expect(layout.right.x + layout.right.width).toBe(area.x + area.width)
      expect(layout.left.width + layout.right.width + SPLIT_GAP).toBe(area.width)
      expect(layout.left.y).toBe(layout.right.y)
      expect(layout.leftHeader.x + layout.leftHeader.width).toBe(layout.divider.x)
      expect(layout.rightHeader.x).toBe(layout.right.x)
    }
  })

  it('moves the divider with the ratio (the left side takes that share of the width)', () => {
    expect(splitBounds(area, 0.4).left.width).toBe(Math.round((area.width - SPLIT_GAP) * 0.4))
    expect(splitBounds(area, 0.6).left.width).toBe(Math.round((area.width - SPLIT_GAP) * 0.6))
    expect(splitBounds(area, 0.6).ratio).toBeGreaterThan(splitBounds(area, 0.4).ratio)
  })

  it('keeps each side at least the minimum width, however far the ratio goes', () => {
    for (const ratio of [-5, 0, 0.01, 0.99, 1, 7]) {
      const layout = splitBounds(area, ratio)
      expect(layout.left.width).toBeGreaterThanOrEqual(SPLIT_MIN_WIDTH)
      expect(layout.right.width).toBeGreaterThanOrEqual(SPLIT_MIN_WIDTH)
    }
  })

  it('gives both sides half of what there is when the area is too narrow for two minimum sides', () => {
    const narrow = { x: 0, y: 0, width: 2 * SPLIT_MIN_WIDTH + SPLIT_GAP - 1, height: 300 }
    for (const ratio of [0.1, 0.5, 0.9]) {
      const layout = splitBounds(narrow, ratio)
      expect(layout.ratio).toBeCloseTo(0.5, 2)
      expect(Math.abs(layout.left.width - layout.right.width)).toBeLessThanOrEqual(1)
      expect(layout.left.width + layout.right.width + SPLIT_GAP).toBe(narrow.width)
    }
  })

  it('still splits at exactly the narrowest width that fits two minimum sides', () => {
    const exact = { x: 0, y: 0, width: 2 * SPLIT_MIN_WIDTH + SPLIT_GAP, height: 300 }
    const layout = splitBounds(exact, 0.9)
    expect(layout.left.width).toBe(SPLIT_MIN_WIDTH)
    expect(layout.right.width).toBe(SPLIT_MIN_WIDTH)
  })

  it('never stacks the sides: same top, left before right, for every width from 200 to 3000', () => {
    for (let width = 200; width <= 3000; width += 7) {
      for (const ratio of [0, 0.5, 1]) {
        const layout = splitBounds({ x: 40, y: 104, width, height: 600 }, ratio)
        expect(layout.left.y).toBe(layout.right.y)
        expect(layout.left.height).toBe(layout.right.height)
        expect(layout.left.height).toBe(600 - SPLIT_HEADER)
        expect(layout.left.x + layout.left.width).toBeLessThanOrEqual(layout.divider.x)
        expect(layout.divider.x + layout.divider.width).toBeLessThanOrEqual(layout.right.x)
        expect(layout.right.x).toBeGreaterThan(layout.left.x)
        expect(layout.left.width).toBeGreaterThan(0)
        expect(layout.right.width).toBeGreaterThan(0)
      }
    }
  })

  it('never reports negative sizes for an empty or tiny area', () => {
    const layout = splitBounds({ x: 0, y: 0, width: 0, height: 10 }, 0.5)
    expect(layout.left.width).toBe(0)
    expect(layout.right.width).toBe(0)
    expect(layout.left.height).toBe(0)
    const short = splitBounds({ x: 0, y: 0, width: 900, height: 10 }, 0.5)
    expect(short.leftHeader.height).toBe(10)
    expect(short.left.height).toBe(0)
  })

  it('tolerates non-finite ratios by splitting in the middle', () => {
    expect(splitBounds(area, Number.NaN).ratio).toBeCloseTo(0.5, 2)
    expect(splitBounds(area, Number.POSITIVE_INFINITY).ratio).toBeCloseTo(0.5, 2)
  })

  it('takes options for the gap, minimum and header', () => {
    const layout = splitBounds({ x: 0, y: 0, width: 400, height: 100 }, 0.5, { gap: 4, minWidth: 100, header: 20 })
    expect(layout.divider.width).toBe(4)
    expect(layout.left.y).toBe(20)
    expect(layout.left.width + layout.right.width).toBe(396)
    expect(layout.left.width).toBeGreaterThanOrEqual(100)
  })
})

describe('clampRatio', () => {
  it('keeps the ratio between the two minimum widths', () => {
    expect(clampRatio(0, 1000)).toBeCloseTo(SPLIT_MIN_WIDTH / 1000, 6)
    expect(clampRatio(1, 1000)).toBeCloseTo(1 - SPLIT_MIN_WIDTH / 1000, 6)
    expect(clampRatio(0.5, 1000)).toBe(0.5)
  })

  it('falls back to the middle when two minimum sides do not fit', () => {
    expect(clampRatio(0.9, 2 * SPLIT_MIN_WIDTH - 1)).toBe(DEFAULT_SPLIT_RATIO)
    expect(clampRatio(0.9, 0)).toBe(DEFAULT_SPLIT_RATIO)
  })
})

describe('tab pairing', () => {
  it('pairs two tabs, the first on the given side, and keeps the pair where the first one was', () => {
    const tabs = [tab('a'), tab('b'), tab('c'), tab('d')]
    const result = splitWith(tabs, 'c', 'a', 'right', 0.4)
    expect(result).not.toBeNull()
    expect(ids(tabs)).toEqual(['b', 'a', 'c', 'd'])
    expect(tabs[1]!.split).toEqual({ partnerId: 'c', side: 'left', ratio: 0.4 })
    expect(tabs[2]!.split).toEqual({ partnerId: 'a', side: 'right', ratio: 0.4 })
  })

  it('puts the left side first and the pair next to each other', () => {
    const tabs = [tab('a'), tab('x'), tab('b')]
    splitWith(tabs, 'a', 'b')
    expect(ids(tabs)).toEqual(['a', 'b', 'x'])
    expect(partnerOf(tabs, tabs[0]!)?.id).toBe('b')
    expect(tabs[0]!.split?.side).toBe('left')
    expect(tabs[1]!.split?.side).toBe('right')
  })

  it('refuses tabs that cannot pair (the same tab, a private with a normal, pinned with unpinned, another folder)', () => {
    const tabs = [tab('a'), tab('b', { isPrivate: true }), tab('c', { pinned: true }), tab('d', { folderId: 'f' }), tab('e')]
    expect(splitWith(tabs, 'a', 'a')).toBeNull()
    expect(splitWith(tabs, 'a', 'b')).toBeNull()
    expect(splitWith(tabs, 'a', 'c')).toBeNull()
    expect(splitWith(tabs, 'a', 'd')).toBeNull()
    expect(splitWith(tabs, 'a', 'missing')).toBeNull()
    expect(tabs.every((item) => item.split === undefined)).toBe(true)
  })

  it('pairs private tabs with private tabs and pinned tabs with pinned tabs', () => {
    expect(canSplit(tab('a', { isPrivate: true }), tab('b', { isPrivate: true }))).toBe(true)
    expect(canSplit(tab('a', { pinned: true }), tab('b', { pinned: true }))).toBe(true)
    expect(canSplit(tab('a', { folderId: 'f' }), tab('b', { folderId: 'f' }))).toBe(true)
    expect(canSplit(tab('a'), tab('b', { folderId: 'f' }))).toBe(false)
  })

  it('will not split a tab that is already split', () => {
    const tabs = [tab('a'), tab('b'), tab('c')]
    splitWith(tabs, 'a', 'b')
    expect(splitWith(tabs, 'a', 'c')).toBeNull()
    expect(splitWith(tabs, 'c', 'b')).toBeNull()
    expect(ids(tabs)).toEqual(['a', 'b', 'c'])
  })

  it('unsplits both tabs', () => {
    const tabs = [tab('a'), tab('b')]
    splitWith(tabs, 'a', 'b')
    unsplit(tabs, 'b')
    expect(tabs.every((item) => item.split === undefined)).toBe(true)
    expect(unsplit(tabs, 'a')).toBe(tabs)
  })

  it('sets the ratio on both tabs, and says when there is no pair to set it on', () => {
    const tabs = [tab('a'), tab('b'), tab('c')]
    expect(setSplitRatio(tabs, 'a', 0.3)).toBe(false)
    splitWith(tabs, 'a', 'b', 'left', 0.5)
    expect(setSplitRatio(tabs, 'b', 0.3)).toBe(true)
    expect(tabs[0]!.split?.ratio).toBe(0.3)
    expect(tabs[1]!.split?.ratio).toBe(0.3)
    expect(setSplitRatio(tabs, 'a', Number.NaN)).toBe(true)
    expect(tabs[0]!.split?.ratio).toBe(DEFAULT_SPLIT_RATIO)
    expect(setSplitRatio(tabs, 'a', 5)).toBe(true)
    expect(tabs[0]!.split?.ratio).toBe(1)
  })

  it('finds a partner only when it names the tab back', () => {
    const tabs = [tab('a', { split: { partnerId: 'b', side: 'left', ratio: 0.5 } }), tab('b')]
    expect(partnerOf(tabs, tabs[0]!)).toBeUndefined()
    expect(partnerOf(tabs, tab('zz', { split: { partnerId: 'nope', side: 'left', ratio: 0.5 } }))).toBeUndefined()
  })

  it('orders each pair left first, adjacent, at the place of its first tab', () => {
    const tabs = [tab('p', { split: { partnerId: 'q', side: 'right', ratio: 0.5 } }), tab('x'), tab('y'), tab('q', { split: { partnerId: 'p', side: 'left', ratio: 0.5 } })]
    pairOrder(tabs)
    expect(ids(tabs)).toEqual(['q', 'p', 'x', 'y'])
  })

  it('repairs pairs that were pulled apart, and keeps the ones that still hold', () => {
    const tabs = [tab('a'), tab('b'), tab('c'), tab('d'), tab('x')]
    splitWith(tabs, 'a', 'b')
    splitWith(tabs, 'c', 'd')
    // Move `x` between `c` and `d`: that pair breaks, the other stays.
    tabs.splice(0, tabs.length, tabs[0]!, tabs[1]!, tabs[2]!, tabs[4]!, tabs[3]!)
    expect(ids(tabs)).toEqual(['a', 'b', 'c', 'x', 'd'])
    repairSplits(tabs)
    expect(tabs[0]!.split).toBeDefined()
    expect(tabs[1]!.split).toBeDefined()
    expect(tabs[2]!.split).toBeUndefined()
    expect(tabs[4]!.split).toBeUndefined()
  })

  it('drops a split whose partner has gone', () => {
    const tabs = [tab('a', { split: { partnerId: 'gone', side: 'left', ratio: 0.5 } })]
    repairSplits(tabs)
    expect(tabs[0]!.split).toBeUndefined()
  })
})

describe('moves keep pairs whole', () => {
  /** The sidebar's move: the tab moves, its partner follows it (as index.ts's keepPairTogether does), then pairs are kept whole. */
  const move = (tabs: SplitTab[], id: string, toIndex: number): string[] => {
    const from = tabs.findIndex((item) => item.id === id)
    const to = Math.min(tabs.length - 1, Math.max(0, Math.round(pairMoveTarget(tabs, id, toIndex))))
    const [moved] = tabs.splice(from, 1)
    tabs.splice(to, 0, moved!)
    const partner = partnerOf(tabs, moved!)
    if (partner) {
      const rest = tabs.filter((item) => item !== partner)
      const at = rest.indexOf(moved!) + (moved!.split!.side === 'left' ? 1 : 0)
      tabs.splice(0, tabs.length, ...rest.slice(0, at), partner, ...rest.slice(at))
    }
    keepOutOfPairs(tabs, id, to > from)
    repairSplits(tabs)
    return ids(tabs)
  }
  const paired = (): SplitTab[] => {
    const tabs = [tab('x'), tab('a'), tab('b'), tab('c')]
    splitWith(tabs, 'a', 'b')
    return tabs
  }

  it('moves a tab past a pair, not between its sides (⌥⇧↑ and ⌥⇧↓)', () => {
    let tabs = paired()
    expect(move(tabs, 'c', 2)).toEqual(['x', 'c', 'a', 'b'])
    expect(partnerOf(tabs, tabs[2]!)?.id).toBe('b')
    tabs = paired()
    expect(move(tabs, 'x', 1)).toEqual(['a', 'b', 'x', 'c'])
    expect(partnerOf(tabs, tabs[0]!)?.id).toBe('b')
  })

  it('drops a dragged tab after a pair when it lands between its sides on the way down', () => {
    const tabs = paired()
    // The rail asks for the left side's place when the tab is dropped just below the pair.
    expect(move(tabs, 'x', 1)).toEqual(['a', 'b', 'x', 'c'])
    expect(tabs[0]!.split).toBeDefined()
  })

  it('moves a pair one place down or up from the keyboard (its partner’s place is stepped over)', () => {
    let tabs = paired()
    expect(move(tabs, 'a', 2)).toEqual(['x', 'c', 'a', 'b'])
    expect(partnerOf(tabs, tabs[2]!)?.id).toBe('b')
    tabs = paired()
    expect(move(tabs, 'a', 0)).toEqual(['a', 'b', 'x', 'c'])
    expect(partnerOf(tabs, tabs[0]!)?.id).toBe('b')
  })

  it('moves a pair past another pair whole, both pairs kept', () => {
    const tabs = [tab('a'), tab('b'), tab('c'), tab('d')]
    splitWith(tabs, 'a', 'b')
    splitWith(tabs, 'c', 'd')
    expect(move(tabs, 'a', 1)).toEqual(['c', 'd', 'a', 'b'])
    expect(tabs.every((item) => item.split)).toBe(true)
    expect(move(tabs, 'b', 1)).toEqual(['a', 'b', 'c', 'd'])
    expect(tabs.every((item) => item.split)).toBe(true)
  })

  it('leaves ordinary moves alone', () => {
    const tabs = [tab('a'), tab('b'), tab('c')]
    expect(move(tabs, 'a', 2)).toEqual(['b', 'c', 'a'])
    expect(pairMoveTarget(tabs, 'b', 0)).toBe(0)
  })
})

describe('edge drop preview', () => {
  it('shows the free half where the dragged tab would go, with the page on the other half', () => {
    const area2 = { x: 40, y: 104, width: 1000, height: 600 }
    const left = splitPreviewArea(area2, 'left')
    expect(left.zone.x).toBe(40)
    expect(left.page.x).toBeGreaterThan(left.zone.x)
    expect(left.zone.y).toBe(104)
    expect(left.zone.height).toBe(600)
    expect(left.zone.width + left.page.width + SPLIT_GAP).toBe(1000)
    const right = splitPreviewArea(area2, 'right')
    expect(right.zone.x).toBeGreaterThan(right.page.x)
    expect(right.page.x).toBe(40)
  })
})
