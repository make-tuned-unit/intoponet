// Throw the globe, let it settle, then zoom: it must stay where it was thrown.
export default async function ({ shotApp, delay, send }) {
  await delay(5000)
  await shotApp('spin-0-start')
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1100, y: 600 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1100, y: 600, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 10; i += 1) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1100 - i * 25, y: 600, button: 'left', buttons: 1 }); await delay(16) }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 850, y: 600, button: 'left', clickCount: 1 })
  await delay(3000)
  await shotApp('spin-1-thrown')
  for (let i = 0; i < 4; i += 1) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1000, y: 600, deltaX: 0, deltaY: -120 }); await delay(60) }
  await delay(3000)
  await shotApp('spin-2-zoomed')
}
