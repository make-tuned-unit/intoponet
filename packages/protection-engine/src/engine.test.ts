import { describe, expect, it } from 'vitest'
import { LocalProtectionEngine, ProtectionPageContextStore } from './index'

const ads = {
  requestUrl: 'https://ads.intoponet.test/banner.js',
  topLevelUrl: 'https://example.com/',
  initiatorOrigin: 'https://example.com',
  resourceType: 'script' as const,
  profileId: 'default',
  isPrivate: false,
}

describe('LocalProtectionEngine', () => {
  it('blocks a fixture ad request before it would download', () => {
    const engine = new LocalProtectionEngine()
    expect(engine.evaluate(ads)).toEqual({
      action: 'block',
      category: 'ad',
      ruleId: 'fix-ads-intoponet-test',
    })
  })

  it('allows first-party documents and same-site resources', () => {
    const engine = new LocalProtectionEngine()
    expect(
      engine.evaluate({
        ...ads,
        requestUrl: 'https://example.com/app.js',
        resourceType: 'script',
      }).action,
    ).toBe('allow')
    expect(
      engine.evaluate({
        ...ads,
        requestUrl: 'https://ads.intoponet.test/',
        topLevelUrl: 'https://ads.intoponet.test/',
        resourceType: 'document',
      }).action,
    ).toBe('allow')
  })

  it('honours a per-site pause', () => {
    const engine = new LocalProtectionEngine()
    engine.setSiteEnabled('https://example.com', 'default', false)
    expect(engine.evaluate(ads).action).toBe('allow')
    engine.setSiteEnabled('https://example.com', 'default', true)
    expect(engine.evaluate(ads).action).toBe('block')
  })

  it('honours a global advertising category pause', () => {
    const engine = new LocalProtectionEngine()
    engine.setCategoryEnabled('ad', false)
    expect(engine.evaluate(ads).action).toBe('allow')
    engine.setCategoryEnabled('ad', true)
    expect(engine.evaluate(ads).action).toBe('block')
  })

  it('returns fixture cosmetic hide rules when advertising is on', () => {
    const engine = new LocalProtectionEngine()
    expect(engine.cosmeticRules('', '').hideSelectors.length).toBeGreaterThan(0)
    engine.setCategoryEnabled('ad', false)
    expect(engine.cosmeticRules('', '').hideSelectors).toEqual([])
  })
})

describe('ProtectionPageContextStore', () => {
  it('keeps origins, site pauses, and blocked counters separate across two tabs', () => {
    const engine = new LocalProtectionEngine()
    const pages = new ProtectionPageContextStore()
    pages.setCommittedUrl(101, 'https://paused.example/article')
    pages.setCommittedUrl(202, 'https://active.example/article')
    engine.setSiteEnabled('https://paused.example', 'default', false)

    const pausedDecision = engine.evaluate({
      ...ads,
      topLevelUrl: pages.topLevelUrl(101),
    })
    const activeDecision = engine.evaluate({
      ...ads,
      topLevelUrl: pages.topLevelUrl(202),
    })

    expect(pausedDecision.action).toBe('allow')
    expect(activeDecision.action).toBe('block')
    if (activeDecision.action === 'block') {
      pages.recordBlocked(202, activeDecision.category ?? 'other')
    }

    expect(pages.counters(101)).toEqual({ blockedAds: 0, blockedTrackers: 0 })
    expect(pages.counters(202)).toEqual({ blockedAds: 1, blockedTrackers: 0 })
    expect(engine.evaluate({
      ...ads,
      topLevelUrl: pages.topLevelUrl(101),
    }).action).toBe('allow')
  })

  it('routes early requests through a pending destination and promotes their counts on commit', () => {
    const pages = new ProtectionPageContextStore()
    const engine = new LocalProtectionEngine()
    pages.setCommittedUrl(101, 'https://old.example/one')
    pages.recordBlocked(101, 'tracker')
    pages.beginNavigation(101, 700, 'https://new.example/two')

    expect(pages.topLevelUrl(101)).toBe('https://new.example/two')
    expect(pages.counters(101)).toEqual({ blockedAds: 0, blockedTrackers: 0 })
    const decision = engine.evaluate({
      ...ads,
      topLevelUrl: pages.topLevelUrl(101),
    })
    expect(decision.action).toBe('block')
    if (decision.action === 'block' && decision.category) {
      pages.recordBlocked(101, decision.category)
    }

    pages.commitNavigation(101, 'https://new.example/two')
    expect(pages.topLevelUrl(101)).toBe('https://new.example/two')
    expect(pages.counters(101)).toEqual({ blockedAds: 1, blockedTrackers: 0 })
  })

  it('discards pending counts and restores the committed page after a failed navigation', () => {
    const pages = new ProtectionPageContextStore()
    pages.setCommittedUrl(101, 'https://old.example/one')
    pages.recordBlocked(101, 'ad')
    pages.beginNavigation(101, 700, 'https://new.example/two')
    pages.recordBlocked(101, 'tracker')
    pages.failNavigation(101, 'https://new.example/two', 'https://old.example/one')

    expect(pages.topLevelUrl(101)).toBe('https://old.example/one')
    expect(pages.counters(101)).toEqual({ blockedAds: 1, blockedTrackers: 0 })
  })

  it('tracks a redirect target and ignores a failure for an earlier redirect URL', () => {
    const pages = new ProtectionPageContextStore()
    pages.setCommittedUrl(101, 'https://old.example/')
    pages.beginNavigation(101, 700, 'https://redirect.example/start')
    pages.beginNavigation(101, 700, 'https://final.example/page')
    pages.recordBlocked(101, 'tracker')

    pages.failNavigation(
      101,
      'https://redirect.example/start',
      'https://old.example/',
    )
    expect(pages.topLevelUrl(101)).toBe('https://final.example/page')
    expect(pages.counters(101)).toEqual({ blockedAds: 0, blockedTrackers: 1 })

    pages.commitNavigation(101, 'https://final.example/page')
    expect(pages.counters(101)).toEqual({ blockedAds: 0, blockedTrackers: 1 })
  })

  it('removes closed page state', () => {
    const pages = new ProtectionPageContextStore()
    pages.setCommittedUrl(101, 'https://example.com/one')
    pages.remove(101)
    expect(pages.topLevelUrl(101)).toBeNull()
  })
})
