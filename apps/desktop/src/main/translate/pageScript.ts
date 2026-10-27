/**
 * Page translation scripts. They run in an isolated world (the page's own
 * scripts cannot see or call them) and keep state on that world's window.
 *
 * - collect: find translatable text units, most-visible first. Each leaf
 *   block becomes one HTML unit in which every inline element is replaced by
 *   a bare `<span data-i=N>` marker (no attributes reach the engine); blocks
 *   that also contain other blocks translate their loose text nodes alone.
 * - apply: rebuild each unit from the engine's output. The output is parsed
 *   in an inert document and only its text and our markers are used: text
 *   becomes new text nodes and markers move the page's original elements
 *   back in, so links, listeners and styles survive. Nothing from the output
 *   is ever inserted as markup.
 * - restore: put every original child back.
 */

export const TRANSLATE_WORLD_ID = 1291

export const PAGE_LIMITS = {
  units: 2_500,
  unitChars: 4_000,
  totalChars: 600_000,
} as const

export type CollectedUnit = { id: number; html: boolean; source: string }
export type Collected = { url: string; lang: string | null; sample: string; units: CollectedUnit[] }

const STATE = `
const S = (window.__intoponetTranslate ??= { units: new Map(), next: 1, owned: new WeakSet() })
`

export function sampleScript(): string {
  return `(() => {
  const lang = document.documentElement.getAttribute('lang') || document.querySelector('meta[http-equiv="content-language" i]')?.getAttribute('content') || null
  const root = document.querySelector('main, article, [role=main]') || document.body
  const sample = (root ? root.innerText : '').replace(/\\s+/g, ' ').slice(0, 6000)
  return { url: location.href, lang, sample }
})()`
}

export function collectScript(): string {
  return `(() => {
${STATE}
  const L = ${JSON.stringify(PAGE_LIMITS)}
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','CODE','PRE','KBD','SAMP','VAR','TEXTAREA','INPUT','SELECT','OPTION','SVG','MATH','CANVAS','VIDEO','AUDIO','IFRAME','OBJECT','EMBED'])
  const skipCache = new Map()
  const skipped = (el) => {
    if (!el || el === document.body || el === document.documentElement) return false
    if (skipCache.has(el)) return skipCache.get(el)
    const own = SKIP.has(el.tagName.toUpperCase()) || el.isContentEditable || el.getAttribute('translate') === 'no' || el.classList.contains('notranslate') || el.getAttribute('aria-hidden') === 'true' && el.textContent.trim().length < 3
    const value = own || skipped(el.parentElement)
    skipCache.set(el, value)
    return value
  }
  const displayCache = new Map()
  const inline = (el) => {
    if (displayCache.has(el)) return displayCache.get(el)
    const d = getComputedStyle(el).display
    const value = d.startsWith('inline') || d === 'contents' || d === 'ruby'
    displayCache.set(el, value)
    return value
  }
  const blockOf = (node) => {
    let e = node.parentElement
    while (e && e !== document.body && inline(e)) e = e.parentElement
    return e
  }
  const hasLetters = (s) => /\\p{L}{2}/u.test(s)
  const leafText = new Map()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!hasLetters(n.data) || S.owned.has(n) || skipped(n.parentElement)) continue
    const block = blockOf(n)
    if (!block || S.owned.has(block)) continue
    if (!leafText.has(block)) leafText.set(block, [])
    leafText.get(block).push(n)
  }
  const blocks = [...leafText.keys()]
  const containers = new Set()
  for (const b of blocks) for (let e = b.parentElement; e; e = e.parentElement) if (leafText.has(e)) { containers.add(e); break }
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const serialize = (el, map) => {
    let out = ''
    for (const c of el.childNodes) {
      if (c.nodeType === 3) out += esc(c.data)
      else if (c.nodeType === 1) {
        if (c.tagName === 'BR') { out += '<br>'; continue }
        const i = map.push(c) - 1
        if (skipped(c) || !hasLetters(c.textContent)) out += '<span data-x="' + i + '"></span>'
        else out += '<span data-i="' + i + '">' + serialize(c, map) + '</span>'
      }
    }
    return out
  }
  const vh = innerHeight
  const distance = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return 1e9
    return r.bottom < 0 ? -r.bottom + vh : r.top > vh ? r.top : 0
  }
  const units = []
  for (const b of blocks) {
    if (containers.has(b)) {
      for (const t of leafText.get(b)) {
        if (t.parentElement !== b && !inline(t.parentElement)) continue
        const m = t.data.match(/^(\\s*)([\\s\\S]*?)(\\s*)$/)
        if (!m[2] || m[2].length > L.unitChars) continue
        units.push({ kind: 'text', node: t, lead: m[1], trail: m[3], source: m[2], d: distance(t.parentElement) })
      }
    } else {
      const map = []
      const source = serialize(b, map)
      if (source.length > L.unitChars * 2) {
        for (const t of leafText.get(b)) {
          const m = t.data.match(/^(\\s*)([\\s\\S]*?)(\\s*)$/)
          if (!m[2] || m[2].length > L.unitChars) continue
          units.push({ kind: 'text', node: t, lead: m[1], trail: m[3], source: m[2], d: distance(b) })
        }
        continue
      }
      units.push({ kind: 'html', el: b, map, source, d: distance(b) })
    }
  }
  units.sort((a, b) => a.d - b.d)
  const out = []
  let total = 0
  for (const u of units) {
    if (out.length >= L.units || total + u.source.length > L.totalChars) break
    total += u.source.length
    const id = S.next++
    if (u.kind === 'html') {
      const saved = [[u.el, [...u.el.childNodes]]]
      for (const e of u.map) saved.push([e, [...e.childNodes]])
      S.units.set(id, { kind: 'html', el: u.el, map: u.map, saved })
    } else {
      S.units.set(id, { kind: 'text', node: u.node, lead: u.lead, trail: u.trail, original: u.node.data })
    }
    out.push({ id, html: u.kind === 'html', source: u.source })
  }
  const lang = document.documentElement.getAttribute('lang') || null
  const root = document.querySelector('main, article, [role=main]') || document.body
  return { url: location.href, lang, sample: (root ? root.innerText : '').replace(/\\s+/g, ' ').slice(0, 6000), units: out }
})()`
}

