// A paywalled article: detection, free coverage of the same story, and labels in lists.
export default async function ({ evaluate, shot, delay }) {
  const wait = async (expr, ms = 60_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await evaluate(expr)) return true; await delay(1500) }
    return false
  }
  await wait(`window.intoponet.browserHost.getNewsDigest().then((raw) => !!raw && (JSON.parse(raw).global ?? []).some((s) => s.headlines.some((h) => /nytimes\\.com/.test(h.url))) && JSON.parse(raw).healthyFeedCount > 250)`, 420_000)
  const target = await evaluate(`window.intoponet.browserHost.getNewsDigest().then((raw) => { const d = JSON.parse(raw); for (const s of d.global) { const h = s.headlines.find((x) => /nytimes\\.com/.test(x.url)); if (h) return h } return null })`)
  console.log('opening:', target?.title, target?.url)
  await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: ${JSON.stringify(target?.url ?? 'https://www.nytimes.com/')} }).then(() => true)`)
  const shown = await wait(`!!document.querySelector('.free-coverage')`, 40_000)
  await delay(800)
  console.log('bar:', shown, (await evaluate(`document.querySelector('.free-coverage')?.innerText.replace(/\\n+/g, ' | ') ?? 'none'`)).slice(0, 700))
  console.log('reason:', await evaluate(`document.querySelector('.fc-head span')?.title ?? ''`))
  await shot('pw1-free-coverage')
}
