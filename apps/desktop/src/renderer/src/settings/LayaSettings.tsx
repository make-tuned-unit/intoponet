import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { LayaProgress, LayaStatus } from '@intoponet/browser-api'

const message = (reason: unknown, fallback: string): string => (reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : fallback)

/**
 * Laya in Settings: what it does (Knowledge and The Olds), and a switch. The
 * model is downloaded once and runs on this Mac with no network.
 */
export function LayaSettings() {
  const [status, setStatus] = useState<LayaStatus | null>(null)
  const [progress, setProgress] = useState<LayaProgress | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void window.intoponet.laya.status().then(setStatus, () => undefined)
    return window.intoponet.laya.subscribe((event) => setProgress(event))
  }, [])
  const size = status ? Math.round(status.model.sizeBytes / 1_000_000) : 91
  const turn = (on: boolean): void => {
    setWorking(true)
    setError(null)
    const done = on ? window.intoponet.laya.enable() : window.intoponet.laya.disable({ deleteModel: false })
    done.then(setStatus, (reason: unknown) => setError(message(reason, on ? 'Laya could not be turned on.' : 'Laya could not be turned off.'))).finally(() => setWorking(false))
  }
  const downloading = working && progress && 'receivedBytes' in progress && 'totalBytes' in progress
    ? `Downloading ${Math.round(Number(progress.receivedBytes) / 1_000_000)} of ${Math.round(Number(progress.totalBytes) / 1_000_000)} MB…`
    : null
  return (
    <section>
      <h3><Sparkles size={13} aria-hidden="true" /> Laya, matching by meaning</h3>
      <p>
        Laya compares meaning rather than words, on this Mac. In Knowledge it finds your pages by meaning and answers with quotes from them.
        In The Olds it matches each story to the ongoing thread it belongs to and picks the past events that explain it, even when they use different words.
      </p>
      <p className="settings-note">A {size} MB model, downloaded once; it then works offline and never sends your reading anywhere.</p>
      {status?.enabled
        ? <button type="button" className="settings-secondary" disabled={working} onClick={() => turn(false)}>Turn off Laya</button>
        : <button type="button" className="settings-primary" disabled={working} onClick={() => turn(true)}>{downloading ?? (working ? 'Turning on…' : 'Turn on Laya')}</button>}
      {status?.enabled && <p className="settings-note">Laya is on.</p>}
      {error && <p className="settings-error" role="alert">{error}</p>}
    </section>
  )
}
