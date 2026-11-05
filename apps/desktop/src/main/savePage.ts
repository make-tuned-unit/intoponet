import { sanitizeDownloadFilename } from './downloadReservation'

/** The suggested file name for Save Page As…: the page's title (or its site), as .html. */
export function savePageFilename(title: string, url: string): string {
  let base = title.trim()
  if (!base) {
    try {
      base = new URL(url).hostname
    } catch {
      base = ''
    }
  }
  // Characters Finder and other apps handle badly in names.
  const cleaned = base.replace(/[:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Page'
  return sanitizeDownloadFilename(`${cleaned}.html`)
}
