import type { MenuItemConstructorOptions } from 'electron'

/** Longest clipboard text "Paste and Go" will hand to the address bar (the launcher's own limit). */
const PASTE_AND_GO_MAX = 8_192

/** Clipboard text fit to paste and go: trimmed, line breaks folded to spaces; null when empty or too long. */
export function pasteAndGoText(clipboardText: string): string | null {
  const text = clipboardText.replace(/\s+/g, ' ').trim()
  return text && text.length <= PASTE_AND_GO_MAX ? text : null
}

/** The address bar's context menu: the usual edit items plus "Paste and Go". */
export function addressMenuTemplate(options: {
  hasSelection: boolean
  canPasteAndGo: boolean
  onPasteAndGo: () => void
}): MenuItemConstructorOptions[] {
  return [
    { role: 'undo' },
    { role: 'redo' },
    { type: 'separator' },
    { role: 'cut', enabled: options.hasSelection },
    { role: 'copy', enabled: options.hasSelection },
    { role: 'paste' },
    { label: 'Paste and Go', enabled: options.canPasteAndGo, click: options.onPasteAndGo },
    { type: 'separator' },
    { role: 'selectAll' },
  ]
}
