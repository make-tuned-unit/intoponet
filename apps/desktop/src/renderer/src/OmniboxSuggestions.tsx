import { AnimatePresence, motion } from 'motion/react'
import { AppWindow, ArrowUpRight, Clock, Compass, Globe2, MapPin, Search, Star } from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react'
import type { OpenDisposition } from '@intoponet/browser-api'
import { placeLabel } from '../../shared/places/places'
import type { PlaceMatch } from './globe/PlaceSuggestions'
import type { ExploreTopic } from './launcherIntent'
import { rankOmnibox, type OmniboxRecent, type OmniboxPage, type OmniboxSuggestion, type OmniboxTab } from './omnibox'
import { useKnownFavicon } from './favicons'
import './omnibox.css'

export const OMNIBOX_LIST_ID = 'omnibox-suggestions'
const optionId = (index: number): string => `omnibox-option-${index}`

/** ⌘↵ opens in a background tab, ⌥↵ in a new foreground tab (Chrome and Safari's keys). */
export function dispositionFor(event: { metaKey: boolean; altKey: boolean }): OpenDisposition | undefined {
  if (event.metaKey) return 'background-tab'
  if (event.altKey) return 'foreground-tab'
  return undefined
}

type OmniboxOptions = {
  query: string
  setQuery: (value: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  tabs: readonly OmniboxTab[]
  bookmarks: readonly OmniboxPage[]
  recents: readonly OmniboxRecent[]
  places: PlaceMatch
  topics: readonly ExploreTopic[]
  privateMode: boolean
  onPick: (row: OmniboxSuggestion, disposition?: OpenDisposition) => void
  /** Escape closed the list (places are hidden until the text changes). */
  onDismiss: () => void
  /** "Paste and Go" from the address bar's menu. */
  onPasteAndGo: (text: string) => void
}

/**
 * The address bar's behaviour: ranked suggestions, inline completion of a
 * typed host (selected, so typing on replaces it and Backspace removes it),
 * and the keys. App renders `<OmniboxSuggestions {...omnibox.list} />` and
 * spreads `omnibox.inputProps` on its input.
 */
export function useOmnibox(options: OmniboxOptions) {
  const { query, setQuery, inputRef, tabs, bookmarks, recents, places, topics, privateMode } = options
  // Inline completion only for text typed forward at the end (not pasted, deleted or composed).
  const [inlineFor, setInlineFor] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const allowInline = inlineFor !== null && inlineFor === query

  const result = useMemo(
    () => rankOmnibox(query, { tabs, bookmarks, recents, places, topics, privateMode }, { allowInline }),
    [query, tabs, bookmarks, recents, places, topics, privateMode, allowInline],
  )
  const rows = result.suggestions
  const activeIndex = Math.max(0, rows.findIndex((row) => row.key === activeKey))
  const completion = activeIndex === 0 ? result.inlineCompletion : ''
  const value = query + completion
  const open = focused && !dismissed && rows.length > 0

  useLayoutEffect(() => {
    const input = inputRef.current
    if (input && completion && document.activeElement === input) input.setSelectionRange(query.length, value.length, 'backward')
  }, [inputRef, query, value, completion])

  const latest = useRef(options)
  latest.current = options
  useEffect(() => window.intoponet.browserHost.subscribe((event) => {
    if (event.type !== 'paste-and-go') return
    setInlineFor(null)
    setActiveKey(null)
    latest.current.onPasteAndGo(event.text)
  }), [])

  const reset = (): void => {
    setInlineFor(null)
    setActiveKey(null)
  }

  const pick = (row: OmniboxSuggestion, disposition?: OpenDisposition): void => {
    reset()
    options.onPick(row, disposition)
  }

  /** Enter or Go: the highlighted row, else the first. False when there is nothing to do. */
  const submit = (disposition?: OpenDisposition): boolean => {
    const row = rows[activeIndex]
    if (!row) return false
    pick(row, disposition)
    return true
  }

  const accept = (): void => {
    if (!completion) return
    setInlineFor(null)
    setQuery(value)
  }

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = event.target.value
    const native = event.nativeEvent as InputEvent
    const atEnd = event.target.selectionStart === next.length && event.target.selectionEnd === next.length
    const forward = native.inputType === 'insertText' && !native.isComposing && atEnd && next.length > 0
    setInlineFor(forward ? next : null)
    setActiveKey(null)
    setDismissed(false)
    setQuery(next)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (!rows.length) return
        event.preventDefault()
        if (!open) {
          setDismissed(false)
          return
        }
        const step = event.key === 'ArrowDown' ? 1 : -1
        const next = rows[(activeIndex + step + rows.length) % rows.length]
        setActiveKey(next?.key ?? null)
        return
      }
      case 'Enter':
        if (!rows.length) return
        event.preventDefault()
        submit(dispositionFor(event))
        return
      case 'Tab':
        if (completion && !event.shiftKey) {
          event.preventDefault()
          accept()
        }
        return
      case 'ArrowRight':
      case 'End':
        // The caret moves to the end itself; the completed text becomes what was typed.
        if (completion && !event.shiftKey) accept()
        return
      case 'Escape':
        if (completion) {
          event.preventDefault()
          event.stopPropagation()
          setInlineFor(null)
        } else if (open) {
          event.preventDefault()
          event.stopPropagation()
          setDismissed(true)
          setActiveKey(null)
          options.onDismiss()
        }
        return
      default:
    }
  }

  const onContextMenu = (event: MouseEvent<HTMLInputElement>): void => {
    event.preventDefault()
    const input = event.currentTarget
    void window.intoponet.browserHost.showAddressMenu(input.selectionStart !== input.selectionEnd).catch(() => undefined)
  }

  return {
    submit,
    inputProps: {
      value,
      onChange,
      onKeyDown,
      onContextMenu,
      onFocus: () => setFocused(true),
      onBlur: () => {
        setFocused(false)
        setInlineFor(null)
      },
      role: 'combobox' as const,
      'aria-expanded': open,
      'aria-controls': OMNIBOX_LIST_ID,
      'aria-autocomplete': 'both' as const,
      'aria-activedescendant': open ? optionId(activeIndex) : undefined,
    },
    list: {
      rows: open ? rows : [],
      activeIndex,
      onHover: (index: number) => setActiveKey(rows[index]?.key ?? null),
      onPick: pick,
    },
  }
}

