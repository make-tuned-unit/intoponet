// Public app API and rendered timeline checks after building the desktop app.
import { writeFileSync } from 'node:fs'
import { expect, runAppCheck } from './lib.mjs'

console.log(await runAppCheck(async (ctx) => {
  const cases = [
    { title: '2026 Israeli legislative election', before: 1970 },
    { title: '2026 Ebola epidemic', before: 1980 },
  ]
  const results = []
  for (const item of cases) {
    const thread = await ctx.evaluate(`window.intoponet.olds.thread(${JSON.stringify({ kind: 'wikipedia', title: item.title })})`)
    const added = (thread.chronicle ?? []).filter((entry) => entry.sourceTitle)
    expect((thread.chronicle ?? []).some((entry) => Number(entry.at.iso.slice(0, 4)) < item.before), `${item.title} has no older sourced context.`)
    expect(added.every((entry) => entry.url.startsWith('https://en.wikipedia.org/wiki/')), 'Historical context lost its source links.')
    results.push({ title: item.title, note: thread.historyNote, added, chronicle: thread.chronicle })
  }
  writeFileSync('experiments/e2e/results/history-context-live.json', JSON.stringify(results, null, 2))
  await ctx.waitForNews()
  await ctx.click('.globe-tabs button', 'World')
  await ctx.wait(`[...document.querySelectorAll('.world-row')].some((b) => /Israel.*election|election.*Israel/i.test(b.innerText))`, 60_000, 'Israeli election world story')
  await ctx.evaluate(`[...document.querySelectorAll('.world-row')].find((b) => /Israel.*election|election.*Israel/i.test(b.innerText)).click(); true`)
  await ctx.click('.world-detail .globe-history-button')
  await ctx.wait(`!!document.querySelector('.olds-sheet h2') && !document.querySelector('.olds-status .olds-spin')`, 180_000, 'history for election headline')
  await ctx.click('.olds-views button', 'Timeline')
  await ctx.delay(1000)
  await ctx.click('.olds-edge.is-left')
  await ctx.wait(`document.querySelector('.olds-track')?.scrollLeft < 1`, 10_000, 'earliest timeline position')
  const years = await ctx.evaluate(`[...document.querySelectorAll('.olds-item.is-event')].map((e) => Number(e.dataset.year))`)
  expect(years.some((year) => year < 1970), 'Rendered election timeline omits older context.')
  expect(await ctx.evaluate(`document.querySelector('.olds-history-note')?.textContent.includes('selected passages')`), 'Timeline does not explain the scope of historical context.')
  await ctx.shot('election-timeline')
  const clipped = await ctx.evaluate(`(() => { const t = document.querySelector('.olds-track').getBoundingClientRect(); return [...document.querySelectorAll('.olds-card')].filter((c) => { const r = c.getBoundingClientRect(); return r.top < t.top - 1 || r.bottom > t.bottom + 1 }).length })()`)
  expect(clipped === 0, `${clipped} timeline cards are clipped.`)
  return `PASS: sourced older context for Israel and Ebola; election timeline renders ${Math.floor(Math.min(...years))} onward; no vertical clipping.`
}, { evidenceDir: 'experiments/e2e/evidence/history-context', name: 'history', timeoutMs: 600_000 }))
