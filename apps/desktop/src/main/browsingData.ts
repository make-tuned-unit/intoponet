import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { app, session, shell, type BrowserWindow, type IpcMainInvokeEvent, type WebContents } from 'electron'
import {
  clearRangeStart,
  downloadChannels,
  historyChannels,
  parseDownloadCommand,
  parseHistoryCommand,
  type ClearBrowsingDataRequest,
  type ClearBrowsingDataResult,
  type DownloadEvent,
  type HistoryEvent,
} from '@intoponet/browser-api'
import { writeFileAtomic, writeFileAtomicSync } from './atomicFile'
import { LatestWriter } from './latestWriter'
import { DownloadManager, type DownloadRecord } from './downloadManager'
import { reserveDownloadPath, sanitizeDownloadFilename } from './downloadReservation'
import { HistoryStore } from './historyStore'
import { ensureQuarantine } from './quarantine'

/**
 * Downloads manager, browsing history and "Clear browsing data", wired to Electron. index.ts calls
 * installBrowsingData once, wireSession for each page session, and attachPage for each tab.
 */
export type BrowsingDataOptions = {
  getWindow: () => BrowserWindow | null
  /** ipcMain.handle restricted to the app shell. */
  handle: (channel: string, handler: (event: IpcMainInvokeEvent, value: unknown) => unknown) => void
  excludedSites: () => readonly string[]
  normalPartition: string
  privatePartition: string
  seal: {
    available: () => Promise<boolean>
    encrypt: (text: string) => Promise<Buffer>
    decrypt: (sealed: Buffer) => Promise<string>
    /** For the last save while quitting. */
    encryptSync: (text: string) => Buffer
    availableSync: () => boolean
  }
  /** History was cleared from `since` (ms): things kept with it (Archived tabs) go too. */
  onHistoryCleared?: (since: number) => void
  /** Each finished download (for the "Saved … to Downloads" notice). */
  onDownloadDone?: (entry: { filename: string; path: string; state: 'completed' | 'cancelled' | 'interrupted' }) => void
}

export type BrowsingData = {
  downloads: DownloadManager
  history: HistoryStore
  wireSession: (partition: string) => void
  attachPage: (contents: WebContents, isPrivate: () => boolean) => void
  /** Sites left out changed: forget their visits. */
  excludedSitesChanged: () => void
  /** Private browsing ended: its downloads leave the list. */
  privateBrowsingEnded: () => void
  clearBrowsingData: (request: ClearBrowsingDataRequest) => Promise<ClearBrowsingDataResult>
}

let current: { options: BrowsingDataOptions; data: BrowsingData } | null = null

function send(channel: string, event: unknown): void {
  const window = current?.options.getWindow()
  if (window && !window.isDestroyed()) window.webContents.send(channel, event)
}

/**
 * Open the History view in the app window (bound to ⌘Y by the app menu). Safe to call before the
 * app is ready or with no window: it then does nothing.
 */
export function openHistoryPane(): void {
  const window = current?.options.getWindow()
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.focus()
  window.webContents.focus()
  const event: HistoryEvent = { type: 'open' }
  window.webContents.send(historyChannels.event, event)
}

/** Where downloads are saved (tests point this at a temporary folder). */
export function downloadsDirectory(): string {
  const override = process.env['INTOPONET_DOWNLOADS_DIR']
  if (override) {
    mkdirSync(override, { recursive: true })
    return override
  }
  return app.getPath('downloads')
}

