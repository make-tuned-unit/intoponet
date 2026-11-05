import { DEFAULT_PDF_EXPORT_OPTIONS, parsePdfExportOptions, type PdfExportOptions } from '@intoponet/browser-api'

/**
 * What Export as PDF does on a plain click. The last choices made in the options popover are kept,
 * so the toolbar button, ⌥⌘E and the page menu all save the same way.
 */
export type PdfExportSettings = PdfExportOptions
export type PdfPaper = PdfExportOptions['paper']
export type PdfTextSize = PdfExportOptions['textSize']
export const DEFAULT_PDF_SETTINGS = DEFAULT_PDF_EXPORT_OPTIONS
export const parsePdfSettings = parsePdfExportOptions

/** Letter in the countries that use it; A4 everywhere else. */
const LETTER_COUNTRIES = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT', 'CR', 'PA', 'DO', 'PR', 'SV', 'NI', 'HN', 'BO'])

export function resolvePaper(paper: PdfPaper, countryCode: string): 'A4' | 'Letter' {
  if (paper === 'a4') return 'A4'
  if (paper === 'letter') return 'Letter'
  return LETTER_COUNTRIES.has(countryCode.toUpperCase()) ? 'Letter' : 'A4'
}

export const TEXT_POINTS: Record<PdfTextSize, number> = { small: 10, medium: 11, large: 12.5 }
