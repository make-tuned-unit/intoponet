import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowLeft, ExternalLink, GitBranch, History, List, Loader2, Rows3, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { OLDS_NOTE, type OldsEdge, type OldsNode, type OldsThread } from '@intoponet/browser-api'
import { useGlassSheen } from '../glass/useGlassSheen'
import '../glass/glass.css'
import './olds.css'

/** How a related node stands to the thread's root, in plain words. */
export type Relation = { key: string; label: string; tone: 'cause' | 'effect' | 'sequence' | 'event' | 'place' | 'part' | 'influence' | 'other' }

export function relationTo(edge: OldsEdge, rootId: string): Relation {
  const toRoot = edge.to === rootId
  switch (edge.type) {
    case 'contributed_to':
      return toRoot ? { key: 'cause', label: 'Cause', tone: 'cause' } : { key: 'effect', label: 'Effect', tone: 'effect' }
    case 'preceded_by':
      return { key: 'before', label: 'Came before', tone: 'sequence' }
    case 'followed_by':
      return { key: 'after', label: 'Came after', tone: 'sequence' }
    case 'influenced':
      return toRoot ? { key: 'influence', label: 'Influenced it', tone: 'influence' } : { key: 'influenced', label: 'It influenced', tone: 'influence' }
    case 'significant_event':
      return { key: 'event', label: 'Key event', tone: 'event' }
    case 'located_at':
      return toRoot ? { key: 'here', label: 'Took place here', tone: 'place' } : { key: 'where', label: 'Where', tone: 'place' }
    case 'part_of':
      return edge.from === rootId ? { key: 'partof', label: 'Part of', tone: 'part' } : { key: 'includes', label: 'Includes', tone: 'part' }
    case 'responded_to':
      return { key: 'response', label: 'Response', tone: 'influence' }
    case 'analogous_to':
      return { key: 'similar', label: 'Similar to', tone: 'other' }
    case 'disputed_link':
      return { key: 'disputed', label: 'Disputed link', tone: 'other' }
  }
}

type Entry = { node: OldsNode; edge: OldsEdge; relation: Relation; year: number | null }

/** Decimal year for ordering; BCE dates are negative. */
export function yearOf(node: OldsNode): number | null {
  const iso = node.start?.iso ?? node.end?.iso
  if (!iso) return null
  const match = iso.match(/^(-?\d{1,6})(?:-(\d{2}))?(?:-(\d{2}))?/)
  if (!match) return null
  const year = Number(match[1])
  const month = match[2] ? Number(match[2]) - 1 : 0
  const day = match[3] ? Number(match[3]) - 1 : 0
  return year + month / 12 + day / 365
}

