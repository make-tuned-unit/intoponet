import { describe, expect, it } from 'vitest'
import { downloadCaution, isDangerousDownload, parseDownloadCommand } from '@intoponet/browser-api'
import { DownloadRateLimiter } from './downloadGuards'

describe('dangerous download types', () => {
  it('flags file types that can run code on a Mac', () => {
    for (const name of ['run.command', 'x.terminal', 'a.tool', 'Bad.app', 'setup.pkg', 'setup.mpkg', 'link.webloc', 'l.inetloc', 'f.fileloc', 'a.scpt', 'a.applescript', 'Flow.workflow', 'install.sh', 'lib.jar', 'UPPER.SH', 'trailing.command.', 'b.zsh']) {
      expect(isDangerousDownload(name), name).toBe(true)
    }
  })
  it('leaves ordinary files, zipped apps and disk images alone (disk images get a caution)', () => {
    for (const name of ['report.pdf', 'App.app.zip', 'photo.jpg', 'archive.tar.gz', 'installer.dmg', 'sh', '.sh', 'shell.shtml', 'readme']) {
      expect(isDangerousDownload(name), name).toBe(false)
    }
    expect(downloadCaution('installer.dmg')).toMatch(/Disk images/)
    expect(downloadCaution('report.pdf')).toBeNull()
  })
})

describe('DownloadRateLimiter', () => {
  it('allows three automatic downloads in ten seconds, then holds', () => {
    const limiter = new DownloadRateLimiter()
    expect([0, 1_000, 2_000].map((at) => limiter.check('page', at))).toEqual(['allow', 'allow', 'allow'])
    expect(limiter.check('page', 3_000)).toBe('hold')
    // Pages are counted separately.
    expect(limiter.check('other', 3_000)).toBe('allow')
    // The window slides.
    expect(limiter.check('page', 10_500)).toBe('allow')
  })
  it('a recent gesture allows one download without counting it', () => {
    const limiter = new DownloadRateLimiter({ maxAutomatic: 1 })
    expect(limiter.check('page', 0)).toBe('allow')
    limiter.gesture('page', 100)
    expect(limiter.check('page', 200)).toBe('allow')
    expect(limiter.check('page', 300)).toBe('hold')
    limiter.gesture('page', 400)
    expect(limiter.check('page', 400 + 6_000)).toBe('hold')
  })
  it('remembers Allow and Block for the page until it goes away', () => {
    const limiter = new DownloadRateLimiter({ maxAutomatic: 0 })
    limiter.allow('a')
    expect(limiter.check('a', 0)).toBe('allow')
    limiter.block('b')
    limiter.gesture('b', 0)
    expect(limiter.check('b', 0)).toBe('block')
    limiter.forget('b')
    expect(limiter.check('b', 0)).toBe('hold')
  })
})

describe('downloads command validation', () => {
  it('accepts known commands with a plain id and refuses anything else', () => {
    expect(parseDownloadCommand({ type: 'pause', id: 'abc-123' })).toEqual({ type: 'pause', id: 'abc-123' })
    expect(parseDownloadCommand({ type: 'clear-finished' })).toEqual({ type: 'clear-finished' })
    expect(() => parseDownloadCommand({ type: 'pause', id: '../x' })).toThrow()
    expect(() => parseDownloadCommand({ type: 'delete-file', id: 'a' })).toThrow()
    expect(() => parseDownloadCommand(null)).toThrow()
  })
})
