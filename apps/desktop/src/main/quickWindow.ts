import { createHash } from 'node:crypto'
import { BrowserWindow, WebContentsView, type Input, type Rectangle } from 'electron'
import { inferLauncherIntent, resolveNavigationIntent } from '@intoponet/browser-api'
import { appCommandForInput, type AppCommand, type KeyInput } from './appMenu'

/**
 * Quick windows: a link from another app (Mail, Slack, Finder) opens in a small window that floats
 * above other windows, with a toolbar (address, protection, Open in Intoponet, Close) over a page
 * view built exactly like a tab's. ⌘O moves that page into a tab of the main window without a
 * reload; closing the window discards it, leaving nothing in the closed-tabs list.
 */

export const QUICK_WINDOW_SIZE = { width: 900, height: 640, minWidth: 480, minHeight: 320 } as const
export const QUICK_TOOLBAR_HEIGHT = 52
/** Quick windows open at once; a sixth closes the oldest. */
export const MAX_QUICK_WINDOWS = 4
const MESSAGE_PREFIX = 'intoponet-quick:'
const MAX_MESSAGE = 9_000
const MAX_ADDRESS = 8_192

// ---- Pure helpers (unit-tested) ----------------------------------------------

/** Centred on the work area of the screen the pointer is on, never bigger than it (with a margin). */
export function quickWindowBounds(area: Rectangle, size: { width: number; height: number; minWidth: number; minHeight: number } = QUICK_WINDOW_SIZE, margin = 24): Rectangle {
  const fit = (want: number, min: number, room: number): number => Math.max(1, Math.min(Math.max(want, min), room))
  const width = fit(size.width, size.minWidth, area.width - margin * 2)
  const height = fit(size.height, size.minHeight, area.height - margin * 2)
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  }
}

/** A JSON value safe inside a <script> element: nothing can close the element or start a comment. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

export type QuickToolbarState = {
  /** The address shown (empty for a window with no page yet). */
  address: string
  hasPage: boolean
  secure: boolean
  isPrivate: boolean
  blocked: number
  protectionOn: boolean
  /** A short sentence when the last action failed (an address that is not one). */
  error: string
}

/** The toolbar's style; its hash is in the page's CSP, so no other style can apply. */
const toolbarStyle = `:root{color-scheme:light dark;--bg:#f4f5f7;--fg:#1d1f23;--muted:#5b616b;--line:#d5d9e0;--field:#ffffff;--accent:#2552c9}
@media (prefers-color-scheme: dark){:root{--bg:#1f2227;--fg:#eceef2;--muted:#a3a9b4;--line:#3a3f48;--field:#15171b;--accent:#8fb0ff}}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:13px -apple-system,system-ui,sans-serif;overflow:hidden}
[hidden]{display:none !important}
.bar{box-sizing:border-box;height:${QUICK_TOOLBAR_HEIGHT}px;display:flex;align-items:center;gap:8px;padding:0 10px 0 84px;border-bottom:1px solid var(--line)}
.address{flex:1;min-width:0;display:flex;align-items:center;gap:6px}
input{flex:1;min-width:0;height:28px;box-sizing:border-box;border:1px solid var(--line);border-radius:7px;background:var(--field);color:var(--fg);font:inherit;padding:0 9px}
input:read-only{border-color:transparent;background:transparent;cursor:default}
input:focus{outline:2px solid var(--accent);outline-offset:0}
.tag{font-size:11px;color:var(--muted);white-space:nowrap}
.tag.private{color:var(--fg);font-weight:600}
button{height:28px;border:1px solid var(--line);border-radius:7px;background:var(--field);color:var(--fg);font:inherit;padding:0 10px;white-space:nowrap;cursor:default}
button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
kbd{font:inherit;font-size:11px;color:var(--muted)}
.error{position:absolute;left:84px;right:10px;top:${QUICK_TOOLBAR_HEIGHT}px;margin:0;padding:4px 8px;background:var(--field);color:var(--fg);border:1px solid var(--line);border-radius:0 0 7px 7px;font-size:12px}`

