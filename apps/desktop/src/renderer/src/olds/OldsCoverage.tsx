import { Archive, ExternalLink, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OldsCoverage as Coverage, OldsCoverageItem } from '@intoponet/browser-api'

export type CoverageArticle = { url: string; title: string; publisher?: string }

type State = {
  status: 'loading' | 'ready' | 'error'
  items: OldsCoverageItem[]
  topics: Coverage['topics']
  cursor: string | null
  outlet: string | null
  result: Coverage['status'] | null
  more: boolean
}

const MONTH = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
const DAY = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
const at = (date: string): Date => new Date(`${date}T12:00:00Z`)

/**
 * The outlet's own earlier headlines on this story, newest first, read from its
 * topic pages and the Wayback Machine's snapshots of them. Scrolling to the end
 * loads the next stretch further back.
 */
export function OldsCoverage({ article, onOpen }: { article: CoverageArticle; onOpen: (url: string) => void }) {
  const [state, setState] = useState<State>({ status: 'loading', items: [], topics: [], cursor: null, outlet: null, result: null, more: false })
  const [storyOnly, setStoryOnly] = useState<boolean | null>(null)
  const request = useRef(0)
  const sentinel = useRef<HTMLLIElement>(null)
  const root = useRef<HTMLDivElement>(null)
  // Loads the reader did not scroll for (a short list keeps the end in view); two at most, then the button.
  const unasked = useRef(0)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const id = ++request.current
    setState({ status: 'loading', items: [], topics: [], cursor: null, outlet: null, result: null, more: false })
    setStoryOnly(null)
    window.intoponet.olds.coverage({ url: article.url, headline: article.title }).then((result) => {
      if (id !== request.current) return
      setState({ status: 'ready', items: result.items, topics: result.topics, cursor: result.cursor, outlet: result.outlet?.name ?? null, result: result.status, more: false })
      // Only this story when the first page has enough of it; decided once, so the list does not switch under the reader.
      if (result.items.length) setStoryOnly(result.items.filter((item) => item.story).length >= 4)
    }, () => {
      if (id === request.current) setState((current) => ({ ...current, status: 'error' }))
    })
  }, [article.url, article.title, attempt])

  const loadMore = useCallback(() => {
    if (state.status !== 'ready' || !state.cursor || state.more) return
    const id = request.current
    const cursor = state.cursor
    setState((current) => ({ ...current, more: true }))
    window.intoponet.olds.coverage({ url: article.url, headline: article.title, cursor }).then((result) => {
      if (id !== request.current) return
      setState((current) => {
        const known = new Set(current.items.map((item) => item.url))
        const items = [...current.items, ...result.items.filter((item) => !known.has(item.url))].sort((a, b) => b.date.localeCompare(a.date))
        // A busy archive keeps the same place, so the next scroll tries again.
        return { ...current, items, cursor: result.status === 'busy' ? cursor : result.cursor, result: result.status, more: false }
      })
    }, () => {
      if (id === request.current) setState((current) => ({ ...current, more: false, result: 'busy' }))
    })
  }, [article.url, article.title, state.status, state.cursor, state.more])

  // Reaching the end of the list reads further back (not while the archive is resting).
  useEffect(() => {
    const target = sentinel.current
    if (!target || state.result === 'busy') return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || unasked.current >= 2) return
      unasked.current += 1
      loadMore()
    }, { root: root.current, rootMargin: '120px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [loadMore, state.result])

  // Scrolling is asking for more.
  useEffect(() => {
    const scroller = root.current
    if (!scroller) return
    const onScroll = (): void => { unasked.current = 0 }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])

  const storyCount = state.items.filter((item) => item.story).length
  const onlyStory = storyOnly ?? storyCount >= 4
  const months = useMemo(() => {
    const groups = new Map<string, OldsCoverageItem[]>()
    for (const item of state.items) {
      if (onlyStory && !item.story) continue
      const month = item.date.slice(0, 7)
      const group = groups.get(month)
      if (group) group.push(item)
      else groups.set(month, [item])
    }
    return [...groups.entries()]
  }, [state.items, onlyStory])
  const outlet = state.outlet ?? article.publisher ?? 'This outlet'

  return (
    <div ref={root} className="olds-coverage" aria-busy={state.status === 'loading' || state.more}>
      <div className="olds-coverage-head">
        <p>
          How <strong>{outlet}</strong> covered this before
          {state.topics.length > 0 && <> · from its {state.topics.map((topic) => <button key={topic.url} type="button" className="olds-coverage-topic" onClick={() => onOpen(topic.url)}>{topic.label}</button>)} {state.topics.length > 1 ? 'pages' : 'page'}</>}
        </p>
        {state.items.length > 0 && storyCount > 0 && storyCount < state.items.length && (
          <div className="olds-views olds-coverage-filter" role="radiogroup" aria-label="Which headlines">
            <button type="button" role="radio" aria-checked={onlyStory} className={onlyStory ? 'is-active' : ''} onClick={() => setStoryOnly(true)}>This story ({storyCount})</button>
            <button type="button" role="radio" aria-checked={!onlyStory} className={!onlyStory ? 'is-active' : ''} onClick={() => setStoryOnly(false)}>All on the topic ({state.items.length})</button>
          </div>
        )}
      </div>

      {state.status === 'loading' && <p className="olds-coverage-note"><Loader2 size={14} className="olds-spin" aria-hidden="true" /> Reading {outlet}’s topic pages…</p>}
      {state.status === 'error' && <p className="olds-coverage-note" role="alert">Could not read {outlet}’s earlier coverage. Check your connection and try again. <button type="button" onClick={() => setAttempt((count) => count + 1)}>Try again</button></p>}
      {state.status === 'ready' && state.result === 'ok' && !state.items.length && !state.cursor && <p className="olds-coverage-note">No earlier headlines were found on {outlet}’s {state.topics.length > 1 ? 'topic pages' : 'topic page'}.</p>}
      {state.status === 'ready' && state.result === 'no-topics' && <p className="olds-coverage-note">{outlet} did not file this story under a topic page, so there is no earlier coverage to follow.</p>}
      {state.status === 'ready' && state.result === 'blocked' && <p className="olds-coverage-note">{outlet} has asked the Internet Archive not to list its pages, so earlier coverage is not shown.</p>}
      {state.status === 'ready' && state.result === 'unsupported' && <p className="olds-coverage-note">Earlier coverage is not available for this outlet yet.</p>}

      {state.status === 'ready' && (state.items.length > 0 || state.cursor) && (
        <ol className="olds-coverage-list">
          <li className="olds-coverage-now">
            <span className="olds-coverage-when">Now</span>
            <button type="button" className="olds-coverage-title" onClick={() => onOpen(article.url)}>{article.title}</button>
          </li>
          {months.map(([month, items]) => (
            <li key={month} className="olds-coverage-month">
              <h3>{MONTH.format(at(`${month}-01`))}</h3>
              <ul>
                {items.map((item) => (
                  <li key={item.url} className={item.story ? 'is-story' : ''}>
                    <span className="olds-coverage-when" title={item.dated === 'seen' ? `Listed on ${outlet}’s topic page by this date` : 'Published'}>
                      {item.dated === 'seen' ? 'by ' : ''}{DAY.format(at(item.date))}
                    </span>
                    <button type="button" className="olds-coverage-title" onClick={() => onOpen(item.archiveUrl ?? item.url)} title="Open the Wayback Machine’s copy">
                      {item.title}
                    </button>
                    <button type="button" className="lg-icon-button olds-coverage-live" aria-label={`Open “${item.title}” on ${outlet}`} title={`Open on ${outlet}`} onClick={() => onOpen(item.url)}>
                      <ExternalLink size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
          <li ref={sentinel} className="olds-coverage-end">
            {state.more ? <><Loader2 size={14} className="olds-spin" aria-hidden="true" /> Going further back…</>
              : state.result === 'busy' ? <>The Internet Archive is busy or could not be reached. <button type="button" onClick={() => { setState((current) => ({ ...current, result: 'ok' })); loadMore() }}>Try again</button></>
                : state.cursor ? <button type="button" onClick={() => { unasked.current = 0; loadMore() }}>Go further back</button>
                  : state.items.length ? 'The start of the archive for this topic.' : 'No earlier headlines were found.'}
          </li>
        </ol>
      )}

      <p className="olds-coverage-credit">
        <Archive size={12} aria-hidden="true" /> Snapshots from the Internet Archive’s Wayback Machine.{' '}
        <button type="button" onClick={() => onOpen('https://archive.org/donate')}>Support the Internet Archive</button>
      </p>
    </div>
  )
}
