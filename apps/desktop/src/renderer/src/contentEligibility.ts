import type { FieldSnapshot, SourceRecord } from '@intoponet/field-snapshot'
import { signalsFromSnapshot, type InterestSignal } from './interestField'

export type FrequencyEligibilityInput = {
  url: string
  title: string
  topic?: string
  rating?: string | null
}

export type FrequencyEligibilityResult = {
  eligible: boolean
  reason: string
}

export type FrequencySnapshotFilterResult = {
  snapshot: FieldSnapshot
  excludedSourceCount: number
  excludedBandCount: number
}

const MAX_METADATA_LENGTH = 8_192

// Intentionally specific, established explicit-content destinations. General
// creator, health, education, and social platforms are not blanket-blocked.
const EXPLICIT_ADULT_DOMAINS = [
  'pornhub.com',
  'xvideos.com',
  'xhamster.com',
  'xnxx.com',
  'redtube.com',
  'youporn.com',
  'spankbang.com',
  'tube8.com',
  'brazzers.com',
  'bangbros.com',
  'adulttime.com',
  'porn.com',
  'motherless.com',
  'manyvids.com',
  'cam4.com',
  'livejasmin.com',
  'chaturbate.com',
  'stripchat.com',
  'naughtyamerica.com',
] as const

const EXPLICIT_WORDING = /\b(?:porn(?:ography|ographic)?|nsfw|xxx|adult\s+(?:content|video|film|movie|entertainment)|explicit\s+(?:adult|sexual|sex)|sex\s+(?:tape|video|film)|sexual(?:ly)?\s+explicit)\b/i
const EXPLICIT_PATH_SEGMENT = /(?:^|\/)(?:porn(?:ography)?|nsfw|xxx|adult-(?:content|video|film|movie|entertainment)|explicit-(?:adult|sexual|sex)|sex-(?:tape|video|film))(?:\/|$)/i
const RESTRICTED_RATING = /(?:^|[^a-z0-9])(?:nc[\s._-]?17|tv[\s._-]?ma|(?:age[\s._:-]*|rated[\s._:-]*|rating[\s._:-]*)?18(?:\s*(?:\+|plus))?)(?=$|[^a-z0-9])/i
const EXPLICIT_R_RATING = /(?:^|[^a-z0-9])(?:rated[\s._-]*r|r[\s._-]*rated)(?=$|[^a-z0-9])/i
const RATING_REQUIRED_TOPICS = new Set(['adult', 'cinema', 'entertainment', 'film', 'films', 'movie', 'movies', 'streaming', 'television', 'tv'])
const RECOGNIZED_NONRESTRICTED_RATINGS = new Set(['G', 'PG', 'PG13', 'TVG', 'TVPG', 'TV14', 'TVY', 'TVY7', 'TVY7FV', 'U', '12', '12A'])

function ratingRequiredForTopic(topic: string | undefined): boolean {
  if (!topic) return false
  const normalized = decodeForInspection(topic).toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return RATING_REQUIRED_TOPICS.has(normalized)
}

function hasRecognizedNonrestrictedRating(rating: string): boolean {
  const labels = decodeForInspection(rating).split(/[|,;]+/).map((part) => part.trim()).filter(Boolean)
  if (!labels.length) return false
  return labels.every((label) => {
    const normalized = label
      .toUpperCase()
      .replace(/^(?:(?:CONTENT\s+)?RATING|RATED|MPA|BBFC|US|UK)\s*[:=\-]?\s*/, '')
      .replace(/[^A-Z0-9]+/g, '')
    return RECOGNIZED_NONRESTRICTED_RATINGS.has(normalized)
  })
}

function decodeForInspection(value: string): string {
  let decoded = value
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      break
    }
  }
  return decoded
}

function parseCandidateUrl(rawUrl: string): URL | null {
  try {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(rawUrl)) return new URL(rawUrl)
    if (rawUrl.startsWith('//')) return new URL(`https:${rawUrl}`)
    return new URL(`https://${rawUrl}`)
  } catch {
    return null
  }
}

function hasExplicitAdultDomain(rawUrl: string): boolean {
  const url = parseCandidateUrl(rawUrl)
  if (!url) return false
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  return EXPLICIT_ADULT_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}

function hasRestrictedRating(rating: string): boolean {
  const normalized = decodeForInspection(rating).trim()
  if (!normalized) return false
  return /\br\b/i.test(normalized) || RESTRICTED_RATING.test(normalized) || EXPLICIT_R_RATING.test(normalized)
}

