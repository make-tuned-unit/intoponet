import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { LocalProtectionEngine, compileProtectionLists, siteOfHost, type RequestContext, type ResourceType } from './index'

const listsDir = fileURLToPath(new URL('../lists/', import.meta.url))
const read = (file: string) => readFileSync(`${listsDir}${file}`)

/** A request as a news page would make it to another site. */
function request(requestUrl: string, resourceType: ResourceType, topLevelUrl = 'https://news.example.com/world/story'): RequestContext {
  return { requestUrl, topLevelUrl, initiatorOrigin: new URL(topLevelUrl).origin, resourceType, profileId: 'default', isPrivate: false }
}

/**
 * Well-known ad and tracker addresses. The first 13 are the ones an audit found the old built-in
 * rules let through on a news page; the last 7 were already blocked then. Each is an ad or a
 * tracker by the list that blocks it (EasyList: ad; EasyPrivacy: tracker).
 */
const endpoints: [url: string, type: ResourceType, category: 'ad' | 'tracker'][] = [
  ['https://bat.bing.com/bat.js', 'script', 'tracker'],
  ['https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=ABC', 'script', 'tracker'],
  ['https://snap.licdn.com/li.lms-analytics/insight.min.js', 'script', 'tracker'],
  ['https://px.ads.linkedin.com/collect/?pid=1&fmt=gif', 'image', 'ad'],
  ['https://www.facebook.com/tr?id=1&ev=PageView&noscript=1', 'image', 'tracker'],
  ['https://static.criteo.net/js/ld/ld.js', 'script', 'tracker'],
  ['https://ads.yahoo.com/get-user-id?ver=2', 'script', 'ad'],
  ['https://cdn.krxd.net/controltag/abc123.js', 'script', 'tracker'],
  ['https://cdn.adsafeprotected.com/iasPET.1.js', 'script', 'ad'],
  ['https://mc.yandex.ru/metrika/tag.js', 'script', 'tracker'],
  ['https://js-agent.newrelic.com/nr-loader-spa-current.min.js', 'script', 'tracker'],
  ['https://t.co/i/adsct?txn_id=abc&p_id=Twitter', 'image', 'tracker'],
  ['https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js', 'script', 'tracker'],
  ['https://securepubads.g.doubleclick.net/tag/js/gpt.js', 'script', 'ad'],
  ['https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'script', 'ad'],
  ['https://c.amazon-adsystem.com/aax2/apstag.js', 'script', 'ad'],
  ['https://sb.scorecardresearch.com/beacon.js', 'script', 'tracker'],
  ['https://ib.adnxs.com/ut/v3/prebid', 'xhr', 'ad'],
  ['https://www.google-analytics.com/analytics.js', 'script', 'tracker'],
  ['https://static.hotjar.com/c/hotjar-123.js?sv=6', 'script', 'tracker'],
]

describe('the shipped filter lists', () => {
  const manifest = JSON.parse(read('manifest.json').toString('utf8')) as {
    licence: string
    lists: { file: string; title: string; sourceUrl: string; fetchedAt: string; bytes: number; sha256: string }[]
  }

  it('are exactly the files the update script fetched (never edited), with their headers', () => {
    expect(manifest.lists.map((list) => list.file)).toEqual(['easylist.txt', 'easyprivacy.txt'])
    for (const list of manifest.lists) {
      const bytes = read(list.file)
      expect(bytes.length, list.file).toBe(list.bytes)
      expect(createHash('sha256').update(bytes).digest('hex'), list.file).toBe(list.sha256)
      const head = bytes.subarray(0, 2000).toString('utf8')
      expect(head.startsWith('[Adblock Plus')).toBe(true)
      expect(head).toContain(`! Title: ${list.title}`)
      expect(head).toContain('! Licence: https://easylist.to/pages/licence.html')
      expect(list.sourceUrl).toMatch(/^https:\/\/easylist\.to\/easylist\//)
      expect(Number.isNaN(Date.parse(list.fetchedAt))).toBe(false)
    }
    expect(manifest.licence).toContain('CC BY-SA 3.0')
    // The attribution that ships beside the lists names the authors and the licence.
    const notice = read('NOTICE.txt').toString('utf8')
    expect(notice).toContain('The EasyList authors (https://easylist.to/)')
    expect(notice).toContain('https://creativecommons.org/licenses/by-sa/3.0/')
  })
})

describe('LocalProtectionEngine with EasyList and EasyPrivacy', () => {
  let compiled: Uint8Array
  const engine = () => {
    const made = new LocalProtectionEngine()
    expect(made.loadLists(compiled)).toBe(true)
    return made
  }

  beforeAll(() => {
    compiled = compileProtectionLists({ ads: read('easylist.txt').toString('utf8'), trackers: read('easyprivacy.txt').toString('utf8') })
  }, 60_000)

  it('blocks all twenty well-known ad and tracker addresses on another site\'s page', () => {
    const loaded = engine()
    const allowed = endpoints.filter(([url, type]) => loaded.evaluate(request(url, type)).action !== 'block').map(([url]) => url)
    expect(allowed).toEqual([])
  })

  it('lets thirteen of them through with only the old built-in rules (what the lists add)', () => {
    const old = new LocalProtectionEngine()
    expect(old.hasLists()).toBe(false)
    const allowed = endpoints.filter(([url, type]) => old.evaluate(request(url, type)).action !== 'block')
    expect(allowed.map(([url]) => new URL(url).hostname)).toEqual(endpoints.slice(0, 13).map(([url]) => new URL(url).hostname))
  })

  it('says which are ads and which are trackers by the list that blocked them', () => {
    const loaded = engine()
    const wrong = endpoints
      .map(([url, type, category]) => ({ url, category, decision: loaded.evaluate(request(url, type)) }))
      .filter(({ category, decision }) => decision.category !== category)
      .map(({ url, category, decision }) => `${url}: ${decision.category}, expected ${category}`)
    expect(wrong).toEqual([])
    expect(loaded.evaluate(request('https://securepubads.g.doubleclick.net/tag/js/gpt.js', 'script')).ruleId).toMatch(/^easylist-[0-9a-f]+$/)
    expect(loaded.evaluate(request('https://bat.bing.com/bat.js', 'script')).ruleId).toMatch(/^easyprivacy-[0-9a-f]+$/)
  })

  it('never blocks a site\'s own requests: each address is allowed on its own site', () => {
    const loaded = engine()
    const blocked = endpoints
      .filter(([url, type]) => {
        const own = new URL(url)
        // The site's front page, on its registrable domain and on a sibling host of the address.
        const pages = [`https://${siteOfHost(own.hostname)}/`, `https://www.${siteOfHost(own.hostname)}/account`, `${own.origin}/`]
        return pages.some((page) => loaded.evaluate(request(url, type, page)).action === 'block')
      })
      .map(([url]) => url)
    expect(blocked).toEqual([])
    // A page itself always loads, whatever the lists say about its address.
    expect(loaded.evaluate(request('https://securepubads.g.doubleclick.net/', 'document')).action).toBe('allow')
  })

  it('leaves ordinary third-party requests alone', () => {
    const loaded = engine()
    for (const [url, type] of [
      ['https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js', 'script'],
      ['https://fonts.gstatic.com/s/inter/v13/inter.woff2', 'font'],
      ['https://js.stripe.com/v3/', 'script'],
      ['https://challenges.cloudflare.com/turnstile/v0/api.js', 'script'],
      ['https://www.google.com/recaptcha/api.js', 'script'],
      ['https://accounts.google.com/gsi/client', 'script'],
      ['https://www.youtube.com/embed/abc', 'sub_frame'],
      ['https://i.ytimg.com/vi/abc/hqdefault.jpg', 'image'],
      ['https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg', 'image'],
    ] as const) {
      expect(loaded.evaluate(request(url, type)).action, url).toBe('allow')
    }
  })

  it('honours "Pause on this site"', () => {
    const loaded = engine()
    const tracker = request('https://bat.bing.com/bat.js', 'script')
    loaded.setSiteEnabled('https://news.example.com', 'default', false)
    expect(endpoints.filter(([url, type]) => loaded.evaluate(request(url, type)).action === 'block')).toEqual([])
    // Another site is still protected.
    expect(loaded.evaluate({ ...tracker, topLevelUrl: 'https://other.example.org/' }).action).toBe('block')
    loaded.setSiteEnabled('https://news.example.com', 'default', true)
    expect(loaded.evaluate(tracker).action).toBe('block')
  })

  it('honours the "Block ads" and "Block trackers" switches separately', () => {
    const loaded = engine()
    const ad = request('https://securepubads.g.doubleclick.net/tag/js/gpt.js', 'script')
    const tracker = request('https://bat.bing.com/bat.js', 'script')
    loaded.setCategoryEnabled('ad', false)
    expect(loaded.evaluate(ad).action).toBe('allow')
    expect(loaded.evaluate(tracker)).toMatchObject({ action: 'block', category: 'tracker' })
    loaded.setCategoryEnabled('ad', true)
    loaded.setCategoryEnabled('tracker', false)
    expect(loaded.evaluate(ad)).toMatchObject({ action: 'block', category: 'ad' })
    expect(loaded.evaluate(tracker).action).toBe('allow')
    loaded.setCategoryEnabled('ad', false)
    expect(endpoints.filter(([url, type]) => loaded.evaluate(request(url, type)).action === 'block')).toEqual([])
  })

  it('blocks a request no page made (a worker\'s, the browser\'s own) as another site\'s', () => {
    const loaded = engine()
    expect(loaded.evaluate({ ...request('https://pagead2.googlesyndication.com/pagead/parity.gif', 'other'), topLevelUrl: null, initiatorOrigin: null }).action).toBe('block')
    expect(loaded.evaluate({ ...request('https://bat.bing.com/bat.js', 'script'), topLevelUrl: null, initiatorOrigin: null }).action).toBe('block')
  })

  it('adds the lists\' element-hiding rules for a page, and none with "Block ads" off', () => {
    const loaded = engine()
    const page = loaded.cosmeticRules('https://www.example.com/', 'https://www.example.com/')
    // The built-in selectors are unchanged (Export as PDF and the empty-slot cleanup use them).
    expect(page.hideSelectors).toEqual(new LocalProtectionEngine().cosmeticRules('', '').hideSelectors)
    expect(page.cssRules.length).toBe(2)
    expect(page.cssRules[1]).toMatch(/display:\s*none\s*!important/)
    // General rules come only for what the page contains.
    const css = loaded.cosmeticRulesForElements('https://www.example.com/', { classes: ['ad-slot', 'article-body'], ids: ['main'], hrefs: [] })
    expect(css).toMatch(/\.ad-slot\b[^{]*\{\s*display:\s*none\s*!important/)
    expect(css).not.toMatch(/article-body/)
    expect(loaded.cosmeticRulesForElements('https://www.example.com/', { classes: ['article-body'], ids: [] })).toBe('')
    expect(loaded.cosmeticRulesForElements('about:blank', { classes: ['ad-slot'] })).toBe('')
    loaded.setCategoryEnabled('ad', false)
    expect(loaded.cosmeticRules('https://www.example.com/', '')).toEqual({ hideSelectors: [], cssRules: [] })
    expect(loaded.cosmeticRulesForElements('https://www.example.com/', { classes: ['ad-slot'] })).toBe('')
  })
})

describe('exception rules (@@) and rule options, on small lists', () => {
  const ads = [
    '||ads.example^',
    '@@||ads.example/player.js$domain=video.example',
    '||widgets.example^$third-party',
    '||strict.example^$important',
    '@@||strict.example^',
    '/banner/ad-*.gif$image',
  ].join('\n')
  const trackers = ['||track.example^', '@@||ads.example/consent.js', '||both.example^', '@@||track.example/needed.js$domain=shop.example'].join('\n')
  const compiled = compileProtectionLists({ ads: `${ads}\n||both.example^`, trackers })
  const engine = () => {
    const made = new LocalProtectionEngine()
    made.loadLists(compiled)
    return made
  }

  it('lets through what a list excepts, on the sites it names only', () => {
    const loaded = engine()
    expect(loaded.evaluate(request('https://ads.example/player.js', 'script', 'https://video.example/watch')).action).toBe('allow')
    expect(loaded.evaluate(request('https://ads.example/player.js', 'script', 'https://news.example/')).action).toBe('block')
    expect(loaded.evaluate(request('https://ads.example/other.js', 'script', 'https://video.example/watch')).action).toBe('block')
    expect(loaded.evaluate(request('https://track.example/needed.js', 'script', 'https://shop.example/')).action).toBe('allow')
    expect(loaded.evaluate(request('https://track.example/needed.js', 'script', 'https://news.example/')).action).toBe('block')
  })

  it('applies an exception in one list to a rule in the other', () => {
    const loaded = engine()
    expect(loaded.evaluate(request('https://ads.example/consent.js', 'script')).action).toBe('allow')
    // Also with one kind switched off (the other list's exception still counts).
    loaded.setCategoryEnabled('tracker', false)
    expect(loaded.evaluate(request('https://ads.example/consent.js', 'script')).action).toBe('allow')
    expect(loaded.evaluate(request('https://ads.example/banner.js', 'script')).action).toBe('block')
  })

  it('keeps an $important rule over an exception, and resource-type options', () => {
    const loaded = engine()
    expect(loaded.evaluate(request('https://strict.example/a.js', 'script')).action).toBe('block')
    loaded.setCategoryEnabled('tracker', false)
    expect(loaded.evaluate(request('https://strict.example/a.js', 'script')).action).toBe('block')
    expect(loaded.evaluate(request('https://cdn.example.org/banner/ad-1.gif', 'image')).action).toBe('block')
    expect(loaded.evaluate(request('https://cdn.example.org/banner/ad-1.gif', 'script')).action).toBe('allow')
  })

  it('judges a $third-party rule against the frame that asked', () => {
    const loaded = engine()
    // A widget's own frame loading from its own site, inside another site's page.
    expect(loaded.evaluate({ ...request('https://cdn.widgets.example/app.js', 'script'), initiatorOrigin: 'https://embed.widgets.example' }).action).toBe('allow')
    expect(loaded.evaluate(request('https://cdn.widgets.example/app.js', 'script')).action).toBe('block')
    // A frame with no usable origin (sandboxed) is judged against the page.
    expect(loaded.evaluate({ ...request('https://cdn.widgets.example/app.js', 'script'), initiatorOrigin: 'null' }).action).toBe('block')
  })

  it('counts a rule that is in both lists as an ad rule', () => {
    const loaded = engine()
    expect(loaded.evaluate(request('https://both.example/x.js', 'script'))).toMatchObject({ action: 'block', category: 'ad' })
    expect(loaded.evaluate(request('https://track.example/x.js', 'script'))).toMatchObject({ action: 'block', category: 'tracker' })
  })

  it('keeps the built-in rules when the compiled lists cannot be read', () => {
    const made = new LocalProtectionEngine()
    expect(made.loadLists(new Uint8Array([1, 2, 3]))).toBe(false)
    expect(made.loadLists(compiled.slice(0, compiled.length >> 1))).toBe(false)
    const damaged = compiled.slice()
    damaged[damaged.length - 20]! ^= 0xff
    expect(made.loadLists(damaged)).toBe(false)
    expect(made.hasLists()).toBe(false)
    expect(made.evaluate(request('https://securepubads.g.doubleclick.net/tag/js/gpt.js', 'script'))).toMatchObject({ action: 'block', ruleId: 'fix-doubleclick' })
    // With the lists, the lists decide for those hosts; the two test hosts always apply.
    const loaded = engine()
    expect(loaded.evaluate(request('https://securepubads.g.doubleclick.net/tag/js/gpt.js', 'script')).action).toBe('allow')
    expect(loaded.evaluate(request('https://ads.intoponet.test/banner.js', 'script'))).toMatchObject({ action: 'block', ruleId: 'fix-ads-intoponet-test' })
  })
})

describe('siteOfHost', () => {
  it('gives the registrable domain, and the host itself when there is none', () => {
    expect(siteOfHost('edition.cnn.com')).toBe('cnn.com')
    expect(siteOfHost('www.bbc.co.uk')).toBe('bbc.co.uk')
    expect(siteOfHost('127.0.0.1')).toBe('127.0.0.1')
    expect(siteOfHost('localhost')).toBe('localhost')
  })
})
