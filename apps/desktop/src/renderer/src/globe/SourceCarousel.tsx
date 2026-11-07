import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion, type Transition } from 'motion/react'
import { ArrowUpRight, ChevronLeft, ChevronRight, Clock3, Columns2, Lock, Radio, UserRound, X } from 'lucide-react'
import type { GlobalStory, GlobalStoryHeadline } from '../../../shared/news/globalStories'
import { hostIsPaywalled } from '../../../shared/news/paywall'
import { learnedPaywalls } from '../access/learnedPaywalls'
import { SiteIcon } from '../SiteIcon'
import { useTranslatedTitles } from '../translate/useTranslatedTitles'
import type { TranslateModel } from '../translate/useTranslate'
import { relativeTime } from './globeSignals'
import { carouselSlot, pageRectFrom, stepIndex, VISIBLE_SIDE, type Rect } from './sourceCarouselLayout'

export type CarouselLaunch = { story: GlobalStory; from: DOMRect }

type Preview = Awaited<ReturnType<Window['intoponet']['articles']['preview']>>

/** Each outlet's own image, writers and dates, asked for front card first and then outwards. */
function useArticlePreviews(urls: string[], front: number): Map<string, Preview> {
  const [previews, setPreviews] = useState<Map<string, Preview>>(new Map())
  const asked = useRef(new Set<string>())
  useEffect(() => {
    const order = urls.map((url, position) => ({ url, distance: Math.abs(position - front) })).sort((a, b) => a.distance - b.distance)
    for (const { url, distance } of order) {
      if (asked.current.has(url) || distance > 4) continue
      asked.current.add(url)
      void window.intoponet.articles.preview(url).then(
        (preview) => setPreviews((current) => new Map(current).set(url, preview)),
        () => setPreviews((current) => new Map(current).set(url, null)),
      )
    }
  }, [front, urls])
  return previews
}

const dateFormat = (() => {
  try {
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  } catch {
    return null
  }
})()
const formatDate = (iso: string): string => {
  const time = Date.parse(iso)
  return Number.isFinite(time) && dateFormat ? dateFormat.format(time) : ''
}

/** What a card shows: the article's image, outlet, place, headline, summary, writers and dates. */
function SourceCardBody({ headline, preview, loading, title, original, summary, where, now, paywalled }: {
  headline: GlobalStoryHeadline
  preview: Preview | undefined
  loading: boolean
  title: string
  original: string | null
  summary: string | null
  where: string
  now: number
  paywalled: boolean
}) {
  const published = preview?.publishedAt ?? headline.publishedAt
  const authors = preview?.authors ?? []
  return (
    <>
      <span className={`sc-media${preview?.image ? ' has-image' : ''}${loading ? ' is-loading' : ''}`}>
        {preview?.image && <img src={preview.image} alt={preview.imageAlt ?? ''} draggable={false} />}
        {!preview?.image && <span className="sc-media-mark"><SiteIcon url={headline.url} size={34} /></span>}
        <span className="sc-media-tags">
          {preview?.live && <span className="sc-live"><Radio size={11} aria-hidden="true" /> Live</span>}
          {preview?.section && <span className="sc-tag">{preview.section}</span>}
        </span>
      </span>
      <span className="sc-body">
        <span className="sc-card-top">
          <span className="sc-outlet"><SiteIcon url={headline.url} size={18} /><strong dir="auto">{preview?.siteName ?? headline.publisher}</strong></span>
          <span className="sc-where">{where}</span>
        </span>
        <span className="sc-headline" dir="auto" lang={original ? undefined : headline.lang}>{title}</span>
        {original && <span className="sc-original" dir="auto" lang={headline.lang}>{original}</span>}
        {summary && <span className="sc-summary" dir="auto">{summary}</span>}
        <span className="sc-byline">
          {authors.length > 0 && <span className="sc-authors"><UserRound size={12} aria-hidden="true" /> {authors.slice(0, 2).join(', ')}{authors.length > 2 ? ` +${authors.length - 2}` : ''}</span>}
          <span>{formatDate(published)}</span>
          {preview?.readingMinutes && <span><Clock3 size={11} aria-hidden="true" /> {preview.readingMinutes} min read</span>}
        </span>
        <span className="sc-card-foot">
          <span>{relativeTime(published, now)}</span>
          {(paywalled || preview?.paywalled) && <span className="sc-paywall"><Lock size={11} aria-hidden="true" /> May need a subscription</span>}
          <span className="sc-read">Read full story <ArrowUpRight size={14} aria-hidden="true" /></span>
        </span>
      </span>
    </>
  )
}

