import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { basename, extname, isAbsolute, join, resolve as resolvePath, dirname, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Links and files other apps hand to Intoponet (as the default browser, from Finder's "Open
 * With", or from a second launch): each opens in a new tab. They can arrive before the window
 * exists, so they wait in a queue until the browser is ready.
 */

export type IncomingTarget =
  | { kind: 'web'; url: string }
  /** A local page or PDF, opened from Finder. */
  | { kind: 'file'; url: string; path: string }

/** Local files that open in a tab. `.webloc` (a saved link) opens the link it holds. */
export const OPENABLE_FILE_EXTENSIONS = ['.html', '.htm', '.xhtml', '.pdf', '.webloc'] as const

const MAX_INCOMING_URL = 8_192

/** A web address handed over by another app; null unless it is http(s). */
export function incomingWebUrl(value: string): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_INCOMING_URL) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname) return null
    return url.toString()
  } catch {
    return null
  }
}

/** Largest saved link (`.webloc`) read; real ones are a few hundred bytes. */
export const MAX_SAVED_LINK_BYTES = 64_000

/**
 * Reads a saved link's file: an ordinary file of at most 64 KB, or it throws. A "file" that is a
 * named pipe or a link to /dev/zero (an archive can hold either) would otherwise keep the app
 * reading forever; it is opened without waiting and checked before anything is read.
 */
export function readSavedLinkFile(path: string): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const info = fstatSync(fd)
    if (!info.isFile() || info.size > MAX_SAVED_LINK_BYTES) throw new Error('Not a saved link.')
    return readFileSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** The link in a `.webloc` file (XML or binary property list). */
