// World: stories covered across many countries, and Wikipedia In the news.
export default async function ({ evaluate, shotApp: shot, delay }) {
  const wait = async (expr, ms = 60_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await evaluate(expr)) return true; await delay(1500) }
    return false
  }
  const ok = await wait(`window.intoponet.browserHost.getNewsDigest().then((raw) => !!raw && (JSON.parse(raw).global ?? []).length >= 5 && JSON.parse(raw).healthyFeedCount > 200)`, 420_000)
  const summary = await evaluate(`window.intoponet.browserHost.getNewsDigest().then((raw) => { const d = JSON.parse(raw); return { feeds: d.feedCount, healthy: d.healthyFeedCount, countries: d.countries.length, global: (d.global ?? []).slice(0, 12).map((s) => s.countries.length + 'c/' + s.outletCount + 'o/' + s.internationalDesks + 'd [' + s.terms.join(',') + '] ' + s.title), itn: (d.inTheNews ?? []).map((i) => i.date + ': ' + i.story.slice(0, 90) + ' → ' + i.mainTitle) } })`)
  console.log('ready', ok, JSON.stringify(summary, null, 1))
  console.log('intl headlines in stories:', await evaluate(`window.intoponet.browserHost.getNewsDigest().then((raw) => { const d = JSON.parse(raw); const hs = (d.global ?? []).flatMap((s) => s.headlines); return hs.filter((h) => h.international).length + ' of ' + hs.length + ' · publishers: ' + [...new Set(hs.map((h) => h.publisher))].slice(0, 40).join(', ') })`))
  await evaluate(`document.querySelector('.olds-sheet .lg-icon-button[aria-label="Close The Olds"]')?.click(); document.querySelector('.globe-close')?.click(); true`)
  await delay(800)
  console.log('tabs:', await evaluate(`[...document.querySelectorAll('.globe-tabs button')].map((b) => JSON.stringify(b.innerText)).join(' ')`))
  await evaluate(`[...document.querySelectorAll('.globe-tabs button')].find((b) => b.innerText.trim() === 'World')?.click(); true`)
  await delay(1200)
  await shot('w1-world')
  await evaluate(`document.querySelector('.world-row')?.click(); true`)
  await delay(1500)
  console.log('expanded:', await evaluate(`document.querySelector('.world-detail')?.innerText.replace(/\\n+/g, ' | ').slice(0, 600) ?? 'none'`))
  await shot('w2-world-open')
  await evaluate(`document.querySelector('.world-itn')?.scrollIntoView(); true`)
  await delay(600)
  await shot('w3-itn')
}
