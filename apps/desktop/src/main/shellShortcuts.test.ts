import { describe, expect, it } from 'vitest'
import { shellShortcutForInput } from './shellShortcuts'

const mod = process.platform === 'darwin' ? { meta: true, control: false } : { meta: false, control: true }
const key = (k: string, extra: Partial<{ shift: boolean; alt: boolean; type: string }> = {}) =>
  ({ type: 'keyDown', key: k, shift: false, alt: false, ...mod, ...extra })

describe('shell shortcuts forwarded from the page view', () => {
  it('maps the address and bookmark chords', () => {
    expect(shellShortcutForInput(key('l'))).toBe('focus-launcher')
    expect(shellShortcutForInput(key('L'))).toBe('focus-launcher')
    expect(shellShortcutForInput(key('B', { shift: true }))).toBe('toggle-bookmarks')
    expect(shellShortcutForInput(key('s', { shift: true }))).toBe('capture')
    expect(shellShortcutForInput(key('s'))).toBeNull()
  })

  it('leaves everything else to the page', () => {
    expect(shellShortcutForInput(key('b'))).toBeNull()
    expect(shellShortcutForInput(key('l', { shift: true }))).toBeNull()
    expect(shellShortcutForInput(key('l', { alt: true }))).toBeNull()
    expect(shellShortcutForInput(key('l', { type: 'keyUp' }))).toBeNull()
    expect(shellShortcutForInput({ type: 'keyDown', key: 'l', shift: false, alt: false, meta: false, control: false })).toBeNull()
  })
})
