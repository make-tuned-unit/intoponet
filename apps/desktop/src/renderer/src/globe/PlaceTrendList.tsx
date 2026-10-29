import { useState } from 'react'
import { ChevronDown, TrendingDown, TrendingUp } from 'lucide-react'
import type { PlaceTrends } from '../../../shared/news/placeTrends'
import type { NewsHeadline } from '../../../shared/news/newsDigest'
import { HeadlineList } from '../translate/HeadlineList'
import type { TranslateModel } from '../translate/useTranslate'

export type PlaceTrendState = { label: string; status: 'loading' | 'ready'; data: PlaceTrends | null }

/**
 * What is rising or fading in one place's own news: the words and names its
 * stories used more (or less) today than yesterday, from the same feeds on
 * both days. Open a word to read the headlines behind it.
 */
export function PlaceTrendList({ state, direction, now, onOpen, translation, onHistory }: {
  state: PlaceTrendState
  direction: 'rising' | 'fading'
  now: number
  onOpen: (url: string) => void
  translation?: TranslateModel | undefined
  onHistory?: ((headline: NewsHeadline, englishText: string | null) => void) | undefined
}) {
  const [open, setOpen] = useState<string | null>(null)
  const trends = state.data ? state.data[direction] : []
  const fallback = state.data ? (direction === 'rising' ? state.data.latest : state.data.earlier) ?? [] : []
  const Icon = direction === 'rising' ? TrendingUp : TrendingDown
  return (
    <section className={`place-trends is-${direction}`} aria-label={`${direction === 'rising' ? 'Rising' : 'Fading'} in ${state.label}`}>
      <h3><Icon size={12} aria-hidden="true" /> {direction === 'rising' ? 'Rising' : 'Fading'} in {state.label}</h3>
      {state.status === 'loading' ? (
        <p className="place-trends-note">Comparing today’s news with yesterday’s…</p>
      ) : !state.data || (!state.data.recentStories && !state.data.previousStories && !state.data.uncompared) ? (
        <p className="place-trends-note">No local news from {state.label} in the last two days.</p>
      ) : (
        <>
          <p className="place-trends-note">
            {state.data.recentStories || state.data.previousStories
              ? <>{state.data.recentStories} {state.data.recentStories === 1 ? 'story' : 'stories'} in the last 24 h, {state.data.previousStories} the day before, from feeds watched on both days.</>
              : <>Its feeds need about two days of successful polling before a fair comparison is possible.</>}
            {state.data.uncompared > 0 && <> {state.data.uncompared} more {state.data.uncompared === 1 ? 'story' : 'stories'} shown but not compared.</>}
          </p>
          {trends.length > 0 ? (
            <ol>
              {trends.map((trend) => {
                const expanded = open === trend.term
                const change = trend.recent - trend.previous
                return (
                  <li key={trend.term} className={expanded ? 'is-open' : ''}>
                    <button type="button" className="place-trend" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : trend.term)}>
                      <span className="place-trend-term">{trend.term}</span>
                      <span className="place-trend-change" title={`${trend.recent} stories in the last 24 h, ${trend.previous} the day before`}>{change > 0 ? `+${change}` : change}</span>
                      <small>{trend.recent} today · {trend.previous} yesterday</small>
                      <ChevronDown size={13} className="place-trend-chevron" aria-hidden="true" />
                    </button>
                    {expanded && (
                      <HeadlineList className="globe-headlines-plain place-trend-headlines" headlines={trend.headlines} now={now} onOpen={onOpen} translation={translation} onHistory={onHistory} />
                    )}
                  </li>
                )
              })}
            </ol>
          ) : fallback.length > 0 ? (
            <>
              <p className="place-trends-note">Nothing is clearly {direction} yet. {direction === 'rising' ? `Today’s news from ${state.label}:` : `Yesterday’s news from ${state.label}:`}</p>
              <HeadlineList className="globe-headlines-plain place-trend-headlines" headlines={fallback} now={now} onOpen={onOpen} translation={translation} onHistory={onHistory} />
            </>
          ) : (
            <p className="place-trends-note">Nothing is clearly {direction} here yet.</p>
          )}
        </>
      )}
    </section>
  )
}
