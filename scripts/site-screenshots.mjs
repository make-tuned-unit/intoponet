// The website's screenshots of the app, taken from the built app on a fresh, empty profile.
//
//   node scripts/site-screenshots.mjs                 all seven scenes
//   node scripts/site-screenshots.mjs peaks,olds      only these
//
// Each scene starts the app by itself (so one that fails can be run again alone), stages what it shows, and
// photographs the window as macOS draws it: 1440×940 points at 2×, web pages included. The PNGs go to a
// scratch folder (SHOTS_DIR, or the system's temporary folder); cwebp then writes <name>-1200.webp and
// <name>-2400.webp to website/assets/app/<version>/. The app comes to the front while it runs, and the
// screen must be unlocked. Scenes 1–3 show that day's news; SHOT_STORY=2 starts from the third story
// instead of the first when the first does not photograph well. Look at every picture before using it.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runAppCheck } from '../experiments/e2e/lib.mjs'

process.env.E2E_BEHIND_PAGE = 'off'
const repo = resolve(import.meta.dirname, '..')
const version = JSON.parse(readFileSync(join(repo, 'apps/desktop/package.json'), 'utf8')).version
// 0.1.26 → website/assets/app/0126
const [major, minor, patch] = version.split('.')
const outDir = join(repo, 'website/assets/app', `${major}${minor}${patch.padStart(2, '0')}`)
const pngDir = process.env.SHOTS_DIR ?? join(tmpdir(), 'intoponet-site-screenshots')
const cwebp = ['/opt/homebrew/bin/cwebp', '/usr/local/bin/cwebp'].find(existsSync) ?? 'cwebp'
const firstStory = Number(process.env.SHOT_STORY ?? 0)
const host = 'window.intoponet.browserHost'
const ws = 'window.intoponet.workspaces'
const wiki = (title) => `https://en.wikipedia.org/wiki/${title}`
const json = (ctx, expression) => ctx.evaluate(`Promise.resolve(${expression}).then((value) => JSON.stringify(value))`).then(JSON.parse)
const say = (name, facts) => console.log(`${name}: ${typeof facts === 'string' ? facts : JSON.stringify(facts)}`)

/** The window at the size of the pictures, before anything is laid out in it. */
const sizeWindow = (ctx) => ctx.main(`(() => { const win = electron.BrowserWindow.getAllWindows()[0]; const area = electron.screen.getPrimaryDisplay().workArea; win.setBounds({ x: area.x + 20, y: area.y + 10, width: 1440, height: 940 }); return true })()`)

/** Opens a page in a new tab and waits until it has loaded; answers the tab's id. */
const openPage = async (ctx, url) => {
  await ctx.evaluate(`${host}.open({ kind: 'url', value: ${JSON.stringify(url)} }).then(() => true)`)
  await ctx.wait(`${host}.getTabs().then((tabs) => tabs.some((tab) => tab.active && tab.url === ${JSON.stringify(url)} && !tab.loading && !/^(New tab|Loading)/.test(tab.title)))`, 60_000, `${url} to load`)
  return (await json(ctx, `${host}.getTabs()`)).find((tab) => tab.active).id
}

/** Wikipedia's fundraising and site notices are taken off its pages: they would cover the article. */
const tidyWikipedia = (ctx) => ctx.main(`Promise.all(electron.webContents.getAllWebContents().filter((page) => page.getURL().includes('wikipedia.org')).map((page) => page.insertCSS('#siteNotice, #centralNotice, .cn-fundraising, #frb-inline, .frb { display: none !important }'))).then(() => true)`)

/** Photographs the window (the system's own capture, so the pages above the window are in it) and encodes it. */
const snap = async (ctx, name) => {
  mkdirSync(pngDir, { recursive: true })
  mkdirSync(outDir, { recursive: true })
  await tidyWikipedia(ctx)
  await ctx.main(`(() => { electron.app.focus({ steal: true }); electron.BrowserWindow.getAllWindows()[0].focus(); return true })()`)
  await ctx.delay(1500)
  const id = (await ctx.main(`electron.BrowserWindow.getAllWindows()[0].getMediaSourceId()`)).split(':')[1]
  const png = join(pngDir, `${name}.png`)
  execFileSync('/usr/sbin/screencapture', ['-x', '-o', '-l', id, png])
  for (const width of [1200, 2400]) execFileSync(cwebp, ['-quiet', '-q', '82', '-resize', String(width), '0', png, '-o', join(outDir, `${name}-${width}.webp`)])
}

