import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowLeft, BookOpen, ChevronsLeft, ChevronsRight, ExternalLink, GitBranch, History, List, Loader2, Newspaper, Rows3, Scale, X } from 'lucide-react'
import { OldsStory, SupportBadge, supportWords, type StorySelection } from './OldsStory'
import { useEffect, useMemo, useRef, useState } from 'react'
import { OLDS_NOTE, type OldsChapter, type OldsChronicleEntry, type OldsDate, type OldsEdge, type OldsNode, type OldsThread } from '@intoponet/browser-api'
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
type TimelineItem = { kind: 'root'; year: number } | { kind: 'entry'; entry: Entry; year: number } | { kind: 'event'; event: OldsChronicleEntry; index: number; year: number }

/** Decimal year of an ISO date ("2026-10-27" → 2026.82) for ordering. */
function isoYear(iso: string): number {
  const match = iso.match(/^(-?\d{1,6})(?:-(\d{2}))?(?:-(\d{2}))?/)
  if (!match) return 0
  return Number(match[1]) + (match[2] ? (Number(match[2]) - 1) / 12 : 0) + (match[3] ? (Number(match[3]) - 1) / 365 : 0)
}

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

const dateYear = (date: OldsDate | null): number | null => {
  if (!date) return null
  const match = date.iso.match(/^(-?\d{1,6})/)
  return match ? Number(match[1]) : null
}

