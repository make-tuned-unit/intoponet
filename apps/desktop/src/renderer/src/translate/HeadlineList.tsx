import { useEffect, useMemo, useState } from 'react'
import { Download, History, Languages, LoaderCircle, Lock } from 'lucide-react'
import { hostIsPaywalled } from '../../../shared/news/paywall'
import { learnedPaywalls } from '../access/learnedPaywalls'
import '../access/access.css'
import { headlineLanguage } from '../../../shared/translate/detect'
import type { NewsHeadline } from '../../../shared/news/newsDigest'
import { relativeTime } from '../globe/globeSignals'
import { formatMegabytes, languageName, modelFor, nativeName, RELATED_MODEL, type TranslateModel } from './useTranslate'
import { useHeadlinePref } from './headlinePref'
import { modelsToFetch } from './modelQueue'
import './translate.css'
import { openOrPreview } from '../linkPreview'

/**
 * Headlines shown in your language, with an Original ↔ your-language flip.
 * Translation happens on this Mac; a language without a downloaded model
 * downloads the first time it is needed, with a quiet progress note.
 */
export function HeadlineList({
  headlines,
  now,
  onOpen,
  translation,
  className,
  detail,
  onHistory,
}: {
  headlines: NewsHeadline[]
  now: number
  onOpen: (url: string) => void
  translation?: TranslateModel | undefined
  className?: string
  detail?: (headline: NewsHeadline) => string
  /** Open the history behind a headline (with its English text when it is shown translated). */
  onHistory?: ((headline: NewsHeadline, englishText: string | null) => void) | undefined
}) {
  // One choice for every list (Settings and each list's Original ↔ language flip).
  const [on, setPref] = useHeadlinePref()
  const paywalled = useMemo(() => learnedPaywalls(), [headlines])
  const [translated, setTranslated] = useState<Map<string, string>>(new Map())
  const target = translation?.target ?? 'en'
  const supportedKey = translation?.status?.languages.map((language) => language.code).join(',') ?? ''
  const foreign = useMemo(() => {
    const byLang = new Map<string, NewsHeadline[]>()
    for (const headline of headlines) {
      const own = headlineLanguage(headline.lang, headline.title)
      if (!own || own === target || !translation) continue
      // Faroese and a few others have no model: translate roughly with their closest relative's.
      const code = modelFor(own, translation.supported)?.code
      if (!code || code === target) continue
      byLang.set(code, [...(byLang.get(code) ?? []), headline])
    }
    return byLang
  }, [headlines, target, supportedKey, !!translation]) // eslint-disable-line react-hooks/exhaustive-deps
  // Headlines in languages no model covers (e.g. Papiamento): say so instead of showing nothing.
  const untranslatable = useMemo(() => {
    const codes = new Set<string>()
    for (const headline of headlines) {
      const code = headlineLanguage(headline.lang, headline.title)
      if (code && code !== target && translation && !modelFor(code, translation.supported)) codes.add(code)
    }
    return [...codes]
  }, [headlines, target, supportedKey, !!translation]) // eslint-disable-line react-hooks/exhaustive-deps
  const readyKey = translation ? [...translation.ready].sort().join(',') : ''
  // Missing languages download on first need (your language first, then the most used).
  const wanted = on && translation ? modelsToFetch(foreign, target, translation.ready, translation.supported).join(',') : ''
  const [failed, setFailed] = useState<string[]>([])
  useEffect(() => {
    if (!wanted || !translation) return
    let cancelled = false
    void translation.ensure(wanted.split(',')).then((codes) => { if (!cancelled) setFailed(codes) })
    return () => { cancelled = true }
  }, [wanted]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!on || !translation) return
    let cancelled = false
    void (async () => {
      const next = new Map<string, string>()
      for (const [code, list] of foreign) {
        if (!translation.ready.has(code) || !translation.ready.has(target)) continue
        try {
          const out = await window.intoponet.translate.translate({ from: code, to: target, texts: list.map((headline) => headline.title) })
          list.forEach((headline, i) => next.set(headline.url, out[i] ?? headline.title))
        } catch {
          // Leave these in the original language.
        }
        if (cancelled) return
        setTranslated(new Map(next))
      }
    })()
    return () => { cancelled = true }
    // readyKey re-runs after a language finishes downloading.
  }, [on, foreign, target, readyKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const downloading = translation?.status?.downloading ?? null
  const sources = [...foreign.keys()]
  const sourceLabel = sources.length === 1 ? nativeName(sources[0]!) : 'Original'
  const stillMissing = on && translation ? failed.filter((code) => wanted.split(',').includes(code)) : []
  // Held back to keep background downloads small: offered with their size instead.
  const held = translation ? stillMissing.filter((code) => translation.isHeld(code)) : []
  const unavailable = downloading ? [] : stillMissing.filter((code) => !held.includes(code))
  const bytesOf = (code: string): number => (translation?.status?.languages.find((item) => item.code === code)?.bytes ?? 0)
    + (translation?.status && !translation.status.engine.downloaded ? translation.status.engine.bytes : 0)

  return (
    <>
      {foreign.size > 0 && translation && (
        <div className="tr-headline-bar">
          {downloading && on ? (
            <span className="tr-inline-status" role="status" title="A one-time download of the translation model; translation then runs on this Mac and nothing leaves it.">
              <LoaderCircle size={11} className="tr-spin" aria-hidden="true" />
              Getting {languageName(downloading.code)} for translation · {formatMegabytes(downloading.receivedBytes)} of {formatMegabytes(downloading.totalBytes)}
              <span className="tr-meter" aria-hidden="true"><i style={{ width: `${downloading.totalBytes ? (downloading.receivedBytes / downloading.totalBytes) * 100 : 0}%` }} /></span>
            </span>
          ) : (
            <div className="tr-flip tr-flip-small" role="group" aria-label="Show headlines in">
              <button type="button" className={on ? '' : 'is-active'} aria-pressed={!on} onClick={() => setPref(false)}>{sourceLabel}</button>
              <button type="button" className={on ? 'is-active' : ''} aria-pressed={on} onClick={() => setPref(true)}>{languageName(target)}</button>
            </div>
          )}
          {held.slice(0, 3).map((code) => (
            <button
              key={code}
              type="button"
              className="tr-inline-toggle"
              disabled={!!downloading && downloading.code === code}
              onClick={() => void translation.install(code)}
              title={`Add ${languageName(code)} (a one-time ${formatMegabytes(bytesOf(code))} download) to translate these headlines on this Mac`}
            >
              <Download size={11} aria-hidden="true" /> {languageName(code)} · {formatMegabytes(bytesOf(code))}
            </button>
          ))}
          {unavailable.length > 0 && (
            <span className="tr-inline-error" role="alert">Could not download {unavailable.map((code) => languageName(code)).join(', ')}; showing the original.</span>
          )}
          {translation.error && <span className="tr-inline-error" role="alert">{translation.error}</span>}
        </div>
      )}
      {foreign.size === 0 && untranslatable.length > 0 && translation && (
        <p className="tr-headline-note" title="Translation runs on this Mac with Mozilla's models, which cover about 57 languages.">
          <Languages size={11} aria-hidden="true" /> {untranslatable.map((code) => languageName(code)).join(', ')} can't be translated on this Mac yet: no model covers it.
        </p>
      )}
      <ul className={className}>
        {headlines.map((headline) => {
          const shown = on ? translated.get(headline.url) : undefined
          const code = headlineLanguage(headline.lang, headline.title)
          return (
            <li key={headline.url} className={onHistory ? 'has-history' : undefined}>
              <button type="button" onClick={(event) => openOrPreview(event, headline.url, onOpen)} title={shown ? headline.title : undefined}>
                <strong lang={shown ? target : code ?? undefined}>{shown ?? headline.title}</strong>
                <small>
                  {detail ? detail(headline) : `${headline.publisher} · ${relativeTime(headline.publishedAt, now)}`}{shown && code ? ` · from ${languageName(code)}${translation && modelFor(code, translation.supported)?.rough ? ` (rough, via ${languageName(RELATED_MODEL[code]!)})` : ''}` : ''}
                  {hostIsPaywalled(headline.url, paywalled) && <span className="paywall-lock" title="This outlet usually restricts articles to subscribers. Opening it offers free coverage of the same story."><Lock size={10} aria-hidden="true" /> paywall</span>}
                </small>
              </button>
              {onHistory && (
                <button
                  type="button"
                  className="headline-history"
                  aria-label={`The history behind: ${shown ?? headline.title}`}
                  title="The history behind this story"
                  onClick={() => onHistory(headline, shown && target === 'en' ? shown : code === 'en' ? headline.title : null)}
                >
                  <History size={13} aria-hidden="true" />
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}
