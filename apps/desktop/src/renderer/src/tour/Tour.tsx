import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowLeft, ArrowRight, Pause, Play, X } from 'lucide-react'
import { TOUR_STEPS, type TourContext, type TourControls } from './steps'
import './tour.css'

type Box = { left: number; top: number; width: number; height: number }
/** The spotlight: where it is, and the selector it found (the step's own target, or a fallback). */
type Lit = { box: Box; target: string }

const PAD = 10
const CARD_WIDTH = 380

/** Where the spotlight goes: the first visible match of the first target that has one, with a little room around it. */
function litOf(target: string | string[] | undefined): Lit | null {
  for (const selector of typeof target === 'string' ? [target] : target ?? []) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      const rect = element.getBoundingClientRect()
      if (rect.width > 4 && rect.height > 4) return { box: { left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }, target: selector }
    }
  }
  return null
}

/** The card sits beside the spotlight (on the side with more room), or low and centred when there is none. */
function cardPlace(box: Box | null): { left: number; top: number } {
  const width = window.innerWidth
  const height = window.innerHeight
  if (!box) return { left: (width - CARD_WIDTH) / 2, top: Math.max(24, height - 330) }
  const room = { left: box.left, right: width - (box.left + box.width), below: height - (box.top + box.height) }
  const top = Math.min(height - 300, Math.max(24, box.top + box.height / 2 - 140))
  if (room.left >= CARD_WIDTH + 32 && room.left >= room.right) return { left: box.left - CARD_WIDTH - 24, top }
  if (room.right >= CARD_WIDTH + 32) return { left: box.left + box.width + 24, top }
  if (room.below >= 300) return { left: Math.min(width - CARD_WIDTH - 24, Math.max(24, box.left + box.width / 2 - CARD_WIDTH / 2)), top: box.top + box.height + 20 }
  return { left: Math.min(width - CARD_WIDTH - 24, Math.max(24, box.left + box.width / 2 - CARD_WIDTH / 2)), top: Math.max(24, box.top - 300) }
}

/**
 * The guided tour: a spotlight on the part of the app being shown, and a card
 * that explains it. Steps drive the real app (fly, open a story, The Olds…).
 * Next/Back or ← →, Space to play or pause, Esc to leave. Replayable from Settings.
 */
