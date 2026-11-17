import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import authored from '../data/authored-services.json'
import neverBlock from '../data/never-block.json'
import { blocklistEntries, blocklistSummary, LocalProtectionEngine } from './index'

const under = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`)
const never = neverBlock.never.map(([host]) => host as string)
const handWrittenOnly = neverBlock.handWrittenOnly.map(([host]) => host as string)

describe("Intoponet's own list of ad and tracker hosts", () => {
  it('gives every entry its fields: host, ad or tracker, service, company, kind and how it got there', { timeout: 60_000 }, () => {
    expect(blocklistEntries.length).toBeGreaterThan(600)
    for (const entry of blocklistEntries) {
      const where = JSON.stringify(entry)
      expect(entry.host, where).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/)
      expect(['ad', 'tracker'], where).toContain(entry.category)
      expect(entry.service?.length, where).toBeGreaterThan(1)
      expect(entry.company?.length, where).toBeGreaterThan(1)
      expect(entry.kind?.length, where).toBeGreaterThan(1)
      expect(['authored', 'authored, measured', 'authored after hold-out', 'authored after hold-out, measured', 'measured', 'measured, listed on review'], where).toContain(entry.source)
      for (const path of [...(entry.paths ?? []), ...(entry.pathIncludes ?? [])]) expect(path.length, where).toBeGreaterThan(1)
      for (const path of entry.paths ?? []) expect(path.startsWith('/'), where).toBe(true)
      // What was measured says how often and what was seen.
      if (entry.source.startsWith('authored after hold-out')) expect((entry as { holdout?: { of: number } }).holdout?.of, where).toBeGreaterThan(0)
      if (entry.source !== 'authored' && entry.source !== 'authored after hold-out') {
        expect(entry.evidence?.publishers, where).toBeGreaterThan(0)
        expect(entry.evidence?.of, where).toBeGreaterThan(0)
        expect(Array.isArray(entry.evidence?.signals), where).toBe(true)
      }
    }
    expect(blocklistSummary.entries).toBe(blocklistEntries.length)
  })

  it('has no duplicates: one rule per host and narrowing', () => {
    const seen = new Set<string>()
    for (const entry of blocklistEntries) {
      const key = `${entry.host}|${(entry.paths ?? []).join(',')}|${(entry.pathIncludes ?? []).join(',')}`
      expect(seen.has(key), `duplicate ${key}`).toBe(false)
      seen.add(key)
    }
    // No whole-host rule sits under another whole-host rule (the broader one already covers it).
    const whole = blocklistEntries.filter((entry) => !entry.paths && !entry.pathIncludes).map((entry) => entry.host)
    const wholeSet = new Set(whole)
    for (const host of whole) {
      let parent = host
      for (let dot = parent.indexOf('.'); dot >= 0; dot = parent.indexOf('.')) {
        parent = parent.slice(dot + 1)
        expect(wholeSet.has(parent), `${host} is already covered by ${parent}`).toBe(false)
      }
    }
  })

  it('lists nothing that is on the never-block list', () => {
    const wrong: string[] = []
    for (const entry of blocklistEntries) {
      const narrowed = !!(entry.paths || entry.pathIncludes)
      // Not a never-block host and not a host under one.
      // (A listed domain above a never-block host is fine: the engine lets the never-block host through, see defaultRules.)
      for (const domain of never) if (under(entry.host, domain)) wrong.push(`${entry.host} is on the never-block list (${domain})`)
      for (const domain of handWrittenOnly) {
        // A domain that also serves what pages need is never blocked whole, and only by a hand-written rule.
        if (!narrowed && under(domain, entry.host)) wrong.push(`${entry.host} would block all of ${domain}`)
        if (under(entry.host, domain) && !entry.source.startsWith('authored')) wrong.push(`${entry.host}: only a hand-written rule may touch ${domain}`)
      }
    }
    for (const domain of never) if (handWrittenOnly.includes(domain)) wrong.push(`${domain} is on both lists`)
    expect(wrong).toEqual([])
  })

  it('never blocks what sites need, whatever the page', { timeout: 60_000 }, () => {
    const engine = new LocalProtectionEngine()
    const needed = [
      'https://accounts.google.com/gsi/client', 'https://www.google.com/recaptcha/api.js', 'https://www.gstatic.com/recaptcha/releases/x/recaptcha__en.js',
      'https://fonts.googleapis.com/css2?family=Inter', 'https://fonts.gstatic.com/s/inter/v1/a.woff2', 'https://maps.googleapis.com/maps/api/js',
      'https://imasdk.googleapis.com/js/sdkloader/ima3.js', 'https://www.youtube.com/embed/abc', 'https://www.youtube.com/iframe_api', 'https://i.ytimg.com/vi/abc/hq.jpg',
      'https://js.stripe.com/v3/', 'https://m.stripe.network/inner.html', 'https://www.paypal.com/sdk/js', 'https://challenges.cloudflare.com/turnstile/v0/api.js',
      'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js', 'https://cdn.jsdelivr.net/npm/vue@3', 'https://js.hcaptcha.com/1/api.js',
      'https://connect.facebook.net/en_US/sdk.js', 'https://www.facebook.com/plugins/post.php?href=x', 'https://platform.twitter.com/widgets.js', 'https://t.co/abc123',
      'https://cdn.cookielaw.org/scripttemplates/otSDKStub.js', 'https://consent.cookiebot.com/uc.js', 'https://sdk.privacy-center.org/loader.js', 'https://cdn.privacy-mgmt.com/wrapperMessagingWithoutDetection.js',
      'https://player.vimeo.com/video/1', 'https://cdn.jwplayer.com/libraries/x.js', 'https://players.brightcove.net/1/default_default/index.min.js', 'https://c.disquscdn.com/next/embed/x.js', 'https://disqus.com/embed/comments/',
      'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js', 'https://login.microsoftonline.com/common/oauth2/authorize', 'https://github.githubassets.com/assets/app.js',
      'https://static.licdn.com/sc/h/x', 'https://s.yimg.com/cv/apiv2/x.png', 'https://s.pinimg.com/webapp/app.js', 'https://www.redditstatic.com/desktop2x/x.js', 'https://i0.wp.com/site/x.jpg', 'https://cmp.inmobi.com/choice/x/choice.js',
    ]
    for (const url of needed) {
      for (const resourceType of ['script', 'sub_frame', 'image', 'xhr'] as const) {
        expect(engine.evaluate({ requestUrl: url, topLevelUrl: 'https://news.example.org/', initiatorOrigin: null, resourceType, profileId: 'default', isPrivate: false }).action, `${resourceType} ${url}`).toBe('allow')
      }
    }
  })

  it('blocks the twenty well-known endpoints the e2e check asks for, with their kinds', () => {
    const engine = new LocalProtectionEngine()
    const endpoints: [string, 'ad' | 'tracker'][] = [
      ['https://securepubads.g.doubleclick.net/tag/js/gpt.js', 'ad'], ['https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'ad'], ['https://c.amazon-adsystem.com/aax2/apstag.js', 'ad'],
      ['https://sb.scorecardresearch.com/beacon.js', 'tracker'], ['https://ib.adnxs.com/ut/v3/prebid', 'ad'], ['https://www.google-analytics.com/analytics.js', 'tracker'],
      ['https://static.hotjar.com/c/hotjar-1.js?sv=6', 'tracker'], ['https://bat.bing.com/bat.js', 'tracker'], ['https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=TEST', 'tracker'],
      ['https://snap.licdn.com/li.lms-analytics/insight.min.js', 'tracker'], ['https://px.ads.linkedin.com/collect/?pid=1&fmt=gif', 'tracker'], ['https://www.facebook.com/tr?id=1&ev=PageView&noscript=1', 'tracker'],
      ['https://static.criteo.net/js/ld/ld.js', 'ad'], ['https://ads.yahoo.com/get-user-id?ver=2', 'ad'], ['https://cdn.krxd.net/controltag/test.js', 'tracker'], ['https://cdn.adsafeprotected.com/iasPET.1.js', 'ad'],
      ['https://mc.yandex.ru/metrika/tag.js', 'tracker'], ['https://js-agent.newrelic.com/nr-loader-spa-current.min.js', 'tracker'], ['https://t.co/i/adsct?txn_id=test&p_id=Twitter', 'tracker'], ['https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js', 'tracker'],
    ]
    expect(endpoints.length).toBe(20)
    for (const [url, category] of endpoints) {
      expect(engine.evaluate({ requestUrl: url, topLevelUrl: 'http://127.0.0.1:5000/trackers', initiatorOrigin: null, resourceType: 'script', profileId: 'default', isPrivate: false }), url).toMatchObject({ action: 'block', category })
    }
    expect(engine.evaluate({ requestUrl: 'https://connect.facebook.net/en_US/fbevents.js', topLevelUrl: 'https://news.example.org/', initiatorOrigin: null, resourceType: 'script', profileId: 'default', isPrivate: false })).toMatchObject({ action: 'block', category: 'tracker' })
  })

  it('is written by hand: every authored service names its company, kind and hosts', () => {
    for (const service of authored.services) {
      expect(service.length, JSON.stringify(service)).toBe(5)
      expect(['ad', 'tracker'], JSON.stringify(service)).toContain(service[3])
      expect(service[4]?.trim().length, JSON.stringify(service)).toBeGreaterThan(3)
    }
  })
})

// Nothing copyleft or share-alike may come back into the blocker, as code or as data. This fails if
// a reference to the removed library, its dependencies or the removed lists reappears in what ships.
describe('the removed third-party blocker stays out', () => {
  const repo = resolve(__dirname, '../../..')
  // Spelled in pieces so this file does not match itself.
  const banned = new RegExp(['@ghos' + 'tery', '@remu' + 'sao', 'tld' + 'ts', 'easy' + 'list', 'easy' + 'privacy', 'adblocker-' + 'content', 'engine\\.bin', 'public' + 'suffix', '\\bu' + 'block', '\\bad' + 'guard', 'peter ?lo' + 'we', 'tracker.?ra' + 'dar', 'steven' + 'black'].join('|'), 'i')

  function files(dir: string, found: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      // Source only: build output (out/, out-*) may be left from before the removal until the next build.
      if (name === 'node_modules' || name === '.git' || name === 'dist' || name === '.vite' || name.startsWith('.release-package') || name === '.eval-build' || name === 'out' || name.startsWith('out-')) continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) files(path, found)
      else if (/\.(ts|tsx|mts|cts|js|mjs|cjs|json|html|css|txt|bin|md)$/.test(name) && statSync(path).size < 12_000_000) found.push(path)
    }
    return found
  }

  it('in the source of the app, the packages and the build scripts, and in the dependency lock', { timeout: 60_000 }, () => {
    const roots = ['apps/desktop', 'packages', 'scripts', 'package.json', 'package-lock.json'].map((path) => join(repo, path)).filter(existsSync)
    const offenders: string[] = []
    for (const root of roots) {
      for (const file of statSync(root).isDirectory() ? files(root) : [root]) {
        const name = relative(repo, file)
        // (The news feed directory names thousands of publishers; one may be called anything.)
        if (/newsFeeds\.json$|internationalFeeds\.json$|news-feeds\.json$/.test(name)) continue
        if (banned.test(name)) offenders.push(`${name} (its name)`)
        const match = readFileSync(file, 'utf8').match(banned)
        if (match) offenders.push(`${name}: "${match[0]}"`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('and no data file sits beside the engine other than its own four', () => {
    expect(readdirSync(resolve(__dirname, '../data')).sort()).toEqual(['authored-services.json', 'blocklist.json', 'element-rules.json', 'never-block.json', 'reviewed.json'].filter((name) => existsSync(resolve(__dirname, '../data', name))).sort())
    expect(existsSync(resolve(__dirname, '../lists'))).toBe(false)
  })
})
