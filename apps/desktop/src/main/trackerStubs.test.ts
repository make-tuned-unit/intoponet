import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { TRACKER_STUB_SCRIPT } from './trackerStubs'

type Win = Record<string, unknown> & { dataLayer?: unknown[] }

function run(initial: Win = {}): Win {
  const window: Win = { ...initial }
  runInNewContext(TRACKER_STUB_SCRIPT, { window, setTimeout: (fn: () => void) => fn(), Date })
  return window
}

describe('tracker stubs', () => {
  it('lets a page call gtag when the tag script was blocked (cookie banner OK)', () => {
    const window = run()
    expect(() => (window['gtag'] as (...args: unknown[]) => void)('consent', 'update', { analytics_storage: 'granted' })).not.toThrow()
    expect(window.dataLayer).toHaveLength(1)
  })

  it('runs the callbacks pages wait for before navigating', () => {
    const window = run()
    let calls = 0
    ;(window['gtag'] as (...args: unknown[]) => void)('event', 'click', { event_callback: () => { calls += 1 } })
    ;(window['ga'] as (...args: unknown[]) => void)('send', 'event', { hitCallback: () => { calls += 1 } })
    window.dataLayer!.push({ event: 'x', eventCallback: () => { calls += 1 } })
    expect(calls).toBe(3)
  })

  it('never replaces what the page or a loaded tag already defined', () => {
    const gtag = (): void => {}
    const ga = (): void => {}
    const layer: unknown[] = []
    const window = run({ gtag, ga, dataLayer: layer, google_tag_manager: {} })
    expect(window['gtag']).toBe(gtag)
    expect(window['ga']).toBe(ga)
    expect(window.dataLayer).toBe(layer)
    expect(layer.push).toBe(Array.prototype.push)
  })

  it('defines a quiet Meta pixel queue', () => {
    const window = run()
    expect(() => (window['fbq'] as (...args: unknown[]) => void)('track', 'PageView')).not.toThrow()
    expect(window['_fbq']).toBe(window['fbq'])
  })
})
