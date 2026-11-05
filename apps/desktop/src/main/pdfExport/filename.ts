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
  // The site is left out when the title already names it ("BBC News – BBC News").
  if (site && !parts[0]!.toLowerCase().includes(site.toLowerCase())) parts.push(site)
  let base = parts.join(' – ')
  if (base.length > 120) base = `${base.slice(0, 119).trimEnd()}…`
  return `${base} – ${day}.pdf`
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
