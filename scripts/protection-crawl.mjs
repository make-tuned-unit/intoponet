// Intoponet's own measurement of who news pages talk to. It is where the measured part of the ad
// and tracker list (packages/protection-engine/data/blocklist.json) comes from.
//
// REFRESH BEFORE A RELEASE (about 90 minutes, mostly waiting):
//   npx electron scripts/protection-crawl.mjs --set build --limit 520 --out scratchpad/own-protection/crawl
//   node scripts/protection-classify.mjs --crawl scratchpad/own-protection/crawl
//   review the classifier's "new" entries (docs/protection-measurement.md says how), run the tests, commit.
// The hold-out check after that:
//   npx electron scripts/protection-crawl.mjs --set holdout --out scratchpad/own-protection/holdout-off
//   npx electron scripts/protection-crawl.mjs --set holdout --protect --out scratchpad/own-protection/holdout-on
//   node scripts/protection-holdout.mjs
//
// What it does: with Electron (the repo's own), in a temporary profile that is deleted afterwards,
// it opens the home page and one article of each outlet (the newest item of the outlet's feed), a few
// pages at a time, scrolls each for about 15 seconds, and closes it. Blocking is off unless --protect.
// For every host of another site it records what a page asked it for: how many requests of which
// kinds, cookies set (name, lifetime, a hash of the value, never the value) and cookies sent back,
// whether the page's address or a long identifier went along, response sizes, and what it put on the
// page (pictures, frames, fonts, video). It also records the page's ad-like containers.
//
// What it does not do: it uses no blocklist and no tracker database of any kind, and fetches none.
// It never signs in, never submits a form, never clicks (so consent dialogs stay unanswered: pages
// in Europe that wait for consent show fewer ads and trackers than a person who agrees would get).
// One visit per page, the user agent the app itself sends.
//
// Options: --set build|holdout  --limit N  --out DIR  --concurrency N (default 5)  --protect (block
// with the engine as the app does)  --only id,id  --urls FILE (one address per line, instead of outlets)
// --shots (save a picture of each page)  --fresh-cookies (clear cookies before each outlet)

import { app, BrowserWindow, session } from 'electron'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildOutlets, holdoutOutlets } from './protection-outlets.mjs'

const repo = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const outDir = resolve(repo, option('out', 'scratchpad/own-protection/crawl'))
const concurrency = Number(option('concurrency', '5'))
const protect = flag('protect')
const DWELL_MS = Number(option('dwell', '14000'))
const LOAD_TIMEOUT_MS = 20_000

const profile = mkdtempSync(join(tmpdir(), 'intoponet-crawl-'))
app.setPath('userData', profile)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('autoplay-policy', 'user-gesture-required')
app.userAgentFallback = app.userAgentFallback.replace(/ (?:Electron|Intoponet|intoponet)\/\S+/gi, '').replace(/\s{2,}/g, ' ').trim()

mkdirSync(outDir, { recursive: true })
const pagesFile = join(outDir, 'pages.jsonl')

// The engine's own code (site table, and the matcher for --protect), bundled so this script can import it.
const engineFile = join(profile, 'engine.mjs')
execFileSync(join(repo, 'node_modules/.bin/esbuild'), [join(repo, 'packages/protection-engine/src/index.ts'), '--bundle', '--format=esm', '--platform=node', `--outfile=${engineFile}`, '--log-level=warning'])
const { siteOfHost, LocalProtectionEngine, mapElectronResourceType } = await import(pathToFileURL(engineFile).href)
const engine = protect ? new LocalProtectionEngine() : null

const shortHash = (value) => createHash('sha1').update(value).digest('hex').slice(0, 12)
const hostOf = (url) => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'ws:' || parsed.protocol === 'wss:' ? parsed.hostname : ''
  } catch {
    return ''
  }
}
const delay = (ms) => new Promise((done) => setTimeout(done, ms))

// ---- What is recorded per page -----------------------------------------------------------------

/** webContents id → the page being measured. */
const pages = new Map()
const requests = new Map() // request id → { page, host }

