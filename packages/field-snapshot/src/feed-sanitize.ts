/**
 * Tolerant pre-pass for real-world news feeds, run before the strict parser.
 *
 * Only metadata (title, link, id, dates) is ever read from a feed, so this
 * removes the parts that carry article bodies and media — the usual source of
 * oversized text, HTML entities and undeclared prefixes — and repairs common
 * publisher mistakes. It never weakens the strict parser's safety rules:
 * documents with entity declarations or an internal DTD subset stay rejected.
 */
export const FEED_SANITIZE_LIMITS = {
  /** Raw bytes accepted before body stripping. */
  rawBytes: 4_000_000,
} as const

/** Elements whose content Intoponet never reads. */
const BODY_ELEMENTS = [
  'content:encoded', 'description', 'summary', 'content', 'media:[\\w.-]+', 'itunes:[\\w.-]+',
  'enclosure', 'image', 'thumbnail', 'body', 'fullText', 'yandex:full-text', 'turbo:content',
  'dc:description', 'excerpt:encoded', 'wfw:[\\w.-]+', 'slash:[\\w.-]+', 'georss:[\\w.-]+',
  'feedburner:[\\w.-]+', 'snf:[\\w.-]+', 'atom:link',
]

/** Common HTML named entities seen in feed titles, mapped to code points. */
const HTML_ENTITIES: Record<string, number> = {
  nbsp: 160, iexcl: 161, cent: 162, pound: 163, curren: 164, yen: 165, brvbar: 166, sect: 167, uml: 168, copy: 169,
  ordf: 170, laquo: 171, not: 172, shy: 173, reg: 174, macr: 175, deg: 176, plusmn: 177, sup2: 178, sup3: 179,
  acute: 180, micro: 181, para: 182, middot: 183, cedil: 184, sup1: 185, ordm: 186, raquo: 187, frac14: 188,
  frac12: 189, frac34: 190, iquest: 191, Agrave: 192, Aacute: 193, Acirc: 194, Atilde: 195, Auml: 196, Aring: 197,
  AElig: 198, Ccedil: 199, Egrave: 200, Eacute: 201, Ecirc: 202, Euml: 203, Igrave: 204, Iacute: 205, Icirc: 206,
  Iuml: 207, ETH: 208, Ntilde: 209, Ograve: 210, Oacute: 211, Ocirc: 212, Otilde: 213, Ouml: 214, times: 215,
  Oslash: 216, Ugrave: 217, Uacute: 218, Ucirc: 219, Uuml: 220, Yacute: 221, THORN: 222, szlig: 223, agrave: 224,
  aacute: 225, acirc: 226, atilde: 227, auml: 228, aring: 229, aelig: 230, ccedil: 231, egrave: 232, eacute: 233,
  ecirc: 234, euml: 235, igrave: 236, iacute: 237, icirc: 238, iuml: 239, eth: 240, ntilde: 241, ograve: 242,
  oacute: 243, ocirc: 244, otilde: 245, ouml: 246, divide: 247, oslash: 248, ugrave: 249, uacute: 250, ucirc: 251,
  uuml: 252, yacute: 253, thorn: 254, yuml: 255, OElig: 338, oelig: 339, Scaron: 352, scaron: 353, Yuml: 376,
  fnof: 402, circ: 710, tilde: 732, ensp: 8194, emsp: 8195, thinsp: 8201, zwnj: 8204, zwj: 8205, lrm: 8206,
  rlm: 8207, ndash: 8211, mdash: 8212, lsquo: 8216, rsquo: 8217, sbquo: 8218, ldquo: 8220, rdquo: 8221,
  bdquo: 8222, dagger: 8224, Dagger: 8225, bull: 8226, hellip: 8230, permil: 8240, prime: 8242, Prime: 8243,
  lsaquo: 8249, rsaquo: 8250, euro: 8364, trade: 8482, larr: 8592, rarr: 8594, minus: 8722,
}
const XML_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos'])

function stripBodies(xml: string): string {
  let out = xml
  for (const name of BODY_ELEMENTS) {
    // Self-closing first, then paired (non-greedy to the matching close tag).
    out = out.replace(new RegExp(`<(${name})\\b[^>]*?/>`, 'g'), '')
    out = out.replace(new RegExp(`<(${name})\\b[^>]*>[\\s\\S]*?</\\1\\s*>`, 'g'), '')
  }
  return out
}

function repairEntities(xml: string): string {
  return xml
    // A bare "&" that does not start a reference becomes "&amp;".
    .replace(/&(?!(?:#\d{1,7}|#x[0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});)/g, '&amp;')
    .replace(/&([A-Za-z][A-Za-z0-9]{1,31});/g, (match, name: string) => {
      if (XML_ENTITIES.has(name)) return match
      const code = HTML_ENTITIES[name]
      return code ? `&#${code};` : `&amp;${name};`
    })
}

function bindPrefixes(xml: string): string {
  const declared = new Set([...xml.matchAll(/\sxmlns:([A-Za-z_][\w.-]*)\s*=/g)].map((match) => match[1]!))
  const used = new Set<string>()
  for (const match of xml.matchAll(/<\/?([A-Za-z_][\w.-]*):[A-Za-z_][\w.-]*/g)) used.add(match[1]!)
  for (const match of xml.matchAll(/\s([A-Za-z_][\w.-]*):[A-Za-z_][\w.-]*\s*=/g)) used.add(match[1]!)
  const missing = [...used].filter((prefix) => prefix !== 'xml' && prefix !== 'xmlns' && !declared.has(prefix))
  if (!missing.length) return xml
  const root = xml.match(/<(rss|feed|rdf:RDF)\b/)
  if (!root || root.index === undefined) return xml
  const insertAt = root.index + root[0].length
  const declarations = missing.map((prefix) => ` xmlns:${prefix}="urn:intoponet:undeclared:${prefix}"`).join('')
  return xml.slice(0, insertAt) + declarations + xml.slice(insertAt)
}

/** Clean a raw feed for the strict metadata parser. */
export function sanitizeFeedXml(raw: string): string {
  let xml = raw.replace(/^﻿/, '')
  if (xml.length > FEED_SANITIZE_LIMITS.rawBytes) throw new Error('Feed exceeds the raw size limit.')
  // A bare DOCTYPE (no internal subset) declares nothing; anything with "[" stays and is rejected later.
  xml = xml.replace(/<!DOCTYPE\s[^[>]*>/i, '')
  xml = stripBodies(xml)
  xml = repairEntities(xml)
  xml = bindPrefixes(xml)
  return xml
}

/** Pick the declared text encoding of a feed, from HTTP headers or the XML prolog. */
export function feedCharset(contentType: string | null, head: Uint8Array): string {
  const fromHeader = contentType?.match(/charset\s*=\s*"?([\w.:-]+)/i)?.[1]
  if (fromHeader) return fromHeader.toLowerCase()
  const prolog = new TextDecoder('latin1').decode(head.subarray(0, 200))
  return prolog.match(/<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)/i)?.[1]?.toLowerCase() ?? 'utf-8'
}
