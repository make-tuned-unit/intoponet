import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { UpdateStatus } from '@intoponet/browser-api'

/** A quiet notice when an update has downloaded: restart now, or let it install on the next quit. */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let mounted = true
    const unsubscribe = window.intoponet.updates.subscribe((next) => { if (mounted) setStatus(next) })
    void window.intoponet.updates.status().then((next) => { if (mounted) setStatus(next) }).catch(() => {})
    return () => { mounted = false; unsubscribe() }
  }, [])

  if (!status || status.state !== 'downloaded' || dismissed) return null
  const name = status.availableVersion ? `Intoponet ${status.availableVersion}` : 'A new version of Intoponet'

  return (
    <div className="update-banner" role="status">
      <RefreshCw size={14} aria-hidden="true" />
      <span>{name} is ready to install.</span>
      <button type="button" className="update-banner-primary" disabled={busy} onClick={() => { setBusy(true); void window.intoponet.updates.restart().finally(() => setBusy(false)) }}>Restart now</button>
      <button type="button" className="update-banner-later" onClick={() => setDismissed(true)} aria-label="Install later, when you quit">Later</button>
    </div>
  )
}