function hostRecord(page, host) {
  let record = page.hosts[host]
  if (!record) {
    record = page.hosts[host] = {
      n: 0, types: {}, status: {}, bytes: 0, tiny: 0, noContent: 0, post: 0,
      pageInQuery: 0, pageInBody: 0, idInQuery: 0, setCookies: [], sentCookies: [], frames: {}, samples: [], blocked: 0,
    }
  }
  return record
}

const ID_VALUE = /^(?=.*\d)(?=.*[a-zA-Z])[A-Za-z0-9_.-]{16,}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^\d{15,}$/

function wireSession(ses) {
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  ses.on('will-download', (event) => event.preventDefault())

  ses.webRequest.onBeforeRequest((details, callback) => {
    const page = details.webContentsId === undefined ? undefined : pages.get(details.webContentsId)
    if (!page || details.resourceType === 'mainFrame') return callback({})
    const host = hostOf(details.url)
    if (!host || siteOfHost(host) === page.site) {
      if (host) page.ownRequests += 1
      return callback({})
    }
    const record = hostRecord(page, host)
    if (engine) {
      const decision = engine.evaluate({ requestUrl: details.url, topLevelUrl: page.url, initiatorOrigin: null, resourceType: mapElectronResourceType(details.resourceType), profileId: 'default', isPrivate: false })
      if (decision.action === 'block') {
        record.blocked += 1
        record.blockedAs = decision.category
        return callback({ cancel: true })
      }
    }
    record.n += 1
    record.types[details.resourceType] = (record.types[details.resourceType] ?? 0) + 1
    requests.set(details.id, { page, host, type: details.resourceType })
    try {
      const url = new URL(details.url)
      const query = decodeURIComponent(url.search.replace(/\+/g, ' ')).toLowerCase()
      if (query.includes(page.host) || query.includes(page.site)) record.pageInQuery += 1
      let id = false
      for (const value of url.searchParams.values()) if (ID_VALUE.test(value)) id = true
      if (id) record.idInQuery += 1
      if (record.samples.length < 6) {
        const sample = `${details.resourceType} ${url.pathname.slice(0, 90)}${url.search ? `?${[...new Set(url.searchParams.keys())].slice(0, 10).join('&')}` : ''}`
        if (!record.samples.includes(sample)) record.samples.push(sample)
      }
    } catch { /* an address that cannot be read is still counted */ }
    if (details.method === 'POST') {
      record.post += 1
      const body = (details.uploadData ?? []).map((part) => (part.bytes ? part.bytes.toString('latin1').slice(0, 20_000) : '')).join('')
      if (body && (body.includes(page.host) || body.includes(encodeURIComponent(page.host)))) record.pageInBody += 1
    }
    const frameHost = details.frame && !details.frame.detached ? hostOf(details.frame.url) : ''
    if (frameHost && siteOfHost(frameHost) !== page.site) record.frames[frameHost] = (record.frames[frameHost] ?? 0) + 1
    callback({})
  })

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const entry = requests.get(details.id)
    if (entry) {
      const record = hostRecord(entry.page, entry.host)
      const cookie = details.requestHeaders.Cookie ?? details.requestHeaders.cookie
      if (cookie) {
        for (const pair of String(cookie).split(/;\s*/)) {
          const eq = pair.indexOf('=')
          const value = eq < 0 ? '' : pair.slice(eq + 1)
          if (value.length < 8 || record.sentCookies.length >= 12) continue
          const item = `${pair.slice(0, eq)}:${shortHash(value)}`
          if (!record.sentCookies.includes(item)) record.sentCookies.push(item)
        }
      }
      const referer = details.requestHeaders.Referer ?? details.requestHeaders.referer
      if (referer && String(referer).length > entry.page.origin.length + 1 && String(referer).startsWith(entry.page.origin)) record.fullReferer = (record.fullReferer ?? 0) + 1
    }
    callback({ requestHeaders: details.requestHeaders })
  })

  ses.webRequest.onHeadersReceived((details, callback) => {
    const entry = requests.get(details.id)
    if (entry) {
      const record = hostRecord(entry.page, entry.host)
      const headers = details.responseHeaders ?? {}
      const header = (name) => {
        for (const key of Object.keys(headers)) if (key.toLowerCase() === name) return headers[key]
        return undefined
      }
      record.status[details.statusCode] = (record.status[details.statusCode] ?? 0) + 1
      if (details.statusCode === 204) record.noContent += 1
      const length = Number(header('content-length')?.[0])
      if (Number.isFinite(length)) {
        record.bytes += length
        if (length <= 120 && (entry.type === 'image' || /^image\//.test(header('content-type')?.[0] ?? ''))) record.tiny += 1
      }
      for (const line of header('set-cookie') ?? []) {
        if (record.setCookies.length >= 12) break
        const [pair, ...attributes] = String(line).split(/;\s*/)
        const eq = pair.indexOf('=')
        if (eq < 1) continue
        let days = 0
        for (const attribute of attributes) {
          const [key, value] = attribute.split('=')
          if (/^max-age$/i.test(key)) days = Number(value) / 86_400
          else if (/^expires$/i.test(key) && !days) days = (Date.parse(value) - Date.now()) / 86_400_000
        }
        const value = pair.slice(eq + 1)
        record.setCookies.push({ name: pair.slice(0, eq).slice(0, 40), days: Math.round(days * 10) / 10, length: value.length, hash: value.length >= 8 ? shortHash(value) : '' })
      }
    }
    callback({})
  })

  const finished = (details) => requests.delete(details.id)
  ses.webRequest.onCompleted(finished)
  ses.webRequest.onErrorOccurred(finished)
}

// ---- What a page shows: frames, pictures, ad-like containers --------------------------------------

const DOM_SNAPSHOT = `(() => {
  const adName = /(^|[^a-z])(ad|ads|adv|advert|adverts|advertisement|advertising|adslot|adunit|adbox|adzone|adwrap|adcontainer|banner|sponsor|sponsored|dfp|gpt|promo|promoted|publicidad|publicidade|pub|reklama|reklam|werbung|anzeige|taboola|outbrain|mgid|adsense)([^a-z]|$)/i;
  const label = /^(advertisement|advertisements|advertising|advert|ad|ads|sponsored|sponsored content|promoted|anzeige|werbung|publicité|publicidade|publicidad|pubblicità|reklama|reklame|annonce|annons|annonse|advertentie|mainos|reklam|реклама|广告|廣告|広告|광고|إعلان)$/i;
  const hostOf = (value) => { try { return new URL(value, location.href).hostname; } catch { return ''; } };
  const nameOf = (element) => ({ tag: element.tagName.toLowerCase(), id: typeof element.id === 'string' ? element.id.slice(0, 60) : '', classes: [...(element.classList || [])].slice(0, 8).map((name) => name.slice(0, 50)) });
  const box = (element) => { const rect = element.getBoundingClientRect(); return [Math.round(rect.width), Math.round(rect.height)]; };
  const media = 'img,picture,video,canvas,svg,iframe,embed,object,input,textarea,select,button,a[href]';
  // What is in a container besides ads: words (other than an ad label), links into the site, pictures from anywhere.
  const contents = (element) => {
    const text = (element.innerText || '').replace(/\\s+/g, ' ').trim();
    const links = [...element.querySelectorAll('a[href]')];
    return {
      text: label.test(text) ? 0 : text.length,
      ownLinks: links.filter((link) => link.hostname === location.hostname).length,
      otherLinks: links.filter((link) => link.hostname && link.hostname !== location.hostname).length,
      images: element.querySelectorAll('img,picture,video').length,
      frames: [...element.querySelectorAll('iframe')].map((frame) => hostOf(frame.src) || '(no address)').slice(0, 5),
      scripts: [...element.querySelectorAll('script[src]')].map((script) => hostOf(script.src)).slice(0, 5),
      children: element.childElementCount,
    };
  };
  const frames = [];
  for (const frame of [...document.querySelectorAll('iframe')].slice(0, 80)) {
    const around = [];
    let node = frame.parentElement;
    for (let level = 0; level < 4 && node && !/^(BODY|HTML|MAIN|ARTICLE)$/.test(node.tagName); level += 1) {
      const text = (node.innerText || '').replace(/\\s+/g, ' ').trim();
      const others = [...node.querySelectorAll(media)].filter((item) => item !== frame && !frame.contains(item) && item.getBoundingClientRect().width > 2).length;
      if ((text && !label.test(text)) || others) break;
      around.push(nameOf(node));
      node = node.parentElement;
    }
    frames.push({ host: hostOf(frame.src), size: box(frame), ...nameOf(frame), around });
  }
  const pictures = {};
  for (const image of [...document.querySelectorAll('img')].slice(0, 600)) {
    const [width, height] = box(image);
    const host = hostOf(image.currentSrc || image.src);
    if (!host || host === location.hostname || width < 80 || height < 60) continue;
    const inAd = !!image.closest('[id*="ad" i],[class*="ad" i],[class*="sponsor" i],[class*="promo" i],[class*="taboola" i],[class*="outbrain" i]') && (() => { let node = image.parentElement; while (node) { if (adName.test(node.id || '') || adName.test(typeof node.className === 'string' ? node.className : '')) return true; node = node.parentElement; } return false; })();
    const entry = pictures[host] || (pictures[host] = { shown: 0, inAd: 0 });
    if (inAd) entry.inAd += 1; else entry.shown += 1;
  }
  const video = [...new Set([...document.querySelectorAll('video,video source,audio,audio source')].map((item) => hostOf(item.currentSrc || item.src)).filter(Boolean))].slice(0, 10);
  const styles = [...new Set([...document.querySelectorAll('link[rel~="stylesheet"][href]')].map((item) => hostOf(item.href)).filter(Boolean))].slice(0, 20);
  const scripts = [...new Set([...document.querySelectorAll('script[src]')].map((item) => hostOf(item.src)).filter(Boolean))].slice(0, 80);
  const containers = [];
  const seen = new Set();
  for (const element of document.querySelectorAll('[id],[class]')) {
    if (containers.length >= 250) break;
    if (/^(HTML|BODY|SCRIPT|STYLE|LINK|META|IFRAME|IMG|A|SPAN|PATH|SVG|INPUT|BUTTON)$/i.test(element.tagName)) continue;
    const id = typeof element.id === 'string' ? element.id : '';
    const classes = [...(element.classList || [])];
    const named = [id && adName.test(id) ? '#' + id : '', ...classes.filter((name) => adName.test(name)).map((name) => '.' + name)].filter(Boolean);
    if (!named.length) continue;
    const key = named.join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    containers.push({ ...nameOf(element), named: named.slice(0, 6).map((name) => name.slice(0, 60)), size: box(element), count: 1, ...contents(element) });
  }
  const attributes = {};
  for (const name of ['data-ad', 'data-ad-slot', 'data-ad-unit', 'data-adunit', 'data-ad-client', 'data-google-query-id', 'data-ad-placeholder', 'data-ad-name', 'data-ad-format', 'data-adslot', 'data-ad-id', 'data-dfp', 'data-gpt', 'data-freestar-ad', 'data-ad-type', 'data-ad-position', 'data-ad-region', 'data-ad-size', 'data-ad-container', 'data-ad-wrapper', 'data-testid']) {
    if (name === 'data-testid') {
      const found = [...document.querySelectorAll('[data-testid]')].map((element) => element.getAttribute('data-testid')).filter((value) => adName.test(value || '')).slice(0, 10);
      if (found.length) attributes[name] = found;
    } else {
      const count = document.querySelectorAll('[' + name + ']').length;
      if (count) attributes[name] = count;
    }
  }
  const tags = {};
  for (const name of ['amp-ad', 'amp-embed', 'ins.adsbygoogle', 'gpt-ad', 'broadstreet-zone', 'ins[data-revive-zoneid]', 'ins[data-zoneid]', 'div[data-widget-id]', 'aside']) {
    const count = document.querySelectorAll(name).length;
    if (count) tags[name] = count;
  }
  return { title: document.title.slice(0, 120), textLength: (document.body?.innerText || '').length, images: document.images.length, frames, pictures, video, styles, scripts, containers, attributes, tags, height: document.documentElement.scrollHeight };
})()`

const ARTICLE_LINK = `(() => {
  const best = [...document.querySelectorAll('a[href]')]
    .filter((link) => link.hostname === location.hostname && link.pathname.length > 25 && !/\\/(tag|category|author|topics?|section|page|login|subscribe|search)\\b/i.test(link.pathname) && (link.innerText || '').trim().length > 25)
    .sort((left, right) => right.pathname.length - left.pathname.length)[0];
  return best ? best.href : '';
})()`

// ---- Visiting ------------------------------------------------------------------------------------

let ses

async function visit(outlet, kind, url) {
  const window = new BrowserWindow({
    show: false, width: 1366, height: 900,
    webPreferences: { offscreen: true, session: ses, backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  const contents = window.webContents
  contents.setAudioMuted(true)
  contents.setFrameRate(5)
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-prevent-unload', (event) => event.preventDefault())
  const origin = new URL(url)
  const page = {
    outlet: outlet.id, country: outlet.country, language: outlet.language, kind, url, origin: origin.origin, host: origin.hostname, site: siteOfHost(origin.hostname),
    protect, ownRequests: 0, hosts: {}, startedAt: new Date().toISOString(),
  }
  pages.set(contents.id, page)
  // The page stays put: a script that sends the page elsewhere would mix two sites into one record.
  contents.on('will-navigate', (event, target) => {
    const host = hostOf(target)
    if (host && siteOfHost(host) !== page.site) event.preventDefault()
  })
  contents.on('did-redirect-navigation', (_event, target, _inPlace, isMainFrame) => {
    // A redirect to the outlet's real name (www, a country version) is where the page lives.
    if (!isMainFrame) return
    const host = hostOf(target)
    if (host) Object.assign(page, { url: target, origin: new URL(target).origin, host, site: siteOfHost(host), hosts: {} })
  })
  try {
    // No pop-ups from the page's own dialogs.
    contents.debugger.attach('1.3')
    void contents.debugger.sendCommand('Page.enable').catch(() => undefined)
    contents.debugger.on('message', (_event, method) => {
      if (method === 'Page.javascriptDialogOpening') void contents.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: false }).catch(() => undefined)
    })
  } catch { /* measured all the same */ }
  let loaded = false
  const load = contents.loadURL(url).then(() => { loaded = true }, (error) => { page.loadError = String(error?.message ?? error).slice(0, 120) })
  await Promise.race([load, delay(LOAD_TIMEOUT_MS)])
  const run = (script) => (contents.isDestroyed() ? Promise.resolve(null) : Promise.race([contents.executeJavaScript(script, true).catch(() => null), delay(5000).then(() => null)]))
  if (!page.loadError || !/ERR_(NAME_NOT_RESOLVED|CONNECTION|CERT|SSL|ADDRESS|INTERNET|TIMED_OUT|EMPTY|TOO_MANY|INVALID|BLOCKED|FAILED|HTTP2)/.test(page.loadError)) {
    // Read down the page as a person would, so slots that load when they come into view do.
    const steps = 7
    for (let step = 1; step <= steps; step += 1) {
      await delay(DWELL_MS / steps)
      await run(`window.scrollTo({ top: Math.min(document.documentElement.scrollHeight, ${step} * 900), behavior: 'instant' })`)
    }
    page.loaded = loaded
    page.finalUrl = contents.isDestroyed() ? '' : contents.getURL()
    page.dom = await run(DOM_SNAPSHOT)
    if (kind === 'home') page.articleLink = await run(ARTICLE_LINK)
    if (flag('shots') && !contents.isDestroyed()) {
      await run('window.scrollTo(0, 0)')
      await delay(700)
      const image = await contents.capturePage().catch(() => null)
      if (image) writeFileSync(join(outDir, `${outlet.id.replace(/[^a-z0-9-]/gi, '_')}-${kind}.png`), image.resize({ width: 1000 }).toPNG())
    }
    try {
      const cookies = await ses.cookies.get({})
      const other = cookies.filter((cookie) => siteOfHost(cookie.domain.replace(/^\./, '')) !== page.site)
      page.cookies = { own: cookies.length - other.length, other: other.length, otherSites: [...new Set(other.map((cookie) => siteOfHost(cookie.domain.replace(/^\./, ''))))].length }
    } catch { /* not recorded */ }
  }
  pages.delete(contents.id)
  try { contents.debugger.detach() } catch { /* already gone */ }
  if (!window.isDestroyed()) window.destroy()
  for (const record of Object.values(page.hosts)) record.bytes = Math.round(record.bytes)
  appendFileSync(pagesFile, `${JSON.stringify(page)}\n`)
  return page
}

async function newestArticle(outlet) {
  for (const feed of outlet.feeds) {
    try {
      const response = await fetch(feed, { headers: { 'user-agent': app.userAgentFallback, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }, signal: AbortSignal.timeout(15_000), redirect: 'follow' })
      if (!response.ok) continue
      const xml = (await response.text()).slice(0, 400_000)
      const item = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/i)?.[0] ?? ''
      const link = item.match(/<link[^>]*>\s*(?:<!\[CDATA\[)?\s*(https?:\/\/[^\s<\]]+)/i)?.[1] ?? item.match(/<link[^>]*href=["'](https?:\/\/[^"']+)["']/i)?.[1] ?? item.match(/<guid[^>]*>\s*(?:<!\[CDATA\[)?\s*(https?:\/\/[^\s<\]]+)/i)?.[1]
      if (link) return link.replace(/&amp;/g, '&')
    } catch { /* the next feed, or the home page's own links */ }
  }
  return ''
}

async function measure(outlet) {
  if (flag('fresh-cookies')) await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] }).catch(() => undefined)
  if (outlet.urls) {
    for (const [index, url] of outlet.urls.entries()) await visit(outlet, index ? 'article' : 'home', url)
    return
  }
  let article = await newestArticle(outlet)
  let homeUrl = ''
  try {
    homeUrl = article ? `${new URL(article).origin}/` : `https://${siteOfHost(new URL(outlet.feeds[0]).hostname)}/`
  } catch { return }
  // A feed served by a feed host (feedburner and the like) links to the outlet; a feed that links elsewhere is not used.
  const home = await visit(outlet, 'home', homeUrl)
  if (!article || siteOfHost(hostOf(article)) !== home.site) article = home.articleLink || article
  if (article && hostOf(article)) await visit(outlet, 'article', article)
}

