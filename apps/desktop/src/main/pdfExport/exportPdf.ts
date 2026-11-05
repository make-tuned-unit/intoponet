import { BrowserWindow, session, type Session, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { browserUserAgent } from '../browserUserAgent'
import { pdfFilename } from './filename'
import { postprocessOffThread } from './openPostprocess'
import { printableImage, readLimited } from './printImages'
import { cleanLiveScript, finalizeScript, PDF_WORLD_ID, prepareScript, REVERT_LIVE_SCRIPT } from './pageScripts'
import { resolvePaper, type PdfExportSettings } from './settings'
import { buildPrintDocument, hostOf, PRINT_CSP, type PageMeta } from './template'
import { writeWhereFroms } from './whereFrom'

export type PdfExportOutcome =
  | {
      status: 'saved'
      path: string
      filename: string
      bytes: number
      pages: number | null
      mode: 'formatted' | 'asSeen'
      /** Why Formatted was not used when it was asked for automatically ('' when it was used). */
      fellBack: string
      missingImages: number
      ads: number
      url: string
      title: string
    }
  | { status: 'cancelled' }
  | { status: 'failed'; reason: string }

export type PdfExportDeps = {
  contents: WebContents
  isPrivate: boolean
  settings: PdfExportSettings
  countryCode: string
  appVersion: string
  /** Ad and tracker hosts the protection engine blocks, checked per image address. */
  isBlocked: (url: string, topLevelUrl: string) => boolean
  /** Extra hide selectors from the protection engine. */
  adSelectors: string[]
  /** Where the file goes: a reserved path in Downloads, or the one the person picked (null: they cancelled). */
  destination: (suggestedName: string) => Promise<{ path: string; reserved: boolean; release: () => void } | null>
  cancelled: () => boolean
  progress?: (step: 'preparing' | 'printing' | 'finishing') => void
}

const PRINT_PARTITION = 'intoponet-pdf-export'
const PRINT_SCHEME = 'intoponet-pdf'

const withTimeout = <T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T | 'timeout'> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.()
      resolve('timeout')
    }, ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error: unknown) => { clearTimeout(timer); reject(error) },
    )
  })

class Cancelled extends Error {}

type PrepareResult = {
  meta: PageMeta
  images: string[]
  stats: { images: number; missingImages: number; ads: number; truncated: boolean; scrolled: boolean }
  appShell: boolean
}

type FinalizeResult = {
  formatted: { html: string; title: string; byline: string; lang: string; dir: string; chars: number } | null
  reason: string
}

/** The one in-memory profile the clean copy is printed in: no cookies, nothing kept, only allowed images load. */
let printSession: Session | null = null
const jobs = new Map<string, { html: string; allowed: Set<string>; referrer: string }>()

function preparedPrintSession(): Session {
  if (printSession) return printSession
  const ses = session.fromPartition(PRINT_PARTITION, { cache: false })
  ses.setUserAgent(browserUserAgent(ses.getUserAgent()))
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.protocol.handle(PRINT_SCHEME, (request) => {
    const token = new URL(request.url).pathname.replace(/^\//, '')
    const job = jobs.get(token)
    if (!job) return new Response('Gone', { status: 404 })
    return new Response(job.html, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PRINT_CSP, 'referrer-policy': 'strict-origin-when-cross-origin' },
    })
  })
  // Nothing loads but the document and the exact images the page itself showed.
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (details.url.startsWith(`${PRINT_SCHEME}:`) || details.url.startsWith('data:')) return callback({})
    const allowed = [...jobs.values()].some((job) => job.allowed.has(details.url))
    callback({ cancel: !allowed })
  })
  // Images are asked for as the page asked for them (some sites refuse requests without a referrer).
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const job = [...jobs.values()].find((entry) => entry.allowed.has(details.url))
    const headers = { ...details.requestHeaders }
    delete headers['Cookie']
    if (job?.referrer) headers['Referer'] = job.referrer
    callback({ requestHeaders: headers })
  })
  // Images come through here: only allowed ones, fetched once without cookies, then made print-sized
  // (photos as JPEG), so a page of pictures does not become a PDF of tens of megabytes.
  const serveImage = async (request: Request): Promise<Response> => {
    if (![...jobs.values()].some((job) => job.allowed.has(request.url))) return new Response(null, { status: 404 })
    try {
      const response = await ses.fetch(request.url, { bypassCustomProtocolHandlers: true, signal: AbortSignal.timeout(20_000) })
      if (!response.ok) return new Response(null, { status: response.status })
      const bytes = await readLimited(response)
      if (!bytes) return new Response(null, { status: 413 })
      const image = printableImage(bytes, response.headers.get('content-type') ?? '')
      return new Response(image.bytes as BodyInit, { headers: { 'content-type': image.contentType } })
    } catch {
      return new Response(null, { status: 502 })
    }
  }
  ses.protocol.handle('https', serveImage)
  ses.protocol.handle('http', serveImage)
  ses.on('will-download', (event) => event.preventDefault())
  printSession = ses
  return ses
}

