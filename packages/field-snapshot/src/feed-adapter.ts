import { INTEREST_CONTRACT_LIMITS, isUtcTimestamp, parsePublicItem } from './interest-contract'
import type { PublicItem } from './interest-contract'

const ATOM_NS = 'http://www.w3.org/2005/Atom'
const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const RSS1_NS = 'http://purl.org/rss/1.0/'
const DC_NS = 'http://purl.org/dc/elements/1.1/'
const DCTERMS_NS = 'http://purl.org/dc/terms/'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/'
const MAX_FEED_BYTES = INTEREST_CONTRACT_LIMITS.payloadBytes
const MAX_ITEMS = 500
const MAX_TEXT_CHARS = 250_000
const MAX_XML_NODES = 100_000
const MAX_XML_DEPTH = 64
const MAX_TITLE_CHARS = INTEREST_CONTRACT_LIMITS.title
const MAX_LINK_CHARS = 2_048

type XmlAttribute = { name: string; localName: string; namespace: string; value: string }
type XmlNode = {
  name: string
  localName: string
  namespace: string
  attributes: XmlAttribute[]
  children: XmlNode[]
  parts: Array<string | XmlNode>
  baseUrl: string
  xmlLanguage: string | undefined
}

export type FeedAdapterOptions = {
  sourceId: string
  feedUrl: string
  /** Fetch/observation time supplied by the caller; never derived from item dates. */
  discoveredAt: string
  language?: string
  /** Pre-reviewed topic IDs; publisher categories remain namespaced publisher tags. */
  topicIds?: string[]
  /** Set false when source approval covers no publisher category fields. */
  includePublisherTags?: boolean
}

export type FeedFormat = 'rss' | 'atom'

type FeedRows = {
  format: FeedFormat
  rows: XmlNode[]
  coreNamespace: string
  language: string | undefined
}

function fail(message: string): never {
  throw new Error(`Invalid RSS/Atom feed: ${message}`)
}

function isXmlChar(codePoint: number): boolean {
  return (
    codePoint === 0x09 ||
    codePoint === 0x0a ||
    codePoint === 0x0d ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  )
}

function decodeXmlEntities(value: string): string {
  let result = ''
  for (let index = 0; index < value.length; ) {
    const ampersand = value.indexOf('&', index)
    if (ampersand < 0) {
      result += value.slice(index)
      break
    }
    result += value.slice(index, ampersand)
    const semicolon = value.indexOf(';', ampersand + 1)
    if (semicolon < 0) fail('unterminated entity reference')
    const entity = value.slice(ampersand + 1, semicolon)
    let decoded: string
    if (entity === 'amp') decoded = '&'
    else if (entity === 'lt') decoded = '<'
    else if (entity === 'gt') decoded = '>'
    else if (entity === 'quot') decoded = '"'
    else if (entity === 'apos') decoded = "'"
    else if (/^#\d+$/.test(entity) || /^#x[\da-f]+$/i.test(entity)) {
      const codePoint = entity[1]?.toLowerCase() === 'x'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      if (!Number.isSafeInteger(codePoint) || !isXmlChar(codePoint)) fail('invalid character reference')
      decoded = String.fromCodePoint(codePoint)
    } else {
      fail('custom or unknown entity references are not supported')
    }
    result += decoded
    index = semicolon + 1
  }
  return result
}

function splitName(name: string): { localName: string; prefix: string } {
  if (!/^[A-Za-z_][A-Za-z\d_.:-]*$/.test(name) || (name.match(/:/g) ?? []).length > 1) {
    fail('malformed XML name')
  }
  const colon = name.indexOf(':')
  return colon < 0
    ? { localName: name, prefix: '' }
    : { localName: name.slice(colon + 1), prefix: name.slice(0, colon) }
}