export function Tour({ controls, onClose }: { controls: TourControls; onClose: () => void }) {
  const reduceMotion = useReducedMotion()
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [lit, setLit] = useState<Lit | null>(null)
  const box = lit?.box ?? null
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const context = useRef<TourContext>({ headline: null })
  const card = useRef<HTMLElement>(null)
  const nextButton = useRef<HTMLButtonElement>(null)
  const step = TOUR_STEPS[index]!
  const last = index === TOUR_STEPS.length - 1

  // The tour is modal: focus moves into it as it opens, and back to where it was once it closes (to the
  // Settings button when that was Settings' Take the tour, closed as the tour opened).
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    const frame = requestAnimationFrame(() => nextButton.current?.focus())
    return () => {
      cancelAnimationFrame(frame)
      const back = opener?.isConnected ? opener : document.querySelector<HTMLElement>('[data-panel="settings"]')
      back?.focus()
    }
  }, [])

  // Run the step's action, then keep the spotlight on its target as panels open and move.
  useEffect(() => {
    let cancelled = false
    setBusy(true)
    setElapsed(0)
    void Promise.resolve(step.run?.(controls, context.current)).catch(() => undefined).finally(() => { if (!cancelled) setBusy(false) })
    const follow = window.setInterval(() => setLit(litOf(step.target)), 120)
    return () => {
      cancelled = true
      window.clearInterval(follow)
    }
  }, [index]) // eslint-disable-line react-hooks/exhaustive-deps

  // Back to the first step from the Back button, which is then disabled: focus goes on to Next, not nowhere.
  useEffect(() => {
    if (index === 0 && (document.activeElement?.classList.contains('tour-back') || document.activeElement === document.body)) nextButton.current?.focus()
  }, [index])

  const close = useCallback((): void => {
    controls.finish()
    onClose()
  }, [controls, onClose])
  const next = useCallback((): void => {
    if (last) close()
    else setIndex((current) => current + 1)
  }, [last, close])
  const back = useCallback((): void => setIndex((current) => Math.max(0, current - 1)), [])

  // Playing: each step stays for its time (once its action has finished), then moves on.
  useEffect(() => {
    if (!playing || busy) return
    const seconds = step.seconds ?? 9
    const started = performance.now() - elapsed * seconds * 1000
    let frame = 0
    const tick = (): void => {
      const done = (performance.now() - started) / (seconds * 1000)
      setElapsed(Math.min(1, done))
      if (done >= 1) {
        if (last) setPlaying(false)
        else setIndex((current) => current + 1)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, busy, index]) // eslint-disable-line react-hooks/exhaustive-deps

  // Listening from the start, never re-added: the tour hears its keys before anything a step opens (the
  // sources carousel would otherwise take Enter and open an article).
  const keys = useRef({ close, next, back })
  keys.current = { close, next, back }
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const inCard = event.target instanceof Element && !!card.current?.contains(event.target)
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); keys.current.close() }
      else if (event.key === 'Tab') {
        // Tab stays in the card (a step may have put focus in the address bar to type there).
        const stops = [...(card.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]') ?? [])]
        const first = stops[0]
        const end = stops.at(-1)
        if (!first || !end) return
        if (!inCard) { event.preventDefault(); (event.shiftKey ? end : first).focus() }
        else if (event.shiftKey && event.target === first) { event.preventDefault(); end.focus() }
        else if (!event.shiftKey && event.target === end) { event.preventDefault(); first.focus() }
      }
      // Enter or Space on one of the card's buttons is that button's (Leave, Back, Play…): nothing else hears it.
      else if ((event.key === 'Enter' || event.key === ' ') && inCard && event.target instanceof HTMLButtonElement) event.stopImmediatePropagation()
      else if (event.key === 'ArrowRight' || event.key === 'Enter') { event.preventDefault(); event.stopImmediatePropagation(); keys.current.next() }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); event.stopImmediatePropagation(); keys.current.back() }
      else if (event.key === ' ') { event.preventDefault(); event.stopImmediatePropagation(); setPlaying((value) => !value) }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])

  const place = cardPlace(box)
  const spring = reduceMotion ? { duration: 0 } : { type: 'spring' as const, stiffness: 170, damping: 24 }
  // Over everything, including what a step opens in a layer of its own (the sources carousel).
  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      {box ? (
        <motion.div className="tour-spotlight" aria-hidden="true" data-target={lit?.target} initial={false} animate={box} transition={spring} />
      ) : (
        <motion.div className="tour-dim" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
      )}
      <motion.section ref={card} className="tour-card lg-surface" initial={false} animate={place} transition={spring} style={{ width: CARD_WIDTH }}>
        <header className="tour-head">
          <span className="tour-chapter">{step.chapter}</span>
          <span className="tour-count">{index + 1} of {TOUR_STEPS.length}</span>
          <button type="button" className="tour-close" aria-label="Leave the tour" onClick={close}><X size={15} /></button>
        </header>
        {/* Each step's words are read out as they change (Next, Back, or playing). */}
        <div aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step.id}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, filter: 'blur(3px)' }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <h2 id="tour-title">{step.title}</h2>
            <p id="tour-body">{step.body}</p>
          </motion.div>
        </AnimatePresence>
        </div>
        {/*
          One control for the steps (a click on a step's bar goes to it; ← → and Home End from the keyboard):
          35 dots are too small to be targets of their own.
        */}
        <div
          className="tour-progress"
          role="slider"
          tabIndex={0}
          aria-label="Tour step"
          aria-valuemin={1}
          aria-valuemax={TOUR_STEPS.length}
          aria-valuenow={index + 1}
          aria-valuetext={`${index + 1} of ${TOUR_STEPS.length}: ${step.title}`}
          onClick={(event) => {
            const at = Number((event.target as HTMLElement).closest<HTMLElement>('[data-step]')?.dataset['step'])
            if (at >= 1 && at <= TOUR_STEPS.length) setIndex(at - 1)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Home') setIndex(0)
            else if (event.key === 'End') setIndex(TOUR_STEPS.length - 1)
            else return
            event.preventDefault()
          }}
        >
          {TOUR_STEPS.map((item, at) => (
            <span key={item.id} className={`tour-progress-step${at < index ? ' is-done' : at === index ? ' is-current' : ''}`} data-step={at + 1} data-title={item.title} title={`Step ${at + 1}: ${item.title}`}>
              <span className="tour-progress-bar">{at === index && <i style={{ width: `${(playing ? elapsed : 0) * 100}%` }} />}</span>
            </span>
          ))}
        </div>
        <footer className="tour-actions">
          <button type="button" className="tour-play" aria-pressed={playing} onClick={() => setPlaying((value) => !value)} title={playing ? 'Pause (Space)' : 'Play the tour (Space)'}>
            {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            {playing ? 'Pause' : 'Play'}
          </button>
          <span className="tour-spacer" />
          <button type="button" className="tour-back" onClick={back} disabled={index === 0}><ArrowLeft size={14} aria-hidden="true" /> Back</button>
          <button ref={nextButton} type="button" className="tour-next" onClick={next}>
            {last ? 'Finish' : busy ? 'Showing…' : 'Next'} {!last && <ArrowRight size={14} aria-hidden="true" />}
          </button>
        </footer>
      </motion.section>
    </div>,
    document.body,
  )
}
