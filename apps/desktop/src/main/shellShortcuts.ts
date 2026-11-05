import type { ShellShortcut } from '@intoponet/browser-api'
import { appCommandForInput, type AppCommand, type KeyInput } from './appMenu'

/**
 * Shell keys with no menu item, pressed while a page has focus. Everything in the menu bar
 * (⌘T, ⌘W, ⌘L, ⌘F, ⌘R, ⌘1–9…) is matched by `appCommandForInput` from the menu's own table.
 */
export function shellShortcutForInput(input: KeyInput): ShellShortcut | null {
  if (input.type !== 'keyDown' || input.alt) return null
  const command = process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta
  if (!command) return null
  if (input.key.toLowerCase() === 's' && input.shift) return 'capture'
  return null
}

/** A plain Escape: stops a page that is still loading (the page also still gets the key). */
export function isPlainEscape(input: KeyInput): boolean {
  return input.type === 'keyDown' && input.key === 'Escape' && !input.meta && !input.control && !input.alt && !input.shift
}

export type PageKeyAction =
  | { kind: 'command'; command: AppCommand }
  | { kind: 'shell'; action: ShellShortcut }

/** What a key pressed inside a page asks of the browser, or null to leave it to the page. */
export function pageKeyAction(input: KeyInput, options: { developer?: boolean } = {}): PageKeyAction | null {
  const command = appCommandForInput(input, options)
  if (command) return { kind: 'command', command }
  const action = shellShortcutForInput(input)
  return action ? { kind: 'shell', action } : null
}
