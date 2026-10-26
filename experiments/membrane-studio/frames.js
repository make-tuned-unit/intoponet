// Deterministic phase-clock frames for a motion contact sheet / MP4.
async (page) => {
  const dir = '/Users/me/Documents/dev/Intoponet/experiments/membrane-studio/captures/frames/'
  await page.goto('http://localhost:5199/?t=0&hud=0&theta=0.35&phi=1.2')
  await page.waitForTimeout(4000)
  const frames = 300
  for (let i = 0; i < frames; i += 1) {
    await page.evaluate((t) => window.__setT(t), 10 + i / 30) // real-time phase at 30 fps
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    await page.screenshot({ path: dir + String(i).padStart(4, '0') + '.png', clip: { x: 290, y: 70, width: 700, height: 700 } })
  }
  return frames
}
