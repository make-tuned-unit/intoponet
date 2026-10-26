import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'
import { Activity, ArrowLeft, BookmarkPlus, BookOpen, ChevronRight, ExternalLink, Flame, Info, MapPin, Navigation, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useGlassSheen } from '../glass/useGlassSheen'
import '../glass/glass.css'
import './globe.css'
import {
  GLOBE_LAYER_ORDER,
  GLOBE_LAYERS,
  PIN_COLOR,
  relativeTime,
  type GlobeLayerId,
  type GlobeSignal,
  type GlobeWindow,
} from './globeSignals'

const spring: Transition = { type: 'spring', stiffness: 420, damping: 36 }
const layerIcon: Record<GlobeLayerId, ReactNode> = {
  reading: <BookOpen size={14} />,
  quakes: <Activity size={14} />,
  natural: <Flame size={14} />,
}

export type FieldView = 'public' | 'personal'

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
  onToggleLayer,
  window: timeWindow,
  onWindowChange,
  pinsVisible,
  pinCount,
  onTogglePins,
  coverageNote,
  placesAttribution,
  personal,
}: {
  view: FieldView
  onViewChange: (view: FieldView) => void
  layers: ReadonlySet<GlobeLayerId>
  counts: Record<GlobeLayerId, number>
  onToggleLayer: (layer: GlobeLayerId) => void
  window: GlobeWindow
  onWindowChange: (window: GlobeWindow) => void
  pinsVisible: boolean
  pinCount: number
  onTogglePins: () => void
  coverageNote: string
  placesAttribution: string
  personal: ReactNode
}) {
  const sheen = useGlassSheen<HTMLDivElement>()
  const [aboutOpen, setAboutOpen] = useState(false)
  return (
    <aside ref={sheen} className="globe-layers lg-surface lg-sheen" aria-label="Field layers">
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
            {GLOBE_LAYER_ORDER.map((layer) => {
              const meta = GLOBE_LAYERS[layer]
              const on = layers.has(layer)
              return (
                <li key={layer}>
                  <button
                    type="button"
                    className={`globe-layer${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    style={{ ['--layer-color' as string]: meta.color }}
                    onClick={() => onToggleLayer(layer)}
                  >
                    <span className="globe-layer-icon" aria-hidden="true">{layerIcon[layer]}</span>
                    <span className="globe-layer-text">
                      <strong>{meta.label}</strong>
                      <small>{meta.source}</small>
                    </span>
                    <span className="globe-layer-count">{counts[layer]}</span>
                  </button>
                </li>
              )
            })}
          </ul>
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

      <button
        type="button"
        className={`globe-layer globe-pins${pinsVisible ? ' is-on' : ''}`}
        aria-pressed={pinsVisible}
        style={{ ['--layer-color' as string]: PIN_COLOR }}
        onClick={onTogglePins}
      >
        <span className="globe-layer-icon" aria-hidden="true"><MapPin size={14} /></span>
        <span className="globe-layer-text">
          <strong>My pins</strong>
          <small>Private · this device</small>
        </span>
        <span className="globe-layer-count">{pinCount}</span>
      </button>

      <button type="button" className="globe-about-toggle" aria-expanded={aboutOpen} onClick={() => setAboutOpen((open) => !open)}>
        <Info size={13} aria-hidden="true" />
        About this data
      </button>
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
                <p key={layer}><strong style={{ color: GLOBE_LAYERS[layer].color }}>{GLOBE_LAYERS[layer].label}.</strong> {GLOBE_LAYERS[layer].describe}</p>
              ))}
              <p>Each layer is ranked only against itself. Brightness shows rank within a layer, never importance or truth. Places with no marker are unobserved, not uninterested.</p>
              <p className="globe-about-fine">{coverageNote} {placesAttribution}. Your pins and visits never leave this device.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  )
}

function SignalRow({ signal, now, onSelect }: { signal: GlobeSignal; now: number; onSelect: (signal: GlobeSignal) => void }) {
  return (
    <li>
      <button
        type="button"
        className="globe-row"
        style={{ ['--layer-color' as string]: GLOBE_LAYERS[signal.layer].color }}
        onClick={() => onSelect(signal)}
      >
        <span className="globe-row-dot" aria-hidden="true" style={{ opacity: 0.45 + signal.intensity * 0.55 }} />
        <span className="globe-row-text">
          <strong>{signal.title}</strong>
          <small>{signal.layer === 'reading' ? signal.measurement : `${signal.kind} · ${relativeTime(signal.observedAt, now)}`}</small>
        </span>
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
  emptyText,
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
  emptyText: string
}) {
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
            <dl className="globe-facts">
              <div><dt>{selected.layer === 'reading' ? 'Readers' : selected.layer === 'quakes' ? 'Measured' : 'Reported'}</dt><dd>{selected.measurement}</dd></div>
              <div><dt>{selected.layer === 'reading' ? 'Day' : 'Observed'}</dt><dd>{relativeTime(selected.observedAt, now)}</dd></div>
              <div><dt>Rank in layer</dt><dd><span className="globe-meter" aria-label={`${Math.round(selected.intensity * 100)} of 100`}><span style={{ width: `${selected.intensity * 100}%` }} /></span></dd></div>
            </dl>
            <div className="globe-actions">
              <button type="button" className="globe-primary" onClick={() => onOpen(selected.url)}>
                <ExternalLink size={14} aria-hidden="true" />
                Open source
              </button>
              <button type="button" className="lg-icon-button" aria-label="Fly here" title="Fly here" onClick={() => onFly(selected)}>
                <Navigation size={15} />
              </button>
              <button type="button" className="lg-icon-button" aria-label={saved ? 'Saved to bookmarks' : 'Save to bookmarks'} title={saved ? 'Saved' : 'Save to bookmarks'} aria-pressed={saved} onClick={() => onSave(selected)}>
                <BookmarkPlus size={15} />
              </button>
            </div>
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
            <h2 className="globe-list-heading">{heading}<span>{signals.length}</span></h2>
            {signals.length ? (
              <ul className="globe-list">
                {signals.map((signal) => <SignalRow key={signal.id} signal={signal} now={now} onSelect={onSelect} />)}
              </ul>
            ) : (
              <p className="globe-empty">{emptyText}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  )
}

export function HoverCardContent({ title, kind, detail, color }: { title: string; kind: string; detail: string; color: string }) {
  return (
    <div className="globe-hover" style={{ ['--layer-color' as string]: color }}>
      <span className="globe-hover-kind">{kind}</span>
      <strong>{title}</strong>
      <small>{detail}</small>
    </div>
  )
}
