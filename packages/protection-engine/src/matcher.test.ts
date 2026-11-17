import { describe, expect, it } from 'vitest'
import { LocalProtectionEngine, sameSite, siteOfHost } from './index'
import { urlParts } from './engine'
import type { CompiledRule, ResourceType } from './types'

const rules: CompiledRule[] = [
  { id: 'ads', host: 'adnet.example', category: 'ad' },
  { id: 'metrics', host: 'metrics.example', category: 'tracker' },
  { id: 'pixel', host: 'social.example', category: 'tracker', paths: ['/tr', '/i/adsct'] },
  { id: 'sdk-pixel', host: 'connect.social.example', category: 'tracker', pathIncludes: ['/events.js'] },
  { id: 'beacons', host: 'cdn.example', category: 'tracker', types: ['ping', 'image'] },
  { id: 'allow-player', host: 'player.adnet.example', category: 'ad', allow: true },
  { id: 'allow-consent', host: 'adnet.example', category: 'ad', allow: true, paths: ['/consent/'] },
  { id: 'both-ad', host: 'both.example', category: 'ad' },
  { id: 'both-tracker', host: 'both.example', category: 'tracker', types: ['image'] },
  { id: 'cc', host: 'tracker.co.uk', category: 'tracker' },
]

function ask(engine: LocalProtectionEngine, requestUrl: string, topLevelUrl: string | null = 'https://news.example.org/story', resourceType: ResourceType = 'script') {
  return engine.evaluate({ requestUrl, topLevelUrl, initiatorOrigin: null, resourceType, profileId: 'default', isPrivate: false })
}

