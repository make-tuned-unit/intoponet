import { describe, expect, it } from 'vitest'
import { backgroundTabLabel } from './PermissionBar'

const tabs = [
  { id: 'front', title: 'Front page', active: true, split: { partnerId: 'pair', side: 'left' as const } },
  { id: 'pair', title: 'Beside it', active: false, split: { partnerId: 'front', side: 'right' as const } },
  { id: 'behind', title: 'Team call', active: false },
  { id: 'untitled', title: '', active: false },
]

describe('the permission bar names a tab asking from the background', () => {
  it('says nothing for the tab in front, the other side of its pair, or a page in its own window', () => {
    expect(backgroundTabLabel({ tabId: 'front', tabTitle: 'Front page' }, tabs)).toBeNull()
    expect(backgroundTabLabel({ tabId: 'pair', tabTitle: 'Beside it' }, tabs)).toBeNull()
    expect(backgroundTabLabel({}, tabs)).toBeNull()
  })

  it('names a background tab by its title, now if it changed', () => {
    expect(backgroundTabLabel({ tabId: 'behind', tabTitle: 'Joining…' }, tabs)).toBe('Background tab “Team call”')
    expect(backgroundTabLabel({ tabId: 'untitled', tabTitle: '' }, tabs)).toBe('Background tab')
  })

  it('names a tab in another workspace (not listed) by its title when it asked', () => {
    expect(backgroundTabLabel({ tabId: 'elsewhere', tabTitle: 'Inbox  (3)' }, tabs)).toBe('Background tab “Inbox (3)”')
    // No tab shown at all (every tab closed): still a background tab.
    expect(backgroundTabLabel({ tabId: 'elsewhere', tabTitle: '' }, [])).toBe('Background tab')
  })

  it('shortens a long title without splitting a character', () => {
    const label = backgroundTabLabel({ tabId: 'elsewhere', tabTitle: `${'a'.repeat(58)}🙂🙂🙂 and more` }, tabs)
    expect(label).toBe(`Background tab “${'a'.repeat(58)}🙂…”`)
  })
})
