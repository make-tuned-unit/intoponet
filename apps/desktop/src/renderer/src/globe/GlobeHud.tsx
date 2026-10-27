import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'
import { Activity, ArrowDownRight, ArrowLeft, ArrowUpRight, BookmarkPlus, BookOpen, ChevronRight, ExternalLink, Flame, History, Info, MapPin, Moon, Navigation, Newspaper, Satellite, Sparkles, Sun, X } from 'lucide-react'
import type { NewsHeadline, RisingTerm, WikiNewsItem } from '../../../shared/news/newsDigest'
import { dayPhase, dayPhaseText } from '../earth/sun'
import { BiggerPicture } from './BiggerPicture'
import { WorldStories } from './WorldStories'
import type { GlobalStory } from '../../../shared/news/globalStories'
import type { OldsNode } from '@intoponet/browser-api'
import { HeadlineList } from '../translate/HeadlineList'
import type { TranslateModel } from '../translate/useTranslate'
import { useRef, useState, type ReactNode } from 'react'
import { useGlassSheen } from '../glass/useGlassSheen'
import '../glass/glass.css'
import './globe.css'
import {
  GLOBE_LAYER_ORDER,
  GLOBE_LAYERS,
  PIN_COLOR,
  relativeTime,
  trendOf,
  type GlobeLayerId,
  type GlobeSignal,
  type GlobeWindow,
} from './globeSignals'

const spring: Transition = { type: 'spring', stiffness: 420, damping: 36 }
/** Links that open a readable page. Some sources are raw data files (e.g. a hurricane centre's .tcw advisory), which would only download. */
const DATA_FILE = /\.(tcw|txt|json|xml|kml|kmz|zip|dat|csv|shp|gz|nc|grib2?)(\?|$)/i
export function readableLinks(signal: GlobeSignal): Array<{ label: string; url: string; title: string }> {
  if (signal.layer === 'natural') {
    const day = signal.observedAt.slice(0, 10)
    const box = [signal.lon - 8, signal.lat - 6, signal.lon + 8, signal.lat + 6].map((value) => value.toFixed(2)).join(',')
    return [
      { label: 'Read about it', url: `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(signal.title)}`, title: `Wikipedia on ${signal.title} (opens the article if one exists, otherwise search results)` },
      { label: 'Satellite view', url: `https://worldview.earthdata.nasa.gov/?v=${box}&t=${day}`, title: `NASA Worldview satellite imagery of this area on ${day}` },
    ]
  }
  if (DATA_FILE.test(signal.url)) {
    return [{ label: 'Read about it', url: `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(signal.title)}`, title: 'The source is a data file, so this opens Wikipedia instead' }]
  }
  return [{ label: 'Open source', url: signal.url, title: signal.url }]
}

/** What the layer card shows: earthquakes and NASA's natural events are one "Natural hazards" group. */
const LAYER_GROUPS: Array<{ id: string; layers: GlobeLayerId[]; label: string; source: string; color: string; icon: ReactNode; peak: string }> = [
  { id: 'news', layers: ['news'], label: 'Local news', source: 'Each country’s own outlets', color: GLOBE_LAYERS.news.color, icon: <Newspaper size={14} />, peak: 'stories per outlet, last 48 h' },
  { id: 'reading', layers: ['reading'], label: 'Reading now', source: 'Wikipedia most-read', color: GLOBE_LAYERS.reading.color, icon: <BookOpen size={14} />, peak: 'reads of the place’s article yesterday' },
  { id: 'hazards', layers: ['natural', 'quakes'], label: 'Natural hazards', source: 'Storms, fires, floods · quakes', color: GLOBE_LAYERS.natural.color, icon: <Flame size={14} />, peak: 'event size (NASA) or quake magnitude (USGS)' },
]

/** A peak's height inside its own layer, 0–100 (the layer's lowest item is 0, its highest 100). */
export function peakScore(signal: Pick<GlobeSignal, 'intensity'>): number {
  return Math.round(Math.max(0, Math.min(1, (signal.intensity - 0.3) / 0.7)) * 100)
}