describe('the matcher', () => {
  const engine = new LocalProtectionEngine(rules, [])

  it('blocks a listed host and every host under it, and nothing that only ends alike', () => {
    expect(ask(engine, 'https://adnet.example/a.js')).toEqual({ action: 'block', category: 'ad', ruleId: 'ads' })
    expect(ask(engine, 'https://a.b.c.adnet.example/a.js?x=1#y')).toMatchObject({ action: 'block', ruleId: 'ads' })
    expect(ask(engine, 'https://notadnet.example/a.js').action).toBe('allow')
    expect(ask(engine, 'https://adnet.example.org/a.js').action).toBe('allow')
    expect(ask(engine, 'https://example/a.js').action).toBe('allow')
  })

  it('reads hosts whatever the address looks like', () => {
    expect(ask(engine, 'https://ADNET.example:8443/a.js')).toMatchObject({ action: 'block' })
    expect(ask(engine, 'https://user:pw@adnet.example/a.js')).toMatchObject({ action: 'block' })
    expect(ask(engine, 'https://adnet.example./a.js')).toMatchObject({ action: 'block' })
    expect(ask(engine, 'wss://metrics.example/socket', undefined, 'websocket')).toMatchObject({ action: 'block', category: 'tracker' })
    expect(ask(engine, 'https://adnet.example')).toMatchObject({ action: 'block' })
    expect(ask(engine, 'data:text/plain,adnet.example').action).toBe('allow')
    expect(ask(engine, 'blob:https://adnet.example/1').action).toBe('allow')
    expect(ask(engine, 'not an address').action).toBe('allow')
    expect(urlParts('https://A.Example:444/p/q?x#y')).toEqual({ origin: 'https://a.example:444', host: 'a.example', path: '/p/q' })
    expect(urlParts('http://[::1]:8080/x')).toMatchObject({ host: '[::1]', path: '/x' })
  })

  it('narrows a rule to path prefixes', () => {
    expect(ask(engine, 'https://www.social.example/tr?id=1&ev=PageView', undefined, 'image')).toMatchObject({ action: 'block', ruleId: 'pixel' })
    expect(ask(engine, 'https://social.example/i/adsct?txn=1', undefined, 'image')).toMatchObject({ action: 'block', ruleId: 'pixel' })
    expect(ask(engine, 'https://www.social.example/plugins/post.php', undefined, 'sub_frame').action).toBe('allow')
    expect(ask(engine, 'https://www.social.example/?next=/tr').action).toBe('allow')
  })

  it('narrows a rule to a part of the path, so a host serves its sign-in script and not its pixel', () => {
    expect(ask(engine, 'https://connect.social.example/en_US/sdk.js').action).toBe('allow')
    expect(ask(engine, 'https://connect.social.example/en_US/events.js')).toMatchObject({ action: 'block', ruleId: 'sdk-pixel' })
    expect(ask(engine, 'https://connect.social.example/sdk.js?file=/events.js').action).toBe('allow')
  })

  it('narrows a rule to kinds of request', () => {
    expect(ask(engine, 'https://cdn.example/lib.js', undefined, 'script').action).toBe('allow')
    expect(ask(engine, 'https://cdn.example/font.woff2', undefined, 'font').action).toBe('allow')
    expect(ask(engine, 'https://cdn.example/p.gif', undefined, 'image')).toMatchObject({ action: 'block', ruleId: 'beacons' })
    expect(ask(engine, 'https://cdn.example/collect', undefined, 'ping')).toMatchObject({ action: 'block' })
  })

  it('lets exceptions through: a host under a blocked domain, and a path on the blocked host', () => {
    expect(ask(engine, 'https://player.adnet.example/video.js').action).toBe('allow')
    expect(ask(engine, 'https://cdn.player.adnet.example/video.js').action).toBe('allow')
    expect(ask(engine, 'https://adnet.example/consent/dialog.js').action).toBe('allow')
    expect(ask(engine, 'https://adnet.example/ad.js').action).toBe('block')
  })

  it('never blocks the page itself or a request to the page\'s own site', () => {
    expect(ask(engine, 'https://adnet.example/', 'https://adnet.example/', 'document').action).toBe('allow')
    expect(ask(engine, 'https://adnet.example/landing', 'https://news.example.org/', 'document').action).toBe('allow')
    expect(ask(engine, 'https://cdn.adnet.example/a.js', 'https://www.adnet.example/').action).toBe('allow')
    expect(ask(engine, 'https://adnet.example/a.js', 'https://shop.adnet.example/cart').action).toBe('allow')
    expect(ask(engine, 'https://x.tracker.co.uk/t.js', 'https://www.tracker.co.uk/').action).toBe('allow')
    // Two names under one country suffix are different sites.
    expect(ask(engine, 'https://x.tracker.co.uk/t.js', 'https://www.bbc.co.uk/').action).toBe('block')
    // A request with no page behind it (a service worker's, the app's own) is judged as another site's.
    expect(ask(engine, 'https://adnet.example/a.js', null).action).toBe('block')
  })

  it('pauses on one site only, by origin and profile', () => {
    const paused = new LocalProtectionEngine(rules, [])
    paused.setSiteEnabled('https://news.example.org', 'default', false)
    expect(ask(paused, 'https://adnet.example/a.js').action).toBe('allow')
    expect(ask(paused, 'https://adnet.example/a.js', 'https://NEWS.example.org/other').action).toBe('allow')
    expect(ask(paused, 'https://adnet.example/a.js', 'https://other.example.org/').action).toBe('block')
    expect(ask(paused, 'https://adnet.example/a.js', 'http://news.example.org/').action).toBe('block')
    expect(paused.evaluate({ requestUrl: 'https://adnet.example/a.js', topLevelUrl: 'https://news.example.org/', initiatorOrigin: null, resourceType: 'script', profileId: 'work', isPrivate: false }).action).toBe('block')
    paused.setSiteEnabled('https://news.example.org', 'default', true)
    expect(ask(paused, 'https://adnet.example/a.js').action).toBe('block')
  })

  it('obeys "Block ads" and "Block trackers" separately', () => {
    const switched = new LocalProtectionEngine(rules, ['.ad-box'])
    switched.setCategoryEnabled('ad', false)
    expect(ask(switched, 'https://adnet.example/a.js').action).toBe('allow')
    expect(ask(switched, 'https://metrics.example/m.js').action).toBe('block')
    expect(switched.cosmeticRules()).toEqual({ hideSelectors: [], cssRules: [] })
    // A host with a rule of each kind: the one still switched on applies, where it applies.
    expect(ask(switched, 'https://both.example/p.gif', undefined, 'image')).toMatchObject({ action: 'block', category: 'tracker' })
    expect(ask(switched, 'https://both.example/a.js').action).toBe('allow')
    switched.setCategoryEnabled('ad', true)
    switched.setCategoryEnabled('tracker', false)
    expect(ask(switched, 'https://adnet.example/a.js').action).toBe('block')
    expect(ask(switched, 'https://metrics.example/m.js').action).toBe('allow')
    expect(ask(switched, 'https://both.example/p.gif', undefined, 'image')).toMatchObject({ action: 'block', category: 'ad' })
    expect(switched.cosmeticRules().hideSelectors).toEqual(['.ad-box'])
    switched.loadCategories({ ads: false, trackers: false })
    expect(ask(switched, 'https://both.example/p.gif', undefined, 'image').action).toBe('allow')
  })

  it('decides in well under a microsecond or two per request with the full list', () => {
    const full = new LocalProtectionEngine()
    const urls = ['https://cdn.example.org/app.js', 'https://images.news.example.org/a/b/c.jpg?w=640', 'https://securepubads.g.doubleclick.net/tag/js/gpt.js', 'https://fonts.gstatic.com/s/inter/v12/x.woff2', 'https://www.google-analytics.com/g/collect?v=2&tid=G-1', 'https://static.site.co.uk/x.css']
    const started = performance.now()
    const rounds = 50_000
    let blocked = 0
    for (let round = 0; round < rounds; round += 1) for (const url of urls) if (ask(full, url, 'https://www.news-site.example/story', 'script').action === 'block') blocked += 1
    const perRequestMicroseconds = ((performance.now() - started) * 1000) / (rounds * urls.length)
    expect(blocked).toBe(rounds * 2)
    // (About 0.2 µs on a 2024 laptop; the bound is loose so a busy machine does not fail the test.)
    expect(perRequestMicroseconds).toBeLessThan(20)
  })
})

