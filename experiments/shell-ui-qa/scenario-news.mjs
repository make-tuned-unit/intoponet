// Local news layer: all registered feeds, world view, then country inspectors.
// Uses renderer-only captures so other windows never appear in evidence.
export default async function ({ evaluate, shotApp: shot, click, delay, send }) {
  const digest = () => evaluate(`window.intoponet.browserHost.getNewsDigest().then((raw) => { if (!raw) return null; const d = JSON.parse(raw); return { feeds: d.feedCount, healthy: d.healthyFeedCount, countries: d.countries.length, places: d.places.length, quiet: d.quietCountryCodes.length } })`)
  let last = null
  for (let i = 0; i < 300; i += 1) {
    last = await digest()
    if (last && last.countries > 180) break
    await delay(2000)
  }
  console.log('digest', JSON.stringify(last))
  for (const n of [2, 3, 4]) await click(`.globe-layer-list li:nth-child(${n}) button`)
  await delay(2500)
  await shot('n0-world-news')
  const fly = async (place) => {
    await evaluate(`document.querySelector('.command-input input').focus(); true`)
    await send('Input.insertText', { text: place })
    await delay(400)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await delay(3000)
  }
  for (const [place, name] of [['Kenya', 'n1-kenya'], ['Brazil', 'n2-brazil'], ['Japan', 'n3-japan']]) {
    await fly(place)
    const opened = await evaluate(`(() => { const row = [...document.querySelectorAll('.globe-list .globe-row')].find((el) => el.innerText.startsWith(${JSON.stringify(place)})); if (!row) return false; row.click(); return true })()`)
    await delay(2600)
    await shot(name)
    console.log(place, opened, (await evaluate(`document.querySelector('.globe-detail')?.innerText.slice(0, 500) ?? 'no detail'`)).replace(/\n+/g, ' | '))
  }
  const quiet = await evaluate(`window.intoponet.browserHost.getNewsDigest().then((raw) => JSON.parse(raw).quietCountryCodes.join(' '))`)
  console.log('quiet countries:', quiet)
}
