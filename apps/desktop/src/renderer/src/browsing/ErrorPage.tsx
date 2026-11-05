import { ArrowLeft, Lock, RotateCw, SearchX, ShieldAlert, Timer, WifiOff, CircleAlert } from 'lucide-react'
import type { PageLoadError } from '@intoponet/browser-api'
import './browsing.css'

const ICONS: Partial<Record<PageLoadError['kind'], typeof WifiOff>> = {
  offline: WifiOff,
  'not-found': SearchX,
  timeout: Timer,
  certificate: ShieldAlert,
  insecure: Lock,
}

const day = (iso: string): string => {
  if (!iso) return 'unknown'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'unknown' : date.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

/**
 * A page that could not load, drawn by the shell where the page would be (the tab's address
 * stays in the toolbar; Retry reloads it, Back goes to the previous page).
 */
export function ErrorPage({ error, canGoBack, retrying, onRetry, onBack }: {
  error: PageLoadError
  canGoBack: boolean
  retrying: boolean
  onRetry: () => void
  onBack: () => void
}) {
  const Icon = ICONS[error.kind] ?? CircleAlert
  const certificate = error.certificate
  return (
    <div className={`load-error-page is-${error.kind}`} role="main" aria-labelledby="load-error-title">
      <div className="load-error-inner">
        <Icon size={34} aria-hidden="true" className="load-error-icon" />
        <h2 id="load-error-title">{error.title}</h2>
        <p>{error.detail}</p>
        {certificate && (
          <dl className="load-error-certificate" aria-label="Certificate details">
            <dt>Issued to</dt><dd>{certificate.subject || 'unknown'}</dd>
            <dt>Issued by</dt><dd>{certificate.issuer || 'unknown'}</dd>
            <dt>Valid</dt><dd>{day(certificate.validFrom)} to {day(certificate.validUntil)}</dd>
            {certificate.fingerprint && <><dt>Fingerprint</dt><dd className="load-error-code">{certificate.fingerprint}</dd></>}
          </dl>
        )}
        <p className="load-error-code" title={error.url}>{error.codeName}</p>
        <div className="load-error-actions">
          {canGoBack && (
            <button type="button" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" /> Back</button>
          )}
          <button type="button" className="is-primary" onClick={onRetry} disabled={retrying}>
            <RotateCw size={14} aria-hidden="true" className={retrying ? 'is-spinning' : undefined} /> {retrying ? 'Retrying…' : 'Retry'}
          </button>
        </div>
        {error.autoRetry && <p className="load-error-note" role="status">Waiting for a connection…</p>}
      </div>
    </div>
  )
}

/**
 * Banner text for a failed browser command. Page loads that failed show the error page in the
 * tab instead (an empty string clears the banner).
 */
export function navigationErrorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : 'Navigation failed.'
  return /\bERR_[A-Z_]+ \(-\d+\) loading\b/.test(message) ? '' : message
}
