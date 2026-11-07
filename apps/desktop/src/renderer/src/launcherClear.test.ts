import { describe, expect, it } from 'vitest'
import { LauncherClear } from './launcherClear'

describe('LauncherClear', () => {
  it('clears once main has started loading the address, not again when the load finishes', () => {
    const clear = new LauncherClear()
    const ticket = clear.submit('https://example.org/')
    expect(clear.started('https://other.example/')).toBe(false)
    expect(clear.started('https://example.org/')).toBe(true)
    expect(clear.settled(ticket)).toBe(false)
  })

  it('clears when the open settles if no load was reported (an open tab shown, a topic)', () => {
    const clear = new LauncherClear()
    const ticket = clear.submit('https://example.org/')
    expect(clear.settled(ticket)).toBe(true)
    // An address it could not work out still clears when the open settles.
    expect(clear.settled(clear.submit(null))).toBe(true)
  })

  it('never clears over what was typed (or filled in) after Enter', () => {
    const clear = new LauncherClear()
    const ticket = clear.submit('https://example.org/')
    clear.edited()
    expect(clear.started('https://example.org/')).toBe(false)
    expect(clear.settled(ticket)).toBe(false)
  })

  it('keeps the text when the open fails, and an older Enter never clears a newer one', () => {
    const clear = new LauncherClear()
    const failing = clear.submit('ftp://example.org/')
    clear.failed(failing)
    expect(clear.settled(failing)).toBe(false)
    const first = clear.submit('https://a.example/')
    const second = clear.submit('https://b.example/')
    expect(clear.settled(first)).toBe(false)
    expect(clear.started('https://a.example/')).toBe(false)
    expect(clear.settled(second)).toBe(true)
  })
})
