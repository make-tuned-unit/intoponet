import { describe, expect, it } from 'vitest'
import { browserUserAgent } from './browserUserAgent'

describe('browser user agent', () => {
  it('reads as plain Chrome, without Electron or the app name', () => {
    const electron = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Intoponet/0.1.13 Chrome/156.0.8078.48 Electron/45.0.0 Safari/537.36'
    expect(browserUserAgent(electron)).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.48 Safari/537.36')
  })
  it('leaves an already plain user agent alone', () => {
    const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'
    expect(browserUserAgent(chrome)).toBe(chrome)
  })
})
