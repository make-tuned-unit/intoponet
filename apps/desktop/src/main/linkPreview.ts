/**
 * Link preview: ⇧-click a link (or choose Preview Link) and the page opens in a card floating over
 * the one you are reading, in the same session and with the same protection. Escape, a click outside
 * or ⌘W puts it away; Open as Tab moves the very same page, history and all, into a tab.
 *
 * The card is two native views over the window: the card's frame (a small page of our own with a
 * dimmed backdrop, the title and the two buttons), and the previewed page on top of the frame's body.
 * This file holds the parts that are not Electron: the gesture, the layout, the frame's page and the
 * scripts run in pages.
 */

export type PreviewRect = { x: number; y: number; width: number; height: number }

/** Share of the page area the card takes, each way. */
export const PREVIEW_SCALE = 0.8
/** The frame's title bar, above the page. */
export const PREVIEW_HEADER_HEIGHT = 48
/** The frame shows around the page's sides and bottom. */
export const PREVIEW_INSET = 6
/** Isolated world for the card's keyboard loop and for returning focus to the link. */
export const PREVIEW_WORLD_ID = 1315
/** Messages from the frame's page arrive as console lines starting with this. */
export const PREVIEW_MESSAGE_PREFIX = 'intoponet-link-preview:'

export type PreviewMessage = 'close' | 'open-as-tab' | 'focus-page-start' | 'focus-page-end'

/**
 * A ⇧-click (or ⇧↵) on a link reaches the window-open handler as a "new window" with no window
 * features; script-opened popups name their features (sign-in windows: width, height, popup), and
 * ⌘-click is a background tab. So this is the gesture, never a page asking for a popup.
 */