async function printClean(html: string, allowed: Set<string>, sourceUrl: string, paper: 'A4' | 'Letter', cancelled: () => boolean): Promise<Buffer> {
  const ses = preparedPrintSession()
  const token = randomUUID()
  let referrer = ''
  try {
    referrer = `${new URL(sourceUrl).origin}/`
  } catch {
    // No referrer.
  }
  jobs.set(token, { html, allowed, referrer })
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      session: ses,
      sandbox: true,
      javascript: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
      disableDialogs: true,
      autoplayPolicy: 'user-gesture-required',
    },
  })
  const contents = win.webContents
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => event.preventDefault())
  contents.on('will-redirect', (event) => event.preventDefault())
  contents.setAudioMuted(true)
  try {
    const loaded = await withTimeout(contents.loadURL(`${PRINT_SCHEME}://doc/${token}`).catch(() => undefined), 20_000, () => contents.stop())
    void loaded
    if (cancelled()) throw new Cancelled()
    const pdf = await withTimeout(contents.printToPDF({
      pageSize: paper,
      margins: { top: 0.75, bottom: 0.83, left: 0.87, right: 0.87 },
      printBackground: false,
      preferCSSPageSize: false,
      displayHeaderFooter: false,
      generateTaggedPDF: true,
      generateDocumentOutline: true,
    }), 90_000)
    if (pdf === 'timeout') throw new Error('The page took too long to print.')
    return pdf
  } finally {
    jobs.delete(token)
    if (!win.isDestroyed()) win.destroy()
    if (jobs.size === 0) void ses.clearStorageData().catch(() => undefined)
  }
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

async function printAsSeen(contents: WebContents, meta: PageMeta, settings: PdfExportSettings, paper: 'A4' | 'Letter', adSelectors: string[]): Promise<{ pdf: Buffer; ads: number }> {
  let ads = 0
  try {
    const cleaned = await contents.executeJavaScriptInIsolatedWorld(PDF_WORLD_ID, [{ code: cleanLiveScript(adSelectors) }]) as { ads?: number } | null
    ads = Number(cleaned?.ads) || 0
  } catch {
    // Printed without the clean-up.
  }
  const host = hostOf(meta.url)
  const title = meta.title || host
  const left = settings.citation ? `${escapeHtml(title.length > 80 ? `${title.slice(0, 78)}…` : title)}${host ? ` · ${escapeHtml(host)}` : ''}` : ''
  try {
    const pdf = await withTimeout(contents.printToPDF({
      pageSize: paper,
      margins: { top: 0.45, bottom: 0.6, left: 0.45, right: 0.45 },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="font: 7px -apple-system, 'Helvetica Neue', sans-serif; color: #777; width: 100%; padding: 0 0.45in; display: flex; justify-content: space-between;"><span>${left}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      generateTaggedPDF: true,
      generateDocumentOutline: true,
    }), 90_000)
    if (pdf === 'timeout') throw new Error('The page took too long to print.')
    return { pdf, ads }
  } finally {
    await contents.executeJavaScriptInIsolatedWorld(PDF_WORLD_ID, [{ code: REVERT_LIVE_SCRIPT }]).catch(() => undefined)
  }
}

/** Page count straight from the PDF (used if the post-processing pass did not run). */
export function countPdfPages(bytes: Uint8Array): number | null {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1')
  const match = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)
  return match ? match.length : null
}

/**
 * Export as PDF, start to finish. Formatted: the article, cleaned and set for reading, printed from a
 * hidden copy. As seen: the page itself, minus ads and overlays. Auto picks Formatted when the page
 * reads as an article. Everything happens on this Mac.
 */
