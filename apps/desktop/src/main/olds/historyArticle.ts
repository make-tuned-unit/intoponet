import type { OldsChapter, OldsDate } from '@intoponet/browser-api'

/**
 * Chapters of a place's history from its Wikipedia "History of …" article:
 * the article's own section structure, the years its text mentions, the first
 * sentence of each section, and the section's "Main article" link. This is
 * what the article says, attributed to it; nothing is inferred.
 */

const SKIP_SECTIONS = /^(see also|notes|references|bibliography|sources|further reading|external links|gallery|footnotes|citations|works cited|explanatory notes|primary sources|secondary sources|historiography|reading list|image gallery|images|timeline|chronology|history by region|list of rulers|rulers)$/i
const MAX_CHAPTERS = 28

/** `anchor`: the heading's id on the rendered page, or null when it cannot be told (the link then opens the article). */
type Section = { level: number; title: string; body: string; anchor?: string | null }

/** Dash and space templates, which are part of the text ("1948{{Non breaking en dash}}1957" is "1948–1957"). */
const DASH_TEMPLATE = /\{\{\s*(non[ -]breaking en dash|nbnd|ndash|en dash|snd|spnd|spaced ndash|spaced en dash|mdash|em dash|nbsp|spaces?)\s*\}\}/gi
function dashText(name: string): string {
  const key = name.toLowerCase()
  if (/^(snd|spnd|spaced)/.test(key)) return ' – '
  if (/^(mdash|em dash)$/.test(key)) return '—'
  if (/^(nbsp|spaces?)$/.test(key)) return ' '
  return '–'
}

