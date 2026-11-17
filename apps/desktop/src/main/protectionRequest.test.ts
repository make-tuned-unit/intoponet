import { describe, expect, it } from 'vitest'
import { LocalProtectionEngine, ProtectionPageContextStore, compileProtectionLists } from '@intoponet/protection-engine'
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

  it('with filter lists: counts each blocked request once by its list, and never a page\'s own requests', () => {
    const engine = new LocalProtectionEngine()
    engine.loadLists(compileProtectionLists({ ads: '||ads.example^\n||widgets.example^$third-party', trackers: '||metrics.example^\n||ads.example^$image' }))
    const pages = new ProtectionPageContextStore()
    const tab: ProtectionTab = { url: 'https://news.example.org/story', view: { webContents: { id: 7, getURL: () => 'https://news.example.org/story' } } }
    const ask = (url: string, resourceType: string, initiatorOrigin = 'https://news.example.org') =>
      routeProtectionRequest(engine, pages, { id: 1, url, resourceType, initiatorOrigin, referrer: '', webContentsId: 7 }, [tab])?.decision

    // In both lists: one request, counted once (as an ad).
    expect(ask('https://ads.example/banner.png', 'image')).toMatchObject({ action: 'block', category: 'ad' })
    expect(ask('https://metrics.example/collect', 'ping')).toMatchObject({ action: 'block', category: 'tracker' })
    expect(pages.counters(7)).toEqual({ blockedAds: 1, blockedTrackers: 1 })
    // The page's own site (another host of it) and an unlisted site are let through and not counted.
    expect(ask('https://cdn.example.org/ads.example/app.js', 'script')?.action).toBe('allow')
    expect(ask('https://static.other.example/app.js', 'script')?.action).toBe('allow')
    // A widget's frame asking its own site is not third-party to that frame; the page asking for it is.
    expect(ask('https://cdn.widgets.example/app.js', 'script', 'https://embed.widgets.example')?.action).toBe('allow')
    expect(ask('https://cdn.widgets.example/app.js', 'script')?.action).toBe('block')
    expect(pages.counters(7)).toEqual({ blockedAds: 2, blockedTrackers: 1 })
    // A request no page made is judged as another site's, with no counter.
    const unattributed = routeProtectionRequest(engine, pages, { id: 2, url: 'https://cdn.widgets.example/app.js', resourceType: 'xhr', referrer: '' }, [tab])
    expect(unattributed).toMatchObject({ webContentsId: -1, decision: { action: 'block' } })
    expect(pages.counters(7)).toEqual({ blockedAds: 2, blockedTrackers: 1 })
  })
})
