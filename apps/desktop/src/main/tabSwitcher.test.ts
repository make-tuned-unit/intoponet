import { describe, expect, it } from 'vitest'
import { recentOrder, switcherHtml, TabSwitcher, type SwitcherTab } from './tabSwitcher'

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
})
