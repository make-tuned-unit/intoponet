import { isQid, OLDS_LIMITS, type OldsCitation, type OldsDate, type OldsEdge, type OldsEdgeType, type OldsEpistemic, type OldsNode } from '@intoponet/browser-api'

/** Minimal shapes of the Wikidata entity JSON we read. Everything is untrusted. */
type Snak = { snaktype?: string; property?: string; datavalue?: { type?: string; value?: unknown } }
type Statement = { mainsnak?: Snak; rank?: string; qualifiers?: Record<string, Snak[]>; references?: Array<{ snaks?: Record<string, Snak[]> }> }
export type WikidataEntity = {
  id?: string
  labels?: Record<string, { value?: string }>
  descriptions?: Record<string, { value?: string }>
  claims?: Record<string, Statement[]>
  sitelinks?: Record<string, { title?: string }>
  missing?: string
}

type Relation = {
  property: string
  label: string
  type: OldsEdgeType
  /** 'out': root → target. 'in': target → root. */
  direction: 'out' | 'in'
  epistemic: Exclude<OldsEpistemic, 'disputed'>
  eventOnly?: boolean
}

/** Wikidata properties that become Olds edges. Nothing else is turned into a relation. */
export const RELATIONS: Relation[] = [
  { property: 'P155', label: 'follows', type: 'preceded_by', direction: 'out', epistemic: 'chronology-only' },
  { property: 'P156', label: 'followed by', type: 'followed_by', direction: 'out', epistemic: 'chronology-only' },
  { property: 'P828', label: 'has cause', type: 'contributed_to', direction: 'in', epistemic: 'source-stated' },
  { property: 'P1478', label: 'has immediate cause', type: 'contributed_to', direction: 'in', epistemic: 'source-stated' },
  { property: 'P1542', label: 'has effect', type: 'contributed_to', direction: 'out', epistemic: 'source-stated' },
  { property: 'P737', label: 'influenced by', type: 'influenced', direction: 'in', epistemic: 'source-stated' },
  { property: 'P793', label: 'significant event', type: 'significant_event', direction: 'out', epistemic: 'source-stated' },
  { property: 'P361', label: 'part of', type: 'part_of', direction: 'out', epistemic: 'source-stated' },
  { property: 'P1365', label: 'replaces', type: 'preceded_by', direction: 'out', epistemic: 'chronology-only' },
  { property: 'P1366', label: 'replaced by', type: 'followed_by', direction: 'out', epistemic: 'chronology-only' },
  { property: 'P2184', label: 'history of topic', type: 'significant_event', direction: 'out', epistemic: 'source-stated' },
  { property: 'P1344', label: 'participant in', type: 'significant_event', direction: 'out', epistemic: 'source-stated' },
  { property: 'P607', label: 'conflict', type: 'significant_event', direction: 'out', epistemic: 'source-stated' },
  // Where things are: places, buildings and events alike (country only for events, or every place would link to it).
  { property: 'P276', label: 'location', type: 'located_at', direction: 'out', epistemic: 'source-stated' },
  { property: 'P131', label: 'located in the administrative territorial entity', type: 'located_at', direction: 'out', epistemic: 'source-stated' },
  { property: 'P17', label: 'country', type: 'located_at', direction: 'out', epistemic: 'source-stated', eventOnly: true },
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function suffix(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return 'th'
  return n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
}

/** Parse a Wikidata time value, respecting precision and BCE years. */
export function parseWikidataTime(value: unknown): OldsDate | null {
  if (typeof value !== 'object' || value === null) return null
  const { time, precision } = value as { time?: unknown; precision?: unknown }
  if (typeof time !== 'string' || typeof precision !== 'number') return null
  const match = time.match(/^([+-])(\d{1,16})-(\d{2})-(\d{2})T/)
  if (!match) return null
  const negative = match[1] === '-'
  const rawYear = Number(match[2])
  if (!Number.isSafeInteger(rawYear) || rawYear === 0 && !negative) return null
  const month = Number(match[3])
  const day = Number(match[4])
  // Wikidata stores 1 BC as -0001 (no year zero).
  const era = negative ? ' BC' : ''
  const pad = (n: number, width: number): string => String(n).padStart(width, '0')
  const isoYear = `${negative ? '-' : ''}${pad(rawYear, 4)}`
  if (precision >= 11 && month >= 1 && day >= 1) {
    return { iso: `${isoYear}-${pad(month, 2)}-${pad(day, 2)}`, precision: 'day', label: `${day} ${MONTHS[month - 1]} ${rawYear}${era}` }
  }
  if (precision >= 10 && month >= 1) {
    return { iso: `${isoYear}-${pad(month, 2)}`, precision: 'month', label: `${MONTHS[month - 1]} ${rawYear}${era}` }
  }
  if (precision >= 9) return { iso: isoYear, precision: 'year', label: `${rawYear}${era}` }
  if (precision === 8) {
    const decade = Math.floor(rawYear / 10) * 10
    return { iso: `${negative ? '-' : ''}${pad(decade, 4)}`, precision: 'decade', label: `${decade}s${era}` }
  }
  if (precision === 7) {
    const century = Math.ceil(rawYear / 100)
    return { iso: `${negative ? '-' : ''}${pad((century - 1) * 100, 4)}`, precision: 'century', label: `${century}${suffix(century)} century${era}` }
  }
  if (precision === 6) {
    const millennium = Math.ceil(rawYear / 1000)
    return { iso: `${negative ? '-' : ''}${pad((millennium - 1) * 1000, 4)}`, precision: 'millennium', label: `${millennium}${suffix(millennium)} millennium${era}` }
  }
  return null
}

function statements(entity: WikidataEntity, property: string): Statement[] {
  const list = entity.claims?.[property]
  return Array.isArray(list) ? list : []
}

/** Best statement value for a property: preferred over normal; deprecated never. */
function bestStatements(entity: WikidataEntity, property: string): Statement[] {
  const usable = statements(entity, property).filter((statement) => statement.rank !== 'deprecated')
  const preferred = usable.filter((statement) => statement.rank === 'preferred')
  return preferred.length ? preferred : usable
}

function firstTime(entity: WikidataEntity, properties: string[]): OldsDate | null {
  for (const property of properties) {
    for (const statement of bestStatements(entity, property)) {
      const snak = statement.mainsnak
      if (snak?.snaktype !== 'value') continue
      const date = parseWikidataTime(snak.datavalue?.value)
      if (date) return date
    }
  }
  return null
}

function entityId(snak: Snak | undefined): string | null {
  if (snak?.snaktype !== 'value' || snak.datavalue?.type !== 'wikibase-entityid') return null
  const value = snak.datavalue.value as { id?: unknown } | undefined
  return isQid(value?.id) ? value.id : null
}

function clean(text: string | undefined, max: number): string | null {
  if (typeof text !== 'string') return null
  const trimmed = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, max) : null
}

