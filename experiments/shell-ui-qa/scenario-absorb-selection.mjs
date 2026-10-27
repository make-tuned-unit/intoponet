// Right-click › Absorb Selection: the selected passage (not the whole article) is previewed for Absorb.
export default async function ({ evaluate, delay }) {
  await delay(3000)
  await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'https://en.wikipedia.org/wiki/Climate_change' }); true`)
  await delay(7000)
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json()
  const target = list.find((t) => t.type === 'page' && t.url.includes('Climate_change'))
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => { ws.onopen = r })
  const selected = await new Promise((resolve) => {
    ws.onmessage = (event) => { const m = JSON.parse(event.data); if (m.id === 1) resolve(m.result.result.value) }
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, expression: `(() => { const p = [...document.querySelectorAll('#mw-content-text p')].find((el) => el.innerText.length > 200); const range = document.createRange(); range.selectNodeContents(p); getSelection().removeAllRanges(); getSelection().addRange(range); return getSelection().toString().slice(0, 140) })()` } }))
  })
  ws.close()
  console.log('selected:', selected)
  await evaluate(`window.intoponet.captures.setPageHidden(true); true`)
  const preview = await evaluate(`window.intoponet.knowledge.preview('selection').then((p) => JSON.stringify({ refused: p.refused ?? false, reason: p.reason, scope: p.scope, words: p.wordCount ?? p.analysis?.wordCount, title: p.title, start: (p.paragraphs ?? p.text ?? [''])[0]?.slice?.(0, 140) ?? Object.keys(p).join(',') }))`)
  console.log('preview:', preview)
  await evaluate(`window.intoponet.captures.setPageHidden(false); true`)
}
