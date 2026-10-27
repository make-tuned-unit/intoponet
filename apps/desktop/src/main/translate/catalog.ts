import { PIVOT_LANGUAGE } from '@intoponet/browser-api'
import catalogJson from './catalog.json'

export type CatalogFileType = 'model' | 'lex' | 'vocab' | 'srcvocab' | 'trgvocab'

export type CatalogFile = {
  type: CatalogFileType
  name: string
  bytes: number
  sha256: string
  location: string
}

export type CatalogPair = { from: string; to: string; version: string; files: CatalogFile[] }

export type Catalog = {
  schemaVersion: number
  generatedAt: string
  source: string
  licence: string
  licenceUrl: string
  attachmentsBase: string
  engine: { name: string; version: string; glueVersion: string; file: Omit<CatalogFile, 'type'> }
  pairs: Record<string, CatalogPair>
}

export const CATALOG = catalogJson as Catalog

export const TRANSLATE_ATTRIBUTION =
  'Translation models by Mozilla (Firefox Translations, MPL-2.0). They run on this Mac; text is never sent anywhere.'

const pairIndex = new Map<string, CatalogPair>()
for (const pair of Object.values(CATALOG.pairs)) pairIndex.set(`${pair.from}>${pair.to}`, pair)

export function pairFor(from: string, to: string, catalog: Catalog = CATALOG): CatalogPair | null {
  if (catalog === CATALOG) return pairIndex.get(`${from}>${to}`) ?? null
  return Object.values(catalog.pairs).find((pair) => pair.from === from && pair.to === to) ?? null
}

/** Languages with models in both directions with English, sorted by code. */
export function catalogLanguages(catalog: Catalog = CATALOG): string[] {
  const codes = new Set<string>()
  for (const pair of Object.values(catalog.pairs)) {
    if (pair.from === PIVOT_LANGUAGE) codes.add(pair.to)
  }
  return [...codes].filter((code) => pairFor(code, PIVOT_LANGUAGE, catalog)).sort()
}

export function isSupportedLanguage(code: string, catalog: Catalog = CATALOG): boolean {
  return code === PIVOT_LANGUAGE || catalogLanguages(catalog).includes(code)
}

/** The models to chain for from → to: one direct pair, or two through English. */
export function routeFor(from: string, to: string, catalog: Catalog = CATALOG): CatalogPair[] | null {
  if (from === to) return null
  const direct = pairFor(from, to, catalog)
  if (direct) return [direct]
  if (from === PIVOT_LANGUAGE || to === PIVOT_LANGUAGE) return null
  const first = pairFor(from, PIVOT_LANGUAGE, catalog)
  const second = pairFor(PIVOT_LANGUAGE, to, catalog)
  return first && second ? [first, second] : null
}

/** Both directions with English, for one language. */
export function pairsForLanguage(code: string, catalog: Catalog = CATALOG): CatalogPair[] {
  return [pairFor(code, PIVOT_LANGUAGE, catalog), pairFor(PIVOT_LANGUAGE, code, catalog)].filter((pair): pair is CatalogPair => pair !== null)
}

export function pairBytes(pair: CatalogPair): number {
  return pair.files.reduce((sum, file) => sum + file.bytes, 0)
}

export function attachmentUrl(location: string, catalog: Catalog = CATALOG): string {
  const base = catalog.attachmentsBase.endsWith('/') ? catalog.attachmentsBase : `${catalog.attachmentsBase}/`
  if (!/^[A-Za-z0-9/_.-]+$/.test(location) || location.includes('..')) throw new Error('Invalid model location.')
  return `${base}${location}`
}