const toolbarScript = `(() => {
  const address = document.getElementById('address')
  const secure = document.getElementById('secure')
  const isPrivate = document.getElementById('private')
  const protection = document.getElementById('protection')
  const error = document.getElementById('error')
  const always = document.getElementById('always')
  const send = (message) => console.log(${JSON.stringify(MESSAGE_PREFIX)} + JSON.stringify(message))
  let hasPage = false
  let shown = initialState.address
  window.quickRender = (state) => {
    hasPage = state.hasPage
    shown = state.address
    if (document.activeElement !== address) {
      address.value = state.address
      address.readOnly = state.hasPage
    }
    secure.textContent = state.hasPage ? (state.secure ? 'Secure' : 'Not secure') : ''
    secure.hidden = !state.hasPage
    isPrivate.hidden = !state.isPrivate
    protection.textContent = !state.hasPage ? '' : state.protectionOn ? state.blocked + ' blocked' : 'Protection paused'
    protection.hidden = !state.hasPage
    // Rules never apply to private browsing, and an empty window has no site to file under.
    always.hidden = state.isPrivate || !state.hasPage
    error.textContent = state.error
    error.hidden = !state.error
    return true
  }
  address.addEventListener('keydown', (event) => {
    // ⇧Tab before the toolbar's first control goes into the page (the keyboard can reach it without a click).
    if (event.key === 'Tab' && event.shiftKey && hasPage) {
      event.preventDefault()
      send({ type: 'focus-page' })
      return
    }
    // Escape in the field reverts it and leaves the field; the window stays open (main ignores this Escape).
    if (event.key === 'Escape') {
      event.preventDefault()
      address.value = shown
      address.blur()
      return
    }
    if (event.key !== 'Enter') return
    event.preventDefault()
    const value = address.value
    address.blur()
    send({ type: 'go', value })
  })
  address.addEventListener('focus', () => send({ type: 'editing', on: true }))
  address.addEventListener('blur', () => {
    // The window went to the back (another app came forward): the field keeps focus and is still being edited when it returns.
    if (document.activeElement === address) return
    address.readOnly = hasPage
    send({ type: 'editing', on: false })
  })
  document.getElementById('always').addEventListener('click', () => send({ type: 'always-here' }))
  document.getElementById('open').addEventListener('click', () => send({ type: 'open-in-main' }))
  document.getElementById('close').addEventListener('click', () => send({ type: 'close' }))
  // Tab past the toolbar's last control goes into the page.
  document.getElementById('close').addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || event.shiftKey || !hasPage) return
    event.preventDefault()
    send({ type: 'focus-page' })
  })
  window.quickFocusAddress = () => { address.readOnly = false; address.focus(); address.select(); return true }
  // The page was clicked: the edit ends, and the field shows the page's address again and follows it as it navigates.
  // (The field would otherwise keep the toolbar's focus, and with it the typed text, as when the window goes to the back.)
  window.quickLeaveAddress = () => {
    if (!hasPage || document.activeElement !== address) return true
    address.value = shown
    address.blur()
    address.readOnly = true
    send({ type: 'editing', on: false })
    return true
  }
  window.quickRender(initialState)
  if (!initialState.hasPage) address.focus()
})()`

