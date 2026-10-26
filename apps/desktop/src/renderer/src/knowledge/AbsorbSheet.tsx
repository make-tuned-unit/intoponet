import { motion, useReducedMotion } from 'motion/react'
import { CalendarDays, Hash, Loader2, Lock, MapPin, ShieldAlert, Sparkles, User, X } from 'lucide-react'
import { useState } from 'react'
import type { AbsorbPreview, AbsorbRefusal, AbsorbScope, KnowledgeEntity } from '@intoponet/browser-api'
import { useGlassSheen } from '../glass/useGlassSheen'
import '../glass/glass.css'
import './knowledge.css'

export type AbsorbState =
  | { status: 'loading'; scope: AbsorbScope }
  | { status: 'preview'; preview: AbsorbPreview }
  | { status: 'refused'; refusal: AbsorbRefusal }
  | { status: 'saving'; preview: AbsorbPreview }
  | { status: 'error'; message: string }

const kindIcon = (kind: KnowledgeEntity['kind']) => kind === 'place' ? <MapPin size={11} aria-hidden="true" /> : kind === 'name' ? <User size={11} aria-hidden="true" /> : <Hash size={11} aria-hidden="true" />

/**
 * ABS-002: preview exactly what will be indexed before anything is stored.
 * The user can drop extracted entities, switch to their selection, and add a note.
 */
export function AbsorbSheet({
  state,
  onScope,
  onCommit,
  onCancel,
}: {
  state: AbsorbState
  onScope: (scope: AbsorbScope) => void
  onCommit: (options: { removeEntities: string[]; note: string }) => void
  onCancel: () => void
}) {
  const sheen = useGlassSheen<HTMLDivElement>()
  const reduceMotion = useReducedMotion()
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')
  const preview = state.status === 'preview' || state.status === 'saving' ? state.preview : null
  const toggle = (text: string): void => setRemoved((current) => {
    const next = new Set(current)
    if (next.has(text)) next.delete(text)
    else next.add(text)
    return next
  })

  return (
    <div className="absorb-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <motion.section
        ref={sheen}
        className="absorb-sheet lg-surface lg-sheen"
        role="dialog"
        aria-modal="true"
        aria-labelledby="absorb-title"
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98, filter: 'blur(6px)' }}
        transition={{ type: 'spring', stiffness: 400, damping: 36 }}
      >
        <header className="absorb-head">
          <span className="absorb-eyebrow"><Sparkles size={12} aria-hidden="true" /> Absorb into your knowledge</span>
          <button type="button" className="lg-icon-button" aria-label="Cancel" onClick={onCancel}><X size={15} /></button>
        </header>

        {state.status === 'loading' && (
          <div className="absorb-status" role="status"><Loader2 size={16} className="olds-spin" aria-hidden="true" /> Reading the page on this device…</div>
        )}
        {state.status === 'error' && <div className="absorb-status is-error" role="alert">{state.message}</div>}
        {state.status === 'refused' && (
          <div className="absorb-refused" role="alert">
            <ShieldAlert size={22} aria-hidden="true" />
            <div>
              <h2 id="absorb-title">Not absorbed</h2>
              <p>{state.refusal.reason}</p>
              <p className="absorb-fine">Sign-in, payment, banking, health and message pages are never absorbed, and form contents are never read.</p>
            </div>
          </div>
        )}

        {preview && (
          <>
            <div className="absorb-title">
              <p className="absorb-site">{preview.siteName ?? new URL(preview.url).hostname}{preview.publishedAt ? ` · ${new Date(preview.publishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</p>
              <h2 id="absorb-title">{preview.title}</h2>
              <p className="absorb-stats">{preview.wordCount.toLocaleString()} words · {preview.paragraphCount} paragraphs · {preview.linkCount} links</p>
            </div>
            <div className="absorb-scope" role="radiogroup" aria-label="What to absorb">
              <button type="button" role="radio" aria-checked={preview.scope === 'article'} className={preview.scope === 'article' ? 'is-active' : ''} onClick={() => preview.scope !== 'article' && onScope('article')}>Whole article</button>
              <button type="button" role="radio" aria-checked={preview.scope === 'selection'} disabled={!preview.selectionAvailable} className={preview.scope === 'selection' ? 'is-active' : ''} onClick={() => preview.scope !== 'selection' && onScope('selection')} title={preview.selectionAvailable ? undefined : 'Select text on the page first'}>Only my selection</button>
            </div>
            <div className="absorb-body">
              <div className="absorb-text" aria-label="Text that will be stored">
                {preview.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
                {preview.paragraphCount > preview.paragraphs.length && <p className="absorb-more">+ {preview.paragraphCount - preview.paragraphs.length} more paragraphs</p>}
              </div>
              <div className="absorb-facets">
                {preview.entities.length > 0 && (
                  <section>
                    <h3>Found <small>tap to leave out</small></h3>
                    <div className="absorb-chips">
                      {preview.entities.map((entity) => (
                        <button key={entity.text} type="button" className={`absorb-chip kind-${entity.kind}${removed.has(entity.text) ? ' is-removed' : ''}`} aria-pressed={!removed.has(entity.text)} onClick={() => toggle(entity.text)}>
                          {kindIcon(entity.kind)}{entity.text}{entity.count > 1 && <small>{entity.count}</small>}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {preview.places.length > 0 && (
                  <section>
                    <h3>Places <small>shown on your private map</small></h3>
                    <div className="absorb-chips">
                      {preview.places.slice(0, 12).map((place) => <span key={`${place.name}-${place.countryCode}`} className="absorb-chip kind-place is-static"><MapPin size={11} aria-hidden="true" />{place.name}</span>)}
                    </div>
                  </section>
                )}
                {preview.dates.length > 0 && (
                  <section>
                    <h3>Dates</h3>
                    <div className="absorb-chips">
                      {preview.dates.map((date) => <span key={date.text} className="absorb-chip is-static"><CalendarDays size={11} aria-hidden="true" />{date.text}</span>)}
                    </div>
                  </section>
                )}
                <label className="absorb-note">
                  <span>Note (optional)</span>
                  <textarea value={note} maxLength={2000} rows={2} onChange={(event) => setNote(event.target.value)} placeholder="Why this matters to you" />
                </label>
              </div>
            </div>
            <footer className="absorb-foot">
              <span><Lock size={12} aria-hidden="true" /> Stays on this device, encrypted. Never uploaded or shared.</span>
              <div>
                <button type="button" className="absorb-ghost" onClick={onCancel}>Cancel</button>
                <button type="button" className="absorb-primary" disabled={state.status === 'saving'} onClick={() => onCommit({ removeEntities: [...removed], note })}>
                  {state.status === 'saving' ? <Loader2 size={14} className="olds-spin" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
                  Absorb
                </button>
              </div>
            </footer>
          </>
        )}
      </motion.section>
    </div>
  )
}
