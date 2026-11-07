import { sanitizeDownloadFilename } from './downloadReservation'

/**
 * The suggested file name for Save Page As…: the page's title (or its site), as .html, or as .pdf
 * for a PDF (whose title is often its file name already: "report.pdf" stays "report.pdf").
 */
export function savePageFilename(title: string, url: string, extension: 'html' | 'pdf' = 'html'): string {
  let base = title.trim()
  if (!base) {
    try {
      base = new URL(url).hostname
    } catch {
      base = ''
    }
  }
  if (extension === 'pdf') base = base.replace(/\.pdf$/i, '').trim()
  // Characters Finder and other apps handle badly in names.
  const cleaned = base.replace(/[:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Page'
  return sanitizeDownloadFilename(`${cleaned}.${extension}`)
}

/**
 * Whether the page is a PDF shown in Chromium's viewer. Saving it must keep the PDF itself:
 * the viewer's own page is only a wrapper that points back at the address.
 */
export async function isPdfDocument(contents: { executeJavaScriptInIsolatedWorld: (worldId: number, scripts: Array<{ code: string }>) => Promise<unknown> }, worldId: number): Promise<boolean> {
  try {
    return (await contents.executeJavaScriptInIsolatedWorld(worldId, [{ code: 'document.contentType' }])) === 'application/pdf'
  } catch {
    return false
  }
}
