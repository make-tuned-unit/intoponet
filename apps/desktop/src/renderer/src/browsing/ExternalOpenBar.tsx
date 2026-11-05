import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import './browsing.css'
import type { ExternalOpenRequest } from '@intoponet/browser-api'

const hostOf = (site: string): string => site.replace(/^https?:\/\//, '')

/** Requests from pages to open another app, newest last; the first is shown. */
export function useExternalOpenRequests(): ExternalOpenRequest[] {
  const [requests, setRequests] = useState<ExternalOpenRequest[]>([])
  useEffect(() => {
    void window.intoponet.browsing.pendingExternal().then(setRequests, () => undefined)
    return window.intoponet.browsing.subscribe((event) => {
      if (event.type === 'external-request') setRequests((current) => [...current.filter((item) => item.id !== event.request.id), event.request])
      else if (event.type === 'external-resolved') setRequests((current) => current.filter((item) => item.id !== event.id))
    })
  }, [])
  return requests
}

/** "Open Mail?" A page asked to open another app; nothing opens until the person says so. */
export function ExternalOpenBar({ request, more }: { request: ExternalOpenRequest; more: number }) {
  const [always, setAlways] = useState(false)
  useEffect(() => setAlways(false), [request.id])
  const app = request.appName || `the app for ${request.scheme}: links`
  const decide = (decision: 'open' | 'cancel'): void => {
    void window.intoponet.browsing.decideExternal(request.id, decision, decision === 'open' && always).catch(() => undefined)
  }
  return (
    <div className="permission-bar external-open-bar" role="alertdialog" aria-label={`Open ${app}?`}>
      <span className="permission-bar-ask">
        <ExternalLink size={15} aria-hidden="true" />
        <span>
          <strong>Open {app}?</strong>{' '}
          {request.site ? <>{hostOf(request.site)} wants to open </> : <>This page wants to open </>}
          <code className="external-open-target" title={request.target}>{request.target}</code>
          {more > 0 ? ` (${more} more waiting)` : ''}
        </span>
      </span>
      <span className="permission-bar-actions">
        {!request.isPrivate && request.site && (
          <label className="external-open-always">
            <input type="checkbox" checked={always} onChange={(event) => setAlways(event.target.checked)} />
            Always allow {hostOf(request.site)} to open {request.scheme}: links
          </label>
        )}
        <button type="button" onClick={() => decide('cancel')}>Cancel</button>
        <button type="button" className="is-primary" onClick={() => decide('open')} autoFocus>Open {request.appName || 'app'}</button>
      </span>
    </div>
  )
}
