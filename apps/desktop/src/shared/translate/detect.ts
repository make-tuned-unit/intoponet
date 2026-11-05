import { normalizeLanguage } from '@intoponet/browser-api'

/**
 * Small, dependency-free language guess for page text: the page's declared
 * language when it is plausible, then writing system, then common-word
 * counts for Latin-script languages. It is a suggestion the user can change,
 * not a classifier.
 */

const SCRIPTS: Array<[RegExp, string]> = [
  [/[぀-ヿ]/g, 'ja'],
  [/[가-힯ᄀ-ᇿ]/g, 'ko'],
  [/[฀-๿]/g, 'th'],
  [/[֐-׿]/g, 'he'],
  [/[Ͱ-Ͽ]/g, 'el'],
  [/[ঀ-৿]/g, 'bn'],
  [/[஀-௿]/g, 'ta'],
  [/[ఀ-౿]/g, 'te'],
  [/[ಀ-೿]/g, 'kn'],
  [/[ഀ-ൿ]/g, 'ml'],
  [/[઀-૿]/g, 'gu'],
  [/[ऀ-ॿ]/g, 'hi'],
  [/[؀-ۿݐ-ݿ]/g, 'ar'],
  [/[Ѐ-ӿ]/g, 'ru'],
  [/[一-鿿]/g, 'zh-Hans'],
]

/** Characters that only appear in Traditional Chinese. */
const TRADITIONAL = /[們這個國會為與對學說時們經從開關體點應萬東車長門問發現後雖認識實讓還進過電話題無頭機]/g
const SIMPLIFIED = /[们这个国会为与对学说时经从开关体点应万东车长门问发现后虽认识实让还进过电话题无头机]/g

