import { SITE_TWEAK_COLORS, SITE_TWEAK_FONTS, SITE_TWEAK_WIDTHS, type SiteTweak, type SiteTweakListItem, type SiteTweakSaveResult, type SiteTweakWidth } from '@intoponet/browser-api'
import { zoomSite } from './zoomStore'

/**
 * Make a site yours (SITE_TWEAKS). A tweak is style only: hidden elements, a reading width, a font,
 * light or dark colours, and the person's own CSS. Nothing here runs a script: CSS is checked
 * before it is kept, and only checked CSS is ever applied (insertCSS, or the cosmetic style element).
 */

export const SITE_TWEAK_LIMITS = {
  /** Hidden selectors per site. */
  hidden: 50,
  /** Characters per selector. */
  selector: 200,
  /** Bytes of the person's own CSS. */
  css: 20 * 1024,
  /** Sites with tweaks, kept on this Mac. */
  sites: 200,
} as const

const WIDTH_REM: Record<SiteTweakWidth, string> = { narrow: '42rem', medium: '56rem', wide: '72rem' }
const FONT_STACKS: Record<(typeof SITE_TWEAK_FONTS)[number], string> = {
  serif: 'Georgia, "Times New Roman", serif',
  sans: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif',
  mono: 'ui-monospace, Menlo, Monaco, "Courier New", monospace',
}

/** The site a tweak belongs to: the host of an http(s) page, without "www.". */
export const siteOf = (url: string): string | null => zoomSite(url)

/** Why a selector is refused, or null when it may be kept. Selectors go into CSS, so the character set is strict. */
export function selectorProblem(selector: unknown): string | null {
  if (typeof selector !== 'string') return 'A hidden element must be a selector.'
  const text = selector.trim()
  if (!text) return 'A hidden element is empty.'
  if (text.length > SITE_TWEAK_LIMITS.selector) return 'A hidden element selector is too long.'
  // No braces, semicolons, slashes, backslashes, quotes-in-comments or markup: nothing that could leave the rule.
  if (!/^[A-Za-z0-9_\- >+~.,#*:[\]="'()^$|]+$/.test(text)) return 'A hidden element selector has characters that are not allowed.'
  if (!balanced(text)) return 'A hidden element selector is not complete.'
  if (/^[>+~,]/.test(text) || /[>+~,]$/.test(text)) return 'A hidden element selector is not complete.'
  if (/\*/.test(text)) return 'A hidden element selector cannot use *.'
  if (/^(html|body|:root)$/i.test(text)) return 'A selector cannot hide the whole page.'
  return null
}

function balanced(text: string): boolean {
  let square = 0
  let round = 0
  let quote: string | null = null
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '[') square += 1
    else if (char === ']') square -= 1
    else if (char === '(') round += 1
    else if (char === ')') round -= 1
    if (square < 0 || round < 0) return false
  }
  return square === 0 && round === 0 && quote === null
}

/**
 * The CSS as the engine reads it: comments removed and escapes decoded, so `@\69mport` or `u\72l(`
 * cannot slip past the checks below.
 */
export function decodeCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([\s\S]))/g, (_match, hex: string | undefined, char: string | undefined) => {
      if (hex) return String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff))
      return char ?? ''
    })
}

