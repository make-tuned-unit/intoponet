import { describe, expect, it } from 'vitest'
import { recentOrder, switcherAnnouncement, switcherHtml, TabSwitcher, type SwitcherTab } from './tabSwitcher'

const tab = (id: string, lastShownAt: number, isPrivate = false): SwitcherTab => ({ id, title: `Tab ${id}`, url: `https://${id}.example/`, favicon: '', lastShownAt, isPrivate })

describe('recent tab switching', () => {
  const tabs = [tab('a', 10), tab('b', 30), tab('c', 20), tab('p', 40, true), tab('q', 5, true)]

  it('puts the current tab first, then the most recently shown, among tabs of the same privacy', () => {
    expect(recentOrder(tabs, 'a')).toEqual(['a', 'b', 'c'])
    expect(recentOrder(tabs, 'q')).toEqual(['q', 'p'])
  })

  it('steps through a fixed order, wraps, and lands on the highlighted tab when released', () => {
    const switcher = new TabSwitcher()
    expect(switcher.step(tabs, 'a', 'next')).toEqual({ order: ['a', 'b', 'c'], index: 1 })
    // Showing tabs meanwhile does not reorder an open switcher.
    expect(switcher.step(tabs.map((t) => (t.id === 'c' ? { ...t, lastShownAt: 99 } : t)), 'a', 'next')).toEqual({ order: ['a', 'b', 'c'], index: 2 })
    expect(switcher.step(tabs, 'a', 'next')?.index).toBe(0)
    expect(switcher.step(tabs, 'a', 'previous')?.index).toBe(2)
    expect(switcher.commit()).toBe('c')
    expect(switcher.open).toBe(false)
    // A quick ⌃Tab goes to the previous tab.
    switcher.step(tabs, 'a', 'next')
    expect(switcher.commit()).toBe('b')
    switcher.step(tabs, 'a', 'next')
    switcher.cancel()
    expect(switcher.commit()).toBeNull()
  })

  it('treats a pair side by side as one place: a quick ⌃Tab from a pair goes to the tab before it, not its other side', () => {
    // Shown c, then the pair a|b: all three were last shown at the same moment.
    const pair = [tab('c', 50), { ...tab('a', 50), partnerId: 'b' }, { ...tab('b', 50), partnerId: 'a' }, tab('d', 10)]
    expect(recentOrder(pair, 'a')).toEqual(['a', 'c', 'd'])
    expect(recentOrder(pair, 'b')).toEqual(['b', 'c', 'd'])
    // From c, the pair is one entry: its side seen last.
    const back = [tab('c', 60), { ...tab('a', 60), partnerId: 'b' }, { ...tab('b', 50), partnerId: 'a' }, tab('d', 10)]
    expect(recentOrder(back, 'c')).toEqual(['c', 'a', 'd'])
    const switcher = new TabSwitcher()
    switcher.step(pair, 'a', 'next')
    expect(switcher.commit()).toBe('c')
  })

  it('does not open with one tab, and drops tabs closed while open', () => {
    const switcher = new TabSwitcher()
    expect(switcher.step([tab('a', 1)], 'a', 'next')).toBeNull()
    switcher.step(tabs, 'a', 'next')
    expect(switcher.step(tabs.filter((t) => t.id !== 'c'), 'a', 'next')).toEqual({ order: ['a', 'b'], index: 0 })
  })

  it('escapes titles and allows only data: icons', () => {
    const html = switcherHtml([{ ...tab('a', 1), title: '<script>x</script>', favicon: 'https://evil.example/i.png' }, tab('b', 2)], ['a', 'b'], 0)
    expect(html).not.toContain('<script>x')
    expect(html).not.toContain('evil.example/i.png')
    expect(html).toContain("default-src 'none'")
  })

  it('marks private tabs in its rows and in what is announced, and no others', () => {
    const rows = (html: string): string[] => html.match(/<li[\s\S]*?<\/li>/g) ?? []
    const privately = rows(switcherHtml(tabs, recentOrder(tabs, 'q'), 0))
    expect(privately).toHaveLength(2)
    for (const row of privately) expect(row).toContain('aria-label="Private tab"')
    for (const row of rows(switcherHtml(tabs, recentOrder(tabs, 'a'), 0))) expect(row).not.toContain('Private tab')
    expect(switcherAnnouncement(tabs[3])).toBe('Tab p, private tab')
    expect(switcherAnnouncement(tabs[0])).toBe('Tab a')
    expect(switcherAnnouncement(undefined)).toBe('Untitled page')
  })
})