const STOPWORDS: Record<string, string[]> = {
  en: ['the', 'and', 'of', 'to', 'in', 'is', 'that', 'for', 'with', 'was', 'on', 'are', 'this', 'by'],
  es: ['el', 'la', 'de', 'que', 'y', 'en', 'los', 'del', 'las', 'por', 'una', 'para', 'con', 'se', 'es'],
  pt: ['o', 'a', 'de', 'que', 'e', 'do', 'da', 'em', 'um', 'para', 'com', 'não', 'uma', 'os', 'no', 'na'],
  fr: ['le', 'la', 'les', 'de', 'des', 'et', 'est', 'un', 'une', 'du', 'que', 'pour', 'dans', 'pas', 'qui', 'sur'],
  it: ['il', 'di', 'che', 'e', 'la', 'per', 'un', 'non', 'del', 'della', 'è', 'una', 'gli', 'con', 'sono'],
  de: ['der', 'die', 'und', 'das', 'ist', 'nicht', 'mit', 'den', 'ein', 'zu', 'von', 'sich', 'auf', 'für', 'eine'],
  nl: ['de', 'het', 'een', 'en', 'van', 'is', 'dat', 'niet', 'op', 'te', 'zijn', 'voor', 'met', 'die', 'ook'],
  sv: ['och', 'att', 'det', 'som', 'en', 'är', 'på', 'för', 'av', 'med', 'inte', 'till', 'har', 'den', 'ett'],
  da: ['og', 'at', 'det', 'er', 'en', 'til', 'på', 'som', 'med', 'for', 'af', 'ikke', 'har', 'den', 'et'],
  nb: ['og', 'det', 'er', 'som', 'på', 'til', 'en', 'av', 'for', 'med', 'ikke', 'har', 'jeg', 'at', 'ble'],
  pl: ['i', 'w', 'nie', 'na', 'się', 'z', 'jest', 'że', 'do', 'to', 'jak', 'od', 'po', 'przez', 'dla'],
  cs: ['a', 'se', 'na', 'je', 'že', 'v', 'to', 'do', 'jako', 'pro', 'ale', 'jsou', 'byl', 'od', 'který'],
  sk: ['a', 'sa', 'na', 'je', 'že', 'v', 'to', 'do', 'ako', 'pre', 'ale', 'sú', 'bol', 'od', 'ktorý'],
  ro: ['și', 'de', 'în', 'la', 'cu', 'pe', 'nu', 'din', 'este', 'o', 'un', 'că', 'pentru', 'care', 'mai'],
  hu: ['a', 'az', 'és', 'hogy', 'nem', 'is', 'egy', 'meg', 'van', 'csak', 'már', 'de', 'ez', 'volt', 'mint'],
  tr: ['ve', 'bir', 'bu', 'da', 'de', 'için', 'ile', 'çok', 'gibi', 'daha', 'olarak', 'ama', 'olan', 'en', 'ne'],
  fi: ['ja', 'on', 'ei', 'että', 'se', 'oli', 'hän', 'ovat', 'kuin', 'mutta', 'myös', 'tai', 'joka', 'ole', 'sen'],
  et: ['ja', 'on', 'ei', 'et', 'see', 'oli', 'ka', 'kui', 'aga', 'mis', 'oma', 'või', 'ning', 'seda', 'kes'],
  id: ['dan', 'yang', 'di', 'ini', 'itu', 'dengan', 'untuk', 'tidak', 'dari', 'dalam', 'akan', 'pada', 'juga', 'ke', 'adalah'],
  ms: ['dan', 'yang', 'di', 'ini', 'itu', 'dengan', 'untuk', 'tidak', 'dari', 'dalam', 'akan', 'pada', 'juga', 'ialah', 'kepada'],
  vi: ['và', 'của', 'là', 'có', 'không', 'được', 'các', 'cho', 'một', 'những', 'người', 'trong', 'với', 'này', 'đã'],
  ca: ['el', 'la', 'de', 'i', 'que', 'en', 'els', 'les', 'per', 'amb', 'una', 'del', 'és', 'no', 'als'],
  hr: ['i', 'je', 'u', 'da', 'se', 'na', 'za', 'su', 'od', 'ne', 'koji', 'ali', 'što', 'kao', 'iz'],
  sl: ['in', 'je', 'v', 'da', 'se', 'na', 'za', 'so', 'od', 'ne', 'ki', 'pa', 'tudi', 'kot', 'iz'],
  lt: ['ir', 'kad', 'yra', 'su', 'į', 'iš', 'bet', 'kaip', 'tai', 'buvo', 'ne', 'jo', 'per', 'už', 'apie'],
  lv: ['un', 'ir', 'ka', 'ar', 'no', 'uz', 'par', 'kas', 'bet', 'vai', 'tas', 'arī', 'nav', 'kā', 'bija'],
  sq: ['dhe', 'të', 'në', 'një', 'për', 'me', 'që', 'nga', 'është', 'u', 'se', 'si', 'por', 'janë', 'do'],
  tl: ['ang', 'ng', 'sa', 'na', 'at', 'mga', 'ay', 'si', 'para', 'hindi', 'ito', 'kay', 'niya', 'nang', 'din'],
  af: ['die', 'en', 'van', 'is', 'het', 'in', 'om', 'te', 'nie', 'wat', 'vir', 'op', 'met', 'dat', 'sy'],
  is: ['og', 'að', 'í', 'á', 'er', 'sem', 'til', 'um', 'með', 'ekki', 'var', 'það', 'en', 'af', 'við'],
  // Faroese: close to Icelandic, but "tað", "ikki", "at", "teir", "hjá", and ø rather than ö.
  fo: ['og', 'at', 'tað', 'er', 'í', 'á', 'sum', 'til', 'um', 'við', 'ikki', 'eru', 'hevur', 'teir', 'hjá', 'fyri', 'eisini', 'hetta', 'verður', 'ein'],
  eu: ['eta', 'da', 'ez', 'bat', 'du', 'dira', 'ere', 'baina', 'zen', 'izan', 'hau', 'dute', 'egin', 'beste', 'zuen'],
  gl: ['o', 'a', 'de', 'que', 'e', 'do', 'da', 'en', 'un', 'para', 'con', 'non', 'unha', 'os', 'no'],
  az: ['və', 'bir', 'bu', 'da', 'də', 'üçün', 'ilə', 'çox', 'kimi', 'daha', 'olaraq', 'amma', 'olan', 'ən', 'nə'],
}

const STOPWORD_SETS = Object.entries(STOPWORDS).map(([code, words]) => [code, new Set(words)] as const)

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

