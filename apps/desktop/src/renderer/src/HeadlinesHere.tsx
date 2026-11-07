import { Newspaper } from 'lucide-react'
import { useState } from 'react'
import type { AnchorHeadlines } from '../../shared/news/anchorHeadlines'

/** Remembered per workspace (the parent keys this by workspace), so a collapsed section stays collapsed. */
const collapsedKey = (workspaceId: string): string => `intoponet.headlinesHere.collapsed.${workspaceId}`

/**
 * "Headlines here": the latest headlines for the shown workspace's anchored place. A click opens
 * the headline as a tab in that workspace (it is the one shown). Nothing shows without headlines.
 */
export function HeadlinesHere({ workspaceId, workspaceName, news, open, onOpen }: {
  workspaceId: string
  workspaceName: string
  news: AnchorHeadlines | null
  /** The sidebar shows titles (expanded or kept open). */
  open: boolean
  onOpen: (url: string) => void
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(collapsedKey(workspaceId)) === '1'
    } catch {
      return false
    }
  })
  if (!news || news.headlines.length === 0) return null
  const toggle = (): void => {
    const next = !collapsed
    setCollapsed(next)
    try {
      window.localStorage.setItem(collapsedKey(workspaceId), next ? '1' : '0')
    } catch {
      // Remembering the section is a convenience only.
    }
  }
  return (
    <section className="tab-rail-headlines" aria-label={`Headlines here, ${workspaceName}`}>
      <button type="button" className="tab-rail-headlines-head" aria-expanded={!collapsed} onClick={toggle} title={`Headlines here: ${news.name}`}>
        <Newspaper size={13} aria-hidden="true" />
        <span className="tab-rail-title" aria-hidden={!open}>Headlines here</span>
        <small className="tab-rail-title" aria-hidden={!open}>{news.name}</small>
      </button>
      {!collapsed && (
        <ul className="tab-rail-headlines-list">
          {news.headlines.map((headline) => (
            <li key={headline.url}>
              <button type="button" className="tab-rail-headline" aria-label={`${headline.title}, ${headline.publisher}`} title={headline.title} onClick={() => onOpen(headline.url)}>
                <span className="tab-rail-title" aria-hidden={!open}>{headline.title}</span>
                <small className="tab-rail-title" aria-hidden={!open}>{headline.publisher}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
