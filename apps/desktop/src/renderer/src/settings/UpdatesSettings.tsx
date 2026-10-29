import { useEffect, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import type { UpdateStatus } from '@intoponet/browser-api'

export function UpdatesSettings() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let mounted = true
    const unsubscribe = window.intoponet.updates.subscribe((next) => { if (mounted) setStatus(next) })
    void window.intoponet.updates.status().then((next) => { if (mounted) setStatus(next) }).catch(() => {
      if (mounted) setStatus({ state: 'error', currentVersion: 'unknown', error: 'Update status is unavailable.' })
    })
    return () => { mounted = false; unsubscribe() }
  }, [])

  const check = async (): Promise<void> => {
    setBusy(true)
    try { setStatus(await window.intoponet.updates.checkAndDownload()) }
    catch { setStatus((current) => ({ state: 'error', currentVersion: current?.currentVersion ?? 'unknown', error: 'The update operation failed. Try again later.' })) }
    finally { setBusy(false) }
  }

  const restart = async (): Promise<void> => {
    setBusy(true)
    try { setStatus(await window.intoponet.updates.restart()) }
    catch { setBusy(false) }
    finally { setBusy(false) }
  }

  if (!status) {
    return <section aria-labelledby="updates-heading" aria-busy="true"><h3 id="updates-heading">Software updates</h3><p role="status">Loading update availability…</p></section>
  }

  const description = status.state === 'disabled'
    ? status.disabledReason === 'preview'
      ? 'Updates are available only in a packaged macOS release.'
      : status.disabledReason === 'unsupported-platform'
        ? 'Updates are not available on this platform.'
        : 'This build has no update feed configured.'
    : status.state === 'checking'
      ? 'Checking for an update…'
      : status.state === 'downloading'
        ? 'An update is available and is downloading…'
        : status.state === 'downloaded'
          ? 'The update is ready. Restart now, or it will be applied the next time you open Intoponet.'
          : status.state === 'not-available'
            ? 'Intoponet is up to date.'
            : status.state === 'error'
              ? status.error ?? 'The update operation failed. Try again later.'
              : 'Check manually for a new version. No update checks run in the background.'

  return (
    <section aria-labelledby="updates-heading">
      <h3 id="updates-heading">Software updates</h3>
      <p>Version {status.currentVersion}. {description}</p>
      <p>Checking contacts the update server with your app version and normal network metadata, including your IP address. No checks happen in the background.</p>
      {status.error && <p className="settings-error" role="alert">{status.error}</p>}
      {status.state === 'downloaded' ? (
        <button type="button" className="settings-primary" onClick={() => void restart()} disabled={busy}>
          <RefreshCw size={13} aria-hidden="true" /> Restart to install
        </button>
      ) : status.state !== 'disabled' ? (
        <button type="button" className="settings-primary" onClick={() => void check()} disabled={busy || status.state === 'checking' || status.state === 'downloading'}>
          <Download size={13} aria-hidden="true" /> Check and download
        </button>
      ) : null}
      {busy && <span className="sr-only" role="status">Working…</span>}
    </section>
  )
}
