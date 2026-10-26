// Playwright MCP snippet: waits for the live HUD + texture load, then captures.
// The MCP screenshot tool can return stale WebGL frames; this path does not.
async (page) => {
  const dir = '/Users/me/Documents/dev/Intoponet/experiments/membrane-studio/captures/'
  const tag = (globalThis.__shootTag ?? 'shot')
  const shots = [
    ['planet', '?t=20'],
    ['planet-b', '?t=20&theta=2.2&phi=1.1'],
    ['region', '?t=20&radius=2.48&theta=-1.3&phi=0.95'],
    ['city', '?t=20&radius=1.7&theta=0.25&phi=0.9'],
  ]
  const out = []
  for (const [name, query] of shots) {
    await page.goto('http://localhost:5199/' + query)
    await page.waitForFunction(() => (document.getElementById('hud')?.textContent ?? '').length > 0, null, { timeout: 20000 })
    await page.waitForTimeout(2500)
    await page.screenshot({ path: dir + name + '.png' })
    out.push(name + ': ' + await page.evaluate(() => document.getElementById('hud').textContent))
  }
  return out
}