/** The id MediaWiki gives a heading: its rendered text with underscores for spaces. */
export function headingAnchor(raw: string): string | null {
  // "Non breaking en dash" renders with a zero-width joiner on each side, which is part of the id.
  const text = raw.replace(DASH_TEMPLATE, (_, name: string) => (/^(non[ -]breaking en dash|nbnd)$/i.test(name) ? '‍–‍' : dashText(name)))
  // Any other template renders in ways that cannot be told from here.
  if (/\{\{|<(?!\/?(?:i|b|em|strong|small|span|nowiki)\b)/i.test(text)) return null
  return stripWikitext(text).replace(/ /g, '_')
}

export function splitSections(wikitext: string): Section[] {
  const sections: Section[] = []
  let current: Section | null = null
  for (const line of wikitext.split('\n')) {
    const heading = line.match(/^(={2,4})\s*(.*?)\s*\1\s*$/)
    if (heading) {
      current = { level: heading[1]!.length - 1, title: stripWikitext(heading[2]!), body: '', anchor: headingAnchor(heading[2]!) }
      sections.push(current)
    } else if (current) {
      current.body += `${line}\n`
    }
  }
  return sections
}

/** Keep the visible text of inline templates ({{lang|fr|Les Nouvelles}} → Les Nouvelles, {{convert|80|km}} → 80 km, dashes). */
export function inlineTemplateText(text: string): string {
  return text
    .replace(/\{\{\s*(?:lang|langx|lang-[a-z-]+|transl|nowrap|nobr|small|nihongo|ill|interlanguage link)\s*\|(?:[^{}|]*\|)*?([^{}|=]+)\}\}/gi, '$1')
    .replace(/\{\{\s*(?:convert|cvt)\s*\|\s*([\d.,]+)\s*\|\s*([^{}|]+?)\s*(?:\|[^{}]*)?\}\}/gi, '$1 $2')
    .replace(DASH_TEMPLATE, (_, name: string) => dashText(name))
}

/** Wikitext → readable plain text (templates, refs, files and markup removed). */
export function stripWikitext(text: string): string {
  let out = text
    .replace(/<!--[\s\S]*?-->/g, '')
    // Galleries, maps, timelines and graphs are markup, not prose.
    .replace(/<(gallery|mapframe|maplink|timeline|graph|imagemap|score|math|syntaxhighlight)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Bare gallery lines ("Copan.jpg|caption"), but not prose that follows an inline [[File:…]] link.
    .replace(/^(?!\s*\[\[)[^|\n[\]]{0,200}\.(jpe?g|png|svg|gif|tiff?|webp)\s*\|.*$/gim, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
  out = inlineTemplateText(out)
  // Nested templates and tables: remove innermost first.
  for (let i = 0; i < 6; i += 1) {
    const next = out.replace(/\{\{[^{}]*\}\}/g, '').replace(/\{\|[^{}]*?\|\}/g, '')
    if (next === out) break
    out = next
  }
  out = removeFileLinks(out)
        .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/[^\s\]]+\s*([^\]]*)\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
  // Drop stray JSON or table fragments left by templates that hold code ("map" } ]).
  out = out.split('\n').filter((line) => !/^\s*[}\]"|!{]/.test(line)).join('\n')
  return out.replace(/\s+/g, ' ').trim()
}

/** Remove [[File:…]] / [[Image:…]] links, which can nest other links inside their captions. */
function removeFileLinks(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const rest = text.slice(i, i + 8).toLowerCase()
    if (rest.startsWith('[[file:') || rest.startsWith('[[image:')) {
      let depth = 0
      let j = i
      for (; j < text.length - 1; j += 1) {
        if (text[j] === '[' && text[j + 1] === '[') { depth += 1; j += 1 }
        else if (text[j] === ']' && text[j + 1] === ']') { depth -= 1; j += 1; if (depth === 0) break }
      }
      i = j + 1
      continue
    }
    out += text[i]
    i += 1
  }
  return out
}

/** The first one or two sentences, up to `max` characters. */
export function leadSentences(input: string, max = 280): string | null {
  let plain = input
  if (!plain) return null
  // A leading fragment left by removed markup (a stray quote, bracket or closing parenthesis) is dropped.
  plain = plain.replace(/^[\s"'“”)\]}|:;,.]+/, '')
  if (!plain) return null
  // Protect decimals and initials ("4.6%", "U.S.") from being read as sentence ends.
  const guarded = plain
    .replace(/(\d)\.(\d)/g, '$1\u2024$2')
    .replace(/\b([A-Z])\.(?=[A-Z]\.)/g, '$1\u2024')
    // Abbreviations: "(r. 927–969)", "(c. 800 BCE)", "i.e.", "St.", "J. Smith".
    .replace(/\b(r|c|ca|b|d|fl|St|Mt|Dr|Mr|Mrs|Ms|No|vs|al|approx|est|Jr|Sr|Gen|Col|Lt|Rev|Prof|Fr|Hon|Sgt|Capt|Gov|Pres|Ft|Ave|Co|Inc|Ltd|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.(?=\s)/g, '$1\u2024')
    .replace(/\b(i|e)\.(e|g)\./gi, '$1\u2024$2\u2024')
    .replace(/\b([A-Z])\.(?=\s+[A-Z])/g, '$1\u2024')
  const sentences = (guarded.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? [guarded]).map((sentence) => sentence.replace(/\u2024/g, '.'))
  let out = ''
  for (const sentence of sentences) {
    if (out && (out + sentence).length > max) break
    out += sentence
    if (out.length > 120) break
  }
  out = out.trim()
  return out ? (out.length > max ? `${out.slice(0, max - 1)}…` : out) : null
}

/**
 * Years named in the text, BC as negative. Four-digit years from 500 to now,
 * and explicit BC/BCE/AD years of any size. Bare small numbers are ignored
 * (they are usually counts or page numbers).
 */
export function yearsIn(plain: string, currentYear: number): number[] {
  const years: number[] = []
  const bc = /\b(?:c\.\s*)?(\d{1,6}(?:,\d{3})?)\s*(BCE|BC)\b/g
  for (const match of plain.matchAll(bc)) years.push(-Number(match[1]!.replace(/,/g, '')))
  const ad = /\bAD\s*(\d{1,4})\b|\b(\d{1,4})\s*(?:AD|CE)\b/g
  for (const match of plain.matchAll(ad)) years.push(Number(match[1] ?? match[2]))
  // Citation years such as "(1984)" or "Smith 1984:" are about sources, not events.
  const withoutEras = plain.replace(bc, ' ').replace(ad, ' ').replace(/\(\s*\d{4}[a-z]?\s*[),:;]/g, ' ').replace(/\b\d{4}[a-z]?\s*:\s*\d/g, ' ')
  for (const match of withoutEras.matchAll(/\b(1\d{3}|20\d{2}|[5-9]\d{2})s?\b/g)) {
    const year = Number(match[1])
    if (year >= 500 && year <= currentYear) years.push(year)
  }
  return years.filter((year) => Number.isFinite(year) && year !== 0)
}

export function yearDate(year: number, approximate: boolean): OldsDate {
  const negative = year < 0
  const abs = Math.abs(year)
  const label = `${approximate ? 'c. ' : ''}${abs}${negative ? ' BC' : ''}`
  return { iso: `${negative ? '-' : ''}${String(abs).padStart(4, '0')}`, precision: 'year', label }
}

/** A span that ignores stray outliers: from the 15th to the 85th percentile of the years named. */
export function spanOf(years: number[]): { start: number; end: number } | null {
  if (!years.length) return null
  const sorted = [...years].sort((a, b) => a - b)
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!
  return sorted.length < 4 ? { start: sorted[0]!, end: sorted[sorted.length - 1]! } : { start: at(0.15), end: at(0.85) }
}

/** A chapter whose own heading says it ended long ago ("President de Gaulle, 1958–1969") is not where a country is now. */
export function endedLongAgo(chapter: OldsChapter, year: number): boolean {
  const end = chapter.title.match(/\d{3,4}\s*[–-]\s*(\d{3,4})\s*\)?\s*$/)?.[1]
  return !!end && Number(end) < year - 25
}

/** The section's own text plus its subsections, by (plain) heading. */
export function sectionWithSubsections(wikitext: string, title: string): string | null {
  const sections = splitSections(wikitext)
  const index = sections.findIndex((section) => section.title === title)
  if (index < 0) return null
  const level = sections[index]!.level
  let body = sections[index]!.body
  // An empty heading ("2020s" with no text) owns the same-level sections after it, up to the next parent heading.
  const emptyHeading = !body.trim()
  for (const next of sections.slice(index + 1)) {
    if (next.level < level || (next.level === level && !emptyHeading)) break
    body += `\n${next.body}`
  }
  return body
}

/** Article links in wikitext, in order (no files, categories or other namespaces). */
export function articleLinks(body: string, limit = 60): string[] {
  const out: string[] = []
  // Links inside references and templates are sources and boxes, not the chapter's story.
  let prose = body.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
  for (let i = 0; i < 6; i += 1) {
    const next = prose.replace(/\{\{[^{}]*\}\}/g, '')
    if (next === prose) break
    prose = next
  }
  for (const match of prose.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
    const target = match[1]!.trim()
    if (!target || /^(file|image|category|wikipedia|wp|help|template|portal|special|wikt|wiktionary|s|commons|w|media):/i.test(target)) continue
    const title = target.charAt(0).toUpperCase() + target.slice(1)
    if (!out.includes(title)) out.push(title)
    if (out.length >= limit) break
  }
  return out
}

export function mainArticleOf(body: string): string | null {
  const match = body.match(/\{\{\s*(?:Main|main article|Further)\s*\|\s*([^|}]+)/i) ?? body.match(/\{\{\s*See also\s*\|\s*([^|}]+)/i)
  if (!match) return null
  const title = match[1]!.split('#')[0]!.trim()
  return title && !/[<>[\]{}]/.test(title) ? title : null
}

export function sectionUrl(articleTitle: string, section: string, lang = 'en', anchor?: string | null): string {
  const page = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(articleTitle.replace(/ /g, '_'))}`
  if (anchor === null) return page
  return `${page}#${encodeURIComponent(anchor ?? section.replace(/ /g, '_'))}`
}

export function chaptersFromWikitext(articleTitle: string, wikitext: string, currentYear: number, lang = 'en'): OldsChapter[] {
  const chapters: OldsChapter[] = []
  let skippingParent = false
  for (const [index, section] of splitSections(wikitext).entries()) {
    if (section.level === 1) skippingParent = SKIP_SECTIONS.test(section.title)
    // Deeper sections count only when their heading is dated, e.g. "Saakashvili presidency (2004–2013)".
    const datedHeading = /\d{3,4}\s*[–-]\s*(\d{2,4}|present)/i.test(section.title)
    if ((section.level > 2 && !datedHeading) || skippingParent || SKIP_SECTIONS.test(section.title) || !section.title) continue
    const plain = stripWikitext(section.body)
    if (/^\*/.test(plain)) continue // a list of works, not narrative
    const range = section.title.match(/(?:c\.\s*)?(\d{1,4})\s*(BCE|BC)?\s*[–-]\s*(\d{1,4})\s*(BCE|BC)?/)
    const fromTitle = range
      ? [(range[2] ? -1 : 1) * Number(range[1]), (range[4] ? -1 : 1) * Number(range[3])].filter((year) => year !== 0 && Math.abs(year) <= currentYear)
      : yearsIn(section.title, currentYear)
    // Deep time ("20 million years ago") with no BC dates: modern years in the text are discoveries, not the era.
    const deepTime = /million years|years ago|\bBP\b/i.test(plain) && !/\b(BCE|BC)\b/.test(plain)
    const span = fromTitle.length ? { start: Math.min(...fromTitle), end: Math.max(...fromTitle) } : deepTime ? null : spanOf(yearsIn(plain, currentYear))
    const main = mainArticleOf(section.body)
    chapters.push({
      id: `ch-${index}`,
      title: section.title.slice(0, 160),
      level: section.level === 1 ? 1 : 2,
      start: span ? yearDate(span.start, !fromTitle.length) : null,
      end: span && span.end !== span.start ? yearDate(span.end, !fromTitle.length) : null,
      summary: leadSentences(plain),
      url: sectionUrl(articleTitle, section.title, lang, section.anchor),
      mainArticle: main ? { title: main, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(main.replace(/ /g, '_'))}` } : null,
    })
  }
  // Long articles (Russia has 60+ sections): keep the eras (top-level sections) and dated subsections, so the
  // story still reaches the present.
  let kept = chapters
  if (kept.length > MAX_CHAPTERS) kept = kept.filter((chapter) => chapter.level === 1 || /\d{3,4}\s*[–-]\s*(\d{2,4}|present)/i.test(chapter.title))
  if (kept.length > MAX_CHAPTERS) kept = kept.filter((chapter) => chapter.level === 1)
  return datedParents(dropOutOfOrderSpans(kept.slice(0, MAX_CHAPTERS * 2)))
}

/** A top-level chapter with no dates of its own spans its subsections. */
function datedParents(chapters: OldsChapter[]): OldsChapter[] {
  return chapters.map((chapter, index) => {
    if (chapter.level !== 1 || chapter.start) return chapter
    const children: OldsChapter[] = []
    for (const next of chapters.slice(index + 1)) {
      if (next.level === 1) break
      children.push(next)
    }
    const dated = children.filter((child) => child.start)
    if (!dated.length) return chapter
    return { ...chapter, start: dated[0]!.start, end: dated[dated.length - 1]!.end ?? dated[dated.length - 1]!.start }
  })
}

/** A chapter whose dates land long after the chapters that follow it is misdated (e.g. by citation years): drop its dates. */
function dropOutOfOrderSpans(chapters: OldsChapter[]): OldsChapter[] {
  const year = (date: OldsChapter['start']): number | null => (date ? Number(date.iso) : null)
  return chapters.map((chapter, index) => {
    const start = year(chapter.start)
    if (start === null) return chapter
    const later = chapters.slice(index + 1, index + 4).map((item) => year(item.end ?? item.start)).filter((value): value is number => value !== null)
    return later.some((end) => end < start - 50) ? { ...chapter, start: null, end: null } : chapter
  })
}

/** The chapter a year falls in: the most specific (subsection, then shortest span). */
export function chapterForYear(chapters: OldsChapter[], year: number, currentYear = new Date().getUTCFullYear()): OldsChapter | null {
  // Recent events belong to the latest chapter that has begun (text-derived ends are unreliable near the present).
  if (year >= currentYear - 20) {
    let latest: { chapter: OldsChapter; start: number } | null = null
    for (const chapter of chapters) {
      if (endedLongAgo(chapter, year)) continue
      const match = chapter.start?.iso.match(/^(-?\d{1,6})/)
      const start = match ? Number(match[1]) : null
      if (start === null || start > year) continue
      // Ties go to the later section in the article (it continues the story).
      if (!latest || start >= latest.start) latest = { chapter, start }
    }
    if (latest) return latest.chapter
  }
  const num = (date: OldsDate | null): number | null => {
    const match = date?.iso.match(/^(-?\d{1,6})/)
    return match ? Number(match[1]) : null
  }
  let best: OldsChapter | null = null
  let bestSpan = Infinity
  for (const chapter of chapters) {
    const start = num(chapter.start)
    const end = num(chapter.end) ?? start
    if (start === null || end === null || year < start || year > end) continue
    const span = end - start
    if (!best || chapter.level > best.level || (chapter.level === best.level && span < bestSpan)) {
      best = chapter
      bestSpan = span
    }
  }
  return best
}
