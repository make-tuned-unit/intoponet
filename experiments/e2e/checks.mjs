// One end-to-end check per feature in docs/FEATURE_DAG.json. Each drives the
// real built app and fails with a plain sentence when its promise isn't kept.
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { CheckFailure, expect, repo } from './lib.mjs'

const LIVE_REGISTRY = 'https://br-delicate-flower-b7mxmy9q-beacons.compute.c-13.us-east-1.aws.neon.tech'
const now = () => new Date().toISOString()
const seedLibrary = async (ctx, library) => {
  await ctx.evaluate(`window.intoponet.browserHost.writePrivateLibrary(${JSON.stringify(JSON.stringify({ schema: 'intoponet.private-library.v1', bookmarks: [], collections: [], recents: [], absorbed: [], ...library }))}).then(() => { location.reload(); return true })`).catch(() => undefined)
  await ctx.delay(4000)
}
const openPanel = async (ctx, label) => {
  expect(await ctx.click('.bookmark-library-button', label), `The "${label}" button is missing from the header.`)
  await ctx.delay(1200)
}
/** Open the first of several well-known pages that loads (one site being down must not fail a feature). */
const SITES = ['https://www.iana.org/', 'https://en.wikipedia.org/wiki/Main_Page', 'https://example.org/', 'https://httpbin.org/html']
const openAnyPage = async (ctx, wait = 4000) => {
  const failures = []
  for (const url of SITES) {
    const result = await ctx.evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: ${JSON.stringify(url)} }).then(() => 'ok', (e) => String(e).match(/ERR_[A-Z_]+/)?.[0] ?? String(e).slice(-80))`)
    if (result === 'ok') {
      await ctx.delay(wait)
      return new URL(url).hostname
    }
    failures.push(`${new URL(url).hostname}: ${result}`)
    await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => Promise.all(t.map((x) => window.intoponet.browserHost.closeTab(x.id)))).then(() => true)`)
  }
  throw new CheckFailure(`No web page would load (${failures.join('; ')}).`)
}
const openPage = async (ctx, url, wait = 6000) => {
  await ctx.evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: ${JSON.stringify(url)} }).then(() => true)`)
  await ctx.delay(wait)
}

/** A tiny sign-in site on this Mac (http://localhost is allowed for saved passwords). */
const LOGIN_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Test sign in</title>
<style>body{font:16px system-ui;margin:40px}label{display:block;margin:12px 0}input{font:inherit;padding:6px;width:260px}</style></head>
<body><h1>Sign in</h1><form method="post" action="/welcome">
<label>Email <input id="username" name="username" type="email" autocomplete="username"></label>
<label>Password <input id="password" name="password" type="password" autocomplete="current-password"></label>
<button id="go" type="submit">Sign in</button></form></body></html>`
const startLoginSite = () => new Promise((resolve) => {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    if (request.method === 'POST') {
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      // A wrong password shows the sign-in form again, as real sites do.
      request.on('end', () => {
        if (body.includes('Wrong-Pa55')) { response.statusCode = 401; response.end(LOGIN_PAGE); return }
        response.statusCode = 303; response.setHeader('location', '/welcome'); response.end()
      })
      return
    }
    response.end(request.url?.startsWith('/welcome') ? '<!doctype html><title>Welcome</title><h1>Signed in</h1>' : LOGIN_PAGE)
  })
  server.listen(0, 'localhost', () => resolve(server))
})
/** Type into a page field and send the form with a real click, as a person would. */
const signIn = async (ctx, page, username, password) => {
  await page.evaluate(`(() => { const u = document.querySelector('#username'); u.value = ''; u.focus(); return true })()`)
  await page.send('Input.insertText', { text: username })
  await page.evaluate(`(() => { const p = document.querySelector('#password'); p.value = ''; p.focus(); return true })()`)
  await page.send('Input.insertText', { text: password })
  const box = JSON.parse(await page.evaluate(`JSON.stringify(document.querySelector('#go').getBoundingClientRect())`))
  for (const type of ['mousePressed', 'mouseReleased']) {
    await page.send('Input.dispatchMouseEvent', { type, x: box.x + box.width / 2, y: box.y + box.height / 2, button: 'left', clickCount: 1 })
  }
}
const pageFields = (page) => page.evaluate(`JSON.stringify([document.querySelector('#username')?.value ?? null, document.querySelector('#password')?.value ?? null])`).then(JSON.parse)

