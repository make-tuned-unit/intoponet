import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowLeft, BookOpenText, ExternalLink, Hash, Loader2, MapPin, RefreshCw, Search, Trash2, User, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { KnowledgeDocument, KnowledgeHit, KnowledgeRecord } from '@intoponet/browser-api'
import { useGlassSheen } from '../glass/useGlassSheen'
import '../glass/glass.css'
import './knowledge.css'

function highlight(snippet: string, matches: Array<[number, number]>): ReactNode[] {
  const parts: ReactNode[] = []
  let at = 0
  for (const [start, end] of [...matches].sort((a, b) => a[0] - b[0])) {
    if (start < at || end <= start || end > snippet.length) continue
    if (start > at) parts.push(snippet.slice(at, start))
    parts.push(<mark key={`${start}-${end}`}>{snippet.slice(start, end)}</mark>)
    at = end
  }
  if (at < snippet.length) parts.push(snippet.slice(at))
  return parts
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Local knowledge (LAY-003 without a model): everything absorbed, searchable
 * offline, every answer cited to its paragraph and openable at the source.
 */
export function KnowledgeSheet({
  focus,
  onClose,
  onOpen,
  onChanged,
}: {
  /** Open straight to a record (e.g. from the map). */
  focus: string | null
  onClose: () => void
  onOpen: (url: string) => void
  onChanged: () => void
}) {
  const sheen = useGlassSheen<HTMLDivElement>()
  const reduceMotion = useReducedMotion()
  const [records, setRecords] = useState<KnowledgeRecord[] | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null)
  const [doc, setDoc] = useState<{ document: KnowledgeDocument; paragraph: number | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const reader = useRef<HTMLDivElement>(null)

  const refresh = (): void => {
    void window.intoponet.knowledge.list().then(setRecords, () => setError('Your knowledge could not be read.'))
  }
  useEffect(refresh, [])
  useEffect(() => { if (!focus) searchInput.current?.focus() }, [focus])
  useEffect(() => { if (focus) void openDocument(focus, null) }, [focus])

  // Search as you type, debounced; entirely on this device.
  useEffect(() => {
    const value = query.trim()
    if (value.length < 2) { setHits(null); return }
    const timer = window.setTimeout(() => {
      void window.intoponet.knowledge.search(value, 30).then(setHits, () => setHits([]))
    }, 140)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (!doc || doc.paragraph === null) return
    const el = reader.current?.querySelector<HTMLElement>(`[data-paragraph="${doc.paragraph}"]`)
    el?.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [doc, reduceMotion])

  async function openDocument(id: string, paragraph: number | null): Promise<void> {
    setBusy(true)
    setConfirmDelete(false)
    try {
      setDoc({ document: await window.intoponet.knowledge.get(id), paragraph })
    } catch {
      setError('That page could not be opened from your knowledge.')
    } finally {
      setBusy(false)
    }
  }

  const removeEntity = async (text: string): Promise<void> => {
    if (!doc) return
    const record = await window.intoponet.knowledge.update(doc.document.id, { removeEntities: [text] })
    setDoc({ document: { ...doc.document, ...record }, paragraph: doc.paragraph })
    refresh()
    onChanged()
  }
  const reindex = async (): Promise<void> => {
    if (!doc) return
    setBusy(true)
    const record = await window.intoponet.knowledge.reindex(doc.document.id).finally(() => setBusy(false))
    setDoc({ document: { ...doc.document, ...record }, paragraph: doc.paragraph })
    refresh()
    onChanged()
  }
  const remove = async (): Promise<void> => {
    if (!doc) return
    await window.intoponet.knowledge.remove(doc.document.id)
    setDoc(null)
    setHits(null)
    refresh()
    onChanged()
  }

  const fade = reduceMotion ? { opacity: 0 } : { opacity: 0, x: 12 }

  return (
    <div className="absorb-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <motion.section
        ref={sheen}
        className="knowledge-sheet lg-surface lg-sheen"
        role="dialog"
        aria-modal="true"
        aria-label="Your knowledge"
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98, filter: 'blur(6px)' }}
        transition={{ type: 'spring', stiffness: 400, damping: 36 }}
      >
        <header className="absorb-head">
          <span className="absorb-eyebrow"><BookOpenText size={12} aria-hidden="true" /> Your knowledge · on this device</span>
          <button type="button" className="lg-icon-button" aria-label="Close" onClick={onClose}><X size={15} /></button>
        </header>
        <label className="knowledge-search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">Search your knowledge</span>
          <input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search everything you’ve absorbed" />
          {query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={13} /></button>}
        </label>
        {error && <p className="absorb-status is-error" role="alert">{error}</p>}

        <div className="knowledge-body">
          <div className="knowledge-list">
            {hits ? (
              hits.length ? (
                <ul aria-label="Search results">
                  {hits.map((hit) => (
                    <li key={`${hit.recordId}-${hit.paragraphIndex}`}>
                      <button type="button" className={doc?.document.id === hit.recordId && doc.paragraph === hit.paragraphIndex ? 'is-active' : ''} onClick={() => void openDocument(hit.recordId, hit.paragraphIndex)}>
                        <strong>{hit.title}</strong>
                        <span className="knowledge-snippet">…{highlight(hit.snippet, hit.matches)}…</span>
                        <small>¶ {hit.paragraphIndex + 1} · {new URL(hit.url).hostname}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="knowledge-empty">Nothing you’ve absorbed mentions that yet.</p>
            ) : records === null ? (
              <p className="knowledge-empty"><Loader2 size={14} className="olds-spin" aria-hidden="true" /> Opening…</p>
            ) : records.length === 0 ? (
              <p className="knowledge-empty">Nothing absorbed yet. On any article, choose <strong>Absorb</strong> to keep its text here, searchable offline with citations.</p>
            ) : (
              <ul aria-label="Absorbed pages">
                {records.map((record) => (
                  <li key={record.id}>
                    <button type="button" className={doc?.document.id === record.id ? 'is-active' : ''} onClick={() => void openDocument(record.id, null)}>
                      <strong>{record.title}</strong>
                      <small>{record.siteName ?? new URL(record.url).hostname} · {when(record.absorbedAt)} · {record.wordCount.toLocaleString()} words</small>
                      {record.note && <span className="knowledge-note">{record.note}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {doc ? (
              <motion.article key={doc.document.id} className="knowledge-reader" initial={fade} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
                <div className="knowledge-reader-head">
                  <button type="button" className="lg-icon-button" aria-label="Close page" onClick={() => setDoc(null)}><ArrowLeft size={15} /></button>
                  <div>
                    <p className="absorb-site">{doc.document.siteName ?? new URL(doc.document.url).hostname} · absorbed {when(doc.document.absorbedAt)}{doc.document.scope === 'selection' ? ' · selection' : ''}</p>
                    <h2>{doc.document.title}</h2>
                  </div>
                  <div className="knowledge-reader-actions">
                    <button type="button" className="lg-icon-button" aria-label="Open the original page" title="Open the original" onClick={() => onOpen(doc.document.url)}><ExternalLink size={15} /></button>
                    <button type="button" className="lg-icon-button" aria-label="Re-extract names, places and dates" title="Reindex" disabled={busy} onClick={() => void reindex()}><RefreshCw size={15} /></button>
                    {confirmDelete ? (
                      <button type="button" className="knowledge-danger" onClick={() => void remove()}>Delete for good</button>
                    ) : (
                      <button type="button" className="lg-icon-button" aria-label="Remove from your knowledge" title="Remove" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /></button>
                    )}
                  </div>
                </div>
                {doc.document.entities.length > 0 && (
                  <div className="absorb-chips knowledge-entities" aria-label="Names, places and terms">
                    {doc.document.entities.slice(0, 30).map((entity) => (
                      <span key={entity.text} className={`absorb-chip kind-${entity.kind}`}>
                        {entity.kind === 'place' ? <MapPin size={11} aria-hidden="true" /> : entity.kind === 'name' ? <User size={11} aria-hidden="true" /> : <Hash size={11} aria-hidden="true" />}
                        {entity.text}
                        <button type="button" aria-label={`Remove ${entity.text}`} onClick={() => void removeEntity(entity.text)}><X size={10} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="knowledge-text" ref={reader}>
                  {doc.document.paragraphs.map((paragraph, index) => (
                    <p key={index} data-paragraph={index} className={index === doc.paragraph ? 'is-cited' : ''}>
                      <span className="knowledge-pnum" aria-hidden="true">{index + 1}</span>
                      {paragraph}
                    </p>
                  ))}
                </div>
              </motion.article>
            ) : (
              <motion.div key="hint" className="knowledge-reader is-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <BookOpenText size={28} aria-hidden="true" />
                <p>Pick a page or search. Every result cites the paragraph it came from.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.section>
    </div>
  )
}
