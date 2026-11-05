import { describe, expect, it, vi } from 'vitest'
import { addressMenuTemplate, pasteAndGoText } from './addressMenu'

describe('address bar menu', () => {
  it('cleans clipboard text for Paste and Go', () => {
    expect(pasteAndGoText('  https://example.org/\n')).toBe('https://example.org/')
    expect(pasteAndGoText('two\nlines\tof text')).toBe('two lines of text')
    expect(pasteAndGoText(' \n ')).toBeNull()
    expect(pasteAndGoText('x'.repeat(9000))).toBeNull()
  })

  it('offers Paste and Go beside the edit items', () => {
    const onPasteAndGo = vi.fn()
    const template = addressMenuTemplate({ hasSelection: false, canPasteAndGo: true, onPasteAndGo })
    expect(template.map((item) => item.role ?? item.label ?? item.type)).toEqual(['undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'Paste and Go', 'separator', 'selectAll'])
    expect(template.find((item) => item.role === 'cut')?.enabled).toBe(false)
    const paste = template.find((item) => item.label === 'Paste and Go')
    expect(paste?.enabled).toBe(true)
    ;(paste?.click as () => void)()
    expect(onPasteAndGo).toHaveBeenCalledOnce()
    expect(addressMenuTemplate({ hasSelection: true, canPasteAndGo: false, onPasteAndGo }).find((item) => item.label === 'Paste and Go')?.enabled).toBe(false)
  })
})
