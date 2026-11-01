import { useMemo, useState, type ReactElement } from 'react'
import { ArrowRight, Check, Download, Languages, LoaderCircle, Trash2, X } from 'lucide-react'
import { formatMegabytes, languageName, modelFor, nativeName, type TranslateModel } from './useTranslate'
import './translate.css'

/**
 * The bar under the page toolbar: detected language → your language, one
 * click to translate, one to flip back. Languages download on request, each
 * with its size shown first.
 */
export function TranslateBar({ model, onClose }: { model: TranslateModel; onClose: () => void }) {
  const { status, page, target } = model
  const [manage, setManage] = useState(false)
  const [sourceOverride, setSourceOverride] = useState<string | null>(null)
  const [last, setLast] = useState<{ from: string; to: string } | null>(null)

  const codes = useMemo(() => {
    const list = ['en', ...(status?.languages.map((language) => language.code) ?? [])]
    return list.sort((a, b) => languageName(a).localeCompare(languageName(b)))
  }, [status])
  const sizeOf = (code: string): number => {
    const language = status?.languages.find((item) => item.code === code)
    const engine = status && !status.engine.downloaded ? status.engine.bytes : 0
    return language && !language.downloaded ? language.bytes + engine : 0
  }

  const detected = page.status === 'idle' ? page.detected : page.from
  // A language with no model of its own (Faroese) can be translated roughly through its closest relative's (Icelandic).
  const relative = detected && !model.supported(detected) ? modelFor(detected, model.supported) : null
  const source = sourceOverride ?? (model.supported(detected) ? detected : relative?.code ?? null)
  const rough = !sourceOverride && relative && source === relative.code ? { language: detected!, via: relative.code } : null
  const [roughDone, setRoughDone] = useState<{ language: string; via: string } | null>(null)
  const downloading = status?.downloading ?? null
  const missing = [source, target].filter((code): code is string => !!code && !model.ready.has(code))
  const missingBytes = missing.reduce((sum, code) => sum + sizeOf(code), 0)

  const go = async (from: string, to: string): Promise<void> => {
    for (const code of [from, to]) if (!model.ready.has(code)) await model.install(code)
    setLast({ from, to })
    setRoughDone(rough && from === rough.via ? rough : null)
    await model.translatePage(from, to)
  }

  const option = (code: string): ReactElement => (
    <option key={code} value={code}>
      {languageName(code)}{code !== 'en' && nativeName(code) !== languageName(code) ? ` · ${nativeName(code)}` : ''}{model.ready.has(code) ? '' : ` · ${formatMegabytes(sizeOf(code))}`}
    </option>
  )

  let body: ReactElement
  if (downloading) {
    const pct = downloading.totalBytes ? Math.round((downloading.receivedBytes / downloading.totalBytes) * 100) : 0
    body = (
      <span className="tr-status" role="status">
        <LoaderCircle size={14} className="tr-spin" aria-hidden="true" />
        Downloading {languageName(downloading.code)} · {formatMegabytes(downloading.receivedBytes)} of {formatMegabytes(downloading.totalBytes)}
        <span className="tr-meter" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
      </span>
    )
  } else if (page.status === 'translating') {
    body = (
      <>
        <span className="tr-status" role="status">
          <LoaderCircle size={14} className="tr-spin" aria-hidden="true" />
          Translating {languageName(page.from)} → {languageName(page.to)} · {page.done} of {page.total}
          <span className="tr-meter" aria-hidden="true"><i style={{ width: `${page.total ? (page.done / page.total) * 100 : 0}%` }} /></span>
        </span>
        <button type="button" className="tr-button" onClick={() => void model.restorePage()}>Stop</button>
      </>
    )
  } else if (page.status === 'translated') {
    body = (
      <>
        <span className="tr-status" role="status" title={roughDone && roughDone.via === page.from ? `There is no ${languageName(roughDone.language)} translation model yet, so this used ${languageName(roughDone.via)}, its closest relative. Expect mistakes.` : undefined}>
          <Check size={14} aria-hidden="true" />
          {roughDone && roughDone.via === page.from
            ? <>Roughly translated from {languageName(roughDone.language)} via {languageName(roughDone.via)} on this Mac · expect mistakes</>
            : <>Translated from {languageName(page.from)} to {languageName(page.to)} on this Mac</>}
        </span>
        <div className="tr-flip" role="group" aria-label="Show page in">
          <button type="button" onClick={() => void model.restorePage()}>{nativeName(page.from)}</button>
          <button type="button" className="is-active" aria-pressed="true">{nativeName(page.to)}</button>
        </div>
        <label className="tr-select">
          <span className="sr-only">Translate into</span>
          <select value={page.to} onChange={(event) => { model.setTarget(event.target.value); void go(page.from, event.target.value) }}>
            {codes.filter((code) => code !== page.from).map(option)}
          </select>
        </label>
      </>
    )
  } else {
    const same = !!source && source === target
    body = (
      <>
        <label className="tr-select">
          <span className="tr-label">{sourceOverride || !detected ? 'From' : 'Detected'}</span>
          <select value={rough ? '' : source ?? ''} onChange={(event) => setSourceOverride(event.target.value || null)} aria-label="Page language">
            {rough && <option value="">{languageName(rough.language)} · rough, via {languageName(rough.via)}</option>}
            {!source && <option value="">{detected ? `${languageName(detected)} (no model)` : 'Choose language'}</option>}
            {codes.map(option)}
          </select>
        </label>
        {rough && <span className="tr-note" title={`Firefox Translations has no ${languageName(rough.language)} model yet. ${languageName(rough.via)} is its closest relative, so a translation will be rough.`}>No {languageName(rough.language)} model yet</span>}
        <ArrowRight size={14} aria-hidden="true" className="tr-arrow" />
        <label className="tr-select">
          <span className="sr-only">Translate into</span>
          <select value={target} onChange={(event) => model.setTarget(event.target.value)} aria-label="Translate into">
            {codes.map(option)}
          </select>
        </label>
        {last && last.from === source && last.to === target && page.status === 'idle' ? (
          <div className="tr-flip" role="group" aria-label="Show page in">
            <button type="button" className="is-active" aria-pressed="true">{nativeName(last.from)}</button>
            <button type="button" onClick={() => void go(last.from, last.to)}>{nativeName(last.to)}</button>
          </div>
        ) : (
          <button
            type="button"
            className="tr-button tr-primary"
            disabled={!source || same}
            onClick={() => source && void go(source, target)}
            title={same ? 'The page is already in that language' : undefined}
          >
            {missing.length ? <><Download size={13} aria-hidden="true" /> Download {missing.map((code) => languageName(code)).join(' + ')} · {formatMegabytes(missingBytes)}, then translate</> : 'Translate'}
          </button>
        )}
      </>
    )
  }

  return (
    <div className={`translate-bar${manage ? ' is-managing' : ''}`}>
      <div className="tr-row">
        <Languages size={14} aria-hidden="true" className="tr-icon" />
        {body}
        <span className="tr-spacer" />
        {(model.error || (page.status === 'error' && page.message)) && (
          <span className="tr-error" role="alert">{model.error || (page.status === 'error' ? page.message : '')}</span>
        )}
        <button type="button" className="tr-button" aria-expanded={manage} onClick={() => setManage((open) => !open)}>Languages</button>
        <button type="button" className="tr-close" aria-label="Close translation bar" onClick={onClose}><X size={14} /></button>
      </div>
      {manage && status && (
        <div className="tr-manage">
          <p>{status.attribution} Each language downloads once, in both directions with English, and works offline. Translating between two other languages goes through English.</p>
          <ul>
            {codes.filter((code) => code !== 'en').map((code) => {
              const language = status.languages.find((item) => item.code === code)!
              const busy = downloading?.code === code
              return (
                <li key={code} className={language.downloaded ? 'is-installed' : ''}>
                  <span><strong>{languageName(code)}{language.downloaded && <Check size={12} strokeWidth={2.25} className="tr-installed" aria-label="Installed" />}</strong><small>{nativeName(code)}</small></span>
                  {language.downloaded ? (
                    <button type="button" aria-label={`Remove ${languageName(code)}`} onClick={() => void model.remove(code)}><Trash2 size={12} /> Remove</button>
                  ) : (
                    <button type="button" disabled={!!downloading} onClick={() => void model.install(code)}>
                      {busy ? <LoaderCircle size={12} className="tr-spin" /> : <Download size={12} />} {formatMegabytes(sizeOf(code))}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