/** The day's news, read in full: the digest has stopped growing for half a minute. */
const settledNews = async (ctx) => {
  await ctx.waitForNews()
  await ctx.wait(`${host}.getNewsDigest().then((raw) => (JSON.parse(raw).mountains ?? []).length >= 5)`, 180_000, 'story mountains in the news')
  let last = ''
  for (let same = 0, i = 0; same < 3 && i < 30; i += 1) {
    await ctx.delay(10_000)
    const now = await ctx.evaluate(`${host}.getNewsDigest().then((raw) => { const d = JSON.parse(raw); return [d.countries.length, d.global.length, d.mountains.length, d.mountains[0]?.outlets].join() })`)
    same = now === last ? same + 1 : 0
    last = now
  }
  return JSON.parse(await ctx.evaluate(`${host}.getNewsDigest()`))
}

/** The tab sidebar kept open at its full width. */
const openSidebar = async (ctx) => {
  await ctx.click('button[aria-label="Pin tabs open"]')
  await ctx.wait(`!!document.querySelector('.tab-rail.is-pinned')`, 5000, 'the tab sidebar')
  await ctx.evaluate(`${host}.setTabRailExpanded(true).then(() => true)`)
  await ctx.delay(800)
}

const scenes = {
  // 1. The globe with the day's highest story mountain pinned, and Highlights on Peaks.
  async peaks(ctx) {
    const digest = await settledNews(ctx)
    await ctx.click('.globe-tabs button', 'Peaks')
    await ctx.wait(`document.querySelectorAll('.story-peak-list .story-peak-row').length >= 5`, 20_000, 'the peaks list')
    await ctx.wait(`!!document.querySelector('.story-highest')`, 30_000, 'the highest-peak control')
    await ctx.click('.story-highest')
    await ctx.wait(`!!document.querySelector('.story-panel h2')`, 10_000, 'the pinned story')
    await ctx.delay(7000) // the globe turns to the story and its strands are drawn
    const top = digest.mountains[0]
    say('peaks', { title: top.label ?? top.title, headline: top.title, outlets: top.outlets, home: top.homeOutlets, countries: top.countries.map((c) => c.name ?? c.countryCode), panel: await ctx.evaluate(`document.querySelector('.story-panel').innerText.slice(0, 700)`), peaks: await ctx.evaluate(`[...document.querySelectorAll('.story-peak-row strong')].slice(0, 5).map((el) => el.textContent)`) })
    await snap(ctx, 'peaks')
  },

  // 2. The Olds on a story in the news: the first one with a dated subject and a real "How we got here".
  async olds(ctx) {
    await settledNews(ctx)
    await ctx.click('.globe-tabs button', 'World')
    await ctx.wait(`document.querySelectorAll('.world-list > li').length >= 5`, 90_000, 'world stories')
    const stories = await ctx.evaluate(`document.querySelectorAll('.world-list > li').length`)
    for (let i = firstStory; i < Math.min(stories, firstStory + 10); i += 1) {
      const row = `document.querySelectorAll('.world-list > li')[${i}]`
      const title = await ctx.evaluate(`${row}?.querySelector('.world-row strong')?.innerText ?? ''`)
      if (!title) continue
      const probe = await json(ctx, `window.intoponet.olds.thread({ kind: 'headline', text: ${JSON.stringify(title)} }).then((t) => ({ root: t.nodes.find((n) => n.id === t.rootId), events: (t.chronicle ?? []).length }), () => null)`)
      console.log(`olds candidate ${i}: “${title}” → ${probe?.root?.label} (${probe?.root?.start ? 'dated' : 'undated'}, ${probe?.events} events)`)
      if (!probe?.root?.start || probe.events < 5) continue
      await ctx.evaluate(`(() => { const li = ${row}; if (!li.classList.contains('is-open')) li.querySelector('.world-expand')?.click(); return true })()`)
      await ctx.delay(800)
      if (!(await ctx.evaluate(`(() => { const b = ${row}.querySelector('.headline-history'); if (!b) return false; b.click(); return true })()`))) continue
      await ctx.wait(`!!document.querySelector('.olds-sheet h2') && !document.querySelector('.olds-status .olds-spin')`, 180_000, 'The Olds to open')
      await ctx.delay(2500)
      await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 80 })
      say('olds', { story: title, sheet: await ctx.evaluate(`document.querySelector('.olds-sheet').innerText.slice(0, 1500)`) })
      await snap(ctx, 'olds')
      return
    }
    throw new Error('No story in the news has a dated history to show.')
  },

  // 3. Two outlets' articles on one story, side by side.
  async compare(ctx) {
    await settledNews(ctx)
    await ctx.click('.globe-tabs button', 'World')
    await ctx.wait(`document.querySelectorAll('.world-list .world-row').length > 0`, 90_000, 'world stories')
    const stories = await ctx.evaluate(`document.querySelectorAll('.world-list > li').length`)
    let ready = false
    for (let i = firstStory; i < stories && !ready; i += 1) {
      const row = `document.querySelectorAll('.world-list > li')[${i}]`
      await ctx.evaluate(`(() => { ${row}?.querySelector('.world-expand')?.click(); return true })()`)
      await ctx.delay(600)
      if (!(await ctx.evaluate(`(() => { const b = ${row}?.querySelector('.world-sources-button'); if (!b) return false; b.click(); return true })()`))) continue
      await ctx.wait(`document.querySelectorAll('.sc-card').length >= 2`, 10_000, 'the sources of the story')
      ready = await ctx.evaluate(`!!document.querySelector('.sc-compare')`)
      if (!ready) { await ctx.click('.sc-close'); await ctx.wait(`!document.querySelector('.sources-carousel')`, 8000, 'the sources to close') }
    }
    if (!ready) throw new Error('No story has two outlets to compare.')
    await ctx.click('.sc-compare')
    await ctx.wait(`!!document.querySelector('.sc-chooser-item.is-preselected')`, 8000, 'the Compare chooser')
    const pick = Number(process.env.SHOT_OUTLET ?? -1)
    await ctx.evaluate(`(() => { (document.querySelectorAll('.sc-chooser-item')[${pick}] ?? document.querySelector('.sc-chooser-item.is-preselected')).click(); return true })()`)
    await ctx.wait(`${host}.getState().then((s) => !!s.split?.left?.compare && !!s.split?.right?.compare)`, 30_000, 'the two articles side by side')
    await ctx.wait(`${host}.getTabs().then((tabs) => tabs.filter((tab) => tab.loading).length === 0)`, 90_000, 'both articles to load').catch(() => undefined)
    await ctx.delay(8000)
    const split = (await json(ctx, `${host}.getState()`)).split
    say('compare', { left: [split.left.compare, split.left.title, split.left.url], right: [split.right.compare, split.right.title, split.right.url], headers: await ctx.evaluate(`[...document.querySelectorAll('.split-header')].map((h) => h.innerText.replace(/\\s+/g, ' '))`) })
    await snap(ctx, 'compare')
  },

  // 4. Workspaces in the tab sidebar: a folder of tabs, and two pages side by side.
  async workspaces(ctx) {
    const main = (await json(ctx, `${ws}.get()`)).activeId
    await ctx.evaluate(`${ws}.update(${JSON.stringify(main)}, { name: 'Reading', icon: 'book', accent: 'teal' }).then(() => true)`)
    await ctx.evaluate(`${ws}.create({ name: 'Lisbon trip', icon: 'plane', accent: 'coral' }).then(() => true)`)
    for (const title of ['Lisbon', 'Bel%C3%A9m_Tower']) await openPage(ctx, wiki(title))
    await ctx.evaluate(`${ws}.create({ name: 'Work', icon: 'briefcase', accent: 'violet' }).then(() => true)`)
    await ctx.evaluate(`${ws}.switchTo({ id: ${JSON.stringify(main)} }).then(() => true)`)
    const folder = []
    for (const title of ['Ocean_current', 'Gulf_Stream', 'Thermohaline_circulation']) folder.push(await openPage(ctx, wiki(title)))
    await ctx.evaluate(`${host}.createTabFolder('Ocean research', null, ${JSON.stringify(folder)}).then(() => true)`)
    const map = await openPage(ctx, wiki('Map'))
    const atlantic = await openPage(ctx, wiki('Atlantic_Ocean'))
    await openSidebar(ctx)
    await ctx.evaluate(`${host}.splitTab(${JSON.stringify(atlantic)}, ${JSON.stringify(map)}, 'left').then(() => true)`)
    await ctx.delay(5000)
    say('workspaces', { workspaces: (await json(ctx, `${ws}.get()`)).workspaces.map((w) => w.name), tabs: (await json(ctx, `${host}.getTabs()`)).map((tab) => tab.title), folders: (await json(ctx, `${host}.getTabFolders()`)).map((f) => f.name) })
    await snap(ctx, 'workspaces')
  },

  // 5. A link's page shown in a card over the page it is on.
  async 'link-preview'(ctx) {
    for (const title of ['Bel%C3%A9m_Tower', 'Pastel_de_nata', 'Lisbon']) await openPage(ctx, wiki(title))
    await openSidebar(ctx)
    await ctx.evaluate(`${host}.previewLink(${JSON.stringify(wiki('Jer%C3%B3nimos_Monastery'))}).then(() => true)`)
    for (let i = 0; i < 60 && !(await ctx.main(`electron.webContents.getAllWebContents().some((page) => page.getURL().includes('nimos_Monastery') && !page.isLoading())`)); i += 1) await ctx.delay(500)
    await ctx.delay(4000)
    say('link-preview', { tabs: (await json(ctx, `${host}.getTabs()`)).map((tab) => tab.title), card: 'Jerónimos Monastery' })
    await snap(ctx, 'link-preview')
  },

  // 6. "Customize <site>": the panel that changes how one site looks.
  async 'site-tweaks'(ctx) {
    for (const title of ['Bel%C3%A9m_Tower', 'Pastel_de_nata', 'Lisbon']) await openPage(ctx, wiki(title))
    await openSidebar(ctx)
    await ctx.click('.shield-control > button')
    await ctx.wait(`!!document.querySelector('.shield-bar')`, 5000, 'the protection bar')
    await ctx.click('.shield-bar-toggle', 'Customize site')
    await ctx.wait(`!!document.querySelector('#site-tweaks-title')`, 8000, 'the Customize site panel')
    for (const choice of (process.env.SHOT_TWEAKS ?? 'Serif').split(',').filter(Boolean)) { await ctx.click('.site-tweaks button', choice); await ctx.delay(700) }
    await ctx.delay(2500)
    say('site-tweaks', await ctx.evaluate(`document.querySelector('#site-tweaks-panel').innerText.replace(/\\s+/g, ' ')`))
    await snap(ctx, 'site-tweaks')
  },

  // 7. The Bookmarks pane over the globe, with a few groups of saved pages.
  async bookmarks(ctx) {
    const savedAt = new Date().toISOString()
    const groups = {
      'Ocean research': [['Gulf Stream', wiki('Gulf_Stream')], ['Thermohaline circulation', wiki('Thermohaline_circulation')], ['Ocean current', wiki('Ocean_current')]],
      'Lisbon trip': [['Alfama', wiki('Alfama')], ['Belém Tower', wiki('Bel%C3%A9m_Tower')], ['Sintra', wiki('Sintra')]],
      Reading: [['Aurora', wiki('Aurora')], ['History of cartography', wiki('History_of_cartography')]],
    }
    const library = {
      schema: 'intoponet.private-library.v1', recents: [], absorbed: [],
      bookmarks: Object.entries(groups).flatMap(([topic, pages]) => pages.map(([title, url]) => ({ url, title, topic, savedAt }))),
      collections: Object.entries(groups).map(([label, pages], i) => ({ id: `group-${i + 1}`, label, createdAt: savedAt, memberUrls: pages.map(([, url]) => url) })),
    }
    // The library is written, then the window reads it again as it does when the app starts.
    await ctx.evaluate(`${host}.writePrivateLibrary(${JSON.stringify(JSON.stringify(library))}).then(() => { location.reload(); return true })`).catch(() => undefined)
    await ctx.delay(4000)
    await ctx.wait(`!!document.querySelector('.topbar') && !!document.querySelector('canvas')`, 45_000, 'the window again')
    await settledNews(ctx)
    await ctx.click('.bookmark-library-button', 'Bookmarks')
    await ctx.wait(`document.querySelectorAll('.bm-group').length >= 3`, 10_000, 'the bookmark groups')
    await ctx.delay(3000)
    say('bookmarks', await ctx.evaluate(`[...document.querySelectorAll('.bm-group')].map((g) => g.innerText.replace(/\\s+/g, ' '))`))
    await snap(ctx, 'bookmarks')
  },
}

const wanted = process.argv[2] ? process.argv[2].split(',') : Object.keys(scenes)
const unknown = wanted.filter((name) => !scenes[name])
if (unknown.length) { console.error(`No such scene: ${unknown.join(', ')}. Scenes: ${Object.keys(scenes).join(', ')}`); process.exit(2) }
let failed = 0
for (const name of wanted) {
  try {
    await runAppCheck(async (ctx) => { await sizeWindow(ctx); await ctx.delay(500); await scenes[name](ctx) }, { name, timeoutMs: 900_000 })
    console.log(`${name}: saved to ${join('website/assets/app', outDir.split('/').pop())}`)
  } catch (error) {
    failed += 1
    console.error(`${name}: FAILED — ${error.message}`)
  }
}
process.exit(failed ? 1 : 0)
