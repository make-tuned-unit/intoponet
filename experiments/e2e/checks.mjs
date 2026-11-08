// One end-to-end check per feature in docs/FEATURE_DAG.json. Each drives the
// real built app and fails with a plain sentence when its promise isn't kept.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer as createHttpsServer } from 'node:https'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { deflateSync as zlibSync } from 'node:zlib'
import { CheckFailure, expect, repo, runAppCheck } from './lib.mjs'

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

/** `seconds` of a quiet 440 Hz tone as a WAV file (a page with sound). */
const toneWav = (seconds) => {
  const rate = 22050
  const samples = Buffer.alloc(rate * seconds * 2)
  for (let i = 0; i < rate * seconds; i += 1) samples.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 4000), i * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + samples.length, 4); header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(samples.length, 40)
  return Buffer.concat([header, samples])
}

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
      if (request.url?.startsWith('/doc.pdf')) { response.setHeader('content-type', 'application/pdf'); response.end(TEST_PDF); return }
      // The whole article, then the response is held open: the page shows everything but never finishes loading.
      if (request.url?.startsWith('/still-loading')) {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        response.write(PDF_ARTICLE(sections))
        setTimeout(() => response.end(), 120_000).unref()
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
    await openPage(ctx, `${base}/shop`, 3500)
    // How the live page looks before saving (ad space may already be hidden by protection).
    const adState = `(() => { const ad = document.getElementById('div-gpt-ad-1'); return JSON.stringify([getComputedStyle(ad).display, ad.getAttribute('style') || '', document.body.innerText.length]) })()`
    const beforeSave = await (await ctx.page('/shop')).evaluate(adState)
    await ctx.evaluate(`window.intoponet.browserHost.exportPdf().then(() => true)`)
    const shopPath = await savedPath(path)
    const shop = text(shopPath)
    expect(shop.includes('SHOP-SENTINEL') && shop.includes('Lamp 9'), 'The shop page PDF is missing its content.')
    expect(!shop.includes('AD-SENTINEL'), 'The as-seen PDF still contains ads.')
    const note = await ctx.evaluate(`document.querySelector('.pdf-done .pdf-meta').textContent`)
    expect(/As seen/.test(note), `The shop page was not saved as seen: ${note}`)
    const live = await ctx.page('/shop')
    const afterSave = await live.evaluate(adState)
    expect(afterSave === beforeSave, `Saving as seen left the live page changed (${beforeSave} → ${afterSave}).`)

    // A private tab: asks where to save (the dialog is answered here), neutral name, no "Where from", no bookmark.
    const privatePath = join(ctx.profile, 'private-choice.pdf')
    await ctx.main(`(() => { const d = electron.dialog; d.__asked = null; d.showSaveDialog = async (_w, o) => { d.__asked = o.defaultPath; return { canceled: false, filePath: ${JSON.stringify(privatePath)} } }; return true })()`)
    await ctx.evaluate(`window.intoponet.browserHost.setPdfSettings({ mode: 'auto', paper: 'a4', textSize: 'medium', images: true, citation: true, groupId: 'pdfgroup' }).then(() => true)`)
    await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(true).then(() => true)`)
    await openPage(ctx, `${base}/article?private`, 2500)
    await ctx.evaluate(`window.intoponet.browserHost.exportPdf().then(() => true)`)
    const privateSaved = await savedPath(shopPath)
    const asked = await ctx.main(`electron.dialog.__asked`)
    expect(privateSaved === privatePath && existsSync(privatePath), `A private tab's PDF did not go where the person chose (${privateSaved}).`)
    expect(/Saved page \d{4}-\d{2}-\d{2}\.pdf$/.test(asked ?? ''), `A private tab suggested a revealing file name: ${asked}`)
    expect(text(privatePath).includes('START-SENTINEL'), 'The private PDF is missing the article.')
    let privateWhereFrom = ''
    try { privateWhereFrom = execFileSync('/usr/bin/xattr', ['-p', 'com.apple.metadata:kMDItemWhereFroms', privatePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { /* not set: right */ }
    expect(!privateWhereFrom, 'A private tab\'s PDF records where it came from in Finder.')
    await ctx.delay(1500)
    const after = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.readPrivateLibrary().then((r) => r.payload)`))
    expect(!after.bookmarks.some((item) => item.url.includes('?private')), 'A private page was bookmarked.')
    // A search made while browsing privately (checked below: its words never become a later bookmark's topic).
    await ctx.evaluate(`(() => { const i = document.querySelector('.command-input input'); i.focus(); i.select(); return true })()`)
    await ctx.type('quokka private errand')
    await ctx.delay(400)
    await ctx.press('Enter')
    await ctx.delay(1500)
    await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(false).then(() => true)`)
    // Every saved PDF is listed in Bookmarks › PDFs (newest first); never the private one.
    const listed = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.listSavedPdfs().then((list) => JSON.stringify(list))`))
    expect(listed.some((item) => item.path === path), `The saved article is not in the saved PDF list: ${JSON.stringify(listed.map((item) => item.path))}`)
    expect(!listed.some((item) => item.path === privatePath), 'The private tab\'s PDF is in the saved PDF list.')
    await ctx.evaluate(`(() => { if (!document.querySelector('.bm-surface')) (document.querySelector('button[data-panel="bookmarks"]') ?? document.querySelector('button[aria-label^="Show bookmarks"]'))?.click(); return true })()`)
    await ctx.wait(`!!document.querySelector('.bm-filter')`, 10_000, 'the Bookmarks pane')
    await ctx.evaluate(`(() => { [...document.querySelectorAll('.bm-filter button')].find((b) => b.textContent.trim() === 'PDFs')?.click(); return true })()`)
    await ctx.wait(`document.querySelectorAll('.bm-pdfs .bm-item').length > 0`, 10_000, 'Bookmarks › PDFs to list the saved PDFs')
    const forgetId = listed.find((item) => item.path === path).id
    await ctx.evaluate(`window.intoponet.browserHost.forgetSavedPdf(${JSON.stringify(forgetId)}).then(() => true)`)
    const afterForget = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.listSavedPdfs().then((list) => JSON.stringify(list))`))
    expect(!afterForget.some((item) => item.id === forgetId) && existsSync(path), 'Removing a PDF from the list did not work, or deleted the file.')

    // An error page has nothing to save: it says so, and no PDF is written or listed.
    const closedPort = await new Promise((resolve) => { const probe = createServer(); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)) }) })
    await ctx.evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'http://127.0.0.1:${closedPort}/gone' }).then(() => true, () => true)`)
    await ctx.wait(`window.intoponet.browserHost.getState().then((s) => !!s.loadError)`, 15_000, 'the error page')
    await ctx.evaluate(`window.intoponet.browserHost.exportPdf().then(() => true)`)
    await ctx.wait(`(document.querySelector('.pdf-failed')?.innerText ?? '').includes('did not load')`, 15_000, 'saving an error page as PDF to say there is nothing to save')
    const afterError = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.listSavedPdfs().then((list) => JSON.stringify(list))`))
    expect(afterError.length === afterForget.length, 'Saving an error page as PDF saved one anyway.')
    // A PDF tab: Save Page As keeps the PDF itself, not the viewer's wrapper page.
    const keptPdf = join(ctx.profile, 'kept-copy.pdf')
    await ctx.main(`(() => { const d = electron.dialog; d.__asked = null; d.showSaveDialog = async (_w, o) => { d.__asked = JSON.stringify([o.defaultPath, o.filters]); return { canceled: false, filePath: ${JSON.stringify(keptPdf)} } }; return true })()`)
    await openPage(ctx, `${base}/doc.pdf`, 3000)
    await ctx.evaluate(`window.intoponet.browserHost.savePage().then(() => true)`)
    for (let i = 0; i < 20 && !existsSync(keptPdf); i += 1) await ctx.delay(250)
    const keptAsked = JSON.parse(await ctx.main(`electron.dialog.__asked`) ?? '[]')
    expect(existsSync(keptPdf) && readFileSync(keptPdf).equals(TEST_PDF), `Save Page As on a PDF did not save the PDF itself (${existsSync(keptPdf) ? readFileSync(keptPdf).subarray(0, 40).toString('latin1') : 'no file'}).`)
    expect(/doc\.pdf$/.test(keptAsked[0] ?? '') && JSON.stringify(keptAsked[1]).includes('"pdf"'), `Save Page As on a PDF suggested ${JSON.stringify(keptAsked)}.`)
    // Save as PDF on a PDF tab names the file after the PDF (here its file name), not only the site and date.
    const beforePdfTab = await ctx.evaluate(`document.querySelector('.pdf-done .pdf-name')?.title ?? ''`)
    await ctx.evaluate(`window.intoponet.browserHost.exportPdf().then(() => true)`)
    await ctx.wait(`(() => { const done = document.querySelector('.pdf-done .pdf-name'); const failed = document.querySelector('.pdf-failed')?.innerText ?? ''; return (!!done && done.title !== ${JSON.stringify(beforePdfTab)}) || (!!failed && !failed.includes('did not load')) })()`, 90_000, 'the PDF tab to be saved as PDF')
    const pdfTabFailure = await ctx.evaluate(`document.querySelector('.pdf-failed')?.innerText ?? ''`)
    expect(!pdfTabFailure, `Save as PDF on a PDF tab failed: ${pdfTabFailure}`)
    const pdfTabPath = await ctx.evaluate(`document.querySelector('.pdf-done .pdf-name').title`)
    expect(/\/doc – 127\.0\.0\.1 – \d{4}-\d{2}-\d{2}\.pdf$/.test(pdfTabPath) && existsSync(pdfTabPath), `Save as PDF on a PDF tab was not named after the PDF: ${pdfTabPath}`)
    // Saved into a group after private browsing ended: the private search left nothing in its bookmark.
    await ctx.evaluate(`window.intoponet.browserHost.setPdfSettings({ mode: 'auto', paper: 'a4', textSize: 'medium', images: true, citation: true, groupId: 'pdfgroup' }).then(() => true)`)
    await openPage(ctx, `${base}/article?after-private`, 3000)
    await ctx.evaluate(`window.intoponet.browserHost.exportPdf().then(() => true)`)
    await savedPath(await ctx.evaluate(`document.querySelector('.pdf-done .pdf-name')?.title ?? ''`))
    await ctx.delay(1500)
    const later = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.readPrivateLibrary().then((r) => r.payload)`))
    const laterBookmark = later.bookmarks.find((item) => item.url.includes('?after-private'))
    expect(laterBookmark && !/quokka/i.test(JSON.stringify(laterBookmark)), `A search made in private browsing became part of a later bookmark: ${JSON.stringify(laterBookmark)}`)
    // A page still loading (this one never finishes) is saved as it is, not left waiting until "did not respond".
    void ctx.evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: '${base}/still-loading' }).then(() => true, () => true)`).catch(() => undefined)
    await ctx.wait(`window.intoponet.browserHost.getState().then((s) => s.url.endsWith('/still-loading') && s.isLoading)`, 15_000, 'the page that never finishes loading')
    await ctx.delay(1500)
    const beforeLoading = await ctx.evaluate(`document.querySelector('.pdf-done .pdf-name')?.title ?? ''`)
    await ctx.evaluate(`window.intoponet.browserHost.exportPdf().then(() => true)`)
    await ctx.wait(`(() => { const done = document.querySelector('.pdf-done .pdf-name'); return (!!done && done.title !== ${JSON.stringify(beforeLoading)}) || !!document.querySelector('.pdf-failed') })()`, 90_000, 'a page still loading to be saved as PDF')
    const loadingFailure = await ctx.evaluate(`document.querySelector('.pdf-failed')?.innerText ?? ''`)
    expect(!loadingFailure, `A page still loading could not be saved as PDF: ${loadingFailure}`)
    expect(text(await ctx.evaluate(`document.querySelector('.pdf-done .pdf-name').title`)).includes('START-SENTINEL'), 'The PDF of a page still loading is missing its article.')
    return `Article: ${pages} pages, ${images} images, tagged with outline, ads/hidden/overlay text left out, bookmarked in "Reading" with the PDF linked; shop page saved as seen without ads; private tab asked where, neutral name, no Where-from or bookmark; ${listed.length} PDFs in Bookmarks › PDFs (private one not listed), removing one keeps the file.`
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
    // A page that sets no background or colour scheme: it expects the browser's white canvas.
    if (request.url?.startsWith('/plain')) { response.end('<!doctype html><title>Plain page</title><p style="font: 40px serif">Plain black text</p>'); return }
    if (request.url?.startsWith('/darkpage')) { response.end('<!doctype html><title>Dark page</title><meta name="color-scheme" content="dark"><p>Dark by choice</p>'); return }
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
/**
 * Checks run side by side open their windows in the same place, so one can be covered by another. A covered shell is
 * hidden: its animation frames stop, a closing panel's exit never ends and the panel that should replace it never
 * mounts (a check then times out). The app catches up once shown; keep the shell drawing while covered instead.
 */
const keepDrawing = (ctx) => ctx.main(`(() => { electron.BrowserWindow.getAllWindows()[0]?.webContents.setBackgroundThrottling(false); return true })()`)

/** Fails the check on any WCAG 2.2 AA violation axe finds in the app window right now. */
async function axeAudit(ctx, where, selector = null) {
  if (!(await ctx.evaluate(`typeof axe !== 'undefined'`))) await ctx.evaluate(`${readFileSync(join(repo, 'node_modules/axe-core/axe.min.js'), 'utf8')}; true`)
  const raw = JSON.parse(await ctx.evaluate(`axe.run(${selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document'}, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] }).then((r) => JSON.stringify(r.violations.map((v) => v.id + ' ×' + v.nodes.length + ' (' + v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join('; ') + ')')))`))
  expect(raw.length === 0, `WCAG violations on ${where}: ${raw.join(', ')}`)
}

/** A local test site: every path answers with a page titled after its path, with a text field. */
async function tabSite(extra = '') {
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>Page ${path}</title><body style="font:16px system-ui;margin:40px;min-height:3000px"><h1>Page ${path}</h1><input id="field" aria-label="Field">${extra}</body>`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, origin: `http://127.0.0.1:${server.address().port}` }
}

// ---- Import from another browser: fixture profiles ---------------------------
// Built in a temporary folder the app is pointed at (BROWSER_IMPORT.env below); the real
// ~/Library of the person running the checks is never read.
const IMPORT_ROOT = join(tmpdir(), `intoponet-import-e2e-${process.pid}`)
const IMPORT_TEST_KEY = 'e2e-safe-storage-secret'
const IMPORT_PASSWORD = 'Imported-Pa55word!e2e'
const chromiumMicros = (ms) => (BigInt(Math.round(ms)) + 11_644_473_600_000n) * 1000n
async function buildImportFixtures(root) {
  const { DatabaseSync } = await import('node:sqlite')
  const { createCipheriv, pbkdf2Sync } = await import('node:crypto')
  rmSync(root, { recursive: true, force: true })
  const chrome = join(root, 'Google', 'Chrome')
  const profile = join(chrome, 'Default')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(chrome, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Person 1' } } } }))
  writeFileSync(join(profile, 'Bookmarks'), JSON.stringify({ version: 1, roots: {
    bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: [
      { type: 'url', name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Main_Page' },
      { type: 'folder', name: 'Travel', children: [
        { type: 'url', name: 'Fiji', url: 'https://en.wikipedia.org/wiki/Fiji' },
        { type: 'folder', name: 'Japan', children: [{ type: 'url', name: 'Kyoto', url: 'https://en.wikipedia.org/wiki/Kyoto' }] },
      ] },
    ] },
    other: { type: 'folder', name: 'Other bookmarks', children: [{ type: 'url', name: 'RNZ', url: 'https://www.rnz.co.nz/pacific' }] },
  } }))
  const history = new DatabaseSync(join(profile, 'History'))
  history.exec(`CREATE TABLE urls(id INTEGER PRIMARY KEY AUTOINCREMENT, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0 NOT NULL, typed_count INTEGER DEFAULT 0 NOT NULL, last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL);
    CREATE TABLE visits(id INTEGER PRIMARY KEY, url INTEGER NOT NULL, visit_time INTEGER NOT NULL, from_visit INTEGER, transition INTEGER DEFAULT 0 NOT NULL);`)
  for (const [index, path] of ['imported-one', 'imported-two'].entries()) {
    const at = Date.now() - (index + 1) * 3_600_000
    const { lastInsertRowid } = history.prepare('INSERT INTO urls(url, title, last_visit_time) VALUES (?, ?, ?)').run(`https://example.org/${path}`, `Imported ${index + 1}`, chromiumMicros(at))
    history.prepare('INSERT INTO visits(url, visit_time) VALUES (?, ?)').run(lastInsertRowid, chromiumMicros(at))
  }
  history.close()
  const key = pbkdf2Sync(IMPORT_TEST_KEY, 'saltysalt', 1003, 16, 'sha1')
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
  const sealed = Buffer.concat([Buffer.from('v10'), cipher.update(IMPORT_PASSWORD, 'utf8'), cipher.final()])
  const logins = new DatabaseSync(join(profile, 'Login Data'))
  logins.exec('CREATE TABLE logins(origin_url VARCHAR NOT NULL, action_url VARCHAR, username_value VARCHAR, password_value BLOB, signon_realm VARCHAR NOT NULL, blacklisted_by_user INTEGER NOT NULL DEFAULT 0)')
  logins.prepare('INSERT INTO logins(origin_url, username_value, password_value, signon_realm) VALUES (?, ?, ?, ?)').run('https://accounts.example.com/', 'tester@example.com', sealed, 'https://accounts.example.com/')
  logins.close()
  // Arc: two spaces with pinned tabs, a folder in one, and an open tab.
  const arcProfile = join(root, 'Arc', 'User Data', 'Default')
  mkdirSync(arcProfile, { recursive: true })
  writeFileSync(join(arcProfile, 'Bookmarks'), JSON.stringify({ version: 1, roots: { bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: [] } } }))
  const tab = (id, parentID, url, title) => [id, { id, parentID, childrenIds: [], title: null, data: { tab: { savedURL: url, savedTitle: title } } }]
  writeFileSync(join(root, 'Arc', 'StorableSidebar.json'), JSON.stringify({ sidebar: { containers: [{ global: {} }, {
    spaces: ['S1', { id: 'S1', title: 'Work', profile: { default: true }, newContainerIDs: [{ pinned: {} }, 'P1', { unpinned: {} }, 'U1'] }, 'S2', { id: 'S2', title: 'Home', profile: { default: true }, newContainerIDs: [{ pinned: {} }, 'P2', { unpinned: {} }, 'U2'] }],
    items: [
      'P1', { id: 'P1', parentID: null, childrenIds: ['T1', 'F1'], data: { itemContainer: {} } },
      ...tab('T1', 'P1', 'https://docs.example.com/', 'Docs'),
      'F1', { id: 'F1', parentID: 'P1', childrenIds: ['T2'], title: 'Reading', data: { list: {} } },
      ...tab('T2', 'F1', 'https://en.wikipedia.org/wiki/Tonga', 'Tonga'),
      'U1', { id: 'U1', parentID: null, childrenIds: ['T3'], data: { itemContainer: {} } },
      ...tab('T3', 'U1', 'https://news.example.com/today', 'Today'),
      'P2', { id: 'P2', parentID: null, childrenIds: ['T4'], data: { itemContainer: {} } },
      ...tab('T4', 'P2', 'https://recipes.example.com/', 'Recipes'),
      'U2', { id: 'U2', parentID: null, childrenIds: [], data: { itemContainer: {} } },
    ],
  }] } }))
}

// ---- Import a sidebar's spaces as workspaces: fixture sidebar files ---------------------------
// Built by hand from the structure community exporters publicly document; NOT copies of real files.
// The newer layout marks containers with objects and orders children with childrenIds; the older one
// uses plain strings, no childrenIds (list order), and carries fields the importer must ignore.
const IMPORT_WS_ROOT = join(tmpdir(), `intoponet-import-ws-e2e-${process.pid}`)
const sidebarItem = (id, parentID, url, title) => ({ id, parentID, childrenIds: [], title: null, data: { tab: { savedURL: url, savedTitle: title } } })
const NEWER_SIDEBAR = { sidebar: { containers: [{ global: {} }, {
  topAppsContainerIDs: [{ default: true }, 'TOP'],
  spaces: [
    'S1', { id: 'S1', title: 'Work', profile: { default: true }, newContainerIDs: [{ pinned: {} }, 'P1', { unpinned: { _0: { shared: {} } } }, 'U1'], customInfo: { windowTheme: { semanticColor: 'x' } } },
    'S2', { id: 'S2', title: 'Home', profile: { default: true }, newContainerIDs: [{ pinned: {} }, 'P2', { unpinned: {} }, 'U2'] },
  ],
  items: [
    'TOP', { id: 'TOP', parentID: null, childrenIds: ['FAV1', 'FAV2'], data: { itemContainer: { containerType: { topApps: { _0: { default: true } } } } } },
    'FAV1', sidebarItem('FAV1', 'TOP', 'https://mail.example.com/', 'Mail'),
    'FAV2', sidebarItem('FAV2', 'TOP', 'https://maps.example.com/', 'Maps'),
    'P1', { id: 'P1', parentID: null, childrenIds: ['T1', 'T2', 'F1'], data: { itemContainer: {} } },
    'T1', sidebarItem('T1', 'P1', 'https://docs.example.com/', 'Docs'),
    'T2', { ...sidebarItem('T2', 'P1', 'https://chat.example.com/team', 'Chat'), title: 'Team chat' },
    'F1', { id: 'F1', parentID: 'P1', childrenIds: ['T3', 'F2'], title: 'Reading', data: { list: {} } },
    'T3', sidebarItem('T3', 'F1', 'https://en.wikipedia.org/wiki/Tonga', 'Tonga'),
    'F2', { id: 'F2', parentID: 'F1', childrenIds: ['T4'], title: 'Later', data: { list: {} } },
    'T4', sidebarItem('T4', 'F2', 'https://en.wikipedia.org/wiki/Samoa', 'Samoa'),
    'U1', { id: 'U1', parentID: null, childrenIds: ['O1'], data: { itemContainer: {} } },
    'O1', sidebarItem('O1', 'U1', 'https://news.example.com/today', 'Today'),
    'P2', { id: 'P2', parentID: null, childrenIds: ['T5'], data: { itemContainer: {} } },
    'T5', sidebarItem('T5', 'P2', 'https://recipes.example.com/', 'Recipes'),
    'U2', { id: 'U2', parentID: null, childrenIds: ['O2'], data: { itemContainer: {} } },
    'O2', sidebarItem('O2', 'U2', 'https://weather.example.com/', 'Weather'),
  ],
}] } }
const OLDER_SIDEBAR = { version: 1, sidebar: { containers: [{ global: {} }, {
  topAppsContainerIDs: ['TOP'],
  spaces: [{ id: 'A', title: 'Travel', containerIDs: ['pinned', 'AP', 'unpinned', 'AU'], createdAt: 700000000 }],
  items: [
    { id: 'TOP', parentID: null, data: { itemContainer: {} } },
    { id: 'FAV', parentID: 'TOP', data: { tab: { savedURL: 'https://calendar.example.com/', savedTitle: 'Calendar' } }, isUnread: false },
    { id: 'AP', parentID: null, data: { itemContainer: {} } },
    { id: 'AT1', parentID: 'AP', data: { tab: { savedURL: 'https://flights.example.com/', savedTitle: 'Flights' } } },
    { id: 'AF1', parentID: 'AP', title: 'Japan', data: { list: { color: 3 } } },
    { id: 'AT2', parentID: 'AF1', data: { tab: { savedURL: 'https://en.wikipedia.org/wiki/Kyoto', savedTitle: 'Kyoto' } } },
    { id: 'AS1', parentID: 'AF1', data: { splitView: {} } },
    { id: 'AT3', parentID: 'AS1', data: { tab: { savedURL: 'https://en.wikipedia.org/wiki/Osaka', savedTitle: 'Osaka' } } },
    { id: 'AU', parentID: null, data: { itemContainer: {} } },
    { id: 'AO1', parentID: 'AU', data: { tab: { savedURL: 'https://hotels.example.com/', savedTitle: 'Hotels' }, someFutureField: 1 } },
  ],
}] } }
function buildSidebarFixture(root, sidebar) {
  const profile = join(root, 'Arc', 'User Data', 'Default')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'Bookmarks'), JSON.stringify({ version: 1, roots: { bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: [] } } }))
  writeFileSync(join(root, 'Arc', 'StorableSidebar.json'), typeof sidebar === 'string' ? sidebar : JSON.stringify(sidebar))
}

// ---- Separate sign-ins per workspace ------------------------------------------
/** A small site that sets a cookie on sign-in; `/` says who it thinks is signed in. Ads and a download are on it. */
const IDENTITY_LOGIN = `<!doctype html><title>Identity sign in</title><body style="font:16px system-ui;margin:40px"><h1>Sign in</h1><form method="post" action="/login"><label style="display:block;margin:12px 0">Username <input id="username" name="username" autocomplete="username" style="font:inherit;padding:6px"></label><label style="display:block;margin:12px 0">Password <input id="password" name="password" type="password" autocomplete="current-password" style="font:inherit;padding:6px"></label><button id="go" type="submit">Sign in</button></form></body>`
const startIdentitySite = () => new Promise((resolve) => {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    // Each connection a request came on (its port on this Mac): a session that was cleared must not reuse one.
    server.connections.add(request.socket.remotePort)
    const cookies = Object.fromEntries((request.headers.cookie ?? '').split('; ').filter(Boolean).map((pair) => pair.split('=')))
    if (url.pathname === '/file.bin') {
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '65536', 'content-disposition': 'attachment; filename="intoponet-e2e-identity.bin"' })
      response.end(Buffer.alloc(65536, 3))
      return
    }
    // A site's own sign-in box (HTTP authentication): what each request sent is kept for the check to read.
    if (url.pathname === '/auth') {
      const sent = request.headers.authorization ?? ''
      server.httpSignIns.push({ who: url.searchParams.get('who'), sent, connection: request.socket.remotePort })
      const ok = sent === `Basic ${Buffer.from('bob:Box-Pa55').toString('base64')}`
      response.writeHead(ok ? 200 : 401, { 'content-type': 'text/html', ...(ok ? {} : { 'www-authenticate': 'Basic realm="e2e"' }) })
      response.end(ok ? '<title>Box</title>Signed in to the box' : '<title>Box</title>Signed out of the box')
      return
    }
    if (url.pathname === '/login' && request.method === 'POST') {
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        const who = new URLSearchParams(body).get('username') ?? ''
        response.writeHead(303, { location: `/?who=${encodeURIComponent(who)}`, 'set-cookie': `sid=${encodeURIComponent(who)}; Path=/; Max-Age=86400; SameSite=Lax` })
        response.end()
      })
      return
    }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    if (url.pathname === '/login') { response.end(IDENTITY_LOGIN); return }
    const signedIn = cookies.sid ? `Signed in as ${decodeURIComponent(cookies.sid)}` : 'Signed out'
    response.end(`<!doctype html><title>Identity test</title><body style="font:16px system-ui;margin:40px"><h1>${signedIn}</h1><a id="get" href="/file.bin">Download the file</a><img src="https://securepubads.g.doubleclick.net/ad.png" width="300" height="250" alt="ad"></body>`)
  })
  server.httpSignIns = []
  server.connections = new Set()
  // Connections kept open as long as real servers keep them (Node closes idle ones after 5 s).
  server.keepAliveTimeout = 120_000
  server.listen(0, 'localhost', () => resolve(server))
})
/** Helpers for the sign-in check, bound to one app run (the check runs twice: before and after a relaunch). */
const identityHelpers = (ctx) => {
  const host = 'window.intoponet.browserHost'
  const ws = 'window.intoponet.workspaces'
  const stateOf = async () => JSON.parse(await ctx.evaluate(`${ws}.get().then((s) => JSON.stringify(s))`))
  const tabsOf = async () => JSON.parse(await ctx.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
  /** The text of the page whose address has `marker`, read in the main process (no page session needed). */
  const pageText = (marker) => ctx.main(`(async () => { const page = electron.webContents.getAllWebContents().find((w) => w.getURL().includes(${JSON.stringify(marker)})); return page ? page.executeJavaScript('document.body.innerText') : '' })()`)
  const waitPage = async (marker, text, ms = 20_000) => {
    const end = Date.now() + ms
    let last = ''
    while (Date.now() < end) {
      last = await pageText(marker).catch(() => '')
      if (String(last).includes(text)) return
      await ctx.delay(400)
    }
    throw new CheckFailure(`The page ${marker} did not show "${text}" (it shows "${String(last).replace(/\s+/g, ' ').slice(0, 80)}").`)
  }
  /** Shows the tab whose address has `marker`, in a workspace (switching to it first when needed). */
  const showIn = async (workspaceId, marker) => {
    if ((await stateOf()).activeId !== workspaceId) {
      await ctx.evaluate(`${ws}.switchTo({ id: ${JSON.stringify(workspaceId)} }).then(() => true)`)
      await ctx.delay(700)
    }
    const tab = (await tabsOf()).find((item) => item.url.includes(marker))
    expect(tab, `No tab in that workspace shows ${marker}.`)
    await ctx.evaluate(`${host}.activateTab(${JSON.stringify(tab.id)}).then(() => true)`)
    await ctx.delay(900)
    return tab
  }
  return { stateOf, tabsOf, pageText, waitPage, showIn }
}
/**
 * Session parity: every web page open right now (tabs, popups, quick windows, link previews, the
 * tour's page; private, shared or a workspace's own sign-ins) has the protections the shared session
 * has. It walks the live pages and their sessions, so a session or a kind of window added later is
 * covered without being named here. Returns what is missing, one sentence each (`problems`, none: []),
 * and how many pages and sessions it looked at.
 * `stubbed`: address parts of pages on screen, which must also have the tracker stand-ins.
 * Call it while no site's protection is paused (its ad request would then load).
 */
const pageSessionProblems = async (ctx, { stubbed = [] } = {}) => JSON.parse(await ctx.main(`(async () => {
  const problems = []
  const shared = electron.session.fromPartition('persist:intoponet-default')
  const within = (promise, ms = 2000) => Promise.race([promise.catch((error) => '(failed: ' + error + ')'), new Promise((resolve) => setTimeout(() => resolve('(no answer)'), ms))])
  // Web pages and local files in tabs; not the app's own page, its data: toolbars and cards, or DevTools.
  const pages = electron.webContents.getAllWebContents().filter((c) => !c.isDestroyed() && /^(https?|file):/.test(c.getURL()) && !/\\/renderer\\/index\\.html$/.test(new URL(c.getURL()).pathname))
  const firstOf = new Map()
  for (const c of pages) {
    const where = c.getURL().slice(0, 80)
    if (c.session === electron.session.defaultSession) { problems.push(where + " runs in the app's own session."); continue }
    if (c.getWebRTCIPHandlingPolicy() !== 'default_public_interface_only') problems.push(where + ': WebRTC may use any network route (' + c.getWebRTCIPHandlingPolicy() + ').')
    // A session without the permission handlers grants everything without asking.
    if (await within(c.executeJavaScript('Notification.permission')) === 'granted') problems.push(where + ': its session grants permissions without asking.')
    if (${JSON.stringify(stubbed)}.some((part) => c.getURL().includes(part))) {
      // Put in once the page's document is ready: a moment after it loads.
      let stub = ''
      for (let i = 0; i < 12 && stub !== 'function'; i += 1) {
        stub = await within(c.executeJavaScript('typeof window.gtag'))
        if (stub !== 'function') await new Promise((resolve) => setTimeout(resolve, 250))
      }
      if (stub !== 'function') problems.push(where + ': no stand-ins for blocked trackers (gtag is ' + stub + ').')
    }
    if (!firstOf.has(c.session)) firstOf.set(c.session, c)
  }
  for (const [s, c] of firstOf) {
    const where = 'The session of ' + c.getURL().slice(0, 80)
    if (!s.protocol.isProtocolHandled('file')) problems.push(where + ' lets file:// pages read any file.')
    if (s.listenerCount('will-download') === 0) problems.push(where + ' has no download handling (guards, quarantine, the list).')
    if (!s.isSpellCheckerEnabled()) problems.push(where + ' has no spell checking.')
    if (s.getUserAgent() !== shared.getUserAgent()) problems.push(where + ' sends another user agent: ' + s.getUserAgent())
    // Content blocking: a request to an ad server through this session is stopped before it leaves the Mac
    // (asked from here, not from the page, whose own Content-Security-Policy could refuse it first).
    const ad = await within(s.fetch('https://pagead2.googlesyndication.com/pagead/parity.gif', { cache: 'no-store' }).then(() => 'loaded'), 8000)
    if (!String(ad).includes('ERR_BLOCKED_BY_CLIENT')) problems.push(where + ' does not block ads (' + ad + ').')
  }
  return JSON.stringify({ problems, pages: pages.length, sessions: firstOf.size })
})()`))
/** Waits until no app process still holds this profile (after a quit). */
const waitForQuit = async (profile) => {
  for (let i = 0; i < 120; i += 1) {
    try {
      // `--` first: without it pgrep reads the pattern as an option, refuses it, and this returns at once.
      execFileSync('pgrep', ['-f', '--', `--user-data-dir=${profile}`], { stdio: 'ignore' })
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new CheckFailure('The app did not quit in time.')
}

/** Second run, on a copy of the profile after a quit: the option, Work's sign-in and permissions, and Main's sign-in are kept. */
const identityRelaunch = async (ctx, { workId, mainId, gone }) => {
  const { stateOf, showIn, waitPage } = identityHelpers(ctx)
  const ws = 'window.intoponet.workspaces'
  // Leftovers of workspaces that are gone are removed at startup (before anything opens Gone's partition again below); Work's stay.
  const leftovers = [join(ctx.profile, 'Partitions', `intoponet-ws-${gone}`), join(ctx.profile, 'Partitions', 'intoponet-ws-crashed-e2e'), join(ctx.profile, 'site-permissions.ws-crashed-e2e.json'), join(ctx.profile, 'external-apps.ws-crashed-e2e.json')]
  for (let i = 0; i < 40 && leftovers.some((path) => existsSync(path)); i += 1) await ctx.delay(250)
  expect(!leftovers.some((path) => existsSync(path)), `Sign-in data of deleted workspaces is still on disk after a relaunch: ${leftovers.filter((path) => existsSync(path)).map((path) => path.slice(ctx.profile.length + 1)).join(', ')}.`)
  expect(existsSync(join(ctx.profile, 'Partitions', `intoponet-ws-${workId}`)), "Work's own partition folder was removed at startup.")
  const state = await stateOf()
  expect(state.workspaces.find((item) => item.id === workId)?.separateSignIns === true, 'After a relaunch Work no longer has separate sign-ins.')
  const goneCookies = await ctx.main(`electron.session.fromPartition(${JSON.stringify(`persist:intoponet-ws-${gone}`)}).cookies.get({}).then((list) => list.length)`)
  expect(goneCookies === 0 && !state.workspaces.some((item) => item.id === gone), `A workspace deleted just before quitting still holds ${goneCookies} cookie(s) after a relaunch.`)
  const permissionsFile = join(ctx.profile, `site-permissions.ws-${workId}.json`)
  expect(existsSync(permissionsFile), "Work's permission answers were not kept across a relaunch.")
  await showIn(workId, 'who=dan')
  await waitPage('who=dan', 'Signed in as dan')
  await showIn(mainId, 'who=mhome')
  await waitPage('who=mhome', 'Signed in as ada')
  // Turning the option off deletes Work's cookies, its permission answers and its saved logins; Main keeps its own.
  await ctx.evaluate(`${ws}.update(${JSON.stringify(workId)}, { separateSignIns: false }).then(() => true)`)
  const cookies = await ctx.main(`electron.session.fromPartition(${JSON.stringify(`persist:intoponet-ws-${workId}`)}).cookies.get({}).then((list) => list.length)`)
  expect(cookies === 0, `Work still holds ${cookies} cookie(s) after its own sign-ins were turned off.`)
  expect(!existsSync(permissionsFile), "Work's permission answers are still on disk after its own sign-ins were turned off.")
  const logins = JSON.parse(await ctx.evaluate(`window.intoponet.passwords.list().then((l) => JSON.stringify(l))`))
  expect(!logins.some((login) => login.workspaceId === workId), "Work's saved passwords are still kept after its own sign-ins were turned off.")
  await waitPage('who=mhome', 'Signed in as ada')
  return 'Kept across a relaunch: the option, Work\'s sign-in and permissions, Main\'s sign-in. Turning the option off deleted Work\'s cookies, permissions and saved passwords, and Main stayed signed in.'
}

/**
 * APP_BOOT: the app's own window recovers. Its page crashing or hanging reloads it with the tabs, the pair and the
 * page area as they were, and nothing added in the main process (no page view, web contents or listener). Closed
 * with the red button, it comes back with its tabs from the Dock (also with a quick window open) and from a menu command.
 */
async function appWindowRecovers(ctx) {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>Boot ${request.url}</title><h1>${request.url}</h1>`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const appWindow = `electron.BrowserWindow.getAllWindows().find((w) => w.webContents?.getURL().includes('index.html'))`
  const shellNow = () => ctx.main(`(() => {
    const win = ${appWindow}
    if (!win) return 'null'
    const wc = win.webContents
    const counts = (emitter) => emitter.eventNames().map((name) => String(name) + ':' + emitter.listenerCount(name)).sort().join(' ')
    return JSON.stringify({
      crashed: wc.isCrashed(),
      loaded: globalThis.__shellLoaded === true,
      contents: electron.webContents.getAllWebContents().length,
      pages: win.contentView.children.filter((v) => v.webContents && /^https?:/.test(v.webContents.getURL())).map((v) => ({ url: v.webContents.getURL(), bounds: v.getBounds(), visible: v.getVisible() })).sort((a, b) => a.bounds.x - b.bounds.x),
      listeners: [wc, win, electron.app, electron.ipcMain].map(counts),
    })
  })()`).then(JSON.parse)
  /** The next load of the app window's page, finished (set before what reloads it). */
  const watchLoad = () => ctx.main(`(() => { globalThis.__shellLoaded = false; ${appWindow}.webContents.once('did-finish-load', () => { globalThis.__shellLoaded = true }); return true })()`)
  const until = async (label, test, ms = 20_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const value = await test().catch(() => null)
      if (value) return value
      await ctx.delay(250)
    }
    throw new CheckFailure(`Timed out waiting for ${label}.`)
  }
  // A shell still loading (or hung) never answers: each question gets 3 s.
  const ask = (shell, expression) => Promise.race([shell.evaluate(expression), new Promise((_, reject) => setTimeout(() => reject(new Error('no answer')), 3000))])
  const ready = (shell, label) => until(label, () => ask(shell, `!!document.querySelector('.topbar') && !!document.querySelector('.command-input input')`))
  const tabsOf = (shell) => ask(shell, `window.intoponet.browserHost.getTabs().then((t) => JSON.stringify(t.map((x) => [x.id, x.active, x.split?.side ?? null])))`)
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  try {
    await openPage(ctx, `http://127.0.0.1:${port}/left`, 1500)
    await ctx.evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'http://localhost:${port}/right' }, 'background-tab').then(() => true)`)
    await ctx.delay(800)
    await ctx.evaluate(`window.intoponet.browserHost.splitTab().then(() => true)`)
    await until('the pair on screen', async () => (await shellNow()).pages.filter((page) => page.visible).length === 2)
    // A tour's page (untracked): opened once first, so its session is set up before counting listeners.
    const openTourPage = () => ctx.evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'http://127.0.0.1:${port}/tour' }, 'background-tab', { untracked: true }).then(() => true)`)
    const tourTab = `window.intoponet.browserHost.getTabs().then((t) => t.find((x) => x.url.endsWith('/tour'))?.id ?? null)`
    await openTourPage()
    await ctx.evaluate(`${tourTab}.then((id) => id && window.intoponet.browserHost.closeTab(id)).then(() => true)`)
    await ctx.delay(800)
    const before = await shellNow()
    const tabsBefore = await tabsOf(ctx)
    // The split's rounding may move a side by a pixel; anything more is a page area out of step with the shell.
    const near = (a, b) => a.length === b.length && a.every((page, i) => page.url === b[i].url && page.visible === b[i].visible && ['x', 'y', 'width', 'height'].every((key) => Math.abs(page.bounds[key] - b[i].bounds[key]) <= 1))
    const kept = (label, after) => {
      expect(near(after.pages, before.pages), `${label}, the pages on screen changed: ${JSON.stringify(before.pages)} → ${JSON.stringify(after.pages)}.`)
      expect(after.contents === before.contents, `${label}, there are ${after.contents} web contents, not ${before.contents}.`)
      expect(same(after.listeners, before.listeners), `${label}, listeners were added or lost: ${JSON.stringify(before.listeners)} → ${JSON.stringify(after.listeners)}.`)
    }

    // Its page crashes while in full width and touring: it reloads at once, not in full width, with everything where
    // it was, and the tour's page closed with the tour.
    await openTourPage()
    expect(await ctx.evaluate(tourTab), 'The tour\'s page did not open.')
    await ctx.evaluate(`window.intoponet.browserHost.setFullWidth(true).then(() => true)`)
    // A panel covered the page when it crashed (Settings, say): the reloaded window has no panel open, so the pages show.
    await ctx.evaluate(`window.intoponet.captures.setPageHidden(true).then(() => true)`)
    await watchLoad()
    await ctx.main(`(() => { ${appWindow}.webContents.forcefullyCrashRenderer(); return true })()`)
    await until('the crashed app window to reload', async () => (await shellNow()).loaded, 15_000)
    await ready(ctx, 'the reloaded app window')
    await ctx.delay(1000)
    expect(await tabsOf(ctx) === tabsBefore, `After the app window crashed, its tabs are ${await tabsOf(ctx)}, not ${tabsBefore}.`)
    kept('After the app window crashed and reloaded', await shellNow())

    // Its page hangs: once the window reports it unresponsive, it is stopped and reloads.
    await watchLoad()
    await ctx.main(`(() => { const win = ${appWindow}; void win.webContents.executeJavaScript('setTimeout(() => { const end = Date.now() + 120000; while (Date.now() < end) {} }, 50); true'); setTimeout(() => win.emit('unresponsive'), 600); return true })()`)
    await until('the hung app window to reload', async () => (await shellNow()).loaded, 15_000)
    await ready(ctx, 'the app window reloaded after hanging')
    await ctx.delay(1000)
    expect(await tabsOf(ctx) === tabsBefore, `After the app window hung, its tabs are ${await tabsOf(ctx)}, not ${tabsBefore}.`)
    kept('After the app window hung and reloaded', await shellNow())

    // Closed with the red button while a quick window is open: the Dock icon brings it back, the pair in front.
    await ctx.main(`(() => { electron.Menu.getApplicationMenu().getMenuItemById('new-quick-window').click(); return true })()`)
    await until('a quick window', async () => (await ctx.main('electron.BrowserWindow.getAllWindows().length')) === 2)
    await ctx.main(`(() => { ${appWindow}.close(); return true })()`)
    await until('the app window to close', async () => (await shellNow()) === null)
    await ctx.main(`(() => { electron.app.emit('activate', {}, true); return true })()`)
    await until('the app window back from the Dock', async () => { const now = await shellNow(); return now?.pages.filter((page) => page.visible).length === 2 })
    let shell = await ctx.page('index.html')
    await ready(shell, 'the app window back from the Dock')
    expect(await tabsOf(shell) === tabsBefore, `Back from the Dock, the app window's tabs are ${await tabsOf(shell)}, not ${tabsBefore}.`)
    const reopened = await shellNow()
    expect(same(reopened.pages.map((page) => page.url), before.pages.map((page) => page.url)), `Back from the Dock, the pages in front are ${JSON.stringify(reopened.pages.map((page) => page.url))}.`)

    // Closed again, File › New Tab brings it back with the new tab in front.
    await ctx.main(`(() => { ${appWindow}.close(); return true })()`)
    await until('the app window to close again', async () => (await shellNow()) === null)
    await ctx.main(`(() => { electron.Menu.getApplicationMenu().getMenuItemById('new-tab').click(); return true })()`)
    await until('the app window back from File › New Tab', async () => (await shellNow()) !== null)
    shell = await ctx.page('index.html')
    await ready(shell, 'the app window back from File › New Tab')
    const tabsAfter = JSON.parse(await tabsOf(shell))
    expect(tabsAfter.length === JSON.parse(tabsBefore).length + 1 && tabsAfter.at(-1)[1] === true, `File › New Tab with the window closed left the tabs as ${JSON.stringify(tabsAfter)}.`)
    return `The app window reloaded after its page crashed and after it hung, with its tabs, pair and page area, no view or listener added and a running tour's page closed; closed, it came back with its tabs from the Dock (a quick window open) and from File › New Tab.`
  } finally {
    server.close()
  }
}

export const checks = {
  // ---- Foundations ---------------------------------------------------------
  async APP_BOOT(ctx) {
    await ctx.wait(`!!document.querySelector('.topbar') && !!document.querySelector('canvas')`, 30_000, 'the header and globe to render')
    const buttons = await ctx.evaluate(`[...document.querySelectorAll('.bookmark-library-button')].map((b) => (b.innerText || b.getAttribute('aria-label')).trim())`)
    for (const label of ['Private', 'Bookmarks', 'The Olds', 'Knowledge', 'My map', 'Settings']) expect(buttons.some((b) => b.includes(label)), `Header is missing "${label}". Found: ${buttons.join(', ')}`)
    // A profile with damaged files still opens, and what it could not read is kept aside, never saved over.
    const damagedProfile = mkdtempSync(join(tmpdir(), 'intoponet-e2e-damaged-'))
    const damaged = {
      'browser-state.v1.json': '{"version":3,"url":"https://example.org/","bounds":{"x":0,"y":0,"width":800,"height":600},"wasVisible":false,"tabs":[{"id":"t1","url":"https://exa',
      'site-permissions.json': '{"https://example.org":{"camera":"al',
      'excluded-sites.json': '["bank.example","clinic.exa',
      'personal/history.v1.seal': 'not a sealed history',
    }
    mkdirSync(join(damagedProfile, 'personal'))
    for (const [file, text] of Object.entries(damaged)) writeFileSync(join(damagedProfile, file), text)
    // Temporary files of saves an earlier run never finished (a crash, or a 0.1.22 quit) are deleted at startup.
    const leftovers = ['personal/history.v1.seal.0b3c1a2e-5f6d-4e7a-8b9c-0d1e2f3a4b5c.tmp', 'private-library.v1.seal.1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b.tmp']
    for (const file of leftovers) writeFileSync(join(damagedProfile, file), 'an old sealed copy')
    const keptProfile = process.env.E2E_PROFILE
    process.env.E2E_PROFILE = damagedProfile
    try {
      const keptFiles = (next) => next.main(`(() => { const fs = process.mainModule.require('fs'); const dir = ${JSON.stringify(damagedProfile)}; return JSON.stringify(Object.fromEntries(['', 'personal/'].flatMap((sub) => fs.readdirSync(dir + '/' + sub).map((n) => sub + n)).filter((n) => n.includes('.unreadable-')).map((n) => [n.replace(/\\.unreadable-\\d+$/, ''), fs.readFileSync(dir + '/' + n, 'utf8')]))) })()`).then(JSON.parse)
      const [kept, afterClear] = JSON.parse(await runAppCheck(async (next) => {
        await next.evaluate(`window.intoponet.browserHost.newTab().then(() => true)`)
        await next.delay(1500)
        const left = leftovers.filter((file) => existsSync(join(damagedProfile, file)))
        expect(!left.length, `Temporary files an earlier run left are still in the profile after startup: ${left.join(', ')}.`)
        const before = await keptFiles(next)
        // Clear browsing data also clears the history it kept aside.
        await next.evaluate(`window.intoponet.history.clearBrowsingData({ range: 'hour', history: true, siteData: false, cache: false, downloads: false }).then(() => true)`)
        return JSON.stringify([before, await keptFiles(next)])
      }, { timeoutMs: 60_000 }))
      for (const [file, text] of Object.entries(damaged)) expect(kept[file] === text, `A damaged ${file} was not kept aside when the app started over (kept: ${Object.keys(kept).join(', ') || 'nothing'}).`)
      expect(!afterClear['personal/history.v1.seal'], 'Clearing history left the copy of history the app had kept aside.')
    } finally {
      if (keptProfile === undefined) delete process.env.E2E_PROFILE
      else process.env.E2E_PROFILE = keptProfile
      rmSync(damagedProfile, { recursive: true, force: true })
    }
    const recovered = await appWindowRecovers(ctx)
    return `Header: ${buttons.join(' · ')}. A damaged profile opened, its unreadable files kept aside and an earlier run's unfinished temporary files deleted. ${recovered}`
  },

  async GLOBE_LIVE(ctx) {
    await keepDrawing(ctx)
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
    await keepDrawing(ctx)
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
    await ctx.evaluate(`(() => { const b = document.querySelector('.world-sources-button'); b.focus(); b.click(); return true })()`)
    await ctx.delay(160)
    await ctx.shot('launching')
    await ctx.wait(`document.querySelectorAll('.sc-card').length >= 3`, 5_000, 'the carousel cards')
    // Outlets' own pictures and bylines arrive as each article's preview is read.
    await ctx.wait(`document.querySelectorAll('.sc-card .sc-media img').length >= 1`, 25_000, 'an article image on the cards')
    await ctx.delay(2500)
    const enriched = JSON.parse(await ctx.evaluate(`JSON.stringify({ images: document.querySelectorAll('.sc-card .sc-media img').length, bylines: [...document.querySelectorAll('.sc-card .sc-authors')].length, summaries: document.querySelectorAll('.sc-card .sc-summary').length })`))
    await ctx.shot('carousel')
    await axeAudit(ctx, 'the sources carousel')
    // Each headline is laid out in its own direction (Arabic, Persian and Hebrew ones right to left, punctuation in place).
    const misdirected = JSON.parse(await ctx.evaluate(`JSON.stringify([...document.querySelectorAll('.sc-card .sc-headline, .sc-card .sc-original, .sc-card .sc-summary')].filter((el) => el.dir !== 'auto' || (/^[\\u0590-\\u08FF]/.test(el.textContent.trim()) && getComputedStyle(el).direction !== 'rtl')).map((el) => el.textContent.slice(0, 40)))`))
    expect(!misdirected.length, `These card texts are not laid out in their own direction: ${misdirected.join(' | ')}`)
    const state0 = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getState().then((s) => JSON.stringify(s))`))
    const first = await ctx.evaluate(`document.querySelector('.sc-card.is-front .sc-outlet strong').innerText`)
    await ctx.evaluate(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); return true })()`)
    await ctx.delay(700)
    const second = await ctx.evaluate(`document.querySelector('.sc-card.is-front .sc-outlet strong').innerText`)
    expect(first !== second || (await ctx.evaluate(`document.querySelectorAll('.sc-card').length`)) < 2, 'The arrow key did not flip to the next source.')
    await ctx.shot('flipped')
    // Escape closes Compare's chooser (focus back on Compare), then the carousel (focus back on the button that opened it).
    if (await ctx.evaluate(`!!document.querySelector('.sc-compare')`)) {
      await ctx.click('.sc-compare')
      await ctx.wait(`!!document.querySelector('.sc-chooser-item')`, 3000, 'the Compare chooser')
      await ctx.press('Escape')
      await ctx.wait(`!document.querySelector('.sc-chooser')`, 3000, 'Escape to close the Compare chooser')
      const onCompare = await ctx.wait(`!!document.activeElement?.classList.contains('sc-compare')`, 2000).then(() => true, () => false)
      expect(onCompare, 'Closing the Compare chooser left the keyboard focus nowhere.')
    }
    await ctx.press('Escape')
    await ctx.wait(`!document.querySelector('.sources-carousel')`, 5000, 'Escape to close the carousel')
    const onOpener = await ctx.wait(`!!document.activeElement?.classList.contains('world-sources-button')`, 2000).then(() => true, () => false)
    expect(onOpener, 'Closing the carousel left the keyboard focus nowhere.')
    await ctx.evaluate(`(() => { document.querySelector('.world-sources-button').click(); return true })()`)
    await ctx.wait(`document.querySelectorAll('.sc-card').length >= 3`, 5_000, 'the carousel to open again')
    await ctx.delay(1500)
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
    await keepDrawing(ctx)
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
    await keepDrawing(ctx)
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
    await keepDrawing(ctx)
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
    await keepDrawing(ctx)
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
    await keepDrawing(ctx)
    // Offline, an empty World list says it waits for a connection (checked while the first headlines are still on their way).
    let offline = 'news came before the offline check'
    if (await ctx.evaluate(`!!document.querySelector('.world-stories .globe-empty')`)) {
      await ctx.send('Network.enable')
      await ctx.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
      try {
        await ctx.delay(400)
        const text = await ctx.evaluate(`document.querySelector('.world-stories .globe-empty')?.textContent ?? null`)
        if (text !== null) {
          expect(text.startsWith('Waiting for a connection'), `Offline, the empty World list said: "${text}"`)
          offline = 'offline, the empty list waits for a connection'
        }
      } finally {
        await ctx.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
      }
      // Back online, it no longer says so (whether or not the stories have come yet).
      await ctx.wait(`!(document.querySelector('.world-stories .globe-empty')?.textContent ?? '').startsWith('Waiting for a connection')`, 5000, 'the World list to stop waiting for a connection once back online')
    }
    await ctx.waitForNews()
    await ctx.click('.globe-tabs button', 'World')
    await ctx.wait(`document.querySelectorAll('.world-list > li').length >= 5`, 90_000, 'at least five stories covered across the world')
    const scroll = JSON.parse(await ctx.evaluate(`(() => { const el = document.querySelector('.globe-panel .world-stories'); const before = el.scrollTop; el.scrollTop = 400; return JSON.stringify({ moved: el.scrollTop - before, overflow: el.scrollHeight > el.clientHeight }) })()`))
    expect(!scroll.overflow || scroll.moved > 0, 'The World list overflows but cannot be scrolled.')
    const stories = await ctx.evaluate(`document.querySelectorAll('.world-list > li').length`)
    return `${stories} world stories; scrolls ${scroll.moved}px; ${offline}.`
  },

  async STORY_MOUNTAINS(ctx) {
    await keepDrawing(ctx)
    await ctx.waitForNews()
    await ctx.wait(`window.intoponet.browserHost.getNewsDigest().then((raw) => (JSON.parse(raw).mountains ?? []).length >= 5)`, 120_000, 'story mountains in the news digest')
    const digest = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getNewsDigest()`))
    const heights = digest.mountains.map((m) => m.height)
    expect(heights.every((h, i) => i === 0 || heights[i - 1] >= h), `Story mountains are not ordered tallest first: ${JSON.stringify(digest.mountains.map((m, i) => [i, m.coverage, m.height]).filter(([i], _, all) => i > 0 && all[i - 1][2] < all[i][2]))}`)
    expect(digest.mountains.every((m) => m.height > 0 && m.height < 1 && m.outlets >= 2), 'A story mountain has an out-of-range height or fewer than two outlets.')
    await ctx.wait(`!!document.querySelector('.story-highest')`, 30_000, 'the highest-peak control')
    await ctx.click('.story-highest')
    await ctx.wait(`!!document.querySelector('.story-panel h2')`, 10_000, 'the pinned story panel')
    const panel = await ctx.evaluate(`document.querySelector('.story-panel h2').innerText`)
    const top = digest.mountains[0]
    expect(panel === (top.label ?? top.title), `The highest-peak control pinned "${panel}", not the tallest story "${top.label ?? top.title}".`)
    await ctx.delay(2500)
    await ctx.shot('story-mountains')
    await ctx.press('Escape')
    await ctx.wait(`!document.querySelector('.story-panel')`, 5_000, 'the story panel to close on Escape')
    // A pinned story that wears away (a digest without it) is unpinned: it does not come back pinned by itself when it rises again.
    await ctx.click('.story-highest')
    await ctx.wait(`!!document.querySelector('.story-panel h2')`, 10_000, 'the pinned story panel again')
    const pinnedLabel = await ctx.evaluate(`document.querySelector('.story-panel h2').innerText`)
    const raw = await ctx.evaluate(`window.intoponet.browserHost.getNewsDigest()`)
    const live = JSON.parse(raw)
    const pinned = live.mountains.find((m) => (m.label ?? m.title) === pinnedLabel)
    expect(pinned, `The pinned story "${pinnedLabel}" is not in the digest.`)
    const sendDigest = (payload) => ctx.main(`(() => { electron.BrowserWindow.getAllWindows()[0].webContents.send('browser-host:event', { type: 'news-digest', payload: ${JSON.stringify(payload)} }); return true })()`)
    await sendDigest(JSON.stringify({ ...live, mountains: live.mountains.filter((m) => m.id !== pinned.id) }))
    await ctx.wait(`!document.querySelector('.story-panel')`, 5_000, 'the worn-away story\'s panel to close')
    await sendDigest(raw)
    await ctx.delay(1500)
    expect(!(await ctx.evaluate(`!!document.querySelector('.story-panel')`)), `"${pinnedLabel}" wore away, then came back pinned by itself when it rose again.`)
    const button = await ctx.evaluate(`document.querySelector('.story-highest')?.innerText ?? ''`)
    expect(button.includes('Highest peak'), `After the pinned story wore away, the peak button reads "${button.replace(/\s+/g, ' ')}".`)
    return `${digest.mountains.length} story mountains; highest "${panel}" (${top.outlets} outlets, ${top.countries.length} other countries); a pinned story that wore away stayed unpinned.`
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
    await keepDrawing(ctx)
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
    const closed = await ctx.wait(`!document.querySelector('.olds-sheet')`, 5000).then(() => true, () => false)
    expect(closed, 'Escape does not close The Olds.')
    return `Views ${views.join('/')}; sections: ${sections.join(', ') || 'path only'}.`
  },

  // An outlet's earlier coverage of a story (its topic pages, then Wayback Machine snapshots), newest first.
  async OLDS_COVERAGE(ctx) {
    await keepDrawing(ctx)
    await ctx.waitForNews()
    await ctx.click('.globe-tabs button', 'World')
    await ctx.wait(`document.querySelectorAll('.world-list > li').length > 0`, 90_000, 'world stories')
    const OUTLETS = 'BBC|Al Jazeera|DW|Deutsche Welle|NPR|CNA|RFI|Euronews|Africanews|Middle East Eye'
    const rowsScript = `[...document.querySelectorAll('.world-list li.has-history')].filter((li) => new RegExp('^(${OUTLETS})', 'i').test(li.querySelector('small')?.innerText ?? ''))`
    // Stories refresh while the list is open: keep opening any that are closed until a supported outlet shows.
    // One story's sources show at a time: open the stories one by one until one has a supported outlet's headline.
    const openNext = (need) => `(() => {
      if (${rowsScript}.length > ${need}) return true
      const next = [...document.querySelectorAll('.world-list > li:not(.is-open)')].find((li) => !li.dataset.tried)
      if (next) { next.dataset.tried = '1'; next.querySelector('.world-expand')?.click() }
      else document.querySelectorAll('.world-list > li').forEach((li) => delete li.dataset.tried)
      return false
    })()`
    await ctx.wait(openNext(0), 90_000, 'a headline from a supported outlet')
    const outletView = `[...document.querySelectorAll('.olds-views button')].find((b) => /covered this story/.test(b.title))`
    let headline = ''
    let first = null
    for (let attempt = 0, row = 0; attempt < 6 && row < 4; attempt += 1) {
      headline = await ctx.evaluate(`(() => { const li = ${rowsScript}[${row}]; if (!li) return ''; li.querySelector('.headline-history').click(); return li.querySelector('strong').innerText })()`)
      if (!headline) {
        // The list refreshed between finding the row and clicking it: wait for it again.
        await ctx.wait(openNext(row), 60_000, 'the supported outlet\'s headline again')
        continue
      }
      row += 1
      await ctx.wait(`!!${outletView}`, 60_000, 'the outlet’s coverage view')
      await ctx.evaluate(`${outletView}.click(); true`)
      await ctx.wait(`!!document.querySelector('.olds-coverage-list, .olds-coverage-note:not(:has(.olds-spin))')`, 60_000, 'the outlet’s earlier coverage')
      first = JSON.parse(await ctx.evaluate(`JSON.stringify({ months: [...document.querySelectorAll('.olds-coverage-month h3')].map((h) => h.innerText), items: document.querySelectorAll('.olds-coverage-month li').length, now: document.querySelector('.olds-coverage-now')?.innerText ?? '', note: document.querySelector('.olds-coverage-note')?.innerText ?? '', credit: document.querySelector('.olds-coverage-credit')?.innerText ?? '' })`))
      if (first.items) break
      await ctx.press('Escape')
      await ctx.delay(1200)
    }
    expect(first, 'No headline from a supported outlet could be opened.')
    expect(/Wayback Machine/.test(first.credit), 'The coverage view does not credit the Wayback Machine.')
    if (!first.items) return `No earlier coverage for “${headline}”: ${first.note}`
    expect(first.now.includes(headline.slice(0, 30)), 'The current story is not at the top of the coverage.')
    const monthOrder = (months) => months.map((label) => Date.parse(`1 ${label}`))
    const ordered = (months) => monthOrder(months).every((value, index, all) => index === 0 || value <= all[index - 1])
    expect(ordered(first.months), `Months are not newest first: ${first.months.join(', ')}`)
    await ctx.shot('olds-coverage')
    // Further back: the archive's snapshots (a few seconds each, paced for the Internet Archive).
    await ctx.evaluate(`document.querySelector('.olds-coverage-end button')?.click(); true`)
    await ctx.wait(`!document.querySelector('.olds-coverage-end .olds-spin')`, 120_000, 'older coverage from the archive')
    const later = JSON.parse(await ctx.evaluate(`JSON.stringify({ months: [...document.querySelectorAll('.olds-coverage-month h3')].map((h) => h.innerText), items: document.querySelectorAll('.olds-coverage-month li').length, end: document.querySelector('.olds-coverage-end')?.innerText ?? '' })`))
    expect(ordered(later.months), `Months are not newest first after going back: ${later.months.join(', ')}`)
    expect(later.items >= first.items, 'Going further back lost headlines.')
    await ctx.press('Escape')
    return `“${headline.slice(0, 60)}”: ${first.items} headlines (${first.months[0]} – ${first.months.at(-1)}), then ${later.items} reaching ${later.months.at(-1)}; ${later.end}`
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
      const site = createServer((request, response) => {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        // A slow site: nothing arrives for 4 s.
        if (request.url?.startsWith('/slow')) { setTimeout(() => response.end('<!doctype html><title>Slow landing</title><h1>Slow landing</h1>'), 4_000); return }
        response.end('<!doctype html><title>Omnibox landing</title><h1>Omnibox landing</h1>')
      })
      site.listen(0, 'localhost', () => resolve(site))
    })
    try {
      const host = `localhost:${server.address().port}`
      const url = `http://${host}/`
      const state = () => ctx.evaluate(`window.intoponet.browserHost.getState().then((s) => JSON.stringify(s))`).then(JSON.parse)
      const tabs = () => ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => JSON.stringify(t.map((x) => x.url)))`).then(JSON.parse)
      const read = () => ctx.evaluate(`JSON.stringify((() => { const i = document.querySelector('.command-input input'); return { value: i.value, selected: i.value.slice(i.selectionStart, i.selectionEnd), expanded: i.getAttribute('aria-expanded'), active: i.getAttribute('aria-activedescendant'), rows: [...document.querySelectorAll('#omnibox-suggestions [role=option]')].map((r) => ({ id: r.id, kind: r.dataset.kind, text: r.innerText.replace(/\\s+/g, ' '), selected: r.getAttribute('aria-selected') })) } })())`).then(JSON.parse)
      const typeHost = async (text) => {
        // The window in front: losing focus blurs the bar, which drops an inline completion (as it should).
        await ctx.main(`(() => { electron.app.focus({ steal: true }); electron.BrowserWindow.getAllWindows()[0].focus(); return true })()`)
        await ctx.evaluate(`(() => { const i = document.querySelector('.command-input input'); i.focus(); i.select(); return true })()`)
        // Emptied first: typing over the same text changes nothing, so it would not complete.
        if (await ctx.evaluate(`document.querySelector('.command-input input').value !== ''`)) {
          for (const type of ['keyDown', 'keyUp']) await ctx.send('Input.dispatchKeyEvent', { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
        }
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
      // Kept as a recent page once it has loaded (a busy Mac can take longer than the wait above).
      await ctx.wait(`window.intoponet.browserHost.readPrivateLibrary().then((r) => r.status === 'ok' && !!r.payload && JSON.parse(r.payload).recents.some((p) => p.url.startsWith(${JSON.stringify(url)})))`, 15_000, 'the visited page to be kept as a recent page')
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

      // An address that failed to load (a typo, a site that is down) is not kept, so it never comes back as a completion.
      const closedPort = await new Promise((resolve) => { const probe = createServer(); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)) }) })
      await ctx.evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'http://127.0.0.1:${closedPort}/never-loaded' }).then(() => true, () => true)`)
      await ctx.wait(`window.intoponet.browserHost.getState().then((s) => !!s.loadError)`, 15_000, 'the error page')
      await ctx.delay(2000)
      const kept = await ctx.evaluate(`window.intoponet.browserHost.readPrivateLibrary().then((r) => r.status === 'ok' && r.payload ? JSON.parse(r.payload).recents.map((p) => p.url).join(' ') : '')`)
      expect(kept.includes(host), `The visited page is not among recent pages (${kept}).`)
      expect(!kept.includes('never-loaded'), 'An address that failed to load was kept as a recent page.')

      // A new tab's address bar shows the address it is loading before its first page arrives: a tab opened from the
      // address bar, and a new tab's start page.
      const toolbarAddress = `(document.querySelector('.origin-badge:not(.start-origin)')?.getAttribute('title') ?? '')`
      for (const [label, slowUrl, fromStart] of [['a new tab', `${url}slow-tab`, false], ["a new tab's start page", `${url}slow-start`, true]]) {
        if (fromStart) {
          await ctx.evaluate(`window.intoponet.browserHost.newTab().then(() => true)`)
          await ctx.wait(`window.intoponet.browserHost.getState().then((s) => s.isStartPage === true)`, 8_000, 'a new tab on its start page')
        }
        void ctx.evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: ${JSON.stringify(slowUrl)} }).then(() => true, () => true)`).catch(() => undefined)
        await ctx.wait(`window.intoponet.browserHost.getState().then((s) => s.isVisible && s.isLoading && s.pendingUrl === ${JSON.stringify(slowUrl)} && !s.url && ${toolbarAddress} === ${JSON.stringify(slowUrl)})`, 2_500, `the address bar of ${label} to show the address it is loading, before the page arrives`)
      }

      // After Enter (⌘↵ here: the shown tab stays in front) the bar clears once the navigation starts, not when the
      // page has loaded; and what is typed meanwhile is never wiped when it does load.
      const behindUrl = `http://${host}/slow-behind`
      const typedBehind = await typeHost(behindUrl)
      expect(typedBehind.value === behindUrl, `The bar reads "${typedBehind.value}" instead of the typed address.`)
      await ctx.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 4, text: '\r' })
      await ctx.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 4 })
      await ctx.wait(`window.intoponet.browserHost.getTabs().then((t) => t.some((x) => x.url === ${JSON.stringify(behindUrl)} && x.title !== 'Slow landing')) && document.querySelector('.command-input input').value === ''`, 2_500, 'the bar to clear once the page behind has started loading, before it arrives')
      const meanwhile = `${behindUrl} and more`
      await ctx.evaluate(`(() => { document.querySelector('.command-input input').focus(); return true })()`)
      await ctx.type(meanwhile)
      await ctx.wait(`window.intoponet.browserHost.getTabs().then((t) => t.some((x) => x.url === ${JSON.stringify(behindUrl)} && x.title === 'Slow landing' && !x.loading))`, 15_000, 'the page behind to arrive')
      await ctx.delay(500)
      const typedSince = await read()
      expect(typedSince.value.startsWith(meanwhile), `The page loading behind wiped what was typed since Enter (the bar reads "${typedSince.value}").`)
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
    // A tab opened in the background loads as fast as a shown one (a load that waits on a chain of short timers,
    // as script loaders do, took about 30 s while Chromium throttled the unseen page), then is throttled again.
    // Its sound still waits until it is shown, as before.
    let held = null
    const tone = toneWav(2)
    const behind = await new Promise((resolve) => {
      const server = createServer((request, response) => {
        if (request.url === '/tone.wav') { response.setHeader('content-type', 'audio/wav'); response.end(tone); return }
        response.setHeader('content-type', 'text/html; charset=utf-8')
        if (request.url === '/hold') { held = response; return }
        if (request.url === '/release') { held?.end('<p>done'); held = null; response.end('ok'); return }
        if (request.url === '/sound') { response.end('<!doctype html><title>Sound</title><audio id="tone" autoplay loop src="/tone.wav"></audio>'); return }
        response.end(`<!doctype html><title>Behind</title><script>let n = 0; (function step() { if (++n < 30) setTimeout(step, 10); else fetch('/release') })()</script><iframe src="/hold"></iframe>`)
      })
      server.listen(0, '127.0.0.1', () => resolve(server))
    })
    let behindMs = 0
    try {
      const behindUrl = `http://127.0.0.1:${behind.address().port}/behind`
      const started = Date.now()
      const loaded = await Promise.race([ctx.evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: ${JSON.stringify(behindUrl)} }, 'background-tab').then(() => true)`), ctx.delay(40_000).then(() => false)])
      behindMs = Date.now() - started
      expect(loaded && behindMs < 20_000, `A page opened in the background took ${loaded ? `${Math.round(behindMs / 1000)} s` : 'over 40 s'} to load (shown, it takes about a second; throttled, over 30 s).`)
      const behindPage = await ctx.page('/behind')
      let visibility = ''
      for (let i = 0; i < 20 && visibility !== 'hidden'; i += 1) {
        visibility = await behindPage.evaluate('document.visibilityState')
        if (visibility !== 'hidden') await ctx.delay(250)
      }
      expect(visibility === 'hidden', `A background tab that finished loading is still "${visibility}", not hidden and throttled like other background tabs.`)
      await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => Promise.all(t.map((x) => window.intoponet.browserHost.closeTab(x.id)))).then(() => true)`)
      // A page that starts its sound by itself, opened in the background: silent until shown, then it plays.
      const soundUrl = `http://127.0.0.1:${behind.address().port}/sound`
      await ctx.evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: ${JSON.stringify(soundUrl)} }, 'background-tab').then(() => true)`)
      const sound = () => ctx.main(`(async () => {
        const page = electron.webContents.getAllWebContents().find((c) => c.getURL() === ${JSON.stringify(soundUrl)})
        if (!page) return null
        return JSON.stringify({ audible: page.isCurrentlyAudible(), played: await page.executeJavaScript('document.getElementById("tone").currentTime') })
      })()`).then((value) => (value ? JSON.parse(value) : null))
      await ctx.delay(2500)
      const unseen = await sound()
      expect(unseen && !unseen.audible && unseen.played < 0.5, `A page opened in the background played its sound before it was shown (${JSON.stringify(unseen)}).`)
      const [soundTab] = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => JSON.stringify(t))`))
      await ctx.evaluate(`window.intoponet.browserHost.activateTab(${JSON.stringify(soundTab.id)}).then(() => true)`)
      let heard = null
      for (let i = 0; i < 20 && !(heard?.audible && heard.played > 0.2); i += 1) { await ctx.delay(250); heard = await sound() }
      expect(heard?.audible && heard.played > 0.2, `The background page's sound did not play once the tab was shown (${JSON.stringify(heard)}).`)
      await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => Promise.all(t.map((x) => window.intoponet.browserHost.closeTab(x.id)))).then(() => true)`)
    } finally {
      held?.end()
      behind.close()
    }
    const keys = await browserKeys(ctx)
    // The app window never leaves the app: a page loaded in its place would get the app's whole API.
    const appUrl = await ctx.evaluate('location.href')
    await ctx.evaluate(`(() => { location.href = 'https://example.com/'; return true })()`).catch(() => undefined)
    await ctx.delay(2500)
    const stayed = await ctx.evaluate(`location.href === ${JSON.stringify(appUrl)} && !!document.querySelector('.topbar')`).catch(() => false)
    expect(stayed, 'The app window navigated away from the app.')
    return `Toolbar: ${labels.join(', ')}; pages see ${ua.match(/Chrome\/\S+/)?.[0]}; tab closed cleanly; a self-closing page took its tab; a background tab loaded in ${(behindMs / 1000).toFixed(1)} s, was throttled again and stayed silent until shown; ${keys}; the app window stayed on the app.`
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
    // A tab in the background asks: the bar names that tab, so the answer is not taken for the page in front.
    const behind = await ctx.page('example.org')
    void behind.evaluate(`Notification.requestPermission()`).catch(() => undefined)
    await ctx.wait(`(document.querySelector('.permission-bar')?.innerText ?? '').includes('example.org wants to')`, 15_000, 'the permission bar when a background tab asks to show notifications')
    const named = await ctx.evaluate(`document.querySelector('.permission-bar').innerText`)
    expect(/^Background tab “[^”]+” · example\.org wants to show notifications/.test(named), `The bar does not name the background tab that asked: "${named}"`)
    expect(await ctx.click('.permission-bar button', 'Not now'), 'The permission bar has no "Not now" button.')
    await ctx.wait(`!document.querySelector('.permission-bar')`, 5_000, 'the permission bar to go after "Not now"')
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
    // Session parity: the sign-in window gets what a tab gets (WebRTC kept to the default route, stand-ins for blocked trackers).
    const popupLoaded = `electron.webContents.getAllWebContents().some((c) => !c.isDestroyed() && c.getURL().includes('wikipedia.org') && !c.isLoading())`
    for (let i = 0; i < 40 && !(await ctx.main(popupLoaded)); i += 1) await ctx.delay(250)
    const parity = await pageSessionProblems(ctx, { stubbed: ['wikipedia.org'] })
    expect(parity.problems.length === 0, `Session parity with a sign-in window: ${parity.problems.join(' ')}`)
    await page.evaluate(`(() => { const a = document.createElement('a'); a.href = 'https://www.iana.org/'; a.target = '_blank'; document.body.append(a); addEventListener('click', () => a.click(), { once: true }); return true })()`)
    await clickPage(page)
    await ctx.delay(2500)
    tabs = await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => t.map((x) => x.url).join(' '))`)
    expect(/iana\.org/.test(tabs), 'A target=_blank link clicked by the person did not open as a tab.')
    return `Location allowed via the bar; a pop-up without a click was blocked and opened with "Allow once"; a background tab asking was named ("${named.split(' wants')[0]}"); a clicked popup kept its opener; a clicked _blank link opened a tab.`
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
      // "Always allow" is kept per sign-in scope: Main's answer is not used by a workspace with its own sign-ins,
      // which keeps its own (beside its permission file) until its own sign-ins go. Mail never really opens here.
      await ctx.main(`(() => { globalThis.__appOpens = []; globalThis.__openExternal = electron.shell.openExternal; electron.shell.openExternal = async (url) => { globalThis.__appOpens.push(url) }; return true })()`)
      const ws = 'window.intoponet.workspaces'
      const answers = (name) => { try { return JSON.parse(readFileSync(join(ctx.profile, name), 'utf8')) } catch { return null } }
      const clickMail = async (marker) => (await ctx.page(marker)).evaluate(`(() => { document.getElementById('mail').click(); return true })()`, { userGesture: true })
      const allowAlways = async (where) => {
        await ctx.wait(`!!document.querySelector('.external-open-bar')`, 10_000, `the "Open …?" prompt in ${where}`)
        await ctx.evaluate(`window.intoponet.browsing.pendingExternal().then((list) => window.intoponet.browsing.decideExternal(list[0].id, 'open', true)).then(() => true)`)
        await ctx.wait(`!document.querySelector('.external-open-bar')`, 5_000, `the prompt in ${where} to go after Open`)
      }
      const until = async (test, label) => {
        for (let i = 0; i < 40; i += 1) { if (test()) return; await ctx.delay(250) }
        throw new CheckFailure(`Timed out waiting for ${label}.`)
      }
      let appsId = ''
      try {
        await openPage(ctx, `${origin}/?scope=main`, 2000)
        await clickMail('scope=main')
        await allowAlways('Main')
        await until(() => answers('external-apps.json')?.[origin]?.includes('mailto'), "Main's \"Always allow\" to be saved")
        await clickMail('scope=main')
        await ctx.delay(1000)
        expect(!(await ctx.evaluate(`!!document.querySelector('.external-open-bar')`)) && (await ctx.main('globalThis.__appOpens.length')) === 2, `Main asked again after "Always allow" (opened ${await ctx.main('JSON.stringify(globalThis.__appOpens)')}).`)
        appsId = JSON.parse(await ctx.evaluate(`${ws}.create({ name: 'Apps' }).then((s) => JSON.stringify(s))`)).activeId
        await ctx.evaluate(`${ws}.update(${JSON.stringify(appsId)}, { separateSignIns: true }).then(() => true)`)
        await openPage(ctx, `${origin}/?scope=apps`, 2000)
        await clickMail('scope=apps')
        await allowAlways('a workspace with its own sign-ins, where Main\'s answer must not count')
        const own = `external-apps.ws-${appsId}.json`
        await until(() => answers(own)?.[origin]?.includes('mailto'), "the workspace's own \"Always allow\" to be saved in its own file")
        expect(JSON.stringify(answers('external-apps.json')) === JSON.stringify({ [origin]: ['mailto'] }), `Main's answers changed: ${JSON.stringify(answers('external-apps.json'))}.`)
        // Its own sign-ins turned off: its answers are deleted with its permissions; Main keeps its own.
        await ctx.evaluate(`${ws}.update(${JSON.stringify(appsId)}, { separateSignIns: false }).then(() => true)`)
        await until(() => !existsSync(join(ctx.profile, own)), `${own} to be deleted when its own sign-ins were turned off`)
        expect(answers('external-apps.json')?.[origin]?.includes('mailto'), "Main's \"Always allow\" went with the workspace's own.")
      } finally {
        await ctx.main(`(() => { electron.shell.openExternal = globalThis.__openExternal; return true })()`)
      }
      return `"${prompt.split('\n')[0]}" asked for a mailto: link; the tab stayed on ${origin}/; Cancel closed it and no prompt storm followed. "Always allow" in Main was not used by a workspace with its own sign-ins, which kept its own answer in its own file until its sign-ins were turned off.`
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
      // A page whose renderer crashes twice in a row waits for Reload: the toolbar keeps its address, and Reload brings it back.
      const crashPage = () => ctx.main(`(() => { const c = electron.webContents.getAllWebContents().find((c) => c.getURL() === ${JSON.stringify(url)}); if (!c) return false; c.forcefullyCrashRenderer(); return true })()`)
      // It comes back with its back/forward list, as a sleeping tab wakes: an earlier page first, then this one again.
      await ctx.evaluate(`window.intoponet.browserHost.navigate(${JSON.stringify(`${url}?earlier`)}).then(() => true, () => true)`)
      await ctx.wait(`window.intoponet.browserHost.getState().then((s) => s.url === ${JSON.stringify(`${url}?earlier`)} && !s.isLoading)`, 15_000, 'the earlier page')
      await ctx.evaluate(`window.intoponet.browserHost.navigate(${JSON.stringify(url)}).then(() => true, () => true)`)
      await ctx.wait(`window.intoponet.browserHost.getState().then((s) => s.url === ${JSON.stringify(url)} && s.canGoBack && !s.isLoading)`, 15_000, 'the page again, with the earlier one behind it')
      const historyOf = () => ctx.main(`(() => { const c = electron.webContents.getAllWebContents().find((c) => !c.isCrashed() && c.getURL() === ${JSON.stringify(url)}); return JSON.stringify(c ? { urls: c.navigationHistory.getAllEntries().map((e) => e.url), index: c.navigationHistory.getActiveIndex() } : null) })()`).then(JSON.parse)
      const beforeCrash = await historyOf()
      expect(beforeCrash && beforeCrash.urls.length >= 2 && beforeCrash.urls.includes(`${url}?earlier`), `The page has no back/forward list to keep: ${JSON.stringify(beforeCrash)}.`)
      expect(await crashPage(), 'The page to crash is not open.')
      await ctx.delay(1500)
      await ctx.wait(`window.intoponet.browserHost.getState().then((s) => s.title === 'Browsing test' && !s.isLoading)`, 15_000, 'the page to load again after a crash')
      const afterCrash = await historyOf()
      expect(JSON.stringify(afterCrash) === JSON.stringify(beforeCrash), `After a crash the page came back without its back/forward list: ${JSON.stringify(afterCrash)}, before ${JSON.stringify(beforeCrash)}.`)
      expect((await panelState(ctx)).canGoBack, 'After a crash Back is not offered.')
      expect(await crashPage(), 'The page that loaded again after a crash is not open.')
      await ctx.delay(1500)
      const paused = await panelState(ctx)
      expect(paused.url === url, `After repeated crashes the toolbar shows "${paused.url}" instead of the page's address (${url}).`)
      await ctx.evaluate(`window.intoponet.browserHost.reload().then(() => true)`)
      await ctx.wait(`window.intoponet.browserHost.getState().then((s) => s.title === 'Browsing test' && s.url === ${JSON.stringify(url)})`, 15_000, 'Reload to bring the crashed page back')
      await ctx.wait(`window.intoponet.browserHost.getState().then((s) => s.canGoBack && !s.isLoading)`, 15_000, 'Back to be offered once Reload has brought the crashed page back')
      const afterReload = await historyOf()
      expect(JSON.stringify(afterReload) === JSON.stringify(beforeCrash), `Reload after repeated crashes brought the page back without its back/forward list: ${JSON.stringify(afterReload)}.`)
      // A tab behind another whose renderer crashed waits blank; Reload from its tab menu brings it back there, with its back/forward list.
      const crashedTab = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => JSON.stringify(t.find((x) => x.active)))`))
      const front = `${url}?front`
      await ctx.evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: ${JSON.stringify(front)} }).then(() => true, () => true)`)
      await ctx.wait(`window.intoponet.browserHost.getState().then((s) => s.url === ${JSON.stringify(front)} && !s.isLoading)`, 15_000, 'a page in front of the one to crash')
      expect(await crashPage(), 'The background page to crash is not open.')
      await ctx.delay(1500)
      expect(!(await historyOf()), 'The crashed background page loaded again by itself.')
      await ctx.main(`(() => { globalThis.__tabMenu = null; globalThis.__popup = electron.Menu.prototype.popup; electron.Menu.prototype.popup = function () { globalThis.__tabMenu = this }; return true })()`)
      try {
        await ctx.evaluate(`window.intoponet.browserHost.showTabMenu(${JSON.stringify(crashedTab.id)}).then(() => true)`)
        for (let i = 0; i < 20 && !(await ctx.main('globalThis.__tabMenu !== null')); i += 1) await ctx.delay(100)
        expect(await ctx.main(`globalThis.__tabMenu?.items.some((i) => i.label === 'Reload' && i.enabled) ?? false`), 'The crashed tab\'s menu offers no Reload.')
        await ctx.main(`(() => { globalThis.__tabMenu.items.find((i) => i.label === 'Reload').click(); return true })()`)
      } finally {
        await ctx.main(`(() => { electron.Menu.prototype.popup = globalThis.__popup; return true })()`)
      }
      for (let i = 0; i < 50 && JSON.stringify(await historyOf()) !== JSON.stringify(beforeCrash); i += 1) await ctx.delay(200)
      expect(JSON.stringify(await historyOf()) === JSON.stringify(beforeCrash), `Reload from the tab menu did not bring the crashed background tab back with its back/forward list: ${JSON.stringify(await historyOf())}.`)
      expect((await panelState(ctx)).url === front, 'Reload from the menu of a background tab changed the page in front.')
      await ctx.evaluate(`window.intoponet.browserHost.closeActiveTab().then(() => true)`)
      await ctx.wait(`window.intoponet.browserHost.getState().then((s) => s.url === ${JSON.stringify(url)} && !s.isLoading)`, 15_000, 'the reloaded tab to be shown again')
      // Closed while still blank after crashing behind another tab, it keeps its back/forward list for ⇧⌘T.
      await ctx.evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: ${JSON.stringify(front)} }).then(() => true, () => true)`)
      await ctx.wait(`window.intoponet.browserHost.getState().then((s) => s.url === ${JSON.stringify(front)} && !s.isLoading)`, 15_000, 'a page in front of the one to crash and close')
      expect(await crashPage(), 'The background page to crash and close is not open.')
      await ctx.delay(1500)
      expect(!(await historyOf()), 'The crashed background page loaded again by itself before it was closed.')
      await ctx.evaluate(`window.intoponet.browserHost.closeTab(${JSON.stringify(crashedTab.id)}).then(() => true)`)
      await ctx.delay(500)
      await ctx.evaluate(`window.intoponet.browserHost.reopenClosedTab().then(() => true)`)
      for (let i = 0; i < 50 && JSON.stringify(await historyOf()) !== JSON.stringify(beforeCrash); i += 1) await ctx.delay(200)
      expect(JSON.stringify(await historyOf()) === JSON.stringify(beforeCrash), `A crashed background tab closed while blank came back from Recently closed without its back/forward list: ${JSON.stringify(await historyOf())}, before ${JSON.stringify(beforeCrash)}.`)
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
      // Pages in dark mode: one with no background of its own is white (black text stays readable), one that chooses dark is dark.
      await ctx.evaluate(`window.intoponet.browsing.setPageAppearance('dark').then(() => true)`)
      const canvas = async (path) => {
        await ctx.evaluate(`window.intoponet.browserHost.newTab().then(() => true)`)
        await ctx.delay(800)
        await openPage(ctx, `http://${host}${path}`, 2000)
        const session = await ctx.page(`${host}${path}`)
        const { data } = await session.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 300, width: 4, height: 4, scale: 1 } })
        // The pixel in the middle of an uncompressed-enough PNG: decode via the page itself.
        return session.evaluate(`new Promise((resolve) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 4; const g = c.getContext('2d'); g.drawImage(i, 0, 0); resolve([...g.getImageData(1, 1, 1, 1).data.slice(0, 3)].join(',')) }; i.src = 'data:image/png;base64,${data}' })`)
      }
      const plain = await canvas('/plain')
      expect(plain.split(',').every((v) => Number(v) > 240), `In dark mode a page with no background shows ${plain} behind its black text (should be white).`)
      const dark = await canvas('/darkpage')
      expect(dark.split(',').every((v) => Number(v) < 80), `A page that chooses dark shows ${dark} (should be dark).`)
      await ctx.evaluate(`window.intoponet.browsing.setPageAppearance('system').then(() => true)`)
      seen.push(`dark mode canvas: plain ${plain}, dark ${dark}`)
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
    // Session parity: the private session has the protections the shared one has.
    const parity = await pageSessionProblems(ctx, { stubbed: [new URL(tab.url).hostname] })
    expect(parity.problems.length === 0 && parity.sessions >= 1, `Session parity in private browsing: ${parity.problems.join(' ') || 'no page was open'}`)
    const recents =await ctx.evaluate(`window.intoponet.browserHost.readPrivateLibrary().then((r) => r.status === 'ok' && r.payload ? JSON.parse(r.payload).recents.length : 0)`)
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
    // A private session leaves nothing for the next one: not a password typed into a site's own sign-in box
    // (HTTP authentication), nor an open connection a site could tie the two sessions together by.
    const requests = []
    let session = 1
    const authSite = createServer((request, response) => {
      const sent = request.headers.authorization ?? ''
      requests.push({ session, path: new URL(request.url, 'http://localhost').pathname, sent, connection: request.socket.remotePort })
      const ok = !request.url.startsWith('/box') || sent === `Basic ${Buffer.from('ada:Pa55').toString('base64')}`
      response.writeHead(ok ? 200 : 401, { 'content-type': 'text/html', ...(ok ? {} : { 'www-authenticate': 'Basic realm="e2e"' }) })
      response.end(ok ? '<title>In</title>Signed in' : '<title>Out</title>Signed out')
    })
    // Connections kept open as long as real servers keep them (Node closes idle ones after 5 s).
    authSite.keepAliveTimeout = 120_000
    await new Promise((resolve) => authSite.listen(0, '127.0.0.1', resolve))
    try {
      const port = authSite.address().port
      const openPrivate = async (url) => {
        await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(true).then(() => true)`)
        await ctx.evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: ${JSON.stringify(url)} }).then(() => true, () => false)`)
        await ctx.delay(1500)
      }
      const nextPrivateSession = async () => {
        await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(false).then(() => true)`)
        await ctx.delay(800)
        session += 1
      }
      const of = (n) => requests.filter((entry) => entry.session === n)
      // A plain page: the next private session's page does not come on its connection.
      await openPrivate(`http://127.0.0.1:${port}/page`)
      await nextPrivateSession()
      await openPrivate(`http://127.0.0.1:${port}/page`)
      const earlier = new Set(of(1).map((entry) => entry.connection))
      expect(of(2).length > 0 && !of(2).some((entry) => earlier.has(entry.connection)), 'A private tab opened after private browsing ended came on a connection of the earlier private session.')
      // A sign-in box answered: the next private session is not signed in.
      await openPrivate(`http://ada:Pa55@127.0.0.1:${port}/box`)
      expect(of(2).some((entry) => entry.path === '/box' && entry.sent), 'The private tab did not sign in to the test site (no credentials were sent).')
      await nextPrivateSession()
      await openPrivate(`http://127.0.0.1:${port}/box`)
      expect(of(3).length > 0 && !of(3).some((entry) => entry.sent), 'A private tab opened after private browsing ended was still signed in with a password typed in the earlier private session.')
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(false).then(() => true)`)
    } finally {
      authSite.close()
    }
    return 'Private tab marked, no footprints, closed when private mode ended; its HTTP sign-in did not outlive it.'
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
      // Saved soon after, but a busy disk can take a while: wait for the file to show it.
      const savedState = () => { try { return JSON.parse(readFileSync(join(ctx.profile, 'browser-state.v1.json'), 'utf8')) } catch { return null } }
      const pinnedSaved = (saved) => saved?.tabs?.[0]?.pinned === true && saved.tabs[0].url.includes('/two')
      for (let i = 0; i < 50 && !pinnedSaved(savedState()); i += 1) await ctx.delay(200)
      expect(pinnedSaved(savedState()), `The pinned tab is not saved as pinned for the next launch (saved: ${JSON.stringify(savedState()?.tabs ?? null)}).`)
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

      // A pair side by side is one row: a tab dragged past it, or moved past it from the keyboard, goes round it and the pair holds.
      const [left, right, below, last] = (await tabs()).filter((tab) => !tab.pinned).map((tab) => tab.id)
      await ctx.evaluate(`${host}.splitTab(${JSON.stringify(left)}, ${JSON.stringify(right)}, 'left').then(() => true)`)
      await ctx.delay(800)
      const unpinned = async () => (await tabs()).filter((tab) => !tab.pinned).map((tab) => tab.id).join(' ')
      const paired = async () => (await tabs()).filter((tab) => tab.split).map((tab) => tab.id).join(' ') === `${left} ${right}`
      const rowOf = async (id) => JSON.parse(await ctx.evaluate(`JSON.stringify(document.querySelector('.tab-rail-list [data-tab-id=${JSON.stringify(id)}] [role="tab"]').getBoundingClientRect())`))
      const start = await rowOf(below)
      const end = await rowOf(last)
      const grab = { x: start.x + start.width / 2, y: start.y + start.height / 2 }
      const drop = end.y + end.height - 2
      await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: grab.x, y: grab.y })
      await ctx.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: grab.x, y: grab.y, button: 'left', buttons: 1, clickCount: 1 })
      for (let step = 1; step <= 8; step += 1) {
        await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: grab.x, y: grab.y + (drop - grab.y) * (step / 8), button: 'left', buttons: 1 })
        await ctx.delay(30)
      }
      await ctx.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: grab.x, y: drop, button: 'left', buttons: 0, clickCount: 1 })
      await ctx.delay(700)
      expect(await unpinned() === [left, right, last, below].join(' ') && await paired(), `A tab below a pair, dragged to the end, did not move there with the pair kept (order: ${await unpinned()}).`)
      await ctx.evaluate(`document.querySelector('.tab-rail-list [data-tab-id=${JSON.stringify(last)}] [role="tab"]').focus()`)
      await key('ArrowUp', 38, 1 | 8)
      await ctx.delay(700)
      expect(await unpinned() === [last, left, right, below].join(' ') && await paired(), `⌥⇧↑ on the tab below a pair did not move it above the pair with the pair kept (order: ${await unpinned()}).`)
      // The keyboard goes through a pair: ↓ reaches each side, then the tab after it (rail); → does the same in the strip.
      const focusedTab = () => ctx.evaluate(`(() => { const e = document.activeElement; return (e?.getAttribute('aria-label')?.includes('right side by side') ? 'right:' : '') + (e?.closest('[data-tab-id]')?.dataset.tabId ?? '') })()`)
      await ctx.evaluate(`document.querySelector('.tab-rail-list [data-tab-id=${JSON.stringify(left)}] [role="tab"]').focus()`)
      await key('ArrowDown', 40, 0)
      await ctx.delay(300)
      expect(await focusedTab() === `right:${left}`, `↓ from a pair's left side did not reach its right side (focus: ${await focusedTab()}).`)
      await key('ArrowDown', 40, 0)
      await ctx.delay(300)
      expect(await focusedTab() === below, `↓ from a pair's right side did not reach the next tab (focus: ${await focusedTab()}).`)
      await ctx.evaluate(`${host}.close().then(() => true)`)
      await ctx.wait(`!!document.querySelector('.page-tabs [data-tab-id=${JSON.stringify(left)}] [role="tab"]')`, 10_000, 'the strip with the pair')
      await ctx.evaluate(`document.querySelector('.page-tabs [data-tab-id=${JSON.stringify(left)}] [role="tab"]').focus()`)
      await key('ArrowRight', 39, 0)
      await key('ArrowRight', 39, 0)
      await ctx.delay(300)
      expect(await focusedTab() === below, `→ in the strip did not go through the pair to the next tab (focus: ${await focusedTab()}).`)
      await ctx.evaluate(`${host}.restore().then(() => true)`)
      await ctx.delay(800)
      // Delete on a pair's right side closes that side, not the left one.
      await ctx.evaluate(`document.querySelectorAll('.tab-rail-list [data-tab-id=${JSON.stringify(left)}] [role="tab"]')[1].focus()`)
      await key('Delete', 46, 0)
      await ctx.delay(800)
      const remaining = (await tabs()).map((tab) => tab.id)
      expect(!remaining.includes(right) && remaining.includes(left), `Delete on a pair's right side closed ${remaining.includes(left) ? 'nothing' : 'its left side'}.`)
      return 'Moved by command, drag and ⌥⇧↓ (focus kept); pinned tab first, icon-only and saved; speaker muted and unmuted a playing tab; spinner while a slow page loaded; a tab dragged or moved past a pair went round it and the pair held; arrows went through a pair in rail and strip, and Delete closed the focused side; no axe violations in rail or strip.'
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
    // A private tab's capture says nothing about the page: a neutral name in Finder, no address kept.
    await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(true).then(() => true)`)
    await openAnyPage(ctx)
    expect(await ctx.click('.browser-actions button', 'Capture'), 'The Capture button is missing in a private tab.')
    await ctx.wait(`!!document.querySelector('.cap-primary')`, 10_000, 'the capture toolbar in a private tab')
    await ctx.click('.cap-primary')
    await ctx.wait(`window.intoponet.captures.list().then((l) => l.length > 1)`, 15_000, 'the private tab\'s screenshot to be saved')
    const privateCapture = JSON.parse(await ctx.evaluate(`window.intoponet.captures.list().then((l) => JSON.stringify([...l].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]))`))
    await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(false).then(() => true)`)
    expect(privateCapture.title === 'Capture' && privateCapture.sourceUrl === '' && /^Capture \d{4}-\d{2}-\d{2} at /.test(privateCapture.fileName), `A private tab's capture names the page: ${JSON.stringify({ title: privateCapture.title, sourceUrl: privateCapture.sourceUrl, fileName: privateCapture.fileName })}`)
    return 'Screenshot saved; "New folder…" offered; a private tab\'s capture is named neutrally with no address.'
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
    // The library is sealed and flushed to disk before it is put in place, which can take over a second on a busy Mac.
    const hidden = await ctx.wait(`window.intoponet.browserHost.readPrivateLibrary().then((r) => JSON.parse(r.payload).bookmarks.some((b) => b.hiddenOnMap))`, 10_000, 'the hidden pin to be saved').catch(() => false)
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

      // Quitting just as saves start (sealing slowed here: 3 s for history, 0.3 s for the rest): the one-second history
      // save of a visit and a library save sent after the quit began are both waited for, and no temporary file is left.
      const library = await ctx.evaluate(`window.intoponet.browserHost.readPrivateLibrary().then((r) => r.payload ?? JSON.stringify({ schema: 'intoponet.private-library.v1', bookmarks: [], collections: [], recents: [], absorbed: [] }))`)
      await ctx.main(`(() => { const s = electron.safeStorage; const seal = s.encryptStringAsync.bind(s); globalThis.__historySealing = 0; s.encryptStringAsync = (text) => { const history = text.includes('intoponet.history.v1'); if (history) globalThis.__historySealing = Date.now(); return new Promise((resolve) => setTimeout(resolve, history ? 3000 : 300)).then(() => seal(text)) }; return true })()`)
      await openPage(ctx, `${base}/delta`, 0)
      // The visit's one-second save starts sealing: the quit begins at once, with about 3 s of that save to go.
      let sealing = 0
      for (let i = 0; i < 50 && !sealing; i += 1) {
        sealing = await ctx.main('globalThis.__historySealing')
        if (!sealing) await ctx.delay(100)
      }
      expect(sealing > 0, 'The visit was never saved to history.')
      const quitAt = Date.now()
      await ctx.main('electron.app.quit()')
      await ctx.delay(100)
      await ctx.evaluate(`(() => { void window.intoponet.browserHost.writePrivateLibrary(${JSON.stringify(library)}).catch(() => undefined); return true })()`).catch(() => false)
      // A quitting app waits for its debugger to disconnect before it exits.
      ctx.detachMain()
      await waitForQuit(ctx.profile)
      const historyFile = join(ctx.profile, 'personal', 'history.v1.seal')
      const libraryFile = join(ctx.profile, 'private-library.v1.seal')
      // The quit waited for that save rather than end without it.
      expect(existsSync(historyFile) && statSync(historyFile).mtimeMs >= sealing + 2900, `The history save started in the last moments of the quit was not waited for (history last written ${existsSync(historyFile) ? Math.round(statSync(historyFile).mtimeMs - sealing) : '—'} ms after it began sealing, which takes 3 s).`)
      expect(existsSync(libraryFile) && statSync(libraryFile).mtimeMs >= quitAt + 100, 'A library save sent after the quit began was not waited for.')
      const leftovers = ['', 'personal'].flatMap((sub) => readdirSync(join(ctx.profile, sub)).filter((name) => name.endsWith('.tmp')).map((name) => join(sub, name)))
      expect(!leftovers.length, `Quitting left temporary files in the profile: ${leftovers.join(', ')}.`)
      return `Downloaded ${DOWNLOAD_BYTES / 1024} KB with progress → done; on disk with quarantine "${quarantine}"; History found and deleted a visit; private visit not kept; a quit waited for the late history and library saves and left no temporary files.`
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
    // Settings floats over a page. The page is a native view drawn above the interface: it stays hidden while Settings
    // is open, through a re-layout (the sidebar hidden and shown again), and comes back when Settings closes.
    const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Under settings</title><p>A page under Settings.</p>') })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const pageShown = `electron.BrowserWindow.getAllWindows()[0].contentView.children.some((view) => view.getVisible() && view.webContents.getURL().includes('/under-settings'))`
    const toggleSidebar = `(() => { electron.BrowserWindow.getAllWindows()[0].webContents.send('browser-host:event', { type: 'shortcut', action: 'toggle-tab-sidebar' }); return true })()`
    try {
      await openPage(ctx, `http://127.0.0.1:${server.address().port}/under-settings`, 1500)
      expect(await ctx.main(pageShown), 'The page is not on screen before Settings opens.')
      await openPanel(ctx, 'Settings')
      expect(!(await ctx.main(pageShown)), 'The page is drawn over Settings.')
      await ctx.main(toggleSidebar)
      await ctx.delay(700)
      await ctx.main(toggleSidebar)
      await ctx.delay(900)
      expect(!(await ctx.main(pageShown)), 'With Settings open, the page came back over it when the sidebar was hidden and shown again.')
      await ctx.click('[aria-label="Close settings"]')
      const back = await (async () => { for (let i = 0; i < 20; i += 1) { if (await ctx.main(pageShown)) return true; await ctx.delay(150) } return false })()
      expect(back, 'The page did not come back when Settings closed.')
    } finally {
      server.close()
    }
    await openPanel(ctx, 'Settings')
    const text = await ctx.evaluate(`document.querySelector('.settings-pane')?.innerText ?? ''`)
    for (const piece of ['Read the web in', 'Translate pages', 'Downloaded languages', 'Beacons', 'Credits and licences', 'Privacy']) expect(text.includes(piece), `Settings is missing "${piece}".`)
    await ctx.click('[aria-label="Settings"]')
    await openPanel(ctx, 'My map')
    await ctx.click('.drawer-tabs button', 'Privacy')
    await ctx.delay(500)
    const privacy = await ctx.evaluate(`document.querySelector('.privacy-pane')?.innerText ?? ''`)
    for (const piece of ['Private browsing', 'Footprints', 'Sites to leave out', 'Your pins on the globe', 'Backups']) expect(privacy.includes(piece), `Privacy is missing "${piece}".`)
    return 'Settings and Privacy sections present; a page under Settings stays hidden through a re-layout and comes back when it closes.'
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
    // Read only: nothing is ever sent to the live registry from a check (its tests cover refusing unsigned publishes).
    return 'Live registry healthy and readable from the app.'
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
  async COPY_ADDRESS(ctx) {
    const { server, origin } = await tabSite()
    try {
      const clip = () => ctx.main('electron.clipboard.readText()')
      const setClip = (text) => ctx.main(`electron.clipboard.writeText(${JSON.stringify(text)})`)
      await openPage(ctx, `${origin}/article?id=3&utm_source=news&fbclid=xyz#part`, 2500)
      // In the page, focus on the page itself: ⇧⌘C copies the address without its tracking parameters.
      await setClip('before')
      await ctx.keyInPage('/article', 'C', ['meta', 'shift'])
      await ctx.wait(`window.intoponet.browserHost.getTabs().then(() => true)`, 2000, 'the app')
      await ctx.delay(600)
      const cleaned = await clip()
      expect(cleaned === `${origin}/article?id=3#part`, `⇧⌘C in the page copied "${cleaned}".`)
      await ctx.wait(`document.querySelector('.origin-copied')?.textContent.includes('tracking removed') && [...document.querySelectorAll('[role=status]')].some((e) => e.textContent.includes('Address copied'))`, 3000, 'the address field to say it was copied')
      await ctx.wait(`!document.querySelector('.origin-copied')`, 4000, 'the confirmation to go away')
      // A text field in the page keeps the key (an editor's own ⇧⌘C is not broken).
      const site = await ctx.page('/article')
      await site.evaluate(`document.getElementById('field').focus()`)
      await setClip('before')
      await ctx.keyInPage('/article', 'C', ['meta', 'shift'])
      await ctx.delay(800)
      expect(await clip() === 'before', 'With a text field focused, ⇧⌘C still copied the page address.')
      await site.evaluate(`document.activeElement.blur()`)
      // ⌥⇧⌘C copies it exactly as it is.
      await ctx.keyInPage('/article', 'C', ['meta', 'shift', 'alt'])
      await ctx.delay(800)
      const raw = await clip()
      expect(raw === `${origin}/article?id=3&utm_source=news&fbclid=xyz#part`, `⌥⇧⌘C copied "${raw}".`)
      // With the app's own interface focused, the same key works.
      await setClip('before')
      await ctx.evaluate(`document.activeElement?.blur(); true`)
      for (const type of ['rawKeyDown', 'keyUp']) await ctx.send('Input.dispatchKeyEvent', { type, key: 'C', code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: 4 | 8 })
      await ctx.delay(800)
      expect(await clip() === `${origin}/article?id=3#part`, `⇧⌘C in the app interface copied "${await clip()}".`)
      return 'Copied without tracking parameters from the page and the toolbar, exactly with ⌥, and not while a text field had focus.'
    } finally {
      server.close()
    }
  },
  async PINNED_HOME(ctx) {
    const { server, origin } = await tabSite()
    // The same site under another host name: leaving home means another site, not another page.
    const elsewhere = origin.replace('127.0.0.1', 'localhost')
    const host = 'window.intoponet.browserHost'
    const tabs = async () => JSON.parse(await ctx.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
    try {
      for (const name of ['mail', 'news', 'notes']) await openPage(ctx, `${origin}/${name}`, 1200)
      const [mail] = await tabs()
      await ctx.evaluate(`${host}.setTabPinned(${JSON.stringify(mail.id)}, true).then(() => ${host}.activateTab(${JSON.stringify(mail.id)})).then(() => true)`)
      await ctx.delay(600)
      let pinned = (await tabs()).find((tab) => tab.id === mail.id)
      expect(pinned.pinned && pinned.home === `${origin}/mail`, `Pinning did not record the home (${pinned.home}).`)
      expect(!pinned.awayFromHome, 'A pinned tab at home says it is away.')
      // Another page of the same site is still home; another site is away.
      await (await ctx.page('/mail')).evaluate(`location.href = '${origin}/mail/inbox?id=2'`)
      await ctx.delay(1200)
      expect(!(await tabs()).find((tab) => tab.id === mail.id).awayFromHome, 'Moving within the home site counted as leaving it.')
      await (await ctx.page('/mail/inbox')).evaluate(`location.href = '${elsewhere}/article'`)
      await ctx.wait(`${host}.getTabs().then((t) => t.find((x) => x.id === ${JSON.stringify(mail.id)})?.awayFromHome === true)`, 5000, 'the pinned tab to know it left home')
      await ctx.wait(`!!document.querySelector('.tab-rail-home')`, 3000, 'the way back home to show')
      await ctx.click('.tab-rail-home')
      await ctx.wait(`${host}.getTabs().then((t) => t.find((x) => x.id === ${JSON.stringify(mail.id)})?.url === ${JSON.stringify(`${origin}/mail`)})`, 5000, 'the pinned tab to go home')
      // ⌘W on a pinned tab unloads it: it stays in place, asleep, back at home; the next tab shows.
      await (await ctx.page('/mail')).evaluate(`location.href = '${elsewhere}/elsewhere'`)
      await ctx.delay(1500)
      const before = (await tabs()).length
      await ctx.keyInPage('/elsewhere', 'W', ['meta'])
      await ctx.delay(1200)
      const after = await tabs()
      pinned = after.find((tab) => tab.id === mail.id)
      expect(after.length === before, `⌘W on a pinned tab closed it (${before} → ${after.length} tabs).`)
      expect(pinned.asleep && !pinned.active && pinned.url === `${origin}/mail`, `After ⌘W the pinned tab is ${JSON.stringify(pinned)}.`)
      // Back at home, it no longer carries the title of the page it was on (nor shows it while home loads).
      expect(pinned.title !== 'Page /elsewhere', 'After ⌘W the pinned tab, back at home, is still titled after the page it left.')
      expect(!(await ctx.main(`electron.webContents.getAllWebContents().some((c) => c.getURL().includes('/elsewhere'))`)), 'The pinned tab\'s page is still loaded after ⌘W.')
      await ctx.wait(`!!document.querySelector('.tab-rail-item.is-asleep')`, 3000, 'the unloaded tab to look asleep')
      // Its next click opens it at home.
      await ctx.evaluate(`${host}.activateTab(${JSON.stringify(mail.id)}).then(() => true)`)
      await ctx.wait(`${host}.getTabs().then((t) => { const x = t.find((y) => y.id === ${JSON.stringify(mail.id)}); return x.active && !x.asleep })`, 5000, 'the pinned tab to wake')
      const homeLoaded = () => ctx.main(`electron.webContents.getAllWebContents().some((c) => c.getURL() === ${JSON.stringify(`${origin}/mail`)})`)
      for (let i = 0; i < 40 && !(await homeLoaded()); i += 1) await ctx.delay(200)
      expect(await homeLoaded(), 'The pinned tab did not load its home when clicked.')
      // Saved for the next launch with its home (wait for the file rather than a fixed time).
      const homeSaved = () => { try { return JSON.parse(readFileSync(join(ctx.profile, 'browser-state.v1.json'), 'utf8')).tabs.some((tab) => tab.pinned && tab.home === `${origin}/mail`) } catch { return false } }
      for (let i = 0; i < 50 && !homeSaved(); i += 1) await ctx.delay(200)
      expect(homeSaved(), 'The pinned tab\'s home was not saved.')
      await axeAudit(ctx, 'the tab rail with a pinned tab', '.tab-rail')
      // Unpinning forgets the home.
      await ctx.evaluate(`${host}.setTabPinned(${JSON.stringify(mail.id)}, false).then(() => true)`)
      await ctx.delay(400)
      expect(!(await tabs()).find((tab) => tab.id === mail.id).home, 'Unpinning kept the home.')
      return 'Pinned at home; same-site moves stay home, another site offers the way back; ⌘W unloads it in place and it reopens at home; saved with its home.'
    } finally {
      server.close()
    }
  },
  async TAB_SLEEP(ctx) {
    // Started with a "minute" of 200 ms (TAB_SLEEP.env below), so "15 minutes" is 3 seconds.
    const { server, origin } = await tabSite()
    const host = 'window.intoponet.browserHost'
    const tabs = async () => JSON.parse(await ctx.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
    const rendererMemory = () => ctx.main(`(() => {
      const pids = new Set(electron.webContents.getAllWebContents().filter((c) => /^https?:/.test(c.getURL()) && c.getURL().includes('127.0.0.1')).map((c) => c.getOSProcessId()))
      return electron.app.getAppMetrics().filter((m) => pids.has(m.pid)).reduce((sum, m) => sum + m.memory.workingSetSize, 0)
    })()`)
    try {
      await ctx.evaluate(`window.intoponet.browsing.setTabSleep('never').then(() => true)`)
      // A tab two pages deep, scrolled down; a tab with typed text; eight more; and the one in front.
      await openPage(ctx, `${origin}/first`, 1500)
      await (await ctx.page('/first')).evaluate(`location.href = '${origin}/second'`)
      await ctx.delay(1500)
      await (await ctx.page('/second')).evaluate(`window.scrollTo(0, 1400); true`)
      await openPage(ctx, `${origin}/typed`, 1500)
      await (await ctx.page('/typed')).evaluate(`document.getElementById('field').value = 'half a sentence'; true`)
      for (let i = 0; i < 8; i += 1) await openPage(ctx, `${origin}/other-${i}`, 700)
      await openPage(ctx, `${origin}/front`, 2000)
      const [deep, typed] = await tabs()
      const awake = await rendererMemory()
      // Sleep after "15 minutes".
      await ctx.evaluate(`window.intoponet.browsing.setTabSleep('15m').then(() => true)`)
      await ctx.wait(`${host}.getTabs().then((t) => t.filter((x) => x.asleep).length >= 9)`, 45_000, 'the background tabs to sleep')
      const now = await tabs()
      const state = (id) => now.find((tab) => tab.id === id)
      expect(state(deep.id).asleep, 'The background tab did not sleep.')
      expect(!state(typed.id).asleep, 'A tab with typed text was put to sleep.')
      expect(!now.find((tab) => tab.active).asleep, 'The tab in front was put to sleep.')
      expect(!(await ctx.main(`electron.webContents.getAllWebContents().some((c) => c.getURL().includes('/second'))`)), 'A sleeping tab\'s page is still loaded.')
      await ctx.wait(`document.querySelectorAll('.tab-rail-item.is-asleep').length >= 9`, 3000, 'sleeping tabs to look asleep')
      await ctx.delay(1500)
      const asleep = await rendererMemory()
      expect(asleep <= awake / 2, `Memory of the tabs' pages went from ${Math.round(awake / 1024)} MB to ${Math.round(asleep / 1024)} MB, not half.`)
      // Shown again, it wakes where it was: same page, back list and scroll position.
      await ctx.evaluate(`${host}.activateTab(${JSON.stringify(deep.id)}).then(() => true)`)
      await ctx.wait(`${host}.getTabs().then((t) => { const x = t.find((y) => y.id === ${JSON.stringify(deep.id)}); return x.active && !x.asleep && x.url.endsWith('/second') })`, 8000, 'the tab to wake on its page')
      const page = await ctx.page('/second')
      // Scroll comes back once the page has loaded: wait for it (a busy Mac takes longer) rather than a fixed time.
      let scroll = await page.evaluate('window.scrollY')
      for (let i = 0; i < 40 && Math.abs(scroll - 1400) >= 60; i += 1) {
        await ctx.delay(200)
        scroll = await page.evaluate('window.scrollY')
      }
      expect(Math.abs(scroll - 1400) < 60, `The woken tab is scrolled to ${scroll}, not where it was (1400).`)
      await ctx.wait(`${host}.getState().then((s) => s.canGoBack)`, 5000, 'the woken tab to offer Back').catch(() => undefined)
      const panel = JSON.parse(await ctx.evaluate(`${host}.getState().then((s) => JSON.stringify(s))`))
      expect(panel.canGoBack, 'The woken tab lost its back history.')
      await ctx.evaluate(`window.intoponet.browsing.setTabSleep('never').then(() => true)`)
      // A background page that does not answer (busy for a while) stays awake without holding up the other tabs' sleep.
      await ctx.evaluate(`${host}.getTabs().then((t) => Promise.all(t.filter((x) => !x.active).map((x) => ${host}.closeTab(x.id)))).then(() => true)`)
      await openPage(ctx, `${origin}/busy`, 800)
      await openPage(ctx, `${origin}/later`, 800)
      await openPage(ctx, `${origin}/last`, 800)
      await (await ctx.page('/busy')).evaluate(`setTimeout(() => { const end = Date.now() + 14000; while (Date.now() < end) {} }, 200); true`)
      await ctx.delay(500)
      await ctx.evaluate(`window.intoponet.browsing.setTabSleep('15m').then(() => true)`)
      await ctx.wait(`${host}.getTabs().then((t) => t.some((x) => x.url.endsWith('/later') && x.asleep))`, 10_000, 'a background tab to sleep while another background page was busy')
      await ctx.evaluate(`window.intoponet.browsing.setTabSleep('never').then(() => true)`)
      // Woken while its page is slow to come back, then sent to an address that fails before it has: that
      // address's error stays, and the old page never loads over it.
      let slowNow = false
      const slowSite = createServer((request, response) => {
        if (request.url.startsWith('/broken')) return request.socket.destroy()
        setTimeout(() => {
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          response.end(`<!doctype html><title>Slow ${request.url}</title><p>${request.url}`)
        }, slowNow ? 3000 : 0)
      })
      await new Promise((resolve) => slowSite.listen(0, '127.0.0.1', resolve))
      const slowOrigin = `http://127.0.0.1:${slowSite.address().port}`
      try {
        await openPage(ctx, `${slowOrigin}/earlier`, 1000)
        await (await ctx.page('/earlier')).evaluate(`location.href = '${slowOrigin}/woken'`)
        await ctx.wait(`${host}.getTabs().then((t) => t.some((x) => x.url.endsWith('/woken') && !x.loading))`, 8000, 'the second page to load')
        await openPage(ctx, `${origin}/in-front`, 800)
        await ctx.evaluate(`window.intoponet.browsing.setTabSleep('15m').then(() => true)`)
        await ctx.wait(`${host}.getTabs().then((t) => t.some((x) => x.url.endsWith('/woken') && x.asleep))`, 15_000, 'the slow page\'s tab to sleep')
        await ctx.evaluate(`window.intoponet.browsing.setTabSleep('never').then(() => true)`)
        // Closed while asleep, ⇧⌘T brings it back with its back list.
        await ctx.evaluate(`${host}.closeTab(${JSON.stringify((await tabs()).find((tab) => tab.url.endsWith('/woken')).id)}).then(() => true)`)
        await ctx.delay(300)
        await ctx.evaluate(`${host}.reopenClosedTab().then(() => true)`)
        await ctx.wait(`${host}.getState().then((s) => s.url.endsWith('/woken') && !s.isLoading)`, 8000, 'the tab closed while asleep to reopen')
        expect((await panelState(ctx)).canGoBack, 'A tab closed while asleep came back without its back list.')
        await ctx.evaluate(`${host}.activateTab(${JSON.stringify((await tabs()).find((tab) => tab.url.endsWith('/in-front')).id)}).then(() => true)`)
        await ctx.evaluate(`window.intoponet.browsing.setTabSleep('15m').then(() => true)`)
        await ctx.wait(`${host}.getTabs().then((t) => t.some((x) => x.url.endsWith('/woken') && x.asleep))`, 15_000, 'the reopened tab to sleep again')
        await ctx.evaluate(`window.intoponet.browsing.setTabSleep('never').then(() => true)`)
        slowNow = true
        const woken = (await tabs()).find((tab) => tab.url.endsWith('/woken'))
        await ctx.evaluate(`${host}.activateTab(${JSON.stringify(woken.id)}).then(() => true)`)
        await ctx.delay(400)
        await ctx.evaluate(`${host}.navigate(${JSON.stringify(`${slowOrigin}/broken`)}).then(() => true, () => true)`)
        await ctx.wait(`${host}.getTabs().then((t) => t.some((x) => x.id === ${JSON.stringify(woken.id)} && x.url.endsWith('/broken')))`, 8000, 'the address typed while the tab woke to fail in it (not be replaced by its old page)')
        // The old page would have come back 3 s after the failure.
        await ctx.delay(4500)
        const after = (await tabs()).find((tab) => tab.id === woken.id)
        expect(after?.url.endsWith('/broken'), `An address typed while the tab was waking was replaced by its old page (${after?.url}).`)
        expect(!(await ctx.main(`electron.webContents.getAllWebContents().some((c) => c.getURL().endsWith('/woken'))`)), 'The old page loaded again over the address typed while the tab was waking.')
      } finally {
        slowSite.close()
      }
      return `9 background tabs slept (typed text and the front tab stayed awake); their pages' memory ${Math.round(awake / 1024)} MB → ${Math.round(asleep / 1024)} MB; woke on the same page, scroll and back list; a busy background page did not hold up the others; a tab closed asleep reopened with its back list; an address typed while a tab woke was not replaced by its old page.`
    } finally {
      server.close()
    }
  },
  async RECENT_TABS(ctx) {
    const { server, origin } = await tabSite()
    const host = 'window.intoponet.browserHost'
    const tabs = async () => JSON.parse(await ctx.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
    const activeTitle = async () => (await tabs()).find((tab) => tab.active)?.title
    const inPage = (urlPart, input) => ctx.main(`(() => {
      const page = electron.webContents.getAllWebContents().find((c) => c.getURL().includes(${JSON.stringify(urlPart)}))
      if (!page) return false
      page.sendInputEvent(${JSON.stringify(input)})
      return true
    })()`)
    const ctrlTab = (urlPart, shift = false) => inPage(urlPart, { type: 'keyDown', keyCode: 'Tab', modifiers: shift ? ['control', 'shift'] : ['control'] })
    // ⌃'s release as the page sees it (the browser's own key events are not sent for a lone modifier).
    const releaseCtrl = async (urlPart) => (await ctx.page(urlPart)).evaluate(`dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft' })); true`)
    const switcherShowing = () => ctx.main(`electron.BrowserWindow.getAllWindows()[0].contentView.children.some((v) => v.webContents?.getURL().startsWith('data:text/html'))`)
    const announced = () => ctx.evaluate(`[...document.querySelectorAll('[aria-live=assertive]')].map((e) => e.textContent).join(' ')`)
    try {
      await ctx.evaluate(`window.intoponet.browsing.setTabSwitchOrder('recent').then(() => true)`)
      for (const name of ['a', 'b', 'c', 'd']) await openPage(ctx, `${origin}/${name}`, 900)
      const [a, b] = await tabs()
      // Use b, then d again: most recent first is now d, b, c, a.
      await ctx.evaluate(`${host}.activateTab(${JSON.stringify(b.id)}).then(() => true)`)
      await ctx.delay(400)
      const d = (await tabs())[3]
      await ctx.evaluate(`${host}.activateTab(${JSON.stringify(d.id)}).then(() => true)`)
      await ctx.delay(600)
      // Hold ⌃ and press Tab: the switcher opens on b (the last tab used), shown over the page and announced.
      await ctrlTab('/d')
      await ctx.wait(`[...document.querySelectorAll('[aria-live=assertive]')].some((e) => e.textContent.includes('Page /b'))`, 3000, 'the switcher to announce the previous tab')
      for (let i = 0; i < 20 && !(await switcherShowing()); i += 1) await ctx.delay(100)
      expect(await switcherShowing(), 'The switcher is not drawn over the page.')
      expect(await activeTitle() === 'Page /d', 'The tab changed before ⌃ was released.')
      await ctrlTab('/d')
      await ctx.wait(`[...document.querySelectorAll('[aria-live=assertive]')].some((e) => e.textContent.includes('Page /c, tab 3 of 4'))`, 3000, 'Tab to move to the next most recent')
      await ctrlTab('/d', true)
      await ctx.wait(`[...document.querySelectorAll('[aria-live=assertive]')].some((e) => e.textContent.includes('Page /b'))`, 3000, '⌃⇧Tab to move back')
      // Releasing ⌃ shows it.
      await releaseCtrl('/d')
      await ctx.delay(700)
      expect(await activeTitle() === 'Page /b', `Releasing ⌃ showed ${await activeTitle()}, not the highlighted tab.`)
      expect(!(await switcherShowing()), 'The switcher stayed after ⌃ was released.')
      // A quick ⌃Tab goes back to the tab used just before.
      await ctrlTab('/b')
      await releaseCtrl('/b')
      await ctx.delay(700)
      expect(await activeTitle() === 'Page /d', `A quick ⌃Tab went to ${await activeTitle()}, not the previous tab.`)
      // Escape keeps the current tab.
      await ctrlTab('/d')
      await ctx.delay(300)
      await inPage('/d', { type: 'keyDown', keyCode: 'Escape', modifiers: ['control'] })
      await ctx.delay(300)
      await releaseCtrl('/d')
      await ctx.delay(600)
      expect(await activeTitle() === 'Page /d', `After Escape the tab is ${await activeTitle()}.`)
      expect(!(await switcherShowing()), 'Escape did not close the switcher.')
      // With the app's own interface focused, releasing ⌃ there lands too.
      await ctx.evaluate(`${host}.cycleTabs('next').then(() => true)`)
      await ctx.delay(300)
      await ctx.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 0 })
      await ctx.delay(700)
      expect(await activeTitle() === 'Page /b', `Releasing ⌃ in the app interface showed ${await activeTitle()}.`)
      // In tab-bar order, ⌃Tab moves to the neighbour at once.
      await ctx.evaluate(`window.intoponet.browsing.setTabSwitchOrder('strip').then(() => true)`)
      await ctrlTab('/b')
      await ctx.delay(600)
      expect(await activeTitle() === 'Page /c', `In tab-bar order ⌃Tab went to ${await activeTitle()}.`)
      expect(!(await switcherShowing()), 'The switcher opened in tab-bar order.')
      void a
      return 'Hold ⌃, Tab and ⌃⇧Tab step most-recent-first over the page (announced); release shows it, a quick ⌃Tab goes back, Escape keeps the tab; tab-bar order unchanged.'
    } finally {
      server.close()
    }
  },
  async SIDEBAR_TABS(ctx) {
    const { server, origin } = await tabSite()
    const host = 'window.intoponet.browserHost'
    const tabs = async () => JSON.parse(await ctx.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
    const pageBounds = async () => JSON.parse(await ctx.main(`JSON.stringify(electron.BrowserWindow.getAllWindows()[0].contentView.children.find((v) => v.webContents?.getURL().startsWith('http'))?.getBounds() ?? null)`))
    const sidebar = async () => JSON.parse(await ctx.evaluate(`${host}.getTabSidebar().then((s) => JSON.stringify(s))`))
    const railShown = () => ctx.evaluate(`!!document.querySelector('.tab-rail')`)
    try {
      for (const name of ['mail', 'news', 'notes']) await openPage(ctx, `${origin}/${name}`, 1000)
      const [mail] = await tabs()
      await ctx.evaluate(`${host}.setTabPinned(${JSON.stringify(mail.id)}, true).then(() => true)`)
      // Kept open: Pinned and Open sections, the New tab row at the end.
      await ctx.click('button[aria-label="Pin tabs open"]')
      await ctx.wait(`document.querySelector('.tab-rail.is-pinned') && [...document.querySelectorAll('.tab-rail-section')].map((e) => e.textContent).join(',') === 'Pinned,Open'`, 3000, 'the sidebar to show Pinned and Open sections')
      // It stays in full width, and the page starts after it; the bottom dock lists no tabs.
      await ctx.click('button[aria-label="Full width"]')
      await ctx.delay(1200)
      expect(await railShown(), 'The tab sidebar went away in full width.')
      const rail = JSON.parse(await ctx.evaluate(`JSON.stringify(document.querySelector('.tab-rail').getBoundingClientRect())`))
      let bounds = await pageBounds()
      expect(bounds && bounds.x >= rail.right, `In full width the page (x ${bounds?.x}) is under the sidebar (right ${rail.right}).`)
      expect(!(await ctx.evaluate(`!!document.querySelector('.tab-dock [role="tab"]')`)), 'Tabs are shown twice (sidebar and dock).')
      // Its edge resizes it, and the width is kept.
      const edge = JSON.parse(await ctx.evaluate(`JSON.stringify(document.querySelector('.tab-rail-resize').getBoundingClientRect())`))
      const at = { x: edge.x + edge.width / 2, y: edge.y + 80 }
      await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y })
      await ctx.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 })
      for (let step = 1; step <= 6; step += 1) {
        await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x + step * 15, y: at.y, button: 'left', buttons: 1 })
        await ctx.delay(30)
      }
      await ctx.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x + 90, y: at.y, button: 'left', buttons: 0, clickCount: 1 })
      await ctx.delay(900)
      const resized = await sidebar()
      expect(resized.mode === 'open' && resized.width >= 310, `Dragging the edge left the sidebar ${JSON.stringify(resized)}.`)
      expect((await pageBounds()).x > bounds.x + 60, 'The page did not make room for the wider sidebar.')
      // ⌃⌘S hides it (the page takes the whole width)…
      await ctx.keyInPage('/notes', 'S', ['control', 'meta'])
      await ctx.wait(`!document.querySelector('.tab-rail')`, 3000, '⌃⌘S to hide the sidebar')
      await ctx.delay(900)
      expect((await sidebar()).mode === 'hidden', 'The hidden sidebar was not saved.')
      expect((await pageBounds()).x <= 2, 'With the sidebar hidden the page does not start at the window edge.')
      // …and resting the pointer at the left edge brings it back over the page, until the pointer leaves.
      await ctx.main(`(() => { const p = electron.webContents.getAllWebContents().find((c) => c.getURL().includes('/notes')); for (const x of [40, 3, 2]) p.sendInputEvent({ type: 'mouseMove', x, y: 300 }); return true })()`)
      await ctx.wait(`!!document.querySelector('.tab-rail.is-open')`, 3000, 'the left edge to bring the sidebar back')
      await ctx.delay(600)
      await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1100, y: 400 })
      await ctx.wait(`!document.querySelector('.tab-rail')`, 3000, 'the sidebar to go once the pointer left')
      // ⌃⌘S shows it again as it was; it is kept for the next launch.
      await ctx.keyInPage('/notes', 'S', ['control', 'meta'])
      await ctx.wait(`!!document.querySelector('.tab-rail.is-pinned')`, 3000, '⌃⌘S to show the sidebar again')
      // The save waits until the page stops moving (each bounds change while the sidebar slides in defers it),
      // which takes longer on a busy Mac: wait for the file rather than a fixed time.
      const savedSidebar = () => { try { return JSON.parse(readFileSync(join(ctx.profile, 'browser-state.v1.json'), 'utf8')).sidebar } catch { return null } }
      for (let i = 0; i < 25 && !(savedSidebar()?.mode === 'open' && savedSidebar().width === resized.width); i += 1) await ctx.delay(200)
      const saved = { sidebar: savedSidebar() }
      expect(saved.sidebar?.mode === 'open' && saved.sidebar.width === resized.width, `Saved sidebar: ${JSON.stringify(saved.sidebar)}.`)
      // Keyboard: arrows move between tabs in it.
      await ctx.evaluate(`document.querySelector('.tab-rail [role="tab"][tabindex="0"]').focus(); true`)
      await ctx.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
      await ctx.delay(200)
      expect(await ctx.evaluate(`document.activeElement?.getAttribute('role') === 'tab'`), 'Arrow keys do not move between tabs in the sidebar.')
      await axeAudit(ctx, 'the tab sidebar in full width', '.tab-rail')
      await ctx.click('button[aria-label="Exit full width"]').catch(() => undefined)
      return `Kept open in full width with Pinned and Open sections (page after it, no tabs twice); resized to ${resized.width}px and kept; ⌃⌘S hid it, the left edge peeked it back, ⌃⌘S restored it; keyboard and axe clean.`
    } finally {
      server.close()
    }
  },
  async BROWSER_IMPORT(ctx) {
    await buildImportFixtures(IMPORT_ROOT)
    const host = 'window.intoponet.browserHost'
    const section = `document.querySelector('.browser-import')`
    const sectionText = () => ctx.evaluate(`${section}?.innerText ?? ''`)
    const library = async () => JSON.parse(await ctx.evaluate(`${host}.readPrivateLibrary().then((r) => r.status === 'ok' && r.payload ? r.payload : '{"bookmarks":[],"collections":[]}')`))
    const tabs = async () => JSON.parse(await ctx.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
    const historyTotal = () => ctx.evaluate(`window.intoponet.history.search('example.org/imported').then((r) => r.total)`)
    const passwordCount = () => ctx.evaluate(`window.intoponet.passwords.list().then((l) => l.length)`)
    const choose = async (label) => {
      expect(await ctx.evaluate(`(() => { const input = [...document.querySelectorAll('.browser-import input[type=radio]')].find((i) => i.parentElement.innerText.includes(${JSON.stringify(label)})); if (!input) return false; input.focus(); input.click(); return true })()`), `${label} is not listed under Import.`)
      await ctx.wait(`(${section}?.innerText ?? '').includes('What to bring') && !(${section}?.innerText ?? '').includes('Looking at')`, 15_000, `the preview for ${label}`)
    }
    const ticked = () => ctx.evaluate(`Object.fromEntries([...document.querySelectorAll('.browser-import-choice input')].map((i) => [i.parentElement.innerText.split(' ')[0], i.checked]))`)
    const tick = (name) => ctx.evaluate(`(() => { const input = [...document.querySelectorAll('.browser-import-choice input')].find((i) => i.parentElement.innerText.startsWith(${JSON.stringify(name)})); if (!input.checked) input.click(); return true })()`)
    /** Import with the keyboard: focus the button and press Enter. */
    const importNow = async (browser) => {
      await ctx.evaluate(`(() => { [...document.querySelectorAll('.browser-import button')].find((b) => b.innerText.trim() === 'Import').focus(); return true })()`)
      await ctx.press('Enter')
      await ctx.wait(`!!document.querySelector('.browser-import-result') || !!document.querySelector('.browser-import .settings-error')`, 30_000, `the import from ${browser} to finish`)
      const error = await ctx.evaluate(`document.querySelector('.browser-import .settings-error')?.innerText ?? ''`)
      expect(!error, `The import from ${browser} failed: ${error}`)
      await ctx.delay(1500)
      return ctx.evaluate(`document.querySelector('.browser-import-result').innerText`)
    }
    try {
      await openPanel(ctx, 'Settings')
      await ctx.wait(`!!${section}`, 5000, 'the Import from another browser section in Settings')
      await ctx.evaluate(`(() => { ${section}.scrollIntoView({ block: 'start' }); return true })()`)
      expect(await ctx.click('.browser-import button', 'Find browsers'), 'Import has no way to look for browsers.')
      await ctx.wait(`document.querySelectorAll('.browser-import input[type=radio]').length >= 2`, 10_000, 'the browsers found on this Mac')
      const listed = await sectionText()
      expect(listed.includes('Google Chrome · Person 1 (Default)') && listed.includes('Arc · Default'), `The detected profiles are not listed: ${listed}`)

      // Chrome: the preview counts every category before anything is written.
      await choose('Google Chrome')
      const preview = await sectionText()
      for (const piece of ['4 pages in 4 collections', 'History 2 pages', 'Passwords 1 sign-in', 'session files']) expect(preview.includes(piece), `The Chrome preview is missing "${piece}": ${preview}`)
      const defaults = await ticked()
      expect(defaults.Bookmarks && !defaults.History && !defaults.Passwords, `History and passwords must be off until ticked (${JSON.stringify(defaults)}).`)
      expect((await library()).bookmarks.length === 0 && (await passwordCount()) === 0 && (await historyTotal()) === 0, 'Something was written before Import was pressed.')
      await tick('History')
      await tick('Passwords')
      expect((await sectionText()).includes('Chrome Safe Storage'), 'Ticking Passwords does not say macOS will ask for Keychain access.')
      await ctx.shot('chrome-preview')
      await axeAudit(ctx, 'Settings › Import (preview)', '.browser-import')
      const chromeResult = await importNow('Chrome')
      await ctx.shot('chrome-imported')
      expect(chromeResult.includes('4 pages into your library') && chromeResult.includes('2 history pages') && chromeResult.includes('1 password'), `Unexpected Chrome result: ${chromeResult}`)
      const afterChrome = await library()
      const labels = afterChrome.collections.map((c) => c.label)
      for (const label of ['Bookmarks bar', 'Travel', 'Travel › Japan', 'Other bookmarks']) expect(labels.includes(label), `No "${label}" collection after importing (have ${labels.join(', ')}).`)
      expect(await historyTotal() === 2, 'The imported history pages are not in History.')
      const logins = JSON.parse(await ctx.evaluate(`window.intoponet.passwords.list().then((l) => JSON.stringify(l))`))
      expect(logins.length === 1 && logins[0].origin === 'https://accounts.example.com' && logins[0].username === 'tester@example.com', `The imported password is not saved (${JSON.stringify(logins)}).`)
      expect(!readFileSync(join(ctx.profile, 'passwords.v1.seal')).includes(IMPORT_PASSWORD), 'The password file holds the imported password as plain text.')
      await ctx.wait(`(document.querySelector('.password-settings')?.innerText ?? '').includes('accounts.example.com')`, 5000, 'Settings › Passwords to list the imported sign-in')

      // Arc: spaces' pinned tabs become pinned tabs with their home; folders and spaces become collections.
      await choose('Arc')
      // Spaces as workspaces is IMPORT_WORKSPACES's check: here the flat import into the open workspace.
      await ctx.evaluate(`(() => { const input = [...document.querySelectorAll('.browser-import-choice input')].find((i) => i.parentElement.innerText.startsWith('Workspaces')); if (input?.checked) input.click(); return true })()`)
      const arcPreview = await sectionText()
      expect(arcPreview.includes('Pinned tabs 2 tabs') && arcPreview.includes('Open tabs 1 tab'), `The Arc preview is wrong: ${arcPreview}`)
      const arcResult = await importNow('Arc')
      expect(arcResult.includes('2 pinned tabs') && arcResult.includes('1 open tab'), `Unexpected Arc result: ${arcResult}`)
      const open = await tabs()
      const pinned = open.filter((tab) => tab.pinned)
      expect(pinned.length === 2 && pinned.every((tab) => tab.home === tab.url && tab.asleep), `Pinned tabs did not come over with their home, unloaded: ${JSON.stringify(pinned)}`)
      expect(open.some((tab) => !tab.pinned && tab.url === 'https://news.example.com/today'), 'The open tab did not come over.')
      const arcLabels = (await library()).collections.map((c) => c.label)
      for (const label of ['Work', 'Home', 'Work › Reading']) expect(arcLabels.includes(label), `No "${label}" collection from Arc (have ${arcLabels.join(', ')}).`)
      await ctx.shot('arc-imported')

      // Twice: nothing doubles.
      const before = { library: await library(), tabs: (await tabs()).length, history: await historyTotal(), passwords: await passwordCount() }
      const again = await importNow('Arc again')
      expect(again.includes('Nothing new'), `A second Arc import added something: ${again}`)
      await choose('Google Chrome')
      await tick('History')
      await tick('Passwords')
      const againChrome = await importNow('Chrome again')
      expect(againChrome.includes('Nothing new') && againChrome.includes('already'), `A second Chrome import added something: ${againChrome}`)
      const after = { library: await library(), tabs: (await tabs()).length, history: await historyTotal(), passwords: await passwordCount() }
      expect(after.library.bookmarks.length === before.library.bookmarks.length && after.library.collections.length === before.library.collections.length, 'A second import added bookmarks or collections.')
      expect(after.library.collections.every((c) => new Set(c.memberUrls).size === c.memberUrls.length), 'A collection lists a page twice.')
      expect(after.tabs === before.tabs && after.history === before.history && after.passwords === before.passwords, `A second import doubled something: ${JSON.stringify({ before: { ...before, library: undefined }, after: { ...after, library: undefined } })}`)
      await ctx.shot('second-run')
      await axeAudit(ctx, 'Settings › Import (results)', '.browser-import')
      return 'Found Chrome (Person 1) and Arc; previewed counts with history and passwords off; imported 4 bookmarks as 4 collections, 2 history pages and 1 sealed password from Chrome, and 2 pinned tabs (with homes), 1 open tab and the Work, Home and Work › Reading collections from Arc; a second run added nothing; keyboard and axe clean.'
    } finally {
      rmSync(IMPORT_ROOT, { recursive: true, force: true })
    }
  },

  async TOUR(ctx) {
    await keepDrawing(ctx)
    // Every step's spotlight must find what it shows (a renamed button would leave the tour pointing at nothing).
    await ctx.waitForNews()
    await ctx.wait(`!!document.querySelector('.story-highest')`, 60_000, 'story mountains to rise')
    const tabList = `window.intoponet.browserHost.getTabs().then((t) => t.map((x) => x.id).sort().join(','))`
    const tabsBefore = await ctx.evaluate(tabList)
    // The sidebar as saved, and the workspaces: the tour changes neither.
    const kept = `Promise.all([window.intoponet.browserHost.getTabSidebar(), window.intoponet.workspaces.get().then((s) => s.workspaces.map((w) => w.id))]).then((r) => JSON.stringify(r))`
    // With the sidebar hidden (⌃⌘S), the tab and workspace steps must still open it onto what they point at.
    await ctx.main(`(() => { electron.BrowserWindow.getAllWindows()[0].webContents.send('browser-host:event', { type: 'shortcut', action: 'toggle-tab-sidebar' }); return true })()`)
    await ctx.wait(`window.intoponet.browserHost.getTabSidebar().then((s) => s?.mode === 'hidden')`, 5000, '⌃⌘S to hide the sidebar before the tour')
    const keptBefore = await ctx.evaluate(kept)
    // The Olds step moves on as soon as The Olds has looked, even when it finds nothing: here Wikipedia cannot be reached.
    // First, before any story's history is kept (the Olds step looks up the tour's own story even when jumped to). How long
    // The Olds takes to give up depends on the story and the network; the step must not wait longer than that.
    await ctx.main(`(() => {
      const dns = process.mainModule.require('dns')
      dns.__tourLookup ??= dns.lookup
      const lookup = dns.__tourLookup
      dns.lookup = function (host, options, callback) {
        if (typeof options === 'function') { callback = options; options = {} }
        if (/(^|\\.)(wikipedia|wikidata|wikimedia)\\.org$/.test(host)) return process.nextTick(callback, Object.assign(new Error('getaddrinfo ENOTFOUND ' + host), { code: 'ENOTFOUND', hostname: host }))
        return lookup.call(this, host, options, callback)
      }
      return true
    })()`)
    let offline
    try {
      await ctx.click('.settings-button')
      await ctx.click('button', 'Take the tour')
      await ctx.wait(`!!document.querySelector('.tour-card')`, 5000, 'the tour to start')
      await ctx.evaluate(`(() => {
        const step = window.__oldsStep = { start: performance.now() }
        const timer = setInterval(() => {
          if (!step.looked && document.querySelector('.olds-sheet') && !document.querySelector('.olds-sheet .olds-status[role="status"]')) step.looked = Math.round(performance.now() - step.start)
          if (document.querySelector('.tour-next')?.textContent.includes('Showing')) step.showing = true
          else if (step.showing) {
            step.ms = Math.round(performance.now() - step.start)
            step.olds = (document.querySelector('.olds-sheet .olds-status') ?? document.querySelector('.olds-sheet h2'))?.innerText ?? 'not open'
            clearInterval(timer)
          }
        }, 50)
        ;[...document.querySelectorAll('.tour-progress button')].find((b) => b.getAttribute('aria-label').endsWith(': The history behind the news')).click()
        return true
      })()`)
      await ctx.wait(`!!window.__oldsStep.ms`, 45_000, 'The Olds step to finish with Wikipedia unreachable')
      offline = JSON.parse(await ctx.evaluate(`JSON.stringify(window.__oldsStep)`))
      expect(offline.looked && offline.ms - offline.looked < 2_000, `With Wikipedia unreachable, The Olds step kept showing for ${Math.round(offline.ms / 1000)} s, ${offline.looked ? `${((offline.ms - offline.looked) / 1000).toFixed(1)} s after The Olds had looked` : 'and The Olds never finished looking'} (The Olds: "${offline.olds}").`)
      await ctx.press('Escape')
      await ctx.wait(`!document.querySelector('.tour-card') && !document.querySelector('.olds-sheet')`, 5000, 'the tour to close on Escape')
    } finally {
      await ctx.main(`(() => { const dns = process.mainModule.require('dns'); if (dns.__tourLookup) dns.lookup = dns.__tourLookup; return true })()`)
    }
    await ctx.click('.settings-button')
    await ctx.click('button', 'Take the tour')
    await ctx.wait(`!!document.querySelector('.tour-card')`, 5000, 'the tour to start again')
    const total = Number((await ctx.evaluate(`document.querySelector('.tour-count').textContent`)).split(' of ')[1])
    const missed = []
    // The step's own name (its progress dot); the card's heading animates from one step to the next.
    const stepTitle = `(document.querySelector('.tour-progress [aria-current="step"]')?.getAttribute('aria-label') ?? '').replace(/^Step \\d+: /, '')`
    // What a step shows: the selector its spotlight found, whether its card is on top, and what is open behind it.
    const scene = `JSON.stringify({ title: ${stepTitle}, onTop: (() => { const r = document.querySelector('.tour-card').getBoundingClientRect(); return !!document.elementFromPoint(r.left + r.width / 2, r.top + 30)?.closest('.tour') })(), lit: document.querySelector('.tour-spotlight')?.dataset.target ?? null, page: !!document.querySelector('.browser-actions'), olds: !!document.querySelector('.olds-sheet'), bookmarks: !!document.querySelector('.bookmark-pane'), paneCovered: (() => { const pane = document.querySelector('.bookmark-pane')?.getBoundingClientRect(); return !!pane && [...document.querySelectorAll('.story-highest, .globe-panel-pill')].some((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > pane.left && r.left < pane.right && r.bottom > pane.top && r.top < pane.bottom }) })(), library: !!document.querySelector('.bookmark-drawer'), knowledge: !!document.querySelector('.knowledge-sheet'), rail: document.querySelector('.tab-rail')?.classList.contains('is-open') ?? null, typed: document.querySelector('.command-input input')?.value ?? '' })`
    const settle = async (step) => {
      await ctx.wait(`document.querySelector('.tour-count')?.textContent.startsWith('${step} of') && !document.querySelector('.tour-next')?.textContent.includes('Showing')`, 45_000, `tour step ${step} to finish showing`)
      await ctx.wait(`document.getElementById('tour-title')?.textContent === ${stepTitle}`, 5000, `tour step ${step}'s card`)
      await ctx.delay(700)
      const state = JSON.parse(await ctx.evaluate(scene))
      // A web page is a native view drawn above the whole interface: shown during the tour, it covers the card and the spotlight.
      state.pageOnScreen = await ctx.main(`electron.BrowserWindow.getAllWindows()[0].contentView.children.some((view) => view.getVisible() && /^https?:/.test(view.webContents?.getURL?.() ?? ''))`)
      return state
    }
    const shown = []
    // The tour's page is never saved with the open tabs (a crash or quit mid-tour would bring it back).
    const tourPage = 'en.wikipedia.org/wiki/Earth'
    const stateFile = join(ctx.profile, 'browser-state.v1.json')
    let savedWithTabs = null
    let tourParity = null
    // Its page runs in a temporary session of its own (not the shared one, not private), set up as every page session is.
    const tourSessionNow = () => ctx.main(`(async () => {
      const page = electron.webContents.getAllWebContents().find((c) => !c.isDestroyed() && c.getURL().includes(${JSON.stringify(tourPage)}))
      if (!page) return 'null'
      const others = [electron.session.defaultSession, electron.session.fromPartition('persist:intoponet-default'), electron.session.fromPartition('intoponet-private')]
      return JSON.stringify({ own: !others.includes(page.session), temporary: !page.session.isPersistent() && !page.session.storagePath, spellcheck: page.session.isSpellCheckerEnabled(), cookie: (await page.session.cookies.get({ name: 'intoponet_tour' })).length })
    })()`).then(JSON.parse)
    let tourSession = null
    let tourAfterCrash = null
    for (let step = 1; step <= total; step += 1) {
      const state = shown[step] = await settle(step)
      if (state.title === 'Every page, with tools built in') {
        await ctx.delay(600)
        savedWithTabs = existsSync(stateFile) && readFileSync(stateFile, 'utf8').includes(tourPage)
        // Its page has a session of its own, with every protection a tab's session has.
        tourParity = await pageSessionProblems(ctx)
        const page = await ctx.page(tourPage)
        await page.evaluate(`document.cookie = 'intoponet_tour=1; max-age=3600; path=/'; true`)
        tourSession = {
          ...(await tourSessionNow()),
          // The app's permission handlers, not Electron's default (which grants everything).
          geolocation: await page.evaluate(`navigator.permissions.query({ name: 'geolocation' }).then((s) => s.state)`),
          isPrivate: await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => t.find((x) => x.url.includes(${JSON.stringify(tourPage)}))?.isPrivate ?? null)`),
        }
        // Its renderer crashing: the page comes back in the same temporary session, still leaving no trace.
        await ctx.main(`(() => { electron.webContents.getAllWebContents().find((c) => !c.isDestroyed() && c.getURL().includes(${JSON.stringify(tourPage)})).forcefullyCrashRenderer(); return true })()`)
        await ctx.delay(1000)
        for (let i = 0; i < 60 && !tourAfterCrash; i += 1) {
          tourAfterCrash = await tourSessionNow()
          if (!tourAfterCrash) await ctx.delay(500)
        }
        await ctx.delay(1500)
        await ctx.click('.error-message button[aria-label="Dismiss error"]')
      }
      const centred = ['A browser with the whole world in view', 'The everyday things, done carefully'].includes(state.title)
      if (!centred && !state.lit) missed.push(`${step}. ${state.title}`)
      if (!state.onTop) missed.push(`${step}. ${state.title} (its card is covered)`)
      if (state.pageOnScreen) missed.push(`${step}. ${state.title} (the web page is drawn over the tour)`)
      if (state.paneCovered) missed.push(`${step}. ${state.title} (a globe control sits on the bookmarks pane)`)
      if (['The news rises as mountains', 'Follow a story around the world', 'Two outlets, side by side', 'Tabs down the side, in every view', 'Save any page as a clean PDF', 'Tabs that know their story', 'Tidy suggests the folders', 'Anchor a workspace to a place', 'Links from other apps go where they belong'].includes(state.title)) await ctx.shot(`step-${step}`)
      if (step < total) await ctx.click('.tour-next')
    }
    expect(missed.length === 0, `These tour steps do not show what they describe: ${missed.join("; ")}.`)
    expect(tourParity?.problems.length === 0, `The tour's page is missing a tab's protections: ${(tourParity?.problems ?? ['never checked']).join(' ')}`)
    // Exact spotlights: Compare under the world story's sources; the tab and workspace steps with the (hidden) sidebar open.
    const compareStep = shown.find((state) => state?.title === 'Two outlets, side by side')
    expect(compareStep?.lit === '.sc-compare', `The Compare step lit ${compareStep?.lit}, not the Compare button under the story's sources.`)
    const workspaceSteps = shown.filter((state) => ['Workspaces keep things apart', 'Anchor a workspace to a place', 'A workspace with its own sign-ins'].includes(state?.title))
    expect(workspaceSteps.length === 3 && workspaceSteps.every((state) => state.rail === true && state.lit !== '.tab-rail'), `The workspace steps did not open the sidebar onto its workspace controls: ${JSON.stringify(workspaceSteps.map((state) => [state.lit, state.rail]))}.`)
    const tabStepTitles = ['Video follows you', 'Tabs down the side, in every view', 'Tabs that look after themselves', 'Folders, and tabs that tidy away', 'Tabs that know their story', 'Tidy suggests the folders']
    const tabSteps = shown.filter((state) => tabStepTitles.includes(state?.title))
    expect(tabSteps.length === tabStepTitles.length && tabSteps.every((state) => state.rail === true && state.lit), `The tab steps did not open the hidden sidebar: ${JSON.stringify(tabSteps.map((state) => [state.title, state.lit, state.rail]))}.`)
    expect(shown.filter((state) => state?.rail === true).length === 3 + tabStepTitles.length, `The sidebar was open outside the tab and workspace steps: ${shown.filter((state) => state?.rail === true).map((state) => state.title).join('; ')}.`)
    // Gone back to, or jumped to by its dot, every step shows what it showed played forward.
    const elsewhere = []
    const compare = async (step, how) => {
      const state = await settle(step)
      const diff = Object.keys(shown[step]).filter((key) => state[key] !== shown[step][key]).map((key) => `${key} ${JSON.stringify(shown[step][key])} → ${JSON.stringify(state[key])}`)
      if (diff.length) {
        elsewhere.push(`${how} ${step}. ${state.title}: ${diff.join(', ')}`)
        await ctx.shot(`${how.replace(/ /g, '-')}-${step}`)
      }
    }
    for (let step = total - 1; step >= 1; step -= 1) {
      await ctx.click('.tour-back')
      await compare(step, 'back to')
    }
    const jump = (step) => ctx.evaluate(`document.querySelectorAll('.tour-progress button')[${step - 1}].click(); true`)
    for (const step of [33, 10, 20, 9, 31, 12, 3, 8]) {
      await jump(step)
      await compare(step, 'jump to')
    }
    expect(elsewhere.length === 0, `Reached another way, these tour steps showed something else: ${elsewhere.join('; ')}.`)
    await jump(total)
    await settle(total)
    await ctx.click('.tour-next')
    await ctx.wait(`!document.querySelector('.tour-card') && !document.querySelector('.story-panel')`, 5000, 'the tour to finish and tidy up')
    // Everything it opened is closed again: none of its pages is left in the sidebar.
    const tidy = await ctx.wait(`${tabList}.then((ids) => ids === ${JSON.stringify(tabsBefore)})`, 5000).then(() => true, () => false)
    expect(tidy, `The tour left a tab open: ${await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => t.map((x) => x.title || x.url).join(', '))`)}.`)
    const keptAfter = await ctx.evaluate(kept)
    expect(keptAfter === keptBefore, `The tour changed the saved sidebar or the workspaces: ${keptBefore} → ${keptAfter}.`)
    // Its page leaves no trace: no History visit, no recent page, nothing in Recently closed or Archived tabs, never saved as an open tab.
    const traces = JSON.parse(await ctx.evaluate(`Promise.all([
      window.intoponet.history.search('Earth').then((r) => r.days.flatMap((d) => d.visits.map((v) => v.url))),
      window.intoponet.browserHost.readPrivateLibrary().then((r) => r.status === 'ok' && r.payload ? JSON.parse(r.payload).recents.map((p) => p.url) : []),
      window.intoponet.browserHost.getClosedTabs().then((t) => t.map((x) => x.url)),
      window.intoponet.browserHost.getArchivedTabs().then((t) => t.map((x) => x.url)),
    ]).then(([history, recents, closed, archived]) => JSON.stringify({ history, recents, closed, archived }))`))
    const left = Object.entries(traces).filter(([, urls]) => urls.some((url) => url.includes(tourPage))).map(([where]) => where)
    if (savedWithTabs !== false) left.push('saved open tabs')
    expect(left.length === 0, `The tour's page left a trace in: ${left.join(', ')}.`)
    expect(tourSession?.own && tourSession.temporary && tourSession.spellcheck && tourSession.cookie === 1, `The tour's page did not run in a temporary session of its own: ${JSON.stringify(tourSession)}.`)
    expect(tourSession.geolocation !== 'granted' && tourSession.isPrivate === false, `The tour's page is not an ordinary tab with the app's permission handling: ${JSON.stringify(tourSession)}.`)
    expect(tourAfterCrash?.own && tourAfterCrash.temporary, `After its renderer crashed, the tour's page came back in another session: ${JSON.stringify(tourAfterCrash)}.`)
    // Its session is emptied once the tour ends: the cookie it set is gone, and never reached the shared session.
    const cookiesLeft = `Promise.all([electron.session.fromPartition('intoponet-tour').cookies.get({}), electron.session.fromPartition('persist:intoponet-default').cookies.get({ name: 'intoponet_tour' })]).then(([tour, shared]) => tour.length + shared.length)`
    let cookiesKept = await ctx.main(cookiesLeft)
    for (let i = 0; i < 20 && cookiesKept > 0; i += 1) { await ctx.delay(250); cookiesKept = await ctx.main(cookiesLeft) }
    expect(cookiesKept === 0, `The tour ended but ${cookiesKept} of its cookies are still kept.`)
    return `All ${total} steps shown, each spotlight on what it describes, the same played forward, gone back to and jumped to; the tour put everything back at the end, its own tab closed. With Wikipedia unreachable The Olds step moved on ${((offline.ms - offline.looked) / 1000).toFixed(1)} s after The Olds had looked (${(offline.ms / 1000).toFixed(1)} s in all: "${offline.olds}").`
  },
  async TAB_ARCHIVE(ctx) {
    // Started with an "hour" of 200 ms (TAB_ARCHIVE.env below), so "12 hours" is 2.4 seconds.
    const { server, origin } = await tabSite()
    const host = 'window.intoponet.browserHost'
    const tabs = async () => JSON.parse(await ctx.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
    const archived = async () => JSON.parse(await ctx.evaluate(`${host}.getArchivedTabs().then((t) => JSON.stringify(t))`))
    const titles = async () => (await tabs()).map((tab) => tab.title).sort().join(', ')
    try {
      await openPage(ctx, `${origin}/pinned`, 900)
      await openPage(ctx, `${origin}/typed`, 900)
      await (await ctx.page('/typed')).evaluate(`document.getElementById('field').value = 'not sent yet'; true`)
      await openPage(ctx, `${origin}/old-a`, 900)
      await (await ctx.page('/old-a')).evaluate(`location.href = '${origin}/old-b'`)
      await ctx.delay(1000)
      await openPage(ctx, `${origin}/old-c`, 900)
      const [pinned] = await tabs()
      await ctx.evaluate(`${host}.setTabPinned(${JSON.stringify(pinned.id)}, true).then(() => true)`)
      // One of the tabs to be archived is in a folder: it comes back there.
      const kept = JSON.parse(await ctx.evaluate(`${host}.createTabFolder('Kept', null, [${JSON.stringify((await tabs()).find((tab) => tab.title === 'Page /old-c').id)}]).then((f) => JSON.stringify(f))`))
      // Private tabs: one in the background, one in front.
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(true).then(() => true)`)
      await openPage(ctx, `${origin}/private-bg`, 900)
      await openPage(ctx, `${origin}/private-front`, 1200)
      // Archive after "12 hours": the two plain tabs go; pinned, typed and private tabs stay.
      await ctx.evaluate(`window.intoponet.browsing.setTabArchive('12h').then(() => true)`)
      await ctx.wait(`${host}.getArchivedTabs().then((t) => t.length >= 2)`, 20_000, 'the unseen tabs to be archived')
      await ctx.delay(800)
      const left = await titles()
      expect(left === 'Page /pinned, Page /private-bg, Page /private-front, Page /typed', `Left open after archiving: ${left}.`)
      const list = await archived()
      expect(list.map((tab) => tab.title).sort().join(', ') === 'Page /old-b, Page /old-c', `Archived: ${list.map((tab) => tab.title).join(', ')}.`)
      expect(!list.some((tab) => tab.url.includes('private')), 'A private tab reached the archive.')
      await ctx.wait(`[...document.querySelectorAll('.tab-rail-archived')].some((e) => e.textContent.includes('2 tabs archived'))`, 3000, 'the sidebar to say 2 tabs were archived')
      // Undo brings them back.
      await ctx.click('.tab-rail-undo')
      await ctx.wait(`${host}.getTabs().then((t) => t.some((x) => x.title === 'Page /old-b') && t.some((x) => x.title === 'Page /old-c'))`, 4000, 'Undo to reopen them')
      expect((await archived()).length === 0, 'Undo left the tabs in the archive.')
      expect((await tabs()).find((tab) => tab.title === 'Page /old-c')?.folderId === kept.id, 'Undo brought the archived tab back outside its folder.')
      // Archived again, then found from the address bar and reopened with its back list.
      await ctx.wait(`${host}.getArchivedTabs().then((t) => t.length >= 2)`, 20_000, 'the tabs to be archived again')
      await ctx.evaluate(`window.intoponet.browsing.setTabArchive('off').then(() => true)`)
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(false).then(() => true)`)
      // Reopened while another workspace is shown, it comes back in the one it was archived from.
      const homeId = JSON.parse(await ctx.evaluate(`window.intoponet.workspaces.get().then((s) => JSON.stringify(s.activeId))`))
      await ctx.evaluate(`window.intoponet.workspaces.create({ name: 'Elsewhere' }).then(() => true)`)
      await ctx.delay(600)
      await ctx.evaluate(`(() => { const input = document.querySelector('.command-input input'); input.focus(); return true })()`)
      await ctx.type('old-b')
      await ctx.wait(`[...document.querySelectorAll('[role="option"]')].some((e) => e.textContent.includes('Reopen archived tab'))`, 4000, 'the address bar to offer the archived tab')
      await ctx.evaluate(`[...document.querySelectorAll('[role="option"]')].find((e) => e.textContent.includes('Reopen archived tab')).dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); [...document.querySelectorAll('[role="option"]')].find((e) => e.textContent.includes('Reopen archived tab'))?.click(); true`)
      await ctx.wait(`${host}.getTabs().then((t) => t.some((x) => x.active && x.title === 'Page /old-b'))`, 6000, 'the archived tab to reopen in front')
      expect(JSON.parse(await ctx.evaluate(`window.intoponet.workspaces.get().then((s) => JSON.stringify(s.activeId))`)) === homeId, 'The archived tab reopened in the workspace shown, not the one it was archived from.')
      // Its back list is there once it has been restored (wait for it rather than a fixed time).
      await ctx.wait(`${host}.getState().then((s) => s.canGoBack && !s.isLoading)`, 8000, 'the reopened tab to offer Back').catch(() => undefined)
      const panel = JSON.parse(await ctx.evaluate(`${host}.getState().then((s) => JSON.stringify(s))`))
      expect(panel.canGoBack, 'The reopened tab lost its back list.')
      // Clearing history clears the archive too.
      expect((await archived()).length === 1, 'The reopened tab is still in the archive.')
      await ctx.evaluate(`window.intoponet.history.clearBrowsingData({ range: 'all', history: true, siteData: false, cache: false, downloads: false }).then(() => true)`)
      await ctx.wait(`${host}.getArchivedTabs().then((t) => t.length === 0)`, 4000, 'clearing history to clear the archive')
      return 'Unseen unpinned tabs archived (pinned, typed and private ones stayed); "2 tabs archived" with Undo, back in their folder; found from the address bar in another workspace and reopened in its own, with its back list; cleared with history.'
    } finally {
      server.close()
    }
  },
  async COMMAND_MENU(ctx) {
    const { server, origin } = await tabSite()
    const host = 'window.intoponet.browserHost'
    const rows = () => ctx.evaluate(`JSON.stringify([...document.querySelectorAll('[role="listbox"] [role="option"]')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim()))`).then(JSON.parse)
    const typeCommand = async (text) => {
      await ctx.evaluate(`(() => { const input = document.querySelector('.command-input input'); input.focus(); input.select(); return true })()`)
      await ctx.type(text)
      await ctx.delay(250)
    }
    const pick = async (text) => {
      await typeCommand(text)
      await ctx.press('Enter')
      await ctx.delay(700)
    }
    try {
      await openPage(ctx, `${origin}/article?id=7&utm_campaign=spring`, 1500)
      await openPage(ctx, `${origin}/second`, 1500)
      // ⌘K from inside the page opens the address bar in command mode, quickly (p95 under 150 ms).
      const times = []
      for (let run = 0; run < 10; run += 1) {
        await ctx.evaluate(`(() => { window.__shown = 0; const done = () => { if (document.querySelector('[role="listbox"] [role="option"]') && document.querySelector('.command-input input').value.startsWith('>')) { window.__shown = performance.now(); return true } return false }; const watch = new MutationObserver(() => { if (done()) watch.disconnect() }); watch.observe(document.body, { subtree: true, childList: true, attributes: true }); window.__asked = performance.now(); return true })()`)
        await ctx.keyInPage('/second', 'K', ['meta'])
        await ctx.wait(`window.__shown > 0`, 3000, 'the command menu to show')
        times.push(await ctx.evaluate(`window.__shown - window.__asked`))
        // Escape in the bar leaves command mode (and clears it).
        await ctx.evaluate(`document.querySelector('.command-input input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`)
        await ctx.delay(200)
        expect(await ctx.evaluate(`document.querySelector('.command-input input').value === ''`), 'Escape did not leave command mode.')
      }
      const [, shownTab] = JSON.parse(await ctx.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
      await ctx.evaluate(`${host}.activateTab(${JSON.stringify(shownTab.id)}).then(() => true)`)
      await ctx.delay(600)
      times.sort((a, b) => a - b)
      const p95 = times[Math.ceil(times.length * 0.95) - 1]
      expect(p95 < 150, `⌘K took ${Math.round(p95)} ms to show its list (p95; must be under 150 ms, including the round trip from the page).`)
      // Typing ">" first does the same; with nothing typed after it, actions only.
      await typeCommand('>')
      const all = await rows()
      expect(all.length >= 10 && all.some((row) => row.includes('Copy page address')), `With ">" the list was: ${all.join(' | ')}.`)
      await axeAudit(ctx, 'the command menu', '[role="listbox"]')
      // Nothing typed leaves this Mac: no request at all while typing commands.
      const before = await ctx.evaluate(`performance.getEntriesByType('resource').length`)
      await typeCommand('> zoom in save page translate lisbon')
      const after = await ctx.evaluate(`performance.getEntriesByType('resource').length`)
      expect(after === before, `Typing in command mode made ${after - before} request(s).`)
      // Ranked as you type: actions first, then the tabs and places the words match.
      await typeCommand('> pdf')
      expect((await rows())[0]?.includes('Save page as PDF'), `"> pdf" first offered: ${(await rows())[0]}.`)
      await typeCommand('> second')
      expect((await rows()).some((row) => row.includes('Page /second') && row.includes('Switch to tab')), `"> second" did not offer the open tab: ${(await rows()).join(' | ')}.`)
      await typeCommand('> lisbon')
      expect((await rows()).some((row) => row.includes('Fly to Lisbon')), `"> lisbon" did not offer the place: ${(await rows()).join(' | ')}.`)
      // Keyboard: ↓ moves the highlight, Enter runs it.
      await typeCommand('> copy page')
      await ctx.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
      await ctx.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
      await ctx.delay(200)
      const highlighted = await ctx.evaluate(`document.getElementById(document.querySelector('.command-input input').getAttribute('aria-activedescendant'))?.innerText ?? ''`)
      expect(highlighted.includes('exactly'), `↓ highlighted "${highlighted}".`)
      await ctx.main(`electron.clipboard.writeText('before')`)
      await ctx.press('Enter')
      await ctx.delay(700)
      expect(await ctx.main('electron.clipboard.readText()') === `${origin}/second`, 'Enter on "Copy page address exactly" did not copy it.')
      // Actions run: a menu command, the shell's own tools, and a toggle.
      const [first] = JSON.parse(await ctx.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
      await ctx.evaluate(`${host}.activateTab(${JSON.stringify(first.id)}).then(() => true)`)
      await ctx.delay(800)
      await ctx.main(`electron.clipboard.writeText('before')`)
      await pick('> copy page address')
      expect(await ctx.main('electron.clipboard.readText()') === `${origin}/article?id=7`, `"Copy page address" copied ${await ctx.main('electron.clipboard.readText()')}.`)
      await pick('> zoom in')
      expect(JSON.parse(await ctx.evaluate(`${host}.getState().then((s) => JSON.stringify(s))`)).zoomFactor > 1, '"Zoom in" did not zoom the page.')
      await pick('> actual size')
      expect(Math.abs(JSON.parse(await ctx.evaluate(`${host}.getState().then((s) => JSON.stringify(s))`)).zoomFactor - 1) < 0.01, '"Actual size" did not reset the zoom.')
      await pick('> hide tab sidebar')
      await ctx.wait(`!document.querySelector('.tab-rail')`, 3000, '"Hide tab sidebar" to hide it')
      await pick('> show tab sidebar')
      await ctx.wait(`!!document.querySelector('.tab-rail')`, 3000, '"Show tab sidebar" to show it')
      await pick('> turn protection off')
      await ctx.wait(`!!document.querySelector('.shield-control button[aria-label^="Protection paused"]')`, 3000, 'protection to be paused from the command menu')
      await pick('> turn protection on')
      await ctx.wait(`!!document.querySelector('.shield-control button[aria-label^="Protection on"]')`, 3000, 'protection to be back on')
      await pick('> open knowledge')
      await ctx.wait(`!!document.querySelector('.knowledge-sheet')`, 3000, '"Open Knowledge" to open it')
      await ctx.press('Escape')
      return `⌘K from a page shows command mode in ${Math.round(p95)} ms (p95); ">" too; no requests while typing; actions, tabs and places ranked; keyboard and Enter run them (copy, zoom, sidebar, protection, Knowledge); axe clean.`
    } finally {
      server.close()
    }
  },
  async TAB_FOLDERS(ctx) {
    const { server, origin } = await tabSite()
    const host = 'window.intoponet.browserHost'
    const tabs = async () => JSON.parse(await ctx.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
    const folders = async () => JSON.parse(await ctx.evaluate(`${host}.getTabFolders().then((f) => JSON.stringify(f))`))
    const byTitle = async (title) => (await tabs()).find((tab) => tab.title === title)
    const drag = async (fromSelector, toSelector) => {
      const [from, to] = JSON.parse(await ctx.evaluate(`JSON.stringify([document.querySelector(${JSON.stringify(fromSelector)}).getBoundingClientRect(), document.querySelector(${JSON.stringify(toSelector)}).getBoundingClientRect()])`))
      const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
      const b = { x: to.x + Math.min(60, to.width / 2), y: to.y + to.height / 2 }
      await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y })
      await ctx.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 })
      for (let step = 1; step <= 10; step += 1) {
        await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + (b.x - a.x) * step / 10, y: a.y + (b.y - a.y) * step / 10, button: 'left', buttons: 1 })
        await ctx.delay(30)
      }
      await ctx.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 })
      await ctx.delay(700)
    }
    try {
      for (const name of ['mail', 'docs', 'notes', 'map', 'news']) await openPage(ctx, `${origin}/${name}`, 800)
      await ctx.click('button[aria-label="Pin tabs open"]')
      await ctx.delay(500)
      // New folder from the sidebar: named at once.
      await ctx.click('button[aria-label="New folder"]')
      await ctx.wait(`document.activeElement?.classList.contains('tab-rail-folder-name')`, 3000, 'the new folder to ask for a name')
      await ctx.evaluate(`document.activeElement.value = ''; true`)
      await ctx.type('Work')
      await ctx.press('Enter')
      await ctx.wait(`${host}.getTabFolders().then((f) => f.some((x) => x.name === 'Work'))`, 3000, 'the folder to be named Work')
      const work = (await folders()).find((folder) => folder.name === 'Work')
      // Drag a tab onto the folder.
      const docs = await byTitle('Page /docs')
      await drag(`[data-tab-id="${docs.id}"] [role="tab"]`, `[data-folder-drop="${work.id}"]`)
      expect((await byTitle('Page /docs')).folderId === work.id, 'Dragging a tab onto the folder did not put it there.')
      // The same from the keyboard path (the tab menu's Move to Folder runs this).
      const notes = await byTitle('Page /notes')
      await ctx.evaluate(`${host}.moveTabToFolder(${JSON.stringify(notes.id)}, ${JSON.stringify(work.id)}).then(() => true)`)
      await ctx.delay(400)
      // Folders nest four levels deep.
      let parent = work.id
      for (const name of ['Reports', 'Q3', 'Drafts']) parent = JSON.parse(await ctx.evaluate(`${host}.createTabFolder(${JSON.stringify(name)}, ${JSON.stringify(parent)}).then((f) => JSON.stringify(f))`)).id
      const map = await byTitle('Page /map')
      await ctx.evaluate(`${host}.moveTabToFolder(${JSON.stringify(map.id)}, ${JSON.stringify(parent)}).then(() => true)`)
      await ctx.delay(600)
      const nested = await ctx.evaluate(`[...document.querySelectorAll('.tab-rail-folder .tab-rail-folder .tab-rail-folder .tab-rail-folder')].some((e) => e.getAttribute('aria-label') === 'Folder Drafts' && !!e.querySelector('[data-tab-id="${map.id}"]'))`)
      expect(nested, 'A folder four levels deep is not shown inside its parents with its tab.')
      await ctx.shot('nested')
      // The order follows the sidebar: Work's tabs, then its folders' tabs, then the rest.
      const order = (await tabs()).map((tab) => tab.title.replace('Page /', '')).join(' ')
      expect(order === 'docs notes map mail news', `Tab order is "${order}".`)
      // Folding a folder hides its tabs (and its folders); it is kept for the next launch.
      await ctx.click(`[data-folder-drop="${work.id}"] .tab-rail-folder-toggle`)
      await ctx.wait(`!document.querySelector('[data-tab-id="${docs.id}"]') && document.querySelector('[data-folder-drop="${work.id}"] .tab-rail-folder-toggle').getAttribute('aria-expanded') === 'false'`, 3000, 'Work to fold')
      // Saves are flushed to disk one after another: under heavy disk load the file can take a moment to catch up.
      const folded = (state) => state.folders?.find((folder) => folder.id === work.id)?.collapsed === true && state.folders.length === 4
      let saved = null
      for (let i = 0; i < 25 && !folded(saved ?? {}); i += 1) {
        await ctx.delay(200)
        saved = JSON.parse(readFileSync(join(ctx.profile, 'browser-state.v1.json'), 'utf8'))
      }
      expect(folded(saved), `Saved folders: ${JSON.stringify(saved.folders)}.`)
      expect(saved.tabs.find((tab) => tab.title === 'Page /docs')?.folderId === work.id, 'A tab\'s folder was not saved.')
      // ⌥⇧↑ on the first loose tab moves it into the folded folder above (into Drafts, before map): Work opens, and the tab stays in sight with focus.
      const altShift = async (key, keyCode) => {
        for (const type of ['rawKeyDown', 'keyUp']) await ctx.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: keyCode, modifiers: 1 | 8 })
      }
      const mail = await byTitle('Page /mail')
      const mailFocused = `document.activeElement?.closest('[data-tab-id]')?.dataset.tabId === ${JSON.stringify(mail.id)}`
      // Focus on its row in the list it is in now (not the old row, which fades out where it was).
      const mailFocusedIn = (list) => `${mailFocused} && !!document.activeElement.closest(${JSON.stringify(list)})`
      const inDrafts = `#tab-folder-${parent}`
      await ctx.evaluate(`document.querySelector('[data-tab-id="${mail.id}"] [role="tab"]').focus(); true`)
      await altShift('ArrowUp', 38)
      await ctx.wait(`${host}.getTabFolders().then((f) => !f.find((x) => x.id === ${JSON.stringify(work.id)}).collapsed)`, 3000, 'moving a tab into the folded folder to open it')
      expect((await byTitle('Page /mail')).folderId === parent, `⌥⇧↑ did not move the tab into the folder above (it is in ${(await byTitle('Page /mail')).folderId ?? 'none'}).`)
      await ctx.wait(mailFocusedIn(inDrafts), 3000, 'the tab moved into the opened folder to be shown there and keep focus')
      // ⌥⇧↓ moves it past map, then out of the folder again (its row is drawn afresh below while the old one fades), still focused.
      await altShift('ArrowDown', 40)
      await ctx.wait(`${host}.getTabs().then((t) => t.map((x) => x.id).indexOf(${JSON.stringify(mail.id)}) === t.findIndex((x) => x.title === 'Page /map') + 1)`, 3000, '⌥⇧↓ to move the tab past map')
      await ctx.wait(`${mailFocusedIn(inDrafts)} && [...document.querySelectorAll(${JSON.stringify(`${inDrafts} [role="tab"]`)})].at(-1) === document.activeElement`, 3000, 'the tab moved inside the folder to keep focus')
      await altShift('ArrowDown', 40)
      await ctx.wait(`${host}.getTabs().then((t) => !t.find((x) => x.id === ${JSON.stringify(mail.id)}).folderId)`, 3000, '⌥⇧↓ to take the tab out of the folder')
      await ctx.wait(mailFocusedIn('.tab-rail-group'), 3000, 'the tab taken out of the folder to keep focus in the open tabs')
      // Still focused once the old row has faded out.
      await ctx.delay(400)
      expect(await ctx.evaluate(mailFocusedIn('.tab-rail-group')), 'The tab taken out of the folder lost focus once its old row faded out.')
      await ctx.delay(300)
      await axeAudit(ctx, 'the tab sidebar with folders', '.tab-rail')
      // Saved as a private collection (one per folder, nested ones named by their path).
      await ctx.click(`[data-folder-drop="${work.id}"] .tab-rail-folder-more`)
      await ctx.wait(`!!document.querySelector('.tab-rail-folder-menu [role="menuitem"]')`, 2000, 'the folder menu')
      await ctx.click('.tab-rail-folder-menu [role="menuitem"]', 'Save as collection')
      await ctx.wait(`window.intoponet.browserHost.readPrivateLibrary().then((r) => { const lib = JSON.parse(r.payload ?? '{}'); return (lib.collections ?? []).some((c) => c.label === 'Work' && c.memberUrls.length === 2) && (lib.collections ?? []).some((c) => c.label === 'Work / Reports / Q3 / Drafts' && c.memberUrls.length === 1) })`, 5000, 'the folder to be saved as collections')
      await ctx.wait(`[...document.querySelectorAll('.tab-rail-archived')].some((e) => e.textContent.includes('as a collection'))`, 3000, 'the sidebar to say the folder was saved')
      // A collection opens as a folder of tabs.
      await ctx.evaluate(`${host}.close().then(() => true)`)
      await ctx.delay(600)
      await ctx.click('.topbar-actions button', 'Bookmarks')
      await ctx.wait(`!!document.querySelector('[aria-label="Open Work as a tab folder"]')`, 4000, 'the collection to offer opening as tabs')
      const before = (await tabs()).length
      await ctx.click('[aria-label="Open Work as a tab folder"]')
      await ctx.wait(`${host}.getTabFolders().then((f) => f.filter((x) => x.name === 'Work').length === 2)`, 4000, 'the collection to open as a folder')
      expect((await tabs()).length === before + 2, 'Opening the collection did not open its two pages as tabs.')
      // Deleting a folder keeps its tabs (they move up a level).
      await ctx.evaluate(`${host}.deleteTabFolder(${JSON.stringify(work.id)}).then(() => true)`)
      await ctx.delay(500)
      expect(!(await byTitle('Page /docs')).folderId && (await folders()).find((folder) => folder.name === 'Reports')?.parentId === null, 'Deleting a folder lost its tabs or folders.')
      return 'Folder named from the sidebar; tab dragged in and moved by command; nested four deep; order follows the sidebar; folded and kept; ⌥⇧↑ into a folded folder opened it with the tab in sight and focused; saved as path-named collections; a collection opened as a folder; delete keeps tabs; axe clean.'
    } finally {
      server.close()
    }
  },
  async WORKSPACES(ctx) {
    const { server, origin } = await tabSite()
    const host = 'window.intoponet.browserHost'
    const ws = 'window.intoponet.workspaces'
    const tabs = async () => JSON.parse(await ctx.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
    const state = async () => JSON.parse(await ctx.evaluate(`${ws}.get().then((s) => JSON.stringify(s))`))
    const titles = async () => (await tabs()).map((tab) => tab.title.replace('Page /', '')).join(' ')
    const byTitle = async (title) => (await tabs()).find((tab) => tab.title === `Page /${title}`)
    const loaded = (path) => ctx.main(`electron.webContents.getAllWebContents().some((c) => c.getURL() === ${JSON.stringify(`${origin}/${path}`)})`)
    const savedState = () => JSON.parse(readFileSync(join(ctx.profile, 'browser-state.v1.json'), 'utf8'))
    /**
     * Opens a workspace's actions menu. Menus close when focus leaves the app window, and windows of checks running
     * side by side can take it at any moment: the app is brought forward and the button clicked again until it opens.
     */
    const openWorkspaceMenu = async (name, label) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await ctx.main(`(() => { electron.app.focus({ steal: true }); electron.BrowserWindow.getAllWindows()[0].focus(); return true })()`)
        // Focused first, as a real click on the button focuses it.
        await ctx.evaluate(`document.querySelector('button[aria-label="Actions for workspace ${name}"]')?.focus(); true`)
        await ctx.click(`button[aria-label="Actions for workspace ${name}"]`)
        if (await ctx.wait(`!!document.querySelector('.tab-rail-folder-menu [role="menuitem"]')`, 2000, label).then(() => true, () => false)) return
      }
      throw new CheckFailure(`Timed out waiting for: ${label}`)
    }
    const typeCommand = async (text) => {
      await ctx.evaluate(`(() => { const input = document.querySelector('.command-input input'); input.focus(); input.select(); return true })()`)
      await ctx.type(text)
      await ctx.delay(300)
    }
    const key = async (key, code, keyCode, modifiers = 0) => {
      await ctx.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers })
      await ctx.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers })
    }
    /** ⌃N pressed in the page showing `fromPath`, timed until the sidebar shows the other workspace's tabs. */
    const timedSwitch = async (digit, fromPath, targetId, expectTitle) => {
      await ctx.evaluate(`(() => { window.__wsShown = 0; const done = () => { const rail = document.querySelector('.tab-rail'); if (rail?.dataset.workspace === ${JSON.stringify(targetId)} && [...rail.querySelectorAll('[data-tab-id] .tab-rail-title')].some((e) => e.textContent === ${JSON.stringify(expectTitle)})) { window.__wsShown = performance.now(); return true } return false }; const watch = new MutationObserver(() => { if (done()) watch.disconnect() }); watch.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); window.__wsAsked = performance.now(); return true })()`)
      expect(await ctx.keyInPage(`/${fromPath}`, digit, ['control']), `No page at /${fromPath} to press ⌃${digit} in.`)
      await ctx.wait(`window.__wsShown > 0`, 3000, `⌃${digit} to show the workspace's tabs`)
      return ctx.evaluate(`window.__wsShown - window.__wsAsked`)
    }
    /** The app opened again (as after quitting or a crash) with a saved browser state, in a profile of its own. */
    const relaunch = async (saved, check, prepare = () => {}) => {
      const profile = mkdtempSync(join(tmpdir(), 'intoponet-e2e-relaunch-'))
      writeFileSync(join(profile, 'browser-state.v1.json'), JSON.stringify(saved))
      prepare(profile)
      const before = process.env.E2E_PROFILE
      process.env.E2E_PROFILE = profile
      try {
        return await runAppCheck(check, { timeoutMs: 60_000 })
      } finally {
        if (before === undefined) delete process.env.E2E_PROFILE
        else process.env.E2E_PROFILE = before
        rmSync(profile, { recursive: true, force: true })
      }
    }
    try {
      // Main: a pinned tab, a folder with a tab in it, and an open tab.
      for (const name of ['main-a', 'main-b', 'main-pin']) await openPage(ctx, `${origin}/${name}`, 900)
      await ctx.evaluate(`${host}.setTabPinned(${JSON.stringify((await byTitle('main-pin')).id)}, true).then(() => true)`)
      await ctx.evaluate(`${host}.createTabFolder('Main folder', null, [${JSON.stringify((await byTitle('main-b')).id)}]).then(() => true)`)
      await ctx.click('button[aria-label="Pin tabs open"]')
      await ctx.delay(600)
      let now = await state()
      expect(now.workspaces.length === 1 && now.workspaces[0].name === 'Main', `A new profile starts with ${JSON.stringify(now.workspaces)}.`)
      expect(!(await ctx.evaluate(`!!document.querySelector('.tab-rail-workspaces')`)), 'With one workspace the sidebar already shows a workspace switcher.')
      const mainId = now.activeId

      // Create one from the sidebar: it is shown at once and asks for its name, icon and colour.
      await ctx.click('button[aria-label="New workspace"]')
      await ctx.wait(`document.activeElement?.classList.contains('tab-rail-workspace-name-input')`, 4000, 'the new workspace to ask for its name')
      await ctx.evaluate(`document.activeElement.select(); true`)
      await ctx.type('Research')
      await ctx.evaluate(`(() => { document.querySelector('.tab-rail-workspace-editor input[aria-label="Flask"]').click(); document.querySelector('.tab-rail-workspace-editor input[aria-label="Violet"]').click(); document.querySelector('.tab-rail-workspace-name-input').focus(); return true })()`)
      await ctx.press('Enter')
      await ctx.wait(`${ws}.get().then((s) => s.workspaces.some((w) => w.name === 'Research' && w.icon === 'flask' && w.accent === 'violet' && w.id === s.activeId))`, 4000, 'the new workspace to be named Research, with its icon and colour, and shown')
      now = await state()
      const researchId = now.activeId
      expect((await tabs()).every((tab) => tab.isStartPage), `The new workspace opened with someone else's tabs: ${await titles()}.`)
      await ctx.wait(`document.querySelector('.tab-rail-workspace.is-active')?.getAttribute('aria-label')?.startsWith('Research')`, 3000, 'the switcher to show Research as the current workspace')
      // Its own pinned tab, folder and open tab.
      await openPage(ctx, `${origin}/research-a`, 900)
      await openPage(ctx, `${origin}/research-b`, 900)
      await openPage(ctx, `${origin}/research-c`, 900)
      await ctx.evaluate(`${host}.setTabPinned(${JSON.stringify((await byTitle('research-a')).id)}, true).then(() => true)`)
      await ctx.evaluate(`${host}.createTabFolder('Papers', null, [${JSON.stringify((await byTitle('research-b')).id)}]).then(() => true)`)
      await ctx.delay(500)
      expect(await titles() === 'research-a research-b research-c', `Research holds: ${await titles()}.`)
      const researchFolders = JSON.parse(await ctx.evaluate(`${host}.getTabFolders().then((f) => JSON.stringify(f))`))
      expect(researchFolders.map((folder) => folder.name).join() === 'Papers', `Research's folders: ${researchFolders.map((folder) => folder.name).join()}.`)

      // A sleeping tab in Main: its pinned tab, unloaded (its close button only unloads a pinned tab).
      await ctx.evaluate(`${ws}.switchTo({ id: ${JSON.stringify(mainId)} }).then(() => true)`)
      await ctx.delay(800)
      expect(await titles() === 'main-pin main-b main-a', `Main holds: ${await titles()}.`)
      const mainPin = await byTitle('main-pin')
      await ctx.evaluate(`${host}.activateTab(${JSON.stringify((await byTitle('main-a')).id)}).then(() => ${host}.closeTab(${JSON.stringify(mainPin.id)})).then(() => true)`)
      await ctx.wait(`${host}.getTabs().then((t) => t.find((x) => x.id === ${JSON.stringify(mainPin.id)})?.asleep === true)`, 4000, 'Main\'s pinned tab to sleep')
      expect(!(await loaded('main-pin')), 'The sleeping tab\'s page is still loaded.')

      // ⌃1 and ⌃2 from inside the page switch: timed until the sidebar shows the other workspace's tabs.
      const times = []
      for (let round = 0; round < 4; round += 1) {
        times.push(await timedSwitch('2', 'main-a', researchId, 'Page /research-c'))
        await ctx.delay(300)
        times.push(await timedSwitch('1', 'research-c', mainId, 'Page /main-a'))
        await ctx.delay(300)
      }
      times.sort((a, b) => a - b)
      const slowest = times[times.length - 1]
      expect(slowest < 150, `Switching workspaces took up to ${Math.round(slowest)} ms (must be under 150 ms): ${times.map(Math.round).join(', ')}.`)
      // Main's sleeping tab never woke, however often Main was shown; Research's pages kept going (not reloaded).
      expect(!(await loaded('main-pin')) && (await byTitle('main-pin')).asleep, 'Switching workspaces woke Main\'s sleeping tab.')
      expect(await loaded('research-c'), 'Research\'s open page was unloaded while Main was shown.')
      expect(await titles() === 'main-pin main-b main-a', `Back in Main the sidebar shows: ${await titles()}.`)
      const mainFolders = JSON.parse(await ctx.evaluate(`${host}.getTabFolders().then((f) => JSON.stringify(f))`))
      expect(mainFolders.map((folder) => folder.name).join() === 'Main folder' && (await byTitle('main-b')).folderId === mainFolders[0].id, `Main's folder did not come back with it: ${JSON.stringify(mainFolders)}.`)

      // The command menu switches too.
      await typeCommand('> research')
      await ctx.wait(`[...document.querySelectorAll('[role="listbox"] [role="option"]')].some((e) => e.innerText.includes('Switch to workspace Research'))`, 3000, 'the command menu to offer Research')
      expect(await ctx.evaluate(`document.querySelector('[role="listbox"] [role="option"]').innerText.includes('Switch to workspace Research')`), 'The command menu does not offer switching to Research first.')
      await ctx.press('Enter')
      await ctx.wait(`${ws}.get().then((s) => s.activeId === ${JSON.stringify(researchId)})`, 3000, 'the command menu to show Research')

      // A sideways two-finger swipe on the sidebar shows the next workspace (one per swipe).
      const rail = JSON.parse(await ctx.evaluate(`JSON.stringify(document.querySelector('.tab-rail').getBoundingClientRect())`))
      for (let i = 0; i < 5; i += 1) {
        await ctx.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: rail.x + rail.width / 2, y: rail.y + rail.height / 2, deltaX: 30, deltaY: 0 })
        await ctx.delay(30)
      }
      await ctx.wait(`${ws}.get().then((s) => s.activeId === ${JSON.stringify(mainId)})`, 3000, 'a swipe on the sidebar to show the next workspace')
      await ctx.delay(500)
      expect((await state()).activeId === mainId, 'One swipe switched more than once.')

      // Keyboard: the switcher's buttons take arrows and Enter; ⌥⇧← moves a workspace (⌃1–9 follow the order).
      await ctx.evaluate(`document.querySelector('.tab-rail-workspace.is-active').focus(); true`)
      await key('ArrowRight', 'ArrowRight', 39)
      expect(await ctx.evaluate(`document.activeElement?.dataset.workspaceId === ${JSON.stringify(researchId)}`), 'The arrow key did not move to the next workspace.')
      await ctx.press('Enter')
      await ctx.wait(`${ws}.get().then((s) => s.activeId === ${JSON.stringify(researchId)})`, 3000, 'Enter on a workspace to show it')
      await ctx.wait(`document.querySelector('.tab-rail-workspace.is-active')?.dataset.workspaceId === ${JSON.stringify(researchId)}`, 3000, 'the switcher to mark Research as current')
      await ctx.evaluate(`document.querySelector('.tab-rail-workspace.is-active').focus(); true`)
      await key('ArrowLeft', 'ArrowLeft', 37, 1 | 8)
      await ctx.wait(`${ws}.get().then((s) => s.workspaces[0].id === ${JSON.stringify(researchId)})`, 3000, '⌥⇧← to move Research first')

      // Rename from the workspace's actions.
      await openWorkspaceMenu('Research', 'the workspace menu')
      await ctx.click('.tab-rail-folder-menu [role="menuitem"]', 'Rename')
      await ctx.wait(`document.activeElement?.classList.contains('tab-rail-workspace-name-input')`, 3000, 'the name field')
      await ctx.evaluate(`document.activeElement.select(); true`)
      await ctx.type('Reading')
      await ctx.press('Enter')
      await ctx.wait(`${ws}.get().then((s) => s.workspaces[0].name === 'Reading')`, 3000, 'the workspace to be renamed Reading')

      // Favourites: one shared by every workspace, one owned by Main.
      await ctx.evaluate(`${ws}.addFavourite(${JSON.stringify((await byTitle('research-c')).id)}, true).then(() => true)`)
      await ctx.evaluate(`${ws}.switchTo({ id: ${JSON.stringify(mainId)} }).then(() => true)`)
      await ctx.delay(600)
      await ctx.evaluate(`${ws}.addFavourite(${JSON.stringify((await byTitle('main-a')).id)}, false).then(() => true)`)
      await ctx.wait(`document.querySelectorAll('.tab-rail-favourite').length === 2`, 3000, 'Main to show both favourites')
      await ctx.evaluate(`${ws}.switchTo({ id: ${JSON.stringify(researchId)} }).then(() => true)`)
      await ctx.wait(`document.querySelectorAll('.tab-rail-favourite').length === 1`, 3000, 'Reading to show only the shared favourite')

      // Private tabs belong to no workspace: never counted, never moved into one, never saved.
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(true).then(() => true)`)
      await openPage(ctx, `${origin}/private-page`, 900)
      const privateTab = (await tabs()).find((tab) => tab.isPrivate)
      expect(privateTab, 'No private tab opened.')
      now = await state()
      expect(now.workspaces.find((w) => w.id === researchId).tabCount === 3, `Reading counts ${now.workspaces.find((w) => w.id === researchId).tabCount} tabs with a private tab open.`)
      const refused = await ctx.evaluate(`${ws}.moveTab(${JSON.stringify(privateTab.id)}, ${JSON.stringify(mainId)}).then(() => 'moved', () => 'refused')`)
      expect(refused === 'refused', 'A private tab was moved into a workspace.')
      await ctx.evaluate(`${ws}.switchTo({ id: ${JSON.stringify(mainId)} }).then(() => true)`)
      await ctx.delay(600)
      expect((await tabs()).some((tab) => tab.id === privateTab.id && tab.isPrivate), 'The private tab went away with the workspace.')
      // Once the switch is saved (waited for, not a fixed time), the private page is not in the file.
      const savedNow = () => { try { return savedState() } catch { return null } }
      for (let i = 0; i < 50 && savedNow()?.activeWorkspaceId !== mainId; i += 1) await ctx.delay(200)
      expect(savedNow()?.activeWorkspaceId === mainId, 'Switching to Main with a private tab open was not saved.')
      expect(!JSON.stringify(savedNow()).includes('private-page'), 'A private page was saved with the workspaces.')
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(false).then(() => true)`)
      await ctx.delay(600)
      expect(!(await tabs()).some((tab) => tab.isPrivate), 'Leaving private browsing left a private tab.')
      await ctx.evaluate(`${ws}.switchTo({ id: ${JSON.stringify(researchId)} }).then(() => true)`)
      await ctx.delay(600)
      await axeAudit(ctx, 'the tab sidebar with workspaces and favourites', '.tab-rail')
      await ctx.shot('workspaces')

      // Saved for the next launch (version 3); kept during the session too, so a crash loses nothing. Waited for, not a fixed time.
      for (let i = 0; i < 50 && savedNow()?.activeWorkspaceId !== researchId; i += 1) await ctx.delay(200)
      const saved = savedState()
      expect(saved.version === 3 && saved.workspaces.map((w) => w.name).join() === 'Reading,Main' && saved.activeWorkspaceId === researchId, `Saved workspaces: ${JSON.stringify({ version: saved.version, workspaces: saved.workspaces, active: saved.activeWorkspaceId })}.`)
      expect(saved.tabs.filter((tab) => tab.workspaceId === mainId).length === 3 && saved.tabs.filter((tab) => tab.workspaceId === researchId).length === 3, `Saved tabs by workspace: ${JSON.stringify(saved.tabs.map((tab) => [tab.title, tab.workspaceId]))}.`)
      expect(saved.folders.some((folder) => folder.name === 'Papers' && folder.workspaceId === researchId) && saved.folders.some((folder) => folder.name === 'Main folder' && folder.workspaceId === mainId), `Saved folders: ${JSON.stringify(saved.folders)}.`)

      // Opened again with that state: every workspace comes back with its own tabs, folders and favourites.
      // The tab Main shows is on a site whose page title arrives late: until it does, the tab keeps its saved title, never its address.
      const lateSite = createServer((request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        // Enough of the page for it to arrive (and its address to show as its title) well before its title does.
        response.write(`<!doctype html><body><h1>${request.url}</h1>${' '.repeat(16_384)}`)
        setTimeout(() => response.end(`<title>Page ${request.url}</title></body>`), 2500)
      })
      await new Promise((resolve) => lateSite.listen(0, '127.0.0.1', resolve))
      const lateA = `http://127.0.0.1:${lateSite.address().port}/main-a`
      const restored = await relaunch({ ...saved, tabs: saved.tabs.map((tab) => (tab.title === 'Page /main-a' ? { ...tab, url: lateA } : tab)) }, async (next) => {
        const nextState = JSON.parse(await next.evaluate(`${ws}.get().then((s) => JSON.stringify(s))`))
        expect(nextState.workspaces.map((w) => `${w.name}:${w.icon}:${w.accent}`).join() === 'Reading:flask:violet,Main:globe:teal' && nextState.activeId === researchId, `After a restart: ${JSON.stringify(nextState.workspaces)}.`)
        expect(nextState.favourites.length === 2 && nextState.favourites.filter((f) => f.workspaceId === null).length === 1, `Favourites after a restart: ${JSON.stringify(nextState.favourites)}.`)
        const shown = JSON.parse(await next.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
        expect(shown.map((tab) => tab.title).join() === 'Page /research-a,Page /research-b,Page /research-c' && shown[0].pinned, `Reading after a restart: ${shown.map((tab) => tab.title).join()}.`)
        await next.evaluate(`${ws}.switchTo({ index: 1 }).then(() => true)`)
        // The tab Main shows wakes and loads; the sidebar and the window keep its saved title all along.
        const titlesSeen = new Set()
        let settled = false
        for (let i = 0; i < 100 && !settled; i += 1) {
          const [active, panel] = JSON.parse(await next.evaluate(`Promise.all([${host}.getTabs().then((t) => t.find((x) => x.active) ?? null), ${host}.getState()]).then((r) => JSON.stringify(r))`))
          if (active) titlesSeen.add(`sidebar: ${active.title}`)
          if (panel.url || panel.isPending) titlesSeen.add(`window: ${panel.title}`)
          settled = !!active && panel.url === lateA && !panel.isLoading
          if (!settled) await next.delay(100)
        }
        expect(settled, 'The page Main shows did not finish loading.')
        expect([...titlesSeen].every((seen) => seen.endsWith(': Page /main-a')), `While its page loaded, the tab Main shows was titled: ${[...titlesSeen].join(' · ')}.`)
        // Saved with that title too, not the address it had while loading.
        const savedTitle = () => { try { return JSON.parse(readFileSync(join(next.profile, 'browser-state.v1.json'), 'utf8')).tabs.find((tab) => tab.url === lateA)?.title } catch { return undefined } }
        for (let i = 0; i < 25 && savedTitle() !== 'Page /main-a'; i += 1) await next.delay(200)
        expect(savedTitle() === 'Page /main-a', `The tab Main shows was saved titled "${savedTitle()}".`)
        const other = JSON.parse(await next.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
        const folders = JSON.parse(await next.evaluate(`${host}.getTabFolders().then((f) => JSON.stringify(f))`))
        // Only the tab Main shows may load; the others stay unloaded until clicked.
        expect(other.map((tab) => tab.title).join() === 'Page /main-pin,Page /main-b,Page /main-a' && other[0].pinned && other.filter((tab) => !tab.active).every((tab) => tab.asleep) && other[0].asleep, `Main after a restart: ${JSON.stringify(other.map((tab) => [tab.title, tab.active, tab.asleep]))}.`)
        expect(folders.length === 1 && other.find((tab) => tab.title === 'Page /main-b').folderId === folders[0].id, `Main's folder after a restart: ${JSON.stringify(folders)}.`)
        return 'restored'
      }).finally(() => lateSite.close())
      expect(restored === 'restored', 'The relaunched app did not check its workspaces.')

      // A browser state from before workspaces (version 2) opens with all its tabs and folders in Main.
      const migrated = await relaunch({ version: 2, url: `${origin}/old-a`, bounds: { x: 40, y: 104, width: 900, height: 600 }, wasVisible: false, tabs: [{ id: 'old-a', url: `${origin}/old-a`, title: 'Old A' }, { id: 'old-b', url: `${origin}/old-b`, title: 'Old B', folderId: 'old-f' }], folders: [{ id: 'old-f', name: 'Old folder', parentId: null }] }, async (next) => {
        const nextState = JSON.parse(await next.evaluate(`${ws}.get().then((s) => JSON.stringify(s))`))
        const shown = JSON.parse(await next.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
        expect(nextState.workspaces.length === 1 && nextState.workspaces[0].name === 'Main' && nextState.workspaces[0].tabCount === 2, `A version 2 state opened as ${JSON.stringify(nextState.workspaces)}.`)
        expect(shown.map((tab) => tab.title).join() === 'Old B,Old A' && shown[0].folderId === 'old-f', `Its tabs in Main: ${JSON.stringify(shown.map((tab) => [tab.title, tab.folderId]))}.`)
        // No saved workspaces were read (the state predates them): sign-in data on disk is never taken for leftovers then.
        await next.delay(1500)
        const kept = [join(next.profile, 'Partitions', 'intoponet-ws-unknown-e2e', 'Cookies'), join(next.profile, 'site-permissions.ws-unknown-e2e.json')]
        expect(kept.every((path) => existsSync(path)), `Starting without saved workspaces removed sign-in data: ${kept.filter((path) => !existsSync(path)).map((path) => path.slice(next.profile.length + 1)).join(', ')} is gone.`)
        return 'migrated'
      }, (profile) => {
        mkdirSync(join(profile, 'Partitions', 'intoponet-ws-unknown-e2e'), { recursive: true })
        writeFileSync(join(profile, 'Partitions', 'intoponet-ws-unknown-e2e', 'Cookies'), 'not ours to judge')
        writeFileSync(join(profile, 'site-permissions.ws-unknown-e2e.json'), '{}')
      })
      expect(migrated === 'migrated', 'The relaunched app did not check the migration.')

      // Delete, after confirming (focus starts on Cancel), and Undo brings it back with its tabs, unreloaded.
      const researchC = (await byTitle('research-c')).id
      await openWorkspaceMenu('Reading', 'the workspace menu')
      await ctx.click('.tab-rail-folder-menu [role="menuitem"]', 'Delete workspace')
      await ctx.wait(`!!document.querySelector('.tab-rail-workspace-confirm[role="alertdialog"]') && document.activeElement?.textContent === 'Cancel'`, 3000, 'the delete confirmation, with focus on Cancel')
      // Escape closes the question and focus goes back to the workspace's actions button (not lost to the page).
      await ctx.press('Escape')
      await ctx.wait(`!document.querySelector('.tab-rail-workspace-confirm') && document.activeElement?.getAttribute('aria-label') === 'Actions for workspace Reading'`, 3000, 'Escape to close the delete confirmation and return focus to the actions button')
      await openWorkspaceMenu('Reading', 'the workspace menu again')
      await ctx.click('.tab-rail-folder-menu [role="menuitem"]', 'Delete workspace')
      await ctx.wait(`!!document.querySelector('.tab-rail-workspace-confirm[role="alertdialog"]') && document.activeElement?.textContent === 'Cancel'`, 3000, 'the delete confirmation again')
      expect((await state()).workspaces.length === 2, 'Asking to delete deleted before it was confirmed.')
      await axeAudit(ctx, 'the delete confirmation', '.tab-rail')
      await ctx.click('.tab-rail-workspace-confirm button', 'Delete workspace')
      await ctx.wait(`${ws}.get().then((s) => s.workspaces.length === 1 && s.recentlyDeleted?.name === 'Reading')`, 3000, 'Reading to be deleted, with Undo offered')
      expect(await titles() === 'main-pin main-b main-a', `After deleting Reading the sidebar shows: ${await titles()}.`)
      await ctx.wait(`[...document.querySelectorAll('.tab-rail-workspace-undo')].some((e) => e.textContent.includes('Deleted “Reading”'))`, 3000, 'the sidebar to offer Undo')
      await ctx.click('.tab-rail-workspace-undo button')
      await ctx.wait(`${ws}.get().then((s) => s.workspaces.length === 2 && s.activeId === ${JSON.stringify(researchId)} && !s.recentlyDeleted)`, 3000, 'Undo to bring Reading back')
      expect(await titles() === 'research-a research-b research-c' && (await tabs()).some((tab) => tab.id === researchC), `After Undo Reading holds: ${await titles()}.`)

      // A tab closed in Reading's folder, reopened while Main is shown, comes back in Reading and in that folder.
      const papers = JSON.parse(await ctx.evaluate(`${host}.getTabFolders().then((f) => JSON.stringify(f))`)).find((folder) => folder.name === 'Papers')
      const closing = await byTitle('research-b')
      expect(papers && closing?.folderId === papers.id, `research-b is not in Papers before closing: ${JSON.stringify(closing)}.`)
      await ctx.evaluate(`${host}.closeTab(${JSON.stringify(closing.id)}).then(() => true)`)
      await ctx.delay(400)
      // Papers is folded meanwhile: reopening opens it, so the tab is in sight.
      await ctx.evaluate(`${host}.updateTabFolder(${JSON.stringify(papers.id)}, { collapsed: true }).then(() => true)`)
      await ctx.evaluate(`${ws}.switchTo({ id: ${JSON.stringify(mainId)} }).then(() => true)`)
      await ctx.delay(600)
      await ctx.evaluate(`${host}.reopenClosedTab().then(() => true)`)
      await ctx.wait(`${ws}.get().then((s) => s.activeId === ${JSON.stringify(researchId)})`, 3000, 'reopening the closed tab to show Reading, where it was closed')
      await ctx.wait(`${host}.getTabs().then((t) => t.some((x) => x.active && x.url.endsWith('/research-b')))`, 6000, 'the reopened tab to be shown in Reading')
      const reopened = (await tabs()).find((tab) => tab.url.endsWith('/research-b'))
      expect(reopened.folderId === papers.id, `The reopened tab came back outside its folder (folder ${reopened.folderId ?? 'none'}).`)
      const papersNow = JSON.parse(await ctx.evaluate(`${host}.getTabFolders().then((f) => JSON.stringify(f))`)).find((folder) => folder.id === papers.id)
      expect(papersNow && !papersNow.collapsed, 'The reopened tab came back in its folder, but the folder stayed folded.')
      await ctx.wait(`!!document.querySelector('.tab-rail-list [data-tab-id=${JSON.stringify(reopened.id)}]')`, 3000, 'the reopened tab to be in sight in its folder')
      expect((await tabs()).map((tab) => tab.url.split('/').pop()).join(' ') === 'research-a research-b research-c', `After reopening, Reading holds: ${(await tabs()).map((tab) => tab.url).join(', ')}.`)
      return `Created, named (icon and colour), renamed, reordered, deleted with confirmation and Undo; each workspace kept its own pinned tab, folder and open tabs; ⌃1/⌃2 switched in ${Math.round(times[0])}–${Math.round(slowest)} ms with the other workspace's sleeping tab left asleep; command menu, swipe and keyboard switched; shared and own favourites; private tabs in no workspace and never saved; restored after a restart and migrated a version 2 state into Main; a tab closed in a folder reopened from another workspace came back in its workspace and folder; axe clean.`
    } finally {
      server.close()
    }
  },
  async IMPORT_WORKSPACES(ctx) {
    rmSync(IMPORT_WS_ROOT, { recursive: true, force: true })
    buildSidebarFixture(IMPORT_WS_ROOT, NEWER_SIDEBAR)
    const host = 'window.intoponet.browserHost'
    const ws = 'window.intoponet.workspaces'
    const section = `document.querySelector('.browser-import')`
    const sectionText = () => ctx.evaluate(`${section}?.innerText ?? ''`)
    const state = async () => JSON.parse(await ctx.evaluate(`${ws}.get().then((s) => JSON.stringify(s))`))
    const tabs = async () => JSON.parse(await ctx.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
    const folders = async () => JSON.parse(await ctx.evaluate(`${host}.getTabFolders().then((f) => JSON.stringify(f))`))
    const show = async (name) => {
      await ctx.evaluate(`${ws}.get().then((s) => ${ws}.switchTo({ id: s.workspaces.find((w) => w.name === ${JSON.stringify(name)}).id })).then(() => true)`)
      await ctx.delay(500)
    }
    /** Pick the profile again (the preview reads the sidebar file afresh). */
    const choose = async () => {
      await ctx.evaluate(`(() => { const radios = [...document.querySelectorAll('.browser-import input[type=radio]')]; const arc = radios.find((i) => i.parentElement.innerText.includes('Arc')); arc.checked = false; arc.focus(); arc.click(); return true })()`)
      await ctx.wait(`(${section}?.innerText ?? '').includes('What to bring') && !(${section}?.innerText ?? '').includes('Looking at')`, 15_000, 'the preview')
    }
    const importNow = async (what) => {
      await ctx.evaluate(`(() => { [...document.querySelectorAll('.browser-import button')].find((b) => b.innerText.trim() === 'Import').focus(); return true })()`)
      await ctx.press('Enter')
      await ctx.wait(`!!document.querySelector('.browser-import-result') || !!document.querySelector('.browser-import .settings-error')`, 30_000, `the import of ${what} to finish`)
      const error = await ctx.evaluate(`document.querySelector('.browser-import .settings-error')?.innerText ?? ''`)
      expect(!error, `Importing ${what} failed: ${error}`)
      await ctx.delay(1200)
      return ctx.evaluate(`document.querySelector('.browser-import-result').innerText`)
    }
    try {
      await openPanel(ctx, 'Settings')
      await ctx.wait(`!!${section}`, 5000, 'the Import section in Settings')
      await ctx.evaluate(`(() => { ${section}.scrollIntoView({ block: 'start' }); return true })()`)
      await ctx.click('.browser-import button', 'Find browsers')
      // Named factually in the list of sources, and only there.
      await ctx.wait(`(${section}?.innerText ?? '').includes('Arc · Default')`, 10_000, 'the sidebar browser in the list of sources')
      await ctx.wait(`(${section}?.innerText ?? '').includes('What to bring')`, 15_000, 'the preview')

      // The preview names each space and what it would bring, and nothing is written yet.
      const preview = await sectionText()
      for (const piece of ['Workspaces 2 spaces and 2 favourites', 'Work: 2 pinned tabs, 2 folders (2 tabs), 1 open tab', 'Home: 1 pinned tab, 1 open tab']) expect(preview.includes(piece), `The preview is missing "${piece}": ${preview}`)
      expect(await ctx.evaluate(`[...document.querySelectorAll('.browser-import-choice input')].find((i) => i.parentElement.innerText.startsWith('Workspaces')).checked`), 'Workspaces is not ticked when spaces were found.')
      expect((await state()).workspaces.length === 1, 'Something was written before Import was pressed.')
      await axeAudit(ctx, 'Settings › Import (spaces preview)', '.browser-import')
      await ctx.shot('preview')

      // Imported: each space a workspace with its pinned tabs, nested folders and open tabs; favourites in the row.
      const result = await importNow('the newer layout')
      for (const piece of ['2 new workspaces (Work, Home)', '2 tabs in folders', '2 favourites']) expect(result.includes(piece), `The result does not say "${piece}": ${result}`)
      let now = await state()
      expect(now.workspaces.map((w) => w.name).join() === 'Main,Work,Home', `Workspaces after the import: ${now.workspaces.map((w) => w.name).join()}.`)
      expect(now.favourites.map((f) => f.url).join() === 'https://mail.example.com/,https://maps.example.com/' && now.favourites.every((f) => f.workspaceId === null), `Favourites after the import: ${JSON.stringify(now.favourites)}.`)
      expect((await tabs()).length === 0, 'Imported tabs went into the workspace that was open.')
      await show('Work')
      const work = await tabs()
      const workFolders = await folders()
      expect(work.map((tab) => tab.title).join() === 'Docs,Team chat,Tonga,Samoa,Today', `Work holds: ${work.map((tab) => tab.title).join()}.`)
      expect(work.filter((tab) => tab.pinned).every((tab) => tab.home === tab.url) && work.filter((tab) => tab.pinned).length === 2, 'Work\'s pinned tabs did not come over with their home.')
      const reading = workFolders.find((f) => f.name === 'Reading')
      const later = workFolders.find((f) => f.name === 'Later')
      expect(reading && later && reading.parentId === null && later.parentId === reading.id, `Work's folders lost their nesting: ${JSON.stringify(workFolders)}.`)
      expect(work.find((tab) => tab.title === 'Tonga').folderId === reading.id && work.find((tab) => tab.title === 'Samoa').folderId === later.id, 'The tabs are not in their folders.')
      expect(work.every((tab) => tab.asleep || tab.active), 'Imported tabs loaded before they were shown.')
      await show('Home')
      expect((await tabs()).map((tab) => tab.title).join() === 'Recipes,Weather', `Home holds: ${(await tabs()).map((tab) => tab.title).join()}.`)

      // Again: nothing doubles.
      const again = await importNow('the same file again')
      expect(again.includes('Nothing new'), `A second import added something: ${again}`)
      now = await state()
      expect(now.workspaces.length === 3 && now.favourites.length === 2 && now.workspaces.find((w) => w.name === 'Work').tabCount === 5, `A second import changed the workspaces: ${JSON.stringify(now.workspaces)}.`)

      // The older layout of the same file: its space comes over too, its favourite joins the row.
      writeFileSync(join(IMPORT_WS_ROOT, 'Arc', 'StorableSidebar.json'), JSON.stringify(OLDER_SIDEBAR))
      await choose()
      expect((await sectionText()).includes('Travel: 1 pinned tab, 1 folder (2 tabs), 1 open tab'), `The older layout's preview: ${await sectionText()}`)
      const older = await importNow('the older layout')
      expect(older.includes('1 new workspace (Travel)') && older.includes('1 favourite'), `Unexpected result for the older layout: ${older}`)
      await show('Travel')
      const travel = await tabs()
      expect(travel.map((tab) => tab.title).join() === 'Flights,Kyoto,Osaka,Hotels' && (await folders()).map((f) => f.name).join() === 'Japan', `Travel holds: ${travel.map((tab) => tab.title).join()} in ${(await folders()).map((f) => f.name).join()}.`)

      // A file in a shape it does not know is reported, and nothing is read from it or written.
      const before = JSON.stringify(await state())
      writeFileSync(join(IMPORT_WS_ROOT, 'Arc', 'StorableSidebar.json'), JSON.stringify({ sidebar: { containers: [{ global: {} }, { spaces: 'not a list', items: {} }] } }))
      await choose()
      const refused = await sectionText()
      expect(refused.includes('not in a format Intoponet knows'), `An unsupported sidebar file was not reported: ${refused}`)
      expect(!(await ctx.evaluate(`[...document.querySelectorAll('.browser-import-choice input')].find((i) => i.parentElement.innerText.startsWith('Workspaces')).checked`)), 'Workspaces stayed ticked for an unreadable file.')
      writeFileSync(join(IMPORT_WS_ROOT, 'Arc', 'StorableSidebar.json'), '{"sidebar": {"containers": [')
      await choose()
      expect((await sectionText()).includes('not in a format Intoponet knows'), 'A damaged sidebar file was not reported.')
      expect(JSON.stringify(await state()) === before, 'An unreadable sidebar file changed the workspaces.')
      await axeAudit(ctx, 'Settings › Import (unreadable sidebar)', '.browser-import')
      return 'Previewed 2 spaces and 2 favourites with each space\'s pinned tabs, folders and open tabs; recreated Work and Home as workspaces (pinned tabs with homes, Reading › Later nesting kept, open tabs unloaded) and the favourites row; a second run added nothing; the older file layout added Travel (split view opened up); an unsupported and a damaged file were reported and changed nothing; keyboard and axe clean. Fixtures are hand-built, not real files.'
    } finally {
      rmSync(IMPORT_WS_ROOT, { recursive: true, force: true })
    }
  },
  async AD_SLOTS(ctx) {
    // A news-like page with three kinds of ad space, and one "ad" container that also holds the story.
    const page = `<!doctype html><title>Story with ads</title><body style="font:16px system-ui;margin:40px">
      <article><h1>Story</h1><p id="lead">The story starts here.</p>
        <div id="slot-frame" class="ad-slot" style="min-height:250px;background:#eee"><span>Advertisement</span><iframe src="https://securepubads.g.doubleclick.net/gampad/ads?slot=1" width="300" height="250"></iframe></div>
        <div id="slot-image" style="min-height:90px;background:#eee"><img src="https://pagead2.googlesyndication.com/pagead/banner.png" width="728" height="90" alt=""></div>
        <div id="slot-empty" class="ad" style="height:120px;background:#eee"></div>
        <div id="slot-with-story" class="ad" style="background:#eee"><p>A paragraph of the story that happens to sit in an "ad" box.</p></div>
        <p id="tail">The story goes on.</p></article></body>`
    const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(page) })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    const boxes = async () => JSON.parse(await (await ctx.page('/story')).evaluate(`JSON.stringify(Object.fromEntries(['lead', 'slot-frame', 'slot-image', 'slot-empty', 'slot-with-story', 'tail'].map((id) => [id, Math.round(document.getElementById(id).getBoundingClientRect().height)])))`))
    try {
      await openPage(ctx, `${origin}/story`, 4500)
      const shown = await boxes()
      expect(shown['slot-frame'] === 0, `The blocked ad frame left a ${shown['slot-frame']} px box.`)
      expect(shown['slot-image'] === 0, `The blocked ad picture left a ${shown['slot-image']} px box.`)
      expect(shown['slot-empty'] === 0, `The empty ad slot is still ${shown['slot-empty']} px tall.`)
      expect(shown['slot-with-story'] > 0 && shown.lead > 0 && shown.tail > 0, `Story text was hidden: ${JSON.stringify(shown)}.`)
      // With protection paused for the site, the page is left as it is.
      await ctx.evaluate(`window.intoponet.browserHost.setSiteProtection(false).then(() => true)`)
      await ctx.delay(4500)
      const paused = await boxes()
      expect(paused['slot-frame'] > 0 && paused['slot-empty'] > 0, `With protection paused the ad spaces stayed hidden: ${JSON.stringify(paused)}.`)
      await ctx.evaluate(`window.intoponet.browserHost.setSiteProtection(true).then(() => true)`)
      await ctx.delay(1500)
      const again = await boxes()
      expect(again['slot-frame'] === 0 && again['slot-empty'] === 0 && again['slot-with-story'] > 0, `Protection back on did not hide the ad spaces again: ${JSON.stringify(again)}.`)
      return `Blocked ad frame, ad picture and empty slot collapsed (0 px); story text kept (${shown['slot-with-story']} px box with text stays); left alone with protection paused.`
    } finally {
      server.close()
    }
  },
  async LINK_PREVIEW(ctx) {
    // A page with links, the page they lead to (with an ad frame and an ad picture) and one more page after it.
    const pages = {
      '/home': `<!doctype html><html lang="en"><title>Home page</title><body style="font:16px system-ui;margin:0">
        <a id="lnk" href="/target" style="position:absolute;left:40px;top:40px;width:320px;height:48px;display:block">Read the target story</a>
        <a id="other" href="/elsewhere" style="position:absolute;left:40px;top:120px">Somewhere else</a></body></html>`,
      '/private-home': `<!doctype html><html lang="en"><title>Private home</title><body style="font:16px system-ui;margin:0">
        <a id="lnk" href="/private-target" style="position:absolute;left:40px;top:40px;width:320px;height:48px;display:block">A private story</a></body></html>`,
      '/target': `<!doctype html><html lang="en"><title>Target story</title><body style="font:16px system-ui;margin:24px">
        <h1>Target story</h1><p id="lead">The story starts here.</p>
        <div id="slot" class="ad-slot" style="min-height:250px;background:#eee"><span>Advertisement</span><iframe src="https://securepubads.g.doubleclick.net/gampad/ads?slot=lp" width="300" height="250"></iframe></div>
        <img src="https://pagead2.googlesyndication.com/pagead/lp-banner.png" width="728" height="90" alt="">
        <p><a id="next" href="/target2">Next page</a> <button id="last" type="button">Last control</button></p></body></html>`,
      '/target2': `<!doctype html><html lang="en"><title>Second page</title><body style="font:16px system-ui;margin:24px"><h1>Second page</h1></body></html>`,
      '/private-target': `<!doctype html><html lang="en"><title>Private target</title><body><h1>Private target</h1></body></html>`,
    }
    const server = createServer((request, response) => {
      const path = new URL(request.url, 'http://localhost').pathname
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(pages[path] ?? `<!doctype html><title>Page ${path}</title><h1>${path}</h1>`)
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    const host = 'window.intoponet.browserHost'
    const tabs = async () => JSON.parse(await ctx.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
    /** What is on screen: the card (frame + page on top), the views under it, and focus. */
    const card = () => ctx.main(`(() => {
      const win = electron.BrowserWindow.getAllWindows()[0]
      const kids = win.contentView.children.filter((v) => v.webContents && !v.webContents.isDestroyed())
      const frame = kids.find((v) => v.webContents.getURL().startsWith('data:') && v.webContents.getURL().includes('link-preview-card'))
      const page = frame ? kids[kids.length - 1] : null
      const partition = (c) => c.session === electron.session.fromPartition('intoponet-private') ? 'private' : c.session === electron.session.fromPartition('persist:intoponet-default') ? 'normal' : 'other'
      return JSON.stringify({
        windows: electron.BrowserWindow.getAllWindows().length,
        open: !!frame && page !== frame && kids.indexOf(frame) === kids.length - 2,
        url: page ? page.webContents.getURL() : null,
        id: page ? page.webContents.id : null,
        bounds: page ? page.getBounds() : null,
        partition: page ? partition(page.webContents) : null,
        pageFocused: page ? page.webContents.isFocused() : false,
        frameFocused: frame ? frame.webContents.isFocused() : false,
        shellFocused: win.webContents.isFocused(),
        under: kids.filter((v) => v !== frame && v !== page).map((v) => ({ url: v.webContents.getURL(), bounds: v.getBounds(), focused: v.webContents.isFocused() })),
      })
    })()`).then(JSON.parse)
    /** Focus is only reported for the key window: bring the app forward first (other apps may be in front during checks). */
    const focusState = async () => {
      await ctx.main(`(() => { electron.app.focus({ steal: true }); electron.BrowserWindow.getAllWindows()[0].focus(); return true })()`)
      await ctx.delay(400)
      return card()
    }
    const waitOpen = async (part, label) => {
      for (let i = 0; i < 40; i += 1) {
        const state = await card()
        if (state.open && (!part || (state.url ?? '').includes(part))) return state
        await ctx.delay(250)
      }
      throw new CheckFailure(`The preview card did not open (${label}).`)
    }
    const waitClosed = async (label) => {
      for (let i = 0; i < 20; i += 1) {
        const state = await card()
        if (!state.open && !state.id) return state
        await ctx.delay(250)
      }
      throw new CheckFailure(`The preview card stayed open after ${label}.`)
    }
    /** Keys as the OS delivers them, to one web contents. */
    const keyTo = (id, keyCode, modifiers = []) => ctx.main(`(() => { const c = electron.webContents.fromId(${id}); for (const type of ['keyDown', 'keyUp']) c.sendInputEvent({ type, keyCode: ${JSON.stringify(keyCode)}, modifiers: ${JSON.stringify(modifiers)} }); return true })()`)
    const shiftClick = async (session, selector) => {
      const box = JSON.parse(await session.evaluate(`JSON.stringify(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect())`))
      for (const type of ['mousePressed', 'mouseReleased']) await session.send('Input.dispatchMouseEvent', { type, x: box.x + box.width / 2, y: box.y + box.height / 2, button: 'left', clickCount: 1, modifiers: 8 })
    }
    const focusedLink = (session) => session.evaluate(`document.activeElement?.id ?? ''`)
    try {
      // Every request the protection blocks, in either session, with the page that asked for it.
      await ctx.main(`(() => { globalThis.__lpBlocked = []; for (const p of ['persist:intoponet-default', 'intoponet-private']) electron.session.fromPartition(p).webRequest.onErrorOccurred((d) => { if (d.error === 'net::ERR_BLOCKED_BY_CLIENT') globalThis.__lpBlocked.push({ id: d.webContentsId, url: d.url }) }); return true })()`)
      await openPage(ctx, `${origin}/home`, 2500)
      const home = await ctx.page('/home')
      const before = await tabs()
      const homeHistory = await home.evaluate('history.length')

      // ⇧-click: a card over the page, no new window or tab, the page under it as it was.
      await shiftClick(home, '#lnk')
      const shown = await waitOpen('/target', '⇧-click on a link')
      expect(shown.windows === 1, `⇧-click opened a window (${shown.windows} windows).`)
      await ctx.delay(1500)
      const during = await tabs()
      expect(during.length === before.length, `⇧-click opened a tab (${before.length} → ${during.length}).`)
      const under = shown.under.find((view) => view.url.includes('/home'))
      expect(!!under, 'The page under the card is gone.')
      expect(await home.evaluate('location.pathname') === '/home' && await home.evaluate('history.length') === homeHistory, 'The page under the card navigated.')
      const share = [shown.bounds.width / under.bounds.width, shown.bounds.height / under.bounds.height]
      expect(share.every((s) => s >= 0.7 && s <= 0.85), `The card is not about 80% of the page (${share.map((s) => Math.round(s * 100)).join('% × ')}%).`)
      expect(shown.partition === 'normal', `The preview of a normal tab is in the "${shown.partition}" session.`)
      const entered = await focusState()
      expect(entered.open && entered.pageFocused && !entered.under.some((view) => view.focused), `Focus did not move into the card (${JSON.stringify({ page: entered.pageFocused, frame: entered.frameFocused, shell: entered.shellFocused })}).`)
      const previewId = shown.id

      // Protection: the ad frame and ad picture are blocked in the card, and their space is hidden.
      await ctx.delay(3500)
      const blocked = await ctx.main(`JSON.stringify(globalThis.__lpBlocked.filter((b) => b.id === ${previewId}).map((b) => new URL(b.url).hostname))`).then(JSON.parse)
      expect(blocked.some((h) => h.includes('doubleclick')) && blocked.some((h) => h.includes('googlesyndication')), `Protection did not block the test ad hosts in the preview (blocked: ${blocked.join(', ') || 'nothing'}).`)
      const preview = await ctx.page('/target')
      const slot = await preview.evaluate(`Math.round(document.getElementById('slot').getBoundingClientRect().height)`)
      expect(slot === 0, `The blocked ad left a ${slot} px box in the preview.`)

      // The card's own controls pass axe.
      const frame = await ctx.page('link-preview-card')
      if (!(await frame.evaluate(`typeof axe !== 'undefined'`))) await frame.evaluate(`${readFileSync(join(repo, 'node_modules/axe-core/axe.min.js'), 'utf8')}; true`)
      const violations = JSON.parse(await frame.evaluate(`axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] }).then((r) => JSON.stringify(r.violations.map((v) => v.id + ' ×' + v.nodes.length)))`))
      expect(violations.length === 0, `WCAG violations on the preview card: ${violations.join(', ')}`)
      const heading = await frame.evaluate(`document.getElementById('title').textContent`)
      expect(heading === 'Target story', `The card's title bar says "${heading}".`)

      // Focus stays in the card: Tab from Close goes into the page, Tab past the page's last control comes back to the title bar.
      await frame.evaluate(`document.getElementById('close').focus(); true`)
      await keyTo(await ctx.main(`electron.BrowserWindow.getAllWindows()[0].contentView.children.find((v) => v.webContents?.getURL().includes('link-preview-card')).webContents.id`), 'Tab')
      await ctx.delay(300)
      let state = await focusState()
      expect(state.pageFocused && !state.frameFocused, `Tab from the card's Close button left the card (${JSON.stringify({ ...state, under: undefined })}; frame focus "${await frame.evaluate('document.activeElement?.id ?? ""')}").`)
      await preview.evaluate(`document.getElementById('last').focus(); true`)
      await keyTo(previewId, 'Tab')
      await ctx.delay(300)
      state = await focusState()
      const titleBarFocus = await frame.evaluate(`document.activeElement?.id ?? ''`)
      expect(state.frameFocused && titleBarFocus === 'open-tab' && !state.shellFocused && !state.under.some((view) => view.focused), `Tab past the page's last control left the card (title bar focus: "${titleBarFocus}").`)

      // Escape closes it and focus goes back to the link.
      // (The link lost focus meanwhile, so finding it focused again is the card's doing.)
      await home.evaluate(`document.activeElement?.blur(); true`)
      await keyTo(previewId, 'Escape')
      await waitClosed('Escape')
      await ctx.delay(400)
      expect(await focusedLink(home) === 'lnk', 'After Escape, focus did not return to the link.')

      // Preview Link from the context menu (the native menu is read, not shown); then a click outside closes it.
      await home.evaluate(`document.activeElement?.blur(); true`)
      await ctx.main(`(() => { const M = electron.Menu; globalThis.__lpBuild = M.buildFromTemplate; M.buildFromTemplate = (template) => { globalThis.__lpMenu = template; return { popup() {} } }; return true })()`)
      const box = JSON.parse(await home.evaluate(`JSON.stringify(document.getElementById('lnk').getBoundingClientRect())`))
      for (const type of ['mousePressed', 'mouseReleased']) await home.send('Input.dispatchMouseEvent', { type, x: box.x + 20, y: box.y + 20, button: 'right', clickCount: 1 })
      await ctx.delay(800)
      const items = await ctx.main(`(() => { const t = globalThis.__lpMenu || []; electron.Menu.buildFromTemplate = globalThis.__lpBuild; const item = t.find((i) => i.label === 'Preview Link'); if (item) item.click(); return JSON.stringify(t.map((i) => i.label).filter(Boolean)) })()`).then(JSON.parse)
      expect(items.includes('Preview Link'), `The link's context menu has no "Preview Link" (${items.join(', ')}).`)
      const fromMenu = await waitOpen('/target', 'Preview Link')
      await ctx.main(`(() => { const f = electron.BrowserWindow.getAllWindows()[0].contentView.children.find((v) => v.webContents?.getURL().includes('link-preview-card')); for (const type of ['mouseDown', 'mouseUp']) f.webContents.sendInputEvent({ type, x: 6, y: 6, button: 'left', clickCount: 1 }); return true })()`)
      await waitClosed('a click outside it')
      await ctx.delay(400)
      expect(await focusedLink(home) === 'lnk', 'After a click outside, focus did not return to the link.')
      expect(fromMenu.id !== previewId, 'The preview reused a closed page.')

      // ⌘W closes the card, not the tab under it.
      await shiftClick(home, '#lnk')
      const third = await waitOpen('/target', '⇧-click again')
      await ctx.delay(800)
      await keyTo(third.id, 'W', ['meta'])
      await waitClosed('⌘W')
      expect((await tabs()).length === before.length, '⌘W closed the tab under the card as well.')

      // Open as Tab: the same page, with the back list from inside the card.
      await shiftClick(home, '#lnk')
      const fourth = await waitOpen('/target', '⇧-click for Open as Tab')
      await ctx.delay(1200)
      // A real click (scripted ones leave a back list Chromium skips).
      const inCard = await ctx.page('/target')
      const next = JSON.parse(await inCard.evaluate(`JSON.stringify(document.getElementById('next').getBoundingClientRect())`))
      for (const type of ['mousePressed', 'mouseReleased']) await inCard.send('Input.dispatchMouseEvent', { type, x: next.x + next.width / 2, y: next.y + next.height / 2, button: 'left', clickCount: 1 })
      await waitOpen('/target2', 'a link followed inside the card')
      await ctx.delay(800)
      // The frame closes as it answers: do not wait for the reply.
      void (await ctx.page('link-preview-card')).evaluate(`setTimeout(() => document.getElementById('open-tab').click(), 50); true`).catch(() => undefined)
      await waitClosed('Open as Tab')
      await ctx.delay(800)
      const after = await tabs()
      const moved = after.find((tab) => tab.active)
      expect(after.length === before.length + 1 && moved?.url === `${origin}/target2`, `Open as Tab did not show the page as a tab (${after.map((tab) => tab.url).join(', ')}).`)
      const panel = await panelState(ctx)
      expect(panel.canGoBack, 'The tab made from the preview lost its back list.')
      const sameContents = await ctx.main(`electron.webContents.fromId(${fourth.id})?.getURL() ?? ''`)
      expect(sameContents === `${origin}/target2`, 'Open as Tab made a new page instead of keeping the preview\'s.')
      await ctx.evaluate(`${host}.closeActiveTab().then(() => true)`)
      await ctx.delay(800)

      // A private tab's preview is private.
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(true).then(() => true)`)
      await openPage(ctx, `${origin}/private-home`, 2500)
      const privateHome = await ctx.page('/private-home')
      await shiftClick(privateHome, '#lnk')
      const privately = await waitOpen('/private-target', '⇧-click in a private tab')
      expect(privately.partition === 'private', `A preview from a private tab is in the "${privately.partition}" session.`)
      const badge = await (await ctx.page('link-preview-card')).evaluate(`document.querySelector('.private')?.textContent ?? ''`)
      expect(badge === 'Private', 'The private preview does not say it is private.')
      await keyTo(privately.id, 'Escape')
      await waitClosed('Escape in a private preview')
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(false).then(() => true)`)
      await ctx.delay(800)

      // A headline in the World list, ⇧-clicked, is previewed over the globe, which stays showing.
      await ctx.evaluate(`${host}.getTabs().then((t) => Promise.all(t.map((x) => ${host}.closeTab(x.id)))).then(() => true)`)
      await ctx.delay(800)
      await ctx.waitForNews()
      expect(await ctx.click('.globe-tabs button', 'World'), 'The World tab is missing.')
      await ctx.wait(`document.querySelectorAll('.world-list .world-row').length > 0`, 90_000, 'stories covered across the world')
      await ctx.evaluate(`(() => { const row = document.querySelector('.world-list .world-row'); row.focus(); row.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); return true })()`)
      const headline = await waitOpen('http', '⇧-click on a World list headline')
      expect(/^https?:/.test(headline.url) && !headline.url.startsWith(origin), `The World list preview shows ${headline.url}.`)
      const globe = await panelState(ctx)
      expect(!globe.isVisible && await ctx.evaluate(`!!document.querySelector('canvas') && !!document.querySelector('.world-list')`), 'Previewing a headline left the globe.')
      await ctx.delay(1500)
      await ctx.shot('world-preview')
      await keyTo(headline.id, 'Escape')
      await waitClosed('Escape over the globe')
      await ctx.delay(400)
      const back = await ctx.evaluate(`document.activeElement?.classList.contains('world-row') ?? false`)
      expect(back && !(await panelState(ctx)).isVisible, 'Closing the headline preview did not return to the World list.')
      return `⇧-click and Preview Link opened a ${Math.round(share[0] * 100)}% × ${Math.round(share[1] * 100)}% card with no new window or tab and the page under it unchanged; ads blocked (${[...new Set(blocked)].join(', ')}) and their space hidden in the card; Escape, a click outside and ⌘W closed it with focus back on the link; Tab stayed in the card; Open as Tab kept the page and its back list; a private tab's preview was private; a World list headline was previewed over the globe; axe clean.`
    } finally {
      await ctx.main(`(() => { for (const p of ['persist:intoponet-default', 'intoponet-private']) electron.session.fromPartition(p).webRequest.onErrorOccurred(null); return true })()`).catch(() => undefined)
      server.close()
    }
  },
  async SITE_TWEAKS(ctx) {
    // Two hosts are two sites: 127.0.0.1 (A) and localhost (B). Local pages only.
    const tweaksFile = join(ctx.profile, 'site-tweaks.json')
    const storedSites = () => (existsSync(tweaksFile) ? JSON.parse(readFileSync(tweaksFile, 'utf8')).sites ?? {} : {})
    const storedLater = async () => { await ctx.delay(1200); return storedSites() }
    const markup = (name) => `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title></head><body style="font:16px system-ui;margin:0">
      <header>${name} header</header><div id="wrap"><div id="promo" class="banner">PROMO-SENTINEL buy now</div>
      <main><article><h1>${name} story</h1><p id="para">The story text on ${name}.</p></article></main></div></body></html>`
    // /strict-csp forbids inline styles, as some sites do: the tweaks must still apply there.
    const siteA = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...(request.url.startsWith('/strict-csp') ? { 'content-security-policy': "style-src 'self'" } : {}) }); response.end(markup('Site A')) })
    const siteB = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(markup('Site B')) })
    await new Promise((resolve) => siteA.listen(0, '127.0.0.1', resolve))
    await new Promise((resolve) => siteB.listen(0, 'localhost', resolve))
    const portA = siteA.address().port
    const portB = siteB.address().port
    const urlA = `http://127.0.0.1:${portA}/tweak`
    const urlB = `http://localhost:${portB}/tweak`
    const urlPrivate = `http://127.0.0.1:${portA}/private-tweak`
    const statusIs = (text) => `(document.querySelector('.site-tweaks-status')?.innerText ?? '').includes(${JSON.stringify(text)})`
    const errorIs = (text) => `(document.querySelector('.site-tweaks-error')?.innerText ?? '').includes(${JSON.stringify(text)})`
    const navigate = (url) => ctx.evaluate(`window.intoponet.browserHost.navigate(${JSON.stringify(url)}).then(() => true)`).then(() => ctx.delay(2000))
    const pageStyles = async (page) => JSON.parse(await page.evaluate(`JSON.stringify((() => {
      const s = (el) => (el ? getComputedStyle(el) : null);
      const para = document.getElementById('para');
      return { wrapMax: s(document.getElementById('wrap'))?.maxWidth ?? null, font: s(para)?.fontFamily ?? null, spacing: s(para)?.letterSpacing ?? null,
        colour: s(para)?.color ?? null, bodyBg: s(document.body)?.backgroundColor ?? null, promo: s(document.getElementById('promo'))?.display ?? null,
        scripts: document.querySelectorAll('script').length };
    })())`))
    const openCustomize = async () => {
      if (!(await ctx.evaluate(`!!document.querySelector('#site-tweaks-panel')`))) {
        if (!(await ctx.evaluate(`!!document.querySelector('.shield-bar')`))) {
          expect(await ctx.click('.shield-control > button'), 'The Protection button is missing.')
          await ctx.delay(600)
        }
        expect(await ctx.click('.shield-bar-toggle', 'Customize site'), 'The "Customize site" button is missing from the protection bar.')
      }
      await ctx.wait(`!!document.querySelector('#site-tweaks-title')`, 8000, 'the Customize site panel')
      await ctx.delay(300)
    }
    const setTweakCss = (value) => ctx.evaluate(`(() => { const t = document.querySelector('.site-tweaks-css textarea'); if (!t) return false;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(value)});
      t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    const saveStyles = async () => {
      expect(await ctx.click('.site-tweaks button', 'Save styles'), 'The "Save styles" button is missing.')
    }
    // A pointer click on the page, as a person makes it (CDP sends it to the page itself).
    const clickInPage = async (page, selector) => {
      const box = JSON.parse(await page.evaluate(`JSON.stringify(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect())`))
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    }
    const pressInPage = async (page, key, code) => {
      for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: code === 'Escape' ? 27 : 0 })
    }
    const closeAllTabs = () => ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => Promise.all(t.map((x) => window.intoponet.browserHost.closeTab(x.id)))).then(() => true)`)
    try {
      // Pick an element on site A: Escape stops picking and saves nothing; then point at #promo and save.
      await ctx.evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: ${JSON.stringify(urlA)} }).then(() => true)`)
      await ctx.delay(2500)
      await openCustomize()
      expect(await ctx.click('#site-tweaks-panel button', 'Hide an element'), 'The "Hide an element" button is missing.')
      await ctx.delay(800)
      const pageA = await ctx.page(`127.0.0.1:${portA}/tweak`)
      await pressInPage(pageA, 'Escape', 'Escape')
      await ctx.wait(statusIs('No element was picked'), 8000, 'Escape to stop picking')
      expect((await pageStyles(pageA)).promo === 'block', 'Stopping the picker still hid the element.')

      await ctx.click('#site-tweaks-panel button', 'Hide an element')
      await ctx.delay(800)
      await clickInPage(pageA, '#promo')
      await ctx.wait(`(document.querySelector('.site-tweaks-picked')?.innerText ?? '').includes('#promo')`, 10_000, 'the picked element to wait for a Save')
      expect((await pageStyles(pageA)).promo === 'none', 'The picked element was not previewed (hidden) before saving.')
      expect(await ctx.click('.site-tweaks-picked button', 'Save'), 'The Save button for the picked element is missing.')
      await ctx.wait(statusIs('Element hidden on this site'), 8000, 'the saved element')
      expect((await pageStyles(pageA)).promo === 'none', 'The saved element is not hidden on the page.')
      const afterSave = await storedLater()
      expect(afterSave['127.0.0.1']?.hidden?.includes('#promo'), `The hidden element was not written to site-tweaks.json: ${JSON.stringify(afterSave)}.`)

      // Reload: still hidden. Site B is not touched.
      await ctx.evaluate(`window.intoponet.browserHost.reload().then(() => true)`)
      await ctx.delay(2500)
      expect((await pageStyles(await ctx.page(`127.0.0.1:${portA}/tweak`))).promo === 'none', 'After a reload the hidden element is back.')
      await navigate(urlB)
      const b0 = await pageStyles(await ctx.page(`localhost:${portB}/tweak`))
      expect(b0.promo === 'block', 'Site B lost an element it never had hidden (the tweak leaked across hosts).')

      // Back on A: width, font and dark colours change A's computed styles.
      await navigate(urlA)
      await openCustomize()
      expect(await ctx.click('.site-tweaks-choice button', 'Narrow'), 'The Width choices are missing.')
      await ctx.wait(statusIs('Width saved'), 8000, 'the width to be saved')
      expect(await ctx.click('.site-tweaks-choice button', 'Serif'), 'The Font choices are missing.')
      await ctx.wait(statusIs('Font saved'), 8000, 'the font to be saved')
      expect(await ctx.click('.site-tweaks-choice button', 'Dark'), 'The Colour choices are missing.')
      await ctx.wait(statusIs('Colours saved'), 8000, 'the colours to be saved')
      let styled = await pageStyles(await ctx.page(`127.0.0.1:${portA}/tweak`))
      expect(styled.wrapMax === '672px', `Narrow width did not centre the reading column on A: max-width ${styled.wrapMax}.`)
      expect(/Georgia/.test(styled.font ?? ''), `Serif font did not apply on A: ${styled.font}.`)
      expect(styled.bodyBg === 'rgb(28, 28, 30)', `Dark colours did not apply on A: ${styled.bodyBg}.`)

      // Own styles apply. @import is refused with a reason; markup that would run a script is refused, and nothing runs.
      await setTweakCss('#para { letter-spacing: 3px }')
      await saveStyles()
      await ctx.wait(statusIs('Styles saved'), 8000, 'the styles to be saved')
      expect((await pageStyles(await ctx.page(`127.0.0.1:${portA}/tweak`))).spacing === '3px', 'The own style rule did not apply on A.')
      await setTweakCss('@import url("https://example.org/a.css"); #para { letter-spacing: 9px }')
      await saveStyles()
      await ctx.wait(errorIs('cannot load other style sheets'), 8000, 'the @import refusal')
      expect((await pageStyles(await ctx.page(`127.0.0.1:${portA}/tweak`))).spacing === '3px', 'A refused style was applied anyway.')
      await setTweakCss('p { color: red }</style><script>window.SITE_TWEAK_SENTINEL = 1</script>')
      await saveStyles()
      await ctx.wait(errorIs('cannot contain HTML'), 8000, 'the script-markup refusal')
      const sentinel = await (await ctx.page(`127.0.0.1:${portA}/tweak`)).evaluate(`JSON.stringify({ sentinel: typeof window.SITE_TWEAK_SENTINEL, scripts: document.querySelectorAll('script').length })`)
      expect(sentinel === JSON.stringify({ sentinel: 'undefined', scripts: 0 }), `A script in the styles ran or was added to the page: ${sentinel}.`)
      await setTweakCss('#para { letter-spacing: 3px }')
      await saveStyles()
      await ctx.wait(statusIs('Styles saved'), 8000, 'the styles to be saved again')
      // A page of site A whose Content-Security-Policy forbids inline styles gets the same tweaks.
      await navigate(`http://127.0.0.1:${portA}/strict-csp`)
      const strict = await pageStyles(await ctx.page(`127.0.0.1:${portA}/strict-csp`))
      expect(strict.promo === 'none' && strict.wrapMax === '672px' && strict.spacing === '3px', `A page that forbids inline styles (CSP) did not get site A's tweaks: ${JSON.stringify(strict)}.`)

      // Site B has none of it.
      await navigate(urlB)
      const b1 = await pageStyles(await ctx.page(`localhost:${portB}/tweak`))
      expect(b1.wrapMax === 'none' && !/Georgia/.test(b1.font ?? '') && b1.bodyBg !== 'rgb(28, 28, 30)' && b1.promo === 'block', `Site B changed with site A's tweaks: ${JSON.stringify(b1)}.`)
      // Nor when site B loads beside site A in a split, with site A focused.
      await navigate(urlA)
      await ctx.evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: ${JSON.stringify(urlB)} }, 'background-tab').then(() => true)`)
      await ctx.delay(1500)
      await ctx.evaluate(`window.intoponet.browserHost.splitTab().then(() => true)`)
      await ctx.wait(`window.intoponet.browserHost.getState().then((s) => s.split?.focused === 'left')`, 8000, 'site A and site B side by side')
      await ctx.main(`(() => { electron.webContents.getAllWebContents().find((c) => c.getURL().startsWith(${JSON.stringify(urlB)})).reload(); return true })()`)
      await ctx.delay(2000)
      const beside = await pageStyles(await ctx.page(`localhost:${portB}/tweak`))
      expect(beside.promo === 'block', `Site B, loaded beside site A, got site A's hidden elements: ${JSON.stringify(beside)}.`)
      expect(await ctx.evaluate(`window.intoponet.browserHost.getState().then((s) => s.split?.focused === 'left')`), 'Site B loading beside site A took the focus.')
      await ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => window.intoponet.browserHost.closeTab(t.find((x) => x.url.startsWith(${JSON.stringify(urlB)})).id)).then(() => true)`)
      await ctx.delay(800)
      await navigate(urlA)
      await openCustomize()
      await axeAudit(ctx, 'the Customize site panel', '#site-tweaks-panel')

      // A private tab on A sees the tweaks; its own change is in memory only and is never written.
      const writtenBefore = await storedLater()
      const textBefore = existsSync(tweaksFile) ? readFileSync(tweaksFile, 'utf8') : ''
      expect(writtenBefore['127.0.0.1']?.hidden?.includes('#promo'), 'The tweak is not saved before the private tab.')
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(true).then(() => true)`)
      await ctx.evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: ${JSON.stringify(urlPrivate)} }).then(() => true)`)
      await ctx.delay(2500)
      await openCustomize()
      const pagePrivate = await ctx.page(`127.0.0.1:${portA}/private-tweak`)
      const seen = await pageStyles(pagePrivate)
      expect(seen.promo === 'none' && seen.wrapMax === '672px', `A private tab does not see the site's tweaks: ${JSON.stringify(seen)}.`)
      await setTweakCss('#para { color: rgb(0, 128, 0) }')
      await saveStyles()
      await ctx.wait(statusIs('Styles saved'), 8000, 'the private styles to be saved')
      expect((await pageStyles(pagePrivate)).colour === 'rgb(0, 128, 0)', 'The private tab did not apply its own change.')
      const textAfter = await storedLater().then(() => (existsSync(tweaksFile) ? readFileSync(tweaksFile, 'utf8') : ''))
      expect(textAfter === textBefore && !textAfter.includes('rgb(0, 128, 0)'), 'A change made in a private tab was written to site-tweaks.json.')
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(false).then(() => true)`)
      await ctx.delay(1000)
      await closeAllTabs()
      await ctx.delay(500)

      // Turn off: the styles go at once, with no reload (a marker in the page survives).
      await ctx.evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: ${JSON.stringify(urlA)} }).then(() => true)`)
      await ctx.delay(2500)
      await openCustomize()
      const live = await ctx.page(`127.0.0.1:${portA}/tweak`)
      await live.evaluate(`window.__sameDocument = 'yes'`)
      expect(await ctx.click('.site-tweaks-switch input'), 'The "Tweaks on for this site" switch is missing.')
      await ctx.wait(statusIs('Tweaks are off'), 8000, 'the switch to turn tweaks off')
      await ctx.delay(800)
      const off = await pageStyles(live)
      expect(off.promo === 'block' && off.wrapMax === 'none' && off.spacing === 'normal' && !/Georgia/.test(off.font ?? ''), `Turning tweaks off left styles on the page: ${JSON.stringify(off)}.`)
      expect((await live.evaluate(`window.__sameDocument ?? null`)) === 'yes', 'Turning tweaks off reloaded the page.')
      expect(await ctx.click('.site-tweaks-switch input'), 'The switch could not be turned back on.')
      await ctx.wait(statusIs('Tweaks are on'), 8000, 'the switch to turn tweaks on')
      expect((await pageStyles(live)).promo === 'none', 'Turning tweaks back on did not hide the element again.')

      // Settings: the site is listed; Remove takes it away (and the file too).
      await openPanel(ctx, 'My map')
      await ctx.click('.drawer-tabs button', 'Privacy')
      await ctx.wait(`(document.querySelector('.site-tweaks-list')?.innerText ?? '').includes('127.0.0.1')`, 8000, 'the site in Settings')
      await axeAudit(ctx, 'Site tweaks in Settings', '.site-tweaks-list')
      expect(await ctx.click('.site-tweaks-list button', 'Remove'), 'The Remove button for the site is missing from Settings.')
      await ctx.wait(`(document.querySelector('.site-tweaks-list')?.innerText ?? '').includes('No site tweaks yet')`, 8000, 'the site to leave Settings')
      expect(!(await storedLater())['127.0.0.1'], 'The removed site is still in site-tweaks.json.')

      // The error page can turn a site's tweaks off (the failed site is 127.0.0.1 too).
      await ctx.evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: ${JSON.stringify(urlA)} }).then(() => true)`)
      // Saved for the shown page's site: wait until site A is the page shown.
      await ctx.wait(`window.intoponet.browserHost.getState().then((s) => s.isVisible && (s.url ?? '').startsWith(${JSON.stringify(urlA)}))`, 15_000, 'site A to be shown again')
      expect(await ctx.evaluate(`window.intoponet.browserHost.siteTweaks.save({ enabled: true, hidden: ['#promo'], css: '' }).then((r) => r.ok)`), 'The tweak for site A could not be saved before its error page.')
      const probe = createServer()
      await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
      const closedPort = probe.address().port
      await new Promise((resolve) => probe.close(resolve))
      await ctx.evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: ${JSON.stringify(`http://127.0.0.1:${closedPort}/`)} }).then(() => true, () => true)`)
      await ctx.wait(`!!document.querySelector('.load-error-page')`, 15_000, 'the error page for a site that is not answering')
      // The offer appears once the error page has looked up the failed site's tweaks (a moment after the page itself).
      await ctx.wait(`[...document.querySelectorAll('.load-error-page button')].some((b) => b.innerText.includes('Turn off this site'))`, 8000, 'the error page to offer turning off the site tweaks')
      expect(await ctx.click('.load-error-page button', 'Turn off this site'), 'The error page does not offer to turn off the site tweaks.')
      await ctx.wait(`window.intoponet.browserHost.siteTweaks.list().then((l) => l.some((item) => item.site === '127.0.0.1' && !item.enabled))`, 10_000, 'the tweaks to be turned off from the error page')

      return 'Escape stops picking; a picked element is previewed, saved, kept after reload, and not on site B. Width, font and dark colours change site A only, with no reload when turned off. @import and script markup are refused and nothing runs. A private tab sees the tweaks and writes nothing. Settings lists and removes the site, and the error page turns tweaks off.'
    } finally {
      siteA.close()
      siteB.close()
    }
  },

  async QUICK_WINDOW(ctx) {
    // A small local site: every path answers with a page whose "next" link goes on, and one ad picture.
    const NEXT = { '/quick-1': '/quick-2', '/quick-3': '/quick-4' }
    const site = await new Promise((resolve) => {
      const server = createServer((request, response) => {
        const path = new URL(request.url, 'http://localhost').pathname
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end(`<!doctype html><title>Quick ${path}</title><body style="font:16px system-ui;margin:40px"><h1>Quick ${path}</h1><p><a id="next" href="${NEXT[path] ?? '/quick-next'}">Next page</a></p><img id="ad" src="https://pagead2.googlesyndication.com/pagead/banner.png" width="40" height="20" alt=""><input id="field" aria-label="Field"></body>`)
      })
      server.listen(0, '127.0.0.1', () => resolve(server))
    })
    const origin = `http://127.0.0.1:${site.address().port}`
    // Main-process helpers. A quick window is a window whose contents include the toolbar page (a data: URL).
    const PRELUDE = `const isQuick = (w) => w.contentView.children.some((v) => !v.webContents.isDestroyed() && v.webContents.getURL().startsWith('data:text/html'))
      const quick = () => electron.BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && isQuick(w))
      const main = () => electron.BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !isQuick(w))
      const toolbarOf = (w) => w.contentView.children[0].webContents
      const pageOf = (w) => w.contentView.children[1].webContents`
    const mainCall = (expression) => ctx.main(`(() => { ${PRELUDE}; return (${expression}) })()`)
    const quickCount = () => mainCall('quick().length')
    const pageUrl = () => mainCall("pageOf(quick()[0]).getURL()")
    const tabUrls = () => ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => JSON.stringify(t.map((x) => x.url)))`).then(JSON.parse)
    const openFromOtherApp = (url) => ctx.main(`electron.app.emit('open-url', { preventDefault() {} }, ${JSON.stringify(url)})`)
    const until = async (check, label, ms = 15_000) => {
      const end = Date.now() + ms
      while (Date.now() < end) {
        if (await check()) return
        await ctx.delay(250)
      }
      throw new CheckFailure(`Timed out waiting for ${label}.`)
    }
    const clickLinkIn = async (part) => {
      const page = await ctx.page(part)
      await page.evaluate(`(() => { document.getElementById('next').click(); return true })()`, { userGesture: true })
    }
    try {
      // Setting off (the default): a link from another app opens as a tab, as before.
      expect(await ctx.evaluate(`window.intoponet.browsing.settings().then((s) => s.linksFromOtherApps)`) === 'tab', 'Links from other apps do not open in a new tab by default.')
      await openFromOtherApp(`${origin}/tab-link`)
      await until(async () => (await tabUrls()).some((url) => url.endsWith('/tab-link')), 'the link to open as a tab')
      expect(await quickCount() === 0, 'With the setting off, a link from another app opened a quick window.')

      // Settings › Browsing: the choice is there, and picking Quick window is saved.
      await openPanel(ctx, 'Settings')
      const settingsText = await ctx.evaluate(`document.querySelector('.settings-pane')?.innerText ?? ''`)
      expect(settingsText.includes('Links from other apps open in'), 'Settings › Browsing has no choice for links from other apps.')
      expect(await ctx.click('.browsing-appearance button', 'Quick window'), 'The "Quick window" choice is missing.')
      await ctx.delay(800)
      expect(await ctx.evaluate(`window.intoponet.browsing.settings().then((s) => s.linksFromOtherApps)`) === 'quick-window', 'Choosing Quick window did not take effect.')
      // The file is flushed to disk before it is put in place, which can take over a second on a busy Mac.
      const settingsFile = join(ctx.profile, 'browsing-settings.json')
      const savedChoice = () => { try { return JSON.parse(readFileSync(settingsFile, 'utf8')).linksFromOtherApps } catch { return null } }
      await until(async () => savedChoice() === 'quick-window', 'the Quick window choice to be saved to browsing-settings.json', 10_000)
      await ctx.press('Escape')
      await ctx.delay(400)

      // Setting on: a small, always-on-top window; no new tab in the main window; the ad picture is blocked.
      await openFromOtherApp(`${origin}/quick-1`)
      await until(async () => (await quickCount()) === 1, 'the quick window to open')
      const shape = await mainCall(`(() => { const b = quick()[0].getBounds(); return { width: b.width, height: b.height, top: quick()[0].isAlwaysOnTop() } })()`)
      expect(shape.width <= 900 && shape.height <= 640 && shape.top, `The quick window is ${shape.width}×${shape.height}${shape.top ? '' : ' and not always on top'}.`)
      expect((await tabUrls()).length === 1 && !(await tabUrls()).some((url) => url.includes('/quick-1')), 'The quick link also opened a tab in the main window.')
      await until(async () => (await pageUrl()).endsWith('/quick-1'), 'the quick page to load')
      await until(async () => /[1-9]\d* blocked/.test(await mainCall("toolbarOf(quick()[0]).executeJavaScript(\"document.getElementById('protection').textContent\")")), 'the toolbar to count a blocked ad')
      expect(await mainCall("pageOf(quick()[0]).executeJavaScript(\"document.getElementById('ad').naturalWidth\")") === 0, 'The ad picture loaded in the quick window.')

      // Navigate inside it, then ⌘O: the same page becomes a tab of the main window, history kept, no reload.
      await clickLinkIn('/quick-1')
      await until(async () => (await pageUrl()).endsWith('/quick-2'), 'the link inside the quick window to load')
      const quickPageId = await mainCall('pageOf(quick()[0]).id')
      const sentinel = await ctx.page('/quick-2')
      await sentinel.evaluate(`(() => { window.__quickSentinel = 42; return true })()`)
      await ctx.keyInPage('/quick-2', 'O', ['meta'])
      await until(async () => (await quickCount()) === 0, 'the quick window to go after ⌘O')
      const moved = await mainCall(`(() => { const views = main().contentView.children.map((v) => v.webContents).filter((c) => c && !c.isDestroyed()); const page = views.find((c) => c.getURL().endsWith('/quick-2')); return page ? { id: page.id, canGoBack: page.navigationHistory.canGoBack() } : null })()`)
      expect(moved?.id === quickPageId, `⌘O did not move the same page into the main window (id ${moved?.id} vs ${quickPageId}).`)
      expect(moved.canGoBack === true, '⌘O lost the page history (nothing to go back to).')
      expect((await tabUrls()).some((url) => url.endsWith('/quick-2')), '⌘O did not add a tab for the page.')
      expect(await sentinel.evaluate('window.__quickSentinel') === 42, '⌘O reloaded the page.')

      // Another link, then Close: no tab, and nothing in Recently Closed.
      const tabsBeforeClose = (await tabUrls()).length
      await openFromOtherApp(`${origin}/quick-3`)
      await until(async () => (await quickCount()) === 1 && (await pageUrl()).endsWith('/quick-3'), 'the second quick window to load')
      await clickLinkIn('/quick-3')
      await until(async () => (await pageUrl()).endsWith('/quick-4'), 'the link in the second quick window to load')
      await mainCall("toolbarOf(quick()[0]).executeJavaScript(\"document.getElementById('close').click()\")")
      await until(async () => (await quickCount()) === 0, 'the quick window to close')
      expect((await tabUrls()).length === tabsBeforeClose && !(await tabUrls()).some((url) => /quick-[34]/.test(url)), 'Closing a quick window left a tab behind.')
      await ctx.delay(500)
      const closedMenu = await mainCall(`electron.Menu.getApplicationMenu().items.find((m) => m.label === 'History').submenu.items.find((i) => i.label === 'Recently Closed').submenu.items.map((i) => i.label)`)
      expect(closedMenu.length === 1 && closedMenu[0] === 'No Recently Closed Tabs', `Closing a quick window left something to reopen: ${closedMenu.join(', ')}.`)

      // Private browsing on: the quick window's page uses the private partition, and the toolbar says so.
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(true).then(() => true)`)
      await openFromOtherApp(`${origin}/quick-private`)
      await until(async () => (await quickCount()) === 1, 'the private quick window to open')
      expect(await mainCall("pageOf(quick()[0]).session === electron.session.fromPartition('intoponet-private')"), 'A quick window opened in private browsing did not use the private partition.')
      expect(await mainCall("toolbarOf(quick()[0]).executeJavaScript(\"document.getElementById('private').hidden\")") === false, 'The private quick window does not say it is private.')
      // Session parity: the private quick window's page, and every other page open, get the same protections as a tab.
      await until(() => mainCall("!pageOf(quick()[0]).isLoading() && pageOf(quick()[0]).getURL().endsWith('/quick-private')"), 'the private quick window to load', 20_000)
      const parity = await pageSessionProblems(ctx, { stubbed: ['/quick-private'] })
      expect(parity.problems.length === 0, `Session parity with a quick window: ${parity.problems.join(' ')}`)
      await ctx.keyInPage('/quick-private', 'W', ['meta'])
      await until(async () => (await quickCount()) === 0, 'the private quick window to close with ⌘W')
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(false).then(() => true)`)
      await ctx.delay(800)

      // Turning private browsing off closes a private quick window too: gone, and no tab added for its page.
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(true).then(() => true)`)
      await openFromOtherApp(`${origin}/quick-private-2`)
      await until(async () => (await quickCount()) === 1, 'the second private quick window to open')
      const tabsBeforePrivateOff = await tabUrls()
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(false).then(() => true)`)
      await until(async () => (await quickCount()) === 0, 'the private quick window to close when private browsing ends')
      await ctx.delay(500)
      const tabsAfterPrivateOff = await tabUrls()
      expect(tabsAfterPrivateOff.length === tabsBeforePrivateOff.length && !tabsAfterPrivateOff.some((url) => url.includes('/quick-private-2')), 'Ending private browsing left a private quick window or its page as a tab.')

      // ⌥⌘N: an empty quick window with its address field ready; typing an address loads it.
      // Pressed in the page on screen (the adopted tab): keys in a background tab never reach the browser's handler.
      await ctx.keyInPage('/quick-2', 'N', ['meta', 'alt'])
      await until(async () => (await quickCount()) === 1, 'the empty quick window to open with ⌥⌘N')
      expect(await mainCall("toolbarOf(quick()[0]).executeJavaScript(\"document.getElementById('address').readOnly\")") === false, 'The empty quick window has no editable address field.')
      await mainCall("toolbarOf(quick()[0]).focus()")
      await mainCall(`toolbarOf(quick()[0]).insertText(${JSON.stringify(`${origin}/typed`)})`)
      await mainCall("toolbarOf(quick()[0]).sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })")
      await until(async () => (await pageUrl()).endsWith('/typed'), 'the typed address to load in the quick window')

      // The toolbar page passes axe.
      const violations = await mainCall(`toolbarOf(quick()[0]).executeJavaScript(process.mainModule.require('fs').readFileSync(${JSON.stringify(join(repo, 'node_modules/axe-core/axe.min.js'))}, 'utf8') + ';axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] }).then((r) => r.violations.map((v) => v.id + " ×" + v.nodes.length))')`)
      expect(violations.length === 0, `WCAG violations on the quick window toolbar: ${violations.join(', ')}.`)
      // Escape in an edited address field reverts it and leaves the field; the window stays open.
      await mainCall("toolbarOf(quick()[0]).focus()")
      await mainCall("toolbarOf(quick()[0]).executeJavaScript('window.quickFocusAddress()')")
      await ctx.delay(300)
      await mainCall("toolbarOf(quick()[0]).insertText('zzz')")
      await ctx.delay(300)
      await mainCall("toolbarOf(quick()[0]).sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })")
      await ctx.delay(600)
      expect(await quickCount() === 1, 'Escape in an edited address field closed the quick window.')
      expect(await mainCall("toolbarOf(quick()[0]).executeJavaScript(\"document.getElementById('address').value\")") === `${origin}/typed`, 'Escape did not revert the edited address field.')
      // ⌘L and some typing, then a click into the page and a link followed there: no stale typed text stays in the field.
      await mainCall("toolbarOf(quick()[0]).focus()")
      await mainCall("toolbarOf(quick()[0]).executeJavaScript('window.quickFocusAddress()')")
      await ctx.delay(300)
      await mainCall("toolbarOf(quick()[0]).insertText('stale words')")
      await ctx.delay(300)
      await mainCall("pageOf(quick()[0]).focus()")
      await ctx.delay(300)
      await clickLinkIn('/typed')
      await until(async () => (await pageUrl()).endsWith('/quick-next'), 'the link followed in the page to load')
      await ctx.delay(500)
      const afterLink = JSON.parse(await mainCall(`toolbarOf(quick()[0]).executeJavaScript("JSON.stringify([document.getElementById('address').value, document.getElementById('address').readOnly])")`))
      expect(afterLink[0] === `${origin}/quick-next` && afterLink[1] === true, `After typing, clicking into the page and following a link, the address field shows "${afterLink[0]}"${afterLink[1] ? '' : ' and is still being edited'}.`)
      await mainCall('(() => { pageOf(quick()[0]).navigationHistory.goBack(); return true })()')
      await until(async () => (await pageUrl()).endsWith('/typed'), 'Back to the typed page')
      // ⌘T in a quick window opens a tab in the main window, which comes forward; the quick window stays.
      const tabsBeforeNewTab = (await tabUrls()).length
      await ctx.keyInPage('/typed', 'T', ['meta'])
      await until(async () => (await tabUrls()).length === tabsBeforeNewTab + 1, 'a new tab in the main window after ⌘T in a quick window')
      expect(await quickCount() === 1, '⌘T closed the quick window.')
      // Escape outside the field closes it.
      await mainCall("toolbarOf(quick()[0]).sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })")
      await until(async () => (await quickCount()) === 0, 'the typed quick window to close with Escape')
      return 'Setting off: a tab. Settings › Browsing chooses Quick window (saved). A quick window is small and always on top, opens no tab and blocks the ad picture. Navigating inside, then ⌘O: the same page (same id, history kept, not reloaded) is a tab and the quick window is gone. A second one closed with its Close button leaves no tab and nothing to reopen. Private: private partition, labelled. ⌥⌘N opens an empty one; a typed address loads; Escape in an edited address field reverts it and keeps the window; ⌘T opens a tab in the main window; Escape outside the field closes it. Toolbar axe clean.'
    } finally {
      site.close()
    }
  },

  async AUTO_PIP(ctx) {
    // Video follows you. The video is a canvas stream (no network): one page lets picture-in-picture, one refuses it.
    const host = 'window.intoponet.browserHost'
    const VIDEO_PAGE = (title, attributes) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;margin:40px">
      <h1>${title}</h1><script>
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180
        const g = canvas.getContext('2d'); let frame = 0
        setInterval(() => { g.fillStyle = 'hsl(' + (frame++ % 360) + ' 80% 50%)'; g.fillRect(0, 0, 320, 180) }, 33)
        const video = document.createElement('video')
        video.srcObject = canvas.captureStream(30); video.muted = true; video.autoplay = true; video.playsInline = true; video.width = 320; video.height = 180
        ${attributes}
        document.querySelector('h1').after(video)
      </script></body>`
    const pages = {
      '/video': VIDEO_PAGE('Test video', ''),
      '/refuses': VIDEO_PAGE('Refused video', 'video.disablePictureInPicture = true'),
      '/plain': '<!doctype html><meta charset="utf-8"><title>Plain page</title><body style="font:16px system-ui;margin:40px"><h1>Plain page</h1><p>No video here.</p></body>',
    }
    const server = createServer((request, response) => {
      const path = new URL(request.url, 'http://localhost').pathname
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(pages[path] ?? pages['/plain'])
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    const tabs = async () => JSON.parse(await ctx.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
    const tabAt = async (path) => (await tabs()).find((tab) => new URL(tab.url || 'about:blank').pathname === path)
    const setPip = (on) => ctx.evaluate(`window.intoponet.browsing.setAutoPictureInPicture(${on}).then(() => true)`)
    const show = async (path) => {
      const tab = await tabAt(path)
      expect(tab, `No tab shows ${path}.`)
      await ctx.evaluate(`${host}.activateTab(${JSON.stringify(tab.id)}).then(() => true)`)
      await ctx.delay(1500)
    }
    const videoOf = async (path) => {
      const session = await ctx.page(path)
      return {
        state: () => session.evaluate(`JSON.stringify((() => { const v = document.querySelector('video'); return { paused: v.paused, time: v.currentTime, ready: v.readyState, pip: !!document.pictureInPictureElement } })())`).then(JSON.parse),
      }
    }
    const until = async (test, ms, label) => {
      const end = Date.now() + ms
      while (Date.now() < end) {
        if (await test().catch(() => false)) return
        await ctx.delay(300)
      }
      throw new CheckFailure(`Timed out waiting for ${label}.`)
    }
    const playing = async (path) => {
      const video = await videoOf(path)
      const before = await video.state()
      await ctx.delay(700)
      const after = await video.state()
      return !before.paused && !after.paused && after.time > before.time
    }
    const pipOf = async (path) => (await (await videoOf(path)).state()).pip
    // Moves keyboard focus onto one of the now-playing control's buttons (by its label's start), once the
    // control shows that label (its state follows the tab a moment after the page changes).
    const focusControl = async (prefix) => {
      let result = 'no button yet'
      for (let i = 0; i < 20 && result !== true; i += 1) {
        result = await ctx.evaluate(`(() => {
          const buttons = [...document.querySelectorAll('.now-playing-button')]
          const button = buttons.find((item) => item.getAttribute('aria-label').startsWith(${JSON.stringify(prefix)}))
          if (!button) return 'no button starts with "${prefix}"; buttons: ' + buttons.map((item) => item.getAttribute('aria-label')).join(' | ')
          button.focus()
          return document.activeElement === button ? true : 'focus did not move'
        })()`)
        if (result !== true) await ctx.delay(250)
      }
      expect(result === true, `Keyboard focus could not reach the control's ${prefix} button: ${result}`)
    }
    try {
      expect((await ctx.evaluate(`window.intoponet.browsing.settings().then((s) => s.autoPictureInPicture)`)) === false, 'Video follows you is not off by default.')
      await setPip(false)
      await openPage(ctx, `${origin}/video`, 3000)
      expect(await playing('/video'), 'The test video is not playing.')
      await openPage(ctx, `${origin}/plain`, 1500)
      expect(!(await pipOf('/video')), 'With the setting off, leaving a tab floated its video.')
      expect(await playing('/video'), 'With the setting off, the video stopped when its tab was left.')

      // On: leaving the playing tab floats the video; playback goes on.
      await setPip(true)
      await show('/video')
      await show('/plain')
      expect(await pipOf('/video'), 'Leaving a tab playing a video did not float it in picture-in-picture.')
      expect(await playing('/video'), 'The floating video stopped playing.')
      // The now-playing control lists it while it plays (in the sidebar, as one labelled group).
      await ctx.wait(`!!document.querySelector('.now-playing')`, 6000, 'the now-playing control')
      // textContent: the words are there even when the rail is icons-only (their text is hidden then).
      const shown = await ctx.evaluate(`document.querySelector('.now-playing').textContent`)
      expect(shown.includes('Playing') && shown.includes('Test video'), `The now-playing control says "${shown}".`)
      await axeAudit(ctx, 'the now-playing control', '.now-playing')

      // Pause and play from the control with the keyboard; mute and unmute too.
      expect(await ctx.click('.now-playing-button', 'Pause'), 'The control has no Pause button.')
      await until(async () => (await (await videoOf('/video')).state()).paused === true, 4000, 'the video to pause')
      // The control hears of the pause from the page a moment after the video stops.
      await ctx.wait(`!!document.querySelector('.now-playing')?.textContent.includes('Paused')`, 4000, 'the control to say Paused')
      await focusControl('Play')
      await ctx.press('Enter')
      await until(async () => !(await (await videoOf('/video')).state()).paused, 4000, 'the video to play again')
      await focusControl('Mute')
      await ctx.press('Enter')
      await until(async () => (await tabAt('/video')).muted === true, 4000, 'the tab to mute')
      await focusControl('Unmute')
      await ctx.press('Enter')
      await until(async () => (await tabAt('/video')).muted !== true, 4000, 'the tab to unmute')

      // Go to tab (keyboard): the tab is shown and its video docks again.
      await focusControl('Go to tab')
      await ctx.press('Enter')
      await until(async () => (await tabAt('/video')).active, 4000, 'the video tab to be shown')
      await until(async () => !(await pipOf('/video')), 4000, 'the video to dock again')
      expect(await playing('/video'), 'The video stopped when it docked again.')

      // A page that refuses picture-in-picture keeps playing where it is, with no error.
      await openPage(ctx, `${origin}/refuses`, 3000)
      expect(await playing('/refuses'), 'The refusing page video is not playing.')
      await show('/plain')
      expect(!(await pipOf('/refuses')), 'A video that disallows picture-in-picture was floated.')
      expect(await playing('/refuses'), 'A video that disallows picture-in-picture stopped when its tab was left.')
      expect(await pipOf('/video') === true, 'Leaving the refusing tab docked the floating video.')

      // A floating tab is neither put to sleep nor archived: tabs that are not floating are.
      await ctx.evaluate(`window.intoponet.browsing.setTabArchive('off').then(() => true)`)
      await ctx.evaluate(`window.intoponet.browsing.setTabSleep('15m').then(() => true)`)
      for (let i = 0; i < 3; i += 1) await openPage(ctx, `${origin}/plain?${i}`, 600)
      await ctx.wait(`${host}.getTabs().then((t) => t.some((x) => x.asleep && !x.active))`, 30_000, 'a background tab to sleep')
      const slept = await tabs()
      expect(!slept.find((tab) => new URL(tab.url || 'about:blank').pathname === '/video').asleep, 'The floating video tab was put to sleep.')
      expect(await pipOf('/video'), 'The floating video was docked by sleeping.')
      const openBefore = (await tabs()).length
      await ctx.evaluate(`window.intoponet.browsing.setTabArchive('12h').then(() => true)`)
      await ctx.delay(5000)
      expect((await tabs()).length < openBefore, 'No background tab was archived, so the archive check proves nothing.')
      expect((await tabAt('/video')) !== undefined, 'The floating video tab was archived.')
      expect(await pipOf('/video'), 'The floating video was docked by archiving.')
      await ctx.evaluate(`window.intoponet.browsing.setTabArchive('off').then(() => true)`)
      await ctx.evaluate(`window.intoponet.browsing.setTabSleep('never').then(() => true)`)
      // A workspace switch floats the shown video too, the control still finds it in the other workspace, and go-to brings it back.
      await show('/video')
      expect(await playing('/video') && !(await pipOf('/video')), 'The video was not shown and playing before the workspace switch.')
      await ctx.evaluate(`window.intoponet.workspaces.create().then(() => true)`)
      await until(async () => await pipOf('/video'), 6000, 'the video to float when its workspace was left')
      expect(await playing('/video'), 'The video in the other workspace stopped playing.')
      await ctx.wait(`!!document.querySelector('.now-playing') && document.querySelector('.now-playing').textContent.includes('Test video')`, 6000, 'the now-playing control to list the video in another workspace')
      await focusControl('Go to tab')
      await ctx.press('Enter')
      await until(async () => (await tabAt('/video')).active, 6000, 'the video tab to be shown again')
      await until(async () => !(await pipOf('/video')), 4000, 'the video to dock when its workspace came back')
      expect(await playing('/video'), 'The video stopped when its workspace came back.')
      await ctx.evaluate(`window.intoponet.workspaces.switchTo({ index: 0 }).then(() => true)`).catch(() => undefined)
      // The person closes the small window themselves (Chromium pauses the video): the tab no longer floats,
      // so the control stops saying so, and the tab may sleep again.
      await openPage(ctx, `${origin}/plain?closed`, 1500)
      await until(async () => await pipOf('/video'), 6000, 'the video to float again')
      await (await ctx.page('/video')).evaluate(`document.exitPictureInPicture().then(() => { document.querySelector('video').pause(); return true })`, { userGesture: true })
      await ctx.wait(`!(document.querySelector('.now-playing')?.textContent ?? '').includes('small window')`, 6000, 'the now-playing control to stop saying the video floats once its window was closed')
      await ctx.evaluate(`window.intoponet.browsing.setTabSleep('15m').then(() => true)`)
      await until(async () => (await tabAt('/video'))?.asleep === true, 30_000, 'the video tab to sleep once its small window was closed')
      await ctx.evaluate(`window.intoponet.browsing.setTabSleep('never').then(() => true)`)
      await setPip(false)
      // A background tab playing a video, closed from the sidebar, leaves the now-playing control at once.
      pages['/video-bg'] = VIDEO_PAGE('Background video', '')
      await openPage(ctx, `${origin}/video-bg`, 3000)
      await openPage(ctx, `${origin}/plain?after-bg`, 1500)
      await ctx.wait(`(document.querySelector('.now-playing')?.textContent ?? '').includes('Background video')`, 8000, 'the control to list the video playing in a background tab')
      await ctx.evaluate(`${host}.closeTab(${JSON.stringify((await tabAt('/video-bg')).id)}).then(() => true)`)
      await ctx.wait(`!(document.querySelector('.now-playing')?.textContent ?? '').includes('Background video')`, 5000, 'the control to drop a playing tab once it was closed')
      return 'Off by default; with it on, leaving a playing tab floated its canvas video (playback went on), returning docked it; the now-playing control listed it (labelled, axe clean) and pause, play, mute, unmute and go-to worked from the keyboard; a page with disablePictureInPicture kept playing in place; a floating tab was not put to sleep or archived while other tabs were; once the person closed the small window, the control stopped saying it floats and the tab slept; a playing background tab, closed, left the control.'
    } finally {
      server.close()
    }
  },

  async SPLIT_PAGES(ctx) {
    // Two local sites (two hosts, so the two headers show different origins).
    const pages = {
      '/split-left': `<!doctype html><html lang="en"><title>Left story</title><body style="font:16px system-ui;margin:24px"><h1>Left story</h1><p>alpha text here</p></body></html>`,
      '/split-right': `<!doctype html><html lang="en"><title>Right story</title><body style="font:16px system-ui;margin:24px"><h1>Right story</h1><p>beta needle here</p></body></html>`,
    }
    // A page that fails (the connection drops) until it is told to work.
    let flakyFails = true
    let flakyHits = 0
    const server = createServer((request, response) => {
      const path = new URL(request.url, 'http://localhost').pathname
      if (path === '/split-flaky' && flakyFails) {
        flakyHits += 1
        request.socket.destroy()
        return
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(pages[path] ?? `<!doctype html><title>Page ${path}</title><h1>${path}</h1>`)
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    const leftUrl = `http://127.0.0.1:${port}/split-left`
    const rightUrl = `http://localhost:${port}/split-right`
    const host = 'window.intoponet.browserHost'
    const shotDir = process.env.SPLIT_SHOTS_DIR ?? join(tmpdir(), 'intoponet-split-pages-shots')
    mkdirSync(shotDir, { recursive: true })
    const log = []
    const stateOf = async () => JSON.parse(await ctx.evaluate(`${host}.getState().then((s) => JSON.stringify(s))`))
    const waitFor = async (label, test) => {
      for (let i = 0; i < 40; i += 1) {
        const value = await test()
        if (value) return value
        await ctx.delay(200)
      }
      throw new CheckFailure(`Timed out waiting for: ${label}`)
    }
    /** The app window's native page views, read from Electron: bounds, visibility, zoom, focus. */
    const viewsNow = () => ctx.main(`(() => {
      const win = electron.BrowserWindow.getAllWindows()[0]
      const kids = win.contentView.children.filter((v) => v.webContents && !v.webContents.isDestroyed())
      return JSON.stringify({
        windows: electron.BrowserWindow.getAllWindows().length,
        content: win.getContentSize(),
        pages: kids.filter((v) => /^https?:/.test(v.webContents.getURL())).map((v) => ({ url: v.webContents.getURL(), id: v.webContents.id, bounds: v.getBounds(), visible: v.getVisible(), zoom: v.webContents.getZoomFactor(), focused: v.webContents.isFocused() })),
      })
    })()`).then(JSON.parse)
    const sideOf = (views, part) => views.pages.find((p) => p.url.includes(part))
    /** Screenshots (the page views are native: the window's own capture, and the web contents'), plus the bounds at that moment. */
    const snap = async (label) => {
      const views = await viewsNow()
      await ctx.main(`(async () => {
        const fs = process.mainModule.require('fs')
        const win = electron.BrowserWindow.getAllWindows()[0]
        fs.writeFileSync(${JSON.stringify(join(shotDir, `${label}.png`))}, (await win.webContents.capturePage()).toPNG())
        fs.writeFileSync(${JSON.stringify(join(shotDir, `${label}-window.png`))}, (await win.capturePage()).toPNG())
        return true
      })()`)
      log.push({ label, views })
      writeFileSync(join(shotDir, 'log.json'), JSON.stringify(log, null, 2))
      return views
    }
    /** Both pages side by side, the divider between them, each side as tall as the page area less its header. */
    const expectLayout = async (label) => {
      const views = await viewsNow()
      expect(views.pages.length === 2, `${label}: ${views.pages.length} pages are on screen, not two (${JSON.stringify(views.pages.map((p) => p.url))}).`)
      // Left and right are read from where the pages are, then checked against the shell's own sides.
      const [left, right] = views.pages.slice().sort((p, q) => p.bounds.x - q.bounds.x)
      expect(left.visible && right.visible, `${label}: a page is hidden (${JSON.stringify([left.visible, right.visible])}).`)
      const shellSplit = (await stateOf()).split
      expect(shellSplit && left.url === shellSplit.left.url && right.url === shellSplit.right.url, `${label}: the pages on screen (${left.url}, ${right.url}) are not the shell's left and right sides.`)
      const a = left.bounds
      const b = right.bounds
      expect(a.x + a.width <= b.x, `${label}: the pages overlap or sit one above the other (left ${JSON.stringify(a)}, right ${JSON.stringify(b)}).`)
      expect(a.y === b.y, `${label}: the pages are stacked, not side by side (left y ${a.y}, right y ${b.y}).`)
      expect(a.height === b.height, `${label}: the pages have different heights (${a.height}, ${b.height}).`)
      expect(a.width > 0 && b.width > 0, `${label}: a page has no width (${a.width}, ${b.width}).`)
      const split = (await stateOf()).split
      expect(split, `${label}: the shell has no split state.`)
      expect(b.x - (a.x + a.width) === split.divider.width, `${label}: the gap between the pages (${b.x - (a.x + a.width)}) is not the divider (${split.divider.width}).`)
      expect(a.y === split.headers.left.y + split.headers.left.height, `${label}: the left page does not start under its header.`)
      expect(a.height + split.headers.left.height === split.divider.height, `${label}: the left page is not the page area less its header (${a.height} + ${split.headers.left.height} != ${split.divider.height}).`)
      return views
    }
    const probeLog = async (label) => {
      const views = await viewsNow()
      log.push({ label, views })
      return views
    }
    const shellEval = (expression) => ctx.evaluate(expression)
    const headerOrigins = () => shellEval(`JSON.stringify([...document.querySelectorAll('.split-header-origin')].map((e) => e.textContent))`).then(JSON.parse)
    const tabsOfSplit = () => ctx.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`).then(JSON.parse)
    try {
      await openPage(ctx, leftUrl, 1500)
      await ctx.evaluate(`${host}.open({ kind: 'url', value: ${JSON.stringify(rightUrl)} }, 'background-tab').then(() => true)`)
      await ctx.delay(1200)
      expect(!(await stateOf()).split, 'Nothing is side by side before the shortcut.')

      // ⌃⇧= splits the shown tab with the next one.
      await ctx.keyInPage('/split-left', '=', ['control', 'shift'])
      const split = await waitFor('the pair', async () => (await stateOf()).split)
      expect(split.focused === 'left', 'The shown tab should keep the focus after ⌃⇧=.')
      expect(split.right.url.startsWith(rightUrl) && !split.right.secure, `The right side shows ${split.right.url}.`)
      await waitFor('two pages on screen', async () => (await viewsNow()).pages.length === 2)
      await expectLayout('just after the split')
      await snap('01-after-split')

      // A click in the right page makes it the focused side: the address bar follows it.
      await ctx.main(`(() => { electron.app.focus({ steal: true }); electron.BrowserWindow.getAllWindows()[0].focus(); return true })()`)
      await ctx.delay(300)
      const rightPage = await ctx.page(`localhost:${port}/split-right`)
      await rightPage.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 60, y: 60, button: 'left', clickCount: 1 })
      await rightPage.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 60, y: 60, button: 'left', clickCount: 1 })
      let viaClick = true
      try {
        await waitFor('focus on the right side by click', async () => (await stateOf()).split?.focused === 'right')
      } catch {
        // The click reached the page but did not move focus here: focus the page's view as the OS would on a click, and say so.
        viaClick = false
        await ctx.main(`(() => { const page = electron.webContents.getAllWebContents().find((c) => /^https?:/.test(c.getURL()) && c.getURL().includes('/split-right')); page.focus(); return true })()`)
        await waitFor('focus on the right side', async () => (await stateOf()).split?.focused === 'right')
      }
      log.push({ label: 'focus-by-click', viaClick })
      expect((await stateOf()).url.startsWith(rightUrl), 'The address bar does not show the focused right page.')
      await expectLayout('after clicking into the right page')
      await snap('02-right-focused')

      // Find and zoom act on the focused side only.
      await ctx.evaluate(`(() => { globalThis.__splitFind = []; window.intoponet.browserHost.subscribe((e) => { if (e.type === 'find-result') globalThis.__splitFind.push(e) }); return true })()`)
      await ctx.evaluate(`${host}.find('needle').then(() => true)`)
      await ctx.delay(800)
      const beta = await ctx.evaluate(`JSON.stringify(globalThis.__splitFind.slice(-1)[0] ?? null)`).then(JSON.parse)
      expect(beta && beta.matches === 1, `Find for "needle" in the right page reported ${JSON.stringify(beta)}.`)
      await ctx.evaluate(`${host}.find('alpha').then(() => true)`)
      await ctx.delay(800)
      const alpha = await ctx.evaluate(`JSON.stringify(globalThis.__splitFind.slice(-1)[0] ?? null)`).then(JSON.parse)
      expect(alpha && alpha.matches === 0, `Find for "alpha" (left only) matched in the focused right page: ${JSON.stringify(alpha)}.`)
      await ctx.evaluate(`${host}.stopFind().then(() => true)`)
      await ctx.evaluate(`${host}.zoom('in').then(() => true)`)
      const zoomed = await waitFor('zoom on the right side', async () => {
        const v = await viewsNow()
        return sideOf(v, '/split-right').zoom > 1 ? v : null
      })
      expect(sideOf(zoomed, '/split-left').zoom === 1, 'Zoom on the right side changed the left side too.')
      await ctx.evaluate(`${host}.zoom('reset').then(() => true)`)
      await ctx.delay(300)

      // Divider: arrow keys, then a pointer drag; the minimum width holds.
      await shellEval(`document.querySelector('.split-divider').focus(); true`)
      const beforeKeys = await viewsNow()
      for (let i = 0; i < 4; i += 1) await ctx.press('ArrowLeft')
      await ctx.delay(500)
      const afterKeys = await viewsNow()
      expect(sideOf(afterKeys, '/split-left').bounds.width < sideOf(beforeKeys, '/split-left').bounds.width, 'Arrow left did not narrow the left side.')
      await expectLayout('after arrow keys')
      await snap('03-after-arrow-keys')
      const divider = JSON.parse(await shellEval(`JSON.stringify(document.querySelector('.split-divider').getBoundingClientRect())`))
      const cx = divider.x + divider.width / 2
      const cy = divider.y + divider.height / 2
      await ctx.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 })
      for (let step = 1; step <= 10; step += 1) await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + step * 15, y: cy, button: 'left', buttons: 1 })
      await ctx.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 150, y: cy, button: 'left', clickCount: 1 })
      await ctx.delay(700)
      const dragged = await viewsNow()
      expect(sideOf(dragged, '/split-left').bounds.width > sideOf(afterKeys, '/split-left').bounds.width, 'Dragging the divider right did not widen the left side.')
      await expectLayout('after the divider is dragged')
      await snap('04-after-drag')
      for (let i = 0; i < 90; i += 1) await ctx.press('ArrowLeft')
      await ctx.delay(900)
      const minimum = await viewsNow()
      expect(sideOf(minimum, '/split-left').bounds.width >= 320, `The left side went below its minimum width: ${sideOf(minimum, '/split-left').bounds.width}.`)
      await expectLayout('at the minimum width')
      await snap('05-min-width')
      await ctx.evaluate(`${host}.setSplitRatio(0.5).then(() => true)`)
      await ctx.delay(700)

      // The pair in the sidebar or strip is one row, left half then right half; each header shows its own origin.
      const chrome = JSON.parse(await shellEval(`JSON.stringify({
        rows: document.querySelectorAll('.tab-rail-pair-item, .page-tab-pair').length,
        halves: [...document.querySelectorAll('.tab-rail-half, .is-split-half')].map((e) => e.getAttribute('aria-label')),
        separators: document.querySelectorAll('[role=separator]').length,
      })`))
      expect(chrome.rows === 1, `Expected one row for the pair, found ${chrome.rows}.`)
      expect(chrome.halves.length === 2 && chrome.halves[0].includes('left') && chrome.halves[1].includes('right'), `The halves are not left then right: ${JSON.stringify(chrome.halves)}.`)
      expect(chrome.separators === 1, 'The divider is not a single separator.')
      const origins = await headerOrigins()
      expect(origins.includes(`127.0.0.1:${port}`) && origins.includes(`localhost:${port}`), `Headers show ${JSON.stringify(origins)}.`)
      // Sidebar in open and icon-only modes: the two halves are one row, left then right, never stacked.
      const halfRow = async (label) => {
        const rows = JSON.parse(await shellEval(`JSON.stringify([...document.querySelectorAll('.tab-rail-half')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }))`))
        expect(rows.length === 2 && rows[0].y === rows[1].y && rows[0].x < rows[1].x && rows[0].x + rows[0].w <= rows[1].x + 1, `${label}: the sidebar halves are not one row, left then right (${JSON.stringify(rows)}).`)
        return rows
      }
      await ctx.evaluate(`${host}.setTabSidebar({ mode: 'open', width: 240 }).then(() => true)`)
      await ctx.delay(900)
      await halfRow('sidebar open')
      await snap('12-sidebar-open')
      await ctx.evaluate(`${host}.setTabSidebar({ mode: 'icons', width: 240 }).then(() => true)`)
      await ctx.delay(900)
      await halfRow('sidebar icons')
      await snap('13-sidebar-icons')
      await ctx.evaluate(`${host}.setTabSidebar({ mode: 'open', width: 240 }).then(() => true)`)
      await ctx.delay(600)
      await axeAudit(ctx, 'the split divider', '.split-divider')
      await axeAudit(ctx, 'the split headers', '.split-header')

      // Full-width view and a narrow window: still two columns, half and half when narrow.
      await ctx.evaluate(`${host}.setFullWidth(true).then(() => true)`)
      await ctx.delay(1000)
      await expectLayout('full-width view')
      await snap('06-full-width')
      await ctx.evaluate(`${host}.setFullWidth(false).then(() => true)`)
      await ctx.delay(900)
      const contentBefore = (await viewsNow()).content
      await ctx.main(`electron.BrowserWindow.getAllWindows()[0].setContentSize(720, 700)`)
      await ctx.delay(1200)
      const narrow = await expectLayout('window narrowed to 720 px')
      expect(Math.abs(sideOf(narrow, '/split-left').bounds.width - sideOf(narrow, '/split-right').bounds.width) <= 1, 'Narrow window: the two pages are not half and half.')
      await snap('07-narrow')
      await ctx.main(`electron.BrowserWindow.getAllWindows()[0].setContentSize(${contentBefore[0]}, ${contentBefore[1]})`)
      await ctx.delay(900)
      await expectLayout('window restored')

      // A workspace switch away and back keeps the pair.
      // The pair's workspace is the one shown now (read before creating: creating a workspace may show it).
      const mainWorkspace = JSON.parse(await ctx.evaluate(`window.intoponet.workspaces.get().then((s) => JSON.stringify(s))`)).activeId
      await ctx.evaluate(`window.intoponet.workspaces.create().then(() => true)`)
      await ctx.delay(400)
      const workspaces = JSON.parse(await ctx.evaluate(`window.intoponet.workspaces.get().then((s) => JSON.stringify(s))`))
      const other = workspaces.workspaces.find((w) => w.id !== mainWorkspace).id
      await ctx.evaluate(`window.intoponet.workspaces.switchTo({ id: ${JSON.stringify(other)} }).then(() => true)`)
      await ctx.delay(900)
      await ctx.evaluate(`window.intoponet.workspaces.switchTo({ id: ${JSON.stringify(mainWorkspace)} }).then(() => true)`)
      await ctx.delay(600)
      if (!(await stateOf()).split) {
        const diag = { state: await stateOf(), views: await viewsNow(), tabs: await tabsOfSplit(), workspaces: await ctx.evaluate(`window.intoponet.workspaces.get().then((s) => JSON.stringify(s))`).then(JSON.parse) }
        writeFileSync(join(shotDir, 'diag-after-switch.json'), JSON.stringify(diag, null, 2))
        throw new CheckFailure(`The pair did not come back after switching workspaces back (see ${join(shotDir, 'diag-after-switch.json')}).`)
      }
      await waitFor('two pages after switching back', async () => (await viewsNow()).pages.length === 2)
      await ctx.delay(500)
      await expectLayout('after a workspace switch and back')
      await snap('08-after-workspace-switch')

      // The other side loads a new page by itself (a redirect, a page reloading itself): the focused side keeps the focus.
      const pageOf = (part) => `electron.webContents.getAllWebContents().find((c) => /^https?:/.test(c.getURL()) && c.getURL().includes(${JSON.stringify(part)}))`
      await ctx.evaluate(`${host}.focusSplitSide('right').then(() => true)`)
      await waitFor('focus on the right side again', async () => (await stateOf()).split?.focused === 'right')
      await ctx.main(`(() => { electron.app.focus({ steal: true }); electron.BrowserWindow.getAllWindows()[0].focus(); return true })()`)
      await ctx.main(`(() => { void ${pageOf('/split-left')}.executeJavaScript("location.href = '/split-left?again'"); return true })()`)
      await waitFor('the left page loaded again', async () => (await stateOf()).split?.left.url.includes('?again'))
      await ctx.delay(500)
      expect((await stateOf()).split.focused === 'right', 'The left page loading a new page by itself took the focus from the right side.')
      // The other side's page crashes: the pair stays side by side and that side loads again.
      const crashedId = sideOf(await viewsNow(), '/split-left').id
      await ctx.main(`(() => { ${pageOf('/split-left')}.forcefullyCrashRenderer(); return true })()`)
      await waitFor('the crashed side back beside the page', async () => {
        const views = await viewsNow()
        return (await stateOf()).split && views.pages.length === 2 && views.pages.every((p) => p.visible) && views.pages.some((p) => p.url.includes('/split-left') && p.id !== crashedId)
      })
      await expectLayout('after the other side crashed')
      // It came back where it was, with its back/forward list (the page it was on before it loaded again by itself).
      const leftHistory = await waitFor('the crashed side\'s back/forward list', async () => {
        const urls = JSON.parse(await ctx.main(`JSON.stringify(electron.webContents.getAllWebContents().find((c) => !c.isCrashed() && c.getURL().includes('/split-left'))?.navigationHistory.getAllEntries().map((e) => e.url) ?? [])`))
        return urls.some((u) => u.endsWith('/split-left')) && urls.some((u) => u.includes('?again')) ? urls : null
      }).catch(() => null)
      expect(leftHistory, 'The crashed side came back without its back/forward list.')
      expect((await stateOf()).split.focused === 'right', 'A crash on the left side moved the focus.')
      // The other side fails to load: hidden while it fails, shown again once its page loads.
      await ctx.main(`(() => { void ${pageOf('/split-left')}.loadURL('http://127.0.0.1:${port}/split-flaky?left').catch(() => undefined); return true })()`)
      const flakySide = async () => (await viewsNow()).pages.find((p) => p.url.includes('/split-flaky'))
      await waitFor('the failing left side hidden', async () => (await flakySide())?.visible === false)
      expect((await stateOf()).split.focused === 'right', 'The left page failing to load took the focus.')
      // Chromium can hand the failed load's error document the keyboard after the failure is reported: it is handed back.
      await ctx.main(`(() => { ${pageOf('/split-flaky')}.focus(); return true })()`)
      await ctx.delay(500)
      expect((await stateOf()).split.focused === 'right', 'The failing left side took the focus when its error document took the keyboard.')
      // Its half is not left empty: the shell draws a compact card there (what failed, Retry), the pages still two columns at full height.
      const leftCard = async () => JSON.parse(await shellEval(`JSON.stringify((() => {
        const card = document.querySelector('.split-other-side[data-split-side="left"] .load-error-compact')
        return card ? { frame: card.closest('.split-other-frame').getBoundingClientRect(), text: card.innerText, retry: !!card.querySelector('.load-error-card-retry') } : null
      })())`))
      const card = await waitFor('the error card in the failing left half', leftCard)
      const failing = await stateOf()
      expect(failing.split.left.loadError, 'The shell state has no error for the failing left side.')
      expect(card.retry && card.text.includes(failing.split.left.loadError.title), `The left half's card does not say what failed, with Retry: "${card.text}".`)
      expect(['x', 'y', 'width', 'height'].every((key) => Math.abs(card.frame[key] - failing.split.sides.left[key]) <= 1), `The error card is not over the left half (${JSON.stringify(card.frame)}, the half ${JSON.stringify(failing.split.sides.left)}).`)
      const hiddenPair = (await viewsNow()).pages.slice().sort((p, q) => p.bounds.x - q.bounds.x)
      expect(hiddenPair.length === 2 && hiddenPair[0].bounds.x + hiddenPair[0].bounds.width <= hiddenPair[1].bounds.x && hiddenPair[0].bounds.y === hiddenPair[1].bounds.y && hiddenPair[0].bounds.height === hiddenPair[1].bounds.height, `With the left side failing, the pages are not two columns at full height: ${JSON.stringify(hiddenPair.map((p) => p.bounds))}.`)
      await snap('08c-other-side-error-card')
      // A click anywhere in that half focuses the failing side, whose full error page then fills it.
      await ctx.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: card.frame.x + 24, y: card.frame.y + 24, button: 'left', clickCount: 1 })
      await ctx.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: card.frame.x + 24, y: card.frame.y + 24, button: 'left', clickCount: 1 })
      await waitFor('a click in the failing half to focus it', async () => (await stateOf()).split?.focused === 'left')
      const fullError = await waitFor('the full error page in the left half', async () => JSON.parse(await shellEval(`JSON.stringify(document.querySelector('.split-start-frame:not(.split-other-frame) .load-error-page[role=main]')?.closest('.split-start-frame').getBoundingClientRect() ?? null)`)))
      expect(['x', 'y', 'width', 'height'].every((key) => Math.abs(fullError[key] - failing.split.sides.left[key]) <= 1), `The focused side's error page is not over the left half (${JSON.stringify(fullError)}).`)
      // Retry on the card focuses that side and loads it again (it still fails here).
      await ctx.evaluate(`${host}.focusSplitSide('right').then(() => true)`)
      await waitFor('focus back on the right side', async () => (await stateOf()).split?.focused === 'right')
      await waitFor('the error card again', leftCard)
      const hitsBefore = flakyHits
      await shellEval(`document.querySelector('.split-other-side[data-split-side="left"] .load-error-card-retry').click(); true`)
      await waitFor('Retry on the card to focus the failing side and load it again', async () => flakyHits > hitsBefore && (await stateOf()).split?.focused === 'left')
      await ctx.evaluate(`${host}.focusSplitSide('right').then(() => true)`)
      await waitFor('focus on the right side once more', async () => (await stateOf()).split?.focused === 'right')
      await waitFor('the failing left side hidden again', async () => (await flakySide())?.visible === false)
      flakyFails = false
      await ctx.main(`(() => { ${pageOf('/split-flaky')}.reload(); return true })()`)
      await waitFor('the left side shown again once it loads', async () => (await flakySide())?.visible === true)
      await expectLayout('after the other side recovered')
      await ctx.main(`(() => { void ${pageOf('/split-flaky')}.loadURL(${JSON.stringify(leftUrl)}).catch(() => undefined); return true })()`)
      await waitFor('the left page back', async () => (await stateOf()).split?.left.url === leftUrl)
      await snap('08b-after-crash-and-error')

      // ⌘W on the focused side: the other side goes back to full size and shows.
      const focusedBeforeClose = (await stateOf()).split.focused
      await ctx.evaluate(`${host}.closeActiveTab().then(() => true)`)
      await ctx.delay(900)
      const closed = await viewsNow()
      expect(!(await stateOf()).split, 'Closing a side left the pair in place.')
      expect(closed.pages.length === 1, `After closing a side, ${closed.pages.length} pages are on screen.`)
      const remaining = closed.pages[0]
      expect(remaining.visible && remaining.bounds.width > 0, 'The remaining page is hidden after closing its partner.')
      // The focused side was closed, so the other side is the one left on screen.
      expect(remaining.url.includes(focusedBeforeClose === 'left' ? '/split-right' : '/split-left'), `After closing the ${focusedBeforeClose} side, the page on screen is ${remaining.url}.`)
      await snap('09-after-close')

      // With one tab, a split opens a new tab's start page beside it, in its own half.
      await ctx.evaluate(`${host}.splitTab().then(() => true)`)
      const started = await waitFor('a start page beside the page', async () => { const s = await stateOf(); return s.split && s.isStartPage ? s : null })
      await ctx.delay(500)
      const startFrame = JSON.parse(await shellEval(`JSON.stringify(document.querySelector('.split-start-frame')?.getBoundingClientRect() ?? null)`))
      const startHalf = started.split.sides[started.split.focused]
      expect(startFrame && ['x', 'y', 'width', 'height'].every((key) => Math.abs(startFrame[key] - startHalf[key]) <= 1), `The start page beside the page is not over its half (${JSON.stringify(startFrame)}, its half ${JSON.stringify(startHalf)}).`)
      // The page beside it takes the focus: the start page stays drawn in its own half, never an empty one.
      const startSide = started.split.focused
      const pageSide = startSide === 'left' ? 'right' : 'left'
      await ctx.evaluate(`${host}.focusSplitSide(${JSON.stringify(pageSide)}).then(() => true)`)
      await waitFor('focus on the page beside the start page', async () => (await stateOf()).split?.focused === pageSide)
      const otherStart = await waitFor('the start page in its half while the page has the focus', async () => JSON.parse(await shellEval(`JSON.stringify(document.querySelector('.split-other-side[data-split-side="${startSide}"] .start-page')?.closest('.split-other-frame').getBoundingClientRect() ?? null)`)))
      const pageFocused = await stateOf()
      expect(['x', 'y', 'width', 'height'].every((key) => Math.abs(otherStart[key] - pageFocused.split.sides[startSide][key]) <= 1), `The start page not in focus is not over its half (${JSON.stringify(otherStart)}, its half ${JSON.stringify(pageFocused.split.sides[startSide])}).`)
      const { left: halfL, right: halfR } = pageFocused.split.sides
      expect(halfL.x + halfL.width <= halfR.x && halfL.y === halfR.y && halfL.height === halfR.height, `Beside a start page the halves are not two columns at full height: ${JSON.stringify(pageFocused.split.sides)}.`)
      const besideStart = (await viewsNow()).pages
      expect(besideStart.length === 1 && besideStart[0].visible && ['x', 'y', 'width', 'height'].every((key) => besideStart[0].bounds[key] === pageFocused.split.sides[pageSide][key]), `The page beside the start page is not in its own half: ${JSON.stringify(besideStart.map((p) => p.bounds))}, its half ${JSON.stringify(pageFocused.split.sides[pageSide])}.`)
      await snap('09b-start-page-not-in-focus')
      // A click in that half focuses the start page again, and its search box takes the keyboard.
      await ctx.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: otherStart.x + otherStart.width / 2, y: otherStart.y + 40, button: 'left', clickCount: 1 })
      await ctx.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: otherStart.x + otherStart.width / 2, y: otherStart.y + 40, button: 'left', clickCount: 1 })
      await waitFor('a click in the start page half to focus it', async () => { const s = await stateOf(); return s.split?.focused === startSide && s.isStartPage })
      await waitFor('the start page search box to take the keyboard', async () => shellEval(`!!document.activeElement?.closest('.split-start-frame:not(.split-other-frame) .start-search')`))
      await ctx.evaluate(`${host}.closeActiveTab().then(() => true)`)
      await waitFor('back to one page', async () => !(await stateOf()).split && (await viewsNow()).pages.length === 1)

      // Put the pair back (the left tab shown, the right one next), then ⌃⇧- ends it.
      await ctx.evaluate(`${host}.open({ kind: 'url', value: ${JSON.stringify(rightUrl)} }, 'background-tab').then(() => true)`)
      await ctx.delay(1000)
      await ctx.evaluate(`${host}.splitTab().then(() => true)`)
      await waitFor('the pair again', async () => (await stateOf()).split)
      await expectLayout('the pair again')
      await ctx.keyInPage('/split-left', '-', ['control', 'shift'])
      await waitFor('the pair ended', async () => !(await stateOf()).split)
      await ctx.delay(700)
      const unsplit = await viewsNow()
      expect(unsplit.pages.length === 1 && unsplit.pages[0].bounds.width > 400, 'After ⌃⇧- the shown page is not back to full size.')

      // A tab dragged onto the page's edge: the page gives up that half for the drop zone.
      await ctx.evaluate(`${host}.splitPreview('left').then(() => true)`)
      await ctx.delay(600)
      const preview = await viewsNow()
      const previewState = await stateOf()
      expect(previewState.splitPreview && previewState.splitPreview.side === 'left', 'The drop zone is not in the shell state.')
      expect(preview.pages[0].bounds.x > unsplit.pages[0].bounds.x, 'The page did not give up the left half for the drop zone.')
      await snap('10-edge-preview')
      await ctx.evaluate(`${host}.splitPreview(null).then(() => true)`)
      await ctx.delay(400)

      // Dropping: the tab on the left, the shown one on the right (the drag path's own command).
      const ids = (await tabsOfSplit()).map((t) => t.id)
      expect(ids.length === 2, 'Expected both tabs open.')
      await ctx.evaluate(`${host}.splitTab(${JSON.stringify(ids[1])}, ${JSON.stringify(ids[0])}, 'left').then(() => true)`)
      await waitFor('the dropped pair', async () => (await stateOf()).split)
      await waitFor('two pages after the drop', async () => (await viewsNow()).pages.length === 2)
      await expectLayout('after a drop on the edge')
      await snap('11-after-drop')

      // Relaunch: the pair and its ratio come back. The app quits first so only one window is ever on screen.
      await ctx.evaluate(`${host}.setSplitRatio(0.4).then(() => true)`)
      await ctx.delay(800)
      await ctx.main(`electron.app.quit()`).catch(() => undefined)
      // A quitting app waits for its debugger to disconnect before it exits.
      ctx.detachMain()
      await ctx.delay(2500)
      const saved = JSON.parse(readFileSync(join(ctx.profile, 'browser-state.v1.json'), 'utf8'))
      const savedLeft = saved.tabs.find((t) => t.url.startsWith(leftUrl))
      const savedRight = saved.tabs.find((t) => t.url.startsWith(rightUrl))
      expect(savedLeft?.split && savedRight?.split && savedLeft.split.partnerId === savedRight.id, 'The saved state does not hold the pair.')
      expect(Math.abs(savedLeft.split.ratio - 0.4) < 0.001, `The saved ratio is ${savedLeft.split.ratio}.`)
      const profile = mkdtempSync(join(tmpdir(), 'intoponet-e2e-split-'))
      writeFileSync(join(profile, 'browser-state.v1.json'), JSON.stringify(saved))
      const before = process.env.E2E_PROFILE
      process.env.E2E_PROFILE = profile
      let restored
      try {
        restored = await runAppCheck(async (next) => {
          const readSplit = async () => JSON.parse(await next.evaluate(`window.intoponet.browserHost.getState().then((s) => JSON.stringify(s))`)).split
          const restoredSplit = await (async () => {
            for (let i = 0; i < 60; i += 1) {
              const value = await readSplit()
              if (value) return value
              await next.delay(200)
            }
            return null
          })()
          if (!restoredSplit) throw new CheckFailure('The relaunched app did not restore the pair.')
          if (Math.abs(restoredSplit.ratio - 0.4) > 0.01) throw new CheckFailure(`The relaunched ratio is ${restoredSplit.ratio}.`)
          // Sample the layout as the window comes up (before and after the shell's first bounds report): never stacked.
          for (let sample = 0; sample < 6; sample += 1) {
            const views = JSON.parse(await next.main(`(() => {
              const win = electron.BrowserWindow.getAllWindows()[0]
              const kids = win.contentView.children.filter((v) => v.webContents && !v.webContents.isDestroyed())
              return JSON.stringify({ windows: electron.BrowserWindow.getAllWindows().length, pages: kids.filter((v) => /^https?:/.test(v.webContents.getURL())).map((v) => ({ url: v.webContents.getURL(), bounds: v.getBounds(), visible: v.getVisible() })) })
            })()`))
            expect(views.windows === 1, `The relaunch opened ${views.windows} windows.`)
            if (views.pages.length === 2 && views.pages.every((p) => p.visible)) {
              const [l, r] = views.pages.slice().sort((p, q) => p.bounds.x - q.bounds.x)
              expect(l.bounds.y === r.bounds.y && l.bounds.x + l.bounds.width <= r.bounds.x, `After relaunch the pages are stacked or overlapping (${JSON.stringify(l.bounds)} / ${JSON.stringify(r.bounds)}).`)
              expect(l.bounds.height === r.bounds.height, 'After relaunch the pages have different heights.')
            }
            await next.delay(300)
          }
          return `relaunch restored the pair at ratio ${restoredSplit.ratio.toFixed(2)}, side by side`
        }, { timeoutMs: 60_000 })
      } finally {
        if (before === undefined) delete process.env.E2E_PROFILE
        else process.env.E2E_PROFILE = before
        rmSync(profile, { recursive: true, force: true })
      }
      expect(restored, 'The relaunch check did not run.')
      return `Shortcut split two pages side by side with the divider and headers (origins ${origins.join(' · ')}); each side keeps its own address, find and zoom; arrow keys and dragging keep the minimum width; the pair is one row, half and half when narrow or full width; it survives a workspace switch; closing a side returns the other to full size; ⌃⇧- unsplits; an edge drop previews and splits; the relaunch restores the pair. Screenshots and bounds in ${shotDir}.`
    } finally {
      server.close()
    }
  },

  async LINK_ROUTES(ctx) {
    // One server, three hosts: localhost (a rule), docs.localhost and temp.localhost (under localhost), and 127.0.0.1 (no rule).
    const server = createServer((request, response) => {
      const path = new URL(request.url, 'http://localhost').pathname
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><title>Route ${path}</title><body style="font:16px system-ui;margin:40px"><h1>Route ${path}</h1><p><a id="next" href="/route-next">Next</a></p><input id="field" aria-label="Field"></body>`)
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    const local = `http://localhost:${port}`
    const docs = `http://docs.localhost:${port}`
    const temp = `http://temp.localhost:${port}`
    const plain = `http://127.0.0.1:${port}`
    const ws = 'window.intoponet.workspaces'
    const browse = 'window.intoponet.browsing'
    const PRELUDE = `const isQuick = (w) => w.contentView.children.some((v) => !v.webContents.isDestroyed() && v.webContents.getURL().startsWith('data:text/html'))
      const quick = () => electron.BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && isQuick(w))
      const toolbarOf = (w) => w.contentView.children[0].webContents
      const pageOf = (w) => w.contentView.children[1].webContents`
    const mainCall = (expression) => ctx.main(`(() => { ${PRELUDE}; return (${expression}) })()`)
    const quickCount = () => mainCall('quick().length')
    const workspaceState = () => ctx.evaluate(`${ws}.get().then((s) => JSON.stringify(s))`).then(JSON.parse)
    const activeName = async () => { const s = await workspaceState(); return s.workspaces.find((w) => w.id === s.activeId)?.name }
    const idOf = async (name) => (await workspaceState()).workspaces.find((w) => w.name === name)?.id
    const switchTo = (id) => ctx.evaluate(`${ws}.switchTo({ id: ${JSON.stringify(id)} }).then(() => true)`)
    const tabUrls = () => ctx.evaluate(`window.intoponet.browserHost.getTabs().then((t) => JSON.stringify(t.map((x) => x.url)))`).then(JSON.parse)
    const openFromOtherApp = (url) => ctx.main(`electron.app.emit('open-url', { preventDefault() {} }, ${JSON.stringify(url)})`)
    const setOtherApps = (choice) => ctx.evaluate(`${browse}.setLinksFromOtherApps(${JSON.stringify(choice)}).then(() => true)`)
    const routes = (method, ...args) => ctx.evaluate(`${browse}.${method}(${args.map((a) => JSON.stringify(a)).join(', ')}).then((s) => JSON.stringify(s))`).then(JSON.parse)
    const savedRules = () => (existsSync(join(ctx.profile, 'link-routes.json')) ? JSON.parse(readFileSync(join(ctx.profile, 'link-routes.json'), 'utf8')).rules : [])
    const until = async (check, label, ms = 15_000) => {
      const end = Date.now() + ms
      while (Date.now() < end) {
        if (await check()) return
        await ctx.delay(250)
      }
      throw new CheckFailure(`Timed out waiting for ${label}.`)
    }
    const landed = (workspace, part) => async () => (await activeName()) === workspace && (await tabUrls()).some((url) => url.endsWith(part))
    try {
      await ctx.evaluate(`${ws}.create({ name: 'Work' }).then(() => true)`)
      const workId = await idOf('Work')
      await switchTo('main')
      expect((await activeName()) === 'Main', 'Could not show Main before the rules were made.')

      // A rule for localhost: a link to localhost opens in Work, as a tab, and Work is shown. Saved to link-routes.json.
      const first = await routes('addLinkRoute', 'localhost', workId)
      expect(first.rules.length === 1 && first.rules[0].workspaceName === 'Work', `The rule did not show with its workspace: ${JSON.stringify(first.rules)}.`)
      await until(async () => savedRules().some((rule) => rule.site === 'localhost' && rule.workspaceId === workId), 'the rule to be saved to link-routes.json')
      await openFromOtherApp(`${local}/route-1`)
      await until(landed('Work', '/route-1'), 'the matching link to open in Work')

      // Subdomains match the rule. 127.0.0.1 matches no rule and follows the default: a tab in the shown workspace (Main).
      await switchTo('main')
      await openFromOtherApp(`${docs}/route-2`)
      await until(landed('Work', '/route-2'), 'a subdomain link to open in Work')
      await switchTo('main')
      await openFromOtherApp(`${plain}/route-3`)
      await until(async () => (await tabUrls()).some((url) => url.endsWith('/route-3')), 'the unmatched link to open as a tab')
      expect((await activeName()) === 'Main', 'A link that matches no rule switched workspace.')

      // Quick window setting on: the matching link still goes to Work with no quick window; the unmatched one opens a quick window.
      await setOtherApps('quick-window')
      await ctx.delay(300)
      await switchTo('main')
      await openFromOtherApp(`${local}/route-4`)
      await until(landed('Work', '/route-4'), 'the matching link to open in Work with the quick-window setting on')
      expect((await quickCount()) === 0, 'A matching link opened a quick window.')
      await switchTo('main')
      await openFromOtherApp(`${plain}/route-5`)
      await until(async () => (await quickCount()) === 1, 'the unmatched link to open a quick window')
      await mainCall("toolbarOf(quick()[0]).executeJavaScript(\"document.getElementById('close').click()\")")
      await until(async () => (await quickCount()) === 0, 'the quick window to close')
      await setOtherApps('tab')
      await ctx.delay(300)

      // Private browsing: no routing. The link opens privately in the shown workspace (Main).
      await switchTo('main')
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(true).then(() => true)`)
      await openFromOtherApp(`${local}/route-private`)
      await ctx.delay(1200)
      expect((await activeName()) === 'Main', 'A link opened in private browsing was routed to a workspace.')
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(false).then(() => true)`)
      await ctx.delay(800)

      // Order: docs.localhost → Main is added after the localhost rule, so localhost wins; moved to the top, it wins.
      const docsWith = await routes('addLinkRoute', 'docs.localhost', 'main')
      const docsId = docsWith.rules.find((rule) => rule.site === 'docs.localhost').id
      await switchTo('main')
      await openFromOtherApp(`${docs}/route-6`)
      await until(landed('Work', '/route-6'), 'the earlier localhost rule to win')
      await switchTo('main')
      await routes('moveLinkRoute', docsId, 0)
      await openFromOtherApp(`${docs}/route-7`)
      await until(landed('Main', '/route-7'), 'the moved docs.localhost rule to win')

      // A rule for a deleted workspace is skipped: temp.localhost → Temp (deleted) falls to the localhost rule, then to the default.
      await ctx.evaluate(`${ws}.create({ name: 'Temp' }).then(() => true)`)
      const tempId = await idOf('Temp')
      const withTemp = await routes('addLinkRoute', 'temp.localhost', tempId)
      const tempRuleId = withTemp.rules.find((rule) => rule.site === 'temp.localhost').id
      await switchTo('main')
      await ctx.evaluate(`${ws}.delete(${JSON.stringify(tempId)}).then(() => true)`)
      const afterDelete = await routes('linkRoutes')
      expect(afterDelete.rules.find((rule) => rule.id === tempRuleId)?.workspaceName === null, 'A rule for a deleted workspace does not say so.')
      await switchTo('main')
      await openFromOtherApp(`${temp}/route-8`)
      await until(landed('Work', '/route-8'), 'the link to fall through the deleted rule to the localhost rule')
      await switchTo('main')
      await routes('removeLinkRoute', docsId)
      await routes('removeLinkRoute', afterDelete.rules.find((rule) => rule.site === 'localhost').id)
      await switchTo('main')
      await openFromOtherApp(`${temp}/route-9`)
      await until(landed('Main', '/route-9'), 'the default when only a deleted workspace\'s rule matches')

      // Always open here…: a quick window on localhost (no rule matches now) offers the workspaces. Choosing Work saves the
      // rule, shows Work and moves the same page there with its history.
      await setOtherApps('quick-window')
      await ctx.delay(300)
      await switchTo('main')
      await openFromOtherApp(`${local}/always-1`)
      await until(async () => (await quickCount()) === 1, 'the quick window for the always-here link')
      await until(async () => (await mainCall("pageOf(quick()[0]).getURL()")).endsWith('/always-1'), 'the always-here page to load')
      await until(async () => (await mainCall("toolbarOf(quick()[0]).executeJavaScript(\"document.getElementById('always').hidden\")")) === false, 'Always open here to show on a page')
      await (await ctx.page('/always-1')).evaluate(`(() => { document.getElementById('next').click(); return true })()`, { userGesture: true })
      await until(async () => (await mainCall("pageOf(quick()[0]).getURL()")).endsWith('/route-next'), 'the link inside the quick window to load')
      const quickPageId = await mainCall('pageOf(quick()[0]).id')
      await mainCall("(() => { globalThis.__routeMenu = null; electron.Menu.prototype.popup = function () { globalThis.__routeMenu = this }; return true })()")
      await mainCall("toolbarOf(quick()[0]).executeJavaScript(\"document.getElementById('always').click()\")")
      await until(async () => mainCall('globalThis.__routeMenu !== null'), 'the Always open here menu to appear')
      const labels = await mainCall('globalThis.__routeMenu.items.map((i) => i.label)')
      expect(labels.includes('Always open localhost in Work'), `The menu offered ${labels.join(', ')}.`)
      await mainCall("globalThis.__routeMenu.items.find((i) => i.label === 'Always open localhost in Work').click()")
      await until(async () => (await quickCount()) === 0, 'the quick window to go after Always open here')
      await until(landed('Work', '/route-next'), 'the page to land in Work')
      const moved = await mainCall(`(() => { const page = electron.webContents.getAllWebContents().find((c) => !c.isDestroyed() && c.getURL().endsWith('/route-next') && c.id === ${quickPageId}); return page ? { id: page.id, back: page.navigationHistory.canGoBack() } : null })()`)
      expect(moved?.id === quickPageId, 'Always open here did not move the same page into Work.')
      expect(moved.back === true, 'Always open here lost the page history.')
      await until(async () => savedRules().some((rule) => rule.site === 'localhost' && rule.workspaceId === workId), 'the always-here rule to be saved')

      // A private quick window has no Always open here.
      await setOtherApps('quick-window')
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(true).then(() => true)`)
      await openFromOtherApp(`${local}/always-private`)
      await until(async () => (await quickCount()) === 1, 'the private quick window to open')
      await until(async () => (await mainCall("toolbarOf(quick()[0]).executeJavaScript(\"document.getElementById('private').hidden\")")) === false, 'the private quick window to say so')
      expect(await mainCall("toolbarOf(quick()[0]).executeJavaScript(\"document.getElementById('always').hidden\")") === true, 'A private quick window offers Always open here.')
      await mainCall("toolbarOf(quick()[0]).executeJavaScript(\"document.getElementById('close').click()\")")
      await until(async () => (await quickCount()) === 0, 'the private quick window to close')
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(false).then(() => true)`)
      await setOtherApps('tab')
      await ctx.delay(500)

      // Settings › Browsing lists the rules, and the list passes axe.
      await openPanel(ctx, 'Settings')
      const settingsText = await ctx.evaluate(`document.querySelector('.settings-pane')?.innerText ?? ''`)
      expect(settingsText.includes('Links from other apps go to'), 'Settings › Browsing has no list of links from other apps.')
      expect(await ctx.evaluate(`!!document.querySelector('.link-route-site[aria-label="Site for rule 1"]')`), 'Settings does not list the rule.')
      await axeAudit(ctx, 'the link routes list', '.link-routes')
      await ctx.press('Escape')
      await ctx.delay(300)

      // Clear the rules this check made, so the next run starts clean.
      for (const rule of savedRules()) await routes('removeLinkRoute', rule.id)
      return 'Rule localhost → Work: a matching link (and a subdomain) opens in Work as a tab and shows it, and the rule is saved to link-routes.json; 127.0.0.1 follows the default. With the quick-window setting, the match still goes to Work and the unmatched link opens a quick window. Private browsing is not routed. The first matching rule wins (moving a rule changes that); a rule for a deleted workspace is skipped. Always open here… offers the workspaces, saves the rule, and moves the same page (history kept) into Work; a private quick window has none. Settings lists the rules; axe clean.'
    } finally {
      server.close()
    }
  },

  async COMPARE_COVERAGE(ctx) {
    await ctx.waitForNews()
    expect(await ctx.click('.globe-tabs button', 'World'), 'The World tab is missing.')
    await ctx.wait(`document.querySelectorAll('.world-list .world-row').length > 0`, 90_000, 'stories covered across the world')
    const rows = await ctx.evaluate(`document.querySelectorAll('.world-list .world-row').length`)
    // The first story whose sources carousel offers Compare (sources from two or more outlets).
    let compareReady = false
    for (let i = 0; i < Math.min(rows, 8) && !compareReady; i += 1) {
      await ctx.evaluate(`(() => { document.querySelectorAll('.world-list > li')[${i}]?.querySelector('.world-expand')?.click(); return true })()`)
      await ctx.delay(400)
      const opened = await ctx.evaluate(`!!document.querySelectorAll('.world-list > li')[${i}]?.querySelector('.world-sources-button')`)
      if (!opened) continue
      await ctx.evaluate(`(() => { document.querySelectorAll('.world-list > li')[${i}].querySelector('.world-sources-button').click(); return true })()`)
      await ctx.wait(`document.querySelectorAll('.sc-card').length >= 2`, 8_000, 'the carousel cards')
      compareReady = await ctx.evaluate(`!!document.querySelector('.sc-compare')`)
      if (!compareReady) {
        await ctx.evaluate(`(() => { document.querySelector('.sc-close').click(); return true })()`)
        await ctx.wait(`!document.querySelector('.sources-carousel')`, 8_000, 'the carousel to close')
      }
    }
    expect(compareReady, 'No world story has sources from two or more outlets to compare.')
    // The Compare chooser: the other outlets, one of them preselected, from another country than the front card.
    await ctx.click('.sc-compare')
    await ctx.wait(`!!document.querySelector('.sc-chooser-item.is-preselected')`, 5_000, 'the Compare chooser')
    const choices = await ctx.evaluate(`[...document.querySelectorAll('.sc-chooser-item')].map((b) => b.getAttribute('aria-label'))`)
    expect(choices.length >= 1, 'The Compare chooser lists no other outlet.')
    const front = await ctx.evaluate(`document.querySelector('.sc-card.is-front .sc-outlet strong')?.innerText ?? ''`)
    const preselected = await ctx.evaluate(`document.querySelector('.sc-chooser-item.is-preselected').getAttribute('aria-label')`)
    expect(!!preselected, 'The chooser preselected nothing.')
    await axeAudit(ctx, 'the Compare chooser', '.sc-chooser')
    await ctx.shot('compare-chooser')
    await ctx.evaluate(`(() => { document.querySelector('.sc-chooser-item.is-preselected').click(); return true })()`)
    await ctx.wait(`!document.querySelector('.sources-carousel')`, 10_000, 'the carousel to hand over to the browser')

    // Two outlets, both sides' articles, side by side in the app window.
    const stateOf = async () => JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getState().then((s) => JSON.stringify(s))`))
    const pagesNow = () => ctx.main(`(() => {
      const win = electron.BrowserWindow.getAllWindows()[0]
      const kids = win.contentView.children.filter((v) => v.webContents && !v.webContents.isDestroyed())
      return JSON.stringify({
        content: win.getContentSize(),
        pages: kids.filter((v) => /^https?:/.test(v.webContents.getURL())).map((v) => ({ url: v.webContents.getURL(), id: v.webContents.id, bounds: v.getBounds(), visible: v.getVisible(), focused: v.webContents.isFocused() })),
      })
    })()`).then(JSON.parse)
    let state = null
    let views = null
    for (let i = 0; i < 100; i += 1) {
      state = await stateOf()
      views = await pagesNow()
      if (state.split?.left?.compare && state.split?.right?.compare && views.pages.length === 2) break
      await ctx.delay(250)
    }
    expect(state.split?.left?.compare && state.split?.right?.compare, 'The pair is not side by side with outlet labels.')
    const { split } = state
    expect(views.pages.length === 2, `${views.pages.length} pages are on screen, not two.`)
    const [left, right] = views.pages.slice().sort((p, q) => p.bounds.x - q.bounds.x)
    expect(left.url === split.left.url && right.url === split.right.url, `The pages on screen (${left.url}, ${right.url}) are not the pair's left and right sides.`)
    const a = left.bounds
    const b = right.bounds
    expect(left.visible && right.visible, 'A compared page is hidden.')
    expect(a.x + a.width <= b.x, `The pages overlap or sit one above the other (left ${JSON.stringify(a)}, right ${JSON.stringify(b)}).`)
    expect(a.y === b.y, `The pages are stacked, not side by side (left y ${a.y}, right y ${b.y}).`)
    expect(a.height === b.height && a.height >= views.content[1] * 0.5, `The pages are not full height (${a.height} and ${b.height} of ${views.content[1]}).`)
    expect(a.width > 0 && b.width > 0, 'A compared page has no width.')

    // Each header names its outlet and country.
    const headers = await ctx.evaluate(`[...document.querySelectorAll('.split-header[data-split-side]')].map((h) => ({ side: h.getAttribute('data-split-side'), origin: h.querySelector('.split-header-origin')?.innerText ?? '' }))`)
    for (const [side, tab] of [['left', split.left], ['right', split.right]]) {
      const header = headers.find((item) => item.side === side)
      const label = `${tab.compare.outlet} · ${tab.compare.country}`
      expect(header?.origin === label, `The ${side} header reads "${header?.origin}", not "${label}".`)
    }
    await axeAudit(ctx, 'the Compare headers', '.split-header')
    await ctx.shot('compare-pair')

    // Translate acts on one side: it focuses that side (the right one when it offers Translate), then opens the bar.
    const translateButton = (side) => `(() => [...document.querySelectorAll('.split-header[data-split-side="${side}"] .split-compare-button')].find((x) => x.textContent.includes('Translate')))()`
    const offersTranslate = async (side) => ctx.evaluate(`!!${translateButton(side)}`)
    const translateSide = (await offersTranslate('right')) ? 'right' : (await offersTranslate('left')) ? 'left' : null
    let translateNote = 'Neither side is in another language from the reader, so Translate is not offered'
    if (translateSide) {
      await ctx.evaluate(`(() => { ${translateButton(translateSide)}.click(); return true })()`)
      for (let i = 0; i < 40; i += 1) {
        const now = await stateOf()
        if (now.split?.focused === translateSide) break
        await ctx.delay(200)
      }
      // Translate acts on the focused side's page, so the shell's focus must be on that side (the bar itself takes the keyboard).
      const focusedNow = await stateOf()
      expect(focusedNow.split?.focused === translateSide, `Translate on the ${translateSide} side did not focus that side (focused: ${focusedNow.split?.focused}).`)
      const focusedUrl = focusedNow.split[translateSide].url
      await ctx.wait(`!!document.querySelector('.translate-bar')`, 8_000, 'the translate bar')
      translateNote = `Translate on the ${translateSide} side focused that side's page (${focusedUrl}) and opened the translate bar`
    }

    // The Olds for the story, from the left side's header.
    const oldsClicked = await ctx.evaluate(`(() => { const b = [...document.querySelectorAll('.split-header[data-split-side="left"] .split-compare-button')].find((x) => x.textContent.includes('The Olds')); if (!b) return false; b.click(); return true })()`)
    expect(oldsClicked, 'The pair has no The Olds button.')
    await ctx.wait(`!!document.querySelector('.olds-sheet')`, 15_000, 'The Olds to open for the story')
    await ctx.shot('compare-olds')
    const paywalls = await ctx.evaluate(`document.querySelectorAll('.split-compare-paywall').length`)

    // An article whose link redirects to another host as it first loads keeps its outlet label there.
    const redirects = createServer((request, response) => {
      if (request.url.startsWith('/moved')) {
        response.writeHead(302, { location: `http://127.0.0.1:${redirects.address().port}/article` })
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><html lang="en"><title>Article</title><h1>Article</h1></html>')
    })
    await new Promise((resolve) => redirects.listen(0, '127.0.0.1', resolve))
    try {
      const port = redirects.address().port
      await ctx.evaluate(`window.intoponet.browserHost.openCompare({ id: 'redirect-story', title: 'A story' }, { url: 'http://127.0.0.1:${port}/article', outlet: 'Left Outlet', countryCode: 'GB' }, { url: 'http://localhost:${port}/moved', outlet: 'Moved Outlet', countryCode: 'FR' }).then(() => true)`)
      let moved = null
      for (let i = 0; i < 40 && !moved; i += 1) {
        const now = await stateOf()
        if (now.split?.left?.compare?.outlet === 'Left Outlet' && now.split.right.url.startsWith(`http://127.0.0.1:${port}/article`)) moved = now.split.right
        else await ctx.delay(250)
      }
      expect(moved?.compare?.outlet === 'Moved Outlet', `The right side lost its outlet label after its link redirected to another host: ${JSON.stringify(moved)}.`)

      // "Free coverage" on a paywalled side opens that side's free-coverage choices: from the other side, and
      // again from that side once it has the focus and its bar was closed.
      await ctx.evaluate(`(() => { localStorage.setItem('intoponet.paywalled-hosts.v1', JSON.stringify(['localhost'])); return true })()`)
      await ctx.evaluate(`window.intoponet.browserHost.openCompare({ id: 'paywall-story', title: 'A paywalled story' }, { url: 'http://127.0.0.1:${port}/free', outlet: 'Free Outlet', countryCode: 'GB' }, { url: 'http://localhost:${port}/paywalled', outlet: 'Paid Outlet', countryCode: 'FR' }).then(() => true)`)
      const freeButton = `[...document.querySelectorAll('.split-header[data-split-side="right"] .split-compare-button')].find((b) => b.textContent.includes('Free coverage'))`
      for (let i = 0; i < 40; i += 1) {
        const now = await stateOf()
        if (now.split?.right?.compare?.outlet === 'Paid Outlet' && now.split.focused === 'left' && await ctx.evaluate(`!!${freeButton}`)) break
        await ctx.delay(250)
      }
      expect(await ctx.evaluate(`!!${freeButton}`), 'The paywalled right side offers no Free coverage.')
      await ctx.evaluate(`(() => { ${freeButton}.click(); return true })()`)
      await ctx.wait(`window.intoponet.browserHost.getState().then((s) => s.split?.focused === 'right')`, 8_000, 'Free coverage to focus its side')
      await ctx.wait(`!!document.querySelector('.free-coverage')`, 10_000, 'the free-coverage choices for the right side')
      await ctx.evaluate(`(() => { document.querySelector('.free-coverage .fc-close').click(); return true })()`)
      await ctx.wait(`!document.querySelector('.free-coverage')`, 5_000, 'the free-coverage bar to close')
      await ctx.evaluate(`(() => { ${freeButton}.click(); return true })()`)
      await ctx.wait(`!!document.querySelector('.free-coverage')`, 5_000, 'Free coverage on the focused side to open its choices again after the bar was closed')
    } finally {
      redirects.close()
    }
    return `Compared "${front}" with ${split.right.compare.outlet} (${split.right.compare.country}): two pages ${a.width}×${a.height} and ${b.width}×${b.height}, side by side at y ${a.y}; headers read "${headers.map((h) => h.origin).join('" and "')}"; ${translateNote}; The Olds opened for the story; ${paywalls} paywall badge(s) on the pair.`
  },

  async PLACE_WORKSPACES(ctx) {
    await ctx.waitForNews()
    const { server, origin } = await tabSite()
    const host = 'window.intoponet.browserHost'
    const ws = 'window.intoponet.workspaces'
    const tabs = async () => JSON.parse(await ctx.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
    const state = async () => JSON.parse(await ctx.evaluate(`${ws}.get().then((s) => JSON.stringify(s))`))
    const savedState = () => JSON.parse(readFileSync(join(ctx.profile, 'browser-state.v1.json'), 'utf8'))
    const flownTo = `(() => { try { const s = JSON.parse(localStorage.getItem('intoponet.exploration-state.v1')); return !!s.geographicAnchor && Math.abs(s.geographicAnchor.lat - 38.72) < 0.5 && Math.abs(s.geographicAnchor.lon + 9.14) < 0.5 } catch { return false } })()`
    const markerIds = () => ctx.evaluate(`document.querySelector('.app-shell').dataset.workspaceMarks ?? ''`).then((value) => value.split(' ').filter(Boolean))
    /** Opens the globe's layer card if it is folded (focusing a folded icon expands it, as hovering does), then chooses the field: Public or Mine (My map). */
    const chooseField = async (label) => {
      // With a page open the globe's field is hidden (as My map does, the page goes away first).
      if (await ctx.evaluate(`!!document.querySelector('.app-shell.page-open')`)) {
        await ctx.evaluate(`window.intoponet.browserHost.close().then(() => true)`)
        await ctx.delay(600)
      }
      if (!(await ctx.evaluate(`!!document.querySelector('[aria-label="Field"]')`))) {
        // Hovering the folded card for a moment expands it (a real pointer move: focus may sit in the page).
        const box = JSON.parse(await ctx.evaluate(`JSON.stringify(document.querySelector('.globe-layers').getBoundingClientRect())`))
        await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + box.width / 2, y: box.y + box.height / 2 })
        await ctx.delay(1400)
      }
      await ctx.wait(`!!document.querySelector('[aria-label="Field"]')`, 4000, 'the field choice on the globe')
      expect(await ctx.click('[aria-label="Field"] button', label), `No "${label}" choice in the field.`)
      await ctx.delay(300)
    }
    /** The app opened again with a saved browser state, in a profile of its own (as WORKSPACES does). */
    const relaunch = async (saved, check) => {
      const profile = mkdtempSync(join(tmpdir(), 'intoponet-e2e-place-'))
      writeFileSync(join(profile, 'browser-state.v1.json'), JSON.stringify(saved))
      const before = process.env.E2E_PROFILE
      process.env.E2E_PROFILE = profile
      try {
        return await runAppCheck(check, { timeoutMs: 60_000 })
      } finally {
        if (before === undefined) delete process.env.E2E_PROFILE
        else process.env.E2E_PROFILE = before
        rmSync(profile, { recursive: true, force: true })
      }
    }
    try {
      // Pinned open, so the sidebar's workspace actions are there. A geolocation spy stays silent through the check.
      await openPage(ctx, `${origin}/main-a`, 900)
      await ctx.click('button[aria-label="Pin tabs open"]')
      await ctx.delay(400)
      await ctx.evaluate(`(() => { window.__geoAsked = 0; const asked = () => { window.__geoAsked += 1 }; navigator.geolocation.getCurrentPosition = asked; navigator.geolocation.watchPosition = asked; return true })()`)
      const mainId = (await state()).activeId

      // "Lisbon desk", with a page open in it.
      await ctx.evaluate(`${ws}.create({ name: 'Lisbon desk' }).then(() => true)`)
      await ctx.delay(400)
      const lisbonId = (await state()).activeId
      await openPage(ctx, `${origin}/lisbon-a`, 900)

      // Anchor it through the place search, from the workspace's actions.
      await ctx.main(`(() => { electron.app.focus({ steal: true }); electron.BrowserWindow.getAllWindows()[0].focus(); return true })()`)
      await ctx.click('button[aria-label="Actions for workspace Lisbon desk"]')
      await ctx.wait(`!!document.querySelector('.tab-rail-folder-menu [role="menuitem"]')`, 2000, 'the workspace menu')
      await ctx.click('.tab-rail-folder-menu [role="menuitem"]', 'Anchor to a place')
      await ctx.wait(`document.activeElement?.getAttribute('role') === 'combobox'`, 3000, 'the place search to take focus')
      await ctx.type('Lisbon')
      await ctx.wait(`[...document.querySelectorAll('[role="listbox"] [role="option"]')].some((e) => e.innerText.includes('Lisbon'))`, 5000, 'the place search to find Lisbon')
      await axeAudit(ctx, 'the place picker', '[aria-label="Anchor Lisbon desk to a place"]')
      await ctx.press('Enter')
      await ctx.wait(`${ws}.get().then((s) => !!s.workspaces.find((w) => w.id === ${JSON.stringify(lisbonId)})?.anchor)`, 4000, 'Lisbon desk to be anchored')
      const anchor = (await state()).workspaces.find((w) => w.id === lisbonId).anchor
      expect(Math.abs(anchor.lat - 38.72) < 0.3 && Math.abs(anchor.lon + 9.14) < 0.3, `The anchor is ${JSON.stringify(anchor)}, not Lisbon.`)
      expect((await ctx.evaluate('window.__geoAsked')) === 0, 'The device location was asked for while anchoring.')

      // Switching away and back flies the globe to Lisbon; the browser panel stays open.
      await ctx.evaluate(`${ws}.switchTo({ id: ${JSON.stringify(mainId)} }).then(() => true)`)
      await ctx.delay(700)
      await ctx.evaluate(`${ws}.switchTo({ id: ${JSON.stringify(lisbonId)} }).then(() => true)`)
      await ctx.wait(flownTo, 5000, 'the globe to fly to Lisbon')
      expect((await panelState(ctx)).isVisible, 'Switching to the anchored workspace closed the browser panel.')

      // Headlines here: the place's latest headlines in the sidebar; one opens as a tab in this workspace.
      await ctx.wait(`!!document.querySelector('.tab-rail-headlines-list .tab-rail-headline')`, 60_000, 'Headlines here to list Lisbon headlines')
      const headlines = await ctx.evaluate(`document.querySelectorAll('.tab-rail-headlines-list .tab-rail-headline').length`)
      expect(headlines >= 1 && headlines <= 5, `Headlines here lists ${headlines} headlines.`)
      await axeAudit(ctx, 'Headlines here', '.tab-rail-headlines')
      const countBefore = (await state()).workspaces.find((w) => w.id === lisbonId).tabCount
      await ctx.click('.tab-rail-headline')
      await ctx.wait(`${ws}.get().then((s) => s.workspaces.find((w) => w.id === ${JSON.stringify(lisbonId)}).tabCount === ${countBefore + 1} && s.activeId === ${JSON.stringify(lisbonId)})`, 8000, 'the headline to open as a tab in Lisbon desk')

      // The anchor marker: only on My map (the Mine field), never in the public field.
      expect(!(await markerIds()).includes(`workspace:${lisbonId}`), 'The anchor shows in the public field.')
      await chooseField('Mine')
      await ctx.wait(`(document.querySelector('.app-shell').dataset.workspaceMarks ?? '').includes('workspace:${lisbonId}')`, 4000, 'the anchor marker on My map')
      await chooseField('Public')
      expect(!(await markerIds()).includes(`workspace:${lisbonId}`), 'The anchor marker stayed on the globe after My map was closed.')
      await chooseField('Mine')
      await ctx.shot('place-workspaces')

      // Relaunch keeps the anchor.
      for (let i = 0; i < 40 && !savedState().workspaces?.some((w) => w.anchor); i += 1) await ctx.delay(250)
      const saved = savedState()
      expect(saved.workspaces.some((w) => w.name === 'Lisbon desk' && w.anchor?.lat === anchor.lat && w.anchor?.lon === anchor.lon), `Saved workspaces: ${JSON.stringify(saved.workspaces)}.`)
      const restored = await relaunch(saved, async (next) => {
        const nextState = JSON.parse(await next.evaluate(`${ws}.get().then((s) => JSON.stringify(s))`))
        const restoredLisbon = nextState.workspaces.find((w) => w.name === 'Lisbon desk')
        expect(restoredLisbon?.anchor?.lat === anchor.lat && restoredLisbon?.anchor?.lon === anchor.lon, `After a restart Lisbon desk's anchor is ${JSON.stringify(restoredLisbon?.anchor)}.`)
        return 'restored'
      })
      expect(restored === 'restored', 'The relaunched app did not keep the anchor.')
      return `Anchored "Lisbon desk" to ${anchor.label} from the place search (no device location asked); switching away and back flew the globe there with the panel open; Headlines here listed ${headlines} headlines and one opened as a tab in that workspace; its marker showed on My map only; the anchor survived a relaunch; axe clean on the picker and the section.`
    } finally {
      server.close()
    }
  },

  async STORY_TABS(ctx) {
    await ctx.waitForNews()
    await ctx.wait(`window.intoponet.browserHost.getNewsDigest().then((raw) => (JSON.parse(raw).mountains ?? []).some((m) => (m.countries ?? []).some((c) => c.headline && c.headline.title !== m.title)))`, 120_000, 'a story with two headlines in the news digest')
    const digest = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getNewsDigest()`))
    const story = digest.mountains.find((m) => (m.countries ?? []).some((c) => c.headline && c.headline.title !== m.title))
    const second = story.countries.find((c) => c.headline && c.headline.title !== story.title).headline
    const label = story.label ?? story.title
    const storyName = label.length > 40 ? `${label.slice(0, 38)}…` : label
    const escape = (text) => text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])
    // Two articles of the story (matched by their titles), a control and a private tab with a matching title.
    const titles = { '/a': `${story.title} | Harbour Daily`, '/b': `${second.title} | Tide Wire`, '/private': `${story.title} | Harbour Daily`, '/control': 'Cooking pasta for a crowd: ten easy sauces | Kitchen Notes' }
    const hits = new Map()
    const server = createServer((request, response) => {
      const path = new URL(request.url, 'http://localhost').pathname
      hits.set(path, (hits.get(path) ?? 0) + 1)
      const title = titles[path] ?? 'Not found'
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><meta charset="utf-8"><title>${escape(title)}</title><body style="font:16px system-ui;margin:40px"><h1>${escape(title)}</h1></body>`)
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    const host = 'window.intoponet.browserHost'
    const tabs = async () => JSON.parse(await ctx.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
    const folders = async () => JSON.parse(await ctx.evaluate(`${host}.getTabFolders().then((f) => JSON.stringify(f))`))
    const byUrl = async (path) => (await tabs()).find((tab) => tab.url === `${origin}${path}`)
    const requestCounts = () => JSON.stringify([...hits].sort())
    try {
      await ctx.click('button[aria-label="Pin tabs open"]')
      for (const path of ['/a', '/b', '/control']) await openPage(ctx, `${origin}${path}`, 900)
      await ctx.wait(`document.querySelectorAll('.tab-rail-story').length === 2`, 30_000, 'a story badge on each of the two articles')
      const [a, b, control] = [await byUrl('/a'), await byUrl('/b'), await byUrl('/control')]
      expect(!!a && !!b && !!control, 'The test pages did not open as tabs.')
      expect(await ctx.evaluate(`!!document.querySelector('[data-tab-id="${a.id}"] .tab-rail-story') && !!document.querySelector('[data-tab-id="${b.id}"] .tab-rail-story')`), 'An article in the story has no badge.')
      expect(await ctx.evaluate(`!document.querySelector('[data-tab-id="${control.id}"] .tab-rail-story')`), 'The unrelated control page has a story badge.')
      // A private tab with the same title as an article gets no badge (and is never grouped).
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(true).then(() => true)`)
      await openPage(ctx, `${origin}/private`, 900)
      const privateTab = await byUrl('/private')
      expect(privateTab?.isPrivate === true, 'The private test tab is not private.')
      await ctx.delay(800)
      expect(await ctx.evaluate(`!document.querySelector('[data-tab-id="${privateTab.id}"] .tab-rail-story')`), 'A private tab was given a story badge.')
      await ctx.delay(1500)
      const baseline = requestCounts()
      // Group by story: one folder named for the story, holding the two articles and nothing else.
      const orderBefore = (await tabs()).map((tab) => tab.id).join(' ')
      // The button shows while a loose tab matches a story (news rebuilds can briefly change the matches).
      await ctx.wait(`!!document.querySelector('button[aria-label="Group by story"]')`, 15_000, 'the Group by story button')
      expect(await ctx.click('button[aria-label="Group by story"]'), 'Group by story could not be clicked.')
      await ctx.wait(`window.intoponet.browserHost.getTabFolders().then((f) => f.some((x) => x.storyId))`, 8000, 'the story folder')
      const made = (await folders()).find((folder) => folder.storyId)
      expect(made.name === storyName, `The folder is named "${made.name}", not for the story "${storyName}".`)
      const grouped = await tabs()
      expect(grouped.find((tab) => tab.id === a.id)?.folderId === made.id && grouped.find((tab) => tab.id === b.id)?.folderId === made.id, 'The story’s two articles are not in its folder.')
      expect(!grouped.find((tab) => tab.id === control.id)?.folderId && !grouped.find((tab) => tab.id === privateTab.id)?.folderId, 'The control or the private tab was grouped.')
      await ctx.shot('story-folder')
      // Undo puts back the order and removes the folder.
      await ctx.click('.tab-rail-archived .tab-rail-undo')
      await ctx.wait(`window.intoponet.browserHost.getTabFolders().then((f) => !f.some((x) => x.storyId))`, 8000, 'the story folder to be removed by Undo')
      expect((await tabs()).map((tab) => tab.id).join(' ') === orderBefore, 'Undo did not restore the tab order.')
      // Grouping tabs that are gone (closed while Tidy's preview was open) is refused, not reported as done with an Undo.
      expect(await ctx.evaluate(`${host}.groupTabs([{ name: 'Gone', tabIds: ['no-such-tab'] }]).then(() => 'grouped', () => 'refused')`) === 'refused', 'Grouping tabs that are gone was reported as done.')
      expect((await folders()).length === 0, 'Grouping tabs that are gone made a folder.')
      // A pair side by side is never broken: with b beside the control page, Group by story leaves b (and so has one article, too few for a folder)...
      await ctx.evaluate(`${host}.splitTab(${JSON.stringify(b.id)}, ${JSON.stringify(control.id)}, 'left').then(() => true)`)
      await ctx.wait(`${host}.getTabs().then((t) => t.find((x) => x.id === ${JSON.stringify(b.id)})?.split?.partnerId === ${JSON.stringify(control.id)})`, 4000, 'b and the control page to be side by side')
      await ctx.wait(`!!document.querySelector('.tab-rail-pair')`, 4000, 'the sidebar to show the pair')
      await ctx.click('button[aria-label="Group by story"]')
      await ctx.delay(800)
      expect((await folders()).length === 0 && (await byUrl('/b'))?.split?.partnerId === control.id, `Group by story broke a pair or made a folder for one article: ${JSON.stringify({ folders: await folders(), b: await byUrl('/b') })}.`)
      // ...and main, asked for both articles anyway, moves only the one not in a pair.
      const pairUndo = JSON.parse(await ctx.evaluate(`${host}.groupTabs([{ name: ${JSON.stringify(label)}, tabIds: [${JSON.stringify(a.id)}, ${JSON.stringify(b.id)}], storyId: ${JSON.stringify(made.storyId)} }]).then((r) => JSON.stringify(r))`))
      const [pairA, pairB] = [await byUrl('/a'), await byUrl('/b')]
      expect(!!pairA?.folderId && !pairB?.folderId && pairB?.split?.partnerId === control.id && (await byUrl('/control'))?.split?.partnerId === b.id, `Grouping one side of a pair moved it out of the pair: ${JSON.stringify({ a: pairA, b: pairB })}.`)
      expect(pairUndo.moved === 1 && pairUndo.folders === 1, `Grouping reported ${JSON.stringify(pairUndo)}; one tab moved, into one folder.`)
      await ctx.evaluate(`${host}.undoGroupTabs(${JSON.stringify(pairUndo.undoId)}).then(() => true)`)
      await ctx.evaluate(`${host}.unsplitTab(${JSON.stringify(b.id)}).then(() => true)`)
      await ctx.wait(`window.intoponet.browserHost.getTabFolders().then((f) => f.length === 0)`, 4000, 'the one-article folder to be undone')
      await ctx.wait(`!document.querySelector('.tab-rail-pair') && !document.querySelector('.tab-rail-folder')`, 4000, 'the sidebar to show the pair ended and no folder')
      // Hovering the folder highlights its story on the globe; leaving clears it.
      await ctx.click('button[aria-label="Group by story"]')
      await ctx.wait(`window.intoponet.browserHost.getTabFolders().then((f) => f.some((x) => x.storyId))`, 8000, 'the story folder again')
      await ctx.wait(`[...document.querySelectorAll('.tab-rail-archived')].some((e) => e.textContent.includes('Grouped 2 tabs by story'))`, 3000, 'the notice to count the two tabs grouped')
      const hovered = (await folders()).find((folder) => folder.storyId)
      const at = JSON.parse(await ctx.evaluate(`JSON.stringify((() => { const r = document.querySelector('[data-story-id="${hovered.storyId}"] .tab-rail-folder-head').getBoundingClientRect(); return { x: r.x + 40, y: r.y + r.height / 2 } })())`))
      await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y })
      await ctx.wait(`document.documentElement.dataset.storyHighlight === ${JSON.stringify(hovered.storyId)}`, 5000, 'the story to be highlighted when its folder is hovered')
      await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 600 })
      await ctx.wait(`document.documentElement.dataset.storyHighlight === ''`, 5000, 'the highlight to clear when the pointer leaves the folder')
      // Matching and grouping sent nothing for any tab's address or title.
      expect(requestCounts() === baseline, `A tab page was requested while matching: ${requestCounts()} (was ${baseline}).`)
      await axeAudit(ctx, 'the tab sidebar with a story folder', '.tab-rail')
      // A folder that goes away under the pointer gets no pointer-leave: its story stops being highlighted all the same.
      await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y })
      await ctx.wait(`document.documentElement.dataset.storyHighlight === ${JSON.stringify(hovered.storyId)}`, 5000, 'the story to be highlighted again on hover')
      await ctx.evaluate(`${host}.deleteTabFolder(${JSON.stringify(hovered.id)}).then(() => true)`)
      await ctx.wait(`document.documentElement.dataset.storyHighlight === ''`, 5000, 'the highlight to clear when the hovered story folder was deleted')
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(false).then(() => true)`)
      return `Two articles of "${storyName}" badged; the control and a private tab with a matching title not; Group by story made one folder for it holding only the two articles; Undo restored the order and removed the folder; hovering the folder highlighted the story (${hovered.storyId}) and leaving cleared it; no page was requested during matching; axe clean.`
    } finally {
      server.close()
    }
  },

  async TAB_TIDY_LOCAL(ctx) {
    const host = 'window.intoponet.browserHost'
    const tabs = async () => JSON.parse(await ctx.evaluate(`${host}.getTabs().then((t) => JSON.stringify(t))`))
    const folders = async () => JSON.parse(await ctx.evaluate(`${host}.getTabFolders().then((f) => JSON.stringify(f))`))
    const escape = (text) => text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])
    const COOKING = ['Cooking pasta sauces at home', 'Cooking rice and grains every week', 'Cooking bread from scratch']
    const ASTRONOMY = ['Astronomy: watching Jupiter through a telescope', 'Astronomy guide to the night sky', 'Astronomy planets visible this month']
    const SECRET = 'Cooking secret recipe private notes'
    const titles = { '/c1': COOKING[0], '/c2': COOKING[1], '/c3': COOKING[2], '/a1': ASTRONOMY[0], '/a2': ASTRONOMY[1], '/a3': ASTRONOMY[2], '/secret': SECRET }
    const hits = new Map()
    const requestCounts = () => JSON.stringify([...hits].sort())
    const server = createServer((request, response) => {
      const path = new URL(request.url, 'http://localhost').pathname
      hits.set(path, (hits.get(path) ?? 0) + 1)
      const title = titles[path] ?? 'Not found'
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><meta charset="utf-8"><title>${escape(title)}</title><body style="font:16px system-ui;margin:40px"><h1>${escape(title)}</h1></body>`)
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    const byPrivate = async () => (await tabs()).find((tab) => tab.url === `${origin}/secret`) ?? {}
    // Counts the main process's net.request and fetch calls (Tidy must make none).
    const netCalls = () => ctx.main(`globalThis.__netCalls ?? 0`)
    try {
      writeFileSync(TIDY_DEBUG_FILE, '')
      await ctx.main(`(() => { const net = electron.net; if (!globalThis.__netWrapped) { globalThis.__netWrapped = true; globalThis.__netCalls = 0; const request = net.request; net.request = function (...args) { globalThis.__netCalls += 1; return request.apply(this, args) }; const fetchOnce = globalThis.fetch; globalThis.fetch = (...args) => { globalThis.__netCalls += 1; return fetchOnce(...args) } } globalThis.__netCalls = 0; return true })()`)
      await ctx.click('button[aria-label="Pin tabs open"]')
      for (const path of Object.keys(titles).filter((path) => path !== '/secret')) await openPage(ctx, `${origin}${path}`, 900)
      await ctx.wait(`window.intoponet.browserHost.getTabs().then((t) => t.filter((x) => x.title).length >= 6)`, 30_000, 'six titled tabs')
      await ctx.delay(1500)
      // Laya off: Tidy says why and offers Group by story. Nothing moves.
      const status = await ctx.evaluate(`window.intoponet.laya.status().then((s) => JSON.stringify(s))`).then(JSON.parse)
      if (status.enabled) await ctx.evaluate(`window.intoponet.laya.disable({ deleteModel: false }).then(() => true)`)
      await ctx.evaluate(`(document.querySelector('button[aria-label="Tidy tabs"]').focus(), true)`)
      await ctx.click('button[aria-label="Tidy tabs"]')
      await ctx.wait(`!!document.querySelector('.tidy-explain') && document.querySelector('.tidy-explain').innerText.includes('Turn it on in Settings › Laya')`, 20_000, 'Tidy to explain that Laya is off')
      expect(await ctx.evaluate(`[...document.querySelectorAll('.tidy-explain button')].some((b) => b.innerText.includes('Group by story'))`), 'Tidy with Laya off does not offer Group by story.')
      // The sheet is drawn by the shell, under the native page view: the page must be hidden while it is open.
      const pageShown = () => ctx.main(`electron.BrowserWindow.getAllWindows()[0].contentView.children.some((view) => view.getVisible() && /^https?:/.test(view.webContents?.getURL?.() ?? ''))`)
      expect(!(await pageShown()), 'The page view is drawn over the Tidy preview, hiding it.')
      expect(await ctx.evaluate(`!!document.activeElement?.closest('.tidy-sheet')`), 'Focus did not move into the Tidy preview.')
      // It is modal: Tab from its last button stays in it (it does not reach the sidebar behind it).
      await ctx.evaluate(`([...document.querySelectorAll('.tidy-sheet button')].at(-1).focus(), true)`)
      await ctx.press('Tab')
      expect(await ctx.evaluate(`!!document.activeElement?.closest('.tidy-sheet')`), 'Tab left the Tidy preview for the sidebar behind it.')
      await axeAudit(ctx, 'the Tidy preview with Laya off', '.tidy-sheet')
      await ctx.press('Escape')
      await ctx.wait(`!document.querySelector('.tidy-sheet')`, 5000, 'the Tidy preview to close')
      await ctx.delay(300)
      expect(await pageShown(), 'The page did not come back after the Tidy preview closed.')
      expect(await ctx.evaluate(`document.activeElement?.getAttribute('aria-label') === 'Tidy tabs'`), 'Focus did not go back to Tidy when the preview closed.')
      expect((await folders()).length === 0, 'Tidy with Laya off moved tabs.')
      // Laya on (its model downloads here, which the full tier allows). Not awaited: the download can take minutes.
      await ctx.evaluate(`void window.intoponet.laya.enable().catch(() => undefined), true`)
      await ctx.wait(`window.intoponet.laya.status().then((s) => s.enabled && s.model.downloaded && s.model.verified)`, 900_000, 'Laya to be on with its model ready')
      // A cooking page side by side with an astronomy page: their topics differ, so Tidy suggests neither (it never breaks a pair).
      const [c1, a1] = [(await tabs()).find((tab) => tab.url === `${origin}/c1`), (await tabs()).find((tab) => tab.url === `${origin}/a1`)]
      await ctx.evaluate(`${host}.splitTab(${JSON.stringify(c1.id)}, ${JSON.stringify(a1.id)}, 'left').then(() => true)`)
      await ctx.wait(`${host}.getTabs().then((t) => t.find((x) => x.id === ${JSON.stringify(c1.id)})?.split?.partnerId === ${JSON.stringify(a1.id)})`, 4000, 'the cooking and astronomy pages to be side by side')
      const orderBefore = (await tabs()).map((tab) => tab.id).join(' ')
      // The suggestion is shown and nothing moves until accepted.
      const suggestion = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.tidyTabsSuggest().then((s) => JSON.stringify(s))`))
      expect(suggestion.available === true && suggestion.groups.length >= 2, `Tidy proposed ${JSON.stringify(suggestion)}; expected at least two groups.`)
      const byId = new Map((await tabs()).map((tab) => [tab.id, tab.title]))
      const topicOf = (title) => (title.startsWith('Cooking') ? 'cooking' : title.startsWith('Astronomy') ? 'astronomy' : 'other')
      for (const group of suggestion.groups) {
        const topics = new Set(group.tabIds.map((id) => topicOf(byId.get(id) ?? '')))
        expect(topics.size === 1 && !topics.has('other'), `Tidy mixed topics in "${group.name}": ${group.tabIds.map((id) => byId.get(id)).join(' | ')}.`)
      }
      expect(new Set(suggestion.groups.flatMap((group) => group.tabIds.map((id) => topicOf(byId.get(id))))).size === 2, 'Tidy did not separate cooking from astronomy.')
      expect(!suggestion.groups.some((group) => group.tabIds.includes(c1.id) || group.tabIds.includes(a1.id)), `Tidy suggested moving one side of a pair: ${JSON.stringify(suggestion.groups)}.`)
      expect((await folders()).length === 0, 'Tidy moved tabs before they were accepted.')
      // A private tab about cooking is open during a suggestion: its title must not reach the model, and nothing may be requested.
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(true).then(() => true)`)
      await openPage(ctx, `${origin}/secret`, 900)
      expect((await byPrivate()).isPrivate === true, 'The private test tab is not private.')
      await ctx.main(`(globalThis.__netCalls = 0, true)`)
      const tidyBaseline = requestCounts()
      await ctx.evaluate(`window.intoponet.browserHost.tidyTabsSuggest().then(() => true)`)
      const sent = readFileSync(TIDY_DEBUG_FILE, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((record) => record.texts).map((record) => record.texts)
      expect(sent.length > 0 && sent.every((texts) => texts.length === 6), `The model was given ${JSON.stringify(sent.map((texts) => texts.length))} texts; expected the six loose tabs.`)
      expect(!readFileSync(TIDY_DEBUG_FILE, 'utf8').includes('secret'), 'A private tab’s title reached the model.')
      expect(requestCounts() === tidyBaseline, 'A page was requested during tidy.')
      expect((await netCalls()) === 0, `Tidy made ${await netCalls()} network calls in the main process.`)
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(false).then(() => true)`)
      await ctx.delay(800)
      // Ending private browsing shows the globe; show a page again so the sidebar (and Tidy) is back.
      await ctx.evaluate(`window.intoponet.browserHost.activateTab(${JSON.stringify(orderBefore.split(' ')[0])}).then(() => true)`)
      await ctx.wait(`!!document.querySelector('.tab-rail')`, 10_000, 'the tab sidebar to be shown again')
      // The preview shows the same groups, then Accept makes them; Undo restores the order.
      await ctx.click('button[aria-label="Tidy tabs"]')
      await ctx.wait(`document.querySelectorAll('.tidy-groups > li').length >= 2`, 20_000, 'the Tidy preview groups').catch(async (error) => {
        const sheet = await ctx.evaluate(`(document.querySelector('.tidy-sheet')?.innerText ?? ('no Tidy sheet on screen; button present: ' + !!document.querySelector('button[aria-label="Tidy tabs"]') + '; rail: ' + document.querySelector('.tab-rail')?.className + '; tabs: ' + document.querySelectorAll('[data-tab-id]').length)).slice(0, 300)`)
        await ctx.shot('tidy-missing')
        throw new CheckFailure(`${error.message} The sheet says: ${sheet}`)
      })
      await ctx.shot('tidy-preview')
      await axeAudit(ctx, 'the Tidy preview', '.tidy-sheet')
      // A suggested tab (not the one shown) closes while the preview is open: Accept moves the others, and says how many it moved.
      const shownId = (await tabs()).find((tab) => tab.active)?.id
      const closedMeanwhile = suggestion.groups.flatMap((group) => group.tabIds).find((id) => id !== shownId)
      await ctx.evaluate(`${host}.closeTab(${JSON.stringify(closedMeanwhile)}).then(() => true)`)
      await ctx.delay(500)
      const moved = suggestion.groups.reduce((n, group) => n + group.tabIds.length, 0) - 1
      await ctx.click('.tidy-accept')
      await ctx.wait(`window.intoponet.browserHost.getTabFolders().then((f) => f.length === ${suggestion.groups.length})`, 10_000, 'the accepted Tidy folders')
      const accepted = await tabs()
      expect(accepted.filter((tab) => tab.folderId).length === moved, 'Accepting did not move exactly the suggested tabs still open.')
      await ctx.wait(`[...document.querySelectorAll('.tab-rail-archived')].some((e) => e.textContent.includes(${JSON.stringify(`(${moved} ${moved === 1 ? 'tab' : 'tabs'})`)}))`, 3000, `the Tidy notice to count the ${moved} tabs it moved`).catch(async (error) => {
        throw new CheckFailure(`${error.message} The notice says: ${await ctx.evaluate(`[...document.querySelectorAll('.tab-rail-archived')].map((e) => e.textContent).join(' | ')`)}`)
      })
      expect(accepted.find((tab) => tab.id === c1.id)?.split?.partnerId === a1.id && !accepted.find((tab) => tab.id === c1.id)?.folderId, 'Accepting Tidy broke the pair side by side.')
      await ctx.click('.tab-rail-archived .tab-rail-undo')
      await ctx.wait(`window.intoponet.browserHost.getTabFolders().then((f) => f.length === 0)`, 10_000, 'Undo to remove the Tidy folders')
      expect((await tabs()).map((tab) => tab.id).join(' ') === orderBefore.split(' ').filter((id) => id !== closedMeanwhile).join(' '), 'Undo did not restore the tab order.')
      expect((await tabs()).find((tab) => tab.id === a1.id)?.split?.partnerId === c1.id, 'Undoing Tidy broke the pair side by side.')
      return `Laya off: Tidy explained it and offered Group by story. Laya on: ${suggestion.groups.length} groups (${suggestion.groups.map((group) => group.name).join('; ')}) separated cooking from astronomy and left a pair side by side alone; nothing moved before Accept; with a suggested tab closed meanwhile, Accept moved the rest and its notice counted ${moved}; Undo restored the order.`
    } finally {
      server.close()
    }
  },

  async WORKSPACE_IDENTITIES(ctx) {
    const server = await startIdentitySite()
    const base = `http://localhost:${server.address().port}`
    const host = 'window.intoponet.browserHost'
    const ws = 'window.intoponet.workspaces'
    const { stateOf, tabsOf, pageText, waitPage, showIn } = identityHelpers(ctx)
    const workspaceEntry = (state, id) => state.workspaces.find((item) => item.id === id)
    const askLocation = async (marker) => { void (await ctx.page(marker)).evaluate(`navigator.geolocation.getCurrentPosition(() => {}, () => {}); true`) }
    let mainId = ''
    let workId = ''
    try {
      // Main: signed in as ada.
      await openPage(ctx, `${base}/login?who=main`, 2500)
      await signIn(ctx, await ctx.page('who=main'), 'ada', 'Main-Pa55!')
      await waitPage('who=ada', 'Signed in as ada')
      mainId = (await stateOf()).activeId
      const certificateListeners = () => ctx.main(`electron.app.listenerCount('certificate-error')`)
      const listenersBefore = await certificateListeners()

      // A workspace of its own with separate sign-ins: it starts signed out, while Main stays signed in.
      const created = JSON.parse(await ctx.evaluate(`${ws}.create({ name: 'Work' }).then((s) => JSON.stringify(s))`))
      workId = created.activeId
      await ctx.evaluate(`${ws}.update(${JSON.stringify(workId)}, { separateSignIns: true }).then(() => true)`)
      expect(workspaceEntry(await stateOf(), workId)?.separateSignIns === true, 'Separate sign-ins did not turn on for Work.')
      await openPage(ctx, `${base}/?who=wstart`, 2500)
      await waitPage('who=wstart', 'Signed out')
      // Its session gets the same handlers, without one more listener on the app for each workspace.
      expect(await certificateListeners() === listenersBefore, `A workspace's own session added a certificate-error listener to the app (${listenersBefore} → ${await certificateListeners()}).`)

      // Work signs in as bob, and the sign-in is saved in Work.
      await openPage(ctx, `${base}/login?who=wlogin`, 2500)
      await signIn(ctx, await ctx.page('who=wlogin'), 'bob', 'Work-Pa55!')
      await waitPage('who=bob', 'Signed in as bob')
      await ctx.wait(`(document.querySelector('.password-bar')?.innerText ?? '').includes('Save password')`, 15_000, 'the Save password offer in Work')
      expect(await ctx.click('.password-bar button', 'Save'), 'The Work sign-in offer has no Save button.')
      await ctx.wait(`window.intoponet.passwords.list().then((l) => l.some((x) => x.username === 'bob' && x.workspaceId === ${JSON.stringify(workId)}))`, 10_000, 'the Work sign-in to be saved in Work')

      // Main: still signed in as ada, and its sign-in page does not offer Work's account.
      await showIn(mainId, 'who=ada')
      await openPage(ctx, `${base}/login?who=mlogin`, 2500)
      const [mainUser] = JSON.parse(await (await ctx.page('who=mlogin')).evaluate(`JSON.stringify([document.querySelector('#username')?.value ?? null])`))
      expect(mainUser === '', `Main's sign-in page filled in "${mainUser}", a sign-in saved in Work.`)
      await openPage(ctx, `${base}/?who=mhome`, 2500)
      await waitPage('who=mhome', 'Signed in as ada')

      // A location permission allowed in Main is asked again in Work.
      await showIn(mainId, 'who=mhome')
      await askLocation('who=mhome')
      await ctx.wait(`!!document.querySelector('[aria-label$="asks for permission"]')`, 15_000, 'the location prompt in Main')
      expect(await ctx.click('[aria-label$="asks for permission"] button', 'Allow'), `The location prompt in Main has no Allow button (bar: "${await ctx.evaluate("document.querySelector('.permission-bar')?.innerText ?? ''")}").`)
      await ctx.delay(800)
      await showIn(workId, 'who=bob')
      await askLocation('who=bob')
      await ctx.wait(`!!document.querySelector('[aria-label$="asks for permission"]')`, 15_000, 'the location prompt to be asked again in Work')
      const workAsk = await ctx.evaluate(`document.querySelector('[aria-label$="asks for permission"]')?.innerText ?? ''`)
      expect(workAsk.includes('remembered for this site in Work'), `The location prompt in Work does not say the answer is kept for Work: "${workAsk.replace(/\s+/g, ' ')}".`)
      expect(await ctx.click('[aria-label$="asks for permission"] button', 'Allow'), 'The location prompt in Work has no Allow button.')
      await ctx.delay(800)

      // Ad blocking runs in Work too: the ad on its page is stopped.
      await ctx.click('.shield-control > button')
      await ctx.delay(1000)
      const shield = await ctx.evaluate(`document.querySelector('.shield-bar')?.innerText ?? ''`)
      const stopped = Number(shield.match(/(\d+) tracker/)?.[1] ?? 0) + Number(shield.match(/(\d+) ad/)?.[1] ?? 0)
      expect(stopped > 0, `Nothing was blocked on Work's page: "${shield.replace(/\n+/g, ' · ')}".`)
      await ctx.click('.shield-control > button')
      await ctx.delay(500)

      // A download in Work is listed, and the file is saved.
      const link = JSON.parse(await (await ctx.page('who=bob')).evaluate(`JSON.stringify(document.querySelector('#get')?.getBoundingClientRect() ?? null)`))
      expect(link, "Work's page has no download link.")
      const workPage = await ctx.page('who=bob')
      for (const type of ['mousePressed', 'mouseReleased']) await workPage.send('Input.dispatchMouseEvent', { type, x: link.x + 5, y: link.y + 5, button: 'left', clickCount: 1 })
      await ctx.wait(`window.intoponet.downloads.list().then((l) => l.some((d) => d.filename === 'intoponet-e2e-identity.bin' && d.state === 'completed'))`, 30_000, 'the Work download to finish')
      const landed = join(ctx.profile, 'Downloads', 'intoponet-e2e-identity.bin')
      expect(existsSync(landed) && statSync(landed).size === 65536, `The Work download is not in ${landed}.`)

      // History names the workspace each visit was made in.
      const visits = JSON.parse(await ctx.evaluate(`window.intoponet.history.search('who=bob').then((r) => JSON.stringify(r.days.flatMap((d) => d.visits)))`))
      expect(visits.some((visit) => visit.workspaceId === workId && visit.url.includes('who=bob')), `History does not name Work for its visit: ${JSON.stringify(visits.map((visit) => [visit.url, visit.workspaceId ?? null]))}.`)

      // Main's sign-in page does not get Work's saved account; Work's does.
      await showIn(workId, 'who=bob')
      await openPage(ctx, `${base}/login?who=wcheck`, 2500)
      const [workUser] = JSON.parse(await (await ctx.page('who=wcheck')).evaluate(`JSON.stringify([document.querySelector('#username')?.value ?? null])`))
      expect(workUser === 'bob', `Work's sign-in page did not offer its saved account (it filled "${workUser}").`)

      // Clearing Work's data signs Work out and leaves Main signed in.
      await showIn(workId, 'who=bob')
      const connectionsBefore = new Set(server.connections)
      await ctx.evaluate(`${ws}.clearSignIns(${JSON.stringify(workId)}).then(() => true)`)
      await waitPage('who=bob', 'Signed out')
      await waitPage('who=mhome', 'Signed in as ada')
      // Work's next page comes on a new connection: the site cannot tie the signed-out pages to the signed-in ones.
      await openPage(ctx, `${base}/auth?who=wfresh`, 1500)
      const fresh = server.httpSignIns.find((entry) => entry.who === 'wfresh')
      expect(fresh && !connectionsBefore.has(fresh.connection), "After clearing Work's sign-ins, its next page came on a connection opened while it was signed in.")

      // A site's own sign-in box answered in Work is cleared too (its tab is closed first, so nothing reloads it with the password).
      await openPage(ctx, `${base.replace('http://', 'http://bob:Box-Pa55@')}/auth?who=wbox`, 1500)
      expect(server.httpSignIns.some((entry) => entry.who === 'wbox' && entry.sent), "Work's tab did not sign in to the site's own sign-in box.")
      for (const marker of ['who=wfresh', 'who=wbox']) {
        const tab = (await tabsOf()).find((item) => item.url.includes(marker))
        if (tab) await ctx.evaluate(`${host}.closeTab(${JSON.stringify(tab.id)}).then(() => true)`)
      }
      await showIn(workId, 'who=bob')
      await ctx.evaluate(`${ws}.clearSignIns(${JSON.stringify(workId)}).then(() => true)`)
      await waitPage('who=bob', 'Signed out')
      await openPage(ctx, `${base}/auth?who=wbox2`, 1500)
      expect(!server.httpSignIns.some((entry) => entry.who === 'wbox2' && entry.sent), "Clearing Work's sign-ins kept the password typed into a site's own sign-in box.")
      const boxAgain = (await tabsOf()).find((item) => item.url.includes('who=wbox2'))
      if (boxAgain) await ctx.evaluate(`${host}.closeTab(${JSON.stringify(boxAgain.id)}).then(() => true)`)

      // A tab moved from Main to Work warns first, and arrives signed out with its history.
      await showIn(mainId, 'who=ada')
      await (await ctx.page('who=ada')).evaluate(`location.href = '/?who=ada&step=2'; true`)
      await waitPage('step=2', 'Signed in as ada')
      await ctx.main(`(() => { const d = electron.dialog; globalThis.__moveAsks = []; globalThis.__realMessageBox = d.showMessageBox; d.showMessageBox = async (...args) => { globalThis.__moveAsks.push(String(args[args.length - 1].message)); return { response: 0 } }; return true })()`)
      const moving = (await tabsOf()).find((item) => item.url.includes('step=2'))
      expect(moving, 'The Main tab for the move is missing.')
      await ctx.evaluate(`${ws}.moveTab(${JSON.stringify(moving.id)}, ${JSON.stringify(workId)}).then(() => true)`)
      const asked = await ctx.main('globalThis.__moveAsks')
      await ctx.main(`(() => { electron.dialog.showMessageBox = globalThis.__realMessageBox; return true })()`)
      expect(asked.includes('This tab will reload signed out in Work'), `Moving the tab did not warn first (it asked: ${JSON.stringify(asked)}).`)
      await showIn(workId, 'step=2')
      await waitPage('step=2', 'Signed out')
      const kept = await ctx.main(`(() => { const page = electron.webContents.getAllWebContents().find((w) => w.getURL().includes('step=2')); return page ? page.navigationHistory.getActiveIndex() > 0 : false })()`)
      expect(kept, 'The moved tab kept no history to go back to.')

      // Work signs in again (as dan), and a private tab in Work uses the private session.
      await openPage(ctx, `${base}/login?who=dlogin`, 2500)
      await signIn(ctx, await ctx.page('who=dlogin'), 'dan', 'Work-Pa55!')
      await waitPage('who=dan', 'Signed in as dan')
      // A tab a Work page opens (a link clicked in it) is in Work, with Work's sign-ins.
      const dan = await ctx.page('who=dan')
      await dan.evaluate(`(() => { const a = document.createElement('a'); a.href = '/?who=popup'; a.target = '_blank'; a.id = 'popup'; a.textContent = 'Open'; document.body.append(a); return true })()`)
      const popupAt = JSON.parse(await dan.evaluate(`JSON.stringify(document.getElementById('popup').getBoundingClientRect())`))
      for (const type of ['mousePressed', 'mouseReleased']) await dan.send('Input.dispatchMouseEvent', { type, x: popupAt.x + 5, y: popupAt.y + 5, button: 'left', clickCount: 1 })
      await waitPage('who=popup', 'Signed in as dan')
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(true).then(() => true)`)
      await openPage(ctx, `${base}/?who=priv`, 2500)
      const privateSession = await ctx.main(`(() => { const page = electron.webContents.getAllWebContents().find((w) => w.getURL().includes('who=priv')); return page ? page.session === electron.session.fromPartition('intoponet-private') : null })()`)
      expect(privateSession === true, `A private tab in Work did not use the private session (${privateSession}; tabs: ${JSON.stringify((await tabsOf()).map((item) => [item.url, item.isPrivate]))}).`)
      await waitPage('who=priv', 'Signed out')
      const privateTab = (await tabsOf()).find((item) => item.url.includes('who=priv'))
      if (privateTab) await ctx.evaluate(`${host}.closeTab(${JSON.stringify(privateTab.id)}).then(() => true)`)
      await ctx.evaluate(`window.intoponet.privacy.setPrivateMode(false).then(() => true)`)
      await showIn(workId, 'who=dan')
      await waitPage('who=dan', 'Signed in as dan')

      // A link preview over the globe is Work's page: switching to Main closes it (Open as Tab would bring Work's sign-in into Main).
      await ctx.evaluate(`${host}.close().then(() => true)`)
      await ctx.evaluate(`${host}.previewLink(${JSON.stringify(`${base}/?who=preview`)}).then(() => true)`)
      await waitPage('who=preview', 'Signed in as dan')
      // Session parity: Main's pages, Work's own (its tabs and the preview) and every other page open get the same protections.
      const parity = await pageSessionProblems(ctx, { stubbed: ['who=preview'] })
      expect(parity.problems.length === 0 && parity.sessions >= 2, `Session parity with Work's own sign-ins: ${parity.problems.join(' ') || `only ${parity.sessions} session(s) were open`}`)
      await ctx.evaluate(`${ws}.switchTo({ id: ${JSON.stringify(mainId)} }).then(() => true)`)
      let previewLeft = true
      for (let i = 0; i < 12 && previewLeft; i += 1) {
        await ctx.delay(250)
        previewLeft = await ctx.main(`electron.webContents.getAllWebContents().some((w) => !w.isDestroyed() && w.getURL().includes('link-preview-card'))`)
      }
      expect(!previewLeft, "A link preview opened in Work stayed open after switching to Main, where Open as Tab would keep Work's sign-in.")
      await showIn(workId, 'who=dan')

      // A tab closed in Work and reopened while Main is shown comes back in Work, with Work's sign-ins (never Main's).
      const popupTab = (await tabsOf()).find((item) => item.url.includes('who=popup'))
      expect(popupTab, "Work's popup tab is missing.")
      await ctx.evaluate(`${host}.closeTab(${JSON.stringify(popupTab.id)}).then(() => true)`)
      await ctx.delay(500)
      await ctx.evaluate(`${ws}.switchTo({ id: ${JSON.stringify(mainId)} }).then(() => true)`)
      await ctx.delay(600)
      await ctx.evaluate(`${host}.reopenClosedTab().then(() => true)`)
      await ctx.wait(`${ws}.get().then((s) => s.activeId === ${JSON.stringify(workId)})`, 4000, 'reopening the closed tab to show Work, where it was closed')
      await waitPage('who=popup', 'Signed in as dan')
      const reopenedIn = await ctx.main(`(() => { const page = electron.webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().includes('who=popup')); return page ? page.session === electron.session.fromPartition(${JSON.stringify(`persist:intoponet-ws-${workId}`)}) : null })()`)
      expect(reopenedIn === true, `The tab reopened from Work is not in Work's session (${reopenedIn}).`)

      // A workspace with its own sign-ins deleted just before quitting (inside its Undo window) takes its sign-ins with it.
      const gone = JSON.parse(await ctx.evaluate(`${ws}.create({ name: 'Gone' }).then((s) => JSON.stringify(s))`)).activeId
      await ctx.evaluate(`${ws}.update(${JSON.stringify(gone)}, { separateSignIns: true }).then(() => true)`)
      await openPage(ctx, `${base}/?who=gone`, 300)
      await waitPage('who=gone', 'Signed out')
      await ctx.main(`electron.webContents.getAllWebContents().find((w) => w.getURL().includes('who=gone')).executeJavaScript("document.cookie = 'sid=gone; Max-Age=86400; Path=/'; true")`)
      expect(await ctx.main(`electron.session.fromPartition(${JSON.stringify(`persist:intoponet-ws-${gone}`)}).cookies.get({}).then((list) => list.length)`) === 1, 'The Gone workspace did not keep its own sign-in.')
      await ctx.evaluate(`${ws}.delete(${JSON.stringify(gone)}).then(() => true)`)
      expect((await stateOf()).activeId === workId, 'Deleting the Gone workspace did not go back to Work.')

      // Quit, then open a copy of the profile again: the option, Work's sign-in and permissions, and Main's sign-in are all kept.
      // The sign-ins are on disk before the quit (Chromium writes cookies a little after they are set).
      await ctx.main(`Promise.all([${JSON.stringify('persist:intoponet-default')}, ${JSON.stringify(`persist:intoponet-ws-${workId}`)}, ${JSON.stringify(`persist:intoponet-ws-${gone}`)}].map((name) => electron.session.fromPartition(name).cookies.flushStore())).then(() => true)`)
      await ctx.main('electron.app.quit()')
      // A quitting app waits for its debugger to disconnect before it exits.
      ctx.detachMain()
      await waitForQuit(ctx.profile)
      // The quit app has written its last files (its helpers outlive the main process for a moment).
      await new Promise((resolve) => setTimeout(resolve, 2500))
      // What a crash inside a deletion's Undo window leaves: a workspace's partition folder and permission answers, with no workspace.
      mkdirSync(join(ctx.profile, 'Partitions', 'intoponet-ws-crashed-e2e'), { recursive: true })
      writeFileSync(join(ctx.profile, 'Partitions', 'intoponet-ws-crashed-e2e', 'Cookies'), 'left behind')
      writeFileSync(join(ctx.profile, 'site-permissions.ws-crashed-e2e.json'), '{}')
      writeFileSync(join(ctx.profile, 'external-apps.ws-crashed-e2e.json'), '{"http://localhost":["mailto"]}')
      expect(existsSync(join(ctx.profile, 'Partitions', `intoponet-ws-${gone}`)) && existsSync(join(ctx.profile, 'Partitions', `intoponet-ws-${workId}`)), 'The Gone and Work partition folders are not where the relaunch check looks for them.')
      const before = process.env.E2E_PROFILE
      process.env.E2E_PROFILE = ctx.profile
      try {
        return await runAppCheck((again) => identityRelaunch(again, { workId, mainId, gone }), { timeoutMs: 120_000 }) || 'Separate sign-ins: isolated in Work, asked again, ad blocked, download listed, history named, cleared, moved with a warning, private session, kept across a relaunch.'
      } finally {
        if (before === undefined) delete process.env.E2E_PROFILE
        else process.env.E2E_PROFILE = before
      }
    } finally {
      server.close()
    }
  },
}

// Quality checks only: what the Tidy model was given, one JSON line per suggestion (see tabTidy in the app).
const TIDY_DEBUG_FILE = join(tmpdir(), `intoponet-tidy-e2e-${process.pid}.jsonl`)

checks.TAB_SLEEP.env = { INTOPONET_TAB_SLEEP_MINUTE_MS: '200' }
checks.TAB_ARCHIVE.env = { INTOPONET_TAB_ARCHIVE_HOUR_MS: '200' }
checks.BROWSER_IMPORT.env = { INTOPONET_IMPORT_ROOT: IMPORT_ROOT, INTOPONET_IMPORT_TEST_KEY: IMPORT_TEST_KEY }
checks.IMPORT_WORKSPACES.env = { INTOPONET_IMPORT_ROOT: IMPORT_WS_ROOT, INTOPONET_IMPORT_TEST_KEY: IMPORT_TEST_KEY }
checks.AUTO_PIP.env = { INTOPONET_TAB_SLEEP_MINUTE_MS: '200', INTOPONET_TAB_ARCHIVE_HOUR_MS: '200' }
checks.TAB_TIDY_LOCAL.env = { INTOPONET_TIDY_DEBUG: TIDY_DEBUG_FILE }
