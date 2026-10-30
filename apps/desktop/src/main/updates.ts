import type { UpdateCommand, UpdateStatus } from '@intoponet/browser-api'

type UpdateEvents = {
  'checking-for-update': () => void
  'update-available': () => void
  'update-not-available': () => void
  'update-downloaded': (...args: unknown[]) => void
  error: () => void
}

export interface UpdateAdapter {
  on<K extends keyof UpdateEvents>(event: K, listener: UpdateEvents[K]): unknown
  setFeedURL(options: { url: string; serverType: 'json' }): void
  checkForUpdates(): void
  quitAndInstall(): void
}

export type UpdatePreferences = { automatic: boolean; lastCheckedAt?: number }

/** First automatic check after launch, then roughly daily while the app is open. */
export const AUTO_FIRST_DELAY_MS = 45_000
export const AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000

export type UpdateControllerOptions = {
  enabled: boolean
  packaged: boolean
  platform: string
  currentVersion: string
  feedUrl?: string
  adapter: UpdateAdapter | undefined
  emit: (status: UpdateStatus) => void
  /** Where the automatic-check setting and the last check time are kept between launches. */
  preferences?: { load(): UpdatePreferences; save(preferences: UpdatePreferences): void }
  now?: () => number
  schedule?: (run: () => void, delayMs: number) => { cancel(): void }
}

const genericFailure = 'The update operation failed. Try again later.'

export function validatedUpdateFeedUrl(value: string | undefined): string | null {
  if (!value || value.length > 2_048) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) return null
    if (!url.hostname.includes('.') || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) return null
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(url.hostname) || url.hostname.includes(':') || (url.port && url.port !== '443')) return null
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export class UpdateController {
  private statusValue: UpdateStatus
  private readonly adapter: UpdateAdapter | undefined
  private readonly emit: (status: UpdateStatus) => void
  private active = false
  private readonly preferences: UpdateControllerOptions['preferences']
  private prefs: UpdatePreferences
  private readonly now: () => number
  private readonly schedule: NonNullable<UpdateControllerOptions['schedule']>
  private timer: { cancel(): void } | null = null

  constructor(options: UpdateControllerOptions) {
    this.adapter = options.adapter
    this.emit = options.emit
    this.preferences = options.preferences
    this.now = options.now ?? Date.now
    this.schedule = options.schedule ?? ((run, delayMs) => { const handle = setTimeout(run, delayMs); handle.unref?.(); return { cancel: () => clearTimeout(handle) } })
    // Automatic checks are on unless the person turned them off.
    let stored: UpdatePreferences | undefined
    try { stored = this.preferences?.load() } catch { stored = undefined }
    this.prefs = { automatic: stored?.automatic ?? true, ...(typeof stored?.lastCheckedAt === 'number' ? { lastCheckedAt: stored.lastCheckedAt } : {}) }
    const feedUrl = validatedUpdateFeedUrl(options.feedUrl)
    const disabledReason = !options.packaged
      ? 'preview'
      : options.platform !== 'darwin'
        ? 'unsupported-platform'
        : !options.enabled || !feedUrl || !options.adapter
          ? 'not-configured'
          : undefined
    const prefsStatus = { automatic: this.prefs.automatic, ...(this.prefs.lastCheckedAt ? { lastCheckedAt: new Date(this.prefs.lastCheckedAt).toISOString() } : {}) }
    this.statusValue = disabledReason
      ? { state: 'disabled', currentVersion: options.currentVersion, disabledReason, ...prefsStatus }
      : { state: 'idle', currentVersion: options.currentVersion, ...prefsStatus }

    if (this.statusValue.state === 'disabled' || !this.adapter || !feedUrl) return
    try {
      this.adapter.setFeedURL({ url: `${feedUrl}/releases.json`, serverType: 'json' })
      this.active = true
    } catch {
      this.statusValue = { state: 'disabled', currentVersion: options.currentVersion, disabledReason: 'not-configured', error: genericFailure, ...prefsStatus }
      return
    }
    this.adapter.on('checking-for-update', () => this.set('checking'))
    this.adapter.on('update-available', () => this.set('downloading'))
    this.adapter.on('update-not-available', () => this.set('not-available'))
    // Electron passes (event, releaseNotes, releaseName, …); the feed's name is the version.
    this.adapter.on('update-downloaded', (...args: unknown[]) => {
      const name = typeof args[2] === 'string' ? args[2].trim() : ''
      const version = /^\d+\.\d+\.\d+/.exec(name)?.[0] ?? (/^\d+\.\d+\.\d+/.test(name) ? name : '')
      if (version) this.statusValue = { ...this.statusValue, availableVersion: version }
      this.set('downloaded')
    })
    this.adapter.on('error', () => this.set('error', genericFailure))
  }

  status(): UpdateStatus {
    return { ...this.statusValue }
  }

  handle(command: UpdateCommand): UpdateStatus {
    if (command.type === 'status') return this.status()
    if (command.type === 'set-automatic') {
      this.prefs = { ...this.prefs, automatic: command.enabled }
      this.persist()
      this.statusValue = { ...this.statusValue, automatic: command.enabled }
      if (command.enabled) this.startAutomatic()
      else { this.timer?.cancel(); this.timer = null }
      this.emit(this.status())
      return this.status()
    }
    if (this.statusValue.state === 'disabled' || !this.adapter || !this.active) return this.status()
    if (command.type === 'check-and-download') {
      if (this.statusValue.state === 'checking' || this.statusValue.state === 'downloading' || this.statusValue.state === 'downloaded') return this.status()
      this.prefs = { ...this.prefs, lastCheckedAt: this.now() }
      this.persist()
      this.statusValue = { ...this.statusValue, lastCheckedAt: new Date(this.prefs.lastCheckedAt!).toISOString() }
      this.set('checking')
      try {
        // Electron's native Squirrel.Mac updater downloads an available update as part of this check.
        this.adapter.checkForUpdates()
      } catch {
        this.set('error', genericFailure)
      }
      return this.status()
    }
    if (this.statusValue.state === 'downloaded') {
      try {
        this.adapter.quitAndInstall()
      } catch {
        this.set('downloaded', 'Restart to install failed. Close and reopen Intoponet to apply the downloaded update.')
      }
    }
    return this.status()
  }

  /** Schedules the next automatic check: soon after launch, otherwise a day after the last one. */
  startAutomatic(): void {
    this.timer?.cancel()
    this.timer = null
    if (!this.active || !this.prefs.automatic || this.statusValue.state === 'disabled') return
    const sinceLast = this.prefs.lastCheckedAt ? this.now() - this.prefs.lastCheckedAt : Infinity
    const delay = Math.max(AUTO_FIRST_DELAY_MS, Number.isFinite(sinceLast) ? AUTO_INTERVAL_MS - sinceLast : 0)
    this.timer = this.schedule(() => {
      this.timer = null
      const state = this.statusValue.state
      // Never interrupt a check in progress or replace an update that is waiting to install.
      if (this.prefs.automatic && state !== 'checking' && state !== 'downloading' && state !== 'downloaded') this.handle({ type: 'check-and-download' })
      this.startAutomatic()
    }, delay)
  }

  private persist(): void {
    try { this.preferences?.save(this.prefs) } catch { /* a setting that fails to save still applies for this session */ }
  }

  private set(state: UpdateStatus['state'], error?: string): void {
    const { error: _previousError, ...status } = this.statusValue
    this.statusValue = { ...status, state, ...(error ? { error } : {}) }
    this.emit(this.status())
  }
}
