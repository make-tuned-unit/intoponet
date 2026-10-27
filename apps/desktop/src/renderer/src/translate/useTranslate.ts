import { useCallback, useEffect, useState } from 'react'
import { normalizeLanguage, type PageTranslationState, type TranslateStatus } from '@intoponet/browser-api'

const TARGET_KEY = 'intoponet.translate.target.v1'

/** Languages Intl does not name on every system. */
const EXTRA_NAMES: Record<string, string> = { pap: 'Papiamento', tet: 'Tetum', crs: 'Seychellois Creole', dz: 'Dzongkha', rw: 'Kinyarwanda', so: 'Somali' }

/** Language name in the reader's language, e.g. 'Japanese'. */
export function languageName(code: string, locale = navigator.language): string {
  try {
    const name = new Intl.DisplayNames([locale, 'en'], { type: 'language' }).of(code)
    return name && name !== code ? name : EXTRA_NAMES[code] ?? code
  } catch {
    return code
  }
}

/** Language name in itself, e.g. '日本語'. */
export function nativeName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1)
  } catch {
    return code
  }
}

/**
 * Languages with no model of their own, translated roughly through their
 * closest relative that has one (always labelled "rough, via …").
 */
export const RELATED_MODEL: Record<string, string> = {
  fo: 'is', nn: 'nb', no: 'nb', lb: 'de', gsw: 'de', fy: 'nl', li: 'nl', mk: 'bg', cnr: 'sr', me: 'sr', ast: 'es', an: 'es', oc: 'ca',
}

/** The model to use for a language: its own, or a close relative's (rough). */
export function modelFor(code: string | null, supported: (code: string | null) => boolean): { code: string; rough: boolean } | null {
  if (!code) return null
  if (supported(code)) return { code, rough: false }
  const related = RELATED_MODEL[code]
  return related && supported(related) ? { code: related, rough: true } : null
}

export function formatMegabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`
}

function readTarget(): string {
  try {
    const saved = localStorage.getItem(TARGET_KEY)
    if (saved) return saved
  } catch {
    // ignore
  }
  return normalizeLanguage(navigator.language) ?? 'en'
}

export type TranslateModel = {
  status: TranslateStatus | null
  page: PageTranslationState
  target: string
  setTarget: (code: string) => void
  /** Codes that can be used right now (English plus downloaded languages). */
  ready: Set<string>
  /** True when a model covers the code. */
  supported: (code: string | null) => boolean
  install: (code: string) => Promise<void>
  remove: (code: string) => Promise<void>
  translatePage: (from: string, to: string) => Promise<void>
  restorePage: () => Promise<void>
  refreshPage: () => void
  error: string
  clearError: () => void
}

export function useTranslate(pageUrl: string, pageLoading: boolean): TranslateModel {
  const api = window.intoponet.translate
  const [status, setStatus] = useState<TranslateStatus | null>(null)
  const [page, setPage] = useState<PageTranslationState>({ status: 'idle', detected: null })
  const [target, setTargetState] = useState(readTarget)
  const [error, setError] = useState('')

  useEffect(() => {
    void api.status().then(setStatus).catch(() => undefined)
    return api.subscribe((event) => {
      if (event.type === 'status') setStatus(event.status)
      else setPage(event.state)
    })
  }, [api])

  const refreshPage = useCallback(() => {
    void api.pageState().then(setPage).catch(() => undefined)
  }, [api])

  // Ask for the page's language after load, and again a few times while it is still unknown
  // (slow pages, or text that arrives after the load event).
  // Pages with endless ads or live widgets may never finish loading, so this also runs while loading.
  useEffect(() => {
    if (!pageUrl) return
    let cancelled = false
    const timers: number[] = []
    const attempt = (index: number): void => {
      void api.pageState().then((state) => {
        if (cancelled) return
        setPage(state)
        const delay = [1_500, 3_000, 5_000, 8_000, 12_000, 20_000][index]
        if (state.status === 'idle' && !state.detected && delay !== undefined) timers.push(window.setTimeout(() => attempt(index + 1), delay))
      }).catch(() => undefined)
    }
    timers.push(window.setTimeout(() => attempt(0), pageLoading ? 1_500 : 400))
    return () => { cancelled = true; timers.forEach((timer) => window.clearTimeout(timer)) }
  }, [pageUrl, pageLoading, api])

  const ready = new Set(['en', ...(status?.languages.filter((language) => language.downloaded).map((language) => language.code) ?? [])])
  const supported = (code: string | null): boolean => !!code && (code === 'en' || !!status?.languages.some((language) => language.code === code))

  const setTarget = (code: string): void => {
    setTargetState(code)
    try {
      localStorage.setItem(TARGET_KEY, code)
    } catch {
      // ignore
    }
  }

  const guard = async (work: () => Promise<unknown>): Promise<void> => {
    setError('')
    try {
      await work()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Something went wrong.')
    }
  }

  return {
    status,
    page,
    target,
    setTarget,
    ready,
    supported,
    install: (code) => guard(async () => setStatus(await api.install(code))),
    remove: (code) => guard(async () => setStatus(await api.remove(code))),
    translatePage: (from, to) => guard(async () => setPage(await api.translatePage(from, to))),
    restorePage: () => guard(async () => setPage(await api.restorePage())),
    refreshPage,
    error,
    clearError: () => setError(''),
  }
}
