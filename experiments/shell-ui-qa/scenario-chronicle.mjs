// World list scrolls; a world story's history shows "How we got here".
export default async function ({ evaluate, shotApp, delay, send }) {
  const wait = async (expr, ms = 90_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await evaluate(expr).catch(() => false)) return true; await delay(800) } return false }
  await wait(`window.intoponet.browserHost.getNewsDigest().then((raw) => !!raw && JSON.parse(raw).countries.length > 150)`, 300_000)
  await delay(1500)
  await evaluate(`[...document.querySelectorAll('.globe-tabs button')].find((b) => b.innerText.includes('World')).click(); true`)
  await wait(`document.querySelectorAll('.world-list > li').length > 4`, 60_000)
  const scroll = await evaluate(`(() => { const el = document.querySelector('.globe-panel .world-stories'); const before = el.scrollTop; el.scrollTop = 600; return JSON.stringify({ client: el.clientHeight, scroll: el.scrollHeight, moved: el.scrollTop - before, stories: document.querySelectorAll('.world-list > li').length }) })()`)
  console.log('world list:', scroll)
  await evaluate(`document.querySelector('.globe-panel .world-stories').scrollTop = 0; true`)
  const titles = await evaluate(`[...document.querySelectorAll('.world-list > li .world-row strong')].map((s) => s.innerText)`)
  const index = Math.max(0, titles.findIndex((t) => /Netanyahu|trial|verdict|court|election/i.test(t)))
  console.log('story:', titles[index])
  await evaluate(`document.querySelectorAll('.world-list > li .world-row')[${index}].click(); true`)
  await delay(800)
  await evaluate(`document.querySelectorAll('.world-list > li')[${index}].querySelector('.globe-history-button').click(); true`)
  await wait(`!!document.querySelector('.olds-chronicle') || (!!document.querySelector('.olds-sheet h2') && !document.querySelector('.olds-status .olds-spin'))`, 150_000)
  await delay(1500)
  console.log('topic:', await evaluate(`document.querySelector('.olds-sheet h2')?.innerText`), '| chronicle:', await evaluate(`document.querySelectorAll('.olds-chronicle li').length`), '| related:', await evaluate(`[...document.querySelectorAll('.olds-related-card strong')].map((s) => s.innerText).join(' | ') || 'none'`))
  await shotApp('olds-chronicle')
  await evaluate(`document.querySelector('.olds-story').scrollTop = 99999; true`)
  await delay(500)
  await shotApp('olds-chronicle-end')
}
