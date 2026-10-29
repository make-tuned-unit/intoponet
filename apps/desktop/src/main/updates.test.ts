import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { parseUpdateCommand } from '@intoponet/browser-api'
import { UpdateController, validatedUpdateFeedUrl, type UpdateAdapter } from './updates'

class FakeUpdater extends EventEmitter implements UpdateAdapter {
  feed: { url: string; serverType: 'json' } | null = null
  checkForUpdates = vi.fn()
  quitAndInstall = vi.fn()
  setFeedURL = vi.fn((options: { url: string; serverType: 'json' }) => { this.feed = options })
}

const enabledOptions = (adapter: FakeUpdater, emit = vi.fn()) => ({
  enabled: true,
  packaged: true,
  platform: 'darwin',
  currentVersion: '1.2.3',
  feedUrl: 'https://updates.example.org/intoponet',
  adapter,
  emit,
})

describe('manual update controller', () => {
  it('disables preview, unsupported, unconfigured, and malformed feeds without initializing updater', () => {
    const preview = new FakeUpdater()
    expect(new UpdateController({ ...enabledOptions(preview), packaged: false }).status()).toMatchObject({ state: 'disabled', disabledReason: 'preview' })
    const unsupported = new FakeUpdater()
    expect(new UpdateController({ ...enabledOptions(unsupported), platform: 'linux' }).status()).toMatchObject({ state: 'disabled', disabledReason: 'unsupported-platform' })
    const absent = new FakeUpdater()
    expect(new UpdateController({ ...enabledOptions(absent), enabled: false }).status()).toMatchObject({ state: 'disabled', disabledReason: 'not-configured' })
    const malformed = new FakeUpdater()
    expect(new UpdateController({ ...enabledOptions(malformed), feedUrl: 'http://updates.example.org' }).status()).toMatchObject({ state: 'disabled', disabledReason: 'not-configured' })
    expect(preview.setFeedURL).not.toHaveBeenCalled()
    expect(unsupported.setFeedURL).not.toHaveBeenCalled()
    expect(absent.setFeedURL).not.toHaveBeenCalled()
    expect(malformed.setFeedURL).not.toHaveBeenCalled()
  })

  it('configures the JSON feed but performs no request until the user asks', () => {
    const adapter = new FakeUpdater()
    const controller = new UpdateController(enabledOptions(adapter))
    expect(adapter.feed).toEqual({ url: 'https://updates.example.org/intoponet/releases.json', serverType: 'json' })
    expect(adapter.checkForUpdates).not.toHaveBeenCalled()
    expect(controller.status()).toMatchObject({ state: 'idle', currentVersion: '1.2.3' })
  })

  it('requires explicit check and explicit restart, and ignores duplicate checks while active', () => {
    const adapter = new FakeUpdater()
    const emit = vi.fn()
    const controller = new UpdateController(enabledOptions(adapter, emit))
    expect(controller.handle({ type: 'check-and-download' }).state).toBe('checking')
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(1)
    controller.handle({ type: 'check-and-download' })
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(adapter.quitAndInstall).not.toHaveBeenCalled()

    adapter.emit('update-available')
    expect(controller.status().state).toBe('downloading')
    adapter.emit('update-downloaded')
    expect(controller.status().state).toBe('downloaded')
    expect(adapter.quitAndInstall).not.toHaveBeenCalled()
    controller.handle({ type: 'restart' })
    expect(adapter.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith({ state: 'downloaded', currentVersion: '1.2.3', error: undefined })
  })

  it('does not expose raw error details that could contain URLs or request data', () => {
    const adapter = new FakeUpdater()
    const controller = new UpdateController(enabledOptions(adapter))
    controller.handle({ type: 'check-and-download' })
    adapter.emit('error', new Error('https://secret.example/token=private'))
    expect(controller.status()).toEqual({ state: 'error', currentVersion: '1.2.3', error: 'The update operation failed. Try again later.' })
  })

  it('fails closed if native feed setup throws and preserves a downloaded update if restart throws', () => {
    const setupFailure = new FakeUpdater()
    setupFailure.setFeedURL.mockImplementation(() => { throw new Error('secret feed details') })
    const disabled = new UpdateController(enabledOptions(setupFailure))
    expect(disabled.status()).toMatchObject({ state: 'disabled', disabledReason: 'not-configured', error: 'The update operation failed. Try again later.' })
    expect(disabled.handle({ type: 'check-and-download' }).state).toBe('disabled')
    expect(setupFailure.checkForUpdates).not.toHaveBeenCalled()

    const restartFailure = new FakeUpdater()
    restartFailure.quitAndInstall.mockImplementation(() => { throw new Error('secret install details') })
    const controller = new UpdateController(enabledOptions(restartFailure))
    controller.handle({ type: 'check-and-download' })
    restartFailure.emit('update-downloaded')
    const result = controller.handle({ type: 'restart' })
    expect(result.state).toBe('downloaded')
    expect(result.error).toBe('Restart to install failed. Close and reopen Intoponet to apply the downloaded update.')
  })
})

describe('update feed and IPC validation', () => {
  it('accepts HTTPS host-only feed paths and rejects credentials, query, local hosts, and plain HTTP', () => {
    expect(validatedUpdateFeedUrl('https://updates.example.org/releases/')).toBe('https://updates.example.org/releases')
    for (const url of [
      'http://updates.example.org',
      'https://user:pass@updates.example.org',
      'https://updates.example.org?token=x',
      'https://localhost:8443',
      'https://127.0.0.1',
      'https://updates.local',
    ]) expect(validatedUpdateFeedUrl(url)).toBeNull()
  })

  it('accepts only known updater commands', () => {
    expect(parseUpdateCommand({ type: 'check-and-download' })).toEqual({ type: 'check-and-download' })
    expect(() => parseUpdateCommand({ type: 'download', url: 'https://attacker.example' })).toThrow(/Invalid update command/)
    expect(() => parseUpdateCommand({ type: 'status', extra: 'ignored' })).toThrow(/Invalid update command/)
    expect(() => parseUpdateCommand(null)).toThrow(/Invalid update command/)
  })
})