function parseAttributes(source: string): Array<{ name: string; value: string }> {
  const attributes: Array<{ name: string; value: string }> = []
  const seen = new Set<string>()
  let index = 0
  while (index < source.length) {
    while (/\s/.test(source[index] ?? '') && index < source.length) index += 1
    if (index >= source.length) break
    const nameStart = index
    while (index < source.length && !/[\s=]/.test(source[index] ?? '')) index += 1
    const name = source.slice(nameStart, index)
    splitName(name)
    if (!name || seen.has(name)) fail('malformed or duplicate XML attribute')
    seen.add(name)
    while (/\s/.test(source[index] ?? '') && index < source.length) index += 1
    if (source[index] !== '=') fail('XML attribute is missing a value')
    index += 1
    while (/\s/.test(source[index] ?? '') && index < source.length) index += 1
    const quote = source[index]
    if (quote !== '"' && quote !== "'") fail('XML attribute must be quoted')
    index += 1
    const valueStart = index
    while (index < source.length && source[index] !== quote) index += 1
    if (index >= source.length) fail('unterminated XML attribute')
    const rawValue = source.slice(valueStart, index)
    if (rawValue.includes('<')) fail('less-than in XML attribute')
    attributes.push({ name, value: decodeXmlEntities(rawValue) })
    index += 1
  }
  return attributes
}

function findTagEnd(xml: string, start: number): number {
  let quote = ''
  for (let index = start; index < xml.length; index += 1) {
    const char = xml[index]
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '>') {
      return index
    }
  }
  return -1
}

/**
 * A bounded, non-validating XML subset parser for feed metadata. DTDs and
 * custom entities are rejected; only XML's five predefined and numeric
 * references are decoded. It never loads external resources or expands entities.
 */
