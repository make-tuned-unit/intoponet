import { useEffect, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import type { HeldIncomingLinks } from '@intoponet/browser-api'

/** Links from another app held back after a burst (more than 6 within 3 seconds), kept by main; null when none wait. */
export function useHeldIncomingLinks(): HeldIncomingLinks | null {
  const [held, setHeld] = useState<HeldIncomingLinks | null>(null)
  useEffect(() => {
    let mounted = true
    let changed = false
    const unsubscribe = window.intoponet.browsing.subscribe((event) => {
      if (event.type !== 'incoming-held') return
      changed = true
      setHeld(event.held)
    })
    // What waits already (the window reopened, or its page reloaded); never over a newer change.
    void window.intoponet.browsing.heldIncoming().then((value) => { if (mounted && !changed) setHeld(value) }, () => undefined)
    return () => { mounted = false; unsubscribe() }
  }, [])
  return held
}

/**
 * "Opened 6 of 9 links from another app · Open the rest": nothing more opens (and no tab closes to make
 * room) until the person chooses. A bar under the toolbar while a page is shown, a notice otherwise.
 */
export function IncomingLinksNotice({ held, asBar }: { held: HeldIncomingLinks; asBar: boolean }) {
  const text = `Opened ${held.opened} of ${held.total} links from another app`
  const openRest = (): void => { void window.intoponet.browsing.openHeldIncoming().catch(() => undefined) }
  const dismiss = (): void => { void window.intoponet.browsing.dismissHeldIncoming().catch(() => undefined) }
  if (asBar) {
    return (
      <div className="permission-bar incoming-links-bar" role="status" aria-label={text}>
        <span className="permission-bar-ask">
          <ExternalLink size={15} aria-hidden="true" />
          <strong>{text}</strong>
        </span>
        <span className="permission-bar-actions">
          <button type="button" onClick={dismiss}>Dismiss</button>
          <button type="button" className="is-primary" onClick={openRest}>Open the rest</button>
        </span>
      </div>
    )
  }
  return (
    <div className="notice-message incoming-links-notice" role="status">
      {text}
      <button type="button" className="notice-undo" onClick={openRest}>Open the rest</button>
      <button type="button" onClick={dismiss} aria-label="Dismiss notice">
        <X size={14} />
      </button>
    </div>
  )
}