export function safeHttps(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}

export function wikipediaUrlFor(entity: WikidataEntity, lang = 'en'): string | null {
  const site = entity.sitelinks?.[`${lang}wiki`] ?? entity.sitelinks?.['enwiki']
  const host = entity.sitelinks?.[`${lang}wiki`] ? lang : 'en'
  const title = clean(site?.title, OLDS_LIMITS.titleLength)
  return title ? `https://${host}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` : null
}

/** An entity is treated as an event when it has a point in time or start time. */
export function isEventLike(entity: WikidataEntity): boolean {
  return bestStatements(entity, 'P585').length > 0 || bestStatements(entity, 'P580').length > 0
}

export function nodeFromEntity(entity: WikidataEntity, lang = 'en'): OldsNode | null {
  if (!isQid(entity.id) || entity.missing !== undefined) return null
  // Wikidata labels are lowercase by convention ("fall of the Berlin Wall");
  // the Wikipedia article title carries the proper display case.
  const sitelinkTitle = clean(entity.sitelinks?.[`${lang}wiki`]?.title ?? entity.sitelinks?.['enwiki']?.title, OLDS_LIMITS.labelLength)
  const label = sitelinkTitle ?? clean(entity.labels?.[lang]?.value ?? entity.labels?.['en']?.value, OLDS_LIMITS.labelLength) ?? entity.id
  const image = bestStatements(entity, 'P18')[0]?.mainsnak
  const imageName = image?.snaktype === 'value' && typeof image.datavalue?.value === 'string' ? image.datavalue.value : null
  return {
    id: entity.id,
    label,
    description: clean(entity.descriptions?.[lang]?.value ?? entity.descriptions?.['en']?.value, OLDS_LIMITS.descriptionLength),
    start: firstTime(entity, ['P585', 'P580', 'P571']),
    end: firstTime(entity, ['P582', 'P576']),
    wikipediaUrl: wikipediaUrlFor(entity, lang),
    wikidataUrl: `https://www.wikidata.org/wiki/${entity.id}`,
    imageUrl: imageName ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imageName.replace(/ /g, '_'))}?width=320` : null,
  }
}

type DraftCitation = { url: string | null; statedIn: string | null }

function referenceCitations(statement: Statement): { drafts: DraftCitation[]; count: number; imported: boolean } {
  const references = Array.isArray(statement.references) ? statement.references : []
  const drafts: DraftCitation[] = []
  const imported = references.some((reference) => Array.isArray(reference.snaks?.['P143']) || Array.isArray(reference.snaks?.['P4656']))
  for (const reference of references) {
    const urlSnak = reference.snaks?.['P854']?.[0]
    const url = urlSnak?.snaktype === 'value' ? safeHttps(urlSnak.datavalue?.value) : null
    const statedIn = entityId(reference.snaks?.['P248']?.[0])
    // "imported from Wikimedia project" (P143) alone is not a citation.
    if (url || statedIn) drafts.push({ url, statedIn })
  }
  return { drafts, count: drafts.length, imported }
}

export type DraftEdge = Omit<OldsEdge, 'citations'> & { citationDrafts: DraftCitation[]; supportLevel?: 'referenced' | 'wiki-imported' | 'unreferenced' | 'article' }

/** One-hop edges from the root entity's statements, per RELATIONS. */
export function edgesFromEntity(root: WikidataEntity): DraftEdge[] {
  if (!isQid(root.id)) return []
  const event = isEventLike(root)
  const edges: DraftEdge[] = []
  const seen = new Set<string>()
  for (const relation of RELATIONS) {
    if (relation.eventOnly && !event) continue
    for (const statement of statements(root, relation.property)) {
      if (statement.rank === 'deprecated') continue
      const target = entityId(statement.mainsnak)
      if (!target || target === root.id) continue
      const disputed = Array.isArray(statement.qualifiers?.['P1310']) && statement.qualifiers['P1310'].length > 0
      const from = relation.direction === 'out' ? root.id : target
      const to = relation.direction === 'out' ? target : root.id
      const key = `${from}|${to}|${relation.type}|${relation.property}`
      if (seen.has(key)) continue
      seen.add(key)
      const { drafts, count, imported } = referenceCitations(statement)
      edges.push({
        from,
        to,
        type: disputed ? 'disputed_link' : relation.type,
        epistemic: disputed ? 'disputed' : relation.epistemic,
        property: relation.property,
        propertyLabel: relation.label,
        statementUrl: `https://www.wikidata.org/wiki/${root.id}#${relation.property}`,
        citationDrafts: drafts,
        referenceCount: count,
        supportLevel: count > 0 ? 'referenced' : imported ? 'wiki-imported' : 'unreferenced',
      })
    }
  }
  return edges
}

/** Resolve citation drafts once stated-in items are known. */
export function resolveCitations(drafts: DraftCitation[], statedIn: Map<string, OldsNode>): OldsCitation[] {
  const out: OldsCitation[] = []
  const seen = new Set<string>()
  for (const draft of drafts) {
    const source = draft.statedIn ? statedIn.get(draft.statedIn) : undefined
    const url = draft.url ?? source?.wikipediaUrl ?? (draft.statedIn ? `https://www.wikidata.org/wiki/${draft.statedIn}` : null)
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ url, title: source?.label ?? null })
    if (out.length >= OLDS_LIMITS.citationsPerEdge) break
  }
  return out
}

/** Stated-in item ids referenced by edges (for labelling citations). */
export function statedInIds(edges: DraftEdge[]): string[] {
  return [...new Set(edges.flatMap((edge) => edge.citationDrafts.flatMap((draft) => (draft.statedIn ? [draft.statedIn] : []))))]
}
