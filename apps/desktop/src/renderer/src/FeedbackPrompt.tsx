import { Star, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import './feedback.css'

const CHECK_EVERY_MS = 5 * 60_000

/**
 * A small card that asks for a rating or a comment after an hour of use (the main process
 * decides when). It sits over the globe only, never over a web page, and goes away for good
 * once sent or declined.
 */
export function FeedbackPrompt({ hidden }: { hidden: boolean }) {
  const [due, setDue] = useState(false)
  const [rating, setRating] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [state, setState] = useState<'asking' | 'sending' | 'thanks' | 'error'>('asking')

  useEffect(() => {
    let cancelled = false
    const check = (): void => {
      void window.intoponet.feedback.status().then((status) => { if (!cancelled && status.due) setDue(true) }, () => undefined)
    }
    check()
    const timer = window.setInterval(check, CHECK_EVERY_MS)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [])

  // Thanks, then gone.
  useEffect(() => {
    if (state !== 'thanks') return
    const timer = window.setTimeout(() => setDue(false), 3_500)
    return () => window.clearTimeout(timer)
  }, [state])

  if (!due || hidden) return null

  const later = (): void => { setDue(false); void window.intoponet.feedback.later().catch(() => undefined) }
  const never = (): void => { setDue(false); void window.intoponet.feedback.never().catch(() => undefined) }
  const send = (): void => {
    if (rating === null && !comment.trim()) return
    setState('sending')
    window.intoponet.feedback.send(rating, comment.trim()).then(() => setState('thanks'), () => setState('error'))
  }
  const shown = hover ?? rating ?? 0

  return (
    <aside className="feedback-card lg-surface" aria-label="Feedback">
      {state === 'thanks' ? (
        <p className="feedback-thanks" role="status">Thank you. That goes straight to the people building Intoponet.</p>
      ) : (
        <>
          <header>
            <strong>How is Intoponet working for you?</strong>
            <button type="button" className="feedback-close" onClick={later} aria-label="Not now"><X size={15} aria-hidden="true" /></button>
          </header>
          <div className="feedback-stars" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHover(null)}>
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rating === value}
                aria-label={`${value} ${value === 1 ? 'star' : 'stars'}`}
                className={value <= shown ? 'is-on' : ''}
                onMouseEnter={() => setHover(value)}
                onClick={() => setRating(value)}
              >
                <Star size={22} strokeWidth={1.6} aria-hidden="true" />
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="What do you like, and what should be better? (optional)"
            aria-label="Comment"
          />
          {state === 'error' && <p className="feedback-error" role="alert">It could not be sent. Check your connection and try again.</p>}
          <footer>
            <button type="button" className="feedback-never" onClick={never}>Don’t ask again</button>
            <button type="button" className="feedback-send" onClick={send} disabled={state === 'sending' || (rating === null && !comment.trim())}>
              {state === 'sending' ? 'Sending…' : 'Send'}
            </button>
          </footer>
          <p className="feedback-note">Only your rating, your words and the app version are sent. No name, email or browsing.</p>
        </>
      )}
    </aside>
  )
}
