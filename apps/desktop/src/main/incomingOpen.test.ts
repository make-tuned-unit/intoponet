import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { IncomingBurst, IncomingOpenQueue, LocalFileGrants, MAX_HELD_INCOMING, MAX_SAVED_LINK_BYTES, incomingFileTarget, incomingTargetsFromArgs, incomingWebUrl, parseWebloc, readSavedLinkFile, type HeldIncomingCount, type IncomingTarget } from './incomingOpen'

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

  it('reads a saved link only from an ordinary small file, never a pipe or a device', () => {
    const root = mkdtempSync(join(tmpdir(), 'intoponet-webloc-'))
    try {
      writeFileSync(join(root, 'Link.webloc'), XML_WEBLOC)
      expect(incomingFileTarget(join(root, 'Link.webloc'), readSavedLinkFile)).toEqual({ kind: 'web', url: 'https://example.com/a?b=1&c=2' })
      // A named pipe would block the read until something wrote to it; a link to /dev/zero would never end.
      execFileSync('mkfifo', [join(root, 'Pipe.webloc')])
      symlinkSync('/dev/zero', join(root, 'Zero.webloc'))
      writeFileSync(join(root, 'Big.webloc'), Buffer.alloc(MAX_SAVED_LINK_BYTES + 1, 32))
      expect(incomingFileTarget(join(root, 'Pipe.webloc'), readSavedLinkFile)).toBeNull()
      expect(incomingFileTarget(join(root, 'Zero.webloc'), readSavedLinkFile)).toBeNull()
      expect(incomingFileTarget(join(root, 'Big.webloc'), readSavedLinkFile)).toBeNull()
      expect(incomingTargetsFromArgs(['Intoponet', join(root, 'Pipe.webloc'), 'https://example.org/'], root, readSavedLinkFile)).toEqual([{ kind: 'web', url: 'https://example.org/' }])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
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

describe('a burst of links from other apps', () => {
  const web = (n: number): IncomingTarget => ({ kind: 'web', url: `https://example.com/${n}` })
  const burst = () => {
    let now = 0
    const opened: string[] = []
    const notices: (HeldIncomingCount | null)[] = []
    const guard = new IncomingBurst({ open: (target) => opened.push(target.url), changed: (held) => notices.push(held), now: () => now })
    return { guard, opened, notices, at: (ms: number) => { now = ms } }
  }

  it('opens links one by one, and up to 6 at once, without a notice', () => {
    const { guard, opened, notices, at } = burst()
    for (let i = 0; i < 6; i += 1) guard.push(web(i))
    at(3_000)
    for (let i = 6; i < 12; i += 1) guard.push(web(i))
    expect(opened).toHaveLength(12)
    expect(notices).toEqual([])
    expect(guard.state()).toBeNull()
  })

  it('opens the first 6 of more than 6 within 3 seconds; the rest wait for "Open the rest"', () => {
    const { guard, opened, notices, at } = burst()
    for (let i = 0; i < 9; i += 1) { at(i * 100); guard.push(web(i)) }
    expect(opened).toEqual([0, 1, 2, 3, 4, 5].map((n) => `https://example.com/${n}`))
    expect(guard.state()).toEqual({ opened: 6, total: 9 })
    expect(notices.at(-1)).toEqual({ opened: 6, total: 9 })
    guard.openRest()
    expect(opened).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => `https://example.com/${n}`))
    expect(guard.state()).toBeNull()
    expect(notices.at(-1)).toBeNull()
  })

  it('drops the waiting links when the notice is dismissed, and opens the next link straight away', () => {
    const { guard, opened, at } = burst()
    for (let i = 0; i < 8; i += 1) guard.push(web(i))
    guard.dismiss()
    expect(guard.state()).toBeNull()
    expect(opened).toHaveLength(6)
    at(500)
    guard.push(web(99))
    expect(opened.at(-1)).toBe('https://example.com/99')
    guard.openRest()
    expect(opened).toHaveLength(7)
  })

  it('keeps holding while links keep coming fast, and opens one that comes after a pause (counted in the notice)', () => {
    const { guard, opened, notices, at } = burst()
    // A link every 400 ms: more than 6 in 3 seconds, for as long as it goes on.
    for (let i = 0; i < 20; i += 1) { at(i * 400); guard.push(web(i)) }
    expect(opened).toHaveLength(6)
    expect(guard.state()).toEqual({ opened: 6, total: 20 })
    at(19 * 400 + 3_000)
    guard.push(web(50))
    expect(opened.at(-1)).toBe('https://example.com/50')
    expect(guard.state()).toEqual({ opened: 7, total: 21 })
    expect(notices.at(-1)).toEqual({ opened: 7, total: 21 })
  })

  it('a second burst while the notice shows adds to it', () => {
    const { guard, at } = burst()
    for (let i = 0; i < 8; i += 1) guard.push(web(i))
    at(10_000)
    for (let i = 0; i < 8; i += 1) guard.push(web(100 + i))
    expect(guard.state()).toEqual({ opened: 12, total: 16 })
  })

  it('keeps at most 100 waiting', () => {
    const { guard, opened } = burst()
    for (let i = 0; i < 6 + MAX_HELD_INCOMING + 50; i += 1) guard.push(web(i))
    expect(guard.state()).toEqual({ opened: 6, total: 6 + MAX_HELD_INCOMING })
    guard.openRest()
    expect(opened).toHaveLength(6 + MAX_HELD_INCOMING)
  })

  it('applies to links waiting from before launch too', () => {
    const { guard, opened } = burst()
    const queue = new IncomingOpenQueue()
    for (let i = 0; i < 10; i += 1) queue.push(web(i))
    queue.ready((target) => guard.push(target))
    expect(opened).toHaveLength(6)
    expect(guard.state()).toEqual({ opened: 6, total: 10 })
  })
})

describe('local files a tab may read', () => {
  it('serves opened files and a saved page’s own assets only', () => {
    // These paths are not on disk: links are taken as already resolved.
    const grants = new LocalFileGrants((path) => path)
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

  it('never follows a link in a saved page’s folder out of it', () => {
    const root = mkdtempSync(join(tmpdir(), 'intoponet-grants-'))
    try {
      writeFileSync(join(root, 'secret.txt'), 'secret')
      mkdirSync(join(root, 'elsewhere'))
      writeFileSync(join(root, 'elsewhere', 'inside.css'), 'elsewhere')
      mkdirSync(join(root, 'saved', 'Page_files', 'images'), { recursive: true })
      writeFileSync(join(root, 'saved', 'Page.html'), '<title>Saved</title>')
      writeFileSync(join(root, 'saved', 'Page_files', 'style.css'), 'h1{}')
      writeFileSync(join(root, 'saved', 'Page_files', 'images', 'a.png'), 'png')
      // As an archive unpacked by Finder can leave them: a file and a whole folder that point elsewhere.
      symlinkSync('../../secret.txt', join(root, 'saved', 'Page_files', 'leak.css'))
      symlinkSync('images/a.png', join(root, 'saved', 'Page_files', 'same.png'))
      writeFileSync(join(root, 'saved', 'Other.html'), '<title>Other</title>')
      symlinkSync('../elsewhere', join(root, 'saved', 'Other_files'))
      const grants = new LocalFileGrants()
      grants.grant(join(root, 'saved', 'Page.html'))
      grants.grant(join(root, 'saved', 'Other.html'))
      expect(grants.allows(join(root, 'saved', 'Page_files', 'style.css'))).toBe(true)
      expect(grants.allows(join(root, 'saved', 'Page_files', 'images', 'a.png'))).toBe(true)
      // A link that stays inside the folder is still the page's own.
      expect(grants.allows(join(root, 'saved', 'Page_files', 'same.png'))).toBe(true)
      expect(grants.allows(join(root, 'saved', 'Page_files', 'leak.css'))).toBe(false)
      expect(grants.allows(join(root, 'saved', 'Other_files', 'inside.css'))).toBe(false)
      expect(grants.allows(join(root, 'saved', 'Page_files', 'missing.css'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
