import { describe, expect, it } from 'vitest'
import { pageShortcutForInput, shellShortcutForInput, tabCycleForInput } from './shellShortcuts'

const mod = process.platform === 'darwin' ? { meta: true, control: false } : { meta: false, control: true }
const key = (k: string, extra: Partial<{ shift: boolean; alt: boolean; type: string }> = {}) =>
  ({ type: 'keyDown', key: k, shift: false, alt: false, ...mod, ...extra })

describe('shell shortcuts forwarded from the page view', () => {
  it('maps the address and bookmark chords', () => {
    expect(shellShortcutForInput(key('l'))).toBe('focus-launcher')
    expect(shellShortcutForInput(key('L'))).toBe('focus-launcher')
    expect(shellShortcutForInput(key('B', { shift: true }))).toBe('toggle-bookmarks')
    expect(shellShortcutForInput(key('s', { shift: true }))).toBe('capture')
    expect(shellShortcutForInput(key('N', { shift: true }))).toBe('toggle-private')
    expect(shellShortcutForInput(key('s'))).toBeNull()
  })

  it('maps find and bookmark, which need the shell', () => {
    expect(shellShortcutForInput(key('f'))).toBe('find')
    expect(shellShortcutForInput(key('d'))).toBe('bookmark')
    expect(shellShortcutForInput(key('f', { shift: true }))).toBeNull()
  })

  it('maps page keys the main process handles itself', () => {
    expect(pageShortcutForInput(key('r'))).toBe('reload')
    expect(pageShortcutForInput(key('R', { shift: true }))).toBeNull()
    expect(pageShortcutForInput(key('['))).toBe('back')
    expect(pageShortcutForInput(key(']'))).toBe('forward')
    expect(pageShortcutForInput(key('='))).toBe('zoom-in')
    expect(pageShortcutForInput(key('+', { shift: true }))).toBe('zoom-in')
    expect(pageShortcutForInput(key('-'))).toBe('zoom-out')
    expect(pageShortcutForInput(key('0'))).toBe('zoom-reset')
    expect(pageShortcutForInput(key('p'))).toBe('print')
    expect(pageShortcutForInput(key('c'))).toBeNull()
    expect(pageShortcutForInput(key('r', { type: 'keyUp' }))).toBeNull()
  })

  it('maps ⌃Tab and ⌃⇧Tab to tab switching', () => {
    const ctrl = { type: 'keyDown', key: 'Tab', meta: false, control: true, shift: false, alt: false }
    expect(tabCycleForInput(ctrl)).toBe('next-tab')
    expect(tabCycleForInput({ ...ctrl, shift: true })).toBe('previous-tab')
    expect(tabCycleForInput({ ...ctrl, control: false })).toBeNull()
  })

  it('maps ⌘T to a new tab, but not ⇧⌘T', () => {
    expect(shellShortcutForInput(key('t'))).toBe('new-tab')
    expect(shellShortcutForInput(key('T', { shift: true }))).toBeNull()
  })

  it('leaves everything else to the page', () => {
    expect(shellShortcutForInput(key('b'))).toBeNull()
    expect(shellShortcutForInput(key('l', { shift: true }))).toBeNull()
    expect(shellShortcutForInput(key('l', { alt: true }))).toBeNull()
    expect(shellShortcutForInput(key('l', { type: 'keyUp' }))).toBeNull()
    expect(shellShortcutForInput({ type: 'keyDown', key: 'l', shift: false, alt: false, meta: false, control: false })).toBeNull()
  })
})
