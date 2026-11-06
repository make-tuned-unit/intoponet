/**
 * ⌃Tab in recently-used order. Holding ⌃, each Tab (⇧Tab backwards) moves the highlight through the
 * tabs, most recently shown first; releasing ⌃ shows the highlighted tab, Escape keeps the current
 * one. The order is fixed when the switcher opens, so stepping never reorders it. Recency is kept in
 * memory only, and a private tab ranks only among private tabs (normal ones among normal ones).
 */

export type SwitcherTab = {
  id: string
  title: string
  url: string
  favicon: string
  lastShownAt: number
  isPrivate: boolean
}

/** The tabs to step through: the current one first, then the others most recently shown first. */
export function recentOrder(tabs: readonly SwitcherTab[], activeId: string | null): string[] {
  const active = tabs.find((tab) => tab.id === activeId)
  const peers = tabs.filter((tab) => !active || tab.isPrivate === active.isPrivate)
  return [...peers]
    .sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : b.lastShownAt - a.lastShownAt))
    .map((tab) => tab.id)
}

export class TabSwitcher {
  private order: string[] | null = null
  private index = 0

  get open(): boolean {
    return this.order !== null
  }

  /** Opens the switcher (fixing the order) or moves its highlight; returns the order and the highlighted index. */
  step(tabs: readonly SwitcherTab[], activeId: string | null, direction: 'next' | 'previous'): { order: string[]; index: number } | null {
    if (!this.order) {
      this.order = recentOrder(tabs, activeId)
      this.index = 0
    }
    // Tabs closed while it is open drop out.
    const live = new Set(tabs.map((tab) => tab.id))
    this.order = this.order.filter((id) => live.has(id))
    if (this.order.length < 2) {
      this.order = null
      return null
    }
    const delta = direction === 'previous' ? -1 : 1
    this.index = (this.index + delta + this.order.length) % this.order.length
    return { order: this.order, index: this.index }
  }

  /** ⌃ released: the highlighted tab, and the switcher closes. */
  commit(): string | null {
    const chosen = this.order?.[this.index] ?? null
    this.order = null
    return chosen
  }

  cancel(): void {
    this.order = null
  }
}

const escape = (text: string): string => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Rows of the switcher, shown at most this many (the highlighted one always among them). */
export const SWITCHER_ROWS = 9
export const SWITCHER_ROW_HEIGHT = 46

/** The switcher's page: static (no script), only data: icons, everything else escaped. */
export function switcherHtml(tabs: readonly SwitcherTab[], order: readonly string[], index: number): string {
  const first = Math.max(0, Math.min(index - Math.floor(SWITCHER_ROWS / 2), order.length - SWITCHER_ROWS))
  const rows = order.slice(first, first + SWITCHER_ROWS).map((id, offset) => {
    const tab = tabs.find((item) => item.id === id)
    if (!tab) return ''
    const icon = tab.favicon.startsWith('data:image/') ? `<img src="${escape(tab.favicon)}" alt="">` : '<span class="globe"></span>'
    const title = escape(tab.title || siteName(tab.url) || 'Untitled page')
    return `<li class="${first + offset === index ? 'on' : ''}">${icon}<span class="title">${title}</span><span class="site">${escape(siteName(tab.url))}</span></li>`
  }).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>
html,body{margin:0;background:transparent;font:13px -apple-system,system-ui,sans-serif;color:#e9f4f3;overflow:hidden;-webkit-user-select:none;cursor:default}
ol{list-style:none;margin:0;padding:8px;border-radius:16px;background:rgba(6,20,26,.94);border:1px solid rgba(195,237,232,.16);box-shadow:0 18px 50px rgba(0,0,0,.45)}
li{display:flex;align-items:center;gap:10px;height:${SWITCHER_ROW_HEIGHT - 4}px;margin:2px 0;padding:0 12px;border-radius:10px}
li.on{background:rgba(32,244,228,.16);box-shadow:inset 0 0 0 1px rgba(32,244,228,.45)}
img,.globe{flex:0 0 18px;width:18px;height:18px;border-radius:4px}
.globe{border:1.5px solid rgba(233,244,243,.5);border-radius:50%;box-sizing:border-box}
.title{flex:1 1 auto;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.site{flex:0 0 auto;color:rgba(233,244,243,.55);font-size:12px}
</style></head><body><ol>${rows}</ol></body></html>`
}

/**
 * Run in the page (isolated world) when the switcher opens over it: resolves "commit" when ⌃ is
 * released, "cancel" on Escape, or "timeout". The page always sees these keys, so this does not
 * depend on the browser seeing a modifier key's release.
 */
export const SWITCHER_KEYS_SCRIPT = `new Promise((resolve) => {
  const done = (result) => {
    removeEventListener('keyup', up, true)
    removeEventListener('keydown', down, true)
    removeEventListener('blur', blur, true)
    resolve(result)
  }
  const up = (event) => { if (event.key === 'Control') done('commit') }
  const down = (event) => { if (event.key === 'Escape') done('cancel') }
  const blur = () => done('commit')
  addEventListener('keyup', up, true)
  addEventListener('keydown', down, true)
  addEventListener('blur', blur, true)
  setTimeout(() => done('timeout'), 4000)
})`
