import { Bell, Camera, ClipboardPaste, ExternalLink, MapPin, Mic, ShieldQuestion } from 'lucide-react'
import { describePermissionKinds, type PageTabSnapshot, type SitePermissionAnswer, type SitePermissionKind, type SitePermissionMap, type SitePermissionRequest } from '@intoponet/browser-api'

const ICONS: Record<SitePermissionKind, typeof Camera> = { camera: Camera, microphone: Mic, location: MapPin, notifications: Bell, 'clipboard-read': ClipboardPaste, popups: ExternalLink }
const NAMES: Record<SitePermissionKind, string> = { camera: 'Camera', microphone: 'Microphone', location: 'Location', notifications: 'Notifications', 'clipboard-read': 'Clipboard', popups: 'Pop-ups' }

const hostOf = (origin: string): string => origin.replace(/^https?:\/\//, '')

/**
 * How the bar names the tab that asked when it is not in front ("Background tab “Team call”"), or null when
 * it is the tab shown (or the other side of its pair) or not a tab at all. A tab in another workspace is in
 * the background too. The title is the tab's now when it is listed, else its title when it asked.
 */
export function backgroundTabLabel(request: Pick<SitePermissionRequest, 'tabId' | 'tabTitle'>, tabs: ReadonlyArray<Pick<PageTabSnapshot, 'id' | 'title' | 'active' | 'split'>>): string | null {
  if (!request.tabId) return null
  const shown = tabs.find((tab) => tab.active)
  if (shown && (shown.id === request.tabId || shown.split?.partnerId === request.tabId)) return null
  const title = Array.from((tabs.find((tab) => tab.id === request.tabId)?.title || request.tabTitle || '').replace(/\s+/g, ' ').trim())
  const short = title.length > 60 ? `${title.slice(0, 59).join('').trimEnd()}…` : title.join('')
  return short ? `Background tab “${short}”` : 'Background tab'
}

/** A site asking for something: one bar under the toolbar, answered once per site. `background` names a tab not in front. */
export function PermissionBar({ request, more, background = null, onDecide }: { request: SitePermissionRequest; more: number; background?: string | null; onDecide: (decision: SitePermissionAnswer) => void }) {
  // A pop-up the page opened without a click was blocked: open it this once, or always for the site.
  const popup = request.kinds.length === 1 && request.kinds[0] === 'popups'
  const Icon = request.kinds.length === 1 ? ICONS[request.kinds[0]!] : ShieldQuestion
  return (
    <div className="permission-bar" role="alertdialog" aria-label={`${background ? `${background}: ` : ''}${hostOf(request.origin)}${request.topOrigin ? ` on ${hostOf(request.topOrigin)}` : ''} asks for permission`}>
      <span className="permission-bar-ask">
        <Icon size={15} aria-hidden="true" />
        <span>
          {background ? <>{background} · </> : null}{popup ? 'Pop-up blocked: ' : null}<strong>{hostOf(request.origin)}</strong>{request.topOrigin ? <> on <strong>{hostOf(request.topOrigin)}</strong></> : null} wants to {describePermissionKinds(request.kinds)}.
          {popup ? '' : request.isPrivate ? ' Private tab: your answer is forgotten when private browsing ends.' : request.workspace ? ` Your answer is remembered for this site in ${request.workspace}.` : ' Your answer is remembered for this site.'}
          {more > 0 ? ` (${more} more waiting)` : ''}
        </span>
      </span>
      <span className="permission-bar-actions">
        {popup ? (
          <>
            <button type="button" onClick={() => onDecide('dismiss')} title="Keep it blocked this time">Not now</button>
            <button type="button" onClick={() => onDecide('allow-once')}>Allow once</button>
            <button type="button" className="is-primary" onClick={() => onDecide('allow')}>Always for this site</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => onDecide('dismiss')} title="Decline this time and ask again later">Not now</button>
            <button type="button" onClick={() => onDecide('block')}>Block</button>
            <button type="button" className="is-primary" onClick={() => onDecide('allow')} autoFocus>Allow</button>
          </>
        )}
      </span>
    </div>
  )
}

/** Answers remembered for the current site, each removable (it will ask again). */
export function SitePermissionChips({ origin, map, onReset }: { origin: string; map: SitePermissionMap; onReset: (kind: SitePermissionKind) => void }) {
  const entries = Object.entries(map) as Array<[SitePermissionKind, 'allow' | 'block']>
  if (!entries.length) return null
  return (
    <span className="shield-bar-group site-permission-chips" aria-label={`Permissions for ${hostOf(origin)}`}>
      {entries.map(([kind, decision]) => {
        const Icon = ICONS[kind]
        return (
          <button key={kind} type="button" className={`site-permission-chip is-${decision}`} onClick={() => onReset(kind)} title={`${NAMES[kind]} ${decision === 'allow' ? 'allowed' : 'blocked'} for this site. Click to forget; it will ask again.`}>
            <Icon size={12} aria-hidden="true" /> {NAMES[kind]} {decision === 'allow' ? 'allowed' : 'blocked'} ×
          </button>
        )
      })}
    </span>
  )
}