/** Five bars, filled by peak height. */
export function PeakMeter({ score, color }: { score: number; color: string }) {
  const filled = Math.max(1, Math.ceil(score / 20))
  return (
    <span className="peak-meter" style={{ ['--layer-color' as string]: color }} aria-label={`Peak ${score} of 100`} title={`Peak ${score} of 100 within its layer`}>
      {[0, 1, 2, 3, 4].map((index) => <i key={index} className={index < filled ? 'is-on' : ''} style={{ height: `${4 + index * 2.5}px` }} />)}
    </span>
  )
}

/** Why an item peaks, in plain words, with its place in its layer. */
export function whyItPeaks(signal: GlobeSignal, peers: GlobeSignal[]): string {
  const same = peers.filter((peer) => peer.layer === signal.layer && (signal.layer !== 'news' || peer.id.startsWith('news:country:') === signal.id.startsWith('news:country:')))
  const position = [...same].sort((a, b) => b.intensity - a.intensity).findIndex((peer) => peer.id === signal.id) + 1
  const of = position > 0 ? ` #${position} of ${same.length}` : ''
  switch (signal.layer) {
    case 'news':
      return signal.id.startsWith('news:country:')
        ? `Its own outlets published ${signal.measurement.replace(' · ', ' from ')} in 48 hours — measured per outlet, so countries with more feeds don't win by default.${of} countries. This is how busy local newsrooms are, not how much the world is talking about it.`
        : `Named in ${signal.measurement} by local outlets in 48 hours.${of} named places.`
    case 'reading':
      return `${signal.measurement} on English Wikipedia.${of} mapped most-read articles. Real reader attention, though one viral link or bots can spike it.`
    case 'quakes':
      return `${signal.measurement}.${of} earthquakes of magnitude 4.5+ this week. It peaks by physical size, not by news coverage.`
    case 'natural':
      return `An open ${signal.kind.toLowerCase()} tracked by NASA's Earth Observatory, ranked by its reported size.${of} open events.`
  }
}

const layerIcon: Record<GlobeLayerId, ReactNode> = {
  news: <Newspaper size={14} />,
  reading: <BookOpen size={14} />,
  quakes: <Activity size={14} />,
  natural: <Flame size={14} />,
}

export type FieldView = 'public' | 'personal'
export type ListView = 'world' | 'top' | 'rising' | 'fading'

