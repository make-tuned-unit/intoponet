import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ensureQuarantine, QUARANTINE_ATTRIBUTE, quarantineValue } from './quarantine'

describe('quarantine', () => {
  it('formats the flag as downloaded-by-Intoponet', () => {
    expect(quarantineValue(0x65000000 * 1000, 'abc-def')).toBe('0083;65000000;Intoponet;ABC-DEF')
  })

  it('keeps a flag that is already there and adds one when missing', async () => {
    const present = vi.fn(async () => '0081;1;Chrome;X\n')
    expect(await ensureQuarantine('/tmp/a', { platform: 'darwin', run: present })).toBe('present')
    expect(present).toHaveBeenCalledTimes(1)
    const calls: string[][] = []
    const missing = vi.fn(async (_file: string, args: string[]) => {
      calls.push(args)
      if (args[0] === '-p') throw new Error('No such xattr')
      return ''
    })
    expect(await ensureQuarantine('/tmp/a', { platform: 'darwin', run: missing, now: 0 })).toBe('added')
    expect(calls[1]!.slice(0, 2)).toEqual(['-w', QUARANTINE_ATTRIBUTE])
    expect(calls[1]![3]).toBe('/tmp/a')
    expect(await ensureQuarantine('/tmp/a', { platform: 'linux', run: missing })).toBe('unsupported')
    await expect(ensureQuarantine('relative', { platform: 'darwin', run: missing })).rejects.toThrow()
  })

  it.runIf(process.platform === 'darwin')('sets a real com.apple.quarantine attribute on this Mac', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'intoponet-quarantine-'))
    try {
      const file = join(directory, 'download.txt')
      writeFileSync(file, 'hello')
      expect(await ensureQuarantine(file)).toBe('added')
      const value = execFileSync('/usr/bin/xattr', ['-p', QUARANTINE_ATTRIBUTE, file], { encoding: 'utf8' }).trim()
      expect(value).toMatch(/^0083;[0-9a-f]+;Intoponet;[0-9A-F-]{36}$/)
      expect(await ensureQuarantine(file)).toBe('present')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