app.on('window-all-closed', () => { /* the run decides when to quit */ })
app.whenReady().then(async () => {
  if (app.dock) app.dock.hide()
  ses = session.fromPartition('crawl')
  wireSession(ses)
  let outlets
  if (option('urls', '')) {
    outlets = readFileSync(resolve(repo, option('urls', '')), 'utf8').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((line) => {
      const [id, ...urls] = line.split(/\s+/)
      return { id, country: '', language: '', feeds: [], urls }
    })
  } else {
    outlets = option('set', 'build') === 'holdout' ? holdoutOutlets() : buildOutlets(Number(option('limit', '520')))
    const only = option('only', '')
    if (only) outlets = outlets.filter((outlet) => only.split(',').includes(outlet.id))
  }
  const done = new Set(existsSync(pagesFile) ? readFileSync(pagesFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line).outlet) : [])
  const queue = outlets.filter((outlet) => !done.has(outlet.id))
  const total = queue.length
  let finished = 0
  console.log(`${total} outlets to visit (${done.size} already in ${pagesFile}); blocking ${protect ? 'on' : 'off'}`)
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (;;) {
      const outlet = queue.shift()
      if (!outlet) return
      try {
        await Promise.race([measure(outlet), delay(120_000)])
      } catch (error) {
        console.error(`${outlet.id}: ${error?.message ?? error}`)
      }
      finished += 1
      if (finished % 10 === 0 || finished === total) console.log(`${finished}/${total} ${new Date().toISOString().slice(11, 19)}`)
    }
  }))
  for (const window of BrowserWindow.getAllWindows()) window.destroy()
  await delay(300)
  app.quit()
})
app.on('quit', () => rmSync(profile, { recursive: true, force: true }))
