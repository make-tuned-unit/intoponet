// Full-screen toolbar auto-hide + "more" tools + Finder folders per group.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const now = '2026-10-26T12:00:00.000Z'
const collections = [{ id: 'research', label: 'Research', createdAt: now, memberUrls: [] }]
const tree = (root) => Object.fromEntries(readdirSync(root).map((dir) => [dir, readdirSync(join(root, dir))]))

export default async function ({ evaluate, shot, click, delay, profile }) {
  const root = join(profile, 'Pictures', 'Intoponet')
  await delay(2500)
  await evaluate(`localStorage.setItem('intoponet.bookmark-pane.open.v1', '0');
    localStorage.setItem('intoponet.capture-group.v1', 'research');
    window.intoponet.browserHost.writePrivateLibrary(${JSON.stringify(JSON.stringify({ schema: 'intoponet.private-library.v1', bookmarks: [], collections, recents: [], absorbed: [] }))}).then(() => { location.reload(); return true })`)
  await delay(3500)
  await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'https://en.wikipedia.org/wiki/Aurora' }).then(() => true)`)
  await delay(4500)
  await shot('h0-panel-toolbar')
  await evaluate(`document.querySelector('.chrome-more').dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); true`)
  await delay(600)
  await shot('h1-panel-more-tools')
  await click('[aria-label="Full width"]')
  await delay(1200)
  await evaluate(`document.querySelector('.chrome-more').dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body })); true`)
  await delay(200)
  // Simulate the pointer entering the page: renderer gets chrome-state from main in real use.
  await evaluate(`document.querySelector('.browser-chrome').dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body })); true`)
  await delay(700)
  await shot('h2-fullscreen-tucked')
  await evaluate(`document.querySelector('.browser-chrome').dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); true`)
  await delay(120)
  await shot('h3-fullscreen-revealing')
  await delay(500)
  await shot('h4-fullscreen-revealed')
  await click('[aria-label="Capture this page: screenshot or recording"]')
  await delay(900)
  await click('.cap-primary')
  await delay(1500)
  console.log('folders after capture:', JSON.stringify(tree(root)))
  await evaluate(`window.intoponet.browserHost.writePrivateLibrary(${JSON.stringify(JSON.stringify({ schema: 'intoponet.private-library.v1', bookmarks: [], collections: [{ ...collections[0], label: 'Demo assets' }], recents: [], absorbed: [] }))}).then(() => { location.reload(); return true })`)
  await delay(4000)
  console.log('folders after rename:', JSON.stringify(tree(root)))
  console.log('records:', await evaluate(`window.intoponet.captures.list().then((r) => JSON.stringify(r.map(({ fileName, groupId }) => ({ fileName, groupId }))))`))
}
