import blocklist from '../data/blocklist.json'
import neverBlock from '../data/never-block.json'
import { fixtureRules } from './fixtures'
import type { CompiledRule } from './types'

/** One entry of data/blocklist.json: a rule, with who it is and how it got on the list. */
export type BlocklistEntry = {
  host: string
  category: 'ad' | 'tracker'
  service: string
  company: string
  kind: string
  source: string
  paths?: string[]
  pathIncludes?: string[]
  evidence?: { publishers: number; of: number; requests: number; signals: string[]; cookieDays?: number }
  note?: string
}

export const blocklistEntries = blocklist.entries as BlocklistEntry[]
export const blocklistSummary = blocklist.summary
export const blocklistMeasurement = blocklist.measurement as { publishers: number; pages: number; countries: number; languages: number; from: string; to: string } | null

/**
 * The rules the app blocks with: Intoponet's own list (data/blocklist.json, built by
 * scripts/protection-classify.mjs from hand-written services and the project's own measurement),
 * the two test hosts the checks ask for, and an exception for every host on the never-block list
 * (data/never-block.json), so a consent dialog, sign-in or player under a listed domain still loads.
 */
export const defaultRules: CompiledRule[] = [
  ...fixtureRules,
  ...blocklistEntries.map((entry, index): CompiledRule => ({
    id: `own-${index}-${entry.host}`,
    host: entry.host,
    category: entry.category,
    ...(entry.paths ? { paths: entry.paths } : {}),
    ...(entry.pathIncludes ? { pathIncludes: entry.pathIncludes } : {}),
  })),
  ...neverBlock.never.map(([host]): CompiledRule => ({ id: `never-${host}`, host: host as string, category: 'other', allow: true })),
]