/** Why the person's own CSS is refused, or null when it may be kept. */
export function cssProblem(css: unknown): string | null {
  if (typeof css !== 'string') return 'Your styles must be text.'
  if (Buffer.byteLength(css, 'utf8') > SITE_TWEAK_LIMITS.css) return 'Your styles are longer than 20 KB.'
  if (css.includes('\0')) return 'Your styles contain characters that are not allowed.'
  const decoded = decodeCss(css)
  if (/<\s*\/?\s*(style|script|iframe|object|embed|link|meta|img|svg|base|form)\b|<!--/i.test(decoded)) {
    return 'Your styles cannot contain HTML such as </style> or <script>. Only CSS is kept.'
  }
  if (/@import/i.test(decoded)) return 'Your styles cannot load other style sheets (@import).'
  if (/(^|[^a-z-])(-webkit-)?(image|image-set|src)\s*\(/i.test(decoded)) {
    return 'Your styles cannot load images through image(), image-set() or src().'
  }
  if (/expression\s*\(|-moz-binding|behaviou?r\s*:/i.test(decoded)) return 'Your styles use a rule that is not allowed.'
  // Every url() must point at embedded data, so a style never fetches anything from the web.
  const urls = decoded.match(/url\s*\(/gi)?.length ?? 0
  const embedded = decoded.match(/url\s*\(\s*['"]?\s*data:/gi)?.length ?? 0
  if (urls !== embedded) return 'Your styles can only use images embedded with data:, not links to other sites.'
  return null
}

/** Whether a tweak changes nothing (then it is not kept at all). */
export function isEmptyTweak(tweak: Pick<SiteTweak, 'hidden' | 'width' | 'font' | 'colors' | 'css'>): boolean {
  return tweak.hidden.length === 0 && !tweak.width && !tweak.font && !tweak.colors && !tweak.css
}

export type TweakCheck = { ok: true; tweak: SiteTweak } | { ok: false; error: string }

/**
 * Checks what the shell sent and returns the tweak to keep. Unknown fields are dropped; a bad
 * field refuses the whole save with a sentence the person can read.
 */
export function checkTweakInput(raw: unknown, now: number): TweakCheck {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'Nothing to save.' }
  const input = raw as Record<string, unknown>
  if (input['enabled'] !== undefined && typeof input['enabled'] !== 'boolean') return { ok: false, error: 'Turning tweaks on or off must be yes or no.' }
  const hiddenInput = input['hidden'] ?? []
  if (!Array.isArray(hiddenInput)) return { ok: false, error: 'Hidden elements must be a list.' }
  if (hiddenInput.length > SITE_TWEAK_LIMITS.hidden) return { ok: false, error: `A site can hide at most ${SITE_TWEAK_LIMITS.hidden} elements.` }
  const hidden: string[] = []
  for (const selector of hiddenInput) {
    const problem = selectorProblem(selector)
    if (problem) return { ok: false, error: problem }
    const text = (selector as string).trim()
    if (!hidden.includes(text)) hidden.push(text)
  }
  const pick = <T extends string>(key: string, allowed: readonly T[], label: string): { value?: T; error?: string } => {
    const value = input[key]
    if (value === undefined || value === null) return {}
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) return { error: `${label} is not one of the choices.` }
    return { value: value as T }
  }
  const width = pick('width', SITE_TWEAK_WIDTHS, 'Width')
  if (width.error) return { ok: false, error: width.error }
  const font = pick('font', SITE_TWEAK_FONTS, 'Font')
  if (font.error) return { ok: false, error: font.error }
  const colors = pick('colors', SITE_TWEAK_COLORS, 'Colours')
  if (colors.error) return { ok: false, error: colors.error }
  const cssInput = input['css'] ?? ''
  const cssError = cssProblem(cssInput)
  if (cssError) return { ok: false, error: cssError }
  const css = (cssInput as string).trim()
  const tweak: SiteTweak = {
    enabled: input['enabled'] !== false,
    hidden,
    ...(width.value ? { width: width.value } : {}),
    ...(font.value ? { font: font.value } : {}),
    ...(colors.value ? { colors: colors.value } : {}),
    ...(css ? { css } : {}),
    updatedAt: now,
  }
  return { ok: true, tweak }
}

/** The CSS that hides elements. Selectors have passed selectorProblem, so this is safe to insert. */
export function hideCss(selectors: readonly string[]): string {
  return selectors.map((selector) => `${selector} { display: none !important; }`).join('\n')
}

/**
 * The style part of a tweak (width, font, colours, then the person's own CSS), for insertCSS. Every
 * declaration is !important so the page's own styles yield; the person's CSS comes last.
 */
export function tweakCss(tweak: Pick<SiteTweak, 'enabled' | 'width' | 'font' | 'colors' | 'css'>): string {
  if (!tweak.enabled) return ''
  const rules: string[] = []
  if (tweak.width) {
    // Direct children of the page body that are not the page's chrome: the reading column is centred and no wider than the choice.
    rules.push(`body > *:not(header):not(nav):not(footer):not(script):not(style):not(link):not(noscript) { max-width: ${WIDTH_REM[tweak.width]} !important; margin-left: auto !important; margin-right: auto !important; }`)
  }
  if (tweak.font) {
    rules.push(`body, body :where(p, li, td, th, dd, dt, blockquote, h1, h2, h3, h4, h5, h6, article, section, main, a, label) { font-family: ${FONT_STACKS[tweak.font]} !important; }`)
  }
  if (tweak.colors === 'dark') {
    rules.push(':root { color-scheme: dark; }')
    rules.push('html, body { background-color: #1c1c1e !important; color: #e5e5e7 !important; }')
  } else if (tweak.colors === 'light') {
    rules.push(':root { color-scheme: light; }')
    rules.push('html, body { background-color: #ffffff !important; color: #1d1d1f !important; }')
  }
  if (tweak.css) rules.push(tweak.css)
  return rules.join('\n')
}

/** A row for the Settings list. */
export function listItem(site: string, tweak: SiteTweak): SiteTweakListItem {
  return {
    site,
    enabled: tweak.enabled,
    hiddenCount: tweak.hidden.length,
    hasCss: Boolean(tweak.css),
    ...(tweak.width ? { width: tweak.width } : {}),
    ...(tweak.font ? { font: tweak.font } : {}),
    ...(tweak.colors ? { colors: tweak.colors } : {}),
    updatedAt: tweak.updatedAt,
  }
}

const TOO_MANY_SITES = `You already have ${SITE_TWEAK_LIMITS.sites} sites with tweaks. Remove one in Settings first.`

const STORE_FILE_VERSION = 1
type StoreFile = { version: 1; sites: Record<string, SiteTweak> }

/**
 * The tweaks kept on this Mac (host → tweak). Written only through `trackedWrite`; a damaged or
 * invalid entry is dropped rather than applied.
 */
export class SiteTweakStore {
  private readonly sites = new Map<string, SiteTweak>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly io: {
      read: () => string | null
      write: (data: string) => Promise<void>
    },
    private readonly saveDelayMs = 400,
  ) {
    this.load()
  }

  private load(): void {
    let raw: string | null = null
    try {
      raw = this.io.read()
    } catch {
      return
    }
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as Partial<StoreFile>
      if (parsed?.version !== STORE_FILE_VERSION || typeof parsed.sites !== 'object' || parsed.sites === null || Array.isArray(parsed.sites)) return
      for (const [site, value] of Object.entries(parsed.sites).slice(-SITE_TWEAK_LIMITS.sites)) {
        if (!siteKeyValid(site) || typeof value !== 'object' || value === null) continue
        const updatedAt = typeof (value as SiteTweak).updatedAt === 'number' ? (value as SiteTweak).updatedAt : 0
        const checked = checkTweakInput(value, updatedAt)
        if (checked.ok && !isEmptyTweak(checked.tweak)) this.sites.set(site, checked.tweak)
      }
    } catch {
      // A damaged file starts over with no tweaks.
    }
  }

  get(site: string): SiteTweak | null {
    return this.sites.get(site) ?? null
  }

  /** Newest first. */
  list(): Array<{ site: string; tweak: SiteTweak }> {
    return [...this.sites.entries()].map(([site, tweak]) => ({ site, tweak })).sort((a, b) => b.tweak.updatedAt - a.tweak.updatedAt)
  }

  /** Keeps a checked tweak. Returns false when a new site would pass the limit. */
  put(site: string, tweak: SiteTweak): boolean {
    if (!this.sites.has(site) && this.sites.size >= SITE_TWEAK_LIMITS.sites) return false
    this.sites.delete(site)
    this.sites.set(site, tweak)
    this.scheduleSave()
    return true
  }

  remove(site: string): boolean {
    if (!this.sites.delete(site)) return false
    this.scheduleSave()
    return true
  }

  serialize(): string {
    return JSON.stringify({ version: STORE_FILE_VERSION, sites: Object.fromEntries(this.sites) } satisfies StoreFile)
  }

  /** Writes now if a save is waiting (on quit). */
  flush(): Promise<void> {
    if (!this.saveTimer) return Promise.resolve()
    clearTimeout(this.saveTimer)
    this.saveTimer = null
    return this.io.write(this.serialize())
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.io.write(this.serialize()).catch((error: unknown) => console.error('Could not save site tweaks:', error))
    }, this.saveDelayMs)
    this.saveTimer.unref?.()
  }
}

