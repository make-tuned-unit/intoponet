// Real-time capture: entrance reveal, then a synthetic snapshot update.
async (page) => {
  const dir = '/Users/me/Documents/dev/Intoponet/experiments/membrane-studio/captures/story/'
  await page.goto('http://localhost:5199/?hud=0&theta=0.35&phi=1.2&fixture=preview')
  await page.waitForFunction(() => typeof window.__setT === 'function')
  let i = 0
  const shoot = async () => page.screenshot({ path: dir + String(i++).padStart(4, '0') + '.png', clip: { x: 290, y: 70, width: 700, height: 700 } })
  const until = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) { await shoot(); await page.waitForTimeout(60) } }
  await until(5200)
  await page.evaluate(() => {
    const next = window.__fixtures.preview.map((s) => ({ ...s }))
    const ny = next.find((s) => s.lat === 40.7 && s.lon === -74)
    if (ny) { ny.intensity = 1; ny.radiusKm = 3200; ny.momentum = 0.6 }
    next.push({ ...next[0], id: 'synthetic-story-lagos', lat: 6.5, lon: 3.4, intensity: 0.85, radiusKm: 2600, momentum: 0.5, topicId: 'civic-memory' })
    window.__setSignals(next)
  })
  await until(13500)
  return i
}