/** The chapter a year falls in (the most specific one when subsections overlap). */
export function chapterAt(chapters: OldsChapter[], year: number): OldsChapter | null {
  let best: OldsChapter | null = null
  for (const chapter of chapters) {
    const start = dateYear(chapter.start)
    const end = dateYear(chapter.end) ?? start
    if (start === null || end === null || year < start || year > end) continue
    if (!best || chapter.level > best.level || (chapter.level === best.level && end - start < (dateYear(best.end) ?? 0) - (dateYear(best.start) ?? 0))) best = chapter
  }
  return best
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
  onFollowArticle,
  onPickTopic,
  translateOffer,
}: {
  state: OldsState
  /** Labels of the threads followed so far (for the back button). */
  trail: string[]
  onFollow: (node: OldsNode) => void
  onBack: (() => void) | null
  onClose: () => void
  onOpen: (url: string) => void
  /** Follow a Wikipedia article by title (a chapter's main article). */
  onFollowArticle?: (title: string) => void
  /** From a headline: switch to another matched topic. */
  onPickTopic?: (topic: string) => void
  /** A headline matched in its own language: translate it on this Mac and look again. */
  translateOffer?: { label: string; detail: string; busy: boolean; onTranslate: () => void } | null
}) {
  const sheen = useGlassSheen<HTMLDivElement>()
  const reduceMotion = useReducedMotion()
  // Focus moves into the panel when it opens (unless you're typing): Escape closes it, screen readers announce it.
  useEffect(() => {
    const active = document.activeElement
    const typing = active instanceof HTMLInputElement && active.value !== '' || active instanceof HTMLTextAreaElement
    if (!typing) document.querySelector<HTMLElement>('.olds-sheet')?.focus({ preventScroll: true })
  }, [])
  const [view, setView] = useState<'story' | 'timeline' | 'list' | 'debate'>('timeline')
  const [story, setStory] = useState<{ key: string; selection: StorySelection } | null>(null)
  const [wellSourced, setWellSourced] = useState(false)
  const [selectedId, setSelectedIdState] = useState<string | null>(null)
  const [chapterId, setChapterId] = useState<string | null>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null)
  const drag = useRef<{ x: number; scroll: number; moved: boolean } | null>(null)
  const setSelectedId = (id: string | null): void => {
    setSelectedIdState(id)
    if (id) setChapterId(null)
  }
  const track = useRef<HTMLDivElement>(null)
  const thread = state.status === 'ready' ? state.thread : null
  const root = thread?.nodes.find((node) => node.id === thread.rootId) ?? null
  const storyFromId = story?.selection.kind === 'step' ? story.selection.edge?.from : undefined
  const storyFromLabel = storyFromId ? thread?.nodes.find((node) => node.id === storyFromId)?.label ?? thread?.context?.path.find((step) => step.node.id === storyFromId)?.node.label : undefined
  // A selected chapter shows its own key events (the dated topics its section links to).
  const [chapterEvents, setChapterEvents] = useState<{ key: string; status: 'loading' | 'ready' | 'error'; thread?: OldsThread } | null>(null)
  const chapterFocus = chapterId && thread?.chaptersSource ? thread.chapters?.find((item) => item.id === chapterId) ?? null : null
  const chapterKey = chapterFocus && thread?.chaptersSource ? `${thread.chaptersSource.title}|${chapterFocus.title}` : null
  useEffect(() => {
    if (!chapterKey || !chapterFocus || !thread?.chaptersSource) { setChapterEvents(null); return }
    let cancelled = false
    setChapterEvents({ key: chapterKey, status: 'loading' })
    window.intoponet.olds.thread({ kind: 'chapter', article: thread.chaptersSource.title, section: chapterFocus.title }).then((result) => {
      if (!cancelled) setChapterEvents({ key: chapterKey, status: 'ready', thread: result })
    }, () => {
      if (!cancelled) setChapterEvents({ key: chapterKey, status: 'error' })
    })
    return () => { cancelled = true }
  }, [chapterKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const chapterMode = !!chapterEvents && chapterEvents.key === chapterKey && view !== 'story'
  const allEntries = useMemo(() => (
    chapterMode && chapterEvents?.status === 'ready' && chapterEvents.thread ? threadEntries(chapterEvents.thread) : thread ? threadEntries(thread) : []
  ), [thread, chapterMode, chapterEvents])
  const weak = (edge: OldsEdge): boolean => !!edge.support && (edge.support.level === 'unreferenced' || edge.support.level === 'wiki-imported') && !edge.support.corroborated
  const entries = useMemo(() => (wellSourced ? allEntries.filter((entry) => !weak(entry.edge)) : allEntries), [allEntries, wellSourced])
  const sourceCounts = useMemo(() => {
    const counts = { strong: 0, medium: 0, weak: 0 }
    for (const entry of allEntries) counts[supportWords(entry.edge.support).tone] += 1
    return counts
  }, [allEntries])
  const dated = entries.filter((entry) => entry.year !== null)
  const undated = entries.filter((entry) => entry.year === null)
  const selected = entries.find((entry) => `${entry.node.id}|${entry.relation.key}` === selectedId) ?? null
  const rootYear = root ? yearOf(root) : null

  const chapters = thread?.chapters ?? []
  const chapter = chapters.find((item) => item.id === chapterId) ?? null

  useEffect(() => {
    setSelectedIdState(null)
    setChapterId(null)
    setStory(null)
    setView(thread?.context ? 'story' : (current) => (current === 'story' || current === 'debate' ? 'timeline' : current))
  }, [thread?.rootId, thread?.context]) // eslint-disable-line react-hooks/exhaustive-deps

  // Which way the timeline can still scroll, and which chapter its middle is in.
  const updateEdges = (): void => {
    const el = track.current
    if (!el) return
    setEdges({ left: el.scrollLeft > 8, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 8 })
    const middle = el.getBoundingClientRect().left + el.clientWidth / 2
    let nearest: { year: number; distance: number } | null = null
    for (const item of el.querySelectorAll<HTMLElement>('[data-year]')) {
      const rect = item.getBoundingClientRect()
      const distance = Math.abs(rect.left + rect.width / 2 - middle)
      if (!nearest || distance < nearest.distance) nearest = { year: Number(item.dataset['year']), distance }
    }
    setCurrentChapterId(nearest ? chapterAt(chapters, nearest.year)?.id ?? null : null)
  }
  useEffect(() => {
    const id = requestAnimationFrame(updateEdges)
    return () => cancelAnimationFrame(id)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  // Esc closes an open chapter or event before it closes The Olds.
  const detailOpen = !!chapterId || !!selectedId || !!story
  useEffect(() => {
    if (!detailOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      event.preventDefault()
      setChapterId(null)
      setSelectedIdState(null)
      setStory(null)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [detailOpen])

  const scrollTrack = (to: 'start' | 'end' | number): void => {
    const el = track.current
    if (!el) return
    const left = to === 'start' ? 0 : to === 'end' ? el.scrollWidth : el.scrollLeft + to
    el.scrollTo({ left, behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  /** Bring the first event at or after a chapter's start into view. */
  const showChapter = (item: OldsChapter): void => {
    setChapterId(item.id)
    setSelectedIdState(null)
    track.current?.scrollTo({ left: 0 })
  }

  // Keep the root's moment in view when a thread opens.
  useEffect(() => {
    const el = track.current?.querySelector<HTMLElement>('[data-root-marker]')
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [thread?.rootId, view, reduceMotion])

  // Timeline order with the root slotted in at its own date.
  // The same dated events as the Story's "How we got here", on the timeline with the linked topics.
  const chronicle = useMemo(() => (chapterMode ? [] : thread?.chronicle ?? []), [thread, chapterMode])
  const timeline: TimelineItem[] = useMemo(() => {
    const items: TimelineItem[] = [
      ...dated.map((entry): TimelineItem => ({ kind: 'entry', entry, year: entry.year ?? 0 })),
      ...chronicle.map((event, index): TimelineItem => ({ kind: 'event', event, index, year: isoYear(event.at.iso) })),
    ].sort((a, b) => a.year - b.year)
    if (chapterMode) return items
    const at = rootYear === null ? items.length : items.findIndex((item) => item.year > rootYear)
    items.splice(at < 0 ? items.length : at, 0, { kind: 'root', year: rootYear ?? new Date().getFullYear() })
    return items
  }, [dated, chronicle, rootYear, chapterMode])

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
      tabIndex={-1}
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
            {thread?.context && (
              <button type="button" role="radio" aria-checked={view === 'story'} className={view === 'story' ? 'is-active' : ''} onClick={() => setView('story')}>
                <Newspaper size={13} aria-hidden="true" /> Story
              </button>
            )}
            <button type="button" role="radio" aria-checked={view === 'timeline'} className={view === 'timeline' ? 'is-active' : ''} onClick={() => setView('timeline')}>
              <Rows3 size={13} aria-hidden="true" /> Timeline
            </button>
            {thread?.interpretations?.length ? (
              <button type="button" role="radio" aria-checked={view === 'debate'} className={view === 'debate' ? 'is-active' : ''} onClick={() => setView('debate')} title="How historians and scholars read this, side by side">
                <Scale size={13} aria-hidden="true" /> Debate
              </button>
            ) : null}
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
            {thread?.context && <span className="olds-story-eyebrow">The history behind the news</span>}
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

      {thread && allEntries.length > 0 && view !== 'story' && (
        <div className="olds-sources" aria-label="How well these links are sourced">
          <span className="olds-support is-strong" title="Wikidata cites an outside source, or the link comes from the Wikipedia history article">● {sourceCounts.strong} well sourced</span>
          <span className="olds-support is-medium" title="No outside reference on Wikidata, but the Wikipedia article text names both sides">● {sourceCounts.medium} corroborated by Wikipedia text</span>
          <span className="olds-support is-weak" title="No reference, and not found in the Wikipedia article text">● {sourceCounts.weak} unverified</span>
          <label className="olds-sources-toggle">
            <input type="checkbox" checked={wellSourced} onChange={(event) => setWellSourced(event.target.checked)} /> Hide unverified
          </label>
        </div>
      )}

      {state.status === 'loading' && (
        <div className="olds-status" role="status"><Loader2 size={16} className="olds-spin" aria-hidden="true" /> Looking up sourced history…</div>
      )}
      {state.status === 'error' && <div className="olds-status is-error" role="alert">{state.message}</div>}
      {thread?.historyNote && <p className="olds-history-note">{thread.historyNote}</p>}
      {thread?.context && translateOffer && (
        <div className="olds-translate-offer">
          <span>{translateOffer.detail}</span>
          <button type="button" onClick={translateOffer.onTranslate} disabled={translateOffer.busy}>
            {translateOffer.busy ? <Loader2 size={12} className="olds-spin" aria-hidden="true" /> : null}{translateOffer.label}
          </button>
        </div>
      )}

      {thread && entries.length === 0 && !thread.context && (
        <div className="olds-status">No sourced historical links were found for this yet. That means Wikidata has no statements, not that there is no history.</div>
      )}

      {thread && (entries.length > 0 || thread.context) && (
        <div className="olds-body">
          {view === 'debate' && thread.interpretations?.length ? (
            <div className="olds-debate" aria-label="Competing interpretations">
              <p className="olds-debate-note">Readings attributed in Wikipedia’s article, side by side and in the article’s order. Intoponet doesn’t rank them; open each section to see its sources.</p>
              <div className="olds-debate-cards">
                {thread.interpretations.map((item) => (
                  <article key={item.who} className="olds-debate-card">
                    <strong>{item.who}</strong>
                    <p>{item.view}</p>
                    <button type="button" onClick={() => onOpen(item.url)}>From “{item.section}” <ExternalLink size={11} aria-hidden="true" /></button>
                  </article>
                ))}
              </div>
            </div>
          ) : view === 'story' && thread.context ? (
            <OldsStory
              context={thread.context}
              selectedKey={story?.key ?? null}
              onSelect={(key, selection) => setStory((current) => (current?.key === key ? null : { key, selection }))}
              onPickTopic={onPickTopic}
              onOpen={onOpen}
              onFollowArticle={onFollowArticle}
              chronicle={thread.chronicle}
            />
          ) : view === 'timeline' ? (
            <div className="olds-main">
            {chapters.length > 0 && (
              <nav className="olds-eras" aria-label={`Chapters from ${thread.chaptersSource?.title ?? 'its history article'}`}>
                {chapters.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`olds-era level-${item.level}${chapterId === item.id ? ' is-selected' : ''}${currentChapterId === item.id ? ' is-current' : ''}`}
                    aria-pressed={chapterId === item.id}
                    onClick={() => (chapterId === item.id ? setChapterId(null) : showChapter(item))}
                    title={item.summary ?? item.title}
                  >
                    <span>{item.title.replace(/\s*\([^)]*\d[^)]*\)\s*$/, '')}</span>
                    {item.start && <small>{item.start.label.replace(/^c\. /, '')}{item.end ? `–${item.end.label.replace(/^c\. /, '')}` : ''}</small>}
                  </button>
                ))}
              </nav>
            )}
            {chapterMode && chapterFocus && (
              <div className="olds-chapter-bar" role="status">
                {chapterEvents?.status === 'loading' ? (
                  <span><Loader2 size={12} className="olds-spin" aria-hidden="true" /> Finding the key events of “{chapterFocus.title}”…</span>
                ) : chapterEvents?.status === 'error' ? (
                  <span>The key events of this chapter could not be loaded.</span>
                ) : (
                  dated.length ? (
                    <span>Key events of <strong>{chapterFocus.title}</strong>{chapterFocus.start ? ` (${chapterFocus.start.label}${chapterFocus.end ? ` – ${chapterFocus.end.label}` : ''})` : ''}: {dated.length} dated event{dated.length === 1 ? '' : 's'} this chapter of the Wikipedia article links to.</span>
                  ) : (
                    <span>No dated events are linked in “{chapterFocus.title}” yet{(() => {
                      const index = chapters.findIndex((item) => item.id === chapterFocus.id)
                      return index > 0 ? '' : '.'
                    })()}{chapters.findIndex((item) => item.id === chapterFocus.id) > 0 && (
                      <button type="button" className="olds-chapter-prev" onClick={() => {
                        const index = chapters.findIndex((item) => item.id === chapterFocus.id)
                        const previous = chapters[index - 1]
                        if (previous) showChapter(previous)
                      }}>See the chapter before</button>
                    )}</span>
                  )
                )}
                <button type="button" onClick={() => setChapterId(null)}>Show all of {root?.label ?? 'its history'}</button>
              </div>
            )}
            <div className="olds-track-wrap">
            {edges.left && (
              <button type="button" className="olds-edge is-left" onClick={() => scrollTrack('start')} aria-label="Go to the earliest events">
                <ChevronsLeft size={14} aria-hidden="true" /> Earliest
              </button>
            )}
            {edges.right && (
              <button type="button" className="olds-edge is-right" onClick={() => scrollTrack('end')} aria-label="Go to the most recent events">
                Now <ChevronsRight size={14} aria-hidden="true" />
              </button>
            )}
            <div
              className="olds-track"
              ref={track}
              tabIndex={0}
              aria-label="Timeline: drag, scroll or use the arrow keys to move through time"
              onScroll={updateEdges}
              onWheel={(event) => {
                // A vertical wheel or trackpad swipe moves through time.
                if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') { event.preventDefault(); scrollTrack(-320) }
                if (event.key === 'ArrowRight') { event.preventDefault(); scrollTrack(320) }
                if (event.key === 'Home') { event.preventDefault(); scrollTrack('start') }
                if (event.key === 'End') { event.preventDefault(); scrollTrack('end') }
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                drag.current = { x: event.clientX, scroll: event.currentTarget.scrollLeft, moved: false }
              }}
              onPointerMove={(event) => {
                const state = drag.current
                if (!state) return
                const dx = event.clientX - state.x
                if (!state.moved && Math.abs(dx) > 4) {
                  state.moved = true
                  event.currentTarget.setPointerCapture(event.pointerId)
                  event.currentTarget.classList.add('is-dragging')
                }
                if (state.moved) event.currentTarget.scrollLeft = state.scroll - dx
              }}
              onPointerUp={(event) => {
                const moved = drag.current?.moved
                drag.current = null
                event.currentTarget.classList.remove('is-dragging')
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
                // A drag should not also click the card under the pointer.
                if (moved) event.currentTarget.addEventListener('click', (click) => click.stopPropagation(), { capture: true, once: true })
              }}
              onPointerCancel={(event) => {
                drag.current = null
                event.currentTarget.classList.remove('is-dragging')
              }}
            >
              <div className="olds-axis" aria-hidden="true" />
              <ol className="olds-timeline" aria-label="Timeline">
                {timeline.map((item, index) => item.kind === 'event' ? (
                  <li key={`event-${item.index}`} className={`olds-item is-event ${index % 2 ? 'is-low' : 'is-high'}`} data-year={item.year}>
                    <button type="button" className="olds-card olds-event-card" onClick={() => onOpen(item.event.url)} title={`From ${item.event.sourceTitle ? `${item.event.sourceTitle}: ` : ''}“${item.event.section}” — open the passage`}>
                      <span className="olds-card-date">{item.event.at.label}</span>
                      <span className="olds-event-text">{item.event.text}</span>
                      <span className="olds-rel">{item.event.sourceTitle ? `Context: ${item.event.sourceTitle} · ` : 'From '}“{item.event.section}”</span>
                    </button>
                    <span className="olds-tick" aria-hidden="true" />
                  </li>
                ) : item.kind === 'root' ? (
                  <li key="root" className="olds-root" data-root-marker data-year={rootYear ?? new Date().getFullYear()}>
                    <span className="olds-root-dot" aria-hidden="true" />
                    <span className="olds-root-label">{root?.start?.label ?? 'Now'}</span>
                    <strong>{root?.label}</strong>
                  </li>
                ) : (
                  <li key={`${item.entry.node.id}|${item.entry.relation.key}`} className={`olds-item ${index % 2 ? 'is-low' : 'is-high'}`} data-year={item.entry.year ?? undefined}>
                    <button
                      type="button"
                      className={`olds-card tone-${item.entry.relation.tone} ep-${item.entry.edge.epistemic}${selectedId === `${item.entry.node.id}|${item.entry.relation.key}` ? ' is-selected' : ''}`}
                      aria-pressed={selectedId === `${item.entry.node.id}|${item.entry.relation.key}`}
                      onClick={() => setSelectedId(`${item.entry.node.id}|${item.entry.relation.key}`)}
                    >
                      <span className="olds-card-date">{item.entry.node.start?.label}</span>
                      <strong>{item.entry.node.label}</strong>
                      <span className={`olds-rel src-${supportWords(item.entry.edge.support).tone}`}>{item.entry.relation.label}{item.entry.edge.epistemic === 'chronology-only' ? ' · sequence only' : item.entry.edge.epistemic === 'disputed' ? ' · disputed' : ''}</span>
                    </button>
                    <span className="olds-tick" aria-hidden="true" />
                  </li>
                ))}
              </ol>
            </div>
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
              {thread.context?.filedUnder && thread.context.filedUnder.threads.length > 0 && (
                <section>
                  <h3>Part of</h3>
                  <ul>
                    {thread.context.filedUnder.threads.map((title) => (
                      <li key={title}>
                        <button type="button" onClick={() => onFollowArticle?.(title)}>
                          <strong>{title}</strong>
                          <small>Filed here by Wikipedia’s Current events, {thread.context!.filedUnder!.date}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {chronicle.length > 0 && (
                <section>
                  <h3>How we got here</h3>
                  <ul>
                    {chronicle.map((event, index) => (
                      <li key={`event-${index}`}>
                        <button type="button" onClick={() => onOpen(event.url)}>
                          <strong>{event.at.label}</strong>
                          <span className="olds-list-text">{event.text}</span>
                          <small>{event.sourceTitle ? `Context: ${event.sourceTitle} · ` : 'From '}“{event.section}”</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {thread.context?.related && thread.context.related.length > 0 && (
                <section>
                  <h3>Topics behind this story</h3>
                  <ul>
                    {thread.context.related.map((topic) => (
                      <li key={topic.title}>
                        <button type="button" onClick={() => onFollowArticle?.(topic.title)}>
                          <strong>{topic.title}</strong>
                          {topic.description && <small>{topic.description}</small>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {!grouped.length && !chronicle.length && !thread.context?.related?.length && (
                <p className="olds-list-empty">No dated events or linked topics for {root?.label ?? 'this'} yet.</p>
              )}
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
            {view === 'story' && story && (
              <motion.aside
                key={story.key}
                className="olds-detail"
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 12 }}
                transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                aria-label="Details"
              >
                <button type="button" className="olds-detail-close" aria-label="Close details" title="Close (Esc)" onClick={() => setStory(null)}><X size={14} /></button>
                {story.selection.kind === 'chapter' ? (
                  <>
                    <span className="olds-detail-rel tone-event">Chapter</span>
                    <h3>{story.selection.chapter.title}</h3>
                    {story.selection.chapter.start && <p className="olds-date">{story.selection.chapter.start.label}{story.selection.chapter.end ? ` – ${story.selection.chapter.end.label}` : ' – today'}</p>}
                    {story.selection.chapter.summary && <p>{story.selection.chapter.summary}</p>}
                    <p className="olds-claim">From the Wikipedia article <em>{thread?.context?.chapterSource?.title}</em>: the chapter of the country's history this story falls in.</p>
                    <div className="olds-actions">
                      {story.selection.chapter.mainArticle && onFollowArticle && (
                        <button type="button" className="olds-follow" onClick={() => story.selection.kind === 'chapter' && onFollowArticle(story.selection.chapter.mainArticle!.title)}>
                          <GitBranch size={14} aria-hidden="true" /> {story.selection.chapter.mainArticle.title}
                        </button>
                      )}
                      <button type="button" className="lg-icon-button" aria-label="Read this chapter on Wikipedia" onClick={() => story.selection.kind === 'chapter' && onOpen(story.selection.chapter.url)}><BookOpen size={14} /></button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="olds-detail-rel tone-event">{story.selection.node.id === thread?.context?.topicId ? 'This story is about' : 'Step on the path'}</span>
                    <h3>{story.selection.node.label}</h3>
                    {story.selection.node.start && <p className="olds-date">{story.selection.node.start.label}{story.selection.node.end ? ` – ${story.selection.node.end.label}` : ''}</p>}
                    {story.selection.node.description && <p>{story.selection.node.description}</p>}
                    {story.selection.edge && (
                      <>
                        <p className="olds-claim">
                          Wikidata: <em>{storyFromLabel ?? 'the newer step'}</em> · {story.selection.edge.propertyLabel} · <em>{story.selection.node.label}</em>
                          {story.selection.edge.epistemic === 'chronology-only' && <span className="olds-warn"> Sequence only: this does not say one caused the other.</span>}
                        </p>
                        <div className="olds-check">
                          <SupportBadge support={story.selection.edge.support} />
                          <p>{supportWords(story.selection.edge.support).detail}</p>
                        </div>
                        <div className="olds-cites">
                          {story.selection.edge.citations.map((citation) => (
                            <button key={citation.url} type="button" onClick={() => onOpen(citation.url)}>{citation.title ?? new URL(citation.url).hostname}</button>
                          ))}
                          <button type="button" onClick={() => story.selection.kind === 'step' && story.selection.edge && onOpen(story.selection.edge.statementUrl)}>Statement on Wikidata</button>
                        </div>
                      </>
                    )}
                    <div className="olds-actions">
                      <button type="button" className="olds-follow" onClick={() => story.selection.kind === 'step' && onFollow(story.selection.node)}>
                        <GitBranch size={14} aria-hidden="true" /> Its full history
                      </button>
                      {story.selection.node.wikipediaUrl && (
                        <button type="button" className="lg-icon-button" aria-label="Open on Wikipedia" onClick={() => story.selection.kind === 'step' && onOpen(story.selection.node.wikipediaUrl!)}><ExternalLink size={14} /></button>
                      )}
                    </div>
                  </>
                )}
              </motion.aside>
            )}
            {view !== 'story' && chapter && !selected && (
              <motion.aside
                key={chapter.id}
                className="olds-detail"
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 12 }}
                transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                aria-label={`Chapter: ${chapter.title}`}
              >
                <button type="button" className="olds-detail-close" aria-label="Close chapter" title="Close (Esc)" onClick={() => setChapterId(null)}><X size={14} /></button>
                <span className="olds-detail-rel tone-event">Chapter</span>
                <h3>{chapter.title}</h3>
                {chapter.start && <p className="olds-date">{chapter.start.label}{chapter.end ? ` – ${chapter.end.label}` : ''}</p>}
                {chapter.summary && <p>{chapter.summary}</p>}
                <p className="olds-claim">
                  From the Wikipedia article <em>{thread.chaptersSource?.title}</em>. Dates marked c. are the span of years the section names.
                </p>
                <div className="olds-actions">
                  {chapter.mainArticle && onFollowArticle && (
                    <button type="button" className="olds-follow" onClick={() => onFollowArticle(chapter.mainArticle!.title)}>
                      <GitBranch size={14} aria-hidden="true" /> {chapter.mainArticle.title}
                    </button>
                  )}
                  <button type="button" className="lg-icon-button" aria-label="Read this chapter on Wikipedia" title="Read this chapter on Wikipedia" onClick={() => onOpen(chapter.url)}>
                    <BookOpen size={14} />
                  </button>
                </div>
              </motion.aside>
            )}
            {view !== 'story' && selected && (
              <motion.aside
                key={`${selected.node.id}|${selected.relation.key}`}
                className="olds-detail"
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 12 }}
                transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                aria-label={`Details: ${selected.node.label}`}
              >
                <button type="button" className="olds-detail-close" aria-label="Close details" title="Close (Esc)" onClick={() => setSelectedIdState(null)}><X size={14} /></button>
                <span className={`olds-detail-rel tone-${selected.relation.tone}`}>{selected.relation.label}</span>
                <h3>{selected.node.label}</h3>
                {selected.node.start && <p className="olds-date">{selected.node.start.label}{selected.node.end ? ` – ${selected.node.end.label}` : ''}</p>}
                {selected.node.description && <p>{selected.node.description}</p>}
                {selected.edge.property.startsWith('wikipedia-') ? (
                  <p className="olds-claim">Wikipedia: the {selected.edge.propertyLabel.replace(/ \(Wikipedia\)$/, '')}.{selected.node.start?.label.startsWith('c. ') ? ' Its date is the chapter’s span.' : ''}</p>
                ) : (
                <p className="olds-claim">
                  Wikidata: <em>{selected.edge.from === thread.rootId ? root?.label : selected.node.label}</em> · {selected.edge.propertyLabel} · <em>{selected.edge.from === thread.rootId ? selected.node.label : root?.label}</em>
                  {selected.edge.epistemic === 'chronology-only' && <span className="olds-warn"> Sequence only: this does not say one caused the other.</span>}
                  {selected.edge.epistemic === 'disputed' && <span className="olds-warn"> This statement is marked as disputed.</span>}
                </p>
                )}
                <div className="olds-check">
                  <SupportBadge support={selected.edge.support} />
                  <p>{supportWords(selected.edge.support).detail}</p>
                </div>
                <div className="olds-cites">
                  <span>{selected.edge.referenceCount ? `${selected.edge.referenceCount} reference${selected.edge.referenceCount === 1 ? '' : 's'}` : 'No references on this statement'}</span>
                  {selected.edge.citations.map((citation) => (
                    <button key={citation.url} type="button" onClick={() => onOpen(citation.url)}>
                      {citation.title ?? new URL(citation.url).hostname}
                    </button>
                  ))}
                  <button type="button" onClick={() => onOpen(selected.edge.statementUrl)}>{selected.edge.property.startsWith('wikipedia-') ? 'Chapter on Wikipedia' : 'Statement on Wikidata'}</button>
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

      <footer className="olds-foot">{thread ? `${thread.attribution}. ` : ''}{OLDS_NOTE}{thread?.chaptersSource ? ` Chapters follow the Wikipedia article “${thread.chaptersSource.title}”.` : ''} Drag, scroll or use ← → to move through time.</footer>
    </motion.section>
  )
}