export function applyScript(results: Array<{ id: number; text: string }>): string {
  return `(() => {
${STATE}
  const results = ${JSON.stringify(results)}
  const parser = new DOMParser()
  const rebuild = (src, target, map, used) => {
    const kids = []
    for (const c of src.childNodes) {
      if (c.nodeType === 3) { kids.push(document.createTextNode(c.data)); continue }
      if (c.nodeType !== 1) continue
      if (c.tagName === 'BR') { kids.push(document.createElement('br')); continue }
      const x = c.getAttribute('data-x')
      const i = c.getAttribute('data-i')
      const index = x !== null ? Number(x) : i !== null ? Number(i) : -1
      const original = map[index]
      if (!original || used.has(original)) { if (c.textContent) kids.push(document.createTextNode(c.textContent)); continue }
      used.add(original)
      if (i !== null) rebuild(c, original, map, used)
      kids.push(original)
    }
    target.replaceChildren(...kids)
  }
  let applied = 0
  for (const { id, text } of results) {
    const u = S.units.get(id)
    if (!u || u.done) continue
    if (u.kind === 'text') {
      if (!u.node.isConnected || u.node.data !== u.original) continue
      u.node.data = u.lead + text + u.trail
      S.owned.add(u.node)
    } else {
      if (!u.el.isConnected) continue
      const doc = parser.parseFromString('<!doctype html><body>' + text + '</body>', 'text/html')
      rebuild(doc.body, u.el, u.map, new Set())
      S.owned.add(u.el)
      for (const t of u.el.querySelectorAll('*')) S.owned.add(t)
      const w = document.createTreeWalker(u.el, NodeFilter.SHOW_TEXT)
      for (let n = w.nextNode(); n; n = w.nextNode()) S.owned.add(n)
    }
    u.done = true
    applied++
  }
  return applied
})()`
}

export function restoreScript(): string {
  return `(() => {
  const S = window.__intoponetTranslate
  if (!S) return 0
  let restored = 0
  for (const u of S.units.values()) {
    if (!u.done) continue
    if (u.kind === 'text') { if (u.node.isConnected) u.node.data = u.original }
    else if (u.el.isConnected) { for (const [el, kids] of u.saved) el.replaceChildren(...kids) }
    restored++
  }
  delete window.__intoponetTranslate
  return restored
})()`
}

/** Forget collected-but-untranslated units (e.g. after a cancel). */
export function resetScript(): string {
  return `(() => { const S = window.__intoponetTranslate; if (S) for (const [id, u] of S.units) if (!u.done) S.units.delete(id); return true })()`
}

export function parseCollected(value: unknown): Collected | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v['url'] !== 'string' || !Array.isArray(v['units'])) return null
  const units: CollectedUnit[] = []
  for (const item of v['units'] as unknown[]) {
    if (typeof item !== 'object' || item === null) continue
    const u = item as Record<string, unknown>
    if (typeof u['id'] !== 'number' || typeof u['source'] !== 'string' || typeof u['html'] !== 'boolean') continue
    units.push({ id: u['id'], html: u['html'], source: u['source'].slice(0, PAGE_LIMITS.unitChars * 2) })
    if (units.length >= PAGE_LIMITS.units) break
  }
  return {
    url: v['url'],
    lang: typeof v['lang'] === 'string' ? v['lang'].slice(0, 35) : null,
    sample: typeof v['sample'] === 'string' ? v['sample'].slice(0, 6_000) : '',
    units,
  }
}

export function parseSample(value: unknown): { url: string; lang: string | null; sample: string } | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v['url'] !== 'string') return null
  return {
    url: v['url'],
    lang: typeof v['lang'] === 'string' ? v['lang'].slice(0, 35) : null,
    sample: typeof v['sample'] === 'string' ? v['sample'].slice(0, 6_000) : '',
  }
}
