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

  useEffect(() => {
    if (!pageUrl || pageLoading) return
    const timer = setTimeout(refreshPage, 400)
    return () => clearTimeout(timer)
  }, [pageUrl, pageLoading, refreshPage])

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
