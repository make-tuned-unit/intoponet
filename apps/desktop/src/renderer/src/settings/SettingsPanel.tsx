import { useMemo, useState } from 'react'
import { Compass, Languages, LockKeyhole, Play, Settings, Trash2, X } from 'lucide-react'
import { formatMegabytes, languageName, nativeName, type TranslateModel } from '../translate/useTranslate'
import { withNeverTranslate, type AppSettings } from './appSettings'
import { BeaconSettings } from '../beacons/BeaconSettings'
import { LayaSettings } from './LayaSettings'
import { UpdatesSettings } from './UpdatesSettings'
import { PasswordSettings } from '../passwords/PasswordSettings'
import { BrowsingSettings } from '../browsing/BrowsingSettings'
import { BrowserImportSettings } from '../browserImport/BrowserImportSettings'
import type { LibraryImportCounts } from '../browserImport/mergeImport'
import brandSymbol from '../brand/intoponet-mark-spectrum.svg'

/** Settings: your reading language, automatic translation, downloaded languages, and a way to Privacy. */
export function SettingsPanel({
  translation,
  settings,
  onSettings,
  headlinesTranslated,
  onHeadlinesTranslated,
  onOpenPrivacy,
  onClose,
  onTour,
  libraryReady = false,
  onImportLibrary,
}: {
  translation: TranslateModel
  settings: AppSettings
  onSettings: (next: AppSettings) => void
  headlinesTranslated: boolean
  onHeadlinesTranslated: (on: boolean) => void
  onOpenPrivacy: () => void
  onClose: () => void
  /** Start the guided tour. */
  onTour?: () => void
  /** Import from another browser: whether the library is open, and how bookmarks are merged into it. */
  libraryReady?: boolean
  onImportLibrary?: (payload: string) => LibraryImportCounts | null
}) {
  const { status, target } = translation
  const [busy, setBusy] = useState('')
  const codes = useMemo(() => {
    const list = ['en', ...(status?.languages.map((language) => language.code) ?? [])]
    return [...new Set(list)].sort((a, b) => languageName(a).localeCompare(languageName(b)))
  }, [status])
  const sizeOf = (code: string): number => {
    const language = status?.languages.find((item) => item.code === code)
    const engine = status && !status.engine.downloaded ? status.engine.bytes : 0
    return language && !language.downloaded ? language.bytes + engine : 0
  }
  const downloaded = status?.languages.filter((language) => language.downloaded) ?? []
  const chooseLanguage = async (code: string): Promise<void> => {
    translation.setTarget(code)
    if (!translation.ready.has(code)) {
      setBusy(code)
      await translation.install(code)
      setBusy('')
    }
  }
  const downloading = status?.downloading ?? null

  return (
    <aside className="settings-drawer bookmark-drawer lg-surface" aria-labelledby="settings-heading">
      <div className="drawer-heading">
        <div>
          <span className="drawer-brand"><img src={brandSymbol} alt="" width={30} height={16} />intoponet</span>
          <h2 id="settings-heading"><Settings size={17} aria-hidden="true" /> Settings</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close settings"><X size={17} /></button>
      </div>
      <div className="privacy-pane settings-pane">
        {onTour && (
          <section className="settings-tour">
            <h3><Compass size={13} aria-hidden="true" /> Tour</h3>
            <p>A guided tour of the globe, story mountains, The Olds, your library, tabs and page tools, Knowledge and beacons, using the app itself. About three minutes; replay it any time.</p>
            <button type="button" className="settings-primary" onClick={onTour}><Play size={13} aria-hidden="true" /> Take the tour</button>
          </section>
        )}

        <section>
          <h3><Languages size={13} aria-hidden="true" /> Your language</h3>
          <label className="privacy-select" title="Your preferred language. It starts as your Mac's language (System Settings › General › Language & Region).">
            <span>Read the web in</span>
            <select value={target} onChange={(event) => void chooseLanguage(event.target.value)} disabled={!!busy}>
              {codes.map((code) => (
                <option key={code} value={code}>
                  {languageName(code)}{code !== 'en' && nativeName(code) !== languageName(code) ? ` · ${nativeName(code)}` : ''}{translation.ready.has(code) ? '' : ` · ${formatMegabytes(sizeOf(code))}`}
                </option>
              ))}
            </select>
          </label>
          {downloading && <p role="status">Downloading {languageName(downloading.code)} · {formatMegabytes(downloading.receivedBytes)} of {formatMegabytes(downloading.totalBytes)}</p>}
          <label className="privacy-switch">
            <input type="checkbox" checked={settings.autoTranslate} onChange={(event) => onSettings({ ...settings, autoTranslate: event.target.checked })} />
            <span>Translate pages and headlines into {languageName(target)} automatically</span>
          </label>
          <label className="privacy-switch">
            <input type="checkbox" checked={headlinesTranslated} disabled={!settings.autoTranslate} onChange={(event) => onHeadlinesTranslated(event.target.checked)} />
            <span>Show news headlines and story titles in {languageName(target)}</span>
          </label>
          <p>Translation runs on this Mac with open models (Firefox Translations); no text leaves your device. The first time a page needs a language, it downloads by itself: a one-time 40–140 MB (most are about 70 MB), shown as it goes. Each list of headlines downloads at most two new languages by itself (its most used); others show a button with their size. Choose “Original” in the translate bar to read a page untranslated; it stays that way for that page. Intoponet’s own menus are in English for now.</p>
          {settings.neverTranslate.length > 0 && (
            <>
              <h4>Never translated</h4>
              <ul className="settings-languages">
                {settings.neverTranslate.map((site) => (
                  <li key={site}>
                    <span>{site}</span>
                    <button type="button" aria-label={`Translate ${site} automatically again`} title="Translate this site automatically again" onClick={() => onSettings(withNeverTranslate(settings, site, false))}>
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section>
          <h3>Downloaded languages</h3>
          {downloaded.length === 0 ? (
            <p>None yet. English needs no download.</p>
          ) : (
            <ul className="settings-languages">
              {downloaded.map((language) => (
                <li key={language.code}>
                  <span>{languageName(language.code)} <small>{formatMegabytes(language.bytes)}</small></span>
                  <button type="button" aria-label={`Remove ${languageName(language.code)}`} title="Remove this language from this Mac" disabled={language.code === target} onClick={() => void translation.remove(language.code)}>
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {translation.error && <p className="settings-error" role="alert">{translation.error}</p>}
        </section>

        <BrowsingSettings />

        <PasswordSettings />

        <BrowserImportSettings libraryReady={libraryReady} {...(onImportLibrary ? { onImportLibrary } : {})} />

        <LayaSettings />

        <BeaconSettings />

        <UpdatesSettings />

        <section>
          <h3>Credits and licences</h3>
          <p>Intoponet is proprietary software (all rights reserved). It is built on, and shows, the work of others:</p>
          <ul className="settings-credits">
            <li><strong>Wikipedia</strong> text in The Olds and World stories, CC BY-SA 4.0, often shortened or translated on this Mac. Each passage links to its article.</li>
            <li><strong>Wikidata</strong> facts and links, CC0. <strong>Wikimedia</strong> pageviews, CC0.</li>
            <li><strong>GeoNames</strong> place names and coordinates, CC BY 4.0 (geonames.org).</li>
            <li><strong>Natural Earth</strong> country shapes and map labels, public domain (naturalearthdata.com).</li>
            <li><strong>Firefox Translations</strong> models and the Bergamot engine, Mozilla, MPL-2.0. Run on this Mac.</li>
            <li><strong>all-MiniLM-L6-v2</strong> (Laya’s meaning model), sentence-transformers, Apache-2.0. Runs on this Mac.</li>
            <li><strong>NASA</strong> Earth imagery (Blue Marble, Black Marble) and EONET natural events; <strong>USGS</strong> earthquakes. Public domain.</li>
            <li><strong>News headlines</strong> belong to their publishers. Intoponet shows titles and links to the original articles.</li>
            <li><strong>Electron and Chromium</strong>, MIT and their component licences. The full list is in THIRD_PARTY_NOTICES.md.</li>
          </ul>
        </section>

        <section>
          <h3><LockKeyhole size={13} aria-hidden="true" /> Privacy</h3>
          <p>Private browsing, footprints, how long recent pages are kept, Time Machine, and your pins on the globe.</p>
          <button type="button" className="settings-link" onClick={onOpenPrivacy}>Open Privacy settings</button>
        </section>
      </div>
    </aside>
  )
}