function parseXml(xmlInput: string, feedUrl: string): XmlNode {
  const byteLength = new TextEncoder().encode(xmlInput).byteLength
  if (byteLength > MAX_FEED_BYTES) fail(`payload exceeds ${MAX_FEED_BYTES} bytes`)
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xmlInput)) fail('DOCTYPE and entity declarations are forbidden')

  const xml = xmlInput.charCodeAt(0) === 0xfeff ? xmlInput.slice(1) : xmlInput
  for (const character of xml) {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined || !isXmlChar(codePoint)) fail('payload contains a character forbidden by XML')
  }
  const document: XmlNode = {
    name: '#document', localName: '#document', namespace: '', attributes: [], children: [], parts: [],
    baseUrl: feedUrl,
    xmlLanguage: undefined,
  }
  const stack: Array<{ node: XmlNode; namespaces: Map<string, string> }> = [
    { node: document, namespaces: new Map([['xml', XML_NS]]) },
  ]
  let nodeCount = 0
  let textCount = 0
  let index = 0

  while (index < xml.length) {
    const parent = stack[stack.length - 1]
    if (!parent) fail('invalid element stack')
    if (xml[index] !== '<') {
      const end = xml.indexOf('<', index)
      const raw = xml.slice(index, end < 0 ? xml.length : end)
      const text = decodeXmlEntities(raw)
      textCount += text.length
      if (textCount > MAX_TEXT_CHARS) fail(`text exceeds ${MAX_TEXT_CHARS} characters`)
      if (stack.length === 1 && text.trim()) fail('text outside the root element')
      parent.node.parts.push(text)
      index = end < 0 ? xml.length : end
      continue
    }

    if (xml.startsWith('<!--', index)) {
      const end = xml.indexOf('-->', index + 4)
      if (end < 0 || xml.slice(index + 4, end).includes('--')) fail('malformed XML comment')
      index = end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', index)) {
      if (stack.length === 1) fail('CDATA outside the root element')
      const end = xml.indexOf(']]>', index + 9)
      if (end < 0) fail('unterminated CDATA section')
      const text = xml.slice(index + 9, end)
      textCount += text.length
      if (textCount > MAX_TEXT_CHARS) fail(`text exceeds ${MAX_TEXT_CHARS} characters`)
      parent.node.parts.push(text)
      index = end + 3
      continue
    }
    if (xml.startsWith('<?', index)) {
      const end = xml.indexOf('?>', index + 2)
      if (end < 0) fail('unterminated processing instruction')
      index = end + 2
      continue
    }
    if (xml.startsWith('<!', index)) fail('unsupported XML declaration')

    const end = findTagEnd(xml, index + 1)
    if (end < 0) fail('unterminated tag')
    let body = xml.slice(index + 1, end).trim()
    if (body.startsWith('/')) {
      const name = body.slice(1).trim()
      splitName(name)
      const open = stack.pop()
      if (!open || open.node.name !== name || stack.length === 0) fail('mismatched closing tag')
      index = end + 1
      continue
    }

    const selfClosing = body.endsWith('/')
    if (selfClosing) body = body.slice(0, -1).trimEnd()
    const nameEnd = body.search(/\s/)
    const name = nameEnd < 0 ? body : body.slice(0, nameEnd)
    const attrText = nameEnd < 0 ? '' : body.slice(nameEnd + 1)
    const { localName, prefix } = splitName(name)
    if (!name) fail('empty element name')
    const parsedAttributes = parseAttributes(attrText)
    textCount += parsedAttributes.reduce((total, attribute) => total + attribute.value.length, 0)
    if (textCount > MAX_TEXT_CHARS) fail(`text exceeds ${MAX_TEXT_CHARS} characters`)
    const namespaces = new Map(parent.namespaces)
    for (const attribute of parsedAttributes) {
      if (attribute.name === 'xmlns') {
        if (attribute.value === XML_NS || attribute.value === XMLNS_NS) fail('reserved XML namespace declaration')
        namespaces.set('', attribute.value)
      }
      else if (attribute.name.startsWith('xmlns:')) {
        const declaredPrefix = attribute.name.slice('xmlns:'.length)
        if (!declaredPrefix || declaredPrefix === 'xmlns') fail('invalid namespace declaration')
        if ((declaredPrefix === 'xml') !== (attribute.value === XML_NS) || attribute.value === XMLNS_NS) {
          fail('reserved XML namespace declaration')
        }
        namespaces.set(declaredPrefix, attribute.value)
      }
    }
    const namespace = namespaces.get(prefix)
    if (prefix && namespace === undefined) fail('unbound namespace prefix')
    const attributes: XmlAttribute[] = parsedAttributes.map((attribute) => {
      const parts = splitName(attribute.name)
      const attributeNamespace = attribute.name === 'xmlns' || parts.prefix === 'xmlns'
        ? 'http://www.w3.org/2000/xmlns/'
        : parts.prefix
          ? namespaces.get(parts.prefix)
          : ''
      if (parts.prefix && !attributeNamespace) fail('unbound attribute namespace prefix')
      return {
        name: attribute.name,
        localName: parts.localName,
        namespace: attributeNamespace ?? '',
        value: attribute.value,
      }
    })
    const expandedAttributeNames = new Set<string>()
    for (const item of attributes) {
      const expandedName = `${item.namespace}\u0000${item.localName}`
      if (expandedAttributeNames.has(expandedName)) fail('duplicate expanded XML attribute')
      expandedAttributeNames.add(expandedName)
    }
    const xmlBase = attributes.find((item) => item.name === 'xml:base')?.value
    const baseUrl = xmlBase === undefined ? parent.node.baseUrl : safeHttpUrl(xmlBase, parent.node.baseUrl)
    if (!baseUrl) fail('xml:base must resolve to a safe HTTP or HTTPS URL')
    const xmlLanguage = attributes.find((item) => item.name === 'xml:lang')?.value ?? parent.node.xmlLanguage
    const node: XmlNode = {
      name,
      localName,
      namespace: namespace ?? '',
      attributes,
      children: [],
      parts: [],
      baseUrl,
      xmlLanguage,
    }
    parent.node.children.push(node)
    parent.node.parts.push(node)
    nodeCount += 1
    if (nodeCount > MAX_XML_NODES) fail(`XML node count exceeds ${MAX_XML_NODES}`)
    if (!selfClosing) {
      if (stack.length >= MAX_XML_DEPTH) fail(`XML nesting exceeds ${MAX_XML_DEPTH}`)
      stack.push({ node, namespaces })
    }
    index = end + 1
  }

  if (stack.length !== 1 || document.children.length !== 1) fail('document must have one complete root element')
  const root = document.children[0]
  if (!root) fail('missing document root')
  return root
}

function children(node: XmlNode, localName: string, namespace?: string): XmlNode[] {
  return node.children.filter((child) =>
    child.localName.toLowerCase() === localName.toLowerCase() &&
    (namespace === undefined || child.namespace === namespace),
  )
}

function child(node: XmlNode, localName: string, namespace?: string): XmlNode | undefined {
  return children(node, localName, namespace)[0]
}

function attribute(node: XmlNode, name: string): string | undefined {
  return node.attributes.find((value) => value.name === name)?.value
}

