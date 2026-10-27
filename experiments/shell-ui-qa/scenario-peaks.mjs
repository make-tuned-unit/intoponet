// Peaks: the layer card legend, peak meters in the list, and "why it peaks".
export default async function ({ evaluate, shotApp: shot, delay }) {
  const wait = async (expr, ms = 60_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await evaluate(expr)) return true; await delay(1500) }
    return false
  }
  await wait(`window.intoponet.browserHost.getNewsDigest().then((raw) => !!raw && JSON.parse(raw).countries.length > 120)`, 300_000)
  await delay(2000)
  await evaluate(`[...document.querySelectorAll('.globe-tabs button')].find((b) => b.innerText.trim() === 'Peaks')?.click(); true`)
  await delay(1000)
  console.log('tabs:', await evaluate(`[...document.querySelectorAll('.globe-tabs button')].map((b) => b.innerText.trim()).join(' · ')`))
  console.log('layers:', await evaluate(`[...document.querySelectorAll('.globe-layer-list .globe-layer')].map((b) => b.innerText.replace(/\\n+/g, ' ')).join(' | ')`))
  console.log('legend:', await evaluate(`document.querySelector('.peak-legend')?.innerText.replace(/\\n+/g, ' | ')`))
  await shot('k1-peaks')
  for (const n of [0, 1, 2]) {
    await evaluate(`document.querySelectorAll('.globe-list .globe-row')[${n}]?.click(); true`)
    await delay(900)
    console.log('why:', await evaluate(`(document.querySelector('.globe-detail h2')?.textContent ?? '') + ' → ' + (document.querySelector('.peak-dd')?.textContent ?? '') + ' → ' + (document.querySelector('.peak-why')?.textContent ?? '')`))
    if (n === 0) await shot('k2-why')
    await evaluate(`document.querySelector('.globe-close')?.click(); true`)
    await delay(600)
  }
}
