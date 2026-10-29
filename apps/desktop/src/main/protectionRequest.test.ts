import { describe, expect, it } from 'vitest'
import { LocalProtectionEngine, ProtectionPageContextStore } from '@intoponet/protection-engine'
import { routeProtectionRequest, type ProtectionTab } from './protectionRequest'

const base = {
  id: 1,
  url: 'https://track.intoponet.test/pixel.js',
  resourceType: 'script',
  initiatorOrigin: 'https://example.org',
  referrer: 'https://example.org/page',
}

describe('routeProtectionRequest', () => {
  it('uses the issuing origin for unattributed requests without inventing tab counters', () => {
    const pages = new ProtectionPageContextStore()
    const routed = routeProtectionRequest(new LocalProtectionEngine(), pages, base, [])

    expect(routed).toMatchObject({
      webContentsId: -1,
      topLevelUrl: 'https://example.org/',
      decision: { action: 'block', category: 'tracker', ruleId: 'fix-track-intoponet-test' },
    })
    expect(pages.counters(null)).toEqual({ blockedAds: 0, blockedTrackers: 0 })
    expect(pages.topLevelUrl(-1)).toBeNull()
  })

  it('leaves unrelated unattributed requests alone', () => {
    const routed = routeProtectionRequest(
      new LocalProtectionEngine(),
      new ProtectionPageContextStore(),
      { ...base, url: 'https://cdn.example.org/app.js' },
      [],
    )
    expect(routed?.webContentsId).toBe(-1)
    expect(routed?.decision.action).toBe('allow')
  })

  it('applies a per-site pause to a worker request using its known initiator origin', () => {
    const engine = new LocalProtectionEngine()
    engine.setSiteEnabled('https://example.org', 'default', false)
    const routed = routeProtectionRequest(engine, new ProtectionPageContextStore(), base, [])
    expect(routed?.topLevelUrl).toBe('https://example.org/')
    expect(routed?.decision.action).toBe('allow')
  })

  it('uses redirected pending main-frame context for early resource requests', () => {
    const pages = new ProtectionPageContextStore()
    const tab: ProtectionTab = {
      url: 'https://old.example/page',
      view: { webContents: { id: 42, getURL: () => 'https://old.example/page' } },
    }
    const start = routeProtectionRequest(new LocalProtectionEngine(), pages, {
      ...base,
      id: 99,
      url: 'https://redirect.example/start',
      webContentsId: 42,
      resourceType: 'mainFrame',
    }, [tab])
    const redirect = routeProtectionRequest(new LocalProtectionEngine(), pages, {
      ...base,
      id: 99,
      url: 'https://protected.example/final',
      webContentsId: 42,
      resourceType: 'mainFrame',
    }, [tab])
    const earlyResource = routeProtectionRequest(new LocalProtectionEngine(), pages, {
      ...base,
      id: 100,
      url: 'https://track.intoponet.test/pixel.js',
      webContentsId: 42,
    }, [tab])

    expect(start?.topLevelUrl).toBe('https://redirect.example/start')
    expect(redirect?.topLevelUrl).toBe('https://protected.example/final')
    expect(earlyResource?.topLevelUrl).toBe('https://protected.example/final')
    expect(earlyResource?.decision.action).toBe('block')
  })
})
