export type BrowserContextMenuInput = {
  linkURL: string
  srcURL: string
  mediaType: string
  hasImageContents: boolean
  isEditable: boolean
  selectionText: string
  canGoBack: boolean
  canGoForward: boolean
}

export type BrowserContextAction =
  | 'open-link-in-new-tab'
  | 'copy-link-address'
  | 'copy-selection'
  | 'cut'
  | 'paste'
  | 'select-all'
  | 'copy-image'
  | 'copy-image-address'
  | 'save-image'
  | 'back'
  | 'forward'
  | 'reload'
  | 'inspect'

function safeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0
  } catch {
    return false
  }
}

/** Produces native context actions without allowing page input to request host capabilities. */
export function browserContextActions(input: BrowserContextMenuInput): BrowserContextAction[] {
  const actions: BrowserContextAction[] = []
  const safeLink = safeHttpUrl(input.linkURL)
  const safeImage = input.mediaType === 'image' && safeHttpUrl(input.srcURL)

  if (safeLink) actions.push('open-link-in-new-tab', 'copy-link-address')
  if (input.selectionText.trim()) actions.push('copy-selection')
  if (input.isEditable) actions.push('cut', 'paste', 'select-all')
  if (input.mediaType === 'image' && input.hasImageContents) actions.push('copy-image')
  if (safeImage) actions.push('copy-image-address', 'save-image')
  if (input.canGoBack) actions.push('back')
  if (input.canGoForward) actions.push('forward')
  actions.push('reload', 'inspect')
  return [...new Set(actions)]
}
