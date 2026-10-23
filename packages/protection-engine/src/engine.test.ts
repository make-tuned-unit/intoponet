import { describe, expect, it } from 'vitest'
import { LocalProtectionEngine } from './engine'

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
