/**
 * "Title – Site – 2026-11-05.pdf". Private tabs get a neutral name, so nothing about the page
 * shows up in Finder, Spotlight or recent files.
 */
export function pdfFilename(input: { title: string; site: string; url: string; isPrivate: boolean; date: Date }): string {
  const day = isoDay(input.date)
  if (input.isPrivate) return `Saved page ${day}.pdf`
  let host = ''
  try {
    host = new URL(input.url).hostname.replace(/^www\./, '')
  } catch {
    // Not a URL: no site part.
  }
  const title = clean(input.title)
  const site = clean(input.site) || host
  const parts = [title || host || 'Page']
  // The site is left out when the title already names it ("BBC News – BBC News", "BBC News - Home – bbc.com").
  if (site && !namesSite(parts[0]!, site)) parts.push(site)
  let base = parts.join(' – ')
  // Cut by characters, not UTF-16 units: half an emoji is not a character, and Finder would show "�".
  const characters = Array.from(base)
  if (characters.length > 120) base = `${characters.slice(0, 119).join('').trimEnd()}…`
  return `${base} – ${day}.pdf`
}

/**
 * What a PDF shown in the viewer is called: its title (the tab's, from the PDF itself), else its file
 * name, without ".pdf" ("Annual report.pdf" → "Annual report"). '' when it has neither. The viewer's own
 * page has no title of its own, so without this the file would only be named after the site.
 */
export function pdfDocumentTitle(tabTitle: string, url: string): string {
  const strip = (value: string): string => value.trim().replace(/\.pdf$/i, '').trim()
  let address: URL | null = null
  try {
    address = new URL(url)
  } catch {
    // Not a URL: no file name either.
  }
  const title = tabTitle.trim()
  // A page with no title of its own is titled with its address.
  const untitled = !title || title === url || (address !== null && (title === `${address.host}${address.pathname}` || title === address.href.replace(/^https?:\/\//, '')))
  if (!untitled && strip(title)) return strip(title)
  if (!address) return ''
  const last = address.pathname.split('/').filter(Boolean).pop() ?? ''
  try {
    return strip(decodeURIComponent(last))
  } catch {
    return strip(last)
  }
}

function namesSite(title: string, site: string): boolean {
  const lower = title.toLowerCase()
  if (lower.includes(site.toLowerCase())) return true
  // A host ("bbc.co.uk") is named by its main label ("bbc").
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(site)) return false
  const labels = site.toLowerCase().split('.')
  const main = labels.length > 2 && labels[labels.length - 2]!.length <= 3 ? labels[labels.length - 3]! : labels[labels.length - 2]!
  return main.length >= 3 && new RegExp(`(^|[^a-z0-9])${main}([^a-z0-9]|$)`).test(lower)
}

function isoDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function clean(value: string): string {
  return value
    .normalize('NFC')
    // Characters Finder and other apps handle badly, control and bidi characters.
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim()
}
