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
  actions.push('reload')
  return [...new Set(actions)]
}

// ---- More browser actions: spelling, web search, private tabs, Save As (kept apart from the list above) ----

export type BrowserContextExtrasInput = {
  linkURL: string
  srcURL: string
  mediaType: string
  isEditable: boolean
  selectionText: string
  /** The word under the pointer when it is misspelled (editable fields only). */
  misspelledWord: string
  dictionarySuggestions: readonly string[]
  /** The page is in a private tab already. */
  isPrivate: boolean
}

export type BrowserContextExtras = {
  /** Replacements for a misspelled word (at most five); Add to Dictionary is offered with it. */
  spelling: { word: string; suggestions: string[] } | null
  /** "Search Web for …" over the selection. */
  searchSelection: string | null
  openLinkInPrivateTab: boolean
  saveLinkAs: boolean
  openImageInNewTab: boolean
}

/** Longest selection searched; the menu shows a shorter quote. */
const SEARCH_SELECTION_MAX = 500

export function browserContextExtras(input: BrowserContextExtrasInput): BrowserContextExtras {
  const word = input.misspelledWord.trim()
  const spelling = input.isEditable && word && word.length <= 100
    ? { word, suggestions: input.dictionarySuggestions.filter((item) => typeof item === 'string' && item.length > 0 && item.length <= 100).slice(0, 5) }
    : null
  const selection = input.selectionText.replace(/\s+/g, ' ').trim()
  const safeLink = safeHttpUrl(input.linkURL)
  return {
    spelling,
    searchSelection: selection ? selection.slice(0, SEARCH_SELECTION_MAX) : null,
    openLinkInPrivateTab: safeLink && !input.isPrivate,
    saveLinkAs: safeLink,
    openImageInNewTab: input.mediaType === 'image' && safeHttpUrl(input.srcURL),
  }
}

/** Search Web for “a short quote…” */
export function searchSelectionLabel(selection: string, max = 32): string {
  const quote = selection.length > max ? `${selection.slice(0, max - 1).trimEnd()}…` : selection
  return `Search Web for “${quote}”`
}
