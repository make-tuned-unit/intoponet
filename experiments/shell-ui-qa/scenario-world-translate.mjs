// World story headlines: per-language translation.
export default async function ({ evaluate, shotApp: shot, delay }) {
  const wait = async (expr, ms = 60_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await evaluate(expr)) return true; await delay(1500) }
    return false
  }
  await wait(`window.intoponet.browserHost.getNewsDigest().then((raw) => !!raw && (JSON.parse(raw).global ?? []).length >= 5 && JSON.parse(raw).healthyFeedCount > 200)`, 420_000)
  await evaluate(`[...document.querySelectorAll('.globe-tabs button')].find((b) => b.innerText.trim() === 'World')?.click(); true`)
  await delay(1000)
  console.log('heading inset:', await evaluate(`(() => { const h = document.querySelector('.world-stories h3').getBoundingClientRect(); const r = document.querySelector('.world-rank').getBoundingClientRect(); return Math.round(h.left) + ' vs rank ' + Math.round(r.left) })()`))
  // Find a story with non-English headlines.
  const index = await evaluate(`window.intoponet.browserHost.getNewsDigest().then((raw) => JSON.parse(raw).global.findIndex((s) => s.headlines.some((h) => h.lang && !/^en/i.test(h.lang))))`)
  await evaluate(`document.querySelectorAll('.world-row')[${index}]?.click(); true`)
  await delay(1000)
  const bar = () => evaluate(`document.querySelector('.world-detail .tr-headline-bar')?.innerText.replace(/\\n+/g, ' | ') ?? 'no bar'`)
  console.log('story', index, 'bar:', await bar())
  await shot('wt1-bar')
  await evaluate(`document.querySelector('.world-detail .tr-headline-bar .tr-inline-primary, .world-detail .tr-headline-bar .tr-inline-toggle')?.click(); true`)
  await wait(`!document.querySelector('.world-detail .tr-inline-status')`, 5000)
  const done = await wait(`!document.querySelector('.world-detail .tr-inline-status') && /English/.test(document.querySelector('.world-detail .tr-headline-bar')?.innerText ?? '') && !!document.querySelector('.world-detail .tr-flip-small')`, 240_000)
  await delay(3000)
  console.log('after:', done, await bar())
  console.log('headlines:', await evaluate(`[...document.querySelectorAll('.world-detail li strong')].slice(0, 6).map((s) => s.textContent).join(' // ')`))
  await shot('wt2-translated')
}