export function parseWebloc(contents: Uint8Array | string): string | null {
  const text = typeof contents === 'string' ? contents : Buffer.from(contents).toString('latin1')
  if (text.length > 64_000) return null
  const xml = /<key>\s*URL\s*<\/key>\s*<string>([^<]{1,8192})<\/string>/i.exec(text)
  if (xml?.[1]) {
    const decoded = xml[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    return incomingWebUrl(decoded)
  }
  // Binary plists keep ASCII strings as they are.
  const binary = /https?:\/\/[\x21-\x7e]{1,8000}/.exec(text)
  return binary ? incomingWebUrl(binary[0]) : null
}

/** What a file path opens as; `readFile` is used for `.webloc` only. */
export function incomingFileTarget(path: string, readFile: (path: string) => Uint8Array | string): IncomingTarget | null {
  if (typeof path !== 'string' || !isAbsolute(path) || path.length > 4_096) return null
  const extension = extname(path).toLowerCase()
  if (!(OPENABLE_FILE_EXTENSIONS as readonly string[]).includes(extension)) return null
  if (extension === '.webloc') {
    try {
      const url = parseWebloc(readFile(path))
      return url ? { kind: 'web', url } : null
    } catch {
      return null
    }
  }
  return { kind: 'file', url: pathToFileURL(path).href, path }
}

/** Arguments from a second launch (`open -a Intoponet https://…`, or files): what to open. */
export function incomingTargetsFromArgs(argv: readonly string[], cwd: string, readFile: (path: string) => Uint8Array | string): IncomingTarget[] {
  const targets: IncomingTarget[] = []
  // argv[0] is the executable; Chromium switches and the app path are skipped.
  for (const arg of argv.slice(1).slice(0, 50)) {
    if (typeof arg !== 'string' || arg.startsWith('-')) continue
    const web = incomingWebUrl(arg)
    if (web) {
      targets.push({ kind: 'web', url: web })
      continue
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(arg)) continue
    const extension = extname(arg).toLowerCase()
    if (!(OPENABLE_FILE_EXTENSIONS as readonly string[]).includes(extension)) continue
    const file = incomingFileTarget(isAbsolute(arg) ? arg : resolvePath(cwd, arg), readFile)
    if (file) targets.push(file)
  }
  return targets.slice(0, 20)
}

/** Holds what arrives before the browser is ready; then hands each to the opener, in order. */
export class IncomingOpenQueue {
  private queue: IncomingTarget[] = []
  private opener: ((target: IncomingTarget) => void) | null = null

  push(target: IncomingTarget | null): void {
    if (!target) return
    if (this.opener) {
      this.opener(target)
      return
    }
    // A flood of opens before launch keeps the most recent few.
    this.queue.push(target)
    if (this.queue.length > 20) this.queue.shift()
  }

  /** The browser can open tabs now: everything waiting opens. */
  ready(opener: (target: IncomingTarget) => void): void {
    this.opener = opener
    const waiting = this.queue
    this.queue = []
    for (const target of waiting) opener(target)
  }

  get waiting(): number {
    return this.queue.length
  }
}

/** More links than this from other apps within INCOMING_BURST_WINDOW_MS is a burst: the rest wait for the person. */
export const INCOMING_BURST_LIMIT = 6
export const INCOMING_BURST_WINDOW_MS = 3_000
/** Most links kept waiting in a burst; a flood beyond this is dropped. */
export const MAX_HELD_INCOMING = 100

/** A burst's notice: "Opened `opened` of `total` links from another app". */
export type HeldIncomingCount = { opened: number; total: number }

export type IncomingBurstOptions = {
  /** Opens one link or file (a tab, or a quick window). */
  open: (target: IncomingTarget) => void
  /** The notice changed (null: no links are waiting). */
  changed: (held: HeldIncomingCount | null) => void
  now?: () => number
}

/**
 * Links from other apps in a burst (more than 6 within 3 seconds: a selection of messages opened from
 * Mail, a script, an app gone wrong): the first 6 open and the rest wait until the person chooses "Open
 * the rest". Each workspace keeps at most 12 tabs and closes its oldest to make room, so a flood would
 * otherwise push the person's own tabs out without their choosing it.
 */
export class IncomingBurst {
  /** When the latest links arrived, within the window (at most INCOMING_BURST_LIMIT kept). */
  private arrivals: number[] = []
  private held: IncomingTarget[] = []
  /** What the notice counts: the links of this burst opened, and all of them (null: no notice). */
  private count: HeldIncomingCount | null = null

  constructor(private readonly options: IncomingBurstOptions) {}

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  push(target: IncomingTarget): void {
    const now = this.now()
    this.arrivals = this.arrivals.filter((at) => now - at < INCOMING_BURST_WINDOW_MS)
    const burst = this.arrivals.length >= INCOMING_BURST_LIMIT
    this.arrivals.push(now)
    if (this.arrivals.length > INCOMING_BURST_LIMIT) this.arrivals.shift()
    if (!burst) {
      this.options.open(target)
      // A link that opens while the notice shows is counted with it, so its numbers stay true.
      if (this.count) {
        this.count = { opened: this.count.opened + 1, total: this.count.total + 1 }
        this.options.changed(this.count)
      }
      return
    }
    if (this.held.length >= MAX_HELD_INCOMING) return
    this.held.push(target)
    // The links that started the burst all opened (nothing waited before it, and the window restarts once the person answers).
    const count = this.count ?? { opened: INCOMING_BURST_LIMIT, total: INCOMING_BURST_LIMIT }
    this.count = { opened: count.opened, total: count.total + 1 }
    this.options.changed(this.count)
  }

  /** The notice now (null: no links are waiting). */
  state(): HeldIncomingCount | null {
    return this.count
  }

  /** "Open the rest": every waiting link opens, in the order it came. */
  openRest(): void {
    const rest = this.held
    this.clear()
    for (const target of rest) this.options.open(target)
  }

  /** The notice was dismissed: the waiting links are dropped. */
  dismiss(): void {
    this.clear()
  }

  private clear(): void {
    const had = this.count !== null
    this.held = []
    this.count = null
    // The person answered: the next link from another app opens straight away.
    this.arrivals = []
    if (had) this.options.changed(null)
  }
}

/** Web-page assets a saved page loads from beside it (its "_files" folder). */
const PAGE_ASSET_EXTENSIONS = new Set([
  '.html', '.htm', '.xhtml', '.css', '.js', '.mjs', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.bmp',
  '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm', '.mp3', '.ogg', '.wav', '.m4a',
])

/**
 * Local files a tab may read. Only files opened from Finder (or another app) are served, plus, for
 * a saved web page ("Page.html"), the images, styles and scripts in its "Page_files" folder.
 * Everything else on the Mac stays out of reach of file:// pages (which Electron otherwise lets
 * read any file).
 */
export class LocalFileGrants {
  private readonly files = new Set<string>()
  private readonly folders = new Set<string>()

  /** `realpath` resolves symbolic links (a test passes its own). */
  constructor(private readonly realpath: (path: string) => string = realpathSync) {}

  grant(path: string): void {
    const absolute = resolvePath(path)
    this.files.add(absolute)
    const extension = extname(absolute).toLowerCase()
    if (extension === '.html' || extension === '.htm' || extension === '.xhtml') {
      this.folders.add(join(dirname(absolute), `${basename(absolute, extname(absolute))}_files`))
    }
    if (this.files.size > 500) this.files.delete(this.files.values().next().value as string)
  }

  allows(path: string): boolean {
    const absolute = resolvePath(path)
    if (this.files.has(absolute)) return true
    if (!PAGE_ASSET_EXTENSIONS.has(extname(absolute).toLowerCase())) return false
    for (const folder of this.folders) {
      if (absolute.startsWith(folder.endsWith(sep) ? folder : `${folder}${sep}`) && this.staysIn(absolute, folder)) return true
    }
    return false
  }

  /**
   * Whether the asset really is in the page's folder once links are followed. A saved page unpacked
   * from an archive can carry a link (`style.css` → ~/.ssh/id_rsa, or the whole "_files" folder → a
   * folder elsewhere) that would hand the page any file on the Mac. The page's own folder (the one it
   * was opened from) is resolved; the "_files" folder itself must be a real folder inside it.
   */
  private staysIn(absolute: string, folder: string): boolean {
    try {
      const root = join(this.realpath(dirname(folder)), basename(folder))
      return this.realpath(absolute).startsWith(`${root}${sep}`)
    } catch {
      return false
    }
  }
}
