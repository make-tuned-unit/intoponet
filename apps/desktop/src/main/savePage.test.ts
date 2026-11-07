import { describe, expect, it } from 'vitest'
import { isPdfDocument, savePageFilename } from './savePage'

describe('Save Page As file name', () => {
  it('uses the page title as an .html file', () => {
    expect(savePageFilename('Example Domain', 'https://example.com/')).toBe('Example Domain.html')
  })

  it('falls back to the site when there is no title', () => {
    expect(savePageFilename('   ', 'https://www.example.com/a')).toBe('www.example.com.html')
    expect(savePageFilename('', 'not a url')).toBe('Page.html')
  })

  it('keeps names safe for the file system', () => {
    const name = savePageFilename('a/b: "c" <d>?', 'https://example.com/')
    expect(name.endsWith('.html')).toBe(true)
    expect(name).not.toMatch(/[/:"<>?]/)
    expect(savePageFilename('x'.repeat(500), 'https://example.com/').length).toBeLessThanOrEqual(130)
  })

  it('never cuts a character in half when it caps the length', () => {
    const name = savePageFilename(`${'a'.repeat(119)}🙂🙂`, 'https://example.com/')
    expect(name).toBe(`${'a'.repeat(119)}🙂.html`)
    expect(/\p{Cs}/u.test(name)).toBe(false)
  })

  it('names a PDF as a .pdf, without doubling the extension', () => {
    expect(savePageFilename('report.pdf', 'https://example.com/report.pdf', 'pdf')).toBe('report.pdf')
    expect(savePageFilename('Annual Report 2025', 'https://example.com/r?id=3', 'pdf')).toBe('Annual Report 2025.pdf')
    expect(savePageFilename('', 'https://example.com/r?id=3', 'pdf')).toBe('example.com.pdf')
  })
})

describe('PDF pages', () => {
  const page = (answer: unknown) => ({ executeJavaScriptInIsolatedWorld: async () => { if (answer instanceof Error) throw answer; return answer } })
  it('knows a PDF shown in the viewer from a web page', async () => {
    expect(await isPdfDocument(page('application/pdf'), 1)).toBe(true)
    expect(await isPdfDocument(page('text/html'), 1)).toBe(false)
    expect(await isPdfDocument(page(new Error('gone')), 1)).toBe(false)
  })
})