/** Guess from text alone. Returns null for too little evidence. */
export function detectFromText(text: string): string | null {
  const sample = text.slice(0, 6_000)
  const letters = count(sample, /\p{L}/gu)
  if (letters < 20) return null
  let best: [string, number] = ['', 0]
  for (const [pattern, code] of SCRIPTS) {
    const n = count(sample, pattern)
    if (n > best[1]) best = [code, n]
  }
  const kana = count(sample, /[぀-ヿ]/g)
  if (kana >= 5) return 'ja'
  if (best[1] / letters > 0.3) {
    const [code] = best
    if (code === 'zh-Hans') return count(sample, TRADITIONAL) > count(sample, SIMPLIFIED) ? 'zh-Hant' : 'zh-Hans'
    if (code === 'ar') {
      if (count(sample, /[ٹڈڑںے]/g) >= 3) return 'ur'
      if (count(sample, /[پچژگکی]/g) >= 5) return 'fa'
      return 'ar'
    }
    if (code === 'hi') {
      // Nepali and Hindi share Devanagari: their grammar words tell them apart ("संस्थामा", "छ" vs "में", "है").
      const words = sample.split(/[\s\p{P}]+/u).filter(Boolean)
      const nepali = words.filter((word) => /^(छ|छन्|छौं|हो|हुन्छ|लाई|गर्ने|भएको|र)$/.test(word) || /(मा|लाई|हरू|छौं|छन्|हुने|गर्ने)$/.test(word)).length
      const hindi = words.filter((word) => /^(में|है|हैं|और|से|का|की|के|था|थे|थी|नहीं|पर|ने|भी)$/.test(word)).length
      return nepali > hindi ? 'ne' : 'hi'
    }
    if (code === 'ru') {
      if (count(sample, /[ђјљњћџ]/gi) >= 3) return 'sr'
      // Kazakh and Mongolian Cyrillic: their own letters (Mongolian adds only ө and ү).
      if (count(sample, /[әғқұһ]/gi) >= 2) return 'kk'
      if (count(sample, /[өү]/gi) >= 2 && count(sample, /[әғқұһің]/gi) === 0) return 'mn'
      if (count(sample, /[ў]/gi) >= 2) return 'be'
      if (count(sample, /[іїєґ]/gi) >= 3) return 'uk'
      if (count(sample, /ы/gi) === 0 && count(sample, /ъ/gi) >= 3) return 'bg'
      return 'ru'
    }
    return code
  }
  // Faroese writes ø beside ð (Icelandic has ð and ö, Danish and Norwegian ø but no ð).
  if (count(sample, /ð/gi) >= 2 && count(sample, /ø/gi) >= 2) return 'fo'
  const words = sample.toLowerCase().match(/\p{L}+/gu) ?? []
  if (words.length < 8) return null
  const scores = STOPWORD_SETS.map(([code, set]) => [code, words.reduce((sum, word) => sum + (set.has(word) ? 1 : 0), 0)] as const)
    .sort((a, b) => b[1] - a[1])
  const [top, second] = scores
  if (!top || top[1] < 3 || top[1] / words.length < 0.05) return null
  // Close calls between near-identical lists (es/gl, id/ms, da/nb, cs/sk) go to the larger language.
  if (second && second[1] === top[1]) {
    const preferred = ['en', 'es', 'pt', 'fr', 'de', 'id', 'da', 'cs', 'hr']
    const rank = (code: string): number => (preferred.includes(code) ? preferred.indexOf(code) : 99)
    return rank(top[0]) <= rank(second[0]) ? top[0] : second[0]
  }
  return top[0]
}

const LATIN = new Set(Object.keys(STOPWORDS))

/**
 * Prefer the page's declared language unless the text clearly contradicts it:
 * a different writing system, or an 'en' template default over text whose
 * common words are plainly another language.
 */
export function detectLanguage(declared: string | null | undefined, text: string): string | null {
  const fromTag = normalizeLanguage(declared)
  const fromText = detectFromText(text)
  if (!fromTag) return fromText
  if (!fromText || fromTag === fromText) return fromTag
  // Faroese pages are often tagged Icelandic or Danish; its ø-with-ð spelling is clearer evidence than the tag.
  if (fromText === 'fo') return 'fo'
  const tagLatin = LATIN.has(fromTag)
  const textLatin = LATIN.has(fromText)
  if (tagLatin !== textLatin) return fromText
  if (fromTag === 'en' && textLatin) return fromText
  return fromTag
}

/** Short function words that headlines use (headlines drop most others). */
const HEADLINE_WORDS: Record<string, string[]> = {
  en: ['after', 'over', 'says', 'from', 'as', 'at', 'will', 'into', 'its', 'new', 'amid', 'their'],
  es: ['sus', 'su', 'entre', 'al', 'sobre', 'tras', 'ante', 'más', 'como', 'pero', 'hasta', 'según', 'desde'],
  pt: ['seu', 'sua', 'mais', 'sobre', 'entre', 'após', 'ao', 'pelo', 'pela', 'nos', 'nas', 'até'],
  fr: ['sur', 'entre', 'après', 'plus', 'avec', 'sans', 'aux', 'au', 'ses', 'son', 'leur', 'selon', 'contre'],
  it: ['sul', 'nel', 'dopo', 'più', 'tra', 'fra', 'alla', 'dal', 'sulla', 'nella', 'contro'],
  de: ['im', 'vom', 'zum', 'zur', 'nach', 'gegen', 'über', 'bei', 'aus', 'wird', 'mehr'],
  nl: ['bij', 'naar', 'over', 'uit', 'na', 'tegen', 'wordt', 'meer'],
}

