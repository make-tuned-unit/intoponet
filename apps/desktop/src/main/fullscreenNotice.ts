import { WebContentsView, type BrowserWindow } from 'electron'

/**
 * A page that goes full screen covers the whole window, toolbar and address included, so it
 * could pretend to be anything. For a few seconds a small notice drawn by the app (its own
 * view, above the page, with no script) says which site it is and how to leave.
 */
export const FULLSCREEN_NOTICE_MS = 4_000
export const FULLSCREEN_WORLD_ID = 1303
/** Leaves HTML fullscreen; run in an isolated world of the page. */
export const EXIT_FULLSCREEN_SCRIPT = `(() => { if (!document.fullscreenElement) return false; void document.exitFullscreen().catch(() => undefined); return true })()`

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** "example.com" for http(s) pages; '' for anything else. */
export function fullscreenSiteName(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.host : ''
  } catch {
    return ''
  }
}

export function fullscreenNoticeHtml(site: string): string {
  const who = site ? `<b>${escapeHtml(site)}</b> is full screen` : 'This page is full screen'
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}
div{box-sizing:border-box;height:100%;display:flex;align-items:center;justify-content:center;border-radius:12px;background:rgba(20,22,26,.88);color:#fff;font:14px -apple-system,system-ui,sans-serif;padding:0 18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
kbd{font:inherit;border:1px solid rgba(255,255,255,.5);border-radius:4px;padding:0 5px;margin:0 3px}</style>
<div>${who} — press <kbd>Esc</kbd> to exit</div>`
}

export function noticeBounds(windowWidth: number, width = 460, height = 44): Electron.Rectangle {
  const w = Math.min(width, Math.max(200, windowWidth - 32))
  return { x: Math.max(0, Math.round((windowWidth - w) / 2)), y: 28, width: w, height }
}

/** Show the notice over the page; returns a function that removes it early. */
export function showFullscreenNotice(window: BrowserWindow, site: string, ms = FULLSCREEN_NOTICE_MS): () => void {
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } })
  view.setBackgroundColor('#00000000')
  const place = (): void => {
    if (window.isDestroyed()) return
    view.setBounds(noticeBounds(window.getContentSize()[0] ?? 800))
  }
  place()
  window.contentView.addChildView(view)
  window.on('resize', place)
  void view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fullscreenNoticeHtml(site))}`).catch(() => undefined)
  let removed = false
  const remove = (): void => {
    if (removed) return
    removed = true
    clearTimeout(timer)
    if (!window.isDestroyed()) {
      window.removeListener('resize', place)
      window.contentView.removeChildView(view)
    }
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }
  const timer = setTimeout(remove, ms)
  return remove
}