export const checks = {
  // ---- Foundations ---------------------------------------------------------
  async APP_BOOT(ctx) {
    await ctx.wait(`!!document.querySelector('.topbar') && !!document.querySelector('canvas')`, 30_000, 'the header and globe to render')
    const buttons = await ctx.evaluate(`[...document.querySelectorAll('.bookmark-library-button')].map((b) => (b.innerText || b.getAttribute('aria-label')).trim())`)
    for (const label of ['Private', 'Bookmarks', 'The Olds', 'Knowledge', 'My map', 'Settings']) expect(buttons.some((b) => b.includes(label)), `Header is missing "${label}". Found: ${buttons.join(', ')}`)
    return `Header: ${buttons.join(' · ')}`
  },

  async GLOBE_LIVE(ctx) {
    await ctx.waitForNews()
    await ctx.wait(`document.querySelectorAll('.globe-list .globe-row').length >= 5`, 60_000, 'highlight rows on the globe panel')
    const summary = await ctx.evaluate(`[...document.querySelectorAll('p')].find((p) => /public signals/.test(p.innerText))?.innerText ?? ''`)
    const count = Number(summary.match(/(\d[\d,]*) public signals/)?.[1]?.replace(/,/g, '') ?? 0)
    expect(count >= 20, `Only ${count} public signals on the globe ("${summary}").`)
    for (const tab of ['World', 'Peaks', 'Rising', 'Fading']) expect(await ctx.click('.globe-tabs button', tab), `Highlights tab "${tab}" is missing.`)
    await ctx.shot('globe')
    return summary
  },

  async SOURCE_CAROUSEL(ctx) {
    await ctx.waitForNews()
    expect(await ctx.click('.globe-tabs button', 'World'), 'The World tab is missing.')
    await ctx.wait(`document.querySelectorAll('.world-list .world-row').length > 0`, 90_000, 'stories covered across the world')
    // Open the first story with at least three sources.
    const rows = await ctx.evaluate(`document.querySelectorAll('.world-list .world-row').length`)
    let opened = false
    for (let i = 0; i < Math.min(rows, 8) && !opened; i += 1) {
      await ctx.evaluate(`(() => { document.querySelectorAll('.world-list .world-row')[${i}].click(); return true })()`)
      await ctx.delay(400)
      opened = await ctx.evaluate(`!!document.querySelector('.world-sources-button')`)
    }
    expect(opened, 'No world story has three or more sources to show.')
    await ctx.delay(1500)
    await ctx.click('.world-sources-button')
    await ctx.delay(160)
    await ctx.shot('launching')
    await ctx.wait(`document.querySelectorAll('.sc-card').length >= 3`, 5_000, 'the carousel cards')
    await ctx.delay(900)
    await ctx.shot('carousel')
    const state0 = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getState().then((s) => JSON.stringify(s))`))
    const first = await ctx.evaluate(`document.querySelector('.sc-card.is-front .sc-outlet strong').innerText`)
    await ctx.evaluate(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); return true })()`)
    await ctx.delay(700)
    const second = await ctx.evaluate(`document.querySelector('.sc-card.is-front .sc-outlet strong').innerText`)
    expect(first !== second || (await ctx.evaluate(`document.querySelectorAll('.sc-card').length`)) < 2, 'The arrow key did not flip to the next source.')
    await ctx.shot('flipped')
    const chosen = await ctx.evaluate(`(() => { const card = document.querySelector('.sc-card.is-front'); return card.getAttribute('aria-label') })()`)
    await ctx.evaluate(`(() => { document.querySelector('.sc-card.is-front').click(); return true })()`)
    await ctx.delay(180)
    await ctx.shot('morph-early')
    await ctx.delay(180)
    await ctx.shot('morph-late')
    await ctx.wait(`!document.querySelector('.sources-carousel')`, 5_000, 'the carousel to hand over to the browser')
    const state = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getState().then((s) => JSON.stringify(s))`))
    expect(state.isVisible, 'The browser did not open the chosen source.')
    await ctx.delay(2500)
    await ctx.shot('opened')
    return `Carousel flipped from ${first} to ${second}; chose "${chosen.slice(0, 80)}" and the browser opened ${state.url} (page was ${state0.isVisible ? 'open' : 'closed'} before).`
  },

  async FLY_TO(ctx) {
    await ctx.flyTo('Charlottetown PEI')
    await ctx.wait(`document.querySelector('h1')?.innerText === 'Charlottetown'`, 15_000, 'the title to read Charlottetown')
    await ctx.wait(`getComputedStyle(document.querySelector('.globe-locator') ?? document.body).opacity === '1'`, 15_000, 'the locator to appear on the spot')
    // With a page open, a place still flies on the globe (no web search).
    await openAnyPage(ctx)
    await ctx.flyTo('Fredericto')
    await ctx.wait(`document.querySelector('h1')?.innerText === 'Fredericton'`, 15_000, 'a partial name to fly to Fredericton')
    const state = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getState().then((s) => JSON.stringify(s))`))
    expect(!state.isVisible, 'Flying to a place left the web page open on top of the globe.')
    await ctx.shot('locator')
    return 'Charlottetown PEI and "Fredericto" flew on the globe, with the locator shown.'
  },

  async GLOBE_MOTION(ctx) {
    await ctx.flyTo('Dar es Salaam')
    await ctx.wait(`getComputedStyle(document.querySelector('.globe-locator') ?? document.body).opacity === '1'`, 15_000, 'the locator')
    await ctx.delay(2500)
    const at = () => ctx.evaluate(`(() => { const r = document.querySelector('.globe-locator').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top), o: getComputedStyle(document.querySelector('.globe-locator')).opacity }) })()`).then(JSON.parse)
    const before = await at()
    for (let i = 0; i < 4; i += 1) { await ctx.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 450, deltaX: 0, deltaY: -120 }); await ctx.delay(60) }
    await ctx.delay(3000)
    const after = await at()
    // Zooming must not swing the globe away: the place stays on the visible side, near where it was.
    expect(after.o === '1', 'After zooming, the place you flew to turned away (the globe swung back).')
    expect(Math.hypot(after.x - before.x, after.y - before.y) < 250, `After zooming the place moved ${Math.round(Math.hypot(after.x - before.x, after.y - before.y))} px; the view should stay put.`)
    return `Locator ${before.x},${before.y} → ${after.x},${after.y} after zoom.`
  },

  // ---- Places, news and history --------------------------------------------
  async COUNTRY_PANEL(ctx) {
    await ctx.waitForNews()
    await ctx.flyTo('Canada')
    await ctx.delay(2500)
    expect(await ctx.click('.globe-list .globe-row', 'Canada'), 'Canada is not in the list after flying there.')
    await ctx.wait(`!!document.querySelector('.globe-context-facts')`, 90_000, 'key facts in The bigger picture')
    await ctx.wait(`!!document.querySelector('.globe-context-recent, .globe-context-links')`, 90_000, 'recent history')
    const facts = await ctx.evaluate(`document.querySelector('.globe-context-facts').innerText`)
    expect(/Population/.test(facts) && /Capital/.test(facts), `Key facts are incomplete: ${facts}`)
    const recent = await ctx.evaluate(`[...document.querySelectorAll('.globe-context-recent time')].map((t) => Number(t.dateTime.slice(0, 4)))`)
    expect(recent.length >= 2 && recent.every((y) => y >= new Date().getFullYear() - 25), `"Recent history" is not recent: ${recent.join(', ') || 'none'}`)
    const headlines = await ctx.evaluate(`document.querySelectorAll('.globe-headlines li').length`)
    expect(headlines >= 3, `Only ${headlines} local headlines for Canada.`)
    // The panel must fit: no clipped sections.
    const clipped = await ctx.evaluate(`(() => { const el = document.querySelector('.globe-context'); return el.scrollHeight > el.clientHeight + 2 })()`)
    expect(!clipped, 'The bigger picture card is clipped inside the panel.')
    await ctx.shot('canada')
    return `Facts ok, recent history ${recent.join(', ')}, ${headlines} headlines.`
  },

  async COUNTRY_NAMES(ctx) {
    await ctx.delay(2000)
    const atStart = await ctx.evaluate(`document.querySelectorAll('.country-name.is-on').length`)
    expect(atStart >= 8, `Only ${atStart} country names at the default view.`)
    // Click a named country (labels let clicks through to the globe).
    const target = JSON.parse(await ctx.evaluate(`(() => { const el = document.querySelector('.country-name.is-on'); const r = el.getBoundingClientRect(); return JSON.stringify({ name: el.textContent, x: r.left + r.width / 2, y: r.top + r.height / 2 + 1 }) })()`))
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await ctx.send('Input.dispatchMouseEvent', { type, x: target.x, y: target.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 })
      await ctx.delay(type === 'mouseMoved' ? 200 : 60)
    }
    await ctx.wait(`(document.querySelector('.globe-header h1')?.textContent ?? '') !== 'Earth, live'`, 8000, 'the clicked country to open')
    const opened = await ctx.evaluate(`document.querySelector('.globe-header h1')?.textContent ?? ''`)
    // Fly to large and tiny countries: the one in the middle must be named.
    const flights = { Canada: 'Canada', 'Vatican City': 'Vatican', Nauru: 'Nauru', Tuvalu: 'Tuvalu', Lesotho: 'Lesotho', 'New Zealand': 'New Zealand', Singapore: 'Singapore' }
    const wrong = []
    for (const [place, name] of Object.entries(flights)) {
      await ctx.press('Escape')
      await ctx.flyTo(place)
      let last = ''
      for (let i = 0, still = 0; i < 30 && still < 3; i += 1) {
        await ctx.delay(400)
        const now = await ctx.evaluate(`document.querySelector('.country-names').dataset.focus ?? ''`)
        still = now === last ? still + 1 : 0
        last = now
      }
      const focus = await ctx.evaluate(`[...document.querySelectorAll('.country-name.is-focus.is-on')].map((el) => el.textContent).join(', ')`)
      if (focus !== name) wrong.push(`${place} → ${focus || 'no name'}`)
    }
    expect(!wrong.length, `The country in view was not named: ${wrong.join('; ')}`)
    await ctx.shot('vatican')
    return `${atStart} names at the start; clicked ${target.name} → ${opened}; ${Object.keys(flights).length} flights named correctly.`
  },

  async WORLD_STORIES(ctx) {
    await ctx.waitForNews()
    await ctx.click('.globe-tabs button', 'World')
    await ctx.wait(`document.querySelectorAll('.world-list > li').length >= 5`, 90_000, 'at least five stories covered across the world')
    const scroll = JSON.parse(await ctx.evaluate(`(() => { const el = document.querySelector('.globe-panel .world-stories'); const before = el.scrollTop; el.scrollTop = 400; return JSON.stringify({ moved: el.scrollTop - before, overflow: el.scrollHeight > el.clientHeight }) })()`))
    expect(!scroll.overflow || scroll.moved > 0, 'The World list overflows but cannot be scrolled.')
    const stories = await ctx.evaluate(`document.querySelectorAll('.world-list > li').length`)
    return `${stories} world stories; scrolls ${scroll.moved}px.`
  },

  async OLDS_HEADLINE(ctx) {
    const thread = JSON.parse(await ctx.evaluate(`window.intoponet.olds.thread({ kind: 'headline', text: 'Israel to give verdict on Netanyahu in pivotal election' }).then((t) => JSON.stringify({ root: t.nodes.find((n) => n.id === t.rootId), chronicle: t.chronicle ?? [], related: t.context?.related ?? [] }))`))
    // The voters' "verdict" is the election itself; Netanyahu is also a fair match.
    expect(/Netanyahu|Israeli legislative election/.test(thread.root?.label ?? ''), `Matched the wrong topic: "${thread.root?.label}".`)
    expect(!!thread.root?.start, 'The topic has no date ("Undated").')
    expect(thread.chronicle.length >= 5, `"How we got here" has only ${thread.chronicle.length} dated events.`)
    const isos = thread.chronicle.map((e) => e.at.iso)
    expect(isos.every((iso, i) => i === 0 || isos[i - 1] <= iso), 'Chronology is not in time order.')
    expect(thread.chronicle.every((e) => !/\[\[|\]\]|\{\{/.test(e.text) && /^[\p{Lu}\d“"(]/u.test(e.text)), 'Chronology contains markup or sentence fragments.')
    expect(thread.related.length >= 2 && thread.related.every((r) => /Israel/.test(r.title)), `Topics behind the story aren't about Israel: ${thread.related.map((r) => r.title).join(', ')}`)
    // Live sample (2026-10-27) that once went wrong: this year's outbreak, the story's own country, never another country's topic.
    const guards = [
      { text: 'DR Congo reports over 10,000 Ebola cases as the outbreak spreads abroad', countryCode: 'GH', want: /^2026 Ebola/ },
      { text: 'South Africa Deploys 500 Soldiers to Quell Anti-Immigration Violence', countryCode: 'GH', want: /xenophobia.*South Africa|Immigration to South Africa/i },
      { text: 'States seeks interest for possible housing sites', countryCode: 'GG', want: /^(?!.*United States)/ },
    ]
    for (const guard of guards) {
      const label = await ctx.evaluate(`window.intoponet.olds.thread(${JSON.stringify({ kind: 'headline', text: guard.text, countryCode: guard.countryCode })}).then((t) => t.nodes.find((n) => n.id === t.rootId)?.label ?? '')`)
      expect(guard.want.test(label), `"${guard.text}" matched "${label}".`)
    }
    // A broad match switches to the current event.
    const brazil = JSON.parse(await ctx.evaluate(`window.intoponet.olds.thread({ kind: 'headline', text: 'Reader Q&A: After Lula’s sensational victory in Brazil’s presidential election, the Guardian’s Latin America correspondent answers your questions' }).then((t) => JSON.stringify({ root: t.nodes.find((n) => n.id === t.rootId)?.label, headline: t.context?.headline }))`))
    expect(/Brazil/.test(brazil.root ?? ''), `Brazil story matched "${brazil.root}" instead of the election.`)
    expect(/Lula’s/.test(brazil.headline ?? ''), 'The news card mangles the headline (apostrophes lost).')
    // No junk for a Spanish headline without translation.
    const hn = JSON.parse(await ctx.evaluate(`window.intoponet.olds.thread({ kind: 'headline', text: 'Tras 48 días de asambleas, pacientes abarrotan hospitales y claman atención digna', countryCode: 'HN', lang: 'es' }).then((t) => JSON.stringify({ root: t.nodes.find((n) => n.id === t.rootId)?.label }))`))
    expect(!/Delhi|Tras De Mí/.test(hn.root ?? ''), `A Honduran hospital story matched "${hn.root}".`)
    return `Israel → ${thread.root.label}: ${thread.chronicle.length} dated events from ${thread.chronicle[0]?.at.label}; Ebola, South Africa and Guernsey guards ok; related ${thread.related.map((r) => r.title).join(', ')}. Brazil → ${brazil.root}. Honduras → ${hn.root}.`
  },

  async OLDS_UI(ctx) {
    await ctx.waitForNews()
    await ctx.flyTo('Canada')
    await ctx.delay(2500)
    await ctx.click('.globe-list .globe-row', 'Canada')
    await ctx.wait(`document.querySelectorAll('.globe-headlines .headline-history').length > 0`, 90_000, 'a headline history button')
    await ctx.evaluate(`document.querySelector('.globe-headlines .headline-history').click(); true`)
    await ctx.wait(`!!document.querySelector('.olds-sheet h2') && !document.querySelector('.olds-status .olds-spin')`, 150_000, 'The Olds to open for the headline')
    await ctx.delay(1500)
    const views = await ctx.evaluate(`[...document.querySelectorAll('.olds-views button')].map((b) => b.innerText.trim())`)
    expect(views.includes('Story') && views.includes('Timeline'), `The Olds is missing views: ${views.join(', ')}`)
    const sections = await ctx.evaluate(`[...document.querySelectorAll('.olds-chronicle h3, .olds-related h3')].map((h) => h.innerText)`)
    await ctx.click('.olds-views button', 'Timeline')
    await ctx.delay(2500)
    const clipped = await ctx.evaluate(`(() => { const t = document.querySelector('.olds-track')?.getBoundingClientRect(); if (!t) return 0; return [...document.querySelectorAll('.olds-card')].filter((c) => { const r = c.getBoundingClientRect(); return r.top < t.top - 1 || r.bottom > t.bottom + 1 }).length })()`)
    expect(clipped === 0, `${clipped} timeline cards are clipped.`)
    await ctx.press('Escape')
    await ctx.delay(900)
    expect(!(await ctx.evaluate(`!!document.querySelector('.olds-sheet')`)), 'Escape does not close The Olds.')
    return `Views ${views.join('/')}; sections: ${sections.join(', ') || 'path only'}.`
  },

  async OLDS_DEBATE(ctx) {
    const thread = JSON.parse(await ctx.evaluate(`window.intoponet.olds.thread({ kind: 'wikipedia', title: 'Industrial Revolution' }).then((t) => JSON.stringify({ interpretations: t.interpretations ?? [], chapters: (t.chapters ?? []).length }))`))
    expect(thread.interpretations.length >= 2, `Only ${thread.interpretations.length} attributed interpretations for the Industrial Revolution.`)
    expect(thread.interpretations.every((i) => i.view.includes(i.who.split(' ').at(-1))), 'An interpretation is not attributed to the person who holds it.')
    return thread.interpretations.map((i) => i.who).join(', ')
  },

  async OLDS_COUNTRY(ctx) {
    const thread = JSON.parse(await ctx.evaluate(`window.intoponet.olds.thread({ kind: 'country', countryCode: 'FO' }).then((t) => JSON.stringify({ facts: t.facts, chapters: (t.chapters ?? []).length, chronicle: (t.chronicle ?? []).map((e) => e.at.iso) }))`))
    expect(!!thread.facts?.capital, 'The Faroe Islands have no key facts.')
    expect(thread.chronicle.some((iso) => Number(iso.slice(0, 4)) >= new Date().getFullYear() - 10), 'No events from the last ten years in the Faroe Islands chronology.')
    return `Capital ${thread.facts.capital}; ${thread.chapters} chapters; latest event ${thread.chronicle.at(-1)}.`
  },

  // ---- Browsing ------------------------------------------------------------
  async BROWSE(ctx) {
    const host = await openAnyPage(ctx)
    const tabs = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => JSON.stringify(t))`))
    expect(tabs.length === 1 && tabs[0].url.includes(host), 'Opening a page did not create its tab.')
    const labels = await ctx.evaluate(`[...document.querySelectorAll('.browser-actions .chrome-label')].map((l) => l.textContent)`)
    for (const name of ['Translate', 'Capture', 'Pin', 'Absorb', 'Bookmarks']) expect(labels.some((l) => l.includes(name)), `Toolbar is missing "${name}".`)
    await ctx.evaluate(`window.intoponet.browserHost.closeTab(${JSON.stringify(tabs[0].id)}).then(() => true)`)
    await ctx.delay(1500)
    // Main process still answers (closing tabs used to crash it).
    const after = await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => t.length)`)
    expect(after === 0, 'The tab did not close.')
    return `Toolbar: ${labels.join(', ')}; tab closed cleanly.`
  },

  async PROTECTION(ctx) {
    await openPage(ctx, 'https://www.cnn.com/', 9000)
    expect(await ctx.click('.shield-control > button'), 'The Protection button is missing.')
    await ctx.delay(1000)
    const bar = await ctx.evaluate(`document.querySelector('.shield-bar')?.innerText ?? ''`)
    expect(/Protected|Paused/.test(bar) && /blocked/.test(bar), `The protection bar is missing or incomplete: "${bar}"`)
    const blocked = Number(bar.match(/(\d+) tracker/)?.[1] ?? 0) + Number(bar.match(/(\d+) ad/)?.[1] ?? 0)
    expect(blocked > 0, 'Nothing was blocked on a tracker-heavy news site.')
    expect(!(await ctx.evaluate(`!!document.querySelector('.shield-panel')`)), 'The old tall protection panel still shows.')
    return bar.replace(/\n+/g, ' · ')
  },

  async PERMISSIONS(ctx) {
    const host = await openAnyPage(ctx)
    const page = await ctx.page(host)
    void page.evaluate(`new Promise((resolve) => navigator.geolocation.getCurrentPosition(() => resolve('ok'), () => resolve('err')))`)
    await ctx.wait(`!!document.querySelector('.permission-bar')`, 15_000, 'the permission bar when a site asks for location')
    expect(await ctx.click('.permission-bar button', 'Allow'), 'The permission bar has no Allow button.')
    await ctx.delay(1500)
    const state = await page.evaluate(`navigator.permissions.query({ name: 'geolocation' }).then((p) => p.state)`)
    expect(state === 'granted', `After Allow, the site still sees location as "${state}".`)
    const opened = await page.evaluate(`(() => { const w = window.open('https://www.wikipedia.org/', 'signin', 'width=480,height=600'); return !!w && w.opener === window })()`, { userGesture: true })
    expect(opened, 'A sign-in style popup was blocked or lost its opener.')
    await page.evaluate(`(() => { const a = document.createElement('a'); a.href = 'https://www.iana.org/'; a.target = '_blank'; document.body.append(a); a.click(); return true })()`, { userGesture: true })
    await ctx.delay(2500)
    const tabs = await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => t.map((x) => x.url).join(' '))`)
    expect(/iana\.org/.test(tabs), 'A target=_blank link did not open as a tab.')
    return 'Location allowed via the bar; popup kept its opener; _blank opened a tab.'
  },

  async PRIVATE_BROWSING(ctx) {
    await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(true).then(() => true)`)
    await openAnyPage(ctx)
    const tab = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => JSON.stringify(t[0] ?? null))`))
    expect(tab?.isPrivate === true, 'A tab opened in private mode is not private.')
    const recents = await ctx.evaluate(`window.intoponet.browserHost.readPrivateLibrary().then((r) => r.status === 'ok' && r.payload ? JSON.parse(r.payload).recents.length : 0)`)
    expect(recents === 0, 'A private visit was kept in recent pages.')
    const off = JSON.parse(await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(false).then((s) => JSON.stringify(s))`))
    await ctx.delay(1000)
    const left = await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => t.length)`)
    expect(!off.privateMode && left === 0, 'Turning private browsing off left private tabs open.')
    return 'Private tab marked, no footprints, closed when private mode ended.'
  },

  async SAVED_PASSWORDS(ctx) {
    const server = await startLoginSite()
    const port = server.address().port
    const site = `localhost:${port}`
    const login = `http://${site}/login`
    const password = 'Test-Pa55word!e2e'
    try {
      await openPage(ctx, login, 2500)
      const page = await ctx.page(`${site}/login`)
      expect(JSON.stringify(await pageFields(page)) === '["",""]', 'The sign-in form was filled before anything was saved.')
      // A failed sign-in (the form comes back) is not offered.
      await signIn(ctx, page, 'tester@example.com', 'Wrong-Pa55')
      await ctx.delay(4000)
      expect(!(await ctx.evaluate(`!!document.querySelector('.password-bar')`)), 'A failed sign-in offered to save its password.')
      await signIn(ctx, await ctx.page(`${site}/welcome`), 'tester@example.com', password)
      await ctx.wait(`(document.querySelector('.password-bar')?.innerText ?? '').includes('Save password')`, 15_000, 'the "Save password" offer after signing in')
      const offer = await ctx.evaluate(`document.querySelector('.password-bar').innerText`)
      expect(offer.includes(site) && offer.includes('tester@example.com'), `The offer does not name the site and account: "${offer}"`)
      expect(offer.includes('macOS Keychain'), 'The offer does not say where the password is kept.')
      await ctx.shot('offer')
      expect(await ctx.click('.password-bar button', 'Save'), 'The offer has no Save button.')
      await ctx.wait(`window.intoponet.passwords.list().then((l) => l.length === 1 && l[0].username === 'tester@example.com' && l[0].origin === 'http://${site}')`, 10_000, 'the sign-in to be saved')
      // Saving offers to bookmark the site into a group; "Accounts" is made on first use.
      await ctx.wait(`(document.querySelector('.bookmark-site-bar')?.innerText ?? '').includes('Bookmark ${site}')`, 5_000, 'the offer to bookmark the site')
      await ctx.shot('bookmark-offer')
      expect(await ctx.click('.bookmark-site-bar button', 'Accounts'), 'The bookmark offer has no Accounts button.')
      await ctx.wait(`!document.querySelector('.bookmark-site-bar') && document.body.innerText.includes('Bookmarked ${site} in Accounts')`, 5_000, 'the site to be bookmarked in Accounts')
      if (!(await ctx.evaluate(`!!document.querySelector('.bookmark-pane')`))) await ctx.click('.bookmark-library-button', 'Bookmarks')
      await ctx.wait(`(() => { const text = document.querySelector('.bookmark-pane')?.innerText ?? ''; return text.includes('Accounts') && text.includes('${site}') })()`, 5_000, 'the Bookmarks pane to list the site under Accounts')
      await ctx.shot('bookmarked')
      await ctx.click('.bookmark-library-button', 'Bookmarks')
      const listed = await ctx.evaluate(`window.intoponet.passwords.list().then((l) => JSON.stringify(l))`)
      expect(!listed.includes(password), 'The saved list sent the password to the shell.')
      const sealedPath = join(ctx.profile, 'passwords.v1.seal')
      expect(existsSync(sealedPath), 'No sealed password file was written.')
      const sealed = readFileSync(sealedPath)
      expect(!sealed.includes(password) && !sealed.includes('tester@example.com'), 'The password file holds plaintext.')

      // Back to the sign-in page: one saved account is filled on its own.
      await ctx.evaluate(`window.intoponet.browserHost.navigate(${JSON.stringify(login)}).then(() => true)`)
      await ctx.delay(1500)
      const reload = await ctx.page(`${site}/login`)
      let fields = []
      for (let i = 0; i < 20; i += 1) {
        fields = await pageFields(reload)
        if (fields[1]) break
        await ctx.delay(300)
      }
      expect(fields[0] === 'tester@example.com' && fields[1] === password, `The saved sign-in was not filled (got ${JSON.stringify(fields.map((f) => (f ? f.length : f)))}).`)
      await ctx.wait(`!!document.querySelector('.password-toggle')`, 5_000, 'the Passwords button in the page toolbar')
      await ctx.pageShot(reload, 'filled-page')
      await ctx.shot('filled-shell')

      // A second account: saved, then the next visit asks which one.
      await signIn(ctx, reload, 'second@example.com', 'Another-Pa55')
      await ctx.wait(`(document.querySelector('.password-bar')?.innerText ?? '').includes('Save password')`, 15_000, 'an offer for the second account')
      await ctx.click('.password-bar button', 'Save')
      await ctx.wait(`window.intoponet.passwords.list().then((l) => l.length === 2)`, 10_000, 'the second account to be saved')
      await ctx.evaluate(`window.intoponet.browserHost.navigate(${JSON.stringify(login)}).then(() => true)`)
      await ctx.wait(`(document.querySelector('.password-bar')?.innerText ?? '').includes('Sign in to')`, 15_000, 'the account choice for a site with two sign-ins')
      const choice = await ctx.page(`${site}/login`)
      expect(JSON.stringify(await pageFields(choice)) === '["",""]', 'With two accounts, one was filled without asking.')
      await ctx.shot('choose')
      expect(await ctx.click('.password-accounts button', 'second@example.com'), 'The second account is not offered.')
      await ctx.delay(800)
      fields = await pageFields(choice)
      expect(fields[0] === 'second@example.com' && fields[1] === 'Another-Pa55', 'Choosing an account did not fill it.')

      // Settings › Passwords lists them without showing passwords.
      await ctx.evaluate(`window.intoponet.browserHost.close().then(() => true)`)
      await openPanel(ctx, 'Settings')
      await ctx.wait(`(document.querySelector('.password-settings')?.innerText ?? '').includes('second@example.com')`, 5_000, 'Settings › Passwords to list the accounts')
      const settings = await ctx.evaluate(`document.querySelector('.password-settings').innerText`)
      expect(settings.includes(site) && settings.includes('tester@example.com') && !settings.includes(password), 'Settings › Passwords does not list the saved sign-ins (or shows a password).')
      await ctx.evaluate(`(() => { document.querySelector('.password-settings').scrollIntoView({ block: 'start' }); return true })()`)
      await ctx.delay(400)
      await ctx.shot('settings')
      await ctx.click('[aria-label="Close settings"]')

      // Private tabs are never filled and never offer to save.
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(true).then(() => true)`)
      await openPage(ctx, login, 2500)
      const hidden = await ctx.page(`${site}/login`)
      expect(JSON.stringify(await pageFields(hidden)) === '["",""]', 'A private tab was filled with a saved password.')
      await signIn(ctx, hidden, 'private@example.com', 'Private-Pa55')
      await ctx.delay(2500)
      const privateOffer = await ctx.evaluate(`!!document.querySelector('.password-bar')`)
      expect(!privateOffer, 'A private tab offered to save a password.')
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(false).then(() => true)`)
      const count = await ctx.evaluate(`window.intoponet.passwords.list().then((l) => l.length)`)
      expect(count === 2, 'A private sign-in was saved.')
      return `Failed sign-in not offered; offered, saved, bookmarked in Accounts (sealed file, no plaintext), filled one account on its own, asked between two, listed in Settings; private tab untouched (${site}).`
    } finally {
      server.close()
    }
  },

  async PAYWALL_ALTERNATIVES(ctx) {
    await ctx.waitForNews()
    await openPage(ctx, 'https://www.nytimes.com/section/world', 9000)
    const access = JSON.parse(await ctx.evaluate(`window.intoponet.access.page().then((p) => JSON.stringify(p))`))
    expect(access && typeof access.paywalled === 'boolean', 'Paywall detection did not report on the page.')
    return `nytimes.com section page: paywalled=${access.paywalled} (${access.signals.join(', ') || 'no signals'}).`
  },

  async CAPTURE(ctx) {
    await openAnyPage(ctx)
    expect(await ctx.click('.browser-actions button', 'Capture'), 'The Capture button is missing.')
    await ctx.wait(`!!document.querySelector('.cap-group select')`, 10_000, 'the capture toolbar')
    const options = await ctx.evaluate(`[...document.querySelectorAll('.cap-group option')].map((o) => o.textContent)`)
    expect(options.includes('New folder…'), 'Saving a capture has no "New folder…" option.')
    await ctx.click('.cap-primary')
    await ctx.wait(`window.intoponet.captures.list().then((l) => l.length > 0)`, 15_000, 'the screenshot to be saved')
    return 'Screenshot saved; "New folder…" offered.'
  },

  // ---- Private library -----------------------------------------------------
  async LIBRARY(ctx) {
    await ctx.evaluate(`(() => { localStorage.setItem('intoponet.bookmarks.v1', JSON.stringify([{ url: 'https://en.wikipedia.org/wiki/Vanuatu', title: 'Vanuatu', topic: 'Pacific', savedAt: '2026-01-01T00:00:00Z', fieldAnchor: { lat: -15.4, lon: 166.9, label: 'Vanuatu' } }])); location.reload(); return true })()`).catch(() => undefined)
    await ctx.delay(5000)
    const plain = await ctx.evaluate(`['intoponet.bookmarks.v1', 'intoponet.collections.v1', 'intoponet.recents.v1'].filter((k) => localStorage.getItem(k) !== null).length`)
    expect(plain === 0, 'A plain-text copy of the library is still kept in browser storage.')
    const lib = await ctx.evaluate(`window.intoponet.browserHost.readPrivateLibrary().then((r) => r.status === 'ok' && r.payload ? JSON.parse(r.payload).bookmarks.map((b) => b.title).join(',') : '')`)
    expect(lib.includes('Vanuatu'), 'An old plain-text bookmark was lost instead of moving into the encrypted library.')
    await openPanel(ctx, 'My map')
    expect(await ctx.click('.bookmark-pin-actions button', 'Hide pin'), 'Pins cannot be hidden from the globe.')
    await ctx.delay(500)
    const hidden = await ctx.evaluate(`window.intoponet.browserHost.readPrivateLibrary().then((r) => JSON.parse(r.payload).bookmarks.some((b) => b.hiddenOnMap))`)
    expect(hidden, 'Hiding a pin was not saved.')
    expect(await ctx.click('.bookmark-pin-actions button', 'Publish beacon'), 'A pin cannot be published as a beacon.')
    await ctx.wait(`!!document.querySelector('.beacon-payload pre')`, 10_000, 'the beacon consent screen')
    const disabled = await ctx.evaluate(`document.querySelector('.beacon-actions .is-primary').disabled`)
    expect(disabled, 'Publish is possible before agreeing that the beacon is public.')
    return 'Migrated to encrypted library; pin hidden; beacon consent requires agreement.'
  },

  async COLLECTIONS_IMPORT(ctx) {
    const t = now()
    const bookmarks = [
      { url: 'https://en.wikipedia.org/wiki/Fiji', title: 'Fiji', topic: 'Pacific', savedAt: t, tags: ['Islands'] },
      { url: 'https://en.wikipedia.org/wiki/Tonga', title: 'Tonga', topic: 'Pacific', savedAt: t },
      { url: 'https://www.rnz.co.nz/pacific', title: 'RNZ Pacific', topic: 'News', savedAt: t },
    ]
    await seedLibrary(ctx, { bookmarks, collections: [{ id: 'c1', label: 'Pacific', createdAt: t, memberUrls: bookmarks.map((b) => b.url) }] })
    await openPanel(ctx, 'My map')
    await ctx.click('.drawer-tabs button', 'Collections')
    await ctx.delay(500)
    await ctx.click('.collection-row .bookmark-destination', 'Pacific')
    await ctx.delay(500)
    const why = await ctx.evaluate(`document.querySelector('.collection-why')?.innerText ?? ''`)
    expect(/en\.wikipedia\.org \(2\)/.test(why), `The collection doesn't explain what's in it: "${why}"`)
    expect(await ctx.click('.collection-tools button', 'Split by site'), 'Collections cannot be split by site.')
    await ctx.delay(800)
    const count = await ctx.evaluate(`window.intoponet.browserHost.readPrivateLibrary().then((r) => JSON.parse(r.payload).collections.length)`)
    expect(count === 2, `Splitting produced ${count} collections, expected 2.`)
    const tags = await ctx.evaluate(`[...document.querySelectorAll('.bookmark-destination small')].map((s) => s.innerText).join(' | ')`)
    return `Explained and split into ${count}. ${tags}`
  },

  async EXCLUDED_SITES(ctx) {
    const host = await openAnyPage(ctx, 1000)
    await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => Promise.all(t.map((x) => window.intoponet.browserHost.closeTab(x.id)))).then(() => true)`)
    await ctx.evaluate(`window.intoponet.privacy.setExcludedSites([${JSON.stringify(host.replace(/^www\./, ''))}]).then(() => true)`)
    await openPage(ctx, `https://${host}/`)
    const refusal = await ctx.evaluate(`window.intoponet.knowledge.preview('article').then((p) => p.refused ? p.reason : 'ALLOWED')`)
    expect(/left this site out/.test(refusal), `An excluded site could be absorbed: ${refusal}`)
    const recents = await ctx.evaluate(`window.intoponet.browserHost.readPrivateLibrary().then((r) => r.status === 'ok' && r.payload ? JSON.parse(r.payload).recents.map((p) => p.url).join(' ') : '')`)
    expect(!recents.includes(host.replace(/^www\./, '')), 'An excluded site was kept in recent pages.')
    return 'Absorb refused; no recent page kept.'
  },

  // ---- Knowledge -----------------------------------------------------------
  async ABSORB(ctx) {
    await openPage(ctx, 'https://en.wikipedia.org/wiki/Climate_change', 8000)
    const preview = JSON.parse(await ctx.evaluate(`window.intoponet.knowledge.preview('article').then((p) => JSON.stringify(p))`))
    expect(!preview.refused, `Absorb refused a Wikipedia article: ${preview.reason}`)
    const record = JSON.parse(await ctx.evaluate(`window.intoponet.knowledge.commit(${JSON.stringify(preview.previewId)}, {}).then((r) => JSON.stringify(r))`))
    const hits = JSON.parse(await ctx.evaluate(`window.intoponet.knowledge.search('greenhouse gas emissions').then((h) => JSON.stringify(h))`))
    expect(hits.length > 0 && hits[0].recordId === record.id && Number.isInteger(hits[0].paragraphIndex), 'Searching absorbed knowledge does not return a cited paragraph.')
    const claims = JSON.parse(await ctx.evaluate(`window.intoponet.knowledge.claims(${JSON.stringify(record.id)}).then((c) => JSON.stringify(c))`))
    expect(claims.length >= 5, `Only ${claims.length} claims found in a long climate article.`)
    expect(claims.filter((c) => c.status === 'disputed').length <= 2, 'Claims are flagged as disputed with only one source absorbed.')
    // Selection absorb: highlighted text only.
    const page = await ctx.page('Climate_change')
    await page.evaluate(`(() => { const p = [...document.querySelectorAll('#mw-content-text p')].find((el) => el.innerText.length > 200); const r = document.createRange(); r.selectNodeContents(p); getSelection().removeAllRanges(); getSelection().addRange(r); return true })()`)
    const selection = JSON.parse(await ctx.evaluate(`window.intoponet.knowledge.preview('selection').then((p) => JSON.stringify({ scope: p.scope, words: p.wordCount ?? p.analysis?.wordCount, refused: p.refused }))`))
    expect(selection.scope === 'selection' && !selection.refused, 'Absorbing a selection did not keep just the selected text.')
    return `Absorbed ${record.wordCount} words; ${claims.length} claims; selection absorb ok.`
  },

  // ---- Settings, translation, Laya -----------------------------------------
  async SETTINGS(ctx) {
    await openPanel(ctx, 'Settings')
    const text = await ctx.evaluate(`document.querySelector('.settings-pane')?.innerText ?? ''`)
    for (const piece of ['Read the web in', 'Translate pages', 'Downloaded languages', 'Beacons', 'Credits and licences', 'Privacy']) expect(text.includes(piece), `Settings is missing "${piece}".`)
    await ctx.click('[aria-label="Settings"]')
    await openPanel(ctx, 'My map')
    await ctx.click('.drawer-tabs button', 'Privacy')
    await ctx.delay(500)
    const privacy = await ctx.evaluate(`document.querySelector('.privacy-pane')?.innerText ?? ''`)
    for (const piece of ['Private browsing', 'Footprints', 'Sites to leave out', 'Your pins on the globe', 'Backups']) expect(privacy.includes(piece), `Privacy is missing "${piece}".`)
    return 'Settings and Privacy sections present.'
  },

  async AUTO_TRANSLATE(ctx) {
    await openPanel(ctx, 'Settings')
    await ctx.evaluate(`(() => { const boxes = [...document.querySelectorAll('.settings-pane input[type=checkbox]')]; boxes[0].click(); boxes[1].click(); return true })()`)
    await ctx.click('[aria-label="Close settings"]')
    await openPage(ctx, 'https://www.fontanka.ru/', 1000)
    await ctx.wait(`window.intoponet.translate.pageState().then((s) => s.status === 'translated')`, 240_000, 'a Russian page to translate itself')
    return 'fontanka.ru detected as Russian and translated automatically.'
  },

  async ROUGH_TRANSLATE(ctx) {
    await ctx.waitForNews()
    await ctx.flyTo('Faroe Islands')
    await ctx.delay(3000)
    await ctx.click('.globe-list .globe-row', 'Faroe')
    await ctx.wait(`!!document.querySelector('.tr-headline-bar')`, 60_000, 'a translate offer for Faroese headlines')
    const offer = await ctx.evaluate(`document.querySelector('.tr-headline-bar').innerText`)
    expect(/Icelandic/.test(offer), `Faroese is not offered via Icelandic: "${offer}"`)
    await ctx.click('.tr-headline-bar button')
    await ctx.wait(`[...document.querySelectorAll('.globe-headlines small')].some((s) => /via Icelandic/.test(s.innerText))`, 240_000, 'headlines labelled "rough, via Icelandic"')
    return 'Faroese headlines translated roughly via Icelandic, labelled as such.'
  },

  async BEACONS_REGISTRY(ctx) {
    const state = JSON.parse(await ctx.evaluate(`window.intoponet.beacons.state().then((s) => JSON.stringify(s))`))
    expect(state.registry === LIVE_REGISTRY, `The app does not point at the live registry by default (${state.registry || 'none'}).`)
    const health = await (await fetch(`${LIVE_REGISTRY}/v1/health`)).json()
    expect(health.ok === true, 'The beacon registry is not healthy.')
    const read = await ctx.evaluate(`window.intoponet.beacons.read({ topic: 'none-such-topic' }).then((r) => Array.isArray(r))`)
    expect(read, 'The app cannot read beacons from the registry.')
    const unsigned = await fetch(`${LIVE_REGISTRY}/v1/beacons`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'publish' }) })
    expect(unsigned.status === 400, `The registry accepted an unsigned request (${unsigned.status}).`)
    return 'Live registry healthy, readable from the app, refuses unsigned publishes.'
  },

  // ---- Accessibility -------------------------------------------------------
  async ACCESSIBILITY(ctx) {
    const axe = readFileSync(join(repo, 'node_modules/axe-core/axe.min.js'), 'utf8')
    await ctx.delay(3000)
    await ctx.evaluate(`${axe}; true`)
    const audit = async (where) => {
      const raw = JSON.parse(await ctx.evaluate(`axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }).then((r) => JSON.stringify(r.violations.map((v) => v.id + ' ×' + v.nodes.length)))`))
      expect(raw.length === 0, `WCAG violations on ${where}: ${raw.join(', ')}`)
    }
    await audit('the globe')
    for (const label of ['Bookmarks', 'My map', 'Settings', 'Knowledge']) {
      await ctx.evaluate(`document.querySelector('[data-panel]') && [...document.querySelectorAll('.bookmark-library-button')].find((b) => (b.innerText || b.getAttribute('aria-label')).includes(${JSON.stringify(label)})).focus(); true`)
      await ctx.press('Enter')
      await ctx.delay(1300)
      await audit(label)
      await ctx.press('Escape')
      await ctx.delay(900)
      const focus = await ctx.evaluate(`(document.activeElement?.innerText || document.activeElement?.getAttribute('aria-label') || '').trim()`)
      expect(focus.includes(label), `After closing ${label} with Escape, focus went to "${focus || 'nothing'}" instead of its button.`)
    }
    return 'No WCAG 2.1 AA violations; panels open with Enter, close with Escape, focus returns.'
  },
}
