import { useEffect, useMemo, useState } from 'react'
import { headlineLanguage } from '../../../shared/translate/detect'
import { useHeadlinePref } from './headlinePref'
import { modelsToFetch } from './modelQueue'
import { modelFor, type TranslateModel } from './useTranslate'

/**
 * Titles shown in your language (World stories, lists), on this Mac. On by
 * default, following the same Original ↔ your-language choice as the headline
 * lists; a missing language downloads the first time it is needed. Returns
 * translations by key.
 */
export function useTranslatedTitles(items: Array<{ key: string; title: string; lang?: string | null | undefined }>, translation: TranslateModel | undefined): Map<string, string> {
  const [on] = useHeadlinePref()
  const target = translation?.target ?? 'en'
  const supportedKey = translation?.status?.languages.map((language) => language.code).join(',') ?? ''
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
  }, [items, target, supportedKey, !!translation]) // eslint-disable-line react-hooks/exhaustive-deps
  const readyKey = translation ? [...translation.ready].sort().join(',') : ''
  const wanted = on && translation ? modelsToFetch(byLanguage, target, translation.ready, translation.supported).join(',') : ''
  useEffect(() => {
    if (wanted && translation) void translation.ensure(wanted.split(','))
  }, [wanted]) // eslint-disable-line react-hooks/exhaustive-deps
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
