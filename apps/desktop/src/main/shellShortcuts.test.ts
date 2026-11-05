import { describe, expect, it } from 'vitest'
import { isPlainEscape, pageKeyAction, shellShortcutForInput } from './shellShortcuts'

const mod = process.platform === 'darwin' ? { meta: true, control: false } : { meta: false, control: true }
const key = (k: string, extra: Partial<{ shift: boolean; alt: boolean; type: string; code: string }> = {}) =>
  ({ type: 'keyDown', key: k, shift: false, alt: false, ...mod, ...extra })
const command = (input: Parameters<typeof pageKeyAction>[0]) => {
  const action = pageKeyAction(input)
  return action?.kind === 'command' ? action.command : action
}

describe('keys pressed while a page has focus', () => {
  it('maps the menu chords to their commands', () => {
    expect(command(key('l'))).toEqual({ type: 'open-location' })
    expect(command(key('L'))).toEqual({ type: 'open-location' })
    expect(command(key('t'))).toEqual({ type: 'new-tab' })
    expect(command(key('T', { shift: true }))).toEqual({ type: 'reopen-closed-tab' })
    expect(command(key('w'))).toEqual({ type: 'close-tab' })
    expect(command(key('f'))).toEqual({ type: 'find' })
    expect(command(key('g'))).toEqual({ type: 'find-next' })
    expect(command(key('G', { shift: true }))).toEqual({ type: 'find-previous' })
    expect(command(key('d'))).toEqual({ type: 'bookmark' })
    expect(command(key('B', { shift: true }))).toEqual({ type: 'show-bookmarks' })
    expect(command(key('N', { shift: true }))).toEqual({ type: 'toggle-private' })
    expect(command(key('s'))).toEqual({ type: 'save-page' })
    expect(command(key(','))).toEqual({ type: 'settings' })
  })

  it('maps page keys', () => {
    expect(command(key('r'))).toEqual({ type: 'reload' })
    expect(command(key('R', { shift: true }))).toEqual({ type: 'force-reload' })
    expect(command(key('['))).toEqual({ type: 'back' })
    expect(command(key(']'))).toEqual({ type: 'forward' })
    expect(command(key('='))).toEqual({ type: 'zoom-in' })
    expect(command(key('+', { shift: true }))).toEqual({ type: 'zoom-in' })
    expect(command(key('-'))).toEqual({ type: 'zoom-out' })
    expect(command(key('0'))).toEqual({ type: 'zoom-reset' })
    expect(command(key('p'))).toEqual({ type: 'print' })
    expect(command(key('.'))).toEqual({ type: 'stop' })
  })

  it('maps ⌥⌘I by its physical key (⌥ changes the character)', () => {
    expect(command(key('ˆ', { alt: true, code: 'KeyI' }))).toEqual({ type: 'inspect-page' })
    // The app window's own developer tools only in development.
    expect(command(key('ˆ', { alt: true, shift: true, code: 'KeyI' }))).toBeNull()
    expect(pageKeyAction(key('ˆ', { alt: true, shift: true, code: 'KeyI' }), { developer: true })).toEqual({ kind: 'command', command: { type: 'shell-devtools' } })
  })

  it('maps tab switching: ⌃Tab, ⌘⇧[ ⌘⇧], ⌘1–8 and ⌘9 for the last', () => {
    const ctrl = { type: 'keyDown', key: 'Tab', meta: false, control: true, shift: false, alt: false }
    expect(command(ctrl)).toEqual({ type: 'next-tab' })
    expect(command({ ...ctrl, shift: true })).toEqual({ type: 'previous-tab' })
    expect(command({ ...ctrl, control: false })).toBeNull()
    expect(command(key('}', { shift: true }))).toEqual({ type: 'next-tab' })
    expect(command(key('{', { shift: true }))).toEqual({ type: 'previous-tab' })
    expect(command(key('1'))).toEqual({ type: 'select-tab', index: 0 })
    expect(command(key('8'))).toEqual({ type: 'select-tab', index: 7 })
    expect(command(key('9'))).toEqual({ type: 'select-tab', index: -1 })
  })

  it('keeps ⌘⇧S for capture, which has no menu item', () => {
    expect(shellShortcutForInput(key('s', { shift: true }))).toBe('capture')
    expect(pageKeyAction(key('S', { shift: true }))).toEqual({ kind: 'shell', action: 'capture' })
  })

  it('leaves everything else to the page', () => {
    expect(pageKeyAction(key('c'))).toBeNull()
    expect(pageKeyAction(key('v'))).toBeNull()
    expect(pageKeyAction(key('z'))).toBeNull()
    expect(pageKeyAction(key('a'))).toBeNull()
    expect(pageKeyAction(key('l', { shift: true }))).toBeNull()
    expect(pageKeyAction(key('l', { alt: true, code: 'KeyL' }))).toBeNull()
    expect(pageKeyAction(key('l', { type: 'keyUp' }))).toBeNull()
    expect(pageKeyAction({ type: 'keyDown', key: 'l', shift: false, alt: false, meta: false, control: false })).toBeNull()
    expect(pageKeyAction({ type: 'keyDown', key: 'Escape', shift: false, alt: false, meta: false, control: false })).toBeNull()
  })

  it('knows a plain Escape (Stop while loading)', () => {
    const escape = { type: 'keyDown', key: 'Escape', shift: false, alt: false, meta: false, control: false }
    expect(isPlainEscape(escape)).toBe(true)
    expect(isPlainEscape({ ...escape, shift: true })).toBe(false)
    expect(isPlainEscape({ ...escape, type: 'keyUp' })).toBe(false)
  })
})
