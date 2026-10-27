import { useMemo } from 'react'
import { ExternalLink, Lock, Search, X } from 'lucide-react'
import { alternativeCoverage, storyTitle, type Candidate } from '../../../shared/news/paywall'
import { learnedPaywalls } from './learnedPaywalls'
import './access.css'

const regionNames = (() => {
  try {
    return new Intl.DisplayNames([navigator.language, 'en'], { type: 'region' })
  } catch {
    return null
  }
})()

/**
 * Shown when the open article is paywalled: the same story from other
 * outlets (free ones first), from the headlines Intoponet already follows,
 * plus a search for more coverage. It never tries to open the paywall itself.
 */
export function FreeCoverageBar({
  title,
  url,
  candidates,
  signals,
  onOpen,
  onSearch,
  onClose,
}: {
  title: string
  url: string
  candidates: Candidate[]
  signals: string[]
  onOpen: (url: string) => void
  onSearch: (query: string) => void
  onClose: () => void
}) {
  const alternatives = useMemo(() => alternativeCoverage(title, url, candidates, learnedPaywalls()), [title, url, candidates])
  const story = storyTitle(title)
  return (
    <div className="free-coverage" role="region" aria-label="Free coverage of this story">
      <div className="fc-head">
        <Lock size={13} aria-hidden="true" />
        <span title={signals.length ? `The publisher marks this article as restricted (${signals.join(', ')}).` : 'This outlet usually restricts articles to subscribers.'}>
          This article looks paywalled. {alternatives.some((item) => !item.paywalled) ? 'Free coverage of the same story:' : alternatives.length ? 'Other coverage of the same story:' : 'No other coverage in the feeds Intoponet follows yet.'}
        </span>
        <span className="fc-spacer" />
        <button type="button" className="fc-search" onClick={() => onSearch(story)} title={`Search the web for “${story}” to find other outlets`}>
          <Search size={12} aria-hidden="true" /> Find other outlets
        </button>
        <button type="button" className="fc-close" aria-label="Hide free coverage" onClick={onClose}><X size={13} /></button>
      </div>
      {alternatives.length > 0 && (
        <ul className="fc-list">
          {alternatives.map((item) => (
            <li key={item.url}>
              <button type="button" onClick={() => onOpen(item.url)} title={item.url}>
                <strong>{item.title}</strong>
                <small>
                  {item.publisher}{item.countryCode ? ` · ${regionNames?.of(item.countryCode) ?? item.countryCode}` : ''}
                  {item.paywalled ? <> · <Lock size={10} aria-label="may be paywalled" /> may be paywalled</> : ' · free to read'}
                </small>
                <ExternalLink size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
