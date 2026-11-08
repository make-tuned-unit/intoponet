import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isAppShellUrl } from './shellGuard'

describe('app shell URL', () => {
  const packaged = 'file:///Applications/Intoponet.app/Contents/Resources/app.asar/out/renderer/index.html'

  it('accepts the packaged index.html, with or without a hash or query', () => {
    expect(isAppShellUrl(packaged, packaged)).toBe(true)
    expect(isAppShellUrl(`${packaged}#settings`, packaged)).toBe(true)
    expect(isAppShellUrl(`${packaged}?x=1`, packaged)).toBe(true)
  })

  it('refuses web pages and other local files', () => {
    expect(isAppShellUrl('https://example.com/', packaged)).toBe(false)
    expect(isAppShellUrl('file:///Users/me/Downloads/evil.html', packaged)).toBe(false)
    expect(isAppShellUrl('data:text/html,<p>hi', packaged)).toBe(false)
    expect(isAppShellUrl('about:blank', packaged)).toBe(false)
    expect(isAppShellUrl('not a url', packaged)).toBe(false)
  })

  it('in development, accepts the dev server origin only', () => {
    const dev = 'http://localhost:5173/'
    expect(isAppShellUrl('http://localhost:5173/', dev)).toBe(true)
    expect(isAppShellUrl('http://localhost:5173/src/main.tsx', dev)).toBe(true)
    expect(isAppShellUrl('http://localhost:5174/', dev)).toBe(false)
    expect(isAppShellUrl('https://example.com/', dev)).toBe(false)
  })
})

describe('channels pages could reach', () => {
  /** Every main-process source file (tests aside), as text. */
  const sources = (folder: string): Array<{ file: string; text: string }> => readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [{ file: relative(import.meta.dirname, path), text: readFileSync(path, 'utf8') }] : []
  })

  it('are answered only through the shell-only wrapper, plus the sign-in helper report (which checks its sender)', () => {
    const all = sources(import.meta.dirname)
    const uses = all.flatMap(({ file, text }) =>
      [...text.matchAll(/\bipcMain\.(handle|handleOnce|on|once|addListener)\(([^,]*),/g)].map((match) => `${file}: ${match[1]}(${match[2]!.trim()})`))
    // handleFromShell (isFromShell: the app window's own top frame showing the app) and the page
    // preload's password report (a tab's top frame only; its origin is read in main, never trusted).
    expect(uses.sort()).toEqual(['index.ts: handle(channel)', 'index.ts: on(passwordPageChannels.report)'])
    expect(all.filter(({ text }) => /\.ipc\.(handle|handleOnce|on|once)\(/.test(text)).map(({ file }) => file)).toEqual([])
  })
})