/**
 * Conservative metadata screen for frequency-map eligibility. It does not
 * fetch the URL, inspect page content, or certify that undetected content is
 * safe. A positive match excludes the item; lack of a match is not a safety
 * guarantee.
 */
export function evaluateFrequencyEligibility(input: FrequencyEligibilityInput): FrequencyEligibilityResult {
  if (!input || typeof input !== 'object') {
    return { eligible: false, reason: 'Content metadata is missing; excluded conservatively.' }
  }
  const fields = [input.url, input.title, input.topic ?? '', input.rating ?? '']
  if (fields.some((field) => typeof field !== 'string')) {
    return { eligible: false, reason: 'Content metadata is malformed; excluded conservatively.' }
  }
  if (fields.some((field) => field.length > MAX_METADATA_LENGTH)) {
    return { eligible: false, reason: `Content metadata exceeds the ${MAX_METADATA_LENGTH}-character scan limit; excluded conservatively.` }
  }

  if (hasRestrictedRating(input.rating ?? '')) {
    return { eligible: false, reason: 'An R, NC-17, TV-MA, or 18+ rating marker was detected.' }
  }
  if (hasExplicitAdultDomain(input.url)) {
    return { eligible: false, reason: 'The URL host matches a known explicit-adult domain.' }
  }

  const inspectedUrl = decodeForInspection(input.url)
  const parsedUrl = parseCandidateUrl(input.url)
  const urlPath = parsedUrl ? decodeForInspection(`${parsedUrl.pathname}/${parsedUrl.search}`) : inspectedUrl
  if (EXPLICIT_PATH_SEGMENT.test(urlPath)) {
    return { eligible: false, reason: 'The URL path contains an explicit-adult content marker.' }
  }
  if (EXPLICIT_WORDING.test(`${inspectedUrl} ${input.title} ${input.topic ?? ''}`)) {
    return { eligible: false, reason: 'The URL, title, or topic contains an explicit-adult content marker.' }
  }
  if (EXPLICIT_R_RATING.test(`${input.title} ${input.topic ?? ''}`)) {
    return { eligible: false, reason: 'The title or topic contains an explicit R-rating marker.' }
  }
  if (ratingRequiredForTopic(input.topic) && !hasRecognizedNonrestrictedRating(input.rating ?? '')) {
    return { eligible: false, reason: 'This entertainment category lacks a recognized nonrestricted source rating; excluded until a supported rating is available.' }
  }

  return {
    eligible: true,
    reason: 'No known explicit-adult or restricted-rating marker was detected; this metadata screen does not certify content safety.',
  }
}

function sourceEligibility(source: SourceRecord): FrequencyEligibilityResult {
  const decisions = source.topics.map((topic) => evaluateFrequencyEligibility({
    url: source.url,
    title: source.title,
    topic,
  }))
  if (!source.topics.length) decisions.push(evaluateFrequencyEligibility({ url: source.url, title: source.title }))
  return decisions.find((decision) => !decision.eligible) ?? evaluateFrequencyEligibility({ url: source.url, title: source.title })
}

/**
 * Filter a stored or newly loaded snapshot before it becomes map signals.
 * If an aggregate band contains a missing or excluded source, drop the whole
 * band: its amplitude cannot be safely recomputed from the legacy aggregate.
 */
export function filterSnapshotForFrequencyEligibility(snapshot: FieldSnapshot): FrequencySnapshotFilterResult {
  const decisions = new Map(snapshot.sources.map((source) => [source.id, sourceEligibility(source)]))
  const eligibleIds = new Set(snapshot.sources.filter((source) => decisions.get(source.id)?.eligible).map((source) => source.id))
  const sources = snapshot.sources.filter((source) => eligibleIds.has(source.id))
  const bands = snapshot.bands.filter((band) => band.sourceIds.length > 0 && band.sourceIds.every((sourceId) => eligibleIds.has(sourceId)))
  return {
    snapshot: { ...snapshot, sources, bands },
    excludedSourceCount: snapshot.sources.length - sources.length,
    excludedBandCount: snapshot.bands.length - bands.length,
  }
}

/** Convert an already filtered snapshot to radial renderer inputs. */
export function eligibleSignalsFromSnapshot(snapshot: FieldSnapshot, topicId: string): InterestSignal[] {
  return signalsFromSnapshot(filterSnapshotForFrequencyEligibility(snapshot).snapshot, topicId)
}