function elementText(node: XmlNode | undefined): string {
  if (!node) return ''
  return node.parts.map((part) => typeof part === 'string' ? part : elementText(part)).join('')
}

function plainTitle(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function safeHttpUrl(value: string, base: string): string | null {
  if (!value.trim() || value.length > MAX_LINK_CHARS) return null
  try {
    const url = new URL(value.trim(), base)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null
    url.hash = ''
    return url.href.length <= MAX_LINK_CHARS ? url.href : null
  } catch {
    return null
  }
}

const monthIndex = new Map([
  ['jan', 0], ['feb', 1], ['mar', 2], ['apr', 3], ['may', 4], ['jun', 5],
  ['jul', 6], ['aug', 7], ['sep', 8], ['oct', 9], ['nov', 10], ['dec', 11],
])

function normalizeDate(value: string): string | undefined {
  const text = value.trim()
  if (!text || text.length > 128) return undefined
  const rfc3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/i.exec(text)
  let milliseconds: number
  if (rfc3339) {
    const year = Number(rfc3339[1]); const month = Number(rfc3339[2]); const day = Number(rfc3339[3])
    const hour = Number(rfc3339[4]); const minute = Number(rfc3339[5]); const second = Number(rfc3339[6])
    if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) return undefined
    if (rfc3339[8] !== 'Z' && rfc3339[8] !== 'z') {
      const offsetHour = Number(rfc3339[8]?.slice(1, 3)); const offsetMinute = Number(rfc3339[8]?.slice(4, 6))
      if (offsetHour > 23 || offsetMinute > 59) return undefined
    }
    milliseconds = Date.parse(text)
  } else {
    const rfc822 = /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(GMT|UTC|[+-]\d{4})$/i.exec(text)
    if (!rfc822) return undefined
    const day = Number(rfc822[1]); const month = monthIndex.get((rfc822[2] ?? '').toLowerCase())
    const year = Number(rfc822[3]); const hour = Number(rfc822[4]); const minute = Number(rfc822[5]); const second = Number(rfc822[6] ?? '0')
    if (month === undefined || day < 1 || day > new Date(Date.UTC(year, month + 1, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) return undefined
    if (/^[+-]/.test(rfc822[7] ?? '')) {
      const offsetHour = Number(rfc822[7]?.slice(1, 3)); const offsetMinute = Number(rfc822[7]?.slice(3, 5))
      if (offsetHour > 23 || offsetMinute > 59) return undefined
    }
    milliseconds = Date.parse(text)
  }
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined
}

function languageTag(node: XmlNode, fallback: string): string {
  const lang = node.xmlLanguage ?? fallback
  return /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(lang) ? lang : fallback
}

function tagHash(value: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (const character of value.normalize('NFKC').toLowerCase()) {
    hash ^= BigInt(character.codePointAt(0) ?? 0)
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

function publisherTagId(label: string): string | null {
  const normalized = label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!slug || slug.length > 144 || /[^\x00-\x7f]/.test(label)) {
    return `publisher:tag-${tagHash(label)}`
  }
  return `publisher:${slug}`
}

function tagsFor(
  item: XmlNode,
  format: FeedFormat,
  configured: string[],
  coreNamespace: string,
  includePublisherTags: boolean,
): string[] {
  if (!includePublisherTags) return [...new Set(configured)].slice(0, 64)
  const labels = format === 'atom'
    ? children(item, 'category', ATOM_NS).map((node) => attribute(node, 'term') ?? '')
    : children(item, 'category', coreNamespace).map((node) => plainTitle(elementText(node)))
  const tags = labels
    .map((label) => publisherTagId(label.trim()))
    .filter((tag): tag is string => tag !== null)
    .slice(0, 64)
  return [...new Set([...configured, ...tags])].slice(0, 64)
}

function itemRows(root: XmlNode): FeedRows {
  if (root.localName.toLowerCase() === 'feed' && root.namespace === ATOM_NS) {
    return {
      format: 'atom',
      rows: children(root, 'entry', ATOM_NS),
      coreNamespace: ATOM_NS,
      language: root.xmlLanguage,
    }
  }
  if (root.localName.toLowerCase() === 'rss' && !root.namespace) {
    const channel = child(root, 'channel')
    if (!channel) fail('RSS 2.0 feed is missing its channel')
    const language = elementText(child(channel, 'language', '')).trim() || channel.xmlLanguage || root.xmlLanguage
    return { format: 'rss', rows: children(channel, 'item', ''), coreNamespace: '', language }
  }
  if (root.localName.toLowerCase() === 'rdf' && root.namespace === RDF_NS) {
    return { format: 'rss', rows: children(root, 'item', RSS1_NS), coreNamespace: RSS1_NS, language: root.xmlLanguage }
  }
  fail('root must be RSS, RSS 1.0 RDF, or Atom 1.0')
}

function rssLink(item: XmlNode, feedUrl: string, coreNamespace: string): string | null {
  const linkNode = child(item, 'link', coreNamespace)
  const link = safeHttpUrl(elementText(linkNode).trim(), linkNode?.baseUrl ?? item.baseUrl ?? feedUrl)
  if (link) return link
  const guid = child(item, 'guid', coreNamespace)
  if (guid && attribute(guid, 'isPermaLink')?.toLowerCase() !== 'false') {
    return safeHttpUrl(elementText(guid).trim(), guid.baseUrl)
  }
  return null
}

function atomLink(item: XmlNode, feedUrl: string): string | null {
  const links = children(item, 'link', ATOM_NS)
  const canonical = links.find((link) => attribute(link, 'rel')?.toLowerCase() === 'canonical')
  const alternate = links.find((link) => !attribute(link, 'rel') || attribute(link, 'rel')?.toLowerCase() === 'alternate')
  for (const link of [canonical, alternate]) {
    if (!link) continue
    const safe = safeHttpUrl(attribute(link, 'href') ?? '', link.baseUrl || feedUrl)
    if (safe) return safe
  }
  const id = elementText(child(item, 'id', ATOM_NS)).trim()
  return safeHttpUrl(id, feedUrl)
}

function itemIdentity(row: XmlNode, format: FeedFormat, canonicalUrl: string, coreNamespace: string): string {
  const stableId = format === 'atom'
    ? elementText(child(row, 'id', ATOM_NS)).trim()
    : elementText(child(row, 'guid', coreNamespace)).trim()
  return stableId || canonicalUrl
}

function compareRevision(left: PublicItem, right: PublicItem): number {
  const leftRevision = left.updatedAt ?? left.publishedAt ?? ''
  const rightRevision = right.updatedAt ?? right.publishedAt ?? ''
  if (leftRevision !== rightRevision) return leftRevision.localeCompare(rightRevision)
  return right.sourceContentHash.localeCompare(left.sourceContentHash)
}

function validateOptions(options: FeedAdapterOptions): { feedUrl: string; language: string; topicIds: string[] } {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(options.sourceId)) fail('invalid source ID')
  const feedUrl = safeHttpUrl(options.feedUrl, options.feedUrl)
  if (!feedUrl) fail('feed URL must be HTTP or HTTPS without credentials')
  if (!isUtcTimestamp(options.discoveredAt)) fail('discoveredAt must be a valid UTC timestamp')
  const language = options.language ?? 'und'
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language)) fail('invalid configured language tag')
  const topicIds = [...new Set(options.topicIds ?? [])]
  if (topicIds.length > 64 || topicIds.some((topicId) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(topicId))) {
    fail('configured topic IDs must be valid and limited to 64')
  }
  return { feedUrl, language, topicIds }
}

