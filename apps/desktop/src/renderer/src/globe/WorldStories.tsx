import { useMemo, useState } from 'react'
import { BookOpen, ChevronDown, GalleryHorizontal, Globe2, History } from 'lucide-react'
import type { GlobalStory } from '../../../shared/news/globalStories'
import type { NewsHeadline, WikiNewsItem } from '../../../shared/news/newsDigest'
import { HeadlineList } from '../translate/HeadlineList'
import { useTranslatedTitles } from '../translate/useTranslatedTitles'
import type { TranslateModel } from '../translate/useTranslate'
import { relativeTime } from './globeSignals'
import { hostIsPaywalled } from '../../../shared/news/paywall'
import { learnedPaywalls } from '../access/learnedPaywalls'
import { SourceCarousel, type CarouselLaunch } from './SourceCarousel'
import './sourceCarousel.css'

const regionNames = (() => {
  try {
    return new Intl.DisplayNames([navigator.language, 'en'], { type: 'region' })
  } catch {
    return null
  }
})()
const countryName = (code: string): string => regionNames?.of(code) ?? code

/**
 * Stories covered across the world right now: the same story in headlines
 * from many countries' outlets at once, and Wikipedia's editor-curated
 * "In the news". Breadth of coverage, not importance.
 */
export function WorldStories({
  stories,
  inTheNews,
  now,
  focusedId,
  onFocus,
  onOpen,
  onHistory,
  onArticleHistory,
  translation,
}: {
  stories: GlobalStory[]
  inTheNews: WikiNewsItem[]
  now: number
  focusedId: string | null
  /** Highlight a story's countries on the globe (null clears). */
  onFocus: (story: GlobalStory | null) => void
  onOpen: (url: string) => void
  onHistory: (headline: NewsHeadline, englishText: string | null) => void
  onArticleHistory: (title: string) => void
  translation?: TranslateModel | undefined
}) {
  const [expanded, setExpanded] = useState<string | null>(focusedId)
  const [carousel, setCarousel] = useState<CarouselLaunch | null>(null)
  // Story titles in your language (same Original ↔ English choice as the headlines inside).
  const titleItems = useMemo(() => stories.map((story) => ({ key: story.id, title: story.title, lang: story.headlines.find((item) => item.url === story.url)?.lang ?? null })), [stories])
  const titles = useTranslatedTitles(titleItems, translation)
  const toggle = (story: GlobalStory): void => {
    const next = expanded === story.id ? null : story.id
    setExpanded(next)
    onFocus(next ? story : null)
    // Opening a story also opens its article, so the reader can go straight to the source.
    if (next) onOpen(story.url)
  }
  return (
    <div className="world-stories">
      {carousel && (
        <SourceCarousel
          launch={carousel}
          now={now}
          translation={translation}
          countryName={countryName}
          onRead={onOpen}
          onClose={() => setCarousel(null)}
        />
      )}
      {stories.length > 0 ? (
        <section aria-label="Covered across the world">
          <h3 title="The same story in headlines from at least 3 countries or international desks and 3 independent outlets in the last 24 hours, across 450 local outlets in 200+ countries and 31 international desks. Ranked by countries whose own outlets covered it, then desks. Breadth of coverage, not importance or truth.">
            <Globe2 size={12} aria-hidden="true" /> Covered across the world
          </h3>
          <ol className="world-list">
            {stories.map((story, index) => {
              const open = expanded === story.id
              const shown = titles.get(story.id)
              return (
                <li key={story.id} className={open ? 'is-open' : ''}>
                  <button
                    type="button"
                    className="world-row"
                    aria-expanded={open}
                    onClick={() => toggle(story)}
                    title={`Open the article and see where it was covered. Local outlets in ${story.countries.length} countries${story.internationalDesks ? ` and ${story.internationalDesks} international desks` : ''} covered it (${story.outletCount} outlets in all). Shared words: ${story.terms.join(', ')}.`}
                  >
                    <span className="world-rank">{index + 1}</span>
                    <span className="world-text">
                      <strong title={shown ? `Original: ${story.title}` : undefined}>{shown ?? story.title}</strong>
                      <small>
                        <em>{story.countries.length} {story.countries.length === 1 ? 'country' : 'countries'}</em>{story.internationalDesks ? ` · ${story.internationalDesks} international desk${story.internationalDesks === 1 ? '' : 's'}` : ''} · {relativeTime(story.latestAt, now)}
                      </small>
                      <span className="world-flags" aria-label={`Countries: ${story.countries.map(countryName).join(', ')}`}>
                        {story.countries.slice(0, 7).map((code) => <span key={code} title={countryName(code)}>{code}</span>)}
                        {story.countries.length > 7 && <span className="more">+{story.countries.length - 7}</span>}
                      </span>
                    </span>
                    <ChevronDown size={14} className="world-chevron" aria-hidden="true" />
                  </button>
                  {open && (
                    <div className="world-detail">
                      <div className="world-actions">
                        {story.headlines.length >= 3 && (
                          <button
                            type="button"
                            className="globe-history-button world-sources-button"
                            onClick={(event) => setCarousel({ story, from: event.currentTarget.getBoundingClientRect() })}
                            title="Flip through how each outlet is covering this story"
                          >
                            <GalleryHorizontal size={13} aria-hidden="true" /> See all {story.headlines.length} sources
                          </button>
                        )}
                        <button
                          type="button"
                          className="globe-history-button"
                          onClick={() => onHistory({ title: story.title, url: story.url, publisher: story.publisher, publishedAt: story.latestAt, lang: story.headlines.find((item) => item.url === story.url)?.lang ?? 'en' }, shown ?? (/^en/i.test(story.headlines.find((item) => item.url === story.url)?.lang ?? 'en') ? story.title : null))}
                        >
                          <History size={13} aria-hidden="true" /> The history behind it
                        </button>
                        <small>Highlighted on the globe: countries whose outlets covered it.</small>
                      </div>
                      <HeadlineList
                        className="globe-headlines-plain world-headlines"
                        headlines={[...story.headlines].sort((a, b) => Number(hostIsPaywalled(a.url, learnedPaywalls())) - Number(hostIsPaywalled(b.url, learnedPaywalls())))}
                        now={now}
                        onOpen={onOpen}
                        translation={translation}
                        onHistory={onHistory}
                        detail={(headline) => {
                          const match = story.headlines.find((item) => item.url === headline.url)
                          return `${headline.publisher}${match ? ` · ${match.international ? 'international desk' : countryName(match.countryCode)}` : ''} · ${relativeTime(headline.publishedAt, now)}`
                        }}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      ) : (
        <p className="globe-empty">No story is yet covered across several countries. This needs a few hours of headlines from many outlets.</p>
      )}
      {inTheNews.length > 0 && (
        <section className="world-itn" aria-label="Wikipedia In the news">
          <h3 title="A short list of major current stories chosen by Wikipedia's editors (CC BY-SA 4.0).">
            <BookOpen size={12} aria-hidden="true" /> Wikipedia · In the news
          </h3>
          <ul>
            {inTheNews.map((item) => (
              <li key={item.story}>
                <p>{item.date && <em>{item.date}</em>}{item.story}</p>
                <span>
                  {item.links[0] && <button type="button" onClick={() => onOpen(item.links[0]!.url)}>Read</button>}
                  {item.mainTitle && (
                    <button type="button" className="world-itn-history" onClick={() => onArticleHistory(item.mainTitle!)}>
                      <History size={11} aria-hidden="true" /> History
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
