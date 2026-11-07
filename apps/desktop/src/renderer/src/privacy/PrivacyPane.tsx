import { useState } from 'react'
import { Ban, EyeOff, Footprints, HardDrive, MapPin, Trash2, X } from 'lucide-react'
import { normalizeSite, type PrivacyState } from '@intoponet/browser-api'
import { RETENTION_OPTIONS, type PrivacySettings, type RetentionDays } from './privacySettings'
import { SiteTweaksList } from '../siteTweaks/SiteTweaksPanel'

/**
 * What this Mac keeps about your browsing, and the switches for it:
 * footprints, how long they last, private browsing, Time Machine, and your pins.
 */
export function PrivacyPane({
  settings,
  onSettings,
  state,
  onPrivateMode,
  onBackupExclusion,
  showPins,
  onShowPins,
  pinCount,
  hiddenPins,
  recentCount,
  onDeleteFootprints,
  currentUrl,
  onExcludedSites,
}: {
  settings: PrivacySettings
  onSettings: (next: PrivacySettings) => void
  state: PrivacyState | null
  onPrivateMode: (on: boolean) => void
  onBackupExclusion: (on: boolean) => void
  showPins: boolean
  onShowPins: (on: boolean) => void
  pinCount: number
  hiddenPins: number
  recentCount: number
  onDeleteFootprints: () => void
  currentUrl: string
  onExcludedSites: (sites: string[]) => void
}) {
  const [confirm, setConfirm] = useState(false)
  const [siteDraft, setSiteDraft] = useState('')
  const excluded = state?.excludedSites ?? []
  const currentSite = currentUrl ? normalizeSite(currentUrl) : null
  const addSite = (value: string): void => {
    const site = normalizeSite(value)
    if (site && !excluded.includes(site)) onExcludedSites([...excluded, site])
    setSiteDraft('')
  }
  const privateOn = state?.privateMode ?? false
  return (
    <div className="privacy-pane">
      <section>
        <h3><EyeOff size={13} aria-hidden="true" /> Private browsing</h3>
        <label className="privacy-switch">
          <input type="checkbox" checked={privateOn} onChange={(event) => onPrivateMode(event.target.checked)} />
          <span>Open new tabs privately (⇧⌘N)</span>
        </label>
        <p>Private tabs use a separate, in-memory session. They leave no recent pages, interest signals, cookies or cache, and are not restored. Turning this off closes them and wipes their session.{state && state.privateTabs > 0 ? ` ${state.privateTabs} private tab${state.privateTabs === 1 ? '' : 's'} open.` : ''}</p>
      </section>

      <section>
        <h3><Footprints size={13} aria-hidden="true" /> Footprints</h3>
        <label className="privacy-switch">
          <input type="checkbox" checked={settings.footprints} onChange={(event) => onSettings({ ...settings, footprints: event.target.checked })} />
          <span>Keep recent pages and interest signals</span>
        </label>
        <label className="privacy-select">
          <span>Keep recent pages for</span>
          <select
            value={settings.retentionDays}
            onChange={(event) => onSettings({ ...settings, retentionDays: Number(event.target.value) as RetentionDays })}
          >
            {RETENTION_OPTIONS.map((option) => <option key={option.days} value={option.days}>{option.label}</option>)}
          </select>
        </label>
        <p>Footprints stay on this Mac. Older pages are removed automatically. Saved pages, pins and collections are never removed by this.</p>
        <button
          type="button"
          className="privacy-danger"
          onClick={() => {
            if (!confirm) { setConfirm(true); return }
            setConfirm(false)
            onDeleteFootprints()
          }}
          onBlur={() => setConfirm(false)}
        >
          <Trash2 size={13} aria-hidden="true" /> {confirm ? `Confirm: delete ${recentCount} recent pages and signals` : 'Delete footprints now'}
        </button>
      </section>

      <section>
        <h3><Ban size={13} aria-hidden="true" /> Sites to leave out</h3>
        <p>Pages from these sites are never absorbed and leave no recent pages or interest signals. Banking, health, sign-in and payment pages are always left out.</p>
        <form className="privacy-site-form" onSubmit={(event) => { event.preventDefault(); addSite(siteDraft) }}>
          <input value={siteDraft} onChange={(event) => setSiteDraft(event.target.value)} placeholder="example.com" aria-label="Site to leave out" maxLength={253} />
          <button type="submit" disabled={!normalizeSite(siteDraft)}>Add</button>
          {currentSite && !excluded.includes(currentSite) && (
            <button type="button" onClick={() => addSite(currentSite)}>Add {currentSite}</button>
          )}
        </form>
        {excluded.length > 0 && (
          <ul className="privacy-sites">
            {excluded.map((site) => (
              <li key={site}>
                {site}
                <button type="button" aria-label={`Stop leaving out ${site}`} onClick={() => onExcludedSites(excluded.filter((item) => item !== site))}><X size={12} /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3><MapPin size={13} aria-hidden="true" /> Your pins on the globe</h3>
        <label className="privacy-switch">
          <input type="checkbox" checked={showPins} onChange={(event) => onShowPins(event.target.checked)} />
          <span>Show my pins on the globe</span>
        </label>
        <p>{pinCount === 0 ? 'No pins yet.' : `${pinCount} pin${pinCount === 1 ? '' : 's'}${hiddenPins ? `, ${hiddenPins} hidden one by one in Locations` : ''}. Hiding a pin keeps the page saved.`}</p>
      </section>

      <section>
        <h3><HardDrive size={13} aria-hidden="true" /> Backups</h3>
        {!state ? (
          <p>Time Machine status is unavailable on this computer.</p>
        ) : (
          <>
            <label className="privacy-switch">
              <input type="checkbox" checked={state.backupExclusionRequested === true || state.backupExcluded === true} disabled={!state.backupExclusionAvailable} onChange={(event) => onBackupExclusion(event.target.checked)} />
              <span>Leave my private library out of Time Machine</span>
            </label>
            <p>{!state.backupExclusionAvailable
              ? 'Time Machine exclusions are unavailable on this computer.'
              : state.backupExcluded === null
              ? state.backupExclusionRequested === true
                ? 'Your exclusion request is saved, but Time Machine status is partial or unavailable. Missing stores will be excluded when created if this app can apply the setting. Existing backups and local snapshots are unchanged.'
                : 'Time Machine status is partial or unavailable on this computer. The switch records your choice for the named private-store paths.'
              : state.backupExcluded
                ? 'Time Machine currently skips the named library, knowledge, meaning-index and personal-data paths. Existing backups and local snapshots are unchanged.'
                : 'Time Machine includes the named paths in future backups with the rest of this Mac.'}</p>
          </>
        )}
      </section>

      <section>
        <SiteTweaksList />
      </section>
    </div>
  )
}
