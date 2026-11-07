import { describe, expect, it } from 'vitest'
import {
  inferLauncherIntent,
  parseBrowserHostCommand,
  PRIVATE_LIBRARY_MAX_CHARS,
  resolveNavigationIntent,
} from '@intoponet/browser-api'

describe('resolveNavigationIntent', () => {
  it('adds HTTPS to a direct host', () => {
    expect(resolveNavigationIntent({ kind: 'url', value: 'example.com' })).toBe(
      'https://example.com/',
    )
  })

  it('encodes web searches', () => {
    expect(resolveNavigationIntent({ kind: 'search', value: 'local history' })).toBe(
      'https://duckduckgo.com/?q=local%20history',
    )
  })

  it('rejects privileged schemes', () => {
    expect(() =>
      resolveNavigationIntent({ kind: 'url', value: 'file:///etc/passwd' }),
    ).toThrow('Only HTTP and HTTPS')
  })
})

describe('inferLauncherIntent', () => {
  it('promotes a typed host to a URL from any launcher mode', () => {
    expect(inferLauncherIntent('example.com/docs', 'topic')).toEqual({
      kind: 'url',
      value: 'example.com/docs',
    })
    expect(inferLauncherIntent('https://wikipedia.org', 'search')).toEqual({
      kind: 'url',
      value: 'https://wikipedia.org',
    })
  })

  it('keeps ordinary phrases in the requested mode', () => {
    expect(inferLauncherIntent('open knowledge', 'topic')).toEqual({
      kind: 'topic',
      value: 'open knowledge',
    })
    expect(inferLauncherIntent('local history', 'search')).toEqual({
      kind: 'search',
      value: 'local history',
    })
  })
})

