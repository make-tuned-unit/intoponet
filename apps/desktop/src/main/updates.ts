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

/** A hand-edited or damaged updates.json must not stop the app: keep only values that make sense. */
export function sanitizedPreferences(stored: unknown, now: number): UpdatePreferences {
  const record = typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? stored as Record<string, unknown> : {}
  const automatic = typeof record['automatic'] === 'boolean' ? record['automatic'] : true
  const checkedAt = record['lastCheckedAt']
  // A real past check (with a day of clock slack), never a date Date cannot represent.
  const valid = typeof checkedAt === 'number' && Number.isFinite(checkedAt) && checkedAt > 0 && checkedAt <= now + 24 * 60 * 60 * 1000
  return { automatic, ...(valid ? { lastCheckedAt: checkedAt } : {}) }
}

type SemVer = { core: [number, number, number]; pre: string[] }

function parseSemVer(value: string): SemVer | null {
  const match = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (!match) return null
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ? match[4].split('.') : [] }
}

/**
 * Semantic-version order: -1, 0 or 1; null when either is not a version. 0.1.10 is after 0.1.9,
 * and a prerelease (1.0.0-beta.2) comes before its release (1.0.0).
 */
export function compareVersions(left: string, right: string): number | null {
  const a = parseSemVer(left)
  const b = parseSemVer(right)
  if (!a || !b) return null
  for (let i = 0; i < 3; i += 1) if (a.core[i] !== b.core[i]) return a.core[i]! < b.core[i]! ? -1 : 1
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i += 1) {
    const x = a.pre[i]
    const y = b.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xNum = /^\d+$/.test(x)
    const yNum = /^\d+$/.test(y)
    if (xNum && yNum) return Number(x) < Number(y) ? -1 : 1
    if (xNum !== yNum) return xNum ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}

/** Only a strictly newer version is ever installed: never the same, an older one, or something unreadable. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) === 1
}

/** The feed's `currentRelease`, read with a small size cap; null when it cannot be read. */
export async function fetchCurrentRelease(manifestUrl: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const response = await fetchImpl(manifestUrl, { cache: 'no-store', signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json' } })
  if (!response.ok) return null
  const text = await response.text()
  if (text.length > 256 * 1024) return null
  const manifest = JSON.parse(text) as unknown
  const current = typeof manifest === 'object' && manifest !== null ? (manifest as Record<string, unknown>)['currentRelease'] : undefined
  return typeof current === 'string' && current.length <= 64 ? current : null
}

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
  /**
   * The version the feed offers (its releases.json `currentRelease`). Squirrel installs whatever
   * the feed names, even an older build, so the check only goes ahead when this is newer.
   */
  latestVersion?: (manifestUrl: string) => Promise<string | null>
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
  private readonly latestVersion: (manifestUrl: string) => Promise<string | null>
  private manifestUrl = ''
  private readonly currentVersion: string

  constructor(options: UpdateControllerOptions) {
    this.adapter = options.adapter
    this.emit = options.emit
    this.preferences = options.preferences
    this.latestVersion = options.latestVersion ?? ((url) => fetchCurrentRelease(url))
    this.currentVersion = options.currentVersion
    this.now = options.now ?? Date.now
    this.schedule = options.schedule ?? ((run, delayMs) => { const handle = setTimeout(run, delayMs); handle.unref?.(); return { cancel: () => clearTimeout(handle) } })
    // Automatic checks are on unless the person turned them off.
    let stored: UpdatePreferences | undefined
    try { stored = this.preferences?.load() } catch { stored = undefined }
    this.prefs = sanitizedPreferences(stored, this.now())
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
      this.manifestUrl = `${feedUrl}/releases.json`
      this.adapter.setFeedURL({ url: this.manifestUrl, serverType: 'json' })
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
      const version = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(name)?.[0] ?? ''
      // A downloaded build that is not newer (the feed changed after the check) is never offered.
      if (version && !isNewerVersion(version, this.currentVersion)) {
        this.set('not-available')
        return
      }
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
      const adapter = this.adapter
      // Read the feed first: Squirrel would install whatever it names, an older build included.
      void this.latestVersion(this.manifestUrl).then((latest) => {
        if (this.statusValue.state !== 'checking') return
        if (!latest || !isNewerVersion(latest, this.currentVersion)) {
          this.set('not-available')
          return
        }
        // Electron's native Squirrel.Mac updater downloads an available update as part of this check.
        adapter.checkForUpdates()
      }).catch(() => {
        if (this.statusValue.state === 'checking') this.set('error', genericFailure)
      })
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
