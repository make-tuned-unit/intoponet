import type { KnowledgeClaim, KnowledgeDocument } from '@intoponet/browser-api'

/**
 * Claims in absorbed pages (PRD ABS-004), labelled honestly:
 * - stated: the page says it (with whom it attributes it to, when it does);
 * - corroborated: another site you absorbed gives the same figure or quote;
 * - disputed: the page itself flags it as contested, or another site gives a
 *   clearly different figure for the same thing.
 * Places, names and dates Intoponet detects are inferences and are shown as such
 * in the reader. Nothing here judges truth; it reports agreement between your
 * own sources.
 */

const STOP = new Set(('the a an and or of to in on for with by from at as is are was were be been has have had that this these those it its their his her our we they he she not no but than then into over under about after before more most less least per percent million billion thousand year years since also said says according').split(' '))
const DISPUTE = /\b(disputed|contested|denied|denies|refuted|disputes|unverified|without evidence|false(?:ly)? claim|misleading|debunked|challenged|questioned by|contradict(?:s|ed)?)\b/i
const ATTRIBUTION = /\b(?:[Aa]ccording to|[Ss]aid|[Ss]ays|[Tt]old|[Ss]tated|[Rr]eported|[Ee]stimates?|[Ee]stimated by|[Ff]ound by|[Pp]er)\s+((?:the\s+)?[A-Z][\w.&'-]*(?:\s+(?:(?:on|of|for|and|de)\s+)?[A-Z][\w.&'-]*){0,7})/
const QUOTE = /[“"]([^”"]{25,400})[”"]/

/** Figures with their unit or context word, normalised: "1.5 °C", "40%", "3.6 billion". */
/** Footnote and citation markers ("[8]", "warming.2 Most") are not figures. */
export function withoutCitations(sentence: string): string {
  return sentence.replace(/\[(?:\d+|[a-z]|note \d+|citation needed)\]/gi, '').replace(/([a-z\)\]”"])[.,;:]?(\d{1,3})(?=\s+[A-Z]|\s*$)/g, (match, before: string) => `${before}${match.slice(before.length).replace(/\d+$/, '')}`)
}

export function figuresIn(sentence: string): Array<{ value: number; unit: string; text: string }> {
  const out: Array<{ value: number; unit: string; text: string }> = []
  const pattern = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(%|percent|per cent|°\s?C|°\s?F|degrees? Celsius|degrees? Fahrenheit|degrees?|million|billion|trillion|thousand|cm|mm|km|kilometres?|kilometers?|miles?|tonnes?|tons?|people|deaths|cases|kg|ppm|GW|MW|metres?|meters?|years?)?/gi
  for (const match of withoutCitations(sentence).matchAll(pattern)) {
    const raw = match[1]!.replace(/,/g, '')
    let value = Number(raw)
    if (!Number.isFinite(value)) continue
    const unit = (match[2] ?? '').toLowerCase().replace(/\s+/g, '').replace(/^per ?cent$/, '%').replace(/^percent$/, '%').replace(/^degrees?celsius$/, '°c').replace(/^degrees?fahrenheit$/, '°f').replace(/^degrees?$/, '°').replace(/s$/, '')
    // Bare years and small counts are context, not figures worth tracking.
    if (!unit && (value < 10 || (value >= 1800 && value <= 2100 && Number.isInteger(value)))) continue
    if (unit === 'million') value *= 1e6
    else if (unit === 'billion') value *= 1e9
    else if (unit === 'trillion') value *= 1e12
    else if (unit === 'thousand') value *= 1e3
    const kind = ['million', 'billion', 'trillion', 'thousand'].includes(unit) ? 'count' : unit || 'count'
    out.push({ value, unit: kind, text: match[0].trim() })
  }
  return out
}

/** Content words that say what a claim is about (for matching across sources). */
export function subjectWords(sentence: string): string[] {
  return [...new Set(sentence.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z][a-z-]{3,}/g) ?? [])]
    .filter((word) => !STOP.has(word))
    .map((word) => word.slice(0, 7))
}