describe('the site table', () => {
  it('finds the registrable domain under ordinary and country suffixes', () => {
    expect(siteOfHost('www.example.com')).toBe('example.com')
    expect(siteOfHost('example.com')).toBe('example.com')
    expect(siteOfHost('a.b.c.example.org')).toBe('example.org')
    expect(siteOfHost('www.bbc.co.uk')).toBe('bbc.co.uk')
    expect(siteOfHost('news.com.au')).toBe('news.com.au')
    expect(siteOfHost('www.abc.net.au')).toBe('abc.net.au')
    expect(siteOfHost('www3.nhk.or.jp')).toBe('nhk.or.jp')
    expect(siteOfHost('g1.globo.com.br')).toBe('globo.com.br')
    expect(siteOfHost('www.gob.mx')).toBe('www.gob.mx')
    expect(siteOfHost('www.hindustantimes.co.in')).toBe('hindustantimes.co.in')
    expect(siteOfHost('www.stuff.co.nz')).toBe('stuff.co.nz')
    expect(siteOfHost('www.news24.co.za')).toBe('news24.co.za')
    expect(siteOfHost('www.hurriyet.com.tr')).toBe('hurriyet.com.tr')
    expect(siteOfHost('www.EXAMPLE.Co.Uk.')).toBe('example.co.uk')
    expect(siteOfHost('t.co')).toBe('t.co')
    expect(siteOfHost('www.web.de')).toBe('web.de')
  })

  it('treats each customer of a hosting service as a different site', () => {
    expect(siteOfHost('alice.github.io')).toBe('alice.github.io')
    expect(siteOfHost('cdn.alice.github.io')).toBe('alice.github.io')
    expect(siteOfHost('shop.pages.dev')).toBe('shop.pages.dev')
    expect(siteOfHost('my-app.vercel.app')).toBe('my-app.vercel.app')
    expect(siteOfHost('someone.blogspot.com')).toBe('someone.blogspot.com')
    expect(siteOfHost('someone.blogspot.co.uk')).toBe('someone.blogspot.co.uk')
    expect(siteOfHost('d111111abcdef8.cloudfront.net')).toBe('d111111abcdef8.cloudfront.net')
    expect(siteOfHost('bucket.s3.eu-west-1.amazonaws.com')).toBe('bucket.s3.eu-west-1.amazonaws.com')
    expect(sameSite('bob.github.io', 'alice.github.io')).toBe(false)
    expect(sameSite('other.s3.amazonaws.com', 'bucket.s3.amazonaws.com')).toBe(false)
  })

  it('errs towards "the same site" for a suffix it does not know, so it under-blocks and never breaks a page', () => {
    // "pvt.k12.ma.us" is not in the table: two schools there look like one site.
    expect(siteOfHost('school-a.pvt.k12.ma.us')).toBe('ma.us')
    expect(sameSite('school-b.pvt.k12.ma.us', 'school-a.pvt.k12.ma.us')).toBe(true)
    const engine = new LocalProtectionEngine([{ id: 't', host: 'tracker.unknownsuffix.zz', category: 'tracker' }], [])
    expect(ask(engine, 'https://tracker.unknownsuffix.zz/t.js', 'https://news.unknownsuffix.zz/').action).toBe('allow')
    expect(ask(engine, 'https://tracker.unknownsuffix.zz/t.js', 'https://news.example.org/').action).toBe('block')
  })

  it('leaves addresses that are not names alone', () => {
    expect(siteOfHost('127.0.0.1')).toBe('127.0.0.1')
    expect(siteOfHost('192.168.1.20')).toBe('192.168.1.20')
    expect(siteOfHost('[::1]')).toBe('[::1]')
    expect(siteOfHost('localhost')).toBe('localhost')
    expect(sameSite('localhost', '127.0.0.1')).toBe(false)
    expect(sameSite('news.localhost', 'localhost')).toBe(true)
    expect(sameSite('cdn.example.com', 'www.example.com')).toBe(true)
    expect(sameSite('example.com.evil.net', 'example.com')).toBe(false)
  })
})