export function GlobeHeader({
  title,
  eyebrow,
  stale,
  summary,
  trail,
  onEarth,
}: {
  title: string
  eyebrow: string
  stale: boolean
  summary: string
  /** Breadcrumb beyond Earth, e.g. ["Japan", "Tokyo"]. */
  trail: string[]
  onEarth: () => void
}) {
  return (
    <section className="globe-header" aria-labelledby="field-title">
      <nav className="globe-trail" aria-label="Place">
        <button type="button" onClick={onEarth} aria-current={trail.length === 0 ? 'true' : undefined}>Earth</button>
        {trail.map((step, index) => (
          <span key={`${step}-${index}`}>
            <ChevronRight size={12} aria-hidden="true" />
            <span aria-current={index === trail.length - 1 ? 'true' : undefined}>{step}</span>
          </span>
        ))}
      </nav>
      <AnimatePresence mode="wait" initial={false}>
        <motion.h1
          key={title}
          id="field-title"
          initial={{ opacity: 0, y: 8, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          {title}
        </motion.h1>
      </AnimatePresence>
      <p className={`globe-eyebrow${stale ? ' is-stale' : ''}`}>
        <span className="globe-live-dot" aria-hidden="true" />
        {eyebrow}
      </p>
      <p className="globe-summary">{summary}</p>
    </section>
  )
}

export function LayerCard({
  view,
  onViewChange,
  layers,
  counts,
  onToggleLayer: _onToggleLayer,
  onSetLayers,
  window: timeWindow,
  onWindowChange,
  pinsVisible,
  pinCount,
  onTogglePins,
  dayNight,
  onToggleDayNight,
  coverageNote,
  placesAttribution,
  personal,
}: {
  view: FieldView
  onViewChange: (view: FieldView) => void
  layers: ReadonlySet<GlobeLayerId>
  counts: Record<GlobeLayerId, number>
  onToggleLayer: (layer: GlobeLayerId) => void
  onSetLayers: (layers: GlobeLayerId[], on: boolean) => void
  window: GlobeWindow
  onWindowChange: (window: GlobeWindow) => void
  pinsVisible: boolean
  pinCount: number
  onTogglePins: () => void
  dayNight: boolean
  onToggleDayNight: () => void
  coverageNote: string
  placesAttribution: string
  personal: ReactNode
}) {
  const sheen = useGlassSheen<HTMLDivElement>()
  const [aboutOpen, setAboutOpen] = useState(false)
  // Compact by default: three layer icons. Hover or keyboard focus opens the full card.
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const expand = (): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpen(true)
  }
  const collapse = (): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), 280)
  }
  void pinsVisible; void pinCount; void onTogglePins; void dayNight; void onToggleDayNight
  return (
    <aside
      ref={sheen}
      className={`globe-layers lg-surface lg-sheen${open || aboutOpen ? '' : ' is-compact'}`}
      aria-label="Field layers"
      onPointerEnter={expand}
      onPointerLeave={collapse}
      onFocus={expand}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) collapse() }}
    >
      {!(open || aboutOpen) ? (
        <ul className="globe-compact" aria-label="Layers (hover to expand)">
          {view === 'public' ? LAYER_GROUPS.map((group) => {
            const on = group.layers.some((layer) => layers.has(layer))
            return (
              <li key={group.id}>
                <button
                  type="button"
                  className={`globe-compact-icon${on ? ' is-on' : ''}`}
                  style={{ ['--layer-color' as string]: group.color }}
                  aria-pressed={on}
                  aria-label={`${group.label}: ${on ? 'shown' : 'hidden'}. ${group.layers.reduce((sum, layer) => sum + counts[layer], 0)} items. Hover for details.`}
                  onClick={() => onSetLayers(group.layers, !on)}
                >
                  {group.icon}
                </button>
              </li>
            )
          }) : (
            <li>
              <button type="button" className="globe-compact-icon is-on" style={{ ['--layer-color' as string]: PIN_COLOR }} aria-label="My Earth (hover for details)" onClick={expand}>
                <MapPin size={14} />
              </button>
            </li>
          )}
        </ul>
      ) : (
      <>
      <div className="globe-segment" role="radiogroup" aria-label="Field">
        {(['public', 'personal'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={view === option}
            className={view === option ? 'is-active' : ''}
            onClick={() => onViewChange(option)}
          >
            {view === option && <motion.span layoutId="globe-segment" className="globe-segment-thumb" transition={spring} aria-hidden="true" />}
            <span>{option === 'public' ? 'Public' : 'Mine'}</span>
          </button>
        ))}
      </div>

      {view === 'public' ? (
        <>
          <ul className="globe-layer-list">
            {LAYER_GROUPS.map((group) => {
              const on = group.layers.some((layer) => layers.has(layer))
              return (
                <li key={group.id}>
                  <button
                    type="button"
                    className={`globe-layer${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    style={{ ['--layer-color' as string]: group.color }}
                    title={`Peaks by ${group.peak}.`}
                    onClick={() => onSetLayers(group.layers, !on)}
                  >
                    <span className="globe-layer-icon" aria-hidden="true">{group.icon}</span>
                    <span className="globe-layer-text">
                      <strong>{group.label}</strong>
                      <small>{group.source}</small>
                    </span>
                    <span className="globe-layer-count">{group.layers.reduce((sum, layer) => sum + counts[layer], 0)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="peak-legend" aria-label="How to read peaks">
            <div className="peak-legend-scale" aria-hidden="true">
              <span className="peak-sample is-low" />
              <span className="peak-sample is-mid" />
              <span className="peak-sample is-high" />
              <span className="peak-legend-bar" />
            </div>
            <div className="peak-legend-labels"><small>Lower peak</small><small>Higher peak</small></div>
            <p>Brighter markers with more rings peak higher <em>within their own layer</em>. Colour shows the layer:</p>
            <ul>
              {LAYER_GROUPS.map((group) => (
                <li key={group.id} style={{ ['--layer-color' as string]: group.color }}>
                  {group.layers.map((layer) => <i key={layer} aria-hidden="true" style={{ ['--layer-color' as string]: GLOBE_LAYERS[layer].color }} />)}
                  <span><strong>{group.label}</strong> · {group.peak}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="globe-window" role="radiogroup" aria-label="Time window">
            {(['24h', '7d', '30d'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={timeWindow === option}
                className={timeWindow === option ? 'is-active' : ''}
                onClick={() => onWindowChange(option)}
              >
                {option === '24h' ? 'Day' : option === '7d' ? 'Week' : 'Month'}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="globe-personal">{personal}</div>
      )}

      <button type="button" className="globe-about-toggle" aria-expanded={aboutOpen} onClick={() => setAboutOpen((open) => !open)}>
        <Info size={13} aria-hidden="true" />
        About this data
      </button>
      </>
      )}
      <AnimatePresence initial={false}>
        {aboutOpen && (
          <motion.div
            className="globe-about lg-surface"
            role="dialog"
            aria-label="About this data"
            initial={{ opacity: 0, x: -10, scale: 0.97, filter: 'blur(6px)' }}
            animate={{ opacity: 1, x: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, x: -8, scale: 0.98, filter: 'blur(4px)' }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            <button type="button" className="lg-icon-button globe-about-close" aria-label="Close" onClick={() => setAboutOpen(false)}><X size={13} /></button>
            <div>
              {GLOBE_LAYER_ORDER.map((layer) => (
                <p key={layer}><strong style={{ color: GLOBE_LAYERS[layer].color }}>{GLOBE_LAYERS[layer].label}{layer === 'quakes' || layer === 'natural' ? ' (Natural hazards)' : ''}.</strong> {GLOBE_LAYERS[layer].describe}</p>
              ))}
              <p><strong>Peaks.</strong> Each item's peak is its rank inside its own layer, from the layer's lowest item (0) to its highest (100): local news by stories per outlet in 48 hours, Wikipedia by reads, natural hazards by event size or quake magnitude. Earthquakes are included because they are global, measured and often newsworthy, but they peak by size, not coverage.</p>
              <p><strong>Rising and fading.</strong> Each country’s stories in the last 24 hours are compared with the 24 hours before, counting only feeds observed across both days: (recent − previous) ÷ (recent + previous + 4). Missing coverage or fewer than 4 stories shows no trend, so a gap never reads as fading. Wikipedia articles compare with the previous day. “Rising worldwide” lists words used by outlets in more countries today than yesterday — a hint, not proof of one story.</p>
              <p>Each layer is ranked only against itself. Brightness shows rank within a layer, never importance or truth. Places with no marker are unobserved, not uninterested.</p>
              <p className="globe-about-fine">{coverageNote} {placesAttribution}. Your pins and visits never leave this device.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  )
}

export function TrendChip({ signal }: { signal: Pick<GlobeSignal, 'momentum' | 'isNew'> }) {
  const trend = trendOf(signal)
  const score = Math.round(Math.abs(signal.momentum ?? 0) * 100)
  if (trend === 'new') return <span className="globe-trend is-new" title="New: not seen in the previous day's data.">New</span>
  if (trend === 'rising') return <span className="globe-trend is-rising" title={`Rising, trend score ${score} of 100: more coverage or reads than the previous day (same sources).`}><ArrowUpRight size={11} aria-hidden="true" />{score}</span>
  if (trend === 'fading') return <span className="globe-trend is-fading" title={`Fading, trend score ${score} of 100: less coverage or fewer reads than the previous day (same sources).`}><ArrowDownRight size={11} aria-hidden="true" />{score}</span>
  return null
}

function trendWords(signal: GlobeSignal): string {
  const trend = trendOf(signal)
  return trend === 'rising' ? 'Rising' : trend === 'fading' ? 'Fading' : trend === 'new' ? 'New' : trend === 'steady' ? 'Steady' : 'No trend yet'
}

/** What a row's ranking means, in plain words (shown as its tooltip). */
export function rankingTooltip(signal: GlobeSignal): string {
  switch (signal.layer) {
    case 'news':
      return `Local news: ranked by how many distinct stories this place's own outlets published in the window (${signal.measurement}). It reflects how much those outlets publish, not how much the world is talking about it. Ranked only against other local-news items.`
    case 'reading':
      return `Wikipedia: ranked by reads of this place's article on one day (${signal.measurement}). Real attention, but only from Wikipedia readers; a viral link or bots can spike it. Ranked only against other Wikipedia items.`
    case 'quakes':
      return `Earthquakes (USGS): ranked by magnitude (${signal.kind}). Size, not news coverage. Ranked only against other earthquakes.`
    case 'natural':
      return `Natural events (NASA EONET): active storms, fires, ice and volcanoes, ranked by recency and size. Ranked only against other natural events.`
  }
}

export const LIST_VIEW_TOOLTIPS: Record<ListView, string> = {
  world: 'Stories covered across the world right now: the same story in headlines from outlets in at least 3 countries (450+ local outlets and 30 international desks), ranked by how many countries covered it. Plus Wikipedia editors\' "In the news". Breadth of coverage, not importance.',
  top: 'Peaks: the tallest peaks on the globe, one type of data at a time — the busiest local newsrooms (stories per outlet), the most-read Wikipedia places, and the largest natural hazards. Each layer is ranked only against itself, so this is not one ranking of what the world is discussing; for that, see World.',
  rising: 'Places whose coverage grew: stories in the last 24 hours compared with the 24 hours before, using only feeds observed on both days. "Rising worldwide" lists words used by outlets in more countries today than yesterday.',
  fading: 'Places whose coverage shrank: fewer stories in the last 24 hours than the day before, from feeds observed on both days. A gap in coverage never counts as fading.',
}

function SignalRow({ signal, now, onSelect }: { signal: GlobeSignal; now: number; onSelect: (signal: GlobeSignal) => void }) {
  return (
    <li>
      <button
        type="button"
        className="globe-row"
        style={{ ['--layer-color' as string]: GLOBE_LAYERS[signal.layer].color }}
        title={rankingTooltip(signal)}
        onClick={() => onSelect(signal)}
      >
        <span className="globe-row-dot" aria-hidden="true" style={{ opacity: 0.45 + signal.intensity * 0.55 }} />
        <span className="globe-row-text">
          <strong>{signal.title}</strong>
          <small>{signal.layer === 'reading' ? signal.measurement : signal.layer === 'news' ? `${signal.measurement} · ${relativeTime(signal.observedAt, now)}` : `${signal.kind} · ${relativeTime(signal.observedAt, now)}`}</small>
        </span>
        <TrendChip signal={signal} />
        <PeakMeter score={peakScore(signal)} color={GLOBE_LAYERS[signal.layer].color} />
      </button>
    </li>
  )
}

export function SignalPanel({
  heading,
  signals,
  selected,
  nearby,
  now,
  saved,
  onSelect,
  onClear,
  onOpen,
  onSave,
  onFly,
  onHistory,
  emptyText,
  listView,
  onListViewChange,
  risingTerms,
  activeTerm,
  onTerm,
  translation,
  onHeadlineHistory,
  contextFor,
  onOldsTopic,
  world,
  peers,
  onContextName,
}: {
  heading: string
  signals: GlobeSignal[]
  selected: GlobeSignal | null
  nearby: GlobeSignal[]
  now: number
  saved: boolean
  onSelect: (signal: GlobeSignal) => void
  onClear: () => void
  onOpen: (url: string) => void
  onSave: (signal: GlobeSignal) => void
  onFly: (signal: GlobeSignal) => void
  /** Open The Olds for this signal, when it has a history to follow. */
  onHistory: ((signal: GlobeSignal) => void) | null
  emptyText: string
  listView: ListView
  onListViewChange: (view: ListView) => void
  risingTerms: RisingTerm[]
  activeTerm: RisingTerm | null
  onTerm: (term: RisingTerm | null) => void
  translation?: TranslateModel | undefined
  onHeadlineHistory?: ((headline: NewsHeadline, englishText: string | null, signal: GlobeSignal | null) => void) | undefined
  /** Which country's history gives context to a signal (news only). */
  contextFor?: ((signal: GlobeSignal) => { countryCode: string; name: string } | null) | undefined
  onOldsTopic?: ((node: OldsNode) => void) | undefined
  onContextName?: ((name: string, countryCode: string, countryName: string) => void) | undefined
  /** All signals, for an item's place in its layer. */
  peers?: GlobeSignal[] | undefined
  world?: {
    stories: GlobalStory[]
    inTheNews: WikiNewsItem[]
    focusedId: string | null
    onFocus: (story: GlobalStory | null) => void
    onArticleHistory: (title: string) => void
  } | undefined
}) {
  const context = selected && contextFor ? contextFor(selected) : null
  const sheen = useGlassSheen<HTMLDivElement>()
  const reduceMotion = useReducedMotion()
  const enter = reduceMotion ? { opacity: 0 } : { opacity: 0, x: 14, filter: 'blur(6px)' }
  return (
    <aside ref={sheen} className="globe-panel lg-surface lg-sheen" aria-label={selected ? 'Signal details' : heading}>
      <AnimatePresence mode="wait" initial={false}>
        {selected ? (
          <motion.div
            key={`detail-${selected.id}`}
            className="globe-detail"
            initial={enter}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -10, filter: 'blur(4px)' }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            style={{ ['--layer-color' as string]: GLOBE_LAYERS[selected.layer].color }}
          >
            <div className="globe-detail-top">
              <button type="button" className="lg-icon-button globe-back" aria-label="Back to list" onClick={onClear}>
                <ArrowLeft size={15} />
              </button>
              <span className="globe-chip">{layerIcon[selected.layer]}{selected.kind}</span>
              <button type="button" className="lg-icon-button globe-close" aria-label="Close details" onClick={onClear}>
                <X size={15} />
              </button>
            </div>
            {selected.thumbnail && (
              <img className="globe-thumb" src={selected.thumbnail} alt="" referrerPolicy="no-referrer" loading="lazy" />
            )}
            <h2>{selected.title}</h2>
            {selected.placeLabel && selected.placeLabel !== selected.title && <p className="globe-place"><MapPin size={12} aria-hidden="true" />{selected.placeLabel}</p>}
            {selected.summary && <p className="globe-detail-summary">{selected.summary}</p>}
            {context && onHistory && (
              <BiggerPicture
                countryCode={context.countryCode}
                countryName={context.name}
                onOpenCountry={() => onHistory(selected)}
                onOpenTopic={(node) => onOldsTopic?.(node)}
                headlines={selected.headlines ?? []}
                onOpenName={(name) => onContextName?.(name, context.countryCode, context.name)}
              />
            )}
            <dl className="globe-facts">
              <div><dt>{selected.layer === 'reading' ? 'Readers' : selected.layer === 'quakes' ? 'Measured' : selected.layer === 'news' ? 'Published' : 'Reported'}</dt><dd>{selected.measurement}</dd></div>
              <div><dt>{selected.layer === 'reading' ? 'Day' : selected.layer === 'news' ? 'Latest' : 'Observed'}</dt><dd>{relativeTime(selected.observedAt, now)}</dd></div>
              <div><dt>Sun there</dt><dd><span className={`globe-sun is-${dayPhase(selected.lat, selected.lon, new Date(now)).phase}`}>{dayPhaseText(selected.lat, selected.lon, new Date(now))}</span></dd></div>
              <div><dt>Trend</dt><dd><span className={`globe-trend-word is-${trendOf(selected)}`}>{trendWords(selected)}</span></dd></div>
              {selected.trendNote && <div className="globe-fact-note"><dd>{selected.trendNote}</dd></div>}
              <div title="Peak height inside its own layer: 0 is the layer's lowest item, 100 its highest."><dt>Peak</dt><dd className="peak-dd"><PeakMeter score={peakScore(selected)} color={GLOBE_LAYERS[selected.layer].color} /> {peakScore(selected)} of 100</dd></div>
              <div className="globe-fact-note peak-why"><dd><strong>Why it peaks.</strong> {whyItPeaks(selected, peers ?? signals)}</dd></div>
            </dl>
            {selected.headlines?.length ? (
              <section className="globe-headlines" aria-label="Latest headlines">
                <div className="globe-headlines-top">
                  <h3>Latest from local outlets</h3>
                  <span className="globe-headlines-actions">
                    {onHistory && !context && (
                      <button type="button" className="globe-history-button" title="The Olds: sourced history of this place" onClick={() => onHistory(selected)}>
                        <History size={13} aria-hidden="true" /> History
                      </button>
                    )}
                    <button type="button" className="lg-icon-button" aria-label="Fly here" title="Fly here" onClick={() => onFly(selected)}>
                      <Navigation size={14} />
                    </button>
                  </span>
                </div>
                <HeadlineList
                  headlines={selected.headlines}
                  now={now}
                  onOpen={onOpen}
                  translation={translation}
                  onHistory={onHeadlineHistory ? (headline, english) => onHeadlineHistory(headline, english, selected) : undefined}
                  detail={(headline) => `${headline.publisher} · ${relativeTime(headline.publishedAt, now)}${headline.place && headline.place !== selected.title ? ` · ${headline.place}` : ''}`}
                />
              </section>
            ) : (
            <div className="globe-actions">
              {readableLinks(selected).map((link, index) => (
                <button key={link.label} type="button" className={index === 0 ? 'globe-primary' : 'globe-secondary'} title={link.title} onClick={() => onOpen(link.url)}>
                  {index === 0 ? <ExternalLink size={14} aria-hidden="true" /> : <Satellite size={14} aria-hidden="true" />}
                  {link.label}
                </button>
              ))}
              {onHistory ? (
                <button type="button" className="globe-history-button" title="The Olds: sourced history of this" onClick={() => onHistory(selected)}>
                  <History size={13} aria-hidden="true" /> History
                </button>
              ) : (
                <button type="button" className="lg-icon-button" aria-label="Fly here" title="Fly here" onClick={() => onFly(selected)}>
                  <Navigation size={15} />
                </button>
              )}
              <button type="button" className="lg-icon-button" aria-label={saved ? 'Saved to bookmarks' : 'Save to bookmarks'} title={saved ? 'Saved' : 'Save to bookmarks'} aria-pressed={saved} onClick={() => onSave(selected)}>
                <BookmarkPlus size={15} />
              </button>
              </div>
            )}
            {nearby.length > 0 && (
              <section className="globe-nearby" aria-label="Nearby">
                <h3>Nearby</h3>
                <ul className="globe-list">
                  {nearby.map((signal) => <SignalRow key={signal.id} signal={signal} now={now} onSelect={onSelect} />)}
                </ul>
              </section>
            )}
            <p className="globe-provenance">
              {selected.attribution}.{' '}
              <button type="button" onClick={() => onOpen(selected.sourceUrl)}>Measurement source</button>
              {selected.layer === 'natural' && selected.url !== selected.sourceUrl && (
                <>
                  {' · '}
                  <button type="button" onClick={() => onOpen(selected.url)} title={DATA_FILE.test(selected.url) ? 'A raw data file: it downloads rather than opening a page' : selected.url}>
                    {DATA_FILE.test(selected.url) ? 'Agency data file (downloads)' : 'Agency report'}
                  </button>
                </>
              )}
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="list"
            className="globe-list-view"
            initial={enter}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -10, filter: 'blur(4px)' }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="globe-list-top">
              <h2 className="globe-list-heading">{heading}<span>{signals.length}</span></h2>
              <div className="globe-tabs" role="tablist" aria-label="Order">
                {(['world', 'top', 'rising', 'fading'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="tab"
                    aria-selected={listView === option}
                    className={listView === option ? 'is-active' : ''}
                    title={LIST_VIEW_TOOLTIPS[option]}
                    onClick={() => { onTerm(null); onListViewChange(option) }}
                  >
                    {listView === option && <motion.span layoutId="globe-tab-thumb" className="globe-tab-thumb" transition={spring} aria-hidden="true" />}
                    <span>{option === 'world' ? 'World' : option === 'top' ? 'Peaks' : option === 'rising' ? 'Rising' : 'Fading'}</span>
                  </button>
                ))}
              </div>
            </div>
            {activeTerm ? (
              <TermDetail term={activeTerm} now={now} onBack={() => onTerm(null)} onOpen={onOpen} translation={translation} onHistory={onHeadlineHistory ? (headline, english) => onHeadlineHistory(headline, english, null) : undefined} />
            ) : (
              <>
                {listView === 'world' && (
                  <WorldStories
                    stories={world?.stories ?? []}
                    inTheNews={world?.inTheNews ?? []}
                    now={now}
                    focusedId={world?.focusedId ?? null}
                    onFocus={(story) => world?.onFocus(story)}
                    onOpen={onOpen}
                    onHistory={(headline, english) => onHeadlineHistory?.(headline, english, null)}
                    onArticleHistory={(title) => world?.onArticleHistory(title)}
                    translation={translation}
                  />
                )}
                {listView === 'rising' && risingTerms.length > 0 && (
                  <section className="globe-rising" aria-label="Rising worldwide">
                    <h3><Sparkles size={12} aria-hidden="true" /> Rising worldwide</h3>
                    <div className="globe-rising-terms">
                      {risingTerms.map((term) => (
                        <button key={term.term} type="button" onClick={() => onTerm(term)} title={`${term.recentComparableCount} countries today vs ${term.previousCountryCount} the day before (same feeds)`}>
                          <span>{term.term}</span>
                          <small>{term.recentCountries.length}</small>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {listView === 'world' ? null : signals.length ? (
                  <ul className="globe-list">
                    {signals.map((signal) => <SignalRow key={signal.id} signal={signal} now={now} onSelect={onSelect} />)}
                  </ul>
                ) : (
                  <p className="globe-empty">{listView === 'top'
                    ? emptyText
                    : listView === 'rising'
                      ? 'Nothing is clearly rising yet. Trends need a day of comparable history.'
                      : 'Nothing is clearly fading yet. Trends need a day of comparable history.'}</p>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  )
}

export function HoverCardContent({ title, kind, detail, color, sun }: { title: string; kind: string; detail: string; color: string; sun?: string }) {
  return (
    <div className="globe-hover" style={{ ['--layer-color' as string]: color }}>
      <span className="globe-hover-kind">{kind}</span>
      <strong>{title}</strong>
      <small>{detail}</small>
      {sun && <small className="globe-hover-sun">{sun}</small>}
    </div>
  )
}

function TermDetail({ term, now, onBack, onOpen, translation, onHistory }: { term: RisingTerm; now: number; onBack: () => void; onOpen: (url: string) => void; translation?: TranslateModel | undefined; onHistory?: ((headline: NewsHeadline, englishText: string | null) => void) | undefined }) {
  return (
    <section className="globe-term" aria-label={`Rising: ${term.term}`}>
      <div className="globe-term-top">
        <button type="button" className="lg-icon-button globe-back" aria-label="Back to rising" onClick={onBack}>
          <ArrowLeft size={15} />
        </button>
        <div>
          <h3>{term.term}</h3>
          <p>In headlines from {term.recentCountries.length} countries in the last 24 h. Among feeds with two days of history: {term.recentComparableCount} countries today vs {term.previousCountryCount} the day before.</p>
        </div>
      </div>
      <HeadlineList className="globe-headlines-plain" headlines={term.headlines} now={now} onOpen={onOpen} translation={translation} onHistory={onHistory} />
      <p className="globe-term-note">Highlighted on the globe: countries whose own outlets used this word. A shared word is a hint, not proof of one story.</p>
    </section>
  )
}
