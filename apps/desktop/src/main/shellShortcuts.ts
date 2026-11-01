import type { ShellShortcut } from '@intoponet/browser-api'

type KeyInput = { type: string; key: string; meta: boolean; control: boolean; shift: boolean; alt: boolean }

/** Browser keys the main process carries out on the page itself (the page keeps focus). */
export type PageShortcut = 'reload' | 'back' | 'forward' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'print'

/** Map a page-view keystroke to a shell action. Only keyDown, only exact chords. */
export function shellShortcutForInput(input: KeyInput): ShellShortcut | null {
  if (input.type !== 'keyDown' || input.alt) return null
  const command = process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta
  if (!command) return null
  const key = input.key.toLowerCase()
  if (key === 'l' && !input.shift) return 'focus-launcher'
  if (key === 't' && !input.shift) return 'new-tab'
  if (key === 'f' && !input.shift) return 'find'
  if (key === 'd' && !input.shift) return 'bookmark'
  if (key === 'b' && input.shift) return 'toggle-bookmarks'
  if (key === 's' && input.shift) return 'capture'
  if (key === 'n' && input.shift) return 'toggle-private'
  return null
}

/** ⌃Tab / ⌃⇧Tab switch tabs from inside a page, as in the shell. */
export function tabCycleForInput(input: KeyInput): ShellShortcut | null {
  if (input.type !== 'keyDown' || input.alt || input.meta || !input.control || input.key !== 'Tab') return null
  return input.shift ? 'previous-tab' : 'next-tab'
}

/** ⌘R, ⌘[ ⌘], ⌘= ⌘- ⌘0 and ⌘P pressed inside a page. */
export function pageShortcutForInput(input: KeyInput): PageShortcut | null {
  if (input.type !== 'keyDown' || input.alt) return null
  const command = process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta
  if (!command) return null
  const key = input.key.toLowerCase()
  if (key === 'r' && !input.shift) return 'reload'
  if (key === '[') return 'back'
  if (key === ']') return 'forward'
  if (key === '=' || key === '+') return 'zoom-in'
  if (key === '-' && !input.shift) return 'zoom-out'
  if (key === '0' && !input.shift) return 'zoom-reset'
  if (key === 'p' && !input.shift) return 'print'
  return null
}
