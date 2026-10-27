// Old plain-text library migrates into the encrypted file; Import merges an export; tags show.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
export default async function ({ evaluate, shotApp, delay, send, profile }) {
  await delay(3000)
  await evaluate(`(() => { localStorage.setItem('intoponet.bookmarks.v1', JSON.stringify([{ url: 'https://en.wikipedia.org/wiki/Vanuatu', title: 'Vanuatu', topic: 'Pacific', savedAt: '2026-01-01T00:00:00Z' }])); localStorage.setItem('intoponet.recents.v1', '[]'); location.reload(); return true })()`).catch(() => undefined)
  await delay(5000)
  console.log('plain copy left', await evaluate(`['intoponet.bookmarks.v1','intoponet.collections.v1','intoponet.recents.v1'].filter((k) => localStorage.getItem(k) !== null).join(',') || 'none'`))
  console.log('encrypted file', existsSync(join(profile, 'private-library.v1.seal')))
  const lib = await evaluate(`window.intoponet.browserHost.readPrivateLibrary().then((r) => r.status === 'ok' ? JSON.parse(r.payload).bookmarks.map((b) => b.title).join(',') : r.reason)`)
  console.log('in encrypted library', lib)
  await evaluate(`[...document.querySelectorAll('.bookmark-library-button')].find((b) => b.innerText.includes('My map')).click(); true`)
  await delay(1200)
  const { root } = await send('DOM.getDocument', {})
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '.library-import input' })
  await send('DOM.setFileInputFiles', { nodeId, files: ['/private/tmp/claude-501/-Users-j-Documents-dev-Intoponet/f492926f-c0f1-467f-9f6c-13ab767d098e/scratchpad/import-sample.json'] })
  await delay(1500)
  console.log('notice', await evaluate(`document.querySelector('.notice, [role=status]')?.innerText ?? ''`))
  console.log('rows', await evaluate(`[...document.querySelectorAll('.bookmark-item .bookmark-destination')].map((b) => b.innerText.replace(/\\n/g, ' / ')).join(' || ')`))
  await shotApp('library-import')
}