/** The toolbar's HTML. Its state goes in as JSON, escaped for a script element; the script's hash is in the CSP. */
export function quickToolbarHtml(state: QuickToolbarState): string {
  const initial = `const initialState = ${jsonForScript(state)};`
  const script = `${initial}\n${toolbarScript}`
  const hash = (text: string): string => `'sha256-${createHash('sha256').update(text).digest('base64')}'`
  const csp = `default-src 'none'; script-src ${hash(script)}; style-src ${hash(toolbarStyle)}; img-src data:; base-uri 'none'; form-action 'none'`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Quick window</title>
<style>${toolbarStyle}</style></head>
<body><div class="bar" role="toolbar" aria-label="Quick window">
  <div class="address">
    <span id="secure" class="tag" hidden></span>
    <span id="private" class="tag private" hidden>Private</span>
    <input id="address" type="text" aria-label="Address" spellcheck="false" autocomplete="off" placeholder="Type an address or a search">
    <span id="protection" class="tag" hidden></span>
  </div>
  <button id="always" type="button" hidden>Always open here…</button>
  <button id="open" type="button">Open in Intoponet <kbd>⌘O</kbd></button>
  <button id="close" type="button" aria-label="Close quick window">Close <kbd>Esc</kbd></button>
</div>
<p id="error" class="error" role="alert" hidden></p>
<script>${script}</script></body></html>`
}

export type QuickToolbarMessage = { type: 'open-in-main' } | { type: 'always-here' } | { type: 'close' } | { type: 'focus-page' } | { type: 'go'; value: string } | { type: 'editing'; on: boolean }

/** A line the toolbar page logged: its own commands only; anything else is ignored. */
export function parseQuickToolbarMessage(message: unknown): QuickToolbarMessage | null {
  if (typeof message !== 'string' || message.length > MAX_MESSAGE || !message.startsWith(MESSAGE_PREFIX)) return null
  let value: unknown
  try {
    value = JSON.parse(message.slice(MESSAGE_PREFIX.length))
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (v['type'] === 'open-in-main') return { type: 'open-in-main' }
  if (v['type'] === 'always-here') return { type: 'always-here' }
  if (v['type'] === 'close') return { type: 'close' }
  if (v['type'] === 'focus-page') return { type: 'focus-page' }
  if (v['type'] === 'editing' && typeof v['on'] === 'boolean') return { type: 'editing', on: v['on'] }
  if (v['type'] === 'go' && typeof v['value'] === 'string' && v['value'].length <= MAX_ADDRESS) return { type: 'go', value: v['value'] }
  return null
}

export type QuickKeyAction = 'open-in-main' | 'close' | 'focus-address' | 'new-window' | 'reload' | 'back' | 'forward' | 'main'

/**
 * Escape typed in the toolbar while its address is being edited reverts the edit (the field's own);
 * typed anywhere else, the page included, it closes the window. The field stays the toolbar's focus
 * when the window goes to the back or the page is clicked, so `editing` alone does not say where the key went.
 */
export function escapeIsTheAddressFields(editing: boolean, fromToolbar: boolean): boolean {
  return editing && fromToolbar
}

/**
 * What a key does in a quick window. Its keys are handled before the menu bar sees them, so a
 * command meant for the main window's tab (⌘W, ⌘R…) never acts on that tab. The quick window's own
 * commands act here; any other menu command ('main') runs in the main window, which comes forward.
 * Ordinary typing and editing keys are left alone (null).
 */
export function quickWindowKeyAction(input: KeyInput, options: { developer?: boolean } = {}): QuickKeyAction | null {
  if (input.type !== 'keyDown') return null
  if (input.key === 'Escape') return 'close'
  const command = appCommandForInput(input, options)
  if (!command) return null
  switch (command.type) {
    case 'open-quick-in-main': return 'open-in-main'
    case 'close-tab': return 'close'
    case 'open-location': return 'focus-address'
    case 'new-quick-window': return 'new-window'
    case 'reload': return 'reload'
    case 'back': return 'back'
    case 'forward': return 'forward'
    default: return 'main'
  }
}

/** The address a window opens from: its own page, or the one it was given. */
function safeWebUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

// ---- The windows -------------------------------------------------------------

export type QuickProtection = { blocked: number; protectionOn: boolean }

export type QuickWindowHost = {
  /** The page view, built as a tab's is (protection, downloads, permissions, history). */
  buildView: (isPrivate: boolean) => WebContentsView
  /** Makes the page a tab of the main window, shown, without reloading it. False when it cannot. */
  adopt: (view: WebContentsView, url: string) => boolean
  protection: (view: WebContentsView) => QuickProtection
  workArea: () => Rectangle
  developer: () => boolean
  /** Private browsing is on: a new empty quick window is private too. */
  isPrivate: () => boolean
  /** A quick window's page finished loading (cosmetic protection, ad slots). */
  pageLoaded: (view: WebContentsView) => void
  /** Focus or the set of windows changed: the menu bar may need to update. */
  changed: () => void
  /** A menu command pressed in a quick window: the main window comes forward and runs it. */
  runInMain: (command: AppCommand) => void
  /** "Always open here…": offers the workspaces in a menu over `win`; the choice runs `moveHere` (which makes the page a tab). */
  alwaysOpenHere: (url: string, win: BrowserWindow, moveHere: () => boolean) => void
}

type Entry = {
  win: BrowserWindow
  toolbar: WebContentsView
  page: WebContentsView
  isPrivate: boolean
  /** The address the window was given (empty for a new window). */
  url: string
  error: string
  /** The toolbar's address field has focus (its Escape reverts the field instead of closing the window). */
  editing: boolean
  adopted: boolean
  closed: boolean
  refreshTimer: ReturnType<typeof setTimeout> | null
}

export class QuickWindows {
  private readonly entries: Entry[] = []

  constructor(private readonly host: QuickWindowHost) {}

  /** A link from another app (or an empty window when `url` is null). */
  open(url: string | null, isPrivate: boolean): void {
    const address = url ? safeWebUrl(url) : null
    while (this.entries.length >= MAX_QUICK_WINDOWS) this.dispose(this.entries[0]!)
    const entry = this.create(address ?? '', isPrivate)
    this.entries.push(entry)
    if (address) void entry.page.webContents.loadURL(address).catch(() => undefined)
    entry.win.show()
    entry.win.focus()
    // The keyboard goes to the page (to read and scroll it), or to the address field of an empty window.
    if (address) entry.page.webContents.focus()
    else entry.toolbar.webContents.focus()
    this.host.changed()
  }

  /** ⌥⌘N: an empty window, private when private browsing is on. */
  openEmpty(): void {
    this.open(null, this.host.isPrivate())
  }

  /** Whether one of the quick windows has keyboard focus (⌘O is in the menu only then). */
  focused(): boolean {
    return this.entries.some((entry) => !entry.closed && entry.win.isFocused())
  }

  /** Leaving private browsing: every private quick window closes with its page (nothing kept). */
  closePrivate(): void {
    for (const entry of [...this.entries]) if (entry.isPrivate) this.dispose(entry)
  }

  /** ⌘O: the focused quick window's page becomes a tab. False when no quick window has focus or it cannot move. */
  adoptFocused(): boolean {
    const entry = this.entries.find((item) => !item.closed && item.win.isFocused())
    return entry ? this.adopt(entry) : false
  }

  /** The quick windows' pages, for the protection routing (a request from one of them is attributed to it). */
  protectionTabs(): { url: string; view: WebContentsView }[] {
    return this.entries.filter((entry) => !entry.closed).map((entry) => ({ url: entry.url, view: entry.page }))
  }

  /** A quick window's page had requests blocked: its toolbar count is refreshed (at most every ~200 ms). */
  protectionChanged(webContentsId: number): void {
    for (const entry of this.entries) {
      if (entry.closed || entry.page.webContents.isDestroyed() || entry.page.webContents.id !== webContentsId || entry.refreshTimer) continue
      entry.refreshTimer = setTimeout(() => {
        entry.refreshTimer = null
        this.refresh(entry)
      }, 200)
    }
  }

  private create(url: string, isPrivate: boolean): Entry {
    const win = new BrowserWindow({
      ...quickWindowBounds(this.host.workArea()),
      minWidth: QUICK_WINDOW_SIZE.minWidth,
      minHeight: QUICK_WINDOW_SIZE.minHeight,
      title: 'Quick window',
      alwaysOnTop: true,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 16 },
      backgroundColor: '#f4f5f7',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    win.setAlwaysOnTop(true, 'floating')
    const toolbar = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } })
    toolbar.setBackgroundColor('#f4f5f7')
    const page = this.host.buildView(isPrivate)
    const entry: Entry = { win, toolbar, page, isPrivate, url, error: '', editing: false, adopted: false, closed: false, refreshTimer: null }
    win.contentView.addChildView(toolbar)
    win.contentView.addChildView(page)
    this.layout(entry)

    const initial: QuickToolbarState = { address: url, hasPage: !!url, secure: url.startsWith('https:'), isPrivate, blocked: 0, protectionOn: true, error: '' }
    void toolbar.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(quickToolbarHtml(initial))}`).catch(() => undefined)
    toolbar.webContents.on('console-message', (details) => {
      const message = parseQuickToolbarMessage(details.message)
      if (message) this.toolbarMessage(entry, message)
    })
    toolbar.webContents.on('before-input-event', (event, input) => this.key(entry, event, input, true))
    page.webContents.on('before-input-event', (event, input) => this.key(entry, event, input, false))
    // Clicking into the page leaves the address field: no typed text stays behind as the page navigates.
    page.webContents.on('focus', () => {
      if (!entry.closed && !toolbar.webContents.isDestroyed()) void toolbar.webContents.executeJavaScript('window.quickLeaveAddress && window.quickLeaveAddress()').catch(() => undefined)
    })

    const contents = page.webContents
    const update = (): void => this.refresh(entry)
    contents.on('did-start-loading', update)
    contents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) update() })
    contents.on('did-navigate', update)
    contents.on('page-title-updated', update)
    contents.on('did-stop-loading', () => {
      update()
      this.host.pageLoaded(page)
    })
    contents.once('destroyed', () => this.dispose(entry))
    toolbar.webContents.once('did-finish-load', () => this.refresh(entry))

    win.on('resize', () => this.layout(entry))
    win.on('focus', () => this.host.changed())
    win.on('blur', () => this.host.changed())
    win.on('closed', () => this.dispose(entry))
    return entry
  }

  private layout(entry: Entry): void {
    if (entry.closed || entry.win.isDestroyed()) return
    const [width = 0, height = 0] = entry.win.getContentSize()
    entry.toolbar.setBounds({ x: 0, y: 0, width, height: QUICK_TOOLBAR_HEIGHT })
    entry.page.setBounds({ x: 0, y: QUICK_TOOLBAR_HEIGHT, width, height: Math.max(0, height - QUICK_TOOLBAR_HEIGHT) })
  }

  /** Pushes the toolbar's state: the page's address, its security, protection and any error. */
  private refresh(entry: Entry): void {
    if (entry.closed || entry.toolbar.webContents.isDestroyed()) return
    const pageUrl = entry.page.webContents.isDestroyed() ? '' : safeWebUrl(entry.page.webContents.getURL()) ?? ''
    const current = pageUrl || (entry.page.webContents.isDestroyed() || !entry.page.webContents.isLoading() ? '' : entry.url)
    const protection = entry.page.webContents.isDestroyed() ? { blocked: 0, protectionOn: true } : this.host.protection(entry.page)
    const state: QuickToolbarState = {
      address: current,
      hasPage: !!current,
      secure: current.startsWith('https:'),
      isPrivate: entry.isPrivate,
      blocked: protection.blocked,
      protectionOn: protection.protectionOn,
      error: entry.error,
    }
    void entry.toolbar.webContents.executeJavaScript(`window.quickRender && window.quickRender(${jsonForScript(state)})`).catch(() => undefined)
  }

  private toolbarMessage(entry: Entry, message: QuickToolbarMessage): void {
    if (message.type === 'close') this.dispose(entry)
    else if (message.type === 'open-in-main') this.adopt(entry)
    else if (message.type === 'always-here') this.alwaysHere(entry)
    else if (message.type === 'editing') entry.editing = message.on
    else if (message.type === 'focus-page') { if (!entry.closed && !entry.page.webContents.isDestroyed()) entry.page.webContents.focus() }
    else this.navigate(entry, message.value)
  }

  /** A site rule from this window's page; the chosen workspace shows the page as its tab. Private windows have no rules. */
  private alwaysHere(entry: Entry): void {
    if (entry.closed || entry.isPrivate || entry.page.webContents.isDestroyed()) return
    const url = safeWebUrl(entry.page.webContents.getURL()) ?? entry.url
    if (!url) return
    this.host.alwaysOpenHere(url, entry.win, () => !entry.closed && this.adopt(entry))
  }

  /** The toolbar's address: a web address, or a search (as the address bar reads them). */
  private navigate(entry: Entry, value: string): void {
    let url: string
    try {
      url = resolveNavigationIntent(inferLauncherIntent(value, 'search'))
    } catch {
      entry.error = 'That is not a web address or a search.'
      this.refresh(entry)
      return
    }
    entry.error = ''
    entry.url = url
    void entry.page.webContents.loadURL(url).catch(() => undefined)
    // As in the main window's address bar: the page that loads has the keyboard.
    entry.page.webContents.focus()
    this.refresh(entry)
  }

  /** Keys are handled here, before the page or the menu bar gets them (see quickWindowKeyAction). */
  private key(entry: Entry, event: { preventDefault: () => void }, input: Input, fromToolbar: boolean): void {
    const keyInput: KeyInput = { type: input.type, key: input.key, code: input.code, meta: input.meta, control: input.control, shift: input.shift, alt: input.alt }
    const action = quickWindowKeyAction(keyInput, { developer: this.host.developer() })
    if (!action || entry.closed) return
    // Escape in the address field is the field's own (it reverts and leaves the field).
    if (action === 'close' && input.key === 'Escape' && escapeIsTheAddressFields(entry.editing, fromToolbar)) return
    event.preventDefault()
    const contents = entry.page.webContents
    switch (action) {
      case 'close': this.dispose(entry); return
      case 'open-in-main': this.adopt(entry); return
      case 'new-window': this.openEmpty(); return
      case 'focus-address':
        entry.toolbar.webContents.focus()
        void entry.toolbar.webContents.executeJavaScript('window.quickFocusAddress && window.quickFocusAddress()').catch(() => undefined)
        return
      case 'reload': if (!contents.isDestroyed()) contents.reload(); return
      case 'back': if (!contents.isDestroyed() && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack(); return
      case 'forward': if (!contents.isDestroyed() && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward(); return
      case 'main': {
        const command = appCommandForInput(keyInput, { developer: this.host.developer() })
        if (command) this.host.runInMain(command)
        return
      }
    }
  }

  /**
   * The page moves to the main window as a tab (same web contents: history, scroll and session kept).
   * The quick window is then gone; nothing is recorded as closed.
   */
  private adopt(entry: Entry): boolean {
    if (entry.closed || entry.page.webContents.isDestroyed()) return false
    // Defensive: a private page never becomes a tab of normal browsing (closePrivate should already have closed it).
    if (entry.isPrivate && !this.host.isPrivate()) {
      this.dispose(entry)
      return false
    }
    const url = safeWebUrl(entry.page.webContents.getURL()) ?? entry.url
    entry.win.contentView.removeChildView(entry.page)
    if (!this.host.adopt(entry.page, url)) {
      entry.win.contentView.addChildView(entry.page)
      this.layout(entry)
      return false
    }
    entry.adopted = true
    this.dispose(entry)
    return true
  }

  /** Closes a quick window and everything it holds (its page too, unless it was moved into a tab). */
  private dispose(entry: Entry): void {
    if (entry.closed) return
    entry.closed = true
    if (entry.refreshTimer) clearTimeout(entry.refreshTimer)
    const index = this.entries.indexOf(entry)
    if (index >= 0) this.entries.splice(index, 1)
    if (!entry.win.isDestroyed()) entry.win.destroy()
    if (!entry.toolbar.webContents.isDestroyed()) entry.toolbar.webContents.close()
    if (!entry.adopted && !entry.page.webContents.isDestroyed()) entry.page.webContents.close()
    this.host.changed()
  }
}
