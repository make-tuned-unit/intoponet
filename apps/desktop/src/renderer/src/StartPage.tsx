import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Bookmark, Clock3, EyeOff, Globe2, Newspaper, Search, TrendingUp } from 'lucide-react'
import { useFavicon } from './favicons'
import type { StartRising, StartStory, StartTile, StartWikiItem } from './startPageModel'
import './startPage.css'

type StartPageProps = {
  /** Changes on every new start page, so the search box takes focus each time. */
  tabId: string
  bookmarks: StartTile[]
  recents: StartTile[]
  news: { stories: StartStory[]; rising: StartRising[]; inTheNews: StartWikiItem[] }
  newsLoaded: boolean
  isPrivate: boolean
  /** Search or address typed in the box: opens in this tab. */
  onSubmit: (value: string) => Promise<void>
  onOpen: (url: string) => void
}

function Tile({ tile, onOpen }: { tile: StartTile; onOpen: (url: string) => void }) {
  const icon = useFavicon(tile.url)
  return (
    <button type="button" className="start-tile" title={`${tile.title}\n${tile.url}`} onClick={() => onOpen(tile.url)}>
      <span className="start-tile-icon" aria-hidden="true">
        {icon ? <img src={icon} alt="" width={22} height={22} /> : <span>{(tile.host[0] ?? '?').toUpperCase()}</span>}
      </span>
      <span className="start-tile-title">{tile.title}</span>
    </button>
  )
}

function RecentRow({ tile, onOpen }: { tile: StartTile; onOpen: (url: string) => void }) {
  const icon = useFavicon(tile.url)
  return (
    <li>
      <button type="button" className="start-row" title={tile.url} onClick={() => onOpen(tile.url)}>
        <span className="start-row-icon" aria-hidden="true">{icon ? <img src={icon} alt="" width={16} height={16} /> : <Globe2 size={14} />}</span>
        <span className="start-row-text">
          <strong>{tile.title}</strong>
          <small>{tile.host}</small>
        </span>
      </button>
    </li>
  )
}

/** A new tab's start page: search, bookmarks, recent reads and the news digest, all from this Mac. */
export function StartPage({ tabId, bookmarks, recents, news, newsLoaded, isPrivate, onSubmit, onOpen }: StartPageProps) {
  const [draft, setDraft] = useState('')
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft('')
    // Not from a new workspace's name field: its start page can arrive after the field has asked for the name.
    const frame = requestAnimationFrame(() => { if (!document.activeElement?.closest('.tab-rail-workspace-editor')) search.current?.focus() })
    return () => cancelAnimationFrame(frame)
  }, [tabId])

  const hasNews = news.stories.length > 0 || news.rising.length > 0 || news.inTheNews.length > 0

  return (
    <div className="start-page" role="region" aria-label="New tab">
      <div className="start-inner">
        <form
          className="start-search lg-inset"
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
            const value = draft.trim()
            if (!value) return
            void onSubmit(value).catch(() => undefined)
          }}
        >
          <Search size={17} aria-hidden="true" />
          <label className="start-search-field">
            <span className="sr-only">Search the web or enter an address</span>
            <input
              ref={search}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={isPrivate ? 'Search privately or enter an address' : 'Search the web or enter an address'}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button type="submit" className="start-search-go" aria-label="Go" disabled={!draft.trim()}>
            <ArrowRight size={16} />
          </button>
        </form>
        {isPrivate && (
          <p className="start-private"><EyeOff size={13} aria-hidden="true" /> Private tab: nothing you do here is remembered.</p>
        )}

        <section className="start-section" aria-labelledby="start-bookmarks">
          <h2 id="start-bookmarks"><Bookmark size={13} aria-hidden="true" /> Bookmarks</h2>
          {bookmarks.length > 0 ? (
            <div className="start-tiles">
              {bookmarks.map((tile) => <Tile key={tile.url} tile={tile} onOpen={onOpen} />)}
            </div>
          ) : (
            <p className="start-empty">No bookmarks yet. Save a page with ⌘D and it will show up here.</p>
          )}
        </section>

        <div className="start-columns">
          {!isPrivate && (
            <section className="start-section" aria-labelledby="start-recents">
              <h2 id="start-recents"><Clock3 size={13} aria-hidden="true" /> Recent reads</h2>
              {recents.length > 0 ? (
                <ul className="start-list">
                  {recents.map((tile) => <RecentRow key={tile.url} tile={tile} onOpen={onOpen} />)}
                </ul>
              ) : (
                <p className="start-empty">Nothing read recently. Pages you open will appear here, and stay on this Mac.</p>
              )}
            </section>
          )}

          <section className="start-section" aria-labelledby="start-news">
            <h2 id="start-news"><Newspaper size={13} aria-hidden="true" /> In the news</h2>
            {!hasNews ? (
              <p className="start-empty">{newsLoaded ? 'No stories in the news digest right now.' : 'The news digest is still loading.'}</p>
            ) : (
              <>
                {news.stories.length > 0 && (
                  <ul className="start-list">
                    {news.stories.map((story) => (
                      <li key={story.url}>
                        <button type="button" className="start-row start-story" title={story.url} onClick={() => onOpen(story.url)}>
                          <span className="start-row-text">
                            <strong>{story.title}</strong>
                            <small>{story.publisher} · {story.detail}</small>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {news.rising.length > 0 && (
                  <div className="start-rising" aria-label="Rising in the news">
                    <TrendingUp size={13} aria-hidden="true" />
                    {news.rising.map((term) => (
                      <button
                        key={term.term}
                        type="button"
                        className="start-chip"
                        disabled={!term.url}
                        title={term.url ? `Open a story about ${term.term}` : term.term}
                        onClick={() => term.url && onOpen(term.url)}
                      >
                        {term.term}
                      </button>
                    ))}
                  </div>
                )}
                {news.inTheNews.length > 0 && <p className="start-subhead">From Wikipedia's In the news</p>}
                {news.inTheNews.length > 0 && (
                  <ul className="start-list start-wiki">
                    {news.inTheNews.map((item) => (
                      <li key={item.story}>
                        <button type="button" className="start-row" disabled={!item.url} title={item.title ? `Wikipedia: ${item.title}` : undefined} onClick={() => item.url && onOpen(item.url)}>
                          <span className="start-row-text"><span>{item.story}</span></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
