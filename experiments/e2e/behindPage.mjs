// Nothing the app window draws may lie under a shown page.
//
// A web page is a native view painted above the app window's own interface, so a menu, list, bar or message the
// window draws where a page is showing is simply not seen (the address bar's suggestions once opened that way).
// The app has three answers: the page is hidden while a panel covers it, the page is made smaller, or a copy of
// the element is floated in a view above the page. This watch runs through every check and catches the case
// where none of the three happened: something visible in the window's own document, in front of the page's
// place there, inside the box of a page that is on screen.

/** The native views of the app window, back to front: their boxes, whether they are shown, and what they hold. */
export const viewsExpression = `(() => {
  const win = electron.BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'))
  if (!win) return null
  return JSON.stringify(win.contentView.children.map((view) => ({ bounds: view.getBounds(), visible: view.getVisible(), url: view.webContents && !view.webContents.isDestroyed() ? view.webContents.getURL() : '' })))
})()`

/**
 * What the window draws under the given page boxes, as seen in the window's document. `copies` are the boxes of
 * floated copies (overlay.html): what lies under one of those is shown by the copy.
 * Returns JSON: { found: [{ key, what, text, box, points }], ms }.
 */
export function probeExpression(pages, copies) {
  return `((pages, copies) => {
    const t0 = performance.now()
    const body = document.querySelector('.browser-body')
    if (!body || !pages.length) return JSON.stringify({ found: [], ms: 0 })
    // The page's place in the document, and everything that place is inside: what is seen around a page.
    const place = new Set()
    for (let node = body; node; node = node.parentElement) place.add(node)
    const inside = (box, x, y) => x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height
    const alpha = (colour) => {
      const match = /rgba?\\(([^)]+)\\)/.exec(colour)
      if (!match) return colour === 'transparent' ? 0 : 1
      const parts = match[1].split(/[,/ ]+/).filter(Boolean)
      return parts.length > 3 ? Number.parseFloat(parts[3]) : 1
    }
    const replaced = new Set(['IMG', 'CANVAS', 'VIDEO', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'IFRAME'])
    /** Whether the element itself puts something on screen where its box is (not only through its children). */
    const paints = (el) => {
      const style = getComputedStyle(el)
      if (style.visibility !== 'visible' || style.display === 'none') return false
      let opacity = 1
      for (let node = el; node && node.nodeType === 1; node = node.parentElement) opacity *= Number.parseFloat(getComputedStyle(node).opacity || '1')
      if (opacity < 0.05) return false
      if (replaced.has(el.tagName) || (el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg' && el.tagName.toLowerCase() !== 'g')) return true
      for (const node of el.childNodes) if (node.nodeType === 3 && node.nodeValue.trim()) return true
      return alpha(style.backgroundColor) > 0.05 || style.backgroundImage !== 'none'
    }
    const name = (el) => {
      const parts = []
      for (let node = el; node && node.nodeType === 1 && parts.length < 4; node = node.parentElement) {
        const cls = typeof node.className === 'string' ? node.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2).join('.') : ''
        parts.unshift(node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + (cls ? '.' + cls : ''))
      }
      return parts.join(' > ')
    }
    // Where to look: the middle of every element's overlap with a shown page, on an 8 px lattice.
    const points = new Map()
    const add = (x, y) => {
      if (!pages.some((page) => inside(page, x, y)) || copies.some((copy) => inside(copy, x, y))) return
      points.set(Math.round(x / 8) + ':' + Math.round(y / 8), [x, y])
    }
    for (const el of document.body.getElementsByTagName('*')) {
      if (place.has(el)) continue
      const box = el.getBoundingClientRect()
      if (box.width < 1 || box.height < 1) continue
      for (const page of pages) {
        const left = Math.max(box.left, page.x); const right = Math.min(box.right, page.x + page.width)
        const top = Math.max(box.top, page.y); const bottom = Math.min(box.bottom, page.y + page.height)
        if (right - left < 3 || bottom - top < 3) continue
        add((left + right) / 2, (top + bottom) / 2)
        add(left + 1.5, top + 1.5)
        add(right - 1.5, bottom - 1.5)
      }
    }
    // Elements that take no clicks are skipped by elementsFromPoint: for the length of this look, all take them.
    // (A sheet made in script: the window's content policy refuses a <style> element.)
    const every = new CSSStyleSheet()
    every.replaceSync('* { pointer-events: auto !important }')
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, every]
    const found = new Map()
    try {
      for (const [x, y] of points.values()) {
        for (const el of document.elementsFromPoint(x, y)) {
          if (place.has(el)) break
          if (!paints(el)) continue
          const entry = found.get(el) ?? { points: 0 }
          entry.points += 1
          found.set(el, entry)
          break
        }
      }
    } finally {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== every)
    }
    const out = [...found].map(([el, entry]) => {
      const box = el.getBoundingClientRect()
      const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 70)
      const what = name(el)
      return { key: what + '|' + text.slice(0, 30), what, text, box: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }, points: entry.points }
    })
    return JSON.stringify({ found: out, ms: Math.round(performance.now() - t0) })
  })(${JSON.stringify(pages)}, ${JSON.stringify(copies)})`
}

/**
 * Watches the app through a check. `look()` is called again and again; an element counts once two looks in a row
 * (at least `gapMs` apart) find it, so a list on its way out, or the instant between a panel opening and its page
 * being hidden, is not reported.
 */
export function watchBehindPage({ evaluate, main, delay, everyMs = 600 }) {
  let stopped = false
  let last = new Map()
  const seen = new Map()
  let looks = 0
  let slowest = 0
  const look = async () => {
    const raw = await main(viewsExpression)
    if (!raw) { last = new Map(); return }
    const views = JSON.parse(raw).filter((view) => view.visible && view.bounds.width > 0 && view.bounds.height > 0)
    const copies = views.filter((view) => /overlay\.html/.test(view.url)).map((view) => view.bounds)
    // Pages: what a person browses. The app's own native pieces (the link preview's dimmed backdrop over the whole
    // window, the tab switcher's list, the full-screen notice) are drawn over the window on purpose.
    const pages = views.filter((view) => /^(https?|file):/.test(view.url) && !/overlay\.html/.test(view.url)).map((view) => view.bounds)
    const result = JSON.parse(await evaluate(probeExpression(pages, copies)))
    looks += 1
    slowest = Math.max(slowest, result.ms)
    const now = new Map(result.found.map((item) => [item.key, { ...item, pages }]))
    for (const [key, item] of now) if (last.has(key) && !seen.has(key)) seen.set(key, item)
    last = now
  }
  const loop = (async () => {
    while (!stopped) {
      try { await look() } catch { last = new Map() }
      await delay(everyMs)
    }
  })()
  return {
    /** Ends the watch at once (before the app quits): no look starts after this. */
    end: () => { stopped = true },
    /** Ends the watch and waits for a look in progress. */
    stop: async () => { stopped = true; await Promise.race([loop, delay(3000)]) },
    report: () => ({ looks, slowest, found: [...seen.values()] }),
  }
}

/** One line a person can act on. */
export function describeBehind(found) {
  return found.map((item) => `${item.what}${item.text ? ` (“${item.text}”)` : ''} at ${item.box.x},${item.box.y} ${item.box.width}×${item.box.height}, under the page at ${item.pages.map((page) => `${page.x},${page.y} ${page.width}×${page.height}`).join(' and ')}`).join('; ')
}
