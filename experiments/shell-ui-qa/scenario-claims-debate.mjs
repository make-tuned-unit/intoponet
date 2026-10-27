// Claims (ABS-004) on absorbed pages, and the Olds Debate view (OLD-005).
export default async function ({ evaluate, shotApp, delay }) {
  const wait = async (expr, ms = 60_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await evaluate(expr).catch(() => false)) return true; await delay(700) } return false }
  await delay(3000)
  for (const url of ['https://en.wikipedia.org/wiki/Industrial_Revolution', 'https://en.wikipedia.org/wiki/Climate_change', 'https://science.nasa.gov/climate-change/evidence/']) {
    await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: ${JSON.stringify(url)} }); true`)
    await delay(8000)
    const result = await evaluate(`window.intoponet.knowledge.preview('article').then((p) => p.refused ? 'refused: ' + p.reason : window.intoponet.knowledge.commit(p.previewId, {}).then((r) => 'absorbed ' + r.title))`)
    console.log(url, '→', result)
  }
  const records = JSON.parse(await evaluate(`window.intoponet.knowledge.list().then((l) => JSON.stringify(l.map((r) => ({ id: r.id, title: r.title }))))`))
  for (const record of records) {
    const claims = JSON.parse(await evaluate(`window.intoponet.knowledge.claims(${JSON.stringify(record.id)}).then((c) => JSON.stringify(c))`))
    const counts = claims.reduce((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {})
    console.log(record.title, JSON.stringify(counts))
    for (const c of claims.filter((c) => c.status !== 'stated').slice(0, 3)) console.log('   ', c.status, '|', c.text.slice(0, 110), '|', c.evidence.map((e) => e.site + ' ' + e.relation).join(', '))
    const stated = claims.find((c) => c.attributedTo)
    if (stated) console.log('    attributed:', stated.attributedTo, '|', stated.text.slice(0, 90))
  }
  await evaluate(`window.intoponet.browserHost.close(); true`)
  await delay(800)
  await evaluate(`[...document.querySelectorAll('.bookmark-library-button')].find((b) => b.innerText.includes('Knowledge')).click(); true`)
  await delay(1500)
  const target = records.find((r) => /Climate/i.test(r.title)) ?? records[0]
  await evaluate(`[...document.querySelectorAll('.knowledge-sheet button, .knowledge-sheet li button')].find((b) => b.innerText.includes(${JSON.stringify(target.title.slice(0, 20))}))?.click(); true`)
  await wait(`!!document.querySelector('.knowledge-claims')`, 15_000)
  await shotApp('knowledge-claims')
  const ir = records.find((r) => /Industrial/i.test(r.title))
  if (ir) {
    await evaluate(`[...document.querySelectorAll('.knowledge-sheet button, .knowledge-sheet li button')].find((b) => b.innerText.includes('Industrial Revolution'))?.click(); true`)
    await delay(1500)
    await evaluate(`document.querySelector('[aria-label="The Olds: history of this topic"]')?.click(); true`)
    await wait(`[...document.querySelectorAll('.olds-views button')].some((b) => b.innerText.includes('Debate'))`, 60_000)
    await evaluate(`[...document.querySelectorAll('.olds-views button')].find((b) => b.innerText.includes('Debate')).click(); true`)
    await delay(1000)
    console.log('debate', await evaluate(`[...document.querySelectorAll('.olds-debate-card strong')].map((s) => s.innerText).join(' | ')`))
    await shotApp('olds-debate')
  }
}
