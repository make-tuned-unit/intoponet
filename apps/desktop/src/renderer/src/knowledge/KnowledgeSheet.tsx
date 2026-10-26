import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowLeft, BookOpenText, Brain, ExternalLink, Hash, History, Loader2, MapPin, MessageCircleQuestion, RefreshCw, Search, Sparkles, Trash2, User, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { KnowledgeDocument, KnowledgeHit, KnowledgeRecord, LayaHit, LayaPassage, LayaProgress, LayaRelated, LayaStatus, LayaTheme } from '@intoponet/browser-api'
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

/** A Wikipedia article's title and language, when the page is one. */
export function wikipediaArticle(url: string): { title: string; lang: string } | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.match(/^([a-z]{2,3})(?:\.m)?\.wikipedia\.org$/)
    const path = parsed.pathname.match(/^\/wiki\/(.+)$/)
    if (!host || !path) return null
    const title = decodeURIComponent(path[1]!).replace(/_/g, ' ')
    return title.includes(':') ? null : { title, lang: host[1]! }
  } catch {
    return null
  }
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
  onHistory,
}: {
  /** Open straight to a record (e.g. from the map). */
  focus: string | null
  onClose: () => void
  onOpen: (url: string) => void
  onChanged: () => void
  /** Open The Olds for an absorbed Wikipedia article. */
  onHistory: (title: string, lang: string) => void
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
  const [laya, setLaya] = useState<LayaStatus | null>(null)
  const [progress, setProgress] = useState<LayaProgress | null>(null)
  const [layaError, setLayaError] = useState('')
  const [mode, setMode] = useState<'search' | 'ask'>('search')
  const [passages, setPassages] = useState<LayaPassage[] | null>(null)
  const [asking, setAsking] = useState(false)
  const [themes, setThemes] = useState<LayaTheme[]>([])
  const [theme, setTheme] = useState<string | null>(null)
  const [related, setRelated] = useState<LayaRelated[]>([])
  const searchInput = useRef<HTMLInputElement>(null)
  const layaOn = !!laya?.enabled && !!laya.model.verified
  const reader = useRef<HTMLDivElement>(null)

  const refresh = (): void => {
    void window.intoponet.knowledge.list().then(setRecords, () => setError('Your knowledge could not be read.'))
  }
  useEffect(refresh, [])
  useEffect(() => {
    void window.intoponet.laya.status().then(setLaya, () => undefined)
    return window.intoponet.laya.subscribe((event) => {
      if (event.type === 'status') {
        setLaya(event.status)
        if (!event.status.busy) setProgress(null)
      } else {
        setProgress(event)
      }
    })
  }, [])
  useEffect(() => {
    if (!layaOn) { setThemes([]); return }
    void window.intoponet.laya.themes().then(setThemes, () => setThemes([]))
  }, [layaOn, laya?.indexedDocuments, records?.length])
  useEffect(() => {
    if (!layaOn || !doc) { setRelated([]); return }
    void window.intoponet.laya.related({ recordId: doc.document.id }, 5).then(setRelated, () => setRelated([]))
  }, [layaOn, doc?.document.id])
  useEffect(() => { if (!focus) searchInput.current?.focus() }, [focus])
  useEffect(() => { if (focus) void openDocument(focus, null) }, [focus])

  // Search as you type, debounced; entirely on this device.
  useEffect(() => {
    const value = query.trim()
    if (mode === 'ask') return
    if (value.length < 2) { setHits(null); return }
    const timer = window.setTimeout(() => {
      const search = layaOn ? window.intoponet.laya.search(value, 30) : window.intoponet.knowledge.search(value, 30)
      void search.then(setHits, () => setHits([]))
    }, layaOn ? 260 : 140)
    return () => window.clearTimeout(timer)
  }, [query, mode, layaOn])

  const ask = (): void => {
    const question = query.trim()
    if (question.length < 3 || !layaOn) return
    setAsking(true)
    window.intoponet.laya.ask(question, 6).then(setPassages, () => setPassages([])).finally(() => setAsking(false))
  }
  const enableLaya = (): void => {
    setLayaError('')
    window.intoponet.laya.enable().then(setLaya, (reason: unknown) => setLayaError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Laya could not be turned on.'))
  }
  const disableLaya = (deleteModel: boolean): void => {
    void window.intoponet.laya.disable({ deleteModel }).then((status) => { setLaya(status); setMode('search'); setPassages(null) })
  }

  // The reader mounts after its enter animation, so retry briefly until the cited paragraph exists.
  useEffect(() => {
    if (!doc || doc.paragraph === null) return
    let tries = 0
    let timer = 0
    const scroll = (): void => {
      const el = reader.current?.querySelector<HTMLElement>(`[data-paragraph="${doc.paragraph}"]`)
      if (el) el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
      else if (tries++ < 12) timer = window.setTimeout(scroll, 60)
    }
    scroll()
    return () => window.clearTimeout(timer)
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
        <div className="knowledge-searchbar">
          <label className="knowledge-search">
            {mode === 'ask' ? <MessageCircleQuestion size={15} aria-hidden="true" /> : <Search size={15} aria-hidden="true" />}
            <span className="sr-only">{mode === 'ask' ? 'Ask your knowledge' : 'Search your knowledge'}</span>
            <input
              ref={searchInput}
              value={query}
              onChange={(event) => { setQuery(event.target.value); if (mode === 'ask') setPassages(null) }}
              onKeyDown={(event) => { if (event.key === 'Enter' && mode === 'ask') { event.preventDefault(); ask() } }}
              placeholder={mode === 'ask' ? 'Ask a question — answers are quotes from your pages' : layaOn ? 'Search by words or meaning' : 'Search everything you’ve absorbed'}
            />
            {query && <button type="button" aria-label="Clear" onClick={() => { setQuery(''); setPassages(null) }}><X size={13} /></button>}
          </label>
          {layaOn && (
            <div className="knowledge-mode" role="radiogroup" aria-label="Mode">
              <button type="button" role="radio" aria-checked={mode === 'search'} className={mode === 'search' ? 'is-active' : ''} onClick={() => { setMode('search'); setPassages(null) }}>Search</button>
              <button type="button" role="radio" aria-checked={mode === 'ask'} className={mode === 'ask' ? 'is-active' : ''} onClick={() => { setMode('ask'); setHits(null) }}>Ask</button>
            </div>
          )}
        </div>
        <LayaStrip status={laya} progress={progress} error={layaError} onEnable={enableLaya} onDisable={disableLaya} />
        {error && <p className="absorb-status is-error" role="alert">{error}</p>}

        <div className="knowledge-body">
          <div className="knowledge-list">
            {mode === 'ask' ? (
              asking ? <p className="knowledge-empty"><Loader2 size={14} className="olds-spin" aria-hidden="true" /> Looking through your pages…</p>
              : passages === null ? <p className="knowledge-empty">Ask a question and press Enter. Laya answers only with passages quoted from pages you absorbed, each cited to its paragraph — it never writes an answer of its own.</p>
              : passages.length === 0 ? <p className="knowledge-empty">Nothing you’ve absorbed answers that closely enough.</p>
              : (
                <ul aria-label="Cited passages">
                  {passages.map((passage) => (
                    <li key={`${passage.recordId}-${passage.paragraphIndex}`}>
                      <button type="button" className={`knowledge-passage${doc?.document.id === passage.recordId && doc.paragraph === passage.paragraphIndex ? ' is-active' : ''}`} onClick={() => void openDocument(passage.recordId, passage.paragraphIndex)}>
                        <span className="knowledge-quote">“{passage.text}”</span>
                        <small>{passage.title} · ¶ {passage.paragraphIndex + 1}</small>
                        <span className="knowledge-confidence" aria-label={`Match strength ${Math.round(passage.confidence * 100)} of 100`}><span style={{ width: `${Math.round(passage.confidence * 100)}%` }} /></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : hits ? (
              hits.length ? (
                <ul aria-label="Search results">
                  {hits.map((hit) => (
                    <li key={`${hit.recordId}-${hit.paragraphIndex}`}>
                      <button type="button" className={doc?.document.id === hit.recordId && doc.paragraph === hit.paragraphIndex ? 'is-active' : ''} onClick={() => void openDocument(hit.recordId, hit.paragraphIndex)}>
                        <strong>{hit.title}</strong>
                        <span className="knowledge-snippet">…{highlight(hit.snippet, hit.matches)}…</span>
                        <small>¶ {hit.paragraphIndex + 1} · {new URL(hit.url).hostname}{'matchedBy' in hit && (hit as LayaHit).matchedBy !== 'words' ? <span className="knowledge-meaning"><Sparkles size={9} aria-hidden="true" /> meaning</span> : null}</small>
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
              <>
              {themes.length > 1 && (
                <div className="knowledge-themes" role="group" aria-label="Themes">
                  {themes.map((item) => (
                    <button key={item.id} type="button" aria-pressed={theme === item.id} className={theme === item.id ? 'is-active' : ''} onClick={() => setTheme(theme === item.id ? null : item.id)} title={item.terms.join(', ')}>
                      <Brain size={11} aria-hidden="true" />{item.label}<small>{item.recordIds.length}</small>
                    </button>
                  ))}
                </div>
              )}
              <ul aria-label="Absorbed pages">
                {(theme ? records.filter((record) => themes.find((item) => item.id === theme)?.recordIds.includes(record.id)) : records).map((record) => (
                  <li key={record.id}>
                    <button type="button" className={doc?.document.id === record.id ? 'is-active' : ''} onClick={() => void openDocument(record.id, null)}>
                      <strong>{record.title}</strong>
                      <small>{record.siteName ?? new URL(record.url).hostname} · {when(record.absorbedAt)} · {record.wordCount.toLocaleString()} words</small>
                      {record.note && <span className="knowledge-note">{record.note}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              </>
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
                    {wikipediaArticle(doc.document.url) && (
                      <button type="button" className="lg-icon-button" aria-label="The Olds: history of this topic" title="The Olds: history" onClick={() => { const article = wikipediaArticle(doc.document.url)!; onHistory(article.title, article.lang) }}><History size={15} /></button>
                    )}
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
                  {related.length > 0 && (
                    <section className="knowledge-related" aria-label="Related in your knowledge">
                      <h3><Sparkles size={11} aria-hidden="true" /> Related in your knowledge</h3>
                      {related.map((item) => (
                        <button key={`${item.recordId}-${item.paragraphIndex}`} type="button" onClick={() => void openDocument(item.recordId, item.paragraphIndex)}>
                          <strong>{item.title}</strong>
                          <span>{item.snippet}</span>
                          <small>¶ {item.paragraphIndex + 1} · {Math.round(item.similarity * 100)}% similar</small>
                        </button>
                      ))}
                    </section>
                  )}
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

function LayaStrip({ status, progress, error, onEnable, onDisable }: {
  status: LayaStatus | null
  progress: LayaProgress | null
  error: string
  onEnable: () => void
  onDisable: (deleteModel: boolean) => void
}) {
  const [menu, setMenu] = useState(false)
  if (!status) return null
  const sizeMb = Math.round((status.model.sizeBytes || 91_099_884) / 1_000_000)
  const working = status.busy || progress !== null
  const percent = progress?.type === 'download'
    ? Math.round((progress.receivedBytes / Math.max(1, progress.totalBytes)) * 100)
    : progress?.type === 'embedding'
      ? Math.round((progress.done / Math.max(1, progress.total)) * 100)
      : null
  const label = progress?.type === 'download' ? `Downloading the model… ${percent}%`
    : progress?.type === 'verify' ? 'Checking the download…'
    : progress?.type === 'embedding' ? `Understanding your pages… ${progress.done} of ${progress.total}`
    : null
  if (!status.enabled) {
    return (
      <div className="laya-strip is-off">
        <Brain size={18} aria-hidden="true" />
        <div>
          <strong>Laya</strong> finds pages by meaning, groups them into themes, and answers questions with quotes from your own pages.
          <small>Runs only on this device, with no network. Turning it on downloads an open {sizeMb} MB model once ({status.model.id}, Apache-2.0), checked against a pinned fingerprint.</small>
          {error && <small className="laya-error">{error}</small>}
        </div>
        <button type="button" className="absorb-primary" disabled={working} onClick={onEnable}>
          {working ? <Loader2 size={14} className="olds-spin" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
          {working ? label ?? 'Turning on…' : 'Turn on Laya'}
        </button>
        {percent !== null && <span className="laya-bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>}
      </div>
    )
  }
  return (
    <div className="laya-strip is-on">
      <Brain size={14} aria-hidden="true" />
      <span>{label ?? `Laya is on · ${status.indexedDocuments} of ${status.totalDocuments} pages understood · offline`}</span>
      {status.lastError && <small className="laya-error">{status.lastError}</small>}
      <button type="button" className="laya-menu" aria-expanded={menu} onClick={() => setMenu((open) => !open)}>Options</button>
      {menu && (
        <div className="laya-options" role="menu">
          <button type="button" role="menuitem" onClick={() => { setMenu(false); onDisable(false) }}>Turn off (keep model)</button>
          <button type="button" role="menuitem" onClick={() => { setMenu(false); onDisable(true) }}>Turn off and delete model and meanings</button>
        </div>
      )}
      {percent !== null && <span className="laya-bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>}
    </div>
  )
}
