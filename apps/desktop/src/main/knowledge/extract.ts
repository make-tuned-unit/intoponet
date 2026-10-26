import { KNOWLEDGE_LIMITS } from './contract'

/** Private isolated world for Absorb; never the page's main world. */
export const KNOWLEDGE_WORLD_ID = 1287

/**
 * Self-contained extraction script, run in an isolated world. It reads only
 * visible text, metadata and form *presence* signals — never form values —
 * and returns plain JSON. Everything it returns is treated as untrusted data.
 */
export const EXTRACT_SCRIPT = `(() => {
  const MAX_PARAS = ${KNOWLEDGE_LIMITS.paragraphs};
  const MAX_CHARS = ${KNOWLEDGE_LIMITS.textChars};
  const meta = (selector) => {
    const el = document.querySelector(selector);
    return el ? (el.getAttribute('content') || el.getAttribute('href') || el.getAttribute('datetime') || '') : '';
  };
  const SKIP = 'nav, aside, footer, header, form, script, style, noscript, template, svg, button, select, textarea, iframe, figure figcaption, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [hidden], [aria-hidden="true"], .reflist, .references, .mw-references-wrap, .refbegin, .navbox, .vertical-navbox, .sidebar, .infobox, .metadata, .hatnote, .mw-editsection, .toc, #toc, .catlinks, .printfooter, .citation, cite, sup.reference, [role="note"], [class*="footnote"], [class*="related"], [class*="newsletter"], [class*="share"], [class*="comments"]';
  // Back matter (references, notes, external links…) is not the article.
  const BACK_MATTER = /^(references|notes|citations|footnotes|sources|bibliography|further reading|external links|see also|related articles|read more|more stories|referencias|notas|véase también|enlaces externos|références|notes et références|voir aussi|liens externes|einzelnachweise|literatur|weblinks|siehe auch|referências|ligações externas|ver também|note|collegamenti esterni|voci correlate)$/i;
  const text = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
  const visible = (el) => el.getClientRects().length > 0;
  let root = document.querySelector('article') || document.querySelector('[role="main"]') || document.querySelector('main');
  if (!root) {
    const totals = new Map();
    for (const p of document.querySelectorAll('p')) {
      const parent = p.parentElement;
      if (!parent) continue;
      totals.set(parent, (totals.get(parent) || 0) + text(p).length);
    }
    let best = null;
    let bestLength = 0;
    for (const [el, length] of totals) if (length > bestLength) { best = el; bestLength = length; }
    root = best || document.body;
  }
  const paragraphs = [];
  let chars = 0;
  if (root) {
    let backMatter = false;
    for (const el of root.querySelectorAll('p, li, blockquote, h2, h3, h4, pre')) {
      if (paragraphs.length >= MAX_PARAS || chars >= MAX_CHARS) break;
      if (el.tagName === 'H2' || el.tagName === 'H3') {
        const heading = text(el).replace(/\[edit\]$/i, '').trim();
        if (BACK_MATTER.test(heading)) { backMatter = true; continue; }
        if (el.tagName === 'H2') backMatter = false;
      }
      if (backMatter) continue;
      if (el.closest(SKIP) || !visible(el)) continue;
      if (el.tagName === 'LI' && el.querySelector('p')) continue;
      if (el.parentElement && el.parentElement.closest('blockquote') && el.tagName !== 'BLOCKQUOTE') continue;
      const value = text(el);
      if (value.length < 2) continue;
      paragraphs.push(value.slice(0, MAX_CHARS - chars));
      chars += value.length;
    }
  }
  const pageHost = location.hostname;
  let outbound = 0;
  for (const a of document.querySelectorAll('a[href]')) {
    try { if (new URL(a.href).hostname !== pageHost) outbound += 1; } catch (e) {}
  }
  const selection = String(window.getSelection ? window.getSelection() : '').slice(0, MAX_CHARS);
  return {
    url: location.href,
    canonical: meta('link[rel="canonical"]'),
    title: (meta('meta[property="og:title"]') || document.title || '').trim(),
    siteName: meta('meta[property="og:site_name"]'),
    lang: document.documentElement.getAttribute('lang') || '',
    publishedAt: meta('meta[property="article:published_time"]') || meta('time[datetime]'),
    linkCount: outbound,
    selection,
    password: !!document.querySelector('input[type="password"]'),
    payment: !!document.querySelector('input[autocomplete^="cc-"], input[name*="card" i][inputmode="numeric"]'),
    paragraphs,
  };
})()`

export type PageExtraction = {
  url: string
  canonical: string | null
  title: string
  siteName: string | null
  lang: string | null
  publishedAt: string | null
  linkCount: number
  selection: string
  password: boolean
  payment: boolean
  paragraphs: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Strip control characters and collapse whitespace. */
export function cleanText(value: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? cleanText(value, max) : ''
}

function httpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/** Validate the isolated script's result as untrusted input (LAY-006). */
export function parseExtraction(raw: unknown): PageExtraction | null {
  if (!isRecord(raw)) return null
  const url = httpUrl(str(raw['url'], 4_096))
  if (!url) return null
  const paragraphs: string[] = []
  let chars = 0
  if (Array.isArray(raw['paragraphs'])) {
    for (const item of raw['paragraphs']) {
      if (paragraphs.length >= KNOWLEDGE_LIMITS.paragraphs || chars >= KNOWLEDGE_LIMITS.textChars) break
      const value = str(item, KNOWLEDGE_LIMITS.textChars - chars)
      if (value.length < 2) continue
      paragraphs.push(value)
      chars += value.length
    }
  }
  const published = str(raw['publishedAt'], 64)
  const publishedAt = published && Number.isFinite(Date.parse(published)) ? new Date(published).toISOString() : null
  const lang = str(raw['lang'], 35)
  const linkCount = typeof raw['linkCount'] === 'number' && Number.isFinite(raw['linkCount']) ? Math.max(0, Math.min(100_000, Math.round(raw['linkCount']))) : 0
  return {
    url,
    canonical: httpUrl(str(raw['canonical'], 4_096)),
    title: str(raw['title'], KNOWLEDGE_LIMITS.titleLength),
    siteName: str(raw['siteName'], 120) || null,
    lang: /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(lang) ? lang : null,
    publishedAt,
    linkCount,
    selection: typeof raw['selection'] === 'string' ? raw['selection'].slice(0, KNOWLEDGE_LIMITS.textChars) : '',
    password: raw['password'] === true,
    payment: raw['payment'] === true,
    paragraphs,
  }
}

/** Split a selection into paragraphs on blank lines / line breaks. */
export function selectionParagraphs(selection: string): string[] {
  return selection
    .split(/\n\s*\n|\r?\n/)
    .map((part) => cleanText(part, KNOWLEDGE_LIMITS.textChars))
    .filter((part) => part.length >= 2)
    .slice(0, KNOWLEDGE_LIMITS.paragraphs)
}
