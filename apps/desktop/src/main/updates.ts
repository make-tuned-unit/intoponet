import type { UpdateCommand, UpdateStatus } from '@intoponet/browser-api'

type UpdateEvents = {
  'checking-for-update': () => void
  'update-available': () => void
  'update-not-available': () => void
  'update-downloaded': () => void
  error: () => void
}

export interface UpdateAdapter {
  on<K extends keyof UpdateEvents>(event: K, listener: UpdateEvents[K]): unknown
  setFeedURL(options: { url: string; serverType: 'json' }): void
  checkForUpdates(): void
  quitAndInstall(): void
}

export type UpdateControllerOptions = {
  enabled: boolean
  packaged: boolean
  platform: string
  currentVersion: string
  feedUrl?: string
  adapter: UpdateAdapter | undefined
  emit: (status: UpdateStatus) => void
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

  constructor(options: UpdateControllerOptions) {
    this.adapter = options.adapter
    this.emit = options.emit
    const feedUrl = validatedUpdateFeedUrl(options.feedUrl)
    const disabledReason = !options.packaged
      ? 'preview'
      : options.platform !== 'darwin'
        ? 'unsupported-platform'
        : !options.enabled || !feedUrl || !options.adapter
          ? 'not-configured'
          : undefined
    this.statusValue = disabledReason
      ? { state: 'disabled', currentVersion: options.currentVersion, disabledReason }
      : { state: 'idle', currentVersion: options.currentVersion }

    if (this.statusValue.state === 'disabled' || !this.adapter || !feedUrl) return
    try {
      this.adapter.setFeedURL({ url: `${feedUrl}/releases.json`, serverType: 'json' })
      this.active = true
    } catch {
      this.statusValue = { state: 'disabled', currentVersion: options.currentVersion, disabledReason: 'not-configured', error: genericFailure }
      return
    }
    this.adapter.on('checking-for-update', () => this.set('checking'))
    this.adapter.on('update-available', () => this.set('downloading'))
    this.adapter.on('update-not-available', () => this.set('not-available'))
    this.adapter.on('update-downloaded', () => this.set('downloaded'))
    this.adapter.on('error', () => this.set('error', genericFailure))
  }

  status(): UpdateStatus {
    return { ...this.statusValue }
  }

  handle(command: UpdateCommand): UpdateStatus {
    if (command.type === 'status') return this.status()
    if (this.statusValue.state === 'disabled' || !this.adapter || !this.active) return this.status()
    if (command.type === 'check-and-download') {
      if (this.statusValue.state === 'checking' || this.statusValue.state === 'downloading' || this.statusValue.state === 'downloaded') return this.status()
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

  private set(state: UpdateStatus['state'], error?: string): void {
    const { error: _previousError, ...status } = this.statusValue
    this.statusValue = { ...status, state, ...(error ? { error } : {}) }
    this.emit(this.status())
  }
}
