import { CITY_ROWS, COUNTRY_ROWS } from '../../shared/places/placeData'
import { normalizePlaceText } from '../../shared/places/places'
import { KNOWLEDGE_LIMITS, type KnowledgeDate, type KnowledgeEntity, type KnowledgePlace } from './contract'

/**
 * Local, deterministic extraction (PRD ABS-003): names, places from the
 * bundled GeoNames directory, frequent terms and dates. No model, no network.
 */

type PlaceRef = { name: string; countryCode: string; lat: number; lon: number }

const AMBIGUOUS = new Set([
  'nice', 'mobile', 'reading', 'orange', 'victoria', 'independence', 'concord', 'split', 'hope', 'union', 'enterprise',
  'paradise', 'sale', 'wells', 'bath', 'march', 'may', 'police', 'mission', 'surprise', 'central', 'capital', 'eastern',
  'western', 'northern', 'southern', 'north', 'south', 'east', 'west', 'santa', 'leon', 'kids', 'georgia', 'jordan',
  'chad', 'guinea', 'niger', 'turkey', 'march', 'august', 'florence', 'lincoln', 'washington', 'jackson', 'austin',
  'phoenix', 'memphis', 'troy', 'athens', 'columbia', 'buffalo', 'aurora', 'temple', 'ocean', 'lima', 'mali',
])