async function sha256(value: string): Promise<string> {
  const crypto = globalThis.crypto
  if (!crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable in this runtime.')
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function toPlainFeedItem(
  row: XmlNode,
  format: FeedFormat,
  coreNamespace: string,
  feedLanguage: string | undefined,
  options: FeedAdapterOptions,
  checked: ReturnType<typeof validateOptions>,
) {
  const title = plainTitle(elementText(
    format === 'atom' ? child(row, 'title', ATOM_NS) : child(row, 'title', coreNamespace),
  ))
  if (!title || title.length > MAX_TITLE_CHARS) return null
  const canonicalUrl = format === 'atom'
    ? atomLink(row, checked.feedUrl)
    : rssLink(row, checked.feedUrl, coreNamespace)
  if (!canonicalUrl) return null

  const publishedRaw = format === 'atom'
    ? elementText(child(row, 'published', ATOM_NS))
    : elementText(child(row, 'pubDate', coreNamespace)) ||
      elementText(child(row, 'date', DC_NS))
  const updatedRaw = format === 'atom'
    ? elementText(child(row, 'updated', ATOM_NS))
    : elementText(child(row, 'updated', ATOM_NS)) || elementText(child(row, 'modified', DCTERMS_NS))
  const publishedAt = normalizeDate(publishedRaw)
  const updatedAt = normalizeDate(updatedRaw)
  const identity = itemIdentity(row, format, canonicalUrl, coreNamespace)
  const tags = tagsFor(row, format, checked.topicIds, coreNamespace, options.includePublisherTags !== false)
  const validFeedLanguage = feedLanguage && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(feedLanguage)
    ? feedLanguage
    : checked.language
  const lang = languageTag(row, validFeedLanguage)
  return {
    title,
    canonicalUrl,
    publishedAt,
    updatedAt,
    identity,
    language: lang,
    topicIds: tags,
    discoveredAt: options.discoveredAt,
  }
}

/** Parse controlled RSS/Atom XML fixture bytes into metadata-only PublicItems. */
export async function parseFeedXml(xml: string, options: FeedAdapterOptions): Promise<PublicItem[]> {
  if (typeof xml !== 'string') fail('payload must be text')
  const checked = validateOptions(options)
  const root = parseXml(xml, checked.feedUrl)
  const { format, rows, coreNamespace, language } = itemRows(root)
  if (rows.length > MAX_ITEMS) fail(`item count exceeds ${MAX_ITEMS}`)

  const candidates: PublicItem[] = []
  for (const row of rows) {
    const values = toPlainFeedItem(row, format, coreNamespace, language, options, checked)
    if (!values) continue
    const identityHash = await sha256(`${options.sourceId}\u0000${values.identity}`)
    const sourceContentHash = await sha256(JSON.stringify([
      values.canonicalUrl,
      values.title,
      values.publishedAt ?? null,
      values.updatedAt ?? null,
      values.language,
      values.topicIds,
    ]))
    const candidate = parsePublicItem({
      schemaVersion: '1.0',
      id: `feed-${identityHash}`,
      sourceId: options.sourceId,
      canonicalUrl: values.canonicalUrl,
      title: values.title,
      ...(values.publishedAt ? { publishedAt: values.publishedAt } : {}),
      discoveredAt: values.discoveredAt,
      ...(values.updatedAt ? { updatedAt: values.updatedAt } : {}),
      language: values.language,
      sourceContentHash,
      topicIds: values.topicIds,
      // Feed coordinates and publisher coverage do not by themselves establish
      // an article's about-location. Add GeoRSS only with a defensible place map.
      aboutLocations: [],
      provenanceId: `prov-${identityHash}`,
    })
    if (candidate) candidates.push(candidate)
  }

  // Keep the newest observed revision for a GUID/Atom ID, then collapse exact
  // canonical-URL duplicates deterministically. Never collapse distinct URLs
  // solely because their titles or dates resemble one another.
  const byId = new Map<string, PublicItem>()
  for (const candidate of candidates) {
    const previous = byId.get(candidate.id)
    if (!previous || compareRevision(candidate, previous) > 0) byId.set(candidate.id, candidate)
  }
  const byUrl = new Map<string, PublicItem>()
  for (const candidate of byId.values()) {
    const previous = byUrl.get(candidate.canonicalUrl)
    if (!previous || compareRevision(candidate, previous) > 0 ||
      (compareRevision(candidate, previous) === 0 && candidate.id < previous.id)) {
      byUrl.set(candidate.canonicalUrl, candidate)
    }
  }
  return [...byUrl.values()].sort((left, right) => left.id.localeCompare(right.id))
}

export const FEED_ADAPTER_LIMITS = {
  bytes: MAX_FEED_BYTES,
  items: MAX_ITEMS,
  textCharacters: MAX_TEXT_CHARS,
  titleCharacters: MAX_TITLE_CHARS,
  linkCharacters: MAX_LINK_CHARS,
  xmlNodes: MAX_XML_NODES,
  xmlDepth: MAX_XML_DEPTH,
} as const
