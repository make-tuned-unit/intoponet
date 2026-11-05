import { describe, expect, it } from 'vitest'
import { IncomingOpenQueue, LocalFileGrants, incomingFileTarget, incomingTargetsFromArgs, incomingWebUrl, parseWebloc, type IncomingTarget } from './incomingOpen'

const XML_WEBLOC = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>URL</key><string>https://example.com/a?b=1&amp;c=2</string></dict></plist>`

describe('links from other apps', () => {
  it('accepts web addresses only', () => {
    expect(incomingWebUrl('https://example.com/x')).toBe('https://example.com/x')
    expect(incomingWebUrl('http://localhost:3000/')).toBe('http://localhost:3000/')
    expect(incomingWebUrl('file:///etc/passwd')).toBeNull()
    expect(incomingWebUrl('javascript:alert(1)')).toBeNull()
    expect(incomingWebUrl(`https://example.com/${'x'.repeat(9_000)}`)).toBeNull()
  })

  it('reads the link in a .webloc (XML and binary)', () => {
    expect(parseWebloc(XML_WEBLOC)).toBe('https://example.com/a?b=1&c=2')
    const binary = Buffer.concat([Buffer.from('bplist00\xd1\x01\x02SURL_\x10', 'latin1'), Buffer.from('https://example.org/page'), Buffer.from([0x08, 0x0b])])
    expect(parseWebloc(binary)).toBe('https://example.org/page')
    expect(parseWebloc('<plist><dict><key>URL</key><string>file:///etc/passwd</string></dict></plist>')).toBeNull()
  })

  it('opens pages, PDFs and saved links from Finder; nothing else', () => {
    const read = () => XML_WEBLOC
    expect(incomingFileTarget('/Users/me/Saved.html', read)).toEqual({ kind: 'file', url: 'file:///Users/me/Saved.html', path: '/Users/me/Saved.html' })
    expect(incomingFileTarget('/Users/me/Paper.PDF', read)?.kind).toBe('file')
    expect(incomingFileTarget('/Users/me/Link.webloc', read)).toEqual({ kind: 'web', url: 'https://example.com/a?b=1&c=2' })
    expect(incomingFileTarget('/Users/me/notes.txt', read)).toBeNull()
    expect(incomingFileTarget('/Applications/Calculator.app', read)).toBeNull()
    expect(incomingFileTarget('relative.html', read)).toBeNull()
  })

  it('reads a second launch’s arguments', () => {
    const argv = ['/Applications/Intoponet.app/Contents/MacOS/Intoponet', '--user-data-dir=/tmp/x', 'https://example.com/', 'page.html', '/tmp/app/out/main/index.js', 'mailto:a@b.c']
    expect(incomingTargetsFromArgs(argv, '/Users/me', () => '')).toEqual([
      { kind: 'web', url: 'https://example.com/' },
      { kind: 'file', url: 'file:///Users/me/page.html', path: '/Users/me/page.html' },
    ])
  })
})

describe('the queue of things to open', () => {
  it('waits until the browser is ready, then opens everything in order', () => {
    const queue = new IncomingOpenQueue()
    const opened: IncomingTarget[] = []
    queue.push({ kind: 'web', url: 'https://a.example/' })
    queue.push(null)
    queue.push({ kind: 'web', url: 'https://b.example/' })
    expect(queue.waiting).toBe(2)
    queue.ready((target) => opened.push(target))
    expect(opened.map((target) => target.url)).toEqual(['https://a.example/', 'https://b.example/'])
    // After that, each opens at once.
    queue.push({ kind: 'web', url: 'https://c.example/' })
    expect(opened).toHaveLength(3)
    expect(queue.waiting).toBe(0)
  })

  it('keeps only the latest few during a flood before launch', () => {
    const queue = new IncomingOpenQueue()
    for (let i = 0; i < 30; i += 1) queue.push({ kind: 'web', url: `https://example.com/${i}` })
    const opened: string[] = []
    queue.ready((target) => opened.push(target.url))
    expect(opened).toHaveLength(20)
    expect(opened.at(-1)).toBe('https://example.com/29')
  })
})

describe('local files a tab may read', () => {
  it('serves opened files and a saved page’s own assets only', () => {
    const grants = new LocalFileGrants()
    grants.grant('/Users/me/Downloads/Article.html')
    grants.grant('/Users/me/Documents/Paper.pdf')
    expect(grants.allows('/Users/me/Downloads/Article.html')).toBe(true)
    expect(grants.allows('/Users/me/Documents/Paper.pdf')).toBe(true)
    expect(grants.allows('/Users/me/Downloads/Article_files/style.css')).toBe(true)
    expect(grants.allows('/Users/me/Downloads/Article_files/../secret.png')).toBe(false)
    expect(grants.allows('/Users/me/Downloads/Article_files/notes.txt')).toBe(false)
    expect(grants.allows('/Users/me/Downloads/other.html')).toBe(false)
    expect(grants.allows('/Users/me/Documents/Other.pdf')).toBe(false)
    expect(grants.allows('/etc/passwd')).toBe(false)
  })
})
