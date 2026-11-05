import { describe, expect, it } from 'vitest'
import { bookmarkSiteGroups } from './BookmarkSiteBar'

describe('bookmarkSiteGroups', () => {
  it('puts a new Accounts group first when there is none', () => {
    expect(bookmarkSiteGroups([{ id: 'a', label: 'Work' }])).toEqual([{ id: null, label: 'Accounts' }, { id: 'a', label: 'Work' }])
  })
  it('uses an existing Accounts group, whatever its case, and lists up to five others', () => {
    const groups = [{ id: 'w', label: 'Work' }, { id: 'x', label: 'accounts' }, ...'bcdef'.split('').map((id) => ({ id, label: id }))]
    const result = bookmarkSiteGroups(groups)
    expect(result[0]).toEqual({ id: 'x', label: 'accounts' })
    expect(result).toHaveLength(6)
  })
})
