import { useEffect, useState } from 'react'
import { Globe2 } from 'lucide-react'
import type { BrowsingSettings as Settings, PageAppearance, TabSleepAfter, TabSwitchOrder } from '@intoponet/browser-api'
import './browsing.css'

const APPEARANCES: Array<{ value: PageAppearance; label: string }> = [
  { value: 'system', label: 'Match system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const SLEEP_AFTER: Array<{ value: TabSleepAfter; label: string }> = [
  { value: 'never', label: 'Never' },
  { value: '15m', label: '15 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hours' },
]

const SWITCH_ORDERS: Array<{ value: TabSwitchOrder; label: string }> = [
  { value: 'strip', label: 'As in the tab bar' },
  { value: 'recent', label: 'Recently used first' },
]

/** Settings › Browsing: how pages are coloured, and Intoponet as the default browser. */
export function BrowsingSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    const refresh = (): void => { void window.intoponet.browsing.settings().then((next) => { if (mounted) setSettings(next) }, () => undefined) }
    refresh()
    // macOS asks to confirm a new default browser in its own window: look again when the app is back in front.
    window.addEventListener('focus', refresh)
    const unsubscribe = window.intoponet.browsing.subscribe((event) => { if (event.type === 'settings' && mounted) setSettings(event.settings) })
    return () => { mounted = false; window.removeEventListener('focus', refresh); unsubscribe() }
  }, [])

  const choose = (appearance: PageAppearance): void => {
    setError('')
    void window.intoponet.browsing.setPageAppearance(appearance).then(setSettings, () => setError('The page appearance could not be changed.'))
  }
  const chooseSleep = (after: TabSleepAfter): void => {
    setError('')
    void window.intoponet.browsing.setTabSleep(after).then(setSettings, () => setError('The tab sleep setting could not be changed.'))
  }
  const chooseOrder = (order: TabSwitchOrder): void => {
    setError('')
    void window.intoponet.browsing.setTabSwitchOrder(order).then(setSettings, () => setError('The tab order setting could not be changed.'))
  }
  const makeDefault = (): void => {
    setError('')
    void window.intoponet.browsing.makeDefaultBrowser().then(setSettings, () => setError('macOS did not change the default browser.'))
  }

  return (
    <section aria-labelledby="browsing-heading" className="browsing-settings">
      <h3 id="browsing-heading"><Globe2 size={13} aria-hidden="true" /> Browsing</h3>
      <p id="page-appearance-label">Pages: light or dark. “Match system” follows your Mac’s appearance. Intoponet’s own look does not change.</p>
      <div className="browsing-appearance" role="group" aria-labelledby="page-appearance-label">
        {APPEARANCES.map((item) => (
          <button key={item.value} type="button" aria-pressed={settings?.pageAppearance === item.value} disabled={!settings} onClick={() => choose(item.value)}>
            {item.label}
          </button>
        ))}
      </div>
      <p id="tab-sleep-label">Sleep background tabs after: an unseen tab’s page is unloaded to save memory and loads again where it was. Tabs playing sound, in a call, downloading or holding typed text stay awake.</p>
      <div className="browsing-appearance" role="group" aria-labelledby="tab-sleep-label">
        {SLEEP_AFTER.map((item) => (
          <button key={item.value} type="button" aria-pressed={settings?.tabSleep === item.value} disabled={!settings} onClick={() => chooseSleep(item.value)}>
            {item.label}
          </button>
        ))}
      </div>
      <p id="tab-order-label">⌃Tab moves between tabs:</p>
      <div className="browsing-appearance" role="group" aria-labelledby="tab-order-label">
        {SWITCH_ORDERS.map((item) => (
          <button key={item.value} type="button" aria-pressed={settings?.tabSwitchOrder === item.value} disabled={!settings} onClick={() => chooseOrder(item.value)}>
            {item.label}
          </button>
        ))}
      </div>
      <p className="browsing-default-status" role="status">
        {!settings ? 'Checking the default browser…' : settings.defaultBrowser.isDefault ? 'Intoponet is your default browser.' : 'Intoponet is not your default browser.'}
      </p>
      {settings && !settings.defaultBrowser.isDefault && (
        settings.defaultBrowser.canSet ? (
          <button type="button" className="settings-primary" onClick={makeDefault}>Make Intoponet your default browser</button>
        ) : (
          <p>Available in the installed app (Intoponet in Applications). You can also choose it in System Settings › Desktop &amp; Dock › Default web browser.</p>
        )
      )}
      {error && <p className="settings-error" role="alert">{error}</p>}
    </section>
  )
}