type Phase = 'browse' | 'morph' | 'closing'

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]
const SPRING: Transition = { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 }
const MORPH_S = 0.52

/** A soft colour per outlet, so neighbouring cards are easy to tell apart. */
function hueOf(text: string): number {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

function rectOf(box: DOMRect): Rect {
  return { left: box.left, top: box.top, width: box.width, height: box.height }
}

/** Where the browser will draw the page: the browser body once the panel is showing (it may be opening now). */
function waitForPageRect(timeoutMs = 900): Promise<Rect> {
  const started = performance.now()
  return new Promise((resolve) => {
    const look = (): void => {
      const body = document.querySelector('.browser-body')
      const box = body?.getBoundingClientRect()
      if (box && box.width > 0 && box.height > 0) {
        resolve(pageRectFrom(box, !!document.querySelector('.browser-panel.full-width')))
        return
      }
      if (performance.now() - started > timeoutMs) {
        resolve({ left: 40, top: 90, width: window.innerWidth - 80, height: window.innerHeight - 180 })
        return
      }
      requestAnimationFrame(look)
    }
    look()
  })
}

/**
 * Every outlet's headline for one world story, in a carousel to flip through. Choosing one
 * opens it in the browser while its card grows into the page's place, so the card becomes the page.
 */
export function SourceCarousel({ launch, now, translation, countryName, onRead, onClose }: {
  launch: CarouselLaunch
  now: number
  translation?: TranslateModel | undefined
  countryName: (code: string) => string
  /** Open the article in the browser (its page stays hidden until the card lands). */
  onRead: (url: string) => void
  onClose: () => void
}) {
  const { story, from } = launch
  const reduced = useReducedMotion() ?? false
  const headlines = useMemo(() => {
    const paywalls = learnedPaywalls()
    // The story's own headline first, then outlets readers can open freely, then the rest.
    return [...story.headlines].sort((a, b) =>
      Number(b.url === story.url) - Number(a.url === story.url) ||
      Number(hostIsPaywalled(a.url, paywalls)) - Number(hostIsPaywalled(b.url, paywalls)))
  }, [story])
  const [index, setIndex] = useState(0)
  // Compare: the front card side by side with another outlet's headline (COMPARE_COVERAGE).
  const [chooser, setChooser] = useState(false)
  const front = headlines[index]
  const frontOutlet = front?.publisher
  const outlets = useMemo(() => new Set(headlines.map((item) => item.publisher)).size, [headlines])
  const choices = useMemo(() => {
    const seen = new Set<string>()
    return headlines.filter((item) => {
      if (item.publisher === frontOutlet || seen.has(item.publisher)) return false
      seen.add(item.publisher)
      return true
    })
  }, [headlines, frontOutlet])
  // The outlet offered first: one in another country than the front card's.
  const placeOf = (item: GlobalStoryHeadline): string => (item.international ? 'international' : item.countryCode)
  const preselected = front ? choices.find((item) => placeOf(item) !== placeOf(front)) ?? choices[0] : undefined
  const urls = useMemo(() => headlines.map((item) => item.url), [headlines])
  const previews = useArticlePreviews(urls, index)
  // Headlines and summaries in your language.
  const titleItems = useMemo(() => headlines.flatMap((item) => {
    const preview = previews.get(item.url)
    const own = [{ key: item.url, title: item.title, lang: item.lang ?? null }]
    return preview?.description ? [...own, { key: `summary:${item.url}`, title: preview.description, lang: preview.lang ?? item.lang ?? null }] : own
  }), [headlines, previews])
  const titles = useTranslatedTitles(titleItems, translation)
  const bodyProps = (headline: GlobalStoryHeadline) => {
    const shown = titles.get(headline.url)
    const preview = previews.get(headline.url)
    return {
      headline,
      preview,
      loading: !previews.has(headline.url),
      title: shown ?? headline.title,
      original: shown ? headline.title : null,
      summary: titles.get(`summary:${headline.url}`) ?? preview?.description ?? null,
      where: headline.international ? 'International desk' : countryName(headline.countryCode),
      now,
      paywalled: hostIsPaywalled(headline.url, learnedPaywalls()),
    }
  }
  const [phase, setPhase] = useState<Phase>('browse')
  const [drag, setDrag] = useState(0)
  const [morph, setMorph] = useState<{ headline: GlobalStoryHeadline; from: Rect; to: Rect | null } | null>(null)
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const cards = useRef<Array<HTMLButtonElement | null>>([])
  const dialog = useRef<HTMLDivElement>(null)
  const released = useRef(false)
  const pointer = useRef<{ x: number; moved: boolean } | null>(null)
  const wheel = useRef({ sum: 0, lockedUntil: 0 })
  const suppressClick = useRef(false)

  const cardWidth = Math.round(Math.min(440, Math.max(280, size.w * 0.34)))
  const cardHeight = Math.round(Math.min(cardWidth * 1.12, Math.max(320, Math.min(size.h * 0.53 - 165, size.h * 0.47 - 120) * 2)))
  const step = cardWidth * 0.66
  const centerY = size.h * 0.53
  const launchX = from.left + from.width / 2 - size.w / 2
  const launchY = from.top + from.height / 2 - centerY

  // The page view is drawn above the shell: keep it hidden while the carousel is up.
  useEffect(() => {
    void window.intoponet.browserHost.holdPage(true)
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    dialog.current?.focus()
    const onResize = (): void => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (released.current) return
      void window.intoponet.browserHost.holdPage(false)
      // Closed without opening a page: focus goes back to what opened the carousel, not to the top of the window.
      if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body)) opener.focus({ preventScroll: true })
    }
  }, [])

  const close = useCallback(() => {
    if (phase !== 'browse') return
    setPhase('closing')
    window.setTimeout(onClose, reduced ? 0 : 420)
  }, [onClose, phase, reduced])

  const read = useCallback((position: number) => {
    if (phase !== 'browse') return
    const headline = headlines[position]
    const card = cards.current[position]
    if (!headline || !card) return
    setMorph({ headline, from: rectOf(card.getBoundingClientRect()), to: null })
    setPhase('morph')
    onRead(headline.url)
    void waitForPageRect().then((to) => setMorph((current) => (current ? { ...current, to } : current)))
  }, [headlines, onRead, phase])

  const landed = (): void => {
    if (released.current) return
    released.current = true
    void window.intoponet.browserHost.holdPage(false)
    // The page now covers the card; let it paint one frame before the shell lets go.
    window.setTimeout(onClose, 90)
  }

  const compareButton = useRef<HTMLButtonElement>(null)
  /** Closes the Compare chooser; focus goes back to Compare (the chooser's items are gone). */
  const closeChooser = useCallback((): void => {
    setChooser(false)
    compareButton.current?.focus({ preventScroll: true })
  }, [])

  // Keys: flip, read, close. Handled here first so the shell's own shortcuts stay out of the way.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (chooser) {
        // The Compare chooser is open: Escape closes it, and the cards do not flip under it.
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          closeChooser()
        }
        return
      }
      if (phase !== 'browse') return
      let handled = true
      if (event.key === 'ArrowRight') setIndex((value) => stepIndex(value, 1, headlines.length))
      else if (event.key === 'ArrowLeft') setIndex((value) => stepIndex(value, -1, headlines.length))
      else if (event.key === 'Home') setIndex(0)
      else if (event.key === 'End') setIndex(headlines.length - 1)
      else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement && !event.target.classList.contains('sc-card'))) read(index)
      else if (event.key === 'Escape') close()
      else handled = false
      if (handled) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [chooser, close, closeChooser, headlines.length, index, phase, read])

  /** Opens the front card and the chosen outlet's article side by side, then hands the screen to the browser. */
  const compareWith = (other: GlobalStoryHeadline): void => {
    if (!front || phase !== 'browse') return
    const side = (headline: GlobalStoryHeadline) => ({
      url: headline.url,
      outlet: headline.publisher,
      countryCode: headline.countryCode,
      ...(headline.international ? { international: true } : {}),
      ...(headline.lang ? { lang: headline.lang } : {}),
    })
    void window.intoponet.browserHost.openCompare({ id: story.id, title: story.title }, side(front), side(other)).then(() => {
      // The pair is on the page now: the page can show, and the carousel is done.
      released.current = true
      void window.intoponet.browserHost.holdPage(false)
      onClose()
    }, closeChooser)
  }

  const onWheel = (event: React.WheelEvent): void => {
    if (phase !== 'browse') return
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    const state = wheel.current
    if (performance.now() < state.lockedUntil) return
    state.sum += delta
    if (Math.abs(state.sum) < 45) return
    setIndex((value) => stepIndex(value, Math.sign(state.sum), headlines.length))
    state.sum = 0
    state.lockedUntil = performance.now() + 170
  }

  const onPointerDown = (event: React.PointerEvent): void => {
    if (phase !== 'browse' || event.button !== 0) return
    pointer.current = { x: event.clientX, moved: false }
  }
  const onPointerMove = (event: React.PointerEvent): void => {
    const start = pointer.current
    if (!start) return
    const dx = event.clientX - start.x
    if (!start.moved && Math.abs(dx) > 6) {
      start.moved = true
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    }
    if (start.moved) setDrag(dx)
  }
  const onPointerUp = (): void => {
    const start = pointer.current
    pointer.current = null
    if (!start?.moved) return
    const steps = Math.round(-drag / step)
    setIndex((value) => stepIndex(value, steps, headlines.length))
    setDrag(0)
    // The click that ends a drag should not also choose a card.
    suppressClick.current = true
    window.setTimeout(() => { suppressClick.current = false }, 0)
  }

  const countries = story.countries.length
  const visible = phase === 'browse'
  const fade: Transition = { duration: reduced ? 0 : 0.32, ease: EASE }

  return createPortal(
    <div
      ref={dialog}
      className="sources-carousel"
      role="dialog"
      aria-modal="true"
      aria-label={`${headlines.length} sources for: ${story.title}`}
      tabIndex={-1}
    >
      <motion.div
        className="sc-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: visible ? 1 : 0 }}
        transition={{ duration: reduced ? 0 : phase === 'morph' ? 0.42 : 0.3, ease: EASE }}
        onClick={close}
      />
      <motion.header
        className="sc-header"
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : -10 }}
        transition={{ ...fade, delay: visible && !reduced ? 0.08 : 0 }}
      >
        <p className="sc-eyebrow">
          Covered in {countries} {countries === 1 ? 'country' : 'countries'}{story.internationalDesks ? ` and ${story.internationalDesks} international desk${story.internationalDesks === 1 ? '' : 's'}` : ''} · {headlines.length} headlines to compare
        </p>
        <h2 dir="auto">{titles.get(story.url) ?? story.title}</h2>
        <button type="button" className="sc-close" aria-label="Close sources" onClick={close}><X size={18} aria-hidden="true" /></button>
      </motion.header>

      <div
        className="sc-stage"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {headlines.map((headline, position) => {
          const offset = position - index + (drag ? -drag / step : 0)
          const slot = carouselSlot(offset, cardWidth)
          const chosen = morph?.headline.url === headline.url
          const front = position === index
          const hidden = Math.abs(position - index) > VISIBLE_SIDE + 1
          const shown = titles.get(headline.url)
          const hue = hueOf(headline.publisher)
          const launchDelay = reduced ? 0 : Math.min(Math.abs(position - index), VISIBLE_SIDE + 1) * 0.045
          const target = phase === 'closing'
            ? { x: launchX, y: launchY, z: 0, rotateY: 0, scale: 0.12, opacity: 0 }
            : phase === 'morph'
              ? chosen
                ? { x: slot.x, y: 0, z: slot.z, rotateY: slot.rotateY, scale: slot.scale, opacity: 0 }
                : { x: slot.x * 1.15, y: 24, z: slot.z - 80, rotateY: slot.rotateY, scale: slot.scale * 0.9, opacity: 0 }
              : { x: slot.x, y: 0, z: slot.z, rotateY: slot.rotateY, scale: slot.scale, opacity: hidden ? 0 : slot.opacity, filter: `brightness(${slot.brightness})` }
          const transition: Transition = reduced
            ? { duration: 0 }
            : drag
              ? { duration: 0 }
              : phase === 'morph'
                ? chosen ? { duration: 0 } : { duration: 0.28, ease: EASE }
                : phase === 'closing'
                  ? { duration: 0.36, ease: [0.4, 0, 0.6, 1], delay: launchDelay * 0.6 }
                  : { ...SPRING, delay: launchDelay }
          return (
            <motion.button
              key={headline.url}
              ref={(element) => { cards.current[position] = element }}
              type="button"
              className={`sc-card${front ? ' is-front' : ''}`}
              style={{
                width: cardWidth,
                height: cardHeight,
                marginLeft: -cardWidth / 2,
                marginTop: -cardHeight / 2,
                top: centerY,
                zIndex: slot.zIndex,
                pointerEvents: hidden || !visible ? 'none' : 'auto',
                ['--sc-hue' as string]: String(hue),
              }}
              initial={{ x: launchX, y: launchY, z: 0, rotateY: 0, scale: 0.12, opacity: 0, filter: 'brightness(1)' }}
              animate={target}
              transition={transition}
              tabIndex={front ? 0 : -1}
              aria-current={front ? 'true' : undefined}
              aria-label={`${headline.publisher}: ${shown ?? headline.title}${front ? '. Press Enter to read the full story.' : ''}`}
              onClick={() => {
                if (suppressClick.current) return
                if (front) read(position)
                else setIndex(position)
              }}
            >
              <SourceCardBody {...bodyProps(headline)} />
            </motion.button>
          )
        })}
      </div>

      <motion.footer
        className="sc-footer"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : 10 }}
        transition={{ ...fade, delay: visible && !reduced ? 0.14 : 0 }}
      >
        <button type="button" className="sc-nav" aria-label="Previous source" disabled={index === 0} onClick={() => setIndex((value) => stepIndex(value, -1, headlines.length))}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <div className="sc-dots" role="tablist" aria-label="Sources">
          {headlines.map((headline, position) => (
            <button
              key={headline.url}
              type="button"
              role="tab"
              aria-selected={position === index}
              aria-label={headline.publisher}
              title={headline.publisher}
              className={position === index ? 'is-on' : ''}
              onClick={() => setIndex(position)}
            />
          ))}
        </div>
        <button type="button" className="sc-nav" aria-label="Next source" disabled={index === headlines.length - 1} onClick={() => setIndex((value) => stepIndex(value, 1, headlines.length))}>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        {outlets >= 2 && (
          <button
            type="button"
            ref={compareButton}
            className="sc-compare"
            aria-expanded={chooser}
            title="Put this article and another outlet's side by side"
            onClick={() => setChooser((open) => !open)}
          >
            <Columns2 size={14} aria-hidden="true" /> Compare
          </button>
        )}
        <p className="sc-hint">{index + 1} of {headlines.length} · ← → or swipe to flip · Enter to read</p>
      </motion.footer>

      {chooser && front && (
        <div className="sc-chooser" role="dialog" aria-label="Compare with another outlet">
          <p className="sc-chooser-title">Compare <strong>{front.publisher}</strong> with…</p>
          <ul className="sc-chooser-list">
            {choices.map((item) => {
              const picked = preselected?.publisher === item.publisher
              const where = item.international ? 'International desk' : countryName(item.countryCode)
              return (
                <li key={item.publisher}>
                  <button
                    type="button"
                    className={`sc-chooser-item${picked ? ' is-preselected' : ''}`}
                    autoFocus={picked}
                    aria-label={`${item.publisher}, ${where}`}
                    onClick={() => compareWith(item)}
                  >
                    <span>{item.publisher}</span>
                    <small>{where}</small>
                  </button>
                </li>
              )
            })}
          </ul>
          <button type="button" className="sc-chooser-cancel" onClick={closeChooser}>Cancel</button>
        </div>
      )}

      {morph && (
        <motion.div
          className="sc-morph"
          aria-hidden="true"
          style={{ ['--sc-hue' as string]: String(hueOf(morph.headline.publisher)) }}
          initial={{ ...morph.from, borderRadius: 22 }}
          animate={morph.to ? { ...morph.to, borderRadius: 10 } : { ...morph.from, borderRadius: 22 }}
          transition={{ duration: reduced ? 0 : MORPH_S, ease: EASE }}
          onAnimationComplete={() => { if (morph.to) landed() }}
        >
          <motion.span
            className="sc-morph-page"
            initial={{ opacity: 0 }}
            animate={{ opacity: morph.to ? 1 : 0 }}
            transition={{ duration: reduced ? 0 : MORPH_S * 0.7, ease: EASE, delay: reduced ? 0 : MORPH_S * 0.25 }}
          />
          <motion.span
            className="sc-morph-content"
            initial={{ opacity: 1 }}
            animate={{ opacity: morph.to ? 0 : 1 }}
            transition={{ duration: reduced ? 0 : MORPH_S * 0.45, ease: EASE }}
          >
            <SourceCardBody {...bodyProps(morph.headline)} />
          </motion.span>
        </motion.div>
      )}
    </div>,
    document.body,
  )
}