export async function exportPagePdf(deps: PdfExportDeps): Promise<PdfExportOutcome> {
  const { contents, settings } = deps
  const url = contents.getURL()
  if (!/^https?:\/\//i.test(url)) return { status: 'failed', reason: 'Only web pages can be saved as PDF.' }
  const paper = resolvePaper(settings.paper, deps.countryCode)
  const check = () => {
    if (deps.cancelled() || contents.isDestroyed()) throw new Cancelled()
  }
  try {
    deps.progress?.('preparing')
    const wantClean = settings.mode !== 'asSeen'
    const prepared = await withTimeout(
      contents.executeJavaScriptInIsolatedWorld(PDF_WORLD_ID, [{ code: prepareScript({ clone: wantClean, images: settings.images, scroll: true, budgetMs: 20_000 }, deps.adSelectors) }], true) as Promise<PrepareResult>,
      30_000,
    )
    check()
    if (prepared === 'timeout' || !prepared || typeof prepared !== 'object') return { status: 'failed', reason: 'The page did not respond.' }
    const meta: PageMeta = { ...prepared.meta, url }
    if (contents.getURL() !== url) return { status: 'failed', reason: 'The page changed while it was being saved.' }

    let pdf: Buffer | null = null
    let mode: 'formatted' | 'asSeen' = 'asSeen'
    let fellBack = ''
    let ads = prepared.stats?.ads ?? 0
    deps.progress?.('printing')
    if (wantClean) {
      const blocked = prepared.images.filter((image) => deps.isBlocked(image, url))
      const finalized = await contents.executeJavaScriptInIsolatedWorld(PDF_WORLD_ID, [{ code: finalizeScript({ blocked, mode: settings.mode === 'formatted' ? 'formatted' : 'auto' }) }]) as FinalizeResult
      check()
      if (finalized?.formatted && finalized.formatted.html.length < 40_000_000) {
        const article = finalized.formatted
        if (!meta.authors.length && article.byline && article.byline.length < 160) meta.authors = [article.byline.replace(/^by\s+/i, '')]
        if (!meta.lang && article.lang) meta.lang = article.lang
        if (article.dir === 'rtl') meta.dir = 'rtl'
        const html = buildPrintDocument({ articleHtml: article.html, meta, textSize: settings.textSize, citation: settings.citation, savedAt: new Date() })
        const allowed = new Set(prepared.images.filter((image) => !blocked.includes(image)))
        pdf = await printClean(html, allowed, url, paper, deps.cancelled)
        mode = 'formatted'
      } else {
        fellBack = finalized?.reason || 'no clear article'
      }
    }
    check()
    if (!pdf) {
      const asSeen = await printAsSeen(contents, meta, settings, paper, deps.adSelectors)
      pdf = asSeen.pdf
      ads = asSeen.ads
    }
    check()

    deps.progress?.('finishing')
    const host = hostOf(meta.canonicalUrl || url)
    const processed = await postprocessOffThread(pdf, {
      title: meta.title || host,
      authors: meta.authors,
      subject: meta.canonicalUrl || url,
      keywords: [meta.site, host, ...meta.keywords].filter(Boolean),
      lang: meta.lang,
      producer: `Intoponet ${deps.appVersion} (Chromium ${process.versions.chrome ?? ''})`,
    })
    const bytes = processed?.bytes ?? new Uint8Array(pdf)
    const pages = processed?.pages ?? countPdfPages(bytes)
    check()

    const filename = pdfFilename({ title: meta.title, site: meta.site, url, isPrivate: deps.isPrivate, date: new Date() })
    const target = await deps.destination(filename)
    if (!target) return { status: 'cancelled' }
    try {
      await writeFile(target.path, bytes)
    } catch (error) {
      target.release()
      throw error
    }
    if (!deps.isPrivate) await writeWhereFroms(target.path, [meta.canonicalUrl || url])
    return {
      status: 'saved',
      path: target.path,
      filename: target.path.split('/').pop() || filename,
      bytes: bytes.byteLength,
      pages,
      mode,
      fellBack,
      missingImages: mode === 'formatted' ? prepared.stats?.missingImages ?? 0 : 0,
      ads,
      url,
      title: meta.title || host,
    }
  } catch (error) {
    if (error instanceof Cancelled) return { status: 'cancelled' }
    return { status: 'failed', reason: error instanceof Error && error.message ? error.message : 'The PDF could not be made.' }
  }
}
