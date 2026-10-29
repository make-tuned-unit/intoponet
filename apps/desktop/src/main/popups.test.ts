import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { bindPopupCloseWithOwner, nestedPopupDecision, popupDecision, popupWindowOptions, PopupLimiter } from './popups'

describe('popup policy', () => {
  it('opens ordinary new-tab requests as tabs and rejects unsupported protocols', () => {
    const limiter = new PopupLimiter()
    expect(popupDecision({ url: 'https://example.test/', disposition: 'new-foreground-tab', features: '' }, limiter, 1))
      .toEqual({ action: 'tab', background: false })
    expect(popupDecision({ url: 'mailto:user@example.test', disposition: 'new-window', features: '' }, limiter, 1))
      .toEqual({ action: 'deny', reason: 'Blocked a popup to an unsupported address.' })
  })

  it('enforces burst limits per owner and forgets the owner independently', () => {
    const limiter = new PopupLimiter(2, 1_000)
    const request = { url: 'https://example.test/', disposition: 'new-foreground-tab', features: '' }
    expect(popupDecision(request, limiter, 11, 10).action).toBe('tab')
    expect(popupDecision(request, limiter, 11, 20).action).toBe('tab')
    expect(popupDecision(request, limiter, 11, 30).action).toBe('deny')
    expect(popupDecision(request, limiter, 12, 30).action).toBe('tab')
    limiter.forget(11)
    expect(popupDecision(request, limiter, 11, 31).action).toBe('tab')
  })

  it('rate-limits popup-child requests, keeps only HTTP(S) tabs, and preserves root about:blank behavior', () => {
    const limiter = new PopupLimiter(2, 1_000)
    const first = { url: 'https://example.test/one', disposition: 'new-window', features: 'width=640,height=480' }
    expect(nestedPopupDecision(first, limiter, 45, 10)).toEqual({ action: 'tab', background: false })
    expect(nestedPopupDecision({ ...first, url: 'mailto:user@example.test' }, limiter, 45, 11).action).toBe('deny')
    expect(nestedPopupDecision({ ...first, url: 'about:blank' }, limiter, 45, 12).action).toBe('deny')
    expect(popupDecision({ ...first, url: 'about:blank' }, new PopupLimiter(), 46, 10).action).toBe('window')
    expect(nestedPopupDecision({ ...first, url: 'http://example.test/two' }, limiter, 45, 13).action).toBe('tab')
    expect(nestedPopupDecision({ ...first, url: 'https://example.test/three' }, limiter, 45, 14).action).toBe('deny')
  })

  it('provides bounded opener-preserving child window options', () => {
    const plan = popupDecision({ url: 'https://example.test/', disposition: 'new-window', features: 'width=9999,height=120' }, new PopupLimiter(), 1)
    expect(plan).toEqual({ action: 'window', width: 1200, height: 320 })
    if (plan.action !== 'window') throw new Error('expected a child window plan')
    const options = popupWindowOptions(plan)
    expect(options).toMatchObject({ width: 1200, height: 320, title: 'Sign-in window' })
    expect(options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false })
  })

  it('force-destroys the child when its opener WebContents is destroyed', () => {
    const opener = new EventEmitter() as EventEmitter & { isDestroyed: () => boolean }
    opener.isDestroyed = () => true
    const childEmitter = new EventEmitter()
    let destroyed = false
    const child = Object.assign(childEmitter, {
      isDestroyed: () => destroyed,
      close: () => { throw new Error('owner cleanup must not use vetoable close') },
      destroy: () => { destroyed = true; childEmitter.emit('closed') },
    })
    bindPopupCloseWithOwner(child as unknown as Electron.BrowserWindow, opener as unknown as Electron.WebContents)
    opener.emit('destroyed')
    expect(destroyed).toBe(true)
    expect(opener.listenerCount('destroyed')).toBe(0)
  })
})
