// One end-to-end check per feature in docs/FEATURE_DAG.json. Each drives the
// real built app and fails with a plain sentence when its promise isn't kept.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer as createHttpsServer } from 'node:https'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { deflateSync as zlibSync } from 'node:zlib'
import { CheckFailure, expect, repo } from './lib.mjs'

// The app's default: the website's edge proxy in front of the Neon registry (see apps/desktop/src/main/beacons/defaults.ts).
const LIVE_REGISTRY = 'https://intoponet.com/registry'
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

/** A plain PNG of one colour (fixture images for the PDF check). */
const solidPng = (width, height, [r, g, b]) => {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (buf) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]) }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())])
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlibSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk('IEND', Buffer.alloc(0))])
}

/** An article with everything a PDF should leave out (ads, hidden and clipped text, a consent overlay) and a lazy image. */
const PDF_ARTICLE = (sections) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Harbour lights of Charlottetown | Island Fixture News</title>
<meta name="citation_title" content="Harbour lights of Charlottetown"><meta name="citation_author" content="Fixture Reporter">
<meta property="og:site_name" content="Island Fixture News"><meta property="article:published_time" content="2026-03-04T10:00:00Z">
<script type="application/ld+json">{"@type":"NewsArticle","headline":"Harbour lights of Charlottetown","articleBody":"JSONLD-SENTINEL never print this"}</script>
<style>body{font:17px Georgia;margin:0}header.site{position:sticky;top:0;background:#123;color:#fff;padding:12px}main{max-width:700px;margin:auto}.consent{position:fixed;inset:auto 0 0 0;height:45vh;background:#fff;border-top:2px solid #000}</style></head>
<body><header class="site">Island Fixture News · Home · World</header>
<main><article><h1>Harbour lights of Charlottetown</h1>
<p>START-SENTINEL The harbour at Charlottetown has been lit by the same family of keepers for four generations, and the lamps still turn every night.</p>
<figure><img src="/img/top.png" width="640" height="320" alt="The harbour at dusk"><figcaption>The harbour at dusk.</figcaption></figure>
<div class="ad-slot">AD-SENTINEL-ONE Buy the best boats today</div>
<ins class="adsbygoogle" style="display:block">AD-SENTINEL-TWO</ins>
<aside><span>Advertisement</span><div>AD-SENTINEL-THREE</div></aside>
<div style="display:none">HIDDEN-SENTINEL subscriber only text</div>
<div style="max-height:60px;overflow:hidden"><p>The tide comes in twice a day.</p><p style="margin-top:400px">CLIPPED-SENTINEL more subscriber text</p></div>
${sections.map((section, index) => `<h2>${section}</h2>${Array.from({ length: 6 }, (_, p) => `<p>${index === 4 && p === 3 ? 'MIDDLE-SENTINEL ' : ''}Paragraph ${p + 1} about ${section.toLowerCase()}: the keepers wrote down the weather, the ships that passed and the state of the lamps in long ledgers that are now kept in the provincial archives, where anyone can read them.</p>`).join('')}`).join('')}
<p style="margin-top:1600px">Further down the page.</p><figure><img loading="lazy" src="/img/lazy.png" width="600" height="300" alt="A lamp"></figure>
<p>END-SENTINEL That is the story of the harbour lights.</p></article></main>
<div class="consent" role="dialog">OVERLAY-SENTINEL We use cookies <button>Accept</button></div></body></html>`

const PDF_SHOP = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Lighthouse lamp — Fixture Shop</title>
<meta property="og:type" content="product"><script type="application/ld+json">{"@type":"Product","name":"Lighthouse lamp"}</script>
<style>body{font:15px system-ui;margin:20px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.card{border:1px solid #ccc;padding:10px}</style></head>
<body><h1>Lighthouse lamp</h1><p>SHOP-SENTINEL A brass lamp, 30 cm.</p><div class="grid">${Array.from({ length: 9 }, (_, i) => `<div class="card">Lamp ${i + 1} · $${20 + i}</div>`).join('')}</div>
<div id="div-gpt-ad-1" class="ad-holder">AD-SENTINEL-SHOP</div><div class="banner-ad"><span>Sponsored</span><b>AD-SENTINEL-SPONSORED</b></div></body></html>`

async function pdfExport(ctx) {
  const top = solidPng(64, 32, [40, 90, 160])
  const lazy = solidPng(60, 30, [200, 120, 40])
  const sections = ['Keepers', 'Ledgers', 'Storms', 'Ships', 'Lamps', 'Archives', 'Visitors', 'Tomorrow']
  const server = await new Promise((resolve) => {
    const site = createServer((request, response) => {
      if (request.url === '/img/top.png' || request.url === '/img/lazy.png') {
        response.setHeader('content-type', 'image/png')
        response.end(request.url.includes('lazy') ? lazy : top)
        return
      }
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(request.url?.startsWith('/shop') ? PDF_SHOP : PDF_ARTICLE(sections))
    })
    site.listen(0, '127.0.0.1', () => resolve(site))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const savedPath = async (previous) => {
    await ctx.wait(`(() => { const el = document.querySelector('.pdf-done .pdf-name'); return !!el && el.title !== ${JSON.stringify(previous ?? '')} })()`, 90_000, 'the PDF to be saved')
    return ctx.evaluate(`document.querySelector('.pdf-done .pdf-name').title`)
  }
  const text = (path) => execFileSync('/opt/homebrew/bin/pdftotext', ['-layout', path, '-'], { encoding: 'utf8' })
  const info = (path) => execFileSync('/opt/homebrew/bin/pdfinfo', [path], { encoding: 'utf8' })
  try {
    const t = now()
    await seedLibrary(ctx, { collections: [{ id: 'pdfgroup', label: 'Reading', createdAt: t, memberUrls: [] }] })
    await ctx.evaluate(`window.intoponet.browserHost.setPdfSettings({ mode: 'auto', paper: 'a4', textSize: 'medium', images: true, citation: true, groupId: 'pdfgroup' }).then(() => true)`)
    const article = `${base}/article`
    await openPage(ctx, article, 3000)
    expect(await ctx.click('[aria-label="Save this page as PDF"]'), 'The toolbar has no PDF button.')
    const path = await savedPath()
    expect(path.endsWith('.pdf') && existsSync(path), `No PDF was written (${path}).`)
    expect(/Harbour lights of Charlottetown – Island Fixture News – \d{4}-\d{2}-\d{2}\.pdf$/.test(path), `The file name is not "Title – Site – date.pdf": ${path}`)
    const body = text(path)
    for (const sentinel of ['START-SENTINEL', 'MIDDLE-SENTINEL', 'END-SENTINEL', 'Fixture Reporter', '4 March 2026', 'with Intoponet']) {
      expect(body.includes(sentinel), `The formatted PDF is missing "${sentinel}".`)
    }
    for (const sentinel of ['AD-SENTINEL', 'HIDDEN-SENTINEL', 'CLIPPED-SENTINEL', 'OVERLAY-SENTINEL', 'JSONLD-SENTINEL', 'Island Fixture News · Home']) {
      expect(!body.includes(sentinel), `The formatted PDF still contains "${sentinel}" (ads, hidden or overlay content must be left out).`)
    }
    expect(/\b2 ?\/ ?\d+\b/.test(body), `The pages have no "n / m" page numbers: …${body.slice(-600)}`)
    const details = info(path)
    expect(/Tagged:\s+yes/.test(details), 'The PDF is not tagged.')
    expect(/Title:\s+Harbour lights of Charlottetown/.test(details), `The PDF title is not set:\n${details}`)
    expect(/Author:\s+Fixture Reporter/.test(details), 'The PDF author is not set.')
    expect(/A4/.test(details), 'The PDF is not on A4 paper as chosen.')
    const pages = Number(/Pages:\s+(\d+)/.exec(details)?.[1] ?? 0)
    expect(pages >= 2, `The PDF has ${pages} page(s).`)
    const images = execFileSync('/opt/homebrew/bin/pdfimages', ['-list', path], { encoding: 'utf8' }).trim().split('\n').length - 2
    expect(images >= 2, `The PDF has ${images} image(s); the lazy-loaded one should be there too.`)
    const { PDFDocument, PDFName } = await import('@cantoo/pdf-lib')
    const doc = await PDFDocument.load(readFileSync(path))
    expect(doc.catalog.has(PDFName.of('Outlines')), 'The PDF has no outline (bookmarks of its headings).')
    expect(doc.catalog.has(PDFName.of('StructTreeRoot')), 'The PDF lost its accessibility tags.')
    const whereFrom = execFileSync('/usr/bin/xattr', ['-p', 'com.apple.metadata:kMDItemWhereFroms', path], { encoding: 'utf8' })
    expect(whereFrom.trim().length > 0, 'Finder has no "Where from" for the PDF.')
    await ctx.delay(1500)
    const library = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.readPrivateLibrary().then((r) => r.payload)`))
    const bookmark = library.bookmarks.find((item) => item.url === article)
    expect(bookmark?.pdf?.path === path, `The page was not bookmarked with a link to its PDF: ${JSON.stringify(bookmark)}`)
    expect(library.collections.find((c) => c.id === 'pdfgroup')?.memberUrls.includes(article), 'The bookmark is not in the chosen group.')
    const downloads = await ctx.evaluate(`window.intoponet.downloads.list().then((l) => l.some((d) => d.filename.endsWith('.pdf') && d.state === 'completed'))`).catch(() => null)
    expect(downloads !== false, 'The PDF is not listed in Downloads.')

    // A shop page is not an article: saved as seen, still without ads, and the live page is left as it was.
    await ctx.evaluate(`window.intoponet.browserHost.setPdfSettings({ mode: 'auto', paper: 'a4', textSize: 'medium', images: true, citation: true, groupId: '' }).then(() => true)`)
    await openPage(ctx, `${base}/shop`, 2500)
    await ctx.evaluate(`window.intoponet.browserHost.exportPdf().then(() => true)`)
    const shopPath = await savedPath(path)
    const shop = text(shopPath)
    expect(shop.includes('SHOP-SENTINEL') && shop.includes('Lamp 9'), 'The shop page PDF is missing its content.')
    expect(!shop.includes('AD-SENTINEL'), 'The as-seen PDF still contains ads.')
    const note = await ctx.evaluate(`document.querySelector('.pdf-done .pdf-meta').textContent`)
    expect(/As seen/.test(note), `The shop page was not saved as seen: ${note}`)
    const live = await ctx.page('/shop')
    const restored = await live.evaluate(`getComputedStyle(document.getElementById('div-gpt-ad-1')).display !== 'none' && !document.getElementById('div-gpt-ad-1').getAttribute('style')`)
    expect(restored === true, 'Saving as seen left the live page changed.')
    return `Article: ${pages} pages, ${images} images, tagged with outline, ads/hidden/overlay text left out, bookmarked in "Reading" with the PDF linked; shop page saved as seen without ads.`
  } finally {
    server.close()
  }
}

/**
 * Browser keys pressed inside a page (the page has keyboard focus): ⌘W closes the tab for real,
 * ⌘⇧T reopens it, ⌘= zooms and the zoom is kept for the site, ⌘1/⌘9 pick tabs.
 */
async function browserKeys(ctx) {
  const server = await new Promise((resolve) => {
    const site = createServer((request, response) => {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      const name = request.url?.includes('second') ? 'Second' : 'First'
      response.end(`<!doctype html><title>${name} page</title><h1>${name}</h1><p>${'Words to read. '.repeat(200)}</p>`)
    })
    site.listen(0, '127.0.0.1', () => resolve(site))
  })
  const port = server.address().port
  // Two hosts, so each has its own zoom.
  const first = `http://localhost:${port}/first`
  const second = `http://127.0.0.1:${port}/second`
  const tabs = async () => JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => JSON.stringify(t.map((x) => ({ id: x.id, url: x.url, active: x.active }))))`))
  const state = async () => JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getState().then((s) => JSON.stringify(s))`))
  /** A key chord typed while the page has focus (through the browser's key handling, as from the keyboard). */
  const chord = async (urlPart, keyCode, modifiers = ['meta']) => {
    expect(await ctx.keyInPage(urlPart, keyCode, modifiers), `No page at ${urlPart} to type into.`)
  }
  try {
    await openPage(ctx, first, 2000)
    await openPage(ctx, second, 2000)
    let open = await tabs()
    expect(open.length === 2 && open[1].active && open[1].url.includes('/second'), `Two pages did not open as two tabs: ${JSON.stringify(open)}`)

    // ⌘W with the page focused closes its tab and shows the one that is left.
    await chord('/second', 'W')
    await ctx.delay(1200)
    open = await tabs()
    let panel = await state()
    expect(open.length === 1 && open[0].url.includes('/first'), `⌘W in a page did not close its tab (tabs: ${JSON.stringify(open)}).`)
    expect(panel.isVisible && panel.url.includes('/first'), `After ⌘W the remaining tab is not shown (showing ${panel.isVisible ? panel.url : 'the globe'}).`)
    const closed = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getClosedTabs().then((t) => JSON.stringify(t))`))
    expect(closed[0]?.url.includes('/second'), 'The closed tab is not in Recently Closed.')

    // ⌘⇧T brings it back.
    await chord('/first', 'T', ['meta', 'shift'])
    await ctx.delay(2000)
    open = await tabs()
    panel = await state()
    expect(open.length === 2 && open.some((tab) => tab.url.includes('/second')), `⌘⇧T did not reopen the closed tab (tabs: ${JSON.stringify(open)}).`)
    expect(panel.url.includes('/second'), 'The reopened tab is not the one shown.')
    await ctx.wait(`window.intoponet.browserHost.getTabs().then((t) => t.some((tab) => tab.active && !tab.loading))`, 10_000, 'the reopened tab to finish loading')

    // ⌘= zooms the page; the toolbar shows the zoom and it is kept for the site.
    await chord('/second', '=')
    await ctx.delay(800)
    panel = await state()
    expect(Math.abs((panel.zoomFactor ?? 1) - 1.1) < 0.01, `⌘= in a page did not zoom it (zoom ${panel.zoomFactor}).`)
    await ctx.wait(`(document.querySelector('.zoom-indicator')?.innerText ?? '').includes('110%')`, 5000, 'the 110% zoom indicator in the toolbar')
    await ctx.delay(800)
    const saved = JSON.parse(readFileSync(join(ctx.profile, 'site-zoom.json'), 'utf8'))
    expect(saved.sites?.['127.0.0.1'] === 1.1, `The site zoom was not saved: ${JSON.stringify(saved)}`)

    // Closed and opened again: the site comes back at its zoom.
    await chord('/second', 'W')
    await ctx.delay(1000)
    await openPage(ctx, second, 2000)
    panel = await state()
    expect(Math.abs((panel.zoomFactor ?? 1) - 1.1) < 0.01, `A site opened again lost its zoom (zoom ${panel.zoomFactor}).`)
    expect(await ctx.click('.zoom-indicator'), 'The zoom indicator cannot be clicked.')
    await ctx.delay(600)
    panel = await state()
    expect(Math.abs((panel.zoomFactor ?? 1) - 1) < 0.01 && !(await ctx.evaluate(`!!document.querySelector('.zoom-indicator')`)), 'Clicking the zoom indicator did not reset the page to 100%.')

    // ⌘1 and ⌘9 pick the first and last tabs.
    await chord('/second', '1')
    await ctx.delay(600)
    expect((await state()).url.includes('/first'), '⌘1 did not show the first tab.')
    await chord('/first', '9')
    await ctx.delay(600)
    expect((await state()).url.includes('/second'), '⌘9 did not show the last tab.')

    // ⌘W on the last tabs: the globe once none are left.
    await chord('/second', 'W')
    await ctx.delay(800)
    await chord('/first', 'W')
    await ctx.delay(1000)
    open = await tabs()
    panel = await state()
    expect(open.length === 0 && !panel.isVisible, `Closing the last tab did not return to the globe (${open.length} tabs left).`)
    return '⌘W closed tabs from inside the page, ⌘⇧T reopened one, ⌘= zoom shown and kept for the site, ⌘1/⌘9 picked tabs'
  } finally {
    server.close()
  }
}

/** A tiny site on this Mac: two titled pages and a file served slowly as an attachment. */
const DOWNLOAD_BYTES = 640 * 1024
const startDownloadSite = () => new Promise((resolve) => {
  const server = createServer((request, response) => {
    const path = request.url?.split('?')[0] ?? '/'
    if (path === '/file.bin') {
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(DOWNLOAD_BYTES), 'content-disposition': 'attachment; filename="intoponet-e2e.bin"' })
      // 20 chunks over ~3 s, so progress is visible before it completes.
      let sent = 0
      const chunk = Buffer.alloc(DOWNLOAD_BYTES / 20, 7)
      const timer = setInterval(() => {
        response.write(chunk)
        sent += chunk.length
        if (sent >= DOWNLOAD_BYTES) { clearInterval(timer); response.end() }
      }, 150)
      request.on('close', () => clearInterval(timer))
      return
    }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    const title = { '/alpha': 'Alpha history page', '/beta': 'Beta history page', '/gamma': 'Gamma private page' }[path] ?? 'Download test'
    response.end(`<!doctype html><title>${title}</title><h1>${title}</h1><a id="get" href="/file.bin">Download</a>`)
  })
  server.listen(0, 'localhost', () => resolve(server))
})
/** A tiny site on this Mac for the browsing checks: links to other apps, a PDF, a colour-scheme probe. */
const TEST_PDF = Buffer.from('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0OSA+PgpzdHJlYW0KQlQgL0YxIDI0IFRmIDQwIDEwMCBUZCAoSW50b3BvbmV0IFBERiB0ZXN0KSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDM0MCAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQxMAolJUVPRgo=', 'base64')
const startBrowsingSite = (port = 0) => new Promise((resolve, reject) => {
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/doc.pdf')) { response.setHeader('content-type', 'application/pdf'); response.end(TEST_PDF); return }
    if (request.url?.startsWith('/attach.pdf')) {
      response.setHeader('content-type', 'application/pdf')
      response.setHeader('content-disposition', 'attachment; filename="intoponet-e2e-attachment.pdf"')
      response.end(TEST_PDF)
      return
    }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(`<!doctype html><title>Browsing test</title><meta name="color-scheme" content="light dark">
<p><a id="mail" href="mailto:someone@example.com?subject=Hello">Write to us</a> · <a id="pdf" href="/doc.pdf">Read the PDF</a></p>
<p id="scheme"></p><script>const s = document.getElementById('scheme'); const q = matchMedia('(prefers-color-scheme: dark)'); const set = () => { s.textContent = q.matches ? 'dark' : 'light' }; set(); q.addEventListener('change', set)</script>`)
  })
  server.once('error', reject)
  server.listen(port, '127.0.0.1', () => resolve(server))
})
/** An https site on this Mac with a self-signed certificate (null when openssl is unavailable). */
const selfSignedSite = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'intoponet-e2e-cert-'))
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=Intoponet E2E', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' })
    const server = createHttpsServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (_request, response) => { response.end('<!doctype html><title>Insecure</title>') })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    return { server }
  } catch {
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
const panelState = (ctx) => ctx.evaluate(`window.intoponet.browserHost.getState().then((s) => JSON.stringify(s))`).then(JSON.parse)

/** Fails the check on any WCAG 2.2 AA violation axe finds in the app window right now. */
async function axeAudit(ctx, where, selector = null) {
  if (!(await ctx.evaluate(`typeof axe !== 'undefined'`))) await ctx.evaluate(`${readFileSync(join(repo, 'node_modules/axe-core/axe.min.js'), 'utf8')}; true`)
  const raw = JSON.parse(await ctx.evaluate(`axe.run(${selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document'}, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] }).then((r) => JSON.stringify(r.violations.map((v) => v.id + ' ×' + v.nodes.length + ' (' + v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join('; ') + ')')))`))
  expect(raw.length === 0, `WCAG violations on ${where}: ${raw.join(', ')}`)
}

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
    // Highlights open on World (story cards); signal rows are under Peaks.
    expect(await ctx.click('.globe-tabs button', 'Peaks'), 'Highlights tab "Peaks" is missing.')
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
    await axeAudit(ctx, 'the World stories')
    // Open the first story with at least three sources.
    const rows = await ctx.evaluate(`document.querySelectorAll('.world-list .world-row').length`)
    // The chevron, set apart from the headline, shows the sources without opening the article.
    const urlBefore = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getState().then((s) => JSON.stringify(s.isVisible ? s.url : null))`))
    let opened = false
    for (let i = 0; i < Math.min(rows, 8) && !opened; i += 1) {
      await ctx.evaluate(`(() => { document.querySelectorAll('.world-list .world-expand')[${i}].click(); return true })()`)
      await ctx.delay(400)
      opened = await ctx.evaluate(`!!document.querySelector('.world-sources-button')`)
    }
    expect(opened, 'No world story has three or more sources to show.')
    const urlAfter = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getState().then((s) => JSON.stringify(s.isVisible ? s.url : null))`))
    expect(urlAfter === urlBefore, `Expanding a story with its chevron opened ${urlAfter}.`)
    const chevron = JSON.parse(await ctx.evaluate(`JSON.stringify((() => { const r = document.querySelector('.world-expand').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] })())`))
    expect(chevron[0] >= 32 && chevron[1] >= 32, `The chevron's target is only ${chevron.join('×')} px.`)
    await ctx.delay(1500)
    await ctx.click('.world-sources-button')
    await ctx.delay(160)
    await ctx.shot('launching')
    await ctx.wait(`document.querySelectorAll('.sc-card').length >= 3`, 5_000, 'the carousel cards')
    // Outlets' own pictures and bylines arrive as each article's preview is read.
    await ctx.wait(`document.querySelectorAll('.sc-card .sc-media img').length >= 1`, 25_000, 'an article image on the cards')
    await ctx.delay(2500)
    const enriched = JSON.parse(await ctx.evaluate(`JSON.stringify({ images: document.querySelectorAll('.sc-card .sc-media img').length, bylines: [...document.querySelectorAll('.sc-card .sc-authors')].length, summaries: document.querySelectorAll('.sc-card .sc-summary').length })`))
    await ctx.shot('carousel')
    await axeAudit(ctx, 'the sources carousel')
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
    return `Cards with ${enriched.images} images, ${enriched.bylines} bylines, ${enriched.summaries} summaries. Carousel flipped from ${first} to ${second}; chose "${chosen.slice(0, 80)}" and the browser opened ${state.url} (page was ${state0.isVisible ? 'open' : 'closed'} before).`
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
  async OMNIBOX(ctx) {
    const server = await new Promise((resolve) => {
      const site = createServer((_request, response) => { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end('<!doctype html><title>Omnibox landing</title><h1>Omnibox landing</h1>') })
      site.listen(0, 'localhost', () => resolve(site))
    })
    try {
      const host = `localhost:${server.address().port}`
      const url = `http://${host}/`
      const state = () => ctx.evaluate(`window.intoponet.browserHost.getState().then((s) => JSON.stringify(s))`).then(JSON.parse)
      const tabs = () => ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => JSON.stringify(t.map((x) => x.url)))`).then(JSON.parse)
      const read = () => ctx.evaluate(`JSON.stringify((() => { const i = document.querySelector('.command-input input'); return { value: i.value, selected: i.value.slice(i.selectionStart, i.selectionEnd), expanded: i.getAttribute('aria-expanded'), active: i.getAttribute('aria-activedescendant'), rows: [...document.querySelectorAll('#omnibox-suggestions [role=option]')].map((r) => ({ id: r.id, kind: r.dataset.kind, text: r.innerText.replace(/\\s+/g, ' '), selected: r.getAttribute('aria-selected') })) } })())`).then(JSON.parse)
      const typeHost = async (text) => {
        await ctx.evaluate(`(() => { const i = document.querySelector('.command-input input'); i.focus(); i.select(); return true })()`)
        await ctx.type(text)
        await ctx.delay(600)
        return read()
      }
      const enter = async (modifiers = 0) => {
        await ctx.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers, text: '\r' })
        await ctx.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers })
        await ctx.delay(2000)
      }
      // Visit the page, then close its tab: it is only in history now.
      await openPage(ctx, url, 2500)
      for (const id of JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => JSON.stringify(t.map((x) => x.id)))`))) await ctx.evaluate(`window.intoponet.browserHost.closeTab(${JSON.stringify(id)}).then(() => true)`)
      await ctx.delay(1200)
      expect((await tabs()).length === 0, 'The test tab did not close.')

      let seen = await typeHost('localh')
      expect(seen.value === host && seen.selected === host.slice('localh'.length), `Typing "localh" showed "${seen.value}" (selected "${seen.selected}"), not the inline completion "${host}".`)
      expect(seen.expanded === 'true' && seen.active === seen.rows[0]?.id && seen.rows[0]?.selected === 'true', `The suggestion list is not exposed to assistive tech (expanded ${seen.expanded}, active ${seen.active}).`)
      expect(seen.rows[0]?.kind === 'history' && seen.rows[0].text.includes(host), `The visited page is not the top suggestion: ${seen.rows.map((r) => `${r.kind}: ${r.text}`).join(' | ')}`)
      expect(seen.rows.some((r) => r.kind === 'search'), 'No "Search for" row.')
      await ctx.shot('completion')
      await axeAudit(ctx, 'the address bar suggestions')
      // ⌘↵: a background tab; the globe stays in front.
      await enter(4)
      let after = await state()
      let open = await tabs()
      expect(open.length === 1 && open[0].startsWith(url), `⌘↵ did not open the page in one new tab (tabs: ${open.join(', ') || 'none'}).`)
      expect(!after.isVisible, '⌘↵ brought the page to the front instead of opening it behind.')

      // Now it is an open tab: offered as "Switch to tab". Backspace removes the completion.
      seen = await typeHost('localh')
      expect(seen.rows[0]?.kind === 'tab' && /Switch to tab/.test(seen.rows[0].text), `The open tab is not offered first: ${seen.rows.map((r) => `${r.kind}: ${r.text}`).join(' | ')}`)
      for (const type of ['keyDown', 'keyUp']) await ctx.send('Input.dispatchKeyEvent', { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
      await ctx.delay(400)
      const erased = await read()
      expect(erased.value === 'localh', `Backspace left "${erased.value}" instead of removing the completion.`)
      expect(erased.rows[0]?.kind === 'search', `After Backspace the first row is ${erased.rows[0]?.kind}, not what was typed.`)
      seen = await typeHost('localho')
      expect(seen.value === host, `Typing on did not complete again ("${seen.value}").`)
      await enter()
      after = await state()
      open = await tabs()
      expect(after.isVisible && after.url.startsWith(url), `Enter did not land on ${url} (showing ${after.isVisible ? after.url : 'the globe'}).`)
      expect(open.length === 1, `Switching to the tab opened a duplicate (${open.length} tabs).`)

      // A place name still flies the globe, over the open page.
      await ctx.flyTo('Fredericton')
      await ctx.wait(`document.querySelector('h1')?.innerText === 'Fredericton'`, 15_000, 'the globe to fly to Fredericton')
      expect(!(await state()).isVisible, 'Flying to a place left the page open.')
      return `"localh" completed to ${host}; history row opened in a background tab with ⌘↵; then "Switch to tab" landed on it (1 tab); Backspace removed the completion; "Fredericton" flew the globe.`
    } finally {
      server.close()
    }
  },

  async BROWSE(ctx) {
    const host = await openAnyPage(ctx)
    const tabs = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => JSON.stringify(t))`))
    expect(tabs.length === 1 && tabs[0].url.includes(host), 'Opening a page did not create its tab.')
    const labels = await ctx.evaluate(`[...document.querySelectorAll('.browser-actions .chrome-label')].map((l) => l.textContent)`)
    for (const name of ['Translate', 'Capture', 'Pin', 'Absorb', 'Bookmarks']) expect(labels.some((l) => l.includes(name)), `Toolbar is missing "${name}".`)
    // Pages see plain Chrome: some sites call "Electron" an outdated browser.
    const ua = await (await ctx.page(host)).evaluate(`navigator.userAgent`)
    expect(/Chrome\//.test(ua) && !/Electron|Intoponet/i.test(ua), `Pages see the user agent "${ua}".`)
    await ctx.evaluate(`window.intoponet.browserHost.closeTab(${JSON.stringify(tabs[0].id)}).then(() => true)`)
    await ctx.delay(1500)
    // Main process still answers (closing tabs used to crash it).
    const after = await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => t.length)`)
    expect(after === 0, 'The tab did not close.')
    // A page that closes itself (window.close()) takes its tab with it, and the app keeps answering.
    const closer = await new Promise((resolve) => {
      const server = createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><title>Closes itself</title><p>bye') })
      server.listen(0, 'localhost', () => resolve(server))
    })
    try {
      const closerUrl = `http://localhost:${closer.address().port}/`
      await openPage(ctx, closerUrl, 2500)
      void (await ctx.page(`localhost:${closer.address().port}`)).evaluate('(() => { window.close(); return true })()').catch(() => undefined)
      await ctx.delay(2000)
      const left = await Promise.race([ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => t.length)`), ctx.delay(5000).then(() => 'no answer')])
      expect(left === 0, `After a page closed itself the app ${left === 'no answer' ? 'stopped answering' : `still lists ${left} tab(s)`}.`)
    } finally {
      closer.close()
    }
    const keys = await browserKeys(ctx)
    // The app window never leaves the app: a page loaded in its place would get the app's whole API.
    const appUrl = await ctx.evaluate('location.href')
    await ctx.evaluate(`(() => { location.href = 'https://example.com/'; return true })()`).catch(() => undefined)
    await ctx.delay(2500)
    const stayed = await ctx.evaluate(`location.href === ${JSON.stringify(appUrl)} && !!document.querySelector('.topbar')`).catch(() => false)
    expect(stayed, 'The app window navigated away from the app.')
    return `Toolbar: ${labels.join(', ')}; pages see ${ua.match(/Chrome\/\S+/)?.[0]}; tab closed cleanly; a self-closing page took its tab; ${keys}; the app window stayed on the app.`
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
    // A page opening a tab on its own (no click) is blocked, and the bar offers to open it.
    await page.evaluate(`(() => { window.open('https://example.org/', '_blank'); return true })()`)
    await ctx.wait(`(document.querySelector('.permission-bar')?.innerText ?? '').includes('Pop-up blocked')`, 10_000, 'the "Pop-up blocked" bar after a window.open without a click')
    let tabs = await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => t.map((x) => x.url).join(' '))`)
    expect(!/example\.org/.test(tabs), 'A window.open without a click opened a tab.')
    expect(await ctx.click('.permission-bar button', 'Allow once'), 'The pop-up bar has no "Allow once" button.')
    await ctx.wait(`window.intoponet.browserHost.getTabs().then((t) => t.some((x) => /example\.org/.test(x.url)))`, 10_000, 'the blocked pop-up to open after "Allow once"')
    await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => t.find((x) => !/example\.org/.test(x.url))).then((t) => t && window.intoponet.browserHost.activateTab(t.id)).then(() => true)`)
    await ctx.delay(1000)
    // A real click in the page (not a scripted one) lets it open a sign-in window and a new tab.
    const clickPage = async (session) => {
      for (const type of ['mousePressed', 'mouseReleased']) await session.send('Input.dispatchMouseEvent', { type, x: 20, y: 20, button: 'left', clickCount: 1 })
    }
    await page.evaluate(`(() => { addEventListener('click', () => { window.__signin = window.open('https://www.wikipedia.org/', 'signin', 'width=480,height=600'); window.__ok = !!window.__signin && window.__signin.opener === window }, { once: true }); return true })()`)
    await clickPage(page)
    await ctx.delay(500)
    // Read when it opened: the site may cut the opener later (Cross-Origin-Opener-Policy).
    const opened = await page.evaluate(`window.__ok === true`)
    expect(opened, 'A sign-in style popup opened from a click was blocked or lost its opener.')
    await page.evaluate(`(() => { const a = document.createElement('a'); a.href = 'https://www.iana.org/'; a.target = '_blank'; document.body.append(a); addEventListener('click', () => a.click(), { once: true }); return true })()`)
    await clickPage(page)
    await ctx.delay(2500)
    tabs = await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => t.map((x) => x.url).join(' '))`)
    expect(/iana\.org/.test(tabs), 'A target=_blank link clicked by the person did not open as a tab.')
    return 'Location allowed via the bar; a pop-up without a click was blocked and opened with "Allow once"; a clicked popup kept its opener; a clicked _blank link opened a tab.'
  },

  async EXTERNAL_APPS(ctx) {
    const site = await startBrowsingSite()
    const origin = `http://127.0.0.1:${site.address().port}`
    try {
      await openPage(ctx, `${origin}/`, 2500)
      const page = await ctx.page(`127.0.0.1:${site.address().port}`)
      await page.evaluate(`(() => { document.getElementById('mail').click(); return true })()`, { userGesture: true })
      await ctx.wait(`!!document.querySelector('.external-open-bar')`, 10_000, 'the "Open …?" prompt after clicking a mailto: link')
      const prompt = await ctx.evaluate(`document.querySelector('.external-open-bar').innerText`)
      expect(/^Open /.test(prompt) && prompt.includes('mailto:someone@example.com'), `The prompt does not say what opens: "${prompt}"`)
      expect(/Cancel/.test(prompt) && /Always allow/.test(prompt), `The prompt lacks Cancel or "Always allow": "${prompt}"`)
      const state = await panelState(ctx)
      expect(state.url === `${origin}/` && !state.loadError, `A mailto: link navigated the tab (now ${state.url}).`)
      expect(await ctx.click('.external-open-bar button', 'Cancel'), 'The prompt has no Cancel button.')
      await ctx.wait(`!document.querySelector('.external-open-bar')`, 5_000, 'the prompt to go after Cancel')
      // Cancelled: nothing opens, and an immediate second click does not bring the prompt straight back (no prompt storms).
      await page.evaluate(`(() => { document.getElementById('mail').click(); document.getElementById('mail').click(); return true })()`, { userGesture: true })
      await ctx.delay(1200)
      const again = await ctx.evaluate(`document.querySelectorAll('.external-open-bar').length`)
      expect(again === 0, 'The prompt came straight back after Cancel.')
      // Scripts and local files are never handed to another app.
      await page.evaluate(`(() => { location.href = 'file:///etc/hosts'; return true })()`).catch(() => undefined)
      await ctx.delay(1000)
      expect(!(await ctx.evaluate(`!!document.querySelector('.external-open-bar')`)) && (await panelState(ctx)).url === `${origin}/`, 'A page could navigate to or offer to open a local file.')
      return `"${prompt.split('\n')[0]}" asked for a mailto: link; the tab stayed on ${origin}/; Cancel closed it and no prompt storm followed.`
    } finally {
      site.close()
    }
  },

  async ERROR_PAGE(ctx) {
    // A port with nothing listening (then a server starts on it, for Retry).
    const probe = createServer()
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
    const port = probe.address().port
    await new Promise((resolve) => probe.close(resolve))
    const url = `http://127.0.0.1:${port}/`
    await ctx.evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: ${JSON.stringify(url)} }).then(() => true, () => true)`)
    await ctx.wait(`!!document.querySelector('.load-error-page')`, 15_000, 'the error page for a site that is not answering')
    const text = await ctx.evaluate(`document.querySelector('.load-error-page').innerText`)
    expect(/refused to connect/.test(text) && /ERR_CONNECTION_REFUSED/.test(text), `The error page does not explain the failure: "${text}"`)
    expect(await ctx.evaluate(`[...document.querySelectorAll('.load-error-page button')].some((b) => b.innerText.includes('Retry'))`), 'The error page has no Retry button.')
    const toolbar = await ctx.evaluate(`document.querySelector('.origin-badge')?.getAttribute('title') ?? ''`)
    expect(toolbar === url, `The toolbar shows "${toolbar}" instead of the address that failed (${url}).`)
    const banner = await ctx.evaluate(`[...document.querySelectorAll('[role=alert]')].map((e) => e.innerText).join(' ')`)
    expect(!/ERR_CONNECTION_REFUSED/.test(banner), `A raw error banner showed as well: "${banner}"`)
    await ctx.shot('error-page')
    const site = await startBrowsingSite(port)
    try {
      expect(await ctx.click('.load-error-page button', 'Retry'), 'Retry could not be pressed.')
      await ctx.wait(`window.intoponet.browserHost.getState().then((s) => !s.loadError && s.title === 'Browsing test')`, 15_000, 'Retry to load the page once the site answers')
      expect(!(await ctx.evaluate(`!!document.querySelector('.load-error-page')`)), 'The error page stayed after a successful retry.')
      // Back to the error entry and forward again behave like normal history.
      const state = await panelState(ctx)
      expect(state.url === url, `After Retry the tab is at ${state.url}.`)
    } finally {
      site.close()
    }
    // A certificate nobody vouches for: "Connection not secure", with the certificate's details.
    const certificate = await selfSignedSite()
    if (!certificate) return `"${text.split('\n')[0]}" with Retry; toolbar kept ${url}; Retry loaded the page once a server listened (openssl missing: certificate page not checked).`
    try {
      const secureUrl = `https://127.0.0.1:${certificate.server.address().port}/`
      await ctx.evaluate(`window.intoponet.browserHost.navigate(${JSON.stringify(secureUrl)}).then(() => true, () => true)`)
      await ctx.wait(`(document.querySelector('.load-error-page')?.innerText ?? '').includes('Connection not secure')`, 15_000, 'the "Connection not secure" page for a self-signed certificate')
      const secure = await ctx.evaluate(`document.querySelector('.load-error-page').innerText`)
      expect(/ERR_CERT_/.test(secure) && /Issued by/.test(secure) && secure.includes('Intoponet E2E'), `The certificate page lacks the code or certificate details: "${secure}"`)
      expect(await ctx.evaluate(`window.intoponet.browserHost.getState().then((s) => s.url)`) === secureUrl, 'The toolbar lost the address of the insecure site.')
      expect(await ctx.click('.load-error-page button', 'Back'), 'The certificate error page has no Back button.')
      await ctx.wait(`window.intoponet.browserHost.getState().then((s) => s.url === ${JSON.stringify(url)} && !s.loadError)`, 10_000, 'Back to return to the previous page')
      await ctx.shot('certificate')
      return `"${text.split('\n')[0]}" with Retry; toolbar kept ${url}; Retry loaded the page once a server listened; a self-signed site showed "${secure.split('\n')[0]}" with its certificate and Back returned.`
    } finally {
      certificate.server.close()
    }
  },

  async PDF_VIEWER(ctx) {
    const site = await startBrowsingSite()
    const origin = `http://127.0.0.1:${site.address().port}`
    try {
      await openPage(ctx, `${origin}/`, 2000)
      await ctx.evaluate(`(() => { window.__downloads = []; window.intoponet.browserHost.subscribe((e) => { if (e.type === 'download-finished') window.__downloads.push(e) }); return true })()`)
      const page = await ctx.page(`127.0.0.1:${site.address().port}`)
      await page.evaluate(`(() => { document.getElementById('pdf').click(); return true })()`, { userGesture: true })
      await ctx.wait(`window.intoponet.browserHost.getState().then((s) => s.url.endsWith('/doc.pdf') && !s.isLoading)`, 15_000, 'the PDF to open in the tab')
      await ctx.delay(1500)
      const targets = (await (await fetch(`http://127.0.0.1:${ctx.port}/json/list`)).json()).map((t) => t.url)
      expect(targets.some((u) => u.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')), `Chromium's PDF viewer did not open (targets: ${targets.join(', ')}).`)
      expect((await ctx.evaluate(`window.__downloads.length`)) === 0, 'The PDF link downloaded instead of opening.')
      await ctx.pageShot(await ctx.page('doc.pdf'), 'pdf')
      // A PDF sent as an attachment still downloads.
      await ctx.evaluate(`window.intoponet.browserHost.navigate(${JSON.stringify(`${origin}/attach.pdf`)}).then(() => true, () => true)`)
      await ctx.wait(`window.__downloads.length > 0`, 15_000, 'the attachment PDF to download')
      const download = JSON.parse(await ctx.evaluate(`JSON.stringify(window.__downloads[0])`))
      if (download.path && /intoponet-e2e-attachment/.test(download.path)) {
        try { rmSync(download.path, { force: true }) } catch { /* left in Downloads */ }
      }
      expect(download.state === 'completed' && /intoponet-e2e-attachment/.test(download.filename), `The attachment PDF did not download (${JSON.stringify(download)}).`)
      return `doc.pdf opened in the tab in Chromium's viewer; the attachment downloaded as ${download.filename}.`
    } finally {
      site.close()
    }
  },

  async PAGE_APPEARANCE(ctx) {
    const site = await startBrowsingSite()
    const host = `127.0.0.1:${site.address().port}`
    try {
      const initial = JSON.parse(await ctx.evaluate(`window.intoponet.browsing.settings().then((s) => JSON.stringify(s))`))
      expect(initial.pageAppearance === 'system', `Pages do not follow the system appearance by default (${initial.pageAppearance}).`)
      await openPage(ctx, `http://${host}/`, 2000)
      const page = await ctx.page(host)
      const scheme = () => page.evaluate(`matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'`)
      // Match system: the page sees what the app window (which follows macOS) sees.
      const system = await ctx.evaluate(`matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'`)
      expect((await scheme()) === system, `With "Match system" the page sees ${await scheme()} but macOS is ${system}.`)
      const seen = []
      for (const choice of ['dark', 'light', 'system']) {
        await ctx.evaluate(`window.intoponet.browsing.setPageAppearance('${choice}').then(() => true)`)
        await ctx.delay(700)
        const want = choice === 'system' ? system : choice
        expect((await scheme()) === want, `With "${choice}" the page sees ${await scheme()}.`)
        // A new page load keeps it.
        await page.evaluate(`(() => { location.reload(); return true })()`)
        await ctx.delay(1500)
        expect((await page.evaluate(`document.getElementById('scheme')?.textContent`)) === want, `After a reload with "${choice}" the page renders ${want === 'dark' ? 'light' : 'dark'}.`)
        seen.push(`${choice}→${want}`)
      }
      await openPanel(ctx, 'Settings')
      const text = await ctx.evaluate(`document.querySelector('.settings-pane')?.innerText ?? ''`)
      for (const piece of ['Match system', 'Light', 'Dark', 'default browser']) expect(text.includes(piece), `Settings is missing "${piece}".`)
      return `Pages: ${seen.join(', ')} (system is ${system}); Settings shows the choice and default-browser status.`
    } finally {
      site.close()
    }
  },

  async PRIVATE_BROWSING(ctx) {
    await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(true).then(() => true)`)
    await openAnyPage(ctx)
    const tab = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => JSON.stringify(t[0] ?? null))`))
    expect(tab?.isPrivate === true, 'A tab opened in private mode is not private.')
    const recents = await ctx.evaluate(`window.intoponet.browserHost.readPrivateLibrary().then((r) => r.status === 'ok' && r.payload ? JSON.parse(r.payload).recents.length : 0)`)
    expect(recents === 0, 'A private visit was kept in recent pages.')
    // Nothing about the private page reaches the profile's files (open tabs, site icons).
    await ctx.delay(3500)
    for (const file of ['browser-state.v1.json', 'favicons.json']) {
      const path = join(ctx.profile, file)
      const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
      expect(!text.includes(new URL(tab.url).hostname), `${file} records the private page (${new URL(tab.url).hostname}).`)
    }
    const off = JSON.parse(await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(false).then((s) => JSON.stringify(s))`))
    await ctx.delay(1000)
    const left = await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => t.length)`)
    expect(!off.privateMode && left === 0, 'Turning private browsing off left private tabs open.')
    return 'Private tab marked, no footprints, closed when private mode ended.'
  },

  async TABS(ctx) {
    // Pages on this Mac: plain ones, a slow one (for the spinner) and one to play a tone in.
    const server = await new Promise((resolve) => {
      const site = createServer((request, response) => {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        const path = request.url ?? '/'
        if (path.startsWith('/slow')) { setTimeout(() => response.end('<!doctype html><title>Slow page</title><p>slow'), 6000); return }
        response.end(`<!doctype html><title>Page ${path.slice(1)}</title><p>${path}`)
      })
      site.listen(0, 'localhost', () => resolve(site))
    })
    const base = `http://localhost:${server.address().port}`
    const host = 'window.intoponet.browserHost'
    const tabs = async () => JSON.parse(await ctx.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
    const order = async () => (await tabs()).map((tab) => tab.id).join(' ')
    const domOrder = () => ctx.evaluate(`[...document.querySelectorAll('[role="tablist"] [data-tab-id]')].map((e) => e.dataset.tabId).join(' ')`)
    const key = async (key, code, modifiers) => {
      for (const type of ['rawKeyDown', 'keyUp']) await ctx.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code, modifiers })
    }
    try {
      for (const name of ['one', 'two', 'three']) await openPage(ctx, `${base}/${name}`, 1200)
      const opened = await tabs()
      expect(opened.length === 3, `Opening three pages made ${opened.length} tab(s).`)
      const [one, two, three] = opened.map((tab) => tab.id)

      // Move a tab (the main-process order is what the rail and strip show, and what is saved).
      await ctx.evaluate(`${host}.moveTab(${JSON.stringify(three)}, 0).then(() => true)`)
      await ctx.delay(500)
      expect(await order() === [three, one, two].join(' '), 'Moving the third tab to the front did not reorder the tabs.')
      expect(await domOrder() === [three, one, two].join(' '), 'The tab list on screen does not show the new order.')

      // Drag with the pointer in the rail: "one" above "three".
      const boxes = JSON.parse(await ctx.evaluate(`JSON.stringify([...document.querySelectorAll('.tab-rail-list [data-tab-id] [role="tab"]')].map((e) => e.getBoundingClientRect()))`))
      expect(boxes.length === 3, 'The tab rail is not showing the three tabs.')
      const from = { x: boxes[1].x + boxes[1].width / 2, y: boxes[1].y + boxes[1].height / 2 }
      await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y })
      await ctx.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 })
      for (let step = 1; step <= 8; step += 1) {
        await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y - (from.y - boxes[0].y - 4) * (step / 8), button: 'left', buttons: 1 })
        await ctx.delay(30)
      }
      await ctx.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from.x, y: boxes[0].y + 4, button: 'left', buttons: 0, clickCount: 1 })
      await ctx.delay(700)
      expect(await order() === [one, three, two].join(' '), `Dragging a tab in the rail did not move it (order: ${await order()}).`)

      // Keyboard: ⌥⇧↓ on the focused tab moves it down and keeps focus on it.
      await ctx.evaluate(`document.querySelector('.tab-rail-list [data-tab-id=${JSON.stringify(one)}] [role="tab"]').focus()`)
      await key('ArrowDown', 40, 1 | 8)
      await ctx.delay(700)
      expect(await order() === [three, one, two].join(' '), `⌥⇧↓ did not move the focused tab (order: ${await order()}).`)
      const focused = await ctx.evaluate(`document.activeElement?.closest('[data-tab-id]')?.dataset.tabId ?? ''`)
      expect(focused === one, 'The moved tab lost keyboard focus.')

      // Pin: it goes first, shows as an icon, and is saved for next launch.
      await ctx.evaluate(`${host}.setTabPinned(${JSON.stringify(two)}, true).then(() => true)`)
      await ctx.delay(800)
      const pinned = await tabs()
      expect(pinned[0]?.id === two && pinned[0]?.pinned === true, 'A pinned tab did not move to the front.')
      expect(await ctx.evaluate(`!!document.querySelector('.tab-rail-pinned [data-tab-id=${JSON.stringify(two)}]')`), 'The rail does not show the pinned tab among the pinned icons.')
      const saved = JSON.parse(readFileSync(join(ctx.profile, 'browser-state.v1.json'), 'utf8'))
      expect(saved.tabs?.[0]?.pinned === true && saved.tabs[0].url.includes('/two'), 'The pinned tab is not saved as pinned for the next launch.')
      await axeAudit(ctx, 'the tab rail with a pinned tab', '.tab-rail')

      // The strip under the launcher (page closed): pinned tab first, icon only, no close button.
      await ctx.evaluate(`${host}.close().then(() => true)`)
      await ctx.wait(`document.querySelectorAll('.page-tabs [data-tab-id]').length === 3`, 10_000, 'the tab strip')
      const strip = JSON.parse(await ctx.evaluate(`(() => { const p = document.querySelector('.page-tab.is-pinned'); return JSON.stringify({ first: document.querySelector('.page-tabs [data-tab-id]')?.dataset.tabId, close: !!p?.querySelector('.page-tab-close'), caption: !!p?.querySelector('.page-tab-main span') }) })()`))
      expect(strip.first === two && !strip.close && !strip.caption, `The strip does not show the pinned tab first as an icon (${JSON.stringify(strip)}).`)
      await axeAudit(ctx, 'the tab strip with a pinned tab', '.page-tab-row')
      await ctx.evaluate(`document.querySelector('.page-tabs [data-tab-id=${JSON.stringify(one)}] [role="tab"]').focus()`)
      await key('ArrowLeft', 37, 1 | 8)
      await ctx.delay(700)
      expect(await order() === [two, one, three].join(' '), `⌥⇧← in the strip did not move the focused tab (order: ${await order()}).`)
      await ctx.evaluate(`${host}.restore().then(() => true)`)
      await ctx.delay(800)

      // Sound: the speaker appears on a playing tab, and clicking it mutes and unmutes.
      await openPage(ctx, `${base}/tone`, 1500)
      const tonePage = await ctx.page(`${base}/tone`)
      await tonePage.evaluate(`(() => { const c = new AudioContext(); const o = c.createOscillator(); const g = c.createGain(); g.gain.value = 0.03; o.connect(g).connect(c.destination); o.start(); window.__tone = c; return c.resume().then(() => c.state) })()`, { userGesture: true })
      await ctx.wait(`${host}.getTabs().then((t) => t.some((x) => x.url.includes('/tone') && x.audible))`, 15_000, 'the playing tab to be marked audible')
      await ctx.wait(`(document.querySelector('.tab-rail-audio')?.getAttribute('aria-label') ?? '').startsWith('Mute')`, 5_000, 'a "Mute" speaker button on the playing tab')
      await ctx.click('.tab-rail-audio')
      await ctx.wait(`${host}.getTabs().then((t) => t.some((x) => x.url.includes('/tone') && x.muted))`, 5_000, 'the tab to mute')
      await ctx.wait(`(document.querySelector('.tab-rail-audio')?.getAttribute('aria-label') ?? '').startsWith('Unmute')`, 5_000, 'the speaker button to offer "Unmute"')
      await ctx.click('.tab-rail-audio')
      await ctx.wait(`${host}.getTabs().then((t) => t.some((x) => x.url.includes('/tone') && !x.muted))`, 5_000, 'the tab to unmute')
      await tonePage.evaluate(`window.__tone.close().then(() => true)`).catch(() => undefined)

      // Loading: a slow page shows a spinner in place of its icon, then its page.
      await ctx.evaluate(`(${host}.open({ kind: 'url', value: ${JSON.stringify(`${base}/slow`)} }).catch(() => undefined), true)`)
      await ctx.wait(`!!document.querySelector('[data-tab-id] .tab-spinner') && !!document.querySelector('[role="tab"][aria-busy="true"]')`, 5_000, 'a spinner on the loading tab')
      const loading = await ctx.evaluate(`${host}.getTabs().then((t) => t.some((x) => x.url.includes('/slow') && x.loading))`)
      expect(loading, 'The loading tab is not marked as loading.')
      await ctx.wait(`!document.querySelector('[data-tab-id] .tab-spinner')`, 20_000, 'the spinner to stop once the page loaded')
      return 'Moved by command, drag and ⌥⇧↓ (focus kept); pinned tab first, icon-only and saved; speaker muted and unmuted a playing tab; spinner while a slow page loaded; no axe violations in rail or strip.'
    } finally {
      server.close()
    }
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

      // Back to the sign-in page: one saved account is filled on its own: the username at once,
      // the password only at the reader's first real click or key (page scripts cannot read it before).
      await ctx.evaluate(`window.intoponet.browserHost.navigate(${JSON.stringify(login)}).then(() => true)`)
      await ctx.delay(1500)
      const reload = await ctx.page(`${site}/login`)
      let fields = []
      for (let i = 0; i < 20; i += 1) {
        fields = await pageFields(reload)
        if (fields[0]) break
        await ctx.delay(300)
      }
      expect(fields[0] === 'tester@example.com' && fields[1] === '', `Before any input, expected the username only (got ${JSON.stringify(fields.map((f) => (f ? f.length : f)))}).`)
      // A script's fake click does not release the password.
      await reload.evaluate(`(() => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' })); return true })()`)
      await ctx.delay(300)
      expect((await pageFields(reload))[1] === '', 'A page script released the saved password.')
      // A real click does.
      await reload.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 5, y: 5, button: 'left', clickCount: 1 })
      await reload.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: 5, button: 'left', clickCount: 1 })
      await ctx.delay(300)
      fields = await pageFields(reload)
      expect(fields[0] === 'tester@example.com' && fields[1] === password, `The saved sign-in was not filled after a click (got ${JSON.stringify(fields.map((f) => (f ? f.length : f)))}).`)
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
      return `Failed sign-in not offered; offered, saved, bookmarked in Accounts (sealed file, no plaintext), filled one account (password only after a real click; a script click did not release it), asked between two, listed in Settings; private tab untouched (${site}).`
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

  PDF_EXPORT: pdfExport,

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

  async DOWNLOADS_HISTORY(ctx) {
    const server = await startDownloadSite()
    const base = `http://localhost:${server.address().port}`
    try {
      await openPage(ctx, `${base}/alpha`, 2000)
      await openPage(ctx, `${base}/beta`, 2000)
      // A link click in the page (a real gesture) starts the download.
      const page = await ctx.page(`${base}/beta`)
      const box = JSON.parse(await page.evaluate(`JSON.stringify(document.querySelector('#get').getBoundingClientRect())`))
      for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: box.x + 5, y: box.y + 5, button: 'left', clickCount: 1 })
      await ctx.wait(`!!document.querySelector('.downloads-toggle')`, 15_000, 'the Downloads button in the toolbar')
      await ctx.click('.downloads-toggle')
      await ctx.wait(`!!document.querySelector('#downloads-pane .download-row[data-download-state="progressing"] progress')`, 10_000, 'a progress bar while the file downloads')
      const ring = await ctx.evaluate(`!!document.querySelector('.downloads-toggle .downloads-ring svg')`)
      expect(ring, 'The Downloads button shows no progress ring while a download is running.')
      await ctx.shot('downloading')
      await axeAudit(ctx, 'the Downloads list', '#downloads-pane')
      await ctx.wait(`!!document.querySelector('#downloads-pane .download-row[data-download-state="completed"]')`, 30_000, 'the download to finish')
      const row = await ctx.evaluate(`document.querySelector('#downloads-pane .download-row').innerText`)
      expect(/intoponet-e2e\.bin/.test(row), `The finished download is listed as "${row}".`)
      const actions = await ctx.evaluate(`[...document.querySelectorAll('#downloads-pane .download-row button')].map((b) => b.getAttribute('aria-label')).join(' | ')`)
      expect(/Show intoponet-e2e\.bin in Finder/.test(actions) && /Open intoponet-e2e\.bin/.test(actions), `A finished download cannot be opened or shown in Finder (${actions}).`)
      const file = join(ctx.profile, 'Downloads', 'intoponet-e2e.bin')
      expect(existsSync(file) && statSync(file).size === DOWNLOAD_BYTES, `The downloaded file is missing or incomplete at ${file}.`)
      let quarantine = ''
      // The flag is set just after the file completes.
      for (let i = 0; i < 20 && !quarantine; i += 1) {
        try { quarantine = execFileSync('/usr/bin/xattr', ['-p', 'com.apple.quarantine', file], { encoding: 'utf8' }).trim() } catch { await ctx.delay(250) }
      }
      expect(quarantine, 'The downloaded file has no com.apple.quarantine flag (Gatekeeper would not check it).')
      await ctx.press('Escape')
      await ctx.delay(500)
      const focus = await ctx.evaluate(`document.activeElement?.classList.contains('downloads-toggle') ?? false`)
      expect(focus, 'Closing the Downloads list with Escape did not return focus to its button.')

      // A private tab's visit is never kept.
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(true).then(() => true)`)
      await openPage(ctx, `${base}/gamma`, 2000)
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(false).then(() => true)`)
      await ctx.delay(800)

      // History: opened from the library drawer, searched, one visit deleted.
      await openPanel(ctx, 'My map')
      expect(await ctx.click('.library-tools button', 'History'), 'The library drawer has no History button.')
      await ctx.wait(`!!document.querySelector('.history-pane')`, 5_000, 'the History view')
      await ctx.wait(`document.querySelectorAll('.history-visit').length >= 2`, 10_000, 'visited pages in History')
      const today = await ctx.evaluate(`document.querySelector('.history-day h3')?.innerText ?? ''`)
      expect(today === 'Today', `History's first group is "${today}", expected "Today".`)
      await axeAudit(ctx, 'History', '.history-pane')
      await ctx.evaluate(`(() => { const i = document.querySelector('.history-search input'); i.focus(); return true })()`)
      await ctx.type('Beta history')
      await ctx.wait(`document.querySelectorAll('.history-visit').length === 1 && document.querySelector('.history-visit').innerText.includes('Beta history page')`, 5_000, 'History search to find the Beta page only')
      await ctx.shot('history')
      const gamma = await ctx.evaluate(`window.intoponet.history.search('Gamma').then((r) => r.total)`)
      expect(gamma === 0, 'A page visited in a private tab was kept in History.')
      expect(await ctx.click('.history-visit button', 'Remove Beta history page from history'), 'History visits have no delete button.')
      await ctx.wait(`document.querySelectorAll('.history-visit').length === 0`, 5_000, 'the deleted visit to leave the results')
      const left = await ctx.evaluate(`window.intoponet.history.search('').then((r) => r.days.flatMap((d) => d.visits.map((v) => v.title)).join(' | '))`)
      expect(!left.includes('Beta history page') && left.includes('Alpha history page'), `After deleting, History holds: ${left}`)
      await ctx.click('.history-head button', 'Clear browsing data')
      await ctx.wait(`!!document.querySelector('.clear-data select')`, 3_000, 'the Clear browsing data choices')
      await axeAudit(ctx, 'Clear browsing data', '.history-pane')
      await ctx.press('Escape')
      await ctx.press('Escape')
      await ctx.delay(400)
      expect(!(await ctx.evaluate(`!!document.querySelector('.history-pane')`)), 'Escape did not close History.')
      return `Downloaded ${DOWNLOAD_BYTES / 1024} KB with progress → done; on disk with quarantine "${quarantine}"; History found and deleted a visit; private visit not kept.`
    } finally {
      server.close()
    }
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
    // A fresh profile, nothing switched on: automatic translation is the default.
    await openPanel(ctx, 'Settings')
    const defaults = await ctx.evaluate(`[...document.querySelectorAll('.settings-pane input[type=checkbox]')].slice(0, 2).map((box) => box.checked)`)
    expect(defaults.length === 2 && defaults.every(Boolean), `Automatic translation is not on by default (${JSON.stringify(defaults)}).`)
    await ctx.click('[aria-label="Close settings"]')
    const before = JSON.parse(await ctx.evaluate(`window.intoponet.translate.status().then((s) => JSON.stringify(s.languages.find((l) => l.code === 'ru')))`))
    expect(before && !before.downloaded, 'Russian is already downloaded in a fresh profile.')
    // Open a Russian page and press nothing: it downloads Russian (quietly) and translates itself.
    await openPage(ctx, 'https://www.fontanka.ru/', 1000)
    await ctx.wait(`window.intoponet.translate.status().then((s) => s.downloading?.code === 'ru' || s.languages.find((l) => l.code === 'ru')?.downloaded)`, 180_000, 'Russian to start downloading by itself')
    await ctx.shot('downloading')
    await ctx.wait(`window.intoponet.translate.pageState().then((s) => s.status === 'translated' && s.from === 'ru' && s.to === 'en')`, 240_000, 'a Russian page to translate itself')
    expect(!(await ctx.evaluate(`!!document.querySelector('.translate-bar')`)), 'The translate bar opened: the page should translate without it.')
    await ctx.wait(`document.querySelector('.translate-toggle')?.innerText.includes('Translated')`, 10_000, 'the toolbar to say Translated')
    await ctx.shot('translated')
    const page = await ctx.page('fontanka.ru')
    const text = await page.evaluate(`document.body.innerText.slice(0, 4000)`)
    const cyrillic = (text.match(/[\u0400-\u04FF]/g) ?? []).length
    const latin = (text.match(/[A-Za-z]/g) ?? []).length
    expect(latin > cyrillic, `The page still reads as Russian (${cyrillic} Cyrillic vs ${latin} Latin letters).`)
    await ctx.pageShot(page, 'page')
    // Never translate this site: Original comes back, and the site stays untranslated.
    await ctx.click('.translate-toggle')
    await ctx.wait(`!!document.querySelector('.translate-bar')`, 5_000, 'the translate bar')
    expect(await ctx.click('.translate-bar button', 'Never translate this site'), 'No "Never translate this site" button.')
    await ctx.wait(`window.intoponet.translate.pageState().then((s) => s.status === 'idle')`, 10_000, 'the original page back')
    await ctx.shot('never-site')
    await openPage(ctx, 'https://www.fontanka.ru/', 8000)
    const state = JSON.parse(await ctx.evaluate(`window.intoponet.translate.pageState().then((s) => JSON.stringify(s))`))
    expect(state.status === 'idle', `A never-translate site was translated again (${state.status}).`)
    return `fontanka.ru translated from Russian with no clicks (Russian downloaded by itself; ${latin} Latin vs ${cyrillic} Cyrillic letters); "Never translate this site" sticks.`
  },

  async ROUGH_TRANSLATE(ctx) {
    await ctx.waitForNews()
    await ctx.flyTo('Faroe Islands')
    await ctx.delay(3000)
    await ctx.click('.globe-list .globe-row', 'Faroe')
    // Nothing to press: Icelandic downloads by itself and the Faroese headlines translate through it.
    await ctx.wait(`!!document.querySelector('.tr-headline-bar')`, 60_000, 'the headline translation bar for Faroese headlines')
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
    await ctx.delay(3000)
    const audit = (where) => axeAudit(ctx, where)
    await audit('the globe')
    // Highlights: signal rows (Peaks) and story cards (World).
    for (const tab of ['Peaks', 'World']) {
      if (await ctx.click('.globe-tabs button', tab)) {
        await ctx.delay(1500)
        await audit(`Highlights › ${tab}`)
      }
    }
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
    return 'No WCAG 2.2 AA violations (axe); panels open with Enter, close with Escape, focus returns.'
  },
}
