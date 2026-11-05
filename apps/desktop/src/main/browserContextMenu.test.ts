import { describe, expect, it } from 'vitest'
import { browserContextActions, browserContextExtras, searchSelectionLabel, type BrowserContextExtrasInput, type BrowserContextMenuInput } from './browserContextMenu'

const base: BrowserContextMenuInput = {
  linkURL: '',
  srcURL: '',
  mediaType: 'none',
  hasImageContents: false,
  isEditable: false,
  selectionText: '',
  canGoBack: true,
  canGoForward: false,
}

describe('native browser context actions', () => {
  it('offers explicit safe HTTP(S) new-tab navigation and link copying', () => {
    expect(browserContextActions({ ...base, linkURL: 'https://example.org/articles?q=1' })).toEqual([
      'open-link-in-new-tab', 'copy-link-address', 'back', 'reload',
    ])
    expect(browserContextActions({ ...base, linkURL: 'http://example.org/path' })).toContain('open-link-in-new-tab')
  })

  it('does not offer host navigation or image saving for unsupported schemes', () => {
    const actions = browserContextActions({
      ...base,
      linkURL: 'javascript:alert(1)',
      mediaType: 'image',
      srcURL: 'file:///etc/passwd',
      hasImageContents: true,
    })
    expect(actions).not.toContain('open-link-in-new-tab')
    expect(actions).not.toContain('copy-link-address')
    expect(actions).not.toContain('copy-image-address')
    expect(actions).not.toContain('save-image')
    expect(actions).toContain('copy-image')
  })

  it('provides selection and standard editable actions without duplicates', () => {
    const actions = browserContextActions({
      ...base,
      isEditable: true,
      selectionText: 'selected words',
    })
    expect(actions).toEqual(['copy-selection', 'cut', 'paste', 'select-all', 'back', 'reload'])
  })

  it('only offers save/copy image address for valid HTTP(S) image sources', () => {
    expect(browserContextActions({
      ...base,
      mediaType: 'image',
      srcURL: 'https://example.org/image.png',
      hasImageContents: true,
    })).toEqual(['copy-image', 'copy-image-address', 'save-image', 'back', 'reload'])
    expect(browserContextActions({
      ...base,
      mediaType: 'image',
      srcURL: 'data:image/png;base64,abc',
      hasImageContents: true,
    })).toContain('copy-image')
  })
})

const extrasBase: BrowserContextExtrasInput = {
  linkURL: '',
  srcURL: '',
  mediaType: 'none',
  isEditable: false,
  selectionText: '',
  misspelledWord: '',
  dictionarySuggestions: [],
  isPrivate: false,
}

describe('more context actions', () => {
  it('offers spelling suggestions for a misspelled word in a field', () => {
    expect(browserContextExtras({ ...extrasBase, isEditable: true, misspelledWord: 'recieve', dictionarySuggestions: ['receive', 'relieve', 'a', 'b', 'c', 'd'] }).spelling)
      .toEqual({ word: 'recieve', suggestions: ['receive', 'relieve', 'a', 'b', 'c'] })
    expect(browserContextExtras({ ...extrasBase, isEditable: true, misspelledWord: 'qzxv' }).spelling).toEqual({ word: 'qzxv', suggestions: [] })
    expect(browserContextExtras({ ...extrasBase, misspelledWord: 'recieve' }).spelling).toBeNull()
  })

  it('searches the web for a selection', () => {
    expect(browserContextExtras({ ...extrasBase, selectionText: '  ocean   heat\ncontent ' }).searchSelection).toBe('ocean heat content')
    expect(browserContextExtras(extrasBase).searchSelection).toBeNull()
    expect(searchSelectionLabel('a fairly long selection of words that keeps going')).toBe('Search Web for “a fairly long selection of word…”')
  })

  it('offers private tabs, Save Link As and Open Image for web links only', () => {
    const link = browserContextExtras({ ...extrasBase, linkURL: 'https://example.org/a', mediaType: 'image', srcURL: 'https://example.org/i.png' })
    expect(link).toMatchObject({ openLinkInPrivateTab: true, saveLinkAs: true, openImageInNewTab: true })
    expect(browserContextExtras({ ...extrasBase, linkURL: 'https://example.org/a', isPrivate: true }).openLinkInPrivateTab).toBe(false)
    const unsafe = browserContextExtras({ ...extrasBase, linkURL: 'javascript:alert(1)', mediaType: 'image', srcURL: 'file:///etc/passwd' })
    expect(unsafe).toMatchObject({ openLinkInPrivateTab: false, saveLinkAs: false, openImageInNewTab: false })
  })
})
