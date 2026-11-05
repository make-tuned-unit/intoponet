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
