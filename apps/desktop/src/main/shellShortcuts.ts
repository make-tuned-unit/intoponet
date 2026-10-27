import type { ShellShortcut } from '@intoponet/browser-api'

type KeyInput = { type: string; key: string; meta: boolean; control: boolean; shift: boolean; alt: boolean }

/** Map a page-view keystroke to a shell action. Only keyDown, only exact chords. */
export function shellShortcutForInput(input: KeyInput): ShellShortcut | null {
  if (input.type !== 'keyDown' || input.alt) return null
  const command = process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta
  if (!command) return null
  const key = input.key.toLowerCase()
  if (key === 'l' && !input.shift) return 'focus-launcher'
  if (key === 'b' && input.shift) return 'toggle-bookmarks'
  if (key === 's' && input.shift) return 'capture'
  if (key === 'n' && input.shift) return 'toggle-private'
  return null
}