export function installBrowsingData(options: BrowsingDataOptions): BrowsingData {
  const personal = join(app.getPath('userData'), 'personal')
  mkdirSync(personal, { recursive: true, mode: 0o700 })
  const downloadsFile = join(personal, 'downloads.v1.json')
  const historyFile = join(personal, 'history.v1.seal')

  // ---- Downloads --------------------------------------------------------------------------------
  const downloadWriter = new LatestWriter<DownloadRecord[]>((records) => writeFileAtomic(downloadsFile, JSON.stringify(records)))
  const downloads = new DownloadManager({
    downloadsDir: downloadsDirectory,
    reserve: (directory, filename) => reserveDownloadPath(directory, filename),
    sanitize: sanitizeDownloadFilename,
    emit: (list) => {
      const event: DownloadEvent = { type: 'list', downloads: list }
      send(downloadChannels.event, event)
    },
    persist: (records) => { void downloadWriter.save(records).catch((error: unknown) => console.error('Could not save the downloads list:', error)) },
    openPath: (path) => shell.openPath(path),
    showItemInFolder: (path) => shell.showItemInFolder(path),
    exists: (path) => existsSync(path),
    remove: (path) => unlinkSync(path),
    quarantine: async (path) => {
      try {
        await ensureQuarantine(path)
      } catch (error) {
        console.error('Could not mark a download as quarantined:', error)
      }
    },
    restart: (url, isPrivate) => session.fromPartition(isPrivate ? options.privatePartition : options.normalPartition).downloadURL(url),
    ...(options.onDownloadDone ? { onDone: options.onDownloadDone } : {}),
  })
  try {
    downloads.restore(JSON.parse(readFileSync(downloadsFile, 'utf8')) as unknown)
  } catch {
    // No list yet.
  }

  // ---- History ----------------------------------------------------------------------------------
  let historyLoaded = false
  let historyDirty = false
  let policySet = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let changeTimer: ReturnType<typeof setTimeout> | null = null
  const historyWriter = new LatestWriter<string>(async (payload) => {
    // Only ever written sealed: without encryption, history stays in memory for this run.
    if (!(await options.seal.available())) return
    await writeFileAtomic(historyFile, await options.seal.encrypt(payload))
  })
  const saveHistory = (): void => {
    if (!historyLoaded) return
    historyDirty = false
    void historyWriter.save(history.serialize()).catch((error: unknown) => console.error('Could not save history:', error))
  }
  const history = new HistoryStore({
    excludedSites: options.excludedSites,
    onChange: () => {
      historyDirty = true
      if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; saveHistory() }, 1_000)
      if (!changeTimer) {
        changeTimer = setTimeout(() => {
          changeTimer = null
          const event: HistoryEvent = { type: 'changed' }
          send(historyChannels.event, event)
        }, 400)
      }
    },
  })
  void (async () => {
    try {
      if (existsSync(historyFile) && (await options.seal.available())) {
        history.load(await options.seal.decrypt(readFileSync(historyFile)), policySet)
      }
    } catch (error) {
      console.error('Could not read history:', error)
    } finally {
      historyLoaded = true
      if (historyDirty) saveHistory()
    }
  })()
  const pruneTimer = setInterval(() => history.prune(), 3_600_000)
  pruneTimer.unref?.()
  app.on('before-quit', () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    if (!historyDirty || !historyLoaded || !options.seal.availableSync()) return
    historyDirty = false
    try {
      writeFileAtomicSync(historyFile, options.seal.encryptSync(history.serialize()))
    } catch (error) {
      console.error('Could not save history on quit:', error)
    }
  })

  // ---- Clear browsing data ----------------------------------------------------------------------
  const clearBrowsingData = async (request: ClearBrowsingDataRequest): Promise<ClearBrowsingDataResult> => {
    const since = clearRangeStart(request.range, Date.now())
    const cleared: string[] = []
    const notes: string[] = []
    const browsing = session.fromPartition(options.normalPartition)
    // Sites visited in the range, read before history is removed.
    const origins = history.originsSince(since)
    if (request.siteData) {
      const dataTypes = ['cookies', 'localStorage', 'indexedDB', 'serviceWorkers', 'fileSystems', 'webSQL', 'backgroundFetch'] as const
      if (request.range === 'all') {
        await browsing.clearData({ dataTypes: [...dataTypes] })
        await browsing.clearStorageData()
        cleared.push('cookies and site data')
      } else if (origins.length) {
        await browsing.clearData({ dataTypes: [...dataTypes], origins: origins.slice(0, 1_000) })
        cleared.push(`cookies and site data for ${origins.length} site${origins.length === 1 ? '' : 's'}`)
        notes.push('For a time range, cookies and site data are removed for the sites you visited in that range.')
      } else {
        notes.push('No sites were visited in that range, so no cookies or site data were removed.')
      }
    }
    if (request.cache) {
      await browsing.clearCache()
      await browsing.clearData({ dataTypes: ['cache'] })
      cleared.push('cache')
      if (request.range !== 'all') notes.push('The cache is cleared for all time (it is not kept by date).')
    }
    if (request.history) {
      history.deleteSince(since)
      options.onHistoryCleared?.(since)
      cleared.push('history')
    }
    if (request.downloads) {
      downloads.clearFinished(since)
      cleared.push('downloads list')
    }
    return { since, cleared, notes }
  }

  // ---- IPC --------------------------------------------------------------------------------------
  options.handle(downloadChannels.command, async (_event, value: unknown) => {
    const command = parseDownloadCommand(value)
    switch (command.type) {
      case 'list': return downloads.refresh()
      case 'clear-finished': return downloads.clearFinished()
      case 'pause': return downloads.pause(command.id)
      case 'resume': return downloads.resume(command.id)
      case 'cancel': return downloads.cancel(command.id)
      case 'open': return downloads.open(command.id)
      case 'show': return downloads.show(command.id)
      case 'remove': return downloads.remove(command.id)
      case 'retry': return downloads.retry(command.id)
      case 'keep': return downloads.keep(command.id)
      case 'discard': return downloads.discard(command.id)
      case 'allow-multiple': return downloads.allowMultiple(command.id)
      case 'block-multiple': return downloads.blockMultiple(command.id)
    }
  })
  options.handle(historyChannels.command, async (_event, value: unknown) => {
    const command = parseHistoryCommand(value)
    switch (command.type) {
      case 'search': return history.search(command.query, command.cursor, command.limit)
      case 'delete': history.delete(command.ids); return undefined
      case 'delete-day': history.deleteDay(command.day); return undefined
      case 'clear': history.clear(); return undefined
      case 'set-policy': policySet = true; history.setPolicy(command.policy); return undefined
      case 'clear-browsing-data': return clearBrowsingData(command.request)
    }
  })

  const wired = new Set<string>()
  const data: BrowsingData = {
    downloads,
    history,
    wireSession: (partition) => {
      if (wired.has(partition)) return
      wired.add(partition)
      const isPrivate = partition === options.privatePartition
      session.fromPartition(partition).on('will-download', (_event, item, contents) => {
        const pageKey = contents && !contents.isDestroyed() ? String(contents.id) : null
        downloads.track(item, { isPrivate, pageKey })
      })
    },
    attachPage: (contents, isPrivate) => {
      const pageKey = String(contents.id)
      const record = (url: string): void => {
        const title = contents.getTitle()
        history.record({ url, title: title === url ? '' : title, isPrivate: isPrivate() })
      }
      contents.on('did-navigate', (_event, url, responseCode) => {
        if (responseCode && (responseCode < 200 || responseCode >= 400)) return
        record(url)
      })
      contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
        if (isMainFrame) record(url)
      })
      contents.on('page-title-updated', (_event, title) => {
        if (!isPrivate()) history.updateTitle(contents.getURL(), title)
      })
      // A click or key press makes the next download one the person asked for.
      contents.on('input-event', (_event, input) => {
        if (input.type === 'mouseDown' || input.type === 'keyDown' || input.type === 'rawKeyDown') downloads.gesture(pageKey)
      })
      contents.once('destroyed', () => downloads.forgetPage(pageKey))
    },
    excludedSitesChanged: () => { history.forgetExcluded() },
    privateBrowsingEnded: () => downloads.forgetPrivate(),
    clearBrowsingData,
  }
  current = { options, data }
  return data
}