export function isLinkPreviewRequest(details: { url: string; disposition: string; features: string }): boolean {
  if (details.disposition !== 'new-window' || details.features.trim() !== '') return false
  try {
    const url = new URL(details.url)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** The page inside the card is about 80% of the page area each way; the card adds its title bar and edge, centred on the area. */
export function previewLayout(area: PreviewRect, scale = PREVIEW_SCALE): { card: PreviewRect; page: PreviewRect } {
  const width = Math.min(area.width, Math.max(360, Math.round(area.width * scale) + PREVIEW_INSET * 2))
  const height = Math.min(area.height, Math.max(260, Math.round(area.height * scale) + PREVIEW_HEADER_HEIGHT + PREVIEW_INSET))
  const card = {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  }
  const page = {
    x: card.x + PREVIEW_INSET,
    y: card.y + PREVIEW_HEADER_HEIGHT,
    width: Math.max(1, card.width - PREVIEW_INSET * 2),
    height: Math.max(1, card.height - PREVIEW_HEADER_HEIGHT - PREVIEW_INSET),
  }
  return { card, page }
}

export function parsePreviewMessage(message: unknown): PreviewMessage | null {
  if (typeof message !== 'string' || !message.startsWith(PREVIEW_MESSAGE_PREFIX)) return null
  const action = message.slice(PREVIEW_MESSAGE_PREFIX.length)
  return action === 'close' || action === 'open-as-tab' || action === 'focus-page-start' || action === 'focus-page-end' ? action : null
}

const escape = (text: string): string => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

/** The site a page is on, as the card's second line shows it. */
export function previewSite(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** The card's heading: the page's title, or its site while it loads. */
export function previewHeading(title: string, url: string): string {
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, 300)
  return clean || previewSite(url) || 'Link preview'
}

/**
 * The frame's page (a data: URL): the backdrop (a click on it closes), the card with the title and
 * its two buttons. Its script only reports clicks and keys, as console lines main listens for.
 */
export function previewFrameHtml(options: { card: PreviewRect; title: string; url: string; isPrivate: boolean }): string {
  const { card } = options
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>Link preview</title><style>
html,body{margin:0;height:100%;background:transparent;font:13px -apple-system,system-ui,sans-serif;color:#e9f4f3;overflow:hidden;-webkit-user-select:none;cursor:default}
#backdrop{position:fixed;inset:0;background:rgba(2,9,14,.46)}
#link-preview-card{position:fixed;left:${card.x}px;top:${card.y}px;width:${card.width}px;height:${card.height}px;box-sizing:border-box;border-radius:14px;background:#0b1b22;border:1px solid rgba(195,237,232,.22);box-shadow:0 24px 70px rgba(0,0,0,.5);animation:rise .16s ease-out}
@keyframes rise{from{opacity:.4;transform:scale(.985)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){#link-preview-card{animation:none}}
header{display:flex;align-items:center;gap:10px;height:${PREVIEW_HEADER_HEIGHT}px;padding:0 8px 0 16px;box-sizing:border-box}
.text{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}
h1{margin:0;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
p{margin:0;font-size:11.5px;color:#a9c2c0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.private{flex:0 0 auto;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:#2c1f4a;color:#e4d8ff}
button{flex:0 0 auto;font:inherit;font-weight:600;color:#e9f4f3;background:#14323a;border:1px solid rgba(195,237,232,.28);border-radius:9px;height:32px;padding:0 12px;cursor:pointer}
button:hover{background:#1b414b}
button:focus-visible{outline:2px solid #20f4e4;outline-offset:2px}
#close{width:32px;padding:0;font-size:18px;line-height:1}
</style></head><body><div id="backdrop"></div>
<div id="link-preview-card" role="dialog" aria-modal="true" aria-labelledby="title" aria-describedby="site">
<header>${options.isPrivate ? '<span class="private">Private</span>' : ''}<div class="text"><h1 id="title">${escape(previewHeading(options.title, options.url))}</h1><p id="site">${escape(previewSite(options.url))}</p></div>
<button id="open-tab" type="button" title="Keep this page as a tab">Open as Tab</button>
<button id="close" type="button" aria-label="Close preview" title="Close (Esc)"><span aria-hidden="true">×</span></button></header></div>
<script>
const send = (action) => console.log(${JSON.stringify(PREVIEW_MESSAGE_PREFIX)} + action)
const first = document.getElementById('open-tab')
const last = document.getElementById('close')
document.getElementById('backdrop').addEventListener('mousedown', () => send('close'))
first.addEventListener('click', () => send('open-as-tab'))
last.addEventListener('click', () => send('close'))
addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); send('close'); return }
  if (event.key !== 'Tab') return
  const active = document.activeElement
  const inside = active === first || active === last
  // Past either end of the title bar, focus goes on into the page (it never leaves the card).
  if (!inside || (!event.shiftKey && active === last) || (event.shiftKey && active === first)) {
    event.preventDefault()
    send(event.shiftKey ? 'focus-page-end' : 'focus-page-start')
  }
})
window.previewUpdate = (title, site) => {
  document.getElementById('title').textContent = title
  document.getElementById('site').textContent = site
}
window.previewFocus = (which) => (which === 'last' ? last : first).focus()
</script></body></html>`
}

/**
 * Run in the previewed page (isolated world). Resolves "forward" when Tab is pressed on the page's
 * last focusable element (or "backward" for ⇧Tab on its first), so focus goes back to the card's
 * title bar instead of leaving the card. Run again after each answer and each new document.
 */
export const PREVIEW_FOCUS_LOOP_SCRIPT = `(() => {
  if (!window.__previewLoop) {
    window.__previewLoop = { resolve: null }
    const selector = 'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),iframe,[contenteditable=""],[contenteditable="true"],[tabindex]'
    const focusable = () => [...document.querySelectorAll(selector)].filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0)
    addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey || !window.__previewLoop.resolve) return
      const list = focusable()
      const active = document.activeElement
      const none = !active || active === document.body || active === document.documentElement
      const atEnd = list.length === 0 || (event.shiftKey ? (none || active === list[0]) : active === list[list.length - 1])
      if (!atEnd) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const resolve = window.__previewLoop.resolve
      window.__previewLoop.resolve = null
      resolve(event.shiftKey ? 'backward' : 'forward')
    }, true)
  }
  return new Promise((resolve) => { window.__previewLoop.resolve = resolve })
})()`

/** Run in the page the preview came from (isolated world): focus goes back to the link. */
export function focusLinkScript(url: string): string {
  return `(() => {
  const url = ${JSON.stringify(url)}
  const active = document.activeElement
  if (active && active.href === url) { active.focus({ preventScroll: true }); return true }
  const link = [...document.querySelectorAll('a[href], area[href]')].find((el) => el.href === url)
  if (!link) return false
  link.focus({ preventScroll: true })
  return true
})()`
}