function sentences(paragraph: string): string[] {
  return paragraph.replace(/\s+/g, ' ').split(/(?<=[.!?…])\s+(?=[“"A-Z0-9])/).map((item) => item.trim()).filter((item) => item.length >= 30 && item.length <= 600)
}

type Raw = Omit<KnowledgeClaim, 'status' | 'evidence'> & { figures: Array<{ value: number; unit: string }>; words: string[]; quote: string | null; flagged: boolean }

/** Sentences worth keeping as claims: those with figures or quotations, or that the page marks as contested. */
export function extractClaims(document: Pick<KnowledgeDocument, 'paragraphs'>, limit = 40): Raw[] {
  const out: Raw[] = []
  document.paragraphs.forEach((paragraph, paragraphIndex) => {
    for (const sentence of sentences(paragraph)) {
      const figures = figuresIn(sentence)
      const quote = withoutCitations(sentence).match(QUOTE)?.[1]?.trim() ?? null
      const flagged = DISPUTE.test(sentence)
      if (!figures.length && !quote && !flagged) continue
      const attributedTo = sentence.match(ATTRIBUTION)?.[1]?.trim().replace(/\s+(?:in|on|that|as|for|to)$/i, '') ?? null
      out.push({
        text: withoutCitations(sentence),
        paragraphIndex,
        kind: quote ? 'quote' : figures.length ? 'figure' : 'statement',
        attributedTo: attributedTo && attributedTo.length > 2 ? attributedTo : null,
        figures: figures.map(({ value, unit }) => ({ value, unit })),
        words: subjectWords(quote ?? sentence),
        quote,
        flagged,
      })
    }
  })
  return out.slice(0, limit)
}

/** Units precise enough that a clearly different value for the same subject is a real disagreement. */
const MEASURED = new Set(['%', '°c', '°f', 'ppm', 'cm', 'mm', 'km', 'kilometre', 'kilometer', 'mile', 'tonne', 'ton', 'kg', 'gw', 'mw', 'metre', 'meter'])

const host = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
const shared = (a: string[], b: string[]): number => a.filter((word) => b.includes(word)).length
const close = (a: number, b: number, tolerance: number): boolean => Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * tolerance

/** Label one document's claims against the rest of your knowledge. */
export function labelClaims(target: KnowledgeDocument, others: KnowledgeDocument[]): KnowledgeClaim[] {
  const mine = extractClaims(target)
  const site = host(target.url)
  const elsewhere = others
    .filter((doc) => doc.id !== target.id && host(doc.url) !== site)
    .flatMap((doc) => extractClaims(doc).map((claim) => ({ claim, doc })))
  return mine.map((claim): KnowledgeClaim => {
    const evidence: KnowledgeClaim['evidence'] = []
    let agrees = false
    let conflicts = false
    for (const { claim: other, doc } of elsewhere) {
      const overlap = shared(claim.words, other.words)
      if (claim.quote && other.quote && (claim.quote === other.quote || (overlap >= 5 && overlap >= claim.words.length * 0.7))) {
        agrees = true
        evidence.push({ recordId: doc.id, title: doc.title, site: host(doc.url), paragraphIndex: other.paragraphIndex, relation: 'agrees' })
        continue
      }
      if (overlap < 3) continue
      const strong = overlap >= 5 && overlap >= Math.min(claim.words.length, other.words.length) * 0.5
      for (const figure of claim.figures) {
        // Bare counts are too ambiguous to compare unless large and identical.
        if (figure.unit === 'count' && figure.value < 1000) continue
        const same = other.figures.filter((item) => item.unit === figure.unit)
        if (!same.length) continue
        if (same.some((item) => close(item.value, figure.value, 0.01))) {
          agrees = true
          evidence.push({ recordId: doc.id, title: doc.title, site: host(doc.url), paragraphIndex: other.paragraphIndex, relation: 'agrees' })
          break
        }
        // Same subject and unit, very different number, and nothing else in that sentence matches: a conflict worth seeing.
        if (strong && MEASURED.has(figure.unit) && same.every((item) => !close(item.value, figure.value, 0.25))) {
          conflicts = true
          evidence.push({ recordId: doc.id, title: doc.title, site: host(doc.url), paragraphIndex: other.paragraphIndex, relation: 'conflicts' })
          break
        }
      }
    }
    const status: KnowledgeClaim['status'] = claim.flagged || conflicts ? 'disputed' : agrees ? 'corroborated' : 'stated'
    const unique = evidence.filter((item, index) => evidence.findIndex((other) => other.recordId === item.recordId && other.relation === item.relation) === index).slice(0, 4)
    return { text: claim.text, paragraphIndex: claim.paragraphIndex, kind: claim.kind, attributedTo: claim.attributedTo, status, ...(claim.flagged ? { flaggedInText: true } : {}), evidence: unique }
  })
}
