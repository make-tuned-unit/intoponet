import { describe, expect, it } from 'vitest'
import { savePageFilename } from './savePage'

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
})