function siteKeyValid(site: string): boolean {
  return site.length <= 253 && /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(site)
}

/**
 * Tweaks as the browser sees them. A private tab reads the saved tweaks and keeps its own changes
 * in memory only: they are never written, and they end with private browsing.
 */
export class SiteTweaks {
  private readonly privateChanges = new Map<string, SiteTweak | null>()

  constructor(readonly store: SiteTweakStore) {}

  get(site: string, isPrivate: boolean): SiteTweak | null {
    if (isPrivate && this.privateChanges.has(site)) return this.privateChanges.get(site) ?? null
    return this.store.get(site)
  }

  /** Checks and keeps a draft for a site. An empty tweak removes the site's entry. */
  save(site: string, raw: unknown, isPrivate: boolean, now: number): SiteTweakSaveResult {
    const checked = checkTweakInput(raw, now)
    if (!checked.ok) return { ok: false, error: checked.error }
    const { tweak } = checked
    if (isEmptyTweak(tweak)) {
      this.remove(site, isPrivate)
      return { ok: true, tweak: null }
    }
    if (isPrivate) {
      const isNew = this.get(site, true) === null
      if (isNew && this.privateCount() >= SITE_TWEAK_LIMITS.sites) return { ok: false, error: TOO_MANY_SITES }
      this.privateChanges.set(site, tweak)
      return { ok: true, tweak }
    }
    if (!this.store.put(site, tweak)) return { ok: false, error: TOO_MANY_SITES }
    return { ok: true, tweak }
  }