describe('parseBrowserHostCommand', () => {
  it('accepts an open disposition from the address bar and nothing else', () => {
    const intent = { kind: 'url', value: 'example.com' }
    expect(parseBrowserHostCommand({ type: 'open', intent, disposition: 'background-tab' })).toEqual({ type: 'open', intent, disposition: 'background-tab' })
    expect(parseBrowserHostCommand({ type: 'open', intent, disposition: 'foreground-tab' })).toEqual({ type: 'open', intent, disposition: 'foreground-tab' })
    expect(parseBrowserHostCommand({ type: 'open', intent })).toEqual({ type: 'open', intent })
    expect(() => parseBrowserHostCommand({ type: 'open', intent, disposition: 'new-window' })).toThrow('Invalid open disposition')
  })

  it('opens a page that leaves no trace only in a tab of its own (the guided tour)', () => {
    const intent = { kind: 'url', value: 'example.com' }
    expect(parseBrowserHostCommand({ type: 'open', intent, disposition: 'background-tab', untracked: true })).toEqual({ type: 'open', intent, disposition: 'background-tab', untracked: true })
    expect(parseBrowserHostCommand({ type: 'open', intent, disposition: 'foreground-tab', untracked: 'yes' })).toEqual({ type: 'open', intent, disposition: 'foreground-tab' })
    expect(() => parseBrowserHostCommand({ type: 'open', intent, untracked: true })).toThrow('tab of its own')
  })

  it('parses the address bar menu request', () => {
    expect(parseBrowserHostCommand({ type: 'address-menu', hasSelection: true, extra: 1 })).toEqual({ type: 'address-menu', hasSelection: true })
    expect(parseBrowserHostCommand({ type: 'address-menu', hasSelection: 'yes' })).toEqual({ type: 'address-menu', hasSelection: false })
  })

  it('copies a valid command into the trusted shape', () => {
    expect(
      parseBrowserHostCommand({
        type: 'open',
        intent: { kind: 'url', value: 'example.com', ignored: true },
        ignored: true,
      }),
    ).toEqual({
      type: 'open',
      intent: { kind: 'url', value: 'example.com' },
    })
  })

  it('rejects malformed and unknown commands', () => {
    expect(() => parseBrowserHostCommand({ type: 'execute', script: 'nope' })).toThrow(
      'Unknown browser-host command',
    )
    expect(() =>
      parseBrowserHostCommand({
        type: 'set-bounds',
        bounds: { x: 0, y: 0, width: Number.NaN, height: 600 },
      }),
    ).toThrow('Invalid panel bounds')
  })

  it('rejects oversized navigation values', () => {
    expect(() =>
      parseBrowserHostCommand({
        type: 'navigate',
        url: `https://example.com/${'a'.repeat(8_193)}`,
      }),
    ).toThrow('Invalid navigation URL')
  })

  it('copies find, print and stop commands', () => {
    expect(
      parseBrowserHostCommand({
        type: 'find',
        query: 'beacon',
        findNext: true,
        ignored: true,
      }),
    ).toEqual({
      type: 'find',
      query: 'beacon',
      findNext: true,
      forward: true,
    })
    expect(parseBrowserHostCommand({ type: 'print' })).toEqual({ type: 'print' })
    expect(parseBrowserHostCommand({ type: 'zoom', action: 'in' })).toEqual({
      type: 'zoom',
      action: 'in',
    })
    expect(parseBrowserHostCommand({ type: 'stop' })).toEqual({ type: 'stop' })
    expect(parseBrowserHostCommand({ type: 'stop-find' })).toEqual({ type: 'stop-find' })
    expect(parseBrowserHostCommand({ type: 'read-private-library' })).toEqual({
      type: 'read-private-library',
    })
    expect(() => parseBrowserHostCommand({ type: 'write-private-library', payload: 12 })).toThrow(
      'Invalid private library',
    )
  })

  it('copies protection commands and rejects a non-boolean site flag', () => {
    expect(parseBrowserHostCommand({ type: 'get-protection' })).toEqual({
      type: 'get-protection',
    })
    expect(
      parseBrowserHostCommand({ type: 'set-site-protection', enabled: false, ignored: true }),
    ).toEqual({ type: 'set-site-protection', enabled: false })
    expect(() =>
      parseBrowserHostCommand({ type: 'set-site-protection', enabled: 'false' }),
    ).toThrow('Invalid site protection flag')
    expect(
      parseBrowserHostCommand({
        type: 'set-protection-categories',
        ads: true,
        trackers: false,
      }),
    ).toEqual({ type: 'set-protection-categories', ads: true, trackers: false })
    expect(parseBrowserHostCommand({ type: 'activate-tab', id: 'tab-1' })).toEqual({
      type: 'activate-tab',
      id: 'tab-1',
    })
    expect(parseBrowserHostCommand({ type: 'cycle-tabs', direction: 'previous' })).toEqual({
      type: 'cycle-tabs',
      direction: 'previous',
    })
    expect(parseBrowserHostCommand({ type: 'set-full-width', enabled: true })).toEqual({
      type: 'set-full-width',
      enabled: true,
    })
    expect(parseBrowserHostCommand({ type: 'set-tab-dock-open', open: false })).toEqual({
      type: 'set-tab-dock-open',
      open: false,
    })
    expect(() => parseBrowserHostCommand({ type: 'set-full-width', enabled: 'yes' })).toThrow(
      'Invalid full-width state',
    )
    expect(() => parseBrowserHostCommand({ type: 'set-tab-dock-open', open: 1 })).toThrow(
      'Invalid tab-dock state',
    )
    expect(() => parseBrowserHostCommand({ type: 'close-tab', id: '' })).toThrow('Invalid tab')
  })
})

describe('private library size', () => {
  it('accepts a large library (thousands of excerpts) and names the reason when one is too large', () => {
    const big = 'x'.repeat(2_000_000)
    expect(parseBrowserHostCommand({ type: 'write-private-library', payload: big })).toEqual({ type: 'write-private-library', payload: big })
    expect(() => parseBrowserHostCommand({ type: 'write-private-library', payload: 'x'.repeat(PRIVATE_LIBRARY_MAX_CHARS + 1) })).toThrow(/too large/)
    expect(() => parseBrowserHostCommand({ type: 'write-private-library', payload: 3 })).toThrow(/Invalid private library/)
  })
})
