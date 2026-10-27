// Site permissions bar and popup handling on a real page.
export default async function ({ evaluate, shot, delay }) {
  await delay(3000)
  await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'https://example.com/' }); true`)
  await delay(5000)
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json()
  const target = list.find((t) => t.type === 'page' && t.url.startsWith('https://example.com'))
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => { ws.onopen = r })
  let n = 0
  const pending = new Map()
  ws.onmessage = (event) => { const m = JSON.parse(event.data); pending.get(m.id)?.(m.result?.result?.value ?? m.error?.message); pending.delete(m.id) }
  const page = (expression, userGesture = false) => new Promise((resolve) => { const id = ++n; pending.set(id, resolve); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true, userGesture } })) })

  console.log('before', await page(`navigator.permissions.query({ name: 'geolocation' }).then((p) => p.state)`))
  void page(`new Promise((resolve) => navigator.geolocation.getCurrentPosition(() => resolve('position'), (e) => resolve('error ' + e.code)))`)
  await delay(1500)
  console.log('bar', await evaluate(`document.querySelector('.permission-bar')?.innerText.replace(/\\n/g, ' ') ?? 'none'`))
  await shot('permission-bar')
  await evaluate(`[...document.querySelectorAll('.permission-bar button')].find((b) => b.innerText === 'Allow').click(); true`)
  await delay(1500)
  console.log('after allow', await page(`navigator.permissions.query({ name: 'geolocation' }).then((p) => p.state)`), '| bar gone', await evaluate(`!document.querySelector('.permission-bar')`))
  await evaluate(`document.querySelector('.shield-control > button').click(); true`)
  await delay(1000)
  console.log('chips', await evaluate(`[...document.querySelectorAll('.site-permission-chip')].map((c) => c.innerText).join(', ')`))
  await shot('permission-chips')

  console.log('popup', await page(`(() => { const w = window.open('https://example.org/', 'signin', 'width=480,height=600'); return w ? 'opened, opener kept: ' + (w.opener === window) : 'blocked' })()`, true))
  await delay(2500)
  console.log('tabs before link', await evaluate(`window.intoponet.browserHost.getTabs().then((t) => t.length)`))
  await page(`(() => { const a = document.createElement('a'); a.href = 'https://www.iana.org/'; a.target = '_blank'; document.body.append(a); a.click(); return true })()`, true)
  await delay(2500)
  console.log('tabs after _blank link', await evaluate(`window.intoponet.browserHost.getTabs().then((t) => t.map((x) => x.url).join(' | '))`))
  ws.close()
}
