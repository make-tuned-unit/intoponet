/**
 * On-device translation (PRD §12 internationalization; LAY-001/005 privacy).
 *
 * Models are Mozilla's Firefox Translations (MPL-2.0), downloaded only when
 * the user adds a language, pinned by SHA-256, and run in a worker with no
 * network access. Text never leaves the device. English is the pivot: every
 * language pair goes through English, so adding one language (both directions)
 * lets it translate to and from every other added language.
 */

export const translateChannels = {
  command: 'intoponet:translate',
  /** Main → renderer status, download progress and page-translation events. */
  event: 'intoponet:translate-event',
} as const

export const TRANSLATE_LIMITS = {
  texts: 200,
  textLength: 6_000,
  totalChars: 80_000,
} as const

/** Pivot language: always available, never downloaded. */
export const PIVOT_LANGUAGE = 'en'

export type TranslateLanguage = {
  /** BCP 47, e.g. 'es', 'ja', 'zh-Hans'. */
  code: string
  /** Bytes to download for both directions with English. */
  bytes: number
  downloaded: boolean
}

export type TranslateStatus = {
  languages: TranslateLanguage[]
  engine: { bytes: number; downloaded: boolean }
  /** A language currently downloading, if any. */
  downloading: { code: string; receivedBytes: number; totalBytes: number } | null
  lastError: string | null
  attribution: string
}

export type PageTranslationState =
  | { status: 'idle'; detected: string | null }
  | { status: 'translating'; from: string; to: string; done: number; total: number }
  | { status: 'translated'; from: string; to: string; blocks: number }
  | { status: 'error'; from: string | null; to: string | null; message: string }

export type TranslateEvent =
  | { type: 'status'; status: TranslateStatus }
  | { type: 'page'; url: string; state: PageTranslationState }

export type TranslateCommand =
  | { type: 'status' }
  | { type: 'install'; code: string }
  | { type: 'remove'; code: string }
  | { type: 'translate'; from: string; to: string; texts: string[]; html: boolean }
  | { type: 'page-state' }
  | { type: 'page-translate'; from: string; to: string }
  | { type: 'page-restore' }

export interface TranslateApi {
  status(): Promise<TranslateStatus>
  install(code: string): Promise<TranslateStatus>
  remove(code: string): Promise<TranslateStatus>
  /** Plain text (or HTML fragments when html is true); same order as given. */
  translate(input: { from: string; to: string; texts: string[]; html?: boolean }): Promise<string[]>
  pageState(): Promise<PageTranslationState>
  translatePage(from: string, to: string): Promise<PageTranslationState>
  restorePage(): Promise<PageTranslationState>
  /** Returns an unsubscribe function. */
  subscribe(listener: (event: TranslateEvent) => void): () => void
}

/**
 * Map a page or feed language tag to a model language code, or null when no
 * model covers it. Regional variants share one model ('pt-BR' → 'pt'), and
 * Chinese splits by script.
 */
export function normalizeLanguage(tag: string | null | undefined): string | null {
  if (!tag) return null
  const clean = tag.trim().replace(/_/g, '-')
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(clean)) return null
  const parts = clean.split('-')
  const primary = parts[0]!.toLowerCase()
  const rest = parts.slice(1).map((part) => part.toLowerCase())
  if (primary === 'zh') {
    if (rest.includes('hant') || rest.some((part) => part === 'tw' || part === 'hk' || part === 'mo')) return 'zh-Hant'
    return 'zh-Hans'
  }
  const aliases: Record<string, string> = { iw: 'he', in: 'id', ji: 'yi', fil: 'tl', no: 'nb', nn: 'nb', sh: 'hr', hbs: 'hr', tgl: 'tl', srp: 'sr' }
  return aliases[primary] ?? primary
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isLanguageCode(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z]{2,3}(-[A-Z][a-z]{3})?$/.test(value)
}

function language(value: unknown): string {
  if (!isLanguageCode(value)) throw new Error('Invalid language.')
  return value
}

export function parseTranslateCommand(value: unknown): TranslateCommand {
  if (!isRecord(value)) throw new Error('Invalid translate command.')
  switch (value['type']) {
    case 'status':
    case 'page-state':
    case 'page-restore':
      return { type: value['type'] }
    case 'install':
    case 'remove': {
      const code = language(value['code'])
      if (code === PIVOT_LANGUAGE) throw new Error('English is built in.')
      return { type: value['type'], code }
    }
    case 'page-translate': {
      const from = language(value['from'])
      const to = language(value['to'])
      if (from === to) throw new Error('Choose two different languages.')
      return { type: 'page-translate', from, to }
    }
    case 'translate': {
      const from = language(value['from'])
      const to = language(value['to'])
      if (from === to) throw new Error('Choose two different languages.')
      const texts = value['texts']
      if (!Array.isArray(texts) || texts.length > TRANSLATE_LIMITS.texts) throw new Error('Invalid texts.')
      let total = 0
      for (const text of texts) {
        if (typeof text !== 'string' || text.length > TRANSLATE_LIMITS.textLength) throw new Error('Invalid texts.')
        total += text.length
      }
      if (total > TRANSLATE_LIMITS.totalChars) throw new Error('Too much text at once.')
      if (typeof value['html'] !== 'boolean') throw new Error('Invalid translate command.')
      return { type: 'translate', from, to, texts: texts as string[], html: value['html'] }
    }
    default:
      throw new Error('Invalid translate command.')
  }
}
