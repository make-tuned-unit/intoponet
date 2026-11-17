import type { OldsInterpretation } from '@intoponet/browser-api'

/**
 * Competing interpretations (PRD OLD-005): attributed views from a Wikipedia
 * article's historiography, debate or legacy sections, shown side by side and
 * never ranked. Only sentences that name who holds a view ("Hobsbawm argued…",
 * "Revisionist historians contend…") are kept, with their section for checking.
 */

const SECTION = /historiograph|interpretation|debate|controvers|legacy|assessment|evaluation|reputation|perspectives|views|analysis|causes|explanations|reception|scholarship|dispute|approaches|syntheses|paradigm|according to/i
const WHO_GROUP = /(?:[A-Z][a-z]+-)?(?:Some|Many|Other|Most|Several|Few|Later|Earlier|Modern|Recent|Contemporary|Marxist|Revisionist|Nationalist|Orthodox|Liberal|Conservative|Feminist|Western|Soviet|Chinese|Indian|American|British|French|German|Japanese|Russian|Post-revisionist|Traditionalist)(?:\s+[a-z-]+)?\s+(?:historians|scholars|economists|critics|commentators|writers|analysts|researchers|academics|sociologists|political scientists|observers)/
const NAME = /(?:[A-Z][a-zà-ÿ'’-]+(?:\s+(?:[A-Z][a-zà-ÿ'’.-]+|de|van|von|al-|bin|da|del|du|le|la))*)/
const VERB = /(?:has |have |had )?(?:argue[sd]?|contend(?:s|ed)?|maintain(?:s|ed)?|suggest(?:s|ed)?|claim(?:s|ed)?|believe[sd]?|assert(?:s|ed)?|view(?:s|ed)?(?=\s+(?:the|it|this|these|those|that|them|him|her|its|his|their|such|[A-Z]))|describe[sd]?|attribute[sd]?|emphasi[sz]e[sd]?|insist(?:s|ed)?|reject(?:s|ed)?|dispute[sd]?|counter(?:s|ed)?|conclude[sd]?(?=,?\s+that\b)|interpret(?:s|ed)?|characteri[sz]e[sd]?|blame[sd]?|credit(?:s|ed)?|see|saw|wrote|writes)\b/
const CLAIM = new RegExp(`(?:^|[;:]\\s|,\\s(?:while|whereas|but)\\s|(?:However|By contrast|In contrast|Conversely|Meanwhile|Others?|Instead),?\\s)?(${WHO_GROUP.source}|${NAME.source})(?:\\s*\\([^)]{0,40}\\))?,?\\s+(?:(?:also|later|famously|instead|similarly|further|notably|largely|strongly|explicitly|generally)\\s+){0,2}${VERB.source}`)
const NOT_A_PERSON = /^(The|This|These|That|Those|It|In|On|At|By|As|For|From|With|After|Before|During|Although|While|When|However|Some|Many|Most|Other|Others|A|An|His|Her|Their|Its|He|She|They|We|One|Another|Each|Both|Such|There|Here|Thus|Hence|Yet)$/

/** Names that end in a kind of event, state or body ("Russian Civil War", "Soviet Union") are not people holding a view. */
const NOT_A_HOLDER = /\b(War|Wars|Revolution|Union|Empire|Republic|Kingdom|State|States|Government|Party|Army|Church|Assembly|Parliament|Congress|Treaty|Crisis|Depression|Restoration|Rebellion|Uprising|Movement|Period|Era|Age|Century)$/

export function sectionsFromExtract(text: string): Array<{ title: string; body: string }> {
  const out: Array<{ title: string; body: string }> = []
  const parts = text.split(/\n(={2,4})\s*([^=\n]+?)\s*\1\n/)
  for (let index = 1; index + 2 < parts.length + 1; index += 3) {
    const title = parts[index + 1]
    const body = parts[index + 2] ?? ''
    if (title) out.push({ title: title.trim(), body })
  }
  return out
}

export function interpretationsFrom(text: string, article: { title: string; url: string }, limit = 6): OldsInterpretation[] {
  const found: OldsInterpretation[] = []
  const seen = new Set<string>()
  for (const section of sectionsFromExtract(text)) {
    if (!SECTION.test(section.title)) continue
    const sentences = section.body.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z“"])/)
    for (const sentence of sentences) {
      if (sentence.length < 50 || sentence.length > 480) continue
      const match = sentence.match(CLAIM)
      const who = match?.[1]?.trim()
      if (!who || NOT_A_PERSON.test(who.split(/\s+/)[0]!)) continue
      if (!WHO_GROUP.test(who) && NOT_A_HOLDER.test(who)) continue
      // A lone capitalised word is usually not a person ("Britain argued"): keep groups or two-word names.
      if (!WHO_GROUP.test(who) && who.split(/\s+/).length < 2 && !/^[A-Z][a-z]+$/.test(who)) continue
      const key = who.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      found.push({
        who,
        view: sentence.trim(),
        section: section.title,
        url: `${article.url}#${encodeURIComponent(section.title.replace(/\s+/g, '_'))}`,
      })
      if (found.length >= limit) return found
    }
  }
  // One attributed view is not a debate.
  return found.length >= 2 ? found : []
}