export function threadEntries(thread: OldsThread): Entry[] {
  const nodes = new Map(thread.nodes.map((node) => [node.id, node]))
  const seen = new Set<string>()
  const entries: Entry[] = []
  for (const edge of thread.edges) {
    const otherId = edge.from === thread.rootId ? edge.to : edge.to === thread.rootId ? edge.from : null
    if (!otherId || otherId === thread.rootId) continue
    const node = nodes.get(otherId)
    if (!node) continue
    const relation = relationTo(edge, thread.rootId)
    const key = `${otherId}|${relation.key}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({ node, edge, relation, year: yearOf(node) })
  }
  return entries.sort((a, b) => (a.year ?? Number.POSITIVE_INFINITY) - (b.year ?? Number.POSITIVE_INFINITY) || a.node.label.localeCompare(b.node.label))
}

export type OldsState =
  | { status: 'loading'; label: string }
  | { status: 'error'; label: string; message: string }
  | { status: 'ready'; thread: OldsThread }

export function OldsPanel({
  state,
  trail,
  onFollow,
  onBack,
  onClose,
  onOpen,
}: {
  state: OldsState
  /** Labels of the threads followed so far (for the back button). */
  trail: string[]
  onFollow: (node: OldsNode) => void
  onBack: (() => void) | null
  onClose: () => void
  onOpen: (url: string) => void
}) {
  const sheen = useGlassSheen<HTMLDivElement>()
  const reduceMotion = useReducedMotion()
  const [view, setView] = useState<'timeline' | 'list'>('timeline')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const track = useRef<HTMLDivElement>(null)
  const thread = state.status === 'ready' ? state.thread : null
  const root = thread?.nodes.find((node) => node.id === thread.rootId) ?? null
  const entries = useMemo(() => (thread ? threadEntries(thread) : []), [thread])
  const dated = entries.filter((entry) => entry.year !== null)
  const undated = entries.filter((entry) => entry.year === null)
  const selected = entries.find((entry) => `${entry.node.id}|${entry.relation.key}` === selectedId) ?? null
  const rootYear = root ? yearOf(root) : null

  useEffect(() => setSelectedId(null), [thread?.rootId])

  // Keep the root's moment in view when a thread opens.
  useEffect(() => {
    const el = track.current?.querySelector<HTMLElement>('[data-root-marker]')
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [thread?.rootId, view, reduceMotion])

  // Timeline order with the root slotted in at its own date.
  const timeline: Array<{ kind: 'root' } | { kind: 'entry'; entry: Entry }> = useMemo(() => {
    const items: Array<{ kind: 'root' } | { kind: 'entry'; entry: Entry }> = dated.map((entry) => ({ kind: 'entry', entry }))
    const at = rootYear === null ? items.length : items.findIndex((item) => item.kind === 'entry' && (item.entry.year ?? 0) > rootYear)
    items.splice(at < 0 ? items.length : at, 0, { kind: 'root' })
    return items
  }, [dated, rootYear])

  const grouped = useMemo(() => {
    const groups = new Map<string, Entry[]>()
    for (const entry of entries) groups.set(entry.relation.label, [...(groups.get(entry.relation.label) ?? []), entry])
    return [...groups.entries()]
  }, [entries])

  const label = state.status === 'ready' ? root?.label ?? 'History' : state.label

  return (
    <motion.section
      ref={sheen}
      className="olds-sheet lg-surface lg-sheen"
      aria-label={`The Olds: ${label}`}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.98, filter: 'blur(8px)' }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 30, scale: 0.98, filter: 'blur(6px)' }}
      transition={{ type: 'spring', stiffness: 360, damping: 36 }}
    >
      <header className="olds-head">
        <div className="olds-head-left">
          {onBack && (
            <button type="button" className="lg-icon-button" aria-label={`Back to ${trail[trail.length - 2] ?? 'previous thread'}`} title="Back" onClick={onBack}>
              <ArrowLeft size={15} />
            </button>
          )}
          <span className="olds-eyebrow"><History size={12} aria-hidden="true" /> The Olds</span>
          {trail.length > 1 && (
            <span className="olds-trail" aria-label="Threads followed">
              {trail.slice(0, -1).slice(-3).map((step, index) => <span key={`${step}-${index}`}>{step} ›</span>)}
            </span>
          )}
        </div>
        <div className="olds-head-right">
          <div className="olds-views" role="radiogroup" aria-label="View">
            <button type="button" role="radio" aria-checked={view === 'timeline'} className={view === 'timeline' ? 'is-active' : ''} onClick={() => setView('timeline')}>
              <Rows3 size={13} aria-hidden="true" /> Timeline
            </button>
            <button type="button" role="radio" aria-checked={view === 'list'} className={view === 'list' ? 'is-active' : ''} onClick={() => setView('list')}>
              <List size={13} aria-hidden="true" /> List
            </button>
          </div>
          <button type="button" className="lg-icon-button" aria-label="Close The Olds" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="olds-title">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22 }}>
            <h2>{label}</h2>
            {root && (
              <p>
                {root.start ? <span className="olds-date">{root.start.label}{root.end ? ` – ${root.end.label}` : ''}</span> : null}
                {root.description}
              </p>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {state.status === 'loading' && (
        <div className="olds-status" role="status"><Loader2 size={16} className="olds-spin" aria-hidden="true" /> Looking up sourced history…</div>
      )}
      {state.status === 'error' && <div className="olds-status is-error" role="alert">{state.message}</div>}

      {thread && entries.length === 0 && (
        <div className="olds-status">No sourced historical links were found for this yet. That means Wikidata has no statements, not that there is no history.</div>
      )}

      {thread && entries.length > 0 && (
        <div className="olds-body">
          {view === 'timeline' ? (
            <div className="olds-main">
            <div className="olds-track" ref={track}>
              <div className="olds-axis" aria-hidden="true" />
              <ol className="olds-timeline" aria-label="Timeline">
                {timeline.map((item, index) => item.kind === 'root' ? (
                  <li key="root" className="olds-root" data-root-marker>
                    <span className="olds-root-dot" aria-hidden="true" />
                    <span className="olds-root-label">{root?.start?.label ?? 'Now'}</span>
                    <strong>{root?.label}</strong>
                  </li>
                ) : (
                  <li key={`${item.entry.node.id}|${item.entry.relation.key}`} className={`olds-item ${index % 2 ? 'is-low' : 'is-high'}`}>
                    <button
                      type="button"
                      className={`olds-card tone-${item.entry.relation.tone} ep-${item.entry.edge.epistemic}${selectedId === `${item.entry.node.id}|${item.entry.relation.key}` ? ' is-selected' : ''}`}
                      aria-pressed={selectedId === `${item.entry.node.id}|${item.entry.relation.key}`}
                      onClick={() => setSelectedId(`${item.entry.node.id}|${item.entry.relation.key}`)}
                    >
                      <span className="olds-card-date">{item.entry.node.start?.label}</span>
                      <strong>{item.entry.node.label}</strong>
                      <span className="olds-rel">{item.entry.relation.label}{item.entry.edge.epistemic === 'chronology-only' ? ' · sequence only' : item.entry.edge.epistemic === 'disputed' ? ' · disputed' : ''}</span>
                    </button>
                    <span className="olds-tick" aria-hidden="true" />
                  </li>
                ))}
              </ol>
            </div>
              {undated.length > 0 && (
                <div className="olds-undated">
                  <h3>Undated</h3>
                  {undated.map((entry) => (
                    <button
                      key={`${entry.node.id}|${entry.relation.key}`}
                      type="button"
                      className={`olds-chip tone-${entry.relation.tone}`}
                      onClick={() => setSelectedId(`${entry.node.id}|${entry.relation.key}`)}
                    >
                      {entry.node.label} <small>{entry.relation.label}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="olds-list">
              {grouped.map(([group, items]) => (
                <section key={group}>
                  <h3>{group}</h3>
                  <ul>
                    {items.map((entry) => (
                      <li key={`${entry.node.id}|${entry.relation.key}`}>
                        <button type="button" onClick={() => setSelectedId(`${entry.node.id}|${entry.relation.key}`)} aria-pressed={selectedId === `${entry.node.id}|${entry.relation.key}`}>
                          <strong>{entry.node.label}</strong>
                          <small>{[entry.node.start?.label, entry.edge.epistemic === 'chronology-only' ? 'sequence only' : entry.edge.epistemic === 'disputed' ? 'disputed' : null].filter(Boolean).join(' · ')}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          <AnimatePresence>
            {selected && (
              <motion.aside
                key={`${selected.node.id}|${selected.relation.key}`}
                className="olds-detail"
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 12 }}
                transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                aria-label={`Details: ${selected.node.label}`}
              >
                <span className={`olds-detail-rel tone-${selected.relation.tone}`}>{selected.relation.label}</span>
                <h3>{selected.node.label}</h3>
                {selected.node.start && <p className="olds-date">{selected.node.start.label}{selected.node.end ? ` – ${selected.node.end.label}` : ''}</p>}
                {selected.node.description && <p>{selected.node.description}</p>}
                <p className="olds-claim">
                  Wikidata: <em>{selected.edge.from === thread.rootId ? root?.label : selected.node.label}</em> · {selected.edge.propertyLabel} · <em>{selected.edge.from === thread.rootId ? selected.node.label : root?.label}</em>
                  {selected.edge.epistemic === 'chronology-only' && <span className="olds-warn"> Sequence only: this does not say one caused the other.</span>}
                  {selected.edge.epistemic === 'disputed' && <span className="olds-warn"> This statement is marked as disputed.</span>}
                </p>
                <div className="olds-cites">
                  <span>{selected.edge.referenceCount ? `${selected.edge.referenceCount} reference${selected.edge.referenceCount === 1 ? '' : 's'}` : 'No references on this statement'}</span>
                  {selected.edge.citations.map((citation) => (
                    <button key={citation.url} type="button" onClick={() => onOpen(citation.url)}>
                      {citation.title ?? new URL(citation.url).hostname}
                    </button>
                  ))}
                  <button type="button" onClick={() => onOpen(selected.edge.statementUrl)}>Statement on Wikidata</button>
                </div>
                <div className="olds-actions">
                  <button type="button" className="olds-follow" onClick={() => onFollow(selected.node)}>
                    <GitBranch size={14} aria-hidden="true" /> Follow this thread
                  </button>
                  {selected.node.wikipediaUrl && (
                    <button type="button" className="lg-icon-button" aria-label="Open on Wikipedia" title="Open on Wikipedia" onClick={() => onOpen(selected.node.wikipediaUrl!)}>
                      <ExternalLink size={14} />
                    </button>
                  )}
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      )}

      <footer className="olds-foot">{thread ? `${thread.attribution}. ` : ''}{OLDS_NOTE}</footer>
    </motion.section>
  )
}
