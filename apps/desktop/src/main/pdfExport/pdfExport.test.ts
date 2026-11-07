import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ nativeImage: {}, BrowserWindow: class {}, session: {} }))
vi.mock('@mozilla/readability/Readability.js?raw', () => ({ default: 'function Readability() {} module.exports = Readability;' }))
vi.mock('@mozilla/readability/Readability-readerable.js?raw', () => ({ default: 'module.exports = function () { return true };' }))
vi.mock('dompurify/dist/purify.min.js?raw', () => ({ default: 'module.exports = { sanitize: (html) => html };' }))

const { pdfFilename } = await import('./filename')
const { parsePdfSettings, resolvePaper, DEFAULT_PDF_SETTINGS } = await import('./settings')
const { buildPrintDocument, cssString, readableDate } = await import('./template')
const { whereFromsPlist } = await import('./whereFrom')
const { AD_SELECTORS, cleanLiveScript, finalizeScript, prepareScript, REVERT_LIVE_SCRIPT } = await import('./pageScripts')
const { opaque } = await import('./printImages')
const { countPdfPages } = await import('./exportPdf')

const day = new Date(2026, 10, 5, 12)

describe('PDF file names', () => {
  it('is "Title – Site – date.pdf"', () => {
    expect(pdfFilename({ title: 'Harbour lights', site: 'Island News', url: 'https://news.example/a', isPrivate: false, date: day })).toBe('Harbour lights – Island News – 2026-11-05.pdf')
  })
  it('leaves the site out when the title already names it, and falls back to the host', () => {
    expect(pdfFilename({ title: 'BBC News', site: 'BBC News', url: 'https://bbc.com/', isPrivate: false, date: day })).toBe('BBC News – 2026-11-05.pdf')
    expect(pdfFilename({ title: 'BBC News - Home', site: '', url: 'https://www.bbc.co.uk/news', isPrivate: false, date: day })).toBe('BBC News - Home – 2026-11-05.pdf')
    expect(pdfFilename({ title: 'Kebbcake recipes', site: '', url: 'https://bbc.com/food', isPrivate: false, date: day })).toBe('Kebbcake recipes – bbc.com – 2026-11-05.pdf')
    expect(pdfFilename({ title: '', site: '', url: 'https://www.example.org/x', isPrivate: false, date: day })).toBe('example.org – 2026-11-05.pdf')
  })
  it('strips characters Finder handles badly, bidi tricks and leading dots, and caps the length', () => {
    const name = pdfFilename({ title: '..a/b:c*d?"e"<f>|g‮hidden', site: 'S', url: 'https://x.example/', isPrivate: false, date: day })
    expect(name).not.toMatch(/[/\\:*?"<>|‮]/)
    expect(name.startsWith('.')).toBe(false)
    expect(pdfFilename({ title: 'x'.repeat(400), site: '', url: 'https://x.example/', isPrivate: false, date: day }).length).toBeLessThan(150)
  })
  it('never cuts a character in half when it caps the length', () => {
    const name = pdfFilename({ title: `${'a'.repeat(118)}🙂🙂🙂 more`, site: '', url: 'https://x.example/', isPrivate: false, date: day })
    expect(name).toBe(`${'a'.repeat(118)}🙂… – 2026-11-05.pdf`)
    expect(/\p{Cs}/u.test(name)).toBe(false)
  })
  it('says nothing about the page for private tabs', () => {
    expect(pdfFilename({ title: 'Secret clinic results', site: 'Clinic', url: 'https://clinic.example/', isPrivate: true, date: day })).toBe('Saved page 2026-11-05.pdf')
  })
})

describe('PDF settings', () => {
  it('falls back field by field', () => {
    expect(parsePdfSettings(null)).toEqual(DEFAULT_PDF_SETTINGS)
    expect(parsePdfSettings({ mode: 'asSeen', paper: 'tabloid', images: 'no', groupId: '../x' })).toEqual({ ...DEFAULT_PDF_SETTINGS, mode: 'asSeen' })
    expect(parsePdfSettings({ groupId: 'c0ffee-12' }).groupId).toBe('c0ffee-12')
  })
  it('picks Letter in North America and A4 elsewhere', () => {
    expect(resolvePaper('auto', 'US')).toBe('Letter')
    expect(resolvePaper('auto', 'ca')).toBe('Letter')
    expect(resolvePaper('auto', 'DE')).toBe('A4')
    expect(resolvePaper('auto', '')).toBe('A4')
    expect(resolvePaper('letter', 'DE')).toBe('Letter')
    expect(resolvePaper('a4', 'US')).toBe('A4')
  })
})

describe('The printed document', () => {
  const meta = { title: 'A <b>bold</b> "title"', authors: ['Ann <script>'], site: 'Site', published: '2026-03-04T10:00:00Z', modified: '', url: 'https://example.com/a', canonicalUrl: 'javascript:alert(1)', doi: '10.1234/abc.5', lang: 'en" onload="x', dir: 'rtl' as const, description: '', keywords: [] }
  const html = buildPrintDocument({ articleHtml: '<p>Body</p>', meta, textSize: 'large', citation: true, savedAt: day })
  it('escapes everything the page said about itself', () => {
    expect(html).not.toContain('<b>bold</b>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('onload')
    expect(html).toContain('A &lt;b&gt;bold&lt;/b&gt; &quot;title&quot;')
  })
  it('has a strict policy, the source block, a footer and the chosen text size', () => {
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('https://example.com/a')
    expect(html).toContain('https://doi.org/10.1234/abc.5')
    expect(html).toContain('4 March 2026')
    expect(html).toContain('counter(pages)')
    expect(html).toContain('12.5pt')
    expect(html).toContain('dir="rtl"')
  })
  it('keeps footer text inside its CSS string', () => {
    expect(cssString('a"b\\c\nd</style>')).toBe('"a\\"b\\\\c d /style "')
  })
  it('reads dates plainly and keeps odd ones as given', () => {
    expect(readableDate('2001-05-10')).toBe('10 May 2001')
    expect(readableDate('Spring 1999')).toBe('Spring 1999')
    expect(readableDate('')).toBe('')
  })
})

describe('Finder "Where from"', () => {
  it('writes a binary property list macOS can read', () => {
    const plist = whereFromsPlist(['https://example.com/article', 'https://example.com/ünïcode-path-that-is-long-enough'])
    expect(plist.subarray(0, 8).toString()).toBe('bplist00')
    if (process.platform !== 'darwin') return
    const file = join(mkdtempSync(join(tmpdir(), 'wherefrom-')), 'p.plist')
    writeFileSync(file, plist)
    const json = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' })
    expect(JSON.parse(json)).toEqual(['https://example.com/article', 'https://example.com/ünïcode-path-that-is-long-enough'])
  })
})

describe('Page scripts', () => {
  const scripts = [
    prepareScript({ clone: true, images: true, scroll: true, budgetMs: 1000 }, ['.extra-ad']),
    finalizeScript({ blocked: ['https://ads.example/x.png'], mode: 'auto' }),
    cleanLiveScript([]),
    REVERT_LIVE_SCRIPT,
  ]
  it('are valid JavaScript', () => {
    for (const script of scripts) expect(() => new Function(`return ${script}`)).not.toThrow()
  })
  it('keep their regular expressions intact (a lost backslash turns \\s into "s")', () => {
    for (const script of scripts) {
      expect(script).not.toMatch(/\/s\+/)
      expect(script).not.toMatch(/\(\/\^www\.\//)
    }
    expect(scripts[0]).toContain('/\\s+(?:[|–—-]|·|::)\\s+/')
  })
  it('never read the JSON-LD article body', () => {
    const code = scripts.join('\n').replace(/\/\/.*$/gm, '')
    expect(code).not.toContain('articleBody')
  })
  it('match ad containers only at word starts ("head-container" is not an ad)', () => {
    const selector = AD_SELECTORS.join(',')
    expect(selector).toContain('[class*=" ad-container" i]')
    expect(selector).not.toContain('[class*="ad-container" i]')
  })
})

describe('Images and page counts', () => {
  it('tells opaque bitmaps from transparent ones', () => {
    expect(opaque(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]))).toBe(true)
    expect(opaque(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 0]))).toBe(false)
  })
  it('counts pages in a PDF', () => {
    const fake = new TextEncoder().encode('<< /Type /Pages /Count 2 >> << /Type /Page >> << /Type/Page /Parent 1 0 R >>')
    expect(countPdfPages(fake)).toBe(2)
  })
})

describe('Export as PDF commands from the app window', async () => {
  const { parseBrowserHostCommand } = await import('@intoponet/browser-api')
  it('accepts options and cleans them', () => {
    expect(parseBrowserHostCommand({ type: 'export-pdf' })).toEqual({ type: 'export-pdf' })
    expect(parseBrowserHostCommand({ type: 'export-pdf', options: { mode: 'weird' } })).toEqual({ type: 'export-pdf', options: DEFAULT_PDF_SETTINGS })
  })
  it('opens only absolute .pdf paths', () => {
    expect(parseBrowserHostCommand({ type: 'open-saved-file', path: '/Users/me/A.pdf', reveal: true })).toEqual({ type: 'open-saved-file', path: '/Users/me/A.pdf', reveal: true })
    for (const path of ['A.pdf', '/Applications/Calculator.app', '/tmp/a.pdf\0.app', 42]) {
      expect(() => parseBrowserHostCommand({ type: 'open-saved-file', path, reveal: false })).toThrow()
    }
  })
})
