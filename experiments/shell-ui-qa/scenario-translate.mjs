// Translation UI: detection, the translate bar, the Languages list and the
// headline flip. Does not download a model unless QA_TRANSLATE_INSTALL=1.
export default async function ({ evaluate, shot, shotApp, click, delay }) {
  const wait = async (expr, ms = 60_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await evaluate(expr)) return true; await delay(800) }
    return false
  }
  const bar = () => evaluate(`document.querySelector('.translate-bar')?.innerText.replace(/\\n+/g, ' | ') ?? 'no bar'`)
  await delay(4000)
  for (const url of ['https://es.wikipedia.org/wiki/Aurora_polar', 'https://ja.wikipedia.org/wiki/オーロラ', 'https://www.lemonde.fr/']) {
    await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: ${JSON.stringify(url)} }).then(() => true)`)
    await delay(6000)
    const offer = await evaluate(`document.querySelector('.translate-toggle')?.className`)
    await click('.translate-toggle')
    await wait(`!!document.querySelector('.translate-bar')`, 5000)
    await delay(600)
    console.log(url, '| toggle:', offer, '| bar:', await bar())
    if (url.includes('es.wikipedia')) await shotApp('t1-translate-bar-es')
    if (process.env.QA_TRANSLATE_INSTALL === '1' && url.includes('es.wikipedia')) {
      const t0 = Date.now()
      await click('.tr-primary')
      const ok = await wait(`/Translated from/.test(document.querySelector('.translate-bar')?.innerText ?? '')`, 240_000)
      console.log('translated', ok, Math.round((Date.now() - t0) / 1000) + 's', await bar())
      await shot('t3-translated-es')
      console.log('page text:', await evaluate(`window.intoponet.translate.translate({ from: 'es', to: 'en', texts: ['Las auroras se producen en las regiones polares.'] }).then((r) => r[0])`))
      // Flip back to the original, then forward again (served from cache).
      await evaluate(`[...document.querySelectorAll('.tr-flip button')].find((b) => !b.classList.contains('is-active'))?.click(); true`)
      await wait(`/Detected|From/i.test(document.querySelector('.translate-bar')?.innerText ?? '')`, 20_000)
      await delay(800)
      await shot('t4-original-es')
      const t1 = Date.now()
      await evaluate(`[...document.querySelectorAll('.tr-flip button')].find((b) => !b.classList.contains('is-active'))?.click(); true`)
      const again = await wait(`/Translated from/.test(document.querySelector('.translate-bar')?.innerText ?? '')`, 60_000)
      console.log('flip back to translation', again, (Date.now() - t1) + 'ms')
    }
    await click('.tr-close')
    await delay(300)
  }
  await click('.translate-toggle')
  await delay(500)
  await evaluate(`[...document.querySelectorAll('.translate-bar button')].find((b) => b.innerText === 'Languages')?.click(); true`)
  await delay(700)
  console.log('languages listed:', await evaluate(`document.querySelectorAll('.tr-manage li').length`))
  await shotApp('t2-languages')
  await evaluate(`window.intoponet.browserHost.close().then(() => true)`)
  await delay(1500)
}
