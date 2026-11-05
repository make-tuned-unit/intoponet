import { PDFDocument, ParseSpeeds } from '@cantoo/pdf-lib'

export type PdfInfo = {
  title: string
  authors: string[]
  subject: string
  keywords: string[]
  lang: string
  producer: string
}

/**
 * Title, author, source, language and keywords written into the PDF, and Chromium's uncompressed
 * output packed into object streams (about a third of the size). The document is changed in place,
 * so the bookmarks (outline) and the accessibility tags survive.
 */
export async function postprocessPdf(bytes: Uint8Array, info: PdfInfo, now = new Date()): Promise<{ bytes: Uint8Array; pages: number }> {
  const doc = await PDFDocument.load(bytes, { parseSpeed: ParseSpeeds.Fastest, updateMetadata: false })
  if (info.title) doc.setTitle(info.title.slice(0, 300), { showInWindowTitleBar: true })
  if (info.authors.length) doc.setAuthor(info.authors.join('; ').slice(0, 300))
  if (info.subject) doc.setSubject(info.subject.slice(0, 2000))
  if (info.keywords.length) doc.setKeywords(info.keywords.slice(0, 16).map((keyword) => keyword.slice(0, 60)))
  if (/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(info.lang)) doc.setLanguage(info.lang)
  doc.setCreator('Intoponet')
  doc.setProducer(info.producer)
  doc.setCreationDate(now)
  doc.setModificationDate(now)
  const out = await doc.save({ useObjectStreams: true, objectsPerTick: Infinity })
  return { bytes: out, pages: doc.getPageCount() }
}