/** Lowercase, punctuation to spaces, accents kept. */
function accentText(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

let placeIndex: { plain: Map<string, PlaceRef>; accented: Map<string, PlaceRef> } | null = null

function places(): { plain: Map<string, PlaceRef>; accented: Map<string, PlaceRef> } {
  if (placeIndex) return placeIndex
  const plain = new Map<string, PlaceRef>()
  const accented = new Map<string, PlaceRef>()
  const add = (ref: PlaceRef): void => {
    const plainKey = normalizePlaceText(ref.name)
    if (plainKey.length < 4 || AMBIGUOUS.has(plainKey)) return
    const accentKey = accentText(ref.name)
    // First come, first kept: countries, then cities by population.
    if (accentKey !== plainKey) {
      if (!accented.has(accentKey)) accented.set(accentKey, ref)
    } else if (!plain.has(plainKey)) {
      plain.set(plainKey, ref)
    }
  }
  for (const [code, name, lat, lon] of COUNTRY_ROWS) add({ name, countryCode: code, lat, lon })
  const cities = [...CITY_ROWS].sort((a, b) => b[6] - a[6])
  for (const [, name, code, , lat, lon] of cities) add({ name, countryCode: code, lat, lon })
  placeIndex = { plain, accented }
  return placeIndex
}

const STOPWORDS = new Set(`a about above after again against all also am an and any are aren as at be because been before being below
between both but by can cannot could did do does doing down during each few for from further had has have having he her here hers
herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our
ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those
through to too under until up very was we were what when where which while who whom why will with would you your yours yourself
yourselves said says one two three new also may might must many much like first last year years time people according however
this that which what there their other into than then them these those such would could should about after before while where
el la los las de del en y que por con para una uno como más pero sus les le des du et est dans pour pas sur avec une qui que
der die das und ist nicht mit von den dem ein eine auf für sich auch als bei zum zur aus nach o os as um uma em não com por
mais foi são ao
january february march april may june july august september october november december
enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre
janvier février mars avril juin juillet août septembre octobre novembre décembre
januar februar märz juni juli oktober dezember
retrieved archived original bibcode isbn issn pmid pmc volume pages edition accessed article archive
journal press publisher reference references citation cited online website page edited wikipedia
around along within caused across among without toward towards upon whose often still even well back down known called usually several various another different following including become became since using based found make made part show shows near large small high higher lower major`.split(/\s+/).filter(Boolean))

/** Capitalised name phrases (Latin script), with lowercase connectors allowed inside. */
const NAME_PHRASE = /\b(\p{Lu}[\p{L}’'-]+(?:\s+(?:(?:of|de|del|da|di|du|la|le|van|von|der|den|bin|al|y|e|the)\s+)?\p{Lu}[\p{L}’'-]+){1,4})/gu
const WORD = /[\p{L}\p{N}]+/gu

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}
const MONTH_NAMES = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec'
const DMY = new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_NAMES})\\.?\\s+(1\\d{3}|20\\d{2})\\b`, 'gi')
const MDY = new RegExp(`\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2}),?\\s+(1\\d{3}|20\\d{2})\\b`, 'gi')
const ISO_DATE = /\b(1\d{3}|20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g
const YEAR = /(?<![\d,.])\b(1\d{3}|20\d{2})\b(?![\d,.]\d)/g

function isoDay(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.toISOString().slice(0, 10)
}

function bump<T>(map: Map<string, { value: T; count: number }>, key: string, value: T): void {
  const existing = map.get(key)
  if (existing) existing.count += 1
  else map.set(key, { value, count: 1 })
}

export function extractPlaces(paragraphs: string[]): KnowledgePlace[] {
  const { plain, accented } = places()
  const found = new Map<string, { value: PlaceRef; count: number }>()
  for (const paragraph of paragraphs) {
    const words = [...paragraph.matchAll(WORD)]
    for (let i = 0; i < words.length; i += 1) {
      const first = words[i]![0]
      // Only capitalised mentions count where the script has case ("Reading" the town, not "reading").
      if (first[0] !== first[0]!.toUpperCase() || /^\d/.test(first)) continue
      for (let n = Math.min(4, words.length - i); n >= 1; n -= 1) {
        const span = words.slice(i, i + n).map((match) => match[0]).join(' ')
        const ref = accented.get(accentText(span)) ?? (accentText(span) === normalizePlaceText(span) ? plain.get(normalizePlaceText(span)) : undefined)
        if (ref) {
          bump(found, `${ref.countryCode}:${ref.name}`, ref)
          i += n - 1
          break
        }
      }
    }
  }
  return [...found.values()]
    .sort((a, b) => b.count - a.count || a.value.name.localeCompare(b.value.name))
    .slice(0, 40)
    .map(({ value, count }) => ({ name: value.name, countryCode: value.countryCode, lat: value.lat, lon: value.lon, count }))
}

export function extractEntities(paragraphs: string[], placeList: KnowledgePlace[] = []): KnowledgeEntity[] {
  const placeNames = new Set(placeList.map((place) => place.name.toLowerCase()))
  const names = new Map<string, { value: string; count: number }>()
  const terms = new Map<string, { value: string; count: number }>()
  for (const paragraph of paragraphs) {
    for (const match of paragraph.matchAll(NAME_PHRASE)) {
      const phrase = match[1]!.replace(/[’']s$/, '').replace(/^(?:The|A|An|La|Le|Les|El|Los|Las|Der|Die|Das|Il|Lo|O|Os)\s+/, '')
      if (!phrase.includes(' ') && !placeNames.has(phrase.toLowerCase())) continue
      bump(names, phrase.toLowerCase(), phrase)
    }
    for (const match of paragraph.matchAll(WORD)) {
      const word = match[0].normalize('NFKC')
      const key = word.toLowerCase()
      if (key.length < 5 || STOPWORDS.has(key) || /^\d+$/.test(key)) continue
      bump(terms, key, key)
    }
  }
  const entities: KnowledgeEntity[] = []
  for (const { value, count } of names.values()) {
    entities.push({ text: value, kind: placeNames.has(value.toLowerCase()) ? 'place' : 'name', count })
  }
  // Places found by the directory count as entities too.
  for (const place of placeList) {
    if (!names.has(place.name.toLowerCase())) entities.push({ text: place.name, kind: 'place', count: place.count })
  }
  const nameWords = new Set([...names.keys()].flatMap((name) => name.split(/\s+/)))
  for (const { value, count } of terms.values()) {
    if (count >= 3 && !nameWords.has(value)) entities.push({ text: value, kind: 'term', count })
  }
  const rank = (entity: KnowledgeEntity): number => entity.count * (entity.kind === 'term' ? 0.6 : entity.text.includes(' ') ? 1.5 : 1)
  return entities.sort((a, b) => rank(b) - rank(a) || a.text.localeCompare(b.text)).slice(0, 60)
}

export function extractDates(paragraphs: string[]): KnowledgeDate[] {
  const found = new Map<string, { value: KnowledgeDate; count: number }>()
  for (const paragraph of paragraphs) {
    const covered: Array<[number, number]> = []
    const take = (text: string, iso: string | null, index: number): void => {
      covered.push([index, index + text.length])
      bump(found, iso ?? text, { text, iso })
    }
    for (const match of paragraph.matchAll(DMY)) take(match[0], isoDay(Number(match[3]), MONTHS[match[2]!.toLowerCase().replace('.', '')]!, Number(match[1])), match.index!)
    for (const match of paragraph.matchAll(MDY)) take(match[0], isoDay(Number(match[3]), MONTHS[match[1]!.toLowerCase().replace('.', '')]!, Number(match[2])), match.index!)
    for (const match of paragraph.matchAll(ISO_DATE)) take(match[0], isoDay(Number(match[1]), Number(match[2]), Number(match[3])), match.index!)
    for (const match of paragraph.matchAll(YEAR)) {
      const at = match.index!
      if (covered.some(([start, end]) => at >= start && at < end)) continue
      bump(found, match[1]!, { text: match[1]!, iso: match[1]! })
    }
  }
  return [...found.values()]
    .sort((a, b) => Number(b.value.iso?.length === 10) - Number(a.value.iso?.length === 10) || b.count - a.count || (a.value.iso ?? '').localeCompare(b.value.iso ?? ''))
    .slice(0, 40)
    .map(({ value }) => value)
}

export function wordCount(paragraphs: string[]): number {
  let count = 0
  for (const paragraph of paragraphs) count += (paragraph.match(WORD) ?? []).length
  return count
}

export type Analysis = { entities: KnowledgeEntity[]; places: KnowledgePlace[]; dates: KnowledgeDate[]; wordCount: number }

export function analyze(paragraphs: string[], removed: ReadonlySet<string> = new Set()): Analysis {
  const isRemoved = (text: string): boolean => removed.has(text.toLowerCase())
  const placeList = extractPlaces(paragraphs).filter((place) => !isRemoved(place.name))
  return {
    entities: extractEntities(paragraphs, placeList).filter((entity) => !isRemoved(entity.text)),
    places: placeList,
    dates: extractDates(paragraphs),
    wordCount: wordCount(paragraphs),
  }
}

export const PREVIEW_SIZES = {
  paragraphs: KNOWLEDGE_LIMITS.previewParagraphs,
  entities: KNOWLEDGE_LIMITS.previewEntities,
  dates: KNOWLEDGE_LIMITS.previewDates,
}
