import type { CompareSide } from '@intoponet/browser-api'
import type { GlobalStoryHeadline } from '../../../shared/news/globalStories'

/** Another outlet a Compare side can read its story from: what to open, and where the outlet is. */
export type OutletChoice = { side: CompareSide; where: string }

/**
 * A Compare side whose article is gone: the story's other outlets (one article each, as listed),
 * leaving out the outlets already side by side. Only web addresses; at most `max`.
 */
export function otherOutlets(
  headlines: readonly GlobalStoryHeadline[] | undefined,
  shown: ReadonlyArray<string | undefined>,
  countryName: (code: string) => string,
  max = 5,
): OutletChoice[] {
  const seen = new Set(shown.filter((outlet): outlet is string => !!outlet))
  const choices: OutletChoice[] = []
  for (const headline of headlines ?? []) {
    if (choices.length >= max) break
    if (seen.has(headline.publisher) || !/^https?:\/\//i.test(headline.url) || !headline.countryCode) continue
    seen.add(headline.publisher)
    choices.push({
      side: {
        url: headline.url,
        outlet: headline.publisher,
        countryCode: headline.countryCode,
        ...(headline.international ? { international: true } : {}),
        ...(headline.lang ? { lang: headline.lang } : {}),
      },
      where: headline.international ? 'International desk' : countryName(headline.countryCode),
    })
  }
  return choices
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames([navigator.language, 'en'], { type: 'region' })
  } catch {
    return null
  }
})()

/** A country's name in the reader's language (the code when there is none). */
export function countryNameOf(code: string): string {
  try {
    return regionNames?.of(code) ?? code
  } catch {
    return code
  }
}
