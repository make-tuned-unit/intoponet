import { useEffect, useMemo, useState } from 'react'
import { Download, History, Languages, LoaderCircle, Lock } from 'lucide-react'
import { hostIsPaywalled } from '../../../shared/news/paywall'
import { learnedPaywalls } from '../access/learnedPaywalls'
import '../access/access.css'
import { normalizeLanguage } from '@intoponet/browser-api'
import type { NewsHeadline } from '../../../shared/news/newsDigest'
import { relativeTime } from '../globe/globeSignals'
import { formatMegabytes, languageName, nativeName, type TranslateModel } from './useTranslate'
import './translate.css'

const PREF = 'intoponet.translate.headlines.v1'

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF) === '1'
  } catch {
    return false
  }
}

/**
 * Headlines with an Original ↔ your-language flip. Translation happens on
 * this Mac; headlines in languages without a downloaded model offer the
 * download (with its size) instead.
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
  const [on, setOn] = useState(readPref)
  const paywalled = useMemo(() => learnedPaywalls(), [headlines])
  const [translated, setTranslated] = useState<Map<string, string>>(new Map())
  const target = translation?.target ?? 'en'
  const foreign = useMemo(() => {
    const byLang = new Map<string, NewsHeadline[]>()
    for (const headline of headlines) {
      const code = normalizeLanguage(headline.lang)
      if (!code || code === target || !translation?.supported(code)) continue
      byLang.set(code, [...(byLang.get(code) ?? []), headline])
    }
    return byLang
  }, [headlines, target, translation])
  // Headlines in languages no model covers (e.g. Papiamento): say so instead of showing nothing.
  const untranslatable = useMemo(() => {
    const codes = new Set<string>()
    for (const headline of headlines) {
      const code = normalizeLanguage(headline.lang)
      if (code && code !== target && translation && !translation.supported(code)) codes.add(code)
    }
    return [...codes]
  }, [headlines, target, translation])
  const missing = translation ? [...foreign.keys(), target].filter((code) => !translation.ready.has(code) && translation.supported(code)) : []
  const readyKey = translation ? [...translation.ready].sort().join(',') : ''

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

  const setPref = (next: boolean): void => {
    setOn(next)
    try {
      localStorage.setItem(PREF, next ? '1' : '0')
    } catch {
      // ignore
    }
  }

  const missingBytes = missing.reduce((sum, code) => {
    const language = translation?.status?.languages.find((item) => item.code === code)
    return sum + (language?.bytes ?? 0)
  }, 0) + (missing.length && translation?.status && !translation.status.engine.downloaded ? translation.status.engine.bytes : 0)
  const downloading = translation?.status?.downloading ?? null
  const sources = [...foreign.keys()]
  const sourceLabel = sources.length === 1 ? nativeName(sources[0]!) : 'Original'

  const bytesOf = (code: string): number => (translation?.status?.languages.find((item) => item.code === code)?.bytes ?? 0)
    + (translation?.status && !translation.status.engine.downloaded ? translation.status.engine.bytes : 0)
  // Missing source languages, most headlines first (the target language, if missing, goes first of all).
  const missingByUse = [
    ...missing.filter((code) => code === target),
    ...missing.filter((code) => code !== target).sort((a, b) => (foreign.get(b)?.length ?? 0) - (foreign.get(a)?.length ?? 0)),
  ]
  const installOne = (code: string): void => {
    if (!translation || downloading) return
    setPref(true)
    void translation.install(code)
  }

  /** One click: download whatever is missing (size shown on the button), then translate. */
  const translateNow = (): void => {
    if (!translation) return
    setPref(true)
    if (!missing.length || downloading) return
    void (async () => {
      for (const code of missing) await translation.install(code)
    })()
  }

  return (
    <>
      {foreign.size > 0 && translation && (
        <div className="tr-headline-bar">
          {downloading && on ? (
            <span className="tr-inline-status" role="status">
              <LoaderCircle size={11} className="tr-spin" aria-hidden="true" />
              Downloading {languageName(downloading.code)} · {formatMegabytes(downloading.receivedBytes)} of {formatMegabytes(downloading.totalBytes)}
              <span className="tr-meter" aria-hidden="true"><i style={{ width: `${downloading.totalBytes ? (downloading.receivedBytes / downloading.totalBytes) * 100 : 0}%` }} /></span>
            </span>
          ) : missing.length === 0 || (sources.length > 1 && sources.some((code) => translation.ready.has(code)) && translation.ready.has(target)) ? (
            <>
              <div className="tr-flip tr-flip-small" role="group" aria-label="Show headlines in">
                <button type="button" className={on ? '' : 'is-active'} aria-pressed={!on} onClick={() => setPref(false)}>{sourceLabel}</button>
                <button type="button" className={on ? 'is-active' : ''} aria-pressed={on} onClick={() => setPref(true)}>{languageName(target)}</button>
              </div>
              {missingByUse.slice(0, 3).map((code) => (
                <button key={code} type="button" className="tr-inline-toggle" onClick={() => installOne(code)} title={`Add ${languageName(code)} (${formatMegabytes(bytesOf(code))}) to also translate its headlines`}>
                  <Download size={11} aria-hidden="true" /> {languageName(code)} · {formatMegabytes(bytesOf(code))}
                </button>
              ))}
            </>
          ) : sources.length > 1 ? (
            <>
              {/* Several languages, none installed: start with the most used one. */}
              <button type="button" className="tr-inline-toggle tr-inline-primary" onClick={() => installOne(missingByUse[0]!)} title={`Translate these headlines into ${languageName(target)} on this Mac`}>
                <Download size={11} aria-hidden="true" /> Translate to {languageName(target)} · add {languageName(missingByUse[0]!)} ({formatMegabytes(bytesOf(missingByUse[0]!))})
              </button>
              {missingByUse.slice(1, 3).map((code) => (
                <button key={code} type="button" className="tr-inline-toggle" onClick={() => installOne(code)}>
                  <Download size={11} aria-hidden="true" /> {languageName(code)} · {formatMegabytes(bytesOf(code))}
                </button>
              ))}
            </>
          ) : (
            <>
              <button type="button" className="tr-inline-toggle tr-inline-primary" onClick={translateNow} title={`Translate these headlines into ${languageName(target)} on this Mac`}>
                <Download size={11} aria-hidden="true" /> Translate to {languageName(target)} · download {missing.map((code) => languageName(code)).join(' + ')} ({formatMegabytes(missingBytes)})
              </button>
              {on && (
                <button type="button" className="tr-inline-toggle" onClick={() => setPref(false)}>Keep original</button>
              )}
            </>
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
          const code = normalizeLanguage(headline.lang)
          return (
            <li key={headline.url} className={onHistory ? 'has-history' : undefined}>
              <button type="button" onClick={() => onOpen(headline.url)} title={shown ? headline.title : undefined}>
                <strong lang={shown ? target : code ?? undefined}>{shown ?? headline.title}</strong>
                <small>
                  {detail ? detail(headline) : `${headline.publisher} · ${relativeTime(headline.publishedAt, now)}`}{shown && code ? ` · from ${languageName(code)}` : ''}
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
