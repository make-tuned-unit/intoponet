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
  // Cut by characters, not UTF-16 units (half an emoji would show as "�").
  const cleaned = Array.from(base.replace(/[:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 120).join('').trim() || 'Page'
  return sanitizeDownloadFilename(`${cleaned}.${extension}`)
}

/**
 * Whether the page is a PDF shown in Chromium's viewer. Saving it must keep the PDF itself:
 * the viewer's own page is only a wrapper that points back at the address. A page too busy to
 * answer within `waitMs` is taken for a web page, so Save Page As still opens.
 */
export async function isPdfDocument(contents: { executeJavaScriptInIsolatedWorld: (worldId: number, scripts: Array<{ code: string }>) => Promise<unknown> }, worldId: number, waitMs = 1_500): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const answer = await Promise.race([
      contents.executeJavaScriptInIsolatedWorld(worldId, [{ code: 'document.contentType' }]),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), waitMs) }),
    ])
    return answer === 'application/pdf'
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