export function OmniboxSuggestions({
  rows,
  activeIndex,
  onHover,
  onPick,
}: {
  rows: OmniboxSuggestion[]
  activeIndex: number
  onHover: (index: number) => void
  onPick: (row: OmniboxSuggestion, disposition?: OpenDisposition) => void
}) {
  return (
    <AnimatePresence>
      {rows.length > 0 && (
        <motion.ul
          id={OMNIBOX_LIST_ID}
          className="omnibox-suggestions lg-surface"
          role="listbox"
          aria-label="Suggestions"
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 520, damping: 38 }}
        >
          {rows.map((row, index) => (
            <li
              key={row.key}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              className={`omnibox-row omnibox-${row.kind}`}
              data-kind={row.kind}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onHover(index)}
              onClick={(event) => onPick(row, dispositionFor(event))}
            >
              <RowIcon row={row} />
              <RowText row={row} />
              {index === activeIndex && <kbd aria-hidden="true">↵</kbd>}
            </li>
          ))}
        </motion.ul>
      )}
    </AnimatePresence>
  )
}

function RowIcon({ row }: { row: OmniboxSuggestion }) {
  const siteUrl = row.kind === 'tab' || row.kind === 'bookmark' || row.kind === 'history' || row.kind === 'url' ? row.url : ''
  // Only icons already cached: typing must not make a request to any site.
  const cached = useKnownFavicon(row.kind === 'url' ? '' : siteUrl)
  const favicon = (row.kind === 'tab' ? row.favicon : undefined) || cached
  const badge = row.kind === 'tab' ? <AppWindow size={10} /> : row.kind === 'bookmark' ? <Star size={10} /> : row.kind === 'history' ? <Clock size={10} /> : null
  let glyph
  if (favicon) glyph = <img src={favicon} alt="" width={16} height={16} />
  else if (row.kind === 'place') glyph = row.place.kind === 'country' ? <Globe2 size={15} /> : <MapPin size={15} />
  else if (row.kind === 'search') glyph = <Search size={15} />
  else if (row.kind === 'topic') glyph = <Compass size={15} />
  else if (row.kind === 'url') glyph = <ArrowUpRight size={15} />
  else if (row.kind === 'tab') glyph = <AppWindow size={15} />
  else if (row.kind === 'bookmark') glyph = <Star size={15} />
  else glyph = <Clock size={15} />
  return (
    <span className="omnibox-icon" aria-hidden="true">
      {glyph}
      {favicon && badge && <span className="omnibox-badge">{badge}</span>}
    </span>
  )
}

function RowText({ row }: { row: OmniboxSuggestion }) {
  switch (row.kind) {
    case 'place':
      return (
        <span className="omnibox-text">
          <strong>Fly to {placeLabel(row.place)}</strong>
          <small>{row.place.kind === 'city' ? 'City' : row.place.kind === 'country' ? 'Country' : 'Region'}{row.place.population > 0 ? ` · ${compact(row.place.population)} people` : ''}</small>
        </span>
      )
    case 'search':
      return (
        <span className="omnibox-text">
          <strong>Search for “{row.value}”</strong>
          <small>DuckDuckGo</small>
        </span>
      )
    case 'topic':
      return (
        <span className="omnibox-text">
          <strong>Explore {row.value}</strong>
          <small>On the globe</small>
        </span>
      )
    case 'url':
      return (
        <span className="omnibox-text">
          <strong>Go to {row.display}</strong>
          <small>Web address</small>
        </span>
      )
    default:
      return (
        <span className="omnibox-text">
          <strong>{row.title || row.display}</strong>
          <small>
            <span className="omnibox-url">{row.display}</span>
            {' · '}
            {row.kind === 'tab' ? 'Switch to tab' : row.kind === 'bookmark' ? 'Bookmark' : 'Visited'}
          </small>
        </span>
      )
  }
}

function compact(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}