  /** Turns a site's tweaks on or off. Returns the tweak after the change, or null when there is none. */
  setEnabled(site: string, enabled: boolean, isPrivate: boolean, now: number): SiteTweak | null {
    const current = this.get(site, isPrivate)
    if (!current) return null
    const next: SiteTweak = { ...current, enabled, updatedAt: now }
    if (isPrivate) this.privateChanges.set(site, next)
    else this.store.put(site, next)
    return next
  }

  remove(site: string, isPrivate: boolean): void {
    if (isPrivate) this.privateChanges.set(site, null)
    else this.store.remove(site)
  }

  /** Sites with a tweak as a private tab sees them (saved ones it has not removed, plus its own). */
  private privateCount(): number {
    const saved = this.store.list().filter(({ site }) => this.privateChanges.get(site) !== null).length
    let added = 0
    for (const [site, tweak] of this.privateChanges) if (tweak && !this.store.get(site)) added += 1
    return saved + added
  }
}

/**
 * Picks one element on the page. Runs in an isolated world (the page's own scripts cannot see it),
 * highlights the element under the pointer, and resolves with a selector (#id, a short class chain,
 * or a tag path of at most five levels), or null on Escape or a cancel. Clicks are swallowed so
 * the page does not act on them. Only selectors the page's own DOM answers to are returned.
 */
export const PICK_ELEMENT_SCRIPT = `new Promise((resolve) => {
  const SAFE = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;
  const previous = window.__intoponetPicker;
  if (previous) previous.cancel();
  const box = document.createElement('div');
  box.setAttribute('data-intoponet-pick', '');
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;outline:2px solid #2563eb;background:rgba(37,99,235,.14);top:0;left:0;width:0;height:0;border-radius:2px';
  (document.documentElement || document.body).appendChild(box);
  const segment = (node) => {
    const classes = [...node.classList].filter((name) => SAFE.test(name)).slice(0, 2).map((name) => '.' + name).join('');
    let part = node.localName + classes;
    const parent = node.parentElement;
    if (parent && [...parent.children].filter((child) => child.localName === node.localName).length > 1) {
      part += ':nth-of-type(' + ([...parent.children].filter((child) => child.localName === node.localName).indexOf(node) + 1) + ')';
    }
    return part;
  };
  const selectorFor = (element) => {
    if (element.id && SAFE.test(element.id) && document.querySelectorAll('#' + element.id).length === 1) return '#' + element.id;
    const parts = [];
    let node = element;
    for (let depth = 0; node && node.nodeType === 1 && depth < 5 && node !== document.body && node !== document.documentElement; depth += 1) {
      parts.unshift(segment(node));
      const selector = parts.join(' > ');
      if (document.querySelectorAll(selector).length === 1 && element.matches(selector)) return selector;
      node = node.parentElement;
    }
    const selector = parts.join(' > ');
    return selector && selector.length <= 200 && element.matches(selector) ? selector : null;
  };
  let current = null;
  const finish = (value) => {
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('mousemove', onMove, true);
    for (const name of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'auxclick', 'dblclick', 'contextmenu']) window.removeEventListener(name, swallow, true);
    window.removeEventListener('keydown', onKey, true);
    box.remove();
    if (window.__intoponetPicker && window.__intoponetPicker.cancel === cancel) delete window.__intoponetPicker;
    resolve(value);
  };
  const cancel = () => finish(null);
  const onMove = (event) => {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (!element || element === document.documentElement || element === document.body || element.hasAttribute('data-intoponet-pick')) {
      current = null;
      box.style.width = '0px';
      box.style.height = '0px';
      return;
    }
    current = element;
    const rect = element.getBoundingClientRect();
    box.style.top = rect.top + 'px';
    box.style.left = rect.left + 'px';
    box.style.width = rect.width + 'px';
    box.style.height = rect.height + 'px';
  };
  const swallow = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    if (event.type === 'click' && event.button === 0 && current) finish(selectorFor(current));
    else if (event.type === 'click') finish(null);
  };
  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    finish(null);
  };
  window.__intoponetPicker = { cancel };
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('mousemove', onMove, true);
  for (const name of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'auxclick', 'dblclick', 'contextmenu']) window.addEventListener(name, swallow, true);
  window.addEventListener('keydown', onKey, true);
})`;

/** Ends a pick that is waiting (the Cancel button, or a new pick). */
export const CANCEL_PICK_SCRIPT = `(() => { if (window.__intoponetPicker) window.__intoponetPicker.cancel(); return true })()`