const HEADLINE_SETS = Object.entries(STOPWORDS).map(([code, words]) => [code, new Set([...words, ...(HEADLINE_WORDS[code] ?? [])])] as const)

/** Letters that belong to one language (or a close pair), for headlines too short for word counts. */
const LETTERS: Array<[RegExp, string]> = [
  // Polish and Lithuanian share ą and ę: Polish by its own letters, Lithuanian by ė, į, ų, ū.
  [/[łżźśćń]/i, 'pl'],
  [/[ėįųū]/i, 'lt'],
  [/[ąę]/i, 'pl'],
  [/[őű]/i, 'hu'],
  [/[șțăâî]/i, 'ro'],
  [/[ğış]|İ/, 'tr'],
  [/[ãõ]/i, 'pt'],
  [/[řůě]/i, 'cs'],
  [/[ľĺŕ]/i, 'sk'],
  [/[āēīūļņķģ]/i, 'lv'],
  [/[ñ¿¡]/i, 'es'],
  // å is Swedish and Norwegian too: only æ/ø point to Danish.
  [/[æø]/i, 'da'],
  [/ß|[äöü].*\b(der|die|das|und)\b/i, 'de'],
  [/ø.*ð|ð.*ø/i, 'fo'],
  [/[ðþ]/i, 'is'],
  [/[ơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđ]/i, 'vi'],
]

/**
 * The language of a short text such as a headline: its writing system, then
 * letters only one language uses, then common words (two are enough here).
 * Null when it cannot tell; English is returned only on clear evidence.
 */
export function detectHeadline(text: string): string | null {
  const sample = text.slice(0, 400)
  const letters = count(sample, /\p{L}/gu)
  if (letters < 8) return null
  for (const [pattern, code] of SCRIPTS) {
    if (count(sample, pattern) / letters > 0.3) return detectFromText(sample.repeat(3)) ?? code
  }
  const words = sample.toLowerCase().match(/\p{L}+/gu) ?? []
  const scores = HEADLINE_SETS.map(([code, set]) => [code, words.reduce((sum, word) => sum + (set.has(word) ? 1 : 0), 0)] as const)
    .sort((a, b) => b[1] - a[1])
  const lettered = LETTERS.find(([pattern]) => pattern.test(sample))?.[1]
  const [top, second] = scores
  // A language's own letter decides, unless another language's common words clearly outnumber its own (Faroese "hjá … at" with Icelandic ð).
  const letteredScore = scores.find(([code]) => code === lettered)?.[1] ?? 0
  if (lettered && (!top || top[0] === lettered || top[1] < 2 || top[1] <= letteredScore + 1)) return lettered
  if (!top || top[1] < 2 || (second && second[1] === top[1])) return null
  return top[0]
}

/**
 * A headline's language: its feed's declared language, unless the headline
 * plainly says otherwise (an outlet tagged one language publishing in
 * another); detected when the feed declares none.
 */
export function headlineLanguage(declared: string | null | undefined, title: string): string | null {
  const tag = normalizeLanguage(declared)
  const found = detectHeadline(title)
  if (!tag) return found
  if (!found || found === tag) return tag
  // Override only on strong evidence: another writing system, or a language-specific letter.
  const otherScript = SCRIPTS.some(([pattern]) => count(title, pattern) > 3)
  // Romanian sites often write ş/ţ with a cedilla, which is also Turkish: alone it proves neither over the other.
  const shared = (tag === 'ro' && found === 'tr') || (tag === 'tr' && found === 'ro') ? title.replace(/[şŞţŢ]/g, '') : title
  // Danish and Norwegian share æ, ø and å: a Norwegian feed's headline stays Norwegian.
  if (['da', 'nb', 'no', 'nn'].includes(tag) && ['da', 'nb', 'no', 'nn'].includes(found)) return tag
  const letterProof = LETTERS.some(([pattern, code]) => code === found && pattern.test(shared))
  return otherScript || letterProof || tag === 'en' ? found : tag
}
