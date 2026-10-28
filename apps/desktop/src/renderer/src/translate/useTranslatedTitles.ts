import { useEffect, useMemo, useState } from 'react'
import { headlineLanguage } from '../../../shared/translate/detect'
import { modelFor, type TranslateModel } from './useTranslate'

const PREF = 'intoponet.translate.headlines.v1'

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF) === '1'
  } catch {
    return false
  }
}

/**
 * Titles shown in your language (World stories, lists), on this Mac, when
 * headline translation is on and the language is downloaded. Follows the same
 * Original ↔ your-language choice as the headline lists. Returns translations by key.
 */
export function useTranslatedTitles(items: Array<{ key: string; title: string; lang?: string | null | undefined }>, translation: TranslateModel | undefined): Map<string, string> {
  const [on, setOn] = useState(readPref)
  useEffect(() => {
    const onPref = (event: Event): void => setOn((event as CustomEvent<boolean>).detail === true)
    const onStorage = (): void => setOn(readPref())
    window.addEventListener('intoponet:headline-pref', onPref)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('intoponet:headline-pref', onPref)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  const target = translation?.target ?? 'en'
  const byLanguage = useMemo(() => {
    const groups = new Map<string, Array<{ key: string; title: string }>>()
    if (!translation) return groups
    for (const item of items) {
      const own = headlineLanguage(item.lang, item.title)
      if (!own || own === target) continue
      const code = modelFor(own, translation.supported)?.code
      if (!code || code === target) continue
      groups.set(code, [...(groups.get(code) ?? []), { key: item.key, title: item.title }])
    }
    return groups
  }, [items, target, translation])
  const readyKey = translation ? [...translation.ready].sort().join(',') : ''
  const [translated, setTranslated] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    if (!on || !translation) {
      setTranslated(new Map())
      return
    }
    let cancelled = false
    void (async () => {
      const next = new Map<string, string>()
      for (const [code, list] of byLanguage) {
        if (!translation.ready.has(code) || !translation.ready.has(target)) continue
        try {
          const out = await window.intoponet.translate.translate({ from: code, to: target, texts: list.map((item) => item.title) })
          list.forEach((item, index) => { if (out[index]) next.set(item.key, out[index]!) })
        } catch {
          // Leave these titles in their own language.
        }
        if (cancelled) return
        setTranslated(new Map(next))
      }
    })()
    return () => { cancelled = true }
  }, [on, byLanguage, target, readyKey]) // eslint-disable-line react-hooks/exhaustive-deps
  return translated
}
