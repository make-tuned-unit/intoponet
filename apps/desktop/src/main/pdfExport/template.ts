import { TEXT_POINTS, type PdfTextSize } from './settings'

/** What the page says about itself (from citation tags, JSON-LD, Open Graph…). All untrusted text. */
export type PageMeta = {
  title: string
  authors: string[]
  site: string
  published: string
  modified: string
  url: string
  canonicalUrl: string
  doi: string
  lang: string
  dir: 'ltr' | 'rtl' | ''
  description: string
  keywords: string[]
}

export const PRINT_CSP = "default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline'"

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

/** A CSS string literal: quotes, backslashes and line breaks escaped, so it cannot end the rule. */
export const cssString = (value: string): string =>
  `"${value.replace(/[\\"]/g, '\\$&').replace(/[\r\n\f]+/g, ' ').replace(/[<>]/g, ' ')}"`

const httpOnly = (value: string): string => (/^https?:\/\//i.test(value) ? value : '')

/** "2026-03-04T…" → "4 March 2026" (in English, the PDF's own wording); anything else as given. */
export function readableDate(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  // Only machine dates are reworded ("2026-03-04", "2026-03-04T10:00:00Z"); "Spring 1999" stays as written.
  const time = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(trimmed) ? Date.parse(trimmed) : Number.NaN
  if (!Number.isFinite(time)) return trimmed.slice(0, 40)
  return new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * The document printed in Formatted mode: a source block, then the sanitized article, set for
 * paper (serif body, about 70 characters a line, page footer with the title and page numbers).
 */
export function buildPrintDocument(input: {
  articleHtml: string
  meta: PageMeta
  textSize: PdfTextSize
  citation: boolean
  savedAt: Date
}): string {
  const { meta } = input
  const title = meta.title.trim() || hostOf(meta.url) || 'Saved page'
  const source = httpOnly(meta.canonicalUrl) || httpOnly(meta.url)
  const host = hostOf(source)
  const shortTitle = title.length > 70 ? `${title.slice(0, 68).trimEnd()}…` : title
  const points = TEXT_POINTS[input.textSize]
  const lang = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(meta.lang) ? meta.lang : ''
  const dir = meta.dir === 'rtl' ? 'rtl' : 'ltr'

  const rows: string[] = []
  const row = (label: string, value: string) => rows.push(`<div><dt>${label}</dt><dd>${value}</dd></div>`)
  if (meta.published) row('Published', escapeHtml(readableDate(meta.published)))
  if (meta.modified && readableDate(meta.modified) !== readableDate(meta.published)) row('Updated', escapeHtml(readableDate(meta.modified)))
  if (source) row('Source', `<a href="${escapeHtml(source)}">${escapeHtml(source.length > 110 ? `${source.slice(0, 108)}…` : source)}</a>`)
  if (/^10\.\d{4,9}\/\S+$/.test(meta.doi)) row('DOI', `<a href="https://doi.org/${escapeHtml(meta.doi)}">${escapeHtml(meta.doi)}</a>`)
  row('Saved', `${escapeHtml(input.savedAt.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' }))} with Intoponet`)

  const header = input.citation
    ? `<header class="source">
  ${meta.site || host ? `<p class="site">${escapeHtml(meta.site || host)}</p>` : ''}
  <h1>${escapeHtml(title)}</h1>
  ${meta.authors.length ? `<p class="byline">${escapeHtml(meta.authors.slice(0, 8).join(', '))}</p>` : ''}
  <dl>${rows.join('')}</dl>
</header>`
    : `<header class="plain"><h1>${escapeHtml(title)}</h1></header>`

  const footer = input.citation
    ? `@page { @bottom-left { content: ${cssString(host ? `${shortTitle} · ${host}` : shortTitle)}; } @bottom-right { content: counter(page) " / " counter(pages); } }
@page :first { @bottom-left { content: none; } }`
    : '@page { @bottom-right { content: counter(page) " / " counter(pages); } }'

  return `<!doctype html>
<html${lang ? ` lang="${escapeHtml(lang)}"` : ''} dir="${dir}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}">
<title>${escapeHtml(title)}</title>
<style>
@page { margin: 19mm 22mm 21mm; }
@page { @bottom-left { font: 7.5pt -apple-system, "Helvetica Neue", sans-serif; color: #6b6b6b; } @bottom-right { font: 7.5pt -apple-system, "Helvetica Neue", sans-serif; color: #6b6b6b; } }
${footer}
:root { color-scheme: light; }
html { background: #fff; }
body { margin: 0 auto; max-width: 36em; color: #141414; background: #fff; font: ${points}pt/1.48 "Iowan Old Style", "Charter", "Palatino", Georgia, "Hiragino Mincho ProN", "Songti SC", "Geeza Pro", serif; text-align: start; hyphens: auto; -webkit-hyphens: auto; overflow-wrap: break-word; }
a { color: #1a4f8b; text-decoration: none; }
header.source { margin: 0 0 1.6em; padding-bottom: 1em; border-bottom: 0.6pt solid #c9c9c9; }
header .site { margin: 0 0 0.4em; font: 600 8pt -apple-system, "Helvetica Neue", sans-serif; letter-spacing: 0.06em; text-transform: uppercase; color: #6b6b6b; }
header h1 { margin: 0 0 0.35em; font-size: 2em; line-height: 1.15; }
header.plain h1 { margin-bottom: 1em; }
header .byline { margin: 0 0 0.8em; font-style: italic; }
header dl { margin: 0; font: 8pt/1.5 -apple-system, "Helvetica Neue", sans-serif; color: #4a4a4a; }
header dl div { display: flex; gap: 0.8em; }
header dt { flex: 0 0 5.5em; color: #8a8a8a; }
header dd { margin: 0; overflow-wrap: anywhere; }
article h1, article h2, article h3, article h4, article h5, article h6 { line-height: 1.2; break-after: avoid; page-break-after: avoid; margin: 1.4em 0 0.5em; }
article h2 { font-size: 1.4em; } article h3 { font-size: 1.2em; } article h4, article h5, article h6 { font-size: 1em; }
p { margin: 0 0 0.75em; orphans: 3; widows: 3; }
img, svg, video, canvas { max-width: 100%; height: auto; }
img, figure, pre, blockquote, li { break-inside: avoid; page-break-inside: avoid; }
img { max-height: 52vh; object-fit: contain; }
figure { margin: 1.2em 0; }
figcaption { margin-top: 0.4em; font: 8.5pt/1.4 -apple-system, "Helvetica Neue", sans-serif; color: #555; }
blockquote { margin: 1em 0; padding-inline-start: 1em; border-inline-start: 2pt solid #d4d4d4; color: #333; }
pre, code, kbd, samp { font-family: "SF Mono", Menlo, Monaco, monospace; font-size: 0.84em; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: 0.7em 0.9em; background: #f4f4f2; border-radius: 3pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
code { background: #f4f4f2; padding: 0 0.15em; border-radius: 2pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
pre code { background: none; padding: 0; }
table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.86em; }
thead { display: table-header-group; }
th, td { padding: 0.3em 0.5em; border-bottom: 0.5pt solid #d0d0d0; text-align: start; vertical-align: top; }
th { background: #f1f1ef; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
hr { border: 0; border-top: 0.6pt solid #ccc; margin: 1.5em 0; }
sup, sub { line-height: 0; }
ul, ol { padding-inline-start: 1.4em; }
math { font-size: 1.05em; }
</style>
</head>
<body>
${header}
<article>
${input.articleHtml}
</article>
</body>
</html>`
}
