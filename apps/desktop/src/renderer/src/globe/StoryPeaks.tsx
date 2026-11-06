import { Mountain, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { StoryMountain } from '../../../shared/news/storyMountains'
import { countryPlace } from '../../../shared/places/places'
import type { GlobeMarker } from './GlobeMarkers'
import { summitRadius, type StrandEnd } from './StoryStrands'

/** Summit gold (also the shader's cap colour). */
export const SUMMIT_COLOR = '#ffd166'
export const STORY_MARKER_PREFIX = 'story:'
/** Summits drawn as markers (labels are thinned further by the label layer). */
const MARKER_LIMIT = 24

export const storyMarkerId = (story: StoryMountain): string => `${STORY_MARKER_PREFIX}${story.id}`

export function storyLabel(story: StoryMountain): string {
  const text = story.label ?? story.title
  return text.length > 40 ? `${text.slice(0, 38)}…` : text
}

export function countryName(code: string): string {
  return countryPlace(code)?.name ?? code
}

/** Summit markers standing on their raised terrain, tallest first. */
export function storyMarkers(stories: StoryMountain[]): GlobeMarker[] {
  const top = stories[0]?.height ?? 1
  return stories.slice(0, MARKER_LIMIT).map((story) => ({
    id: storyMarkerId(story),
    lat: story.summit.lat,
    lon: story.summit.lon,
    color: SUMMIT_COLOR,
    size: Math.min(1, story.height / Math.max(0.01, top)),
    kind: 'signal' as const,
    radius: summitRadius(story.height),
  }))
}

/**
 * Where a story's strands go: on hover the first four countries to cover it and
 * the four that covered it most; pinned, up to sixteen. Chronological order is
 * kept so strands draw in the order coverage appeared.
 */
export function strandEnds(story: StoryMountain, limit: number): StrandEnd[] {
  const placed = story.countries.flatMap((coverage) => {
    const place = countryPlace(coverage.countryCode)
    return place ? [{ coverage, place }] : []
  })
  let chosen = placed
  if (placed.length > limit) {
    const first = placed.slice(0, Math.ceil(limit / 2))
    const rest = placed.slice(first.length).sort((a, b) => b.coverage.outlets - a.coverage.outlets).slice(0, limit - first.length)
    const keep = new Set([...first, ...rest])
    chosen = placed.filter((entry) => keep.has(entry))
  }
  const most = Math.max(1, ...chosen.map((entry) => entry.coverage.outlets))
  return chosen.map(({ coverage, place }) => ({ id: coverage.countryCode, lat: place.lat, lon: place.lon, weight: coverage.outlets / most }))
}

function timeOf(iso: string): string {
  const at = new Date(iso)
  return at.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

function trend(story: StoryMountain): string | null {
  if (story.momentum === null) return null
  if (story.momentum >= 0.15) return '▲ Rising'
  if (story.momentum <= -0.15) return '▼ Easing'
  return '● Holding'
}

function coverageLine(story: StoryMountain): string {
  const abroad = story.countries.length
  return `${story.outlets} ${story.outlets === 1 ? 'outlet' : 'outlets'} · ${story.homeOutlets} in ${countryName(story.countryCode)}${abroad ? ` · ${abroad} other ${abroad === 1 ? 'country' : 'countries'}` : ''}`
}

/** The card shown while hovering a summit or its mountain. */
export function StoryCardContent({ story, rank }: { story: StoryMountain; rank: number }) {
  const shown = story.countries.slice(0, 4)
  const more = story.countries.length - shown.length
  const direction = trend(story)
  return (
    <div className="story-card">
      <span className="story-card-kind"><span className="story-card-rank">{rank === 1 ? 'Highest peak' : `Peak ${rank}`}</span>{direction ? ` · ${direction}` : ''}</span>
      <strong>{story.label ?? story.title}</strong>
      {story.label && <span className="story-card-title">{story.title}</span>}
      <span className="story-card-detail">{coverageLine(story)}</span>
      {shown.length > 0 && (
        <ol className="story-card-countries">
          {shown.map((country) => <li key={country.countryCode}><span>{countryName(country.countryCode)}</span><span>{country.outlets} · from {timeOf(country.firstAt)}</span></li>)}
          {more > 0 && <li className="story-card-more">+{more} more · click to pin</li>}
        </ol>
      )}
    </div>
  )
}

/** A pinned story: every country's first headline, in the order coverage appeared. */
export function StoryPanel({ story, rank, onClose, onOpen }: { story: StoryMountain; rank: number; onClose: () => void; onOpen: (url: string) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }) }, [story.id])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const direction = trend(story)
  return (
    <aside className="story-panel lg-surface" aria-label={`Coverage of ${story.label ?? story.title}`} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <header>
        <span className="story-card-kind"><Mountain size={13} aria-hidden="true" /> {rank === 1 ? 'Highest peak' : `Peak ${rank}`}{direction ? ` · ${direction}` : ''}</span>
        <button ref={closeRef} type="button" className="lg-icon-button" aria-label="Close" onClick={onClose}><X size={14} /></button>
      </header>
      <h2>{story.label ?? story.title}</h2>
      <button type="button" className="story-panel-lead" onClick={() => onOpen(story.url)}>{story.title} <span>{story.publisher}</span></button>
      <p className="story-panel-detail">{coverageLine(story)}</p>
      {story.countries.length > 0 && (
        <>
          <h3>Also covered in, as it appeared</h3>
          <ol className="story-panel-countries">
            {story.countries.map((country, index) => (
              <li key={country.countryCode}>
                <span className="story-panel-order">{index + 1}</span>
                <div>
                  <span className="story-panel-country">{countryName(country.countryCode)} <span>{country.outlets} {country.outlets === 1 ? 'outlet' : 'outlets'} · from {timeOf(country.firstAt)}</span></span>
                  <button type="button" onClick={() => onOpen(country.headline.url)} lang={country.headline.lang}>{country.headline.title} <span>{country.headline.publisher}</span></button>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="story-panel-note">Height is how many independent outlets in the monitored feeds carried the story, newer coverage counting more (it halves every 12 hours). It is not a measure of importance. Strands join countries that covered it; they do not show who copied whom.</p>
    </aside>
  )
}

/** Fly to the tallest summit; pressing again steps down the ranking. */
export function HighestPeakButton({ stories, index, onFind }: { stories: StoryMountain[]; index: number; onFind: (next: number) => void }) {
  if (!stories.length) return null
  const next = index < 0 ? 0 : (index + 1) % Math.min(stories.length, 10)
  return (
    <button type="button" className="story-highest lg-surface" onClick={() => onFind(next)} title="Fly to the highest story peak (H). Press again for the next.">
      <Mountain size={14} aria-hidden="true" />
      <span>{index < 0 ? 'Highest peak' : `Next peak · ${next + 1}`}</span>
      <kbd>H</kbd>
    </button>
  )
}
