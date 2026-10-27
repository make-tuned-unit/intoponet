import { AnimatePresence, motion } from 'motion/react'
import { Globe2, MapPin } from 'lucide-react'
import { normalizePlaceText, placeLabel, searchPlaces, type Place } from '../../../shared/places/places'

const FLY_PREFIX = /^(?:fly to|go to|take me to|explore|show me)\s+/i

/** Strip a leading "fly to"; report whether the user asked for a place explicitly. */
export function parsePlaceQuery(raw: string): { text: string; explicit: boolean } {
  const trimmed = raw.trim()
  const match = trimmed.match(FLY_PREFIX)
  return match ? { text: trimmed.slice(match[0].length), explicit: true } : { text: trimmed, explicit: false }
}

export type PlaceMatch = { places: Place[]; /** Index Enter should pick, or -1 to fall through to search. */ preferred: number }

/**
 * Places for the launcher. Enter flies only when the query names a place
 * exactly or says "fly to"; otherwise the query still searches the web.
 */
export function placeMatches(raw: string): PlaceMatch {
  const { text, explicit } = parsePlaceQuery(raw)
  if (text.length < 2 || /[/:.]/.test(text) && !explicit) return { places: [], preferred: -1 }
  const places = searchPlaces(text, 4)
  if (!places.length) return { places, preferred: -1 }
  const name = normalizePlaceText(places[0]!.name)
  const typed = normalizePlaceText(text)
  // Enter flies to the place when the text is clearly that place: its name, its name plus a
  // province/state/country ("Charlottetown PEI"), or the start of its name ("Charlotteto").
  const exact = name === typed
  const qualified = typed.startsWith(`${name} `)
  const partial = typed.length >= 4 && name.startsWith(typed)
  return { places, preferred: explicit || exact || qualified || partial ? 0 : -1 }
}

export function PlaceSuggestions({
  places,
  active,
  onPick,
  onHover,
}: {
  places: Place[]
  active: number
  onPick: (place: Place) => void
  onHover: (index: number) => void
}) {
  return (
    <AnimatePresence>
      {places.length > 0 && (
        <motion.ul
          id="place-suggestions"
          className="place-suggestions lg-surface"
          role="listbox"
          aria-label="Places"
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 520, damping: 38 }}
        >
          {places.map((place, index) => (
            <li key={place.id} role="presentation">
              <button
                type="button"
                id={`place-option-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onHover(index)}
                onClick={() => onPick(place)}
              >
                <span className="place-icon" aria-hidden="true">{place.kind === 'country' ? <Globe2 size={14} /> : <MapPin size={14} />}</span>
                <span>
                  <strong>Fly to {placeLabel(place)}</strong>
                  <br />
                  <small>{place.kind === 'city' ? 'City' : place.kind === 'country' ? 'Country' : 'Region'}{place.population > 0 ? ` · ${compact(place.population)} people` : ''}</small>
                </span>
                {index === active && <kbd>↵</kbd>}
              </button>
            </li>
          ))}
        </motion.ul>
      )}
    </AnimatePresence>
  )
}

function compact(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}
