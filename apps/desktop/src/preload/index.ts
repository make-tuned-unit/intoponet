import type { ArticlePreview } from '../main/articlePreview'
import { translateChannels, type TranslateApi, type TranslateCommand, type TranslateEvent, type TranslateStatus, type PageTranslationState } from '@intoponet/browser-api'
import { privacyChannels, type PrivacyApi, type PrivacyCommand, type PrivacyState } from '@intoponet/browser-api'
import { beaconChannels, type BeaconApi, type BeaconCommand, type BeaconPreview, type BeaconResource, type BeaconState, type PublishedBeacon } from '@intoponet/browser-api'
import { sitePermissionChannels, type SitePermissionApi, type SitePermissionCommand, type SitePermissionEvent, type SitePermissionMap, type SitePermissionRequest } from '@intoponet/browser-api'
import { layaChannels, type LayaApi, type LayaCommand, type LayaHit, type LayaPassage, type LayaProgress, type LayaRelated, type LayaStatus, type LayaTheme } from '@intoponet/browser-api'
import { knowledgeChannels, oldsChannels, type AbsorbPreview, type AbsorbRefusal, type KnowledgeApi, type KnowledgeCommand, type KnowledgeDocument, type KnowledgeClaim, type KnowledgeHit, type KnowledgeRecord, type OldsApi, type OldsQuery, type OldsThread } from '@intoponet/browser-api'
import { contextBridge, ipcRenderer } from 'electron'
import { passwordChannels, type PasswordApi, type PasswordCommand, type PasswordEvent, type PasswordPageState, type PasswordVaultStatus, type SavedLogin } from '../shared/passwords'
import { downloadChannels, historyChannels, type DownloadCommand, type DownloadEntry, type DownloadEvent, type DownloadsApi, type HistoryApi, type HistoryCommand, type HistoryEvent } from '@intoponet/browser-api'
import { updateChannels, type UpdatesApi, type UpdateCommand, type UpdateStatus } from '@intoponet/browser-api'
import { browsingChannels, type BrowsingApi, type BrowsingCommand, type BrowsingEvent, type BrowsingSettings, type ExternalOpenRequest } from '@intoponet/browser-api'
import {
  CAPTURE_SCHEME,
  captureChannels,
  type CaptureApi,
  type CaptureCommand,
  type CaptureEvent,
  type CaptureRecord,
  type PendingCapture,
  browserHostChannels,
  type BrowserHostApi,
  type BrowserHostCommand,
  type BrowserHostEvent,
  type BrowserPanelSnapshot,
  type ClosedTabSnapshot,
  type PageTabSnapshot,
  type PdfExportOptions,
  type PrivateLibraryReadResult,
  type ProtectionSnapshot,
  type PublicFieldStatus,
} from '@intoponet/browser-api'

const invoke = (
  command: BrowserHostCommand,
): Promise<
  | BrowserPanelSnapshot
  | ProtectionSnapshot
  | PageTabSnapshot[]
  | ClosedTabSnapshot[]
  | PrivateLibraryReadResult
  | PublicFieldStatus
  | PdfExportOptions
  | string
  | null
> =>
  ipcRenderer.invoke(browserHostChannels.command, command)

const browserHost: BrowserHostApi = {
  open: async (intent, disposition) => {
    await invoke({ type: 'open', intent, ...(disposition ? { disposition } : {}) })
  },
  newTab: async () => {
    await invoke({ type: 'new-tab' })
  },
  close: async () => {
    await invoke({ type: 'close' })
  },
  restore: async () => {
    await invoke({ type: 'restore' })
  },
  navigate: async (url) => {
    await invoke({ type: 'navigate', url })
  },
  back: async () => {
    await invoke({ type: 'back' })
  },
  forward: async () => {
    await invoke({ type: 'forward' })
  },
  reload: async () => {
    await invoke({ type: 'reload' })
  },
  stop: async () => {
    await invoke({ type: 'stop' })
  },
  find: async (query, options) => {
    await invoke({
      type: 'find',
      query,
      findNext: options?.findNext === true,
      forward: options?.forward !== false,
    })
  },
  stopFind: async () => {
    await invoke({ type: 'stop-find' })
  },
  print: async () => {
    await invoke({ type: 'print' })
  },
  zoom: async (action) => {
    await invoke({ type: 'zoom', action })
  },
  setBounds: async (bounds) => {
    await invoke({ type: 'set-bounds', bounds })
  },
  holdPage: async (held) => {
    await invoke({ type: 'hold-page', held })
  },
  setFullWidth: async (enabled) => {
    await invoke({ type: 'set-full-width', enabled })
  },
  setTabRailExpanded: async (expanded) => {
    await invoke({ type: 'set-tab-rail-expanded', expanded })
  },
  setChromeRevealed: async (revealed, hold) => {
    await invoke({ type: 'set-chrome-revealed', revealed, ...(hold ? { hold: true } : {}) })
  },
  setTabDockOpen: async (open, hold) => {
    await invoke({ type: 'set-tab-dock-open', open, ...(hold ? { hold: true } : {}) })
  },
  getState: () => invoke({ type: 'get-state' }) as Promise<BrowserPanelSnapshot>,
  getProtection: () => invoke({ type: 'get-protection' }) as Promise<ProtectionSnapshot>,
  setSiteProtection: async (enabled) => {
    await invoke({ type: 'set-site-protection', enabled })
  },
  setProtectionCategories: async (categories) => {
    await invoke({ type: 'set-protection-categories', ...categories })
  },
  getTabs: () => invoke({ type: 'get-tabs' }) as Promise<PageTabSnapshot[]>,
  activateTab: async (id) => {
    await invoke({ type: 'activate-tab', id })
  },
  closeTab: async (id) => {
    await invoke({ type: 'close-tab', id })
  },
  cycleTabs: async (direction) => {
    await invoke({ type: 'cycle-tabs', direction })
  },
  moveTab: async (id, toIndex) => {
    await invoke({ type: 'move-tab', id, toIndex })
  },
  setTabPinned: async (id, pinned) => {
    await invoke({ type: 'set-tab-pinned', id, pinned })
  },
  setTabMuted: async (id, muted) => {
    await invoke({ type: 'set-tab-muted', id, muted })
  },
  showTabMenu: async (id, at) => {
    await invoke({ type: 'tab-menu', id, ...(at ? { x: at.x, y: at.y } : {}) })
  },
  closeActiveTab: async () => {
    await invoke({ type: 'close-active-tab' })
  },
  reopenClosedTab: async (id) => {
    await invoke({ type: 'reopen-closed-tab', ...(id ? { id } : {}) })
  },
  getClosedTabs: () => invoke({ type: 'get-closed-tabs' }) as Promise<ClosedTabSnapshot[]>,
  selectTab: async (index) => {
    await invoke({ type: 'select-tab', index })
  },
  forceReload: async () => {
    await invoke({ type: 'force-reload' })
  },
  savePage: async () => {
    await invoke({ type: 'save-page' })
  },
  exportPdf: async (options) => {
    await invoke(options ? { type: 'export-pdf', options } : { type: 'export-pdf' })
  },
  cancelPdfExport: async () => {
    await invoke({ type: 'cancel-pdf-export' })
  },
  getPdfSettings: () => invoke({ type: 'get-pdf-settings' }) as Promise<PdfExportOptions>,
  setPdfSettings: async (options) => {
    await invoke({ type: 'set-pdf-settings', options })
  },
  openSavedFile: async (path, reveal) => {
    await invoke({ type: 'open-saved-file', path, reveal })
  },
  readPrivateLibrary: () =>
    invoke({ type: 'read-private-library' }) as Promise<PrivateLibraryReadResult>,
  writePrivateLibrary: async (payload) => {
    await invoke({ type: 'write-private-library', payload })
  },
  deletePrivateLibrary: async () => {
    await invoke({ type: 'delete-private-library' })
  },
  getFieldSnapshot: () => invoke({ type: 'get-field-snapshot' }) as Promise<string | null>,
  getPublicFieldStatus: () => invoke({ type: 'get-public-field-status' }) as Promise<PublicFieldStatus>,
  getNewsDigest: () => invoke({ type: 'get-news-digest' }) as Promise<string | null>,
  getPlaceTrends: (place: { countryCode: string; name?: string; aliases?: string[]; geonameId?: string }) => invoke({ type: 'get-place-trends', ...place }) as Promise<string | null>,
  showAddressMenu: async (hasSelection) => {
    await invoke({ type: 'address-menu', hasSelection })
  },
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: BrowserHostEvent): void => {
      listener(payload)
    }
    ipcRenderer.on(browserHostChannels.event, handler)
    return () => ipcRenderer.removeListener(browserHostChannels.event, handler)
  },
}

const captureInvoke = (command: CaptureCommand): Promise<unknown> => ipcRenderer.invoke(captureChannels.command, command)

const captures: CaptureApi = {
  begin: () => captureInvoke({ type: 'begin' }) as Promise<PendingCapture>,
  cancel: async (pendingId) => { await captureInvoke({ type: 'cancel', pendingId }) },
  saveImage: (pendingId, crop, groupId) => captureInvoke({ type: 'save-image', pendingId, crop, groupId }) as Promise<CaptureRecord>,
  startRecording: async (pendingId, crop) => { await captureInvoke({ type: 'start-recording', pendingId, crop }) },
  stopFrames: async () => { await captureInvoke({ type: 'stop-frames' }) },
  saveVideo: (pendingId, bytes, mimeType, durationMs, groupId) =>
    captureInvoke({ type: 'save-video', pendingId, bytes, mimeType, durationMs, groupId }) as Promise<CaptureRecord>,
  list: () => captureInvoke({ type: 'list' }) as Promise<CaptureRecord[]>,
  update: (id, patch) => captureInvoke({ type: 'update', id, ...patch }) as Promise<CaptureRecord>,
  remove: async (id) => { await captureInvoke({ type: 'delete', id }) },
  removeAll: async () => { await captureInvoke({ type: 'delete-all' }) },
  reveal: async (id) => { await captureInvoke({ type: 'reveal', id }) },
  openFolder: async (groupId) => { await captureInvoke({ type: 'open-folder', groupId }) },
  syncGroups: async (groups) => { await captureInvoke({ type: 'sync-groups', groups }) },
  copyImage: async (id) => { await captureInvoke({ type: 'copy-image', id }) },
  setPageHidden: async (hidden) => { await captureInvoke({ type: 'set-page-hidden', hidden }) },
  mediaUrl: (record, variant) => `${CAPTURE_SCHEME}://${variant}/${record.id}?v=${encodeURIComponent(record.createdAt)}`,
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: CaptureEvent): void => listener(payload)
    ipcRenderer.on(captureChannels.event, handler)
    return () => ipcRenderer.removeListener(captureChannels.event, handler)
  },
}

const olds: OldsApi = {
  thread: (query: OldsQuery) => ipcRenderer.invoke(oldsChannels.command, { type: 'thread', query }) as Promise<OldsThread>,
}

const knowledgeInvoke = (command: KnowledgeCommand): Promise<unknown> => ipcRenderer.invoke(knowledgeChannels.command, command)
const knowledge: KnowledgeApi = {
  preview: (scope) => knowledgeInvoke({ type: 'preview', scope }) as Promise<AbsorbPreview | AbsorbRefusal>,
  commit: (previewId, options = {}) => knowledgeInvoke({ type: 'commit', previewId, ...options }) as Promise<KnowledgeRecord>,
  cancel: async (previewId) => { await knowledgeInvoke({ type: 'cancel', previewId }) },
  list: () => knowledgeInvoke({ type: 'list' }) as Promise<KnowledgeRecord[]>,
  get: (id) => knowledgeInvoke({ type: 'get', id }) as Promise<KnowledgeDocument>,
  search: (query, limit) => knowledgeInvoke(limit === undefined ? { type: 'search', query } : { type: 'search', query, limit }) as Promise<KnowledgeHit[]>,
  remove: async (id) => { await knowledgeInvoke({ type: 'remove', id }) },
  update: (id, patch) => knowledgeInvoke({ type: 'update', id, ...patch }) as Promise<KnowledgeRecord>,
  reindex: (id) => knowledgeInvoke({ type: 'reindex', id }) as Promise<KnowledgeRecord>,
  claims: (id) => knowledgeInvoke({ type: 'claims', id }) as Promise<KnowledgeClaim[]>,
  removeAll: async () => { await knowledgeInvoke({ type: 'remove-all' }) },
  exportAll: () => knowledgeInvoke({ type: 'export' }) as Promise<string>,
}

const layaInvoke = (command: LayaCommand): Promise<unknown> => ipcRenderer.invoke(layaChannels.command, command)
const laya: LayaApi = {
  status: () => layaInvoke({ type: 'status' }) as Promise<LayaStatus>,
  enable: () => layaInvoke({ type: 'enable' }) as Promise<LayaStatus>,
  disable: ({ deleteModel }) => layaInvoke({ type: 'disable', deleteModel }) as Promise<LayaStatus>,
  search: (query, limit) => layaInvoke(limit === undefined ? { type: 'search', query } : { type: 'search', query, limit }) as Promise<LayaHit[]>,
  related: (input, limit) => layaInvoke({ type: 'related', ...input, ...(limit === undefined ? {} : { limit }) }) as Promise<LayaRelated[]>,
  themes: () => layaInvoke({ type: 'themes' }) as Promise<LayaTheme[]>,
  ask: (question, limit) => layaInvoke(limit === undefined ? { type: 'ask', question } : { type: 'ask', question, limit }) as Promise<LayaPassage[]>,
  backfill: () => layaInvoke({ type: 'backfill' }) as Promise<LayaStatus>,
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, event: LayaProgress): void => listener(event)
    ipcRenderer.on(layaChannels.event, handler)
    return () => { ipcRenderer.removeListener(layaChannels.event, handler) }
  },
}

const translateInvoke = (command: TranslateCommand): Promise<unknown> => ipcRenderer.invoke(translateChannels.command, command)
const translate: TranslateApi = {
  status: () => translateInvoke({ type: 'status' }) as Promise<TranslateStatus>,
  install: (code) => translateInvoke({ type: 'install', code }) as Promise<TranslateStatus>,
  remove: (code) => translateInvoke({ type: 'remove', code }) as Promise<TranslateStatus>,
  translate: ({ from, to, texts, html }) => translateInvoke({ type: 'translate', from, to, texts, html: html ?? false }) as Promise<string[]>,
  pageState: () => translateInvoke({ type: 'page-state' }) as Promise<PageTranslationState>,
  translatePage: (from, to) => translateInvoke({ type: 'page-translate', from, to }) as Promise<PageTranslationState>,
  restorePage: () => translateInvoke({ type: 'page-restore' }) as Promise<PageTranslationState>,
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, event: TranslateEvent): void => listener(event)
    ipcRenderer.on(translateChannels.event, handler)
    return () => { ipcRenderer.removeListener(translateChannels.event, handler) }
  },
}

const privacyInvoke = (command: PrivacyCommand): Promise<PrivacyState> => ipcRenderer.invoke(privacyChannels.command, command) as Promise<PrivacyState>
const privacy: PrivacyApi = {
  state: () => privacyInvoke({ type: 'state' }),
  setPrivateMode: (on) => privacyInvoke({ type: 'set-private-mode', on }),
  setBackupExclusion: (on) => privacyInvoke({ type: 'set-backup-exclusion', on }),
  setExcludedSites: (sites) => privacyInvoke({ type: 'set-excluded-sites', sites }),
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: PrivacyState): void => listener(state)
    ipcRenderer.on(privacyChannels.event, handler)
    return () => { ipcRenderer.removeListener(privacyChannels.event, handler) }
  },
}

const sitePermissionInvoke = (command: SitePermissionCommand): Promise<unknown> => ipcRenderer.invoke(sitePermissionChannels.command, command)
const sitePermissions: SitePermissionApi = {
  decide: async (id, decision) => { await sitePermissionInvoke({ type: 'decide', id, decision }) },
  list: (origin) => sitePermissionInvoke({ type: 'list', origin }) as Promise<SitePermissionMap>,
  reset: (origin, kind) => sitePermissionInvoke(kind ? { type: 'reset', origin, kind } : { type: 'reset', origin }) as Promise<SitePermissionMap>,
  pending: () => sitePermissionInvoke({ type: 'pending' }) as Promise<SitePermissionRequest[]>,
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, event: SitePermissionEvent): void => listener(event)
    ipcRenderer.on(sitePermissionChannels.event, handler)
    return () => { ipcRenderer.removeListener(sitePermissionChannels.event, handler) }
  },
}

const beaconInvoke = (command: BeaconCommand): Promise<unknown> => ipcRenderer.invoke(beaconChannels.command, command)
const beacons: BeaconApi = {
  state: () => beaconInvoke({ type: 'state' }) as Promise<BeaconState>,
  setRegistry: (url) => beaconInvoke({ type: 'set-registry', url }) as Promise<BeaconState>,
  preview: (draft) => beaconInvoke({ type: 'preview', draft }) as Promise<BeaconPreview>,
  publish: (draft) => beaconInvoke({ type: 'publish', draft }) as Promise<PublishedBeacon>,
  withdraw: (id) => beaconInvoke({ type: 'withdraw', id }) as Promise<BeaconState>,
  report: async (url, kind, text) => { await beaconInvoke({ type: 'report', url, kind, ...(text ? { text } : {}) }) },
  read: (filter = {}) => beaconInvoke({ type: 'read', ...filter }) as Promise<BeaconResource[]>,
}

const access = {
  page: () => ipcRenderer.invoke('intoponet:page-access') as Promise<{ url: string; title: string; paywalled: boolean; signals: string[]; doi: string | null } | null>,
}

const updateInvoke = (command: UpdateCommand): Promise<UpdateStatus> => ipcRenderer.invoke(updateChannels.command, command) as Promise<UpdateStatus>
const updates: UpdatesApi = {
  status: () => updateInvoke({ type: 'status' }),
  checkAndDownload: () => updateInvoke({ type: 'check-and-download' }),
  restart: () => updateInvoke({ type: 'restart' }),
  setAutomatic: (enabled) => updateInvoke({ type: 'set-automatic', enabled }),
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus): void => listener(status)
    ipcRenderer.on(updateChannels.event, handler)
    return () => ipcRenderer.removeListener(updateChannels.event, handler)
  },
}

const articles = {
  preview: (url: string) => ipcRenderer.invoke('intoponet:article-preview', url) as Promise<ArticlePreview | null>,
}

const favicons = {
  get: (hosts: string[]) => ipcRenderer.invoke('intoponet:favicons', hosts) as Promise<Record<string, string>>,
}

const feedback = {
  status: () => ipcRenderer.invoke('intoponet:feedback', { kind: 'status' }) as Promise<{ due: boolean }>,
  later: () => ipcRenderer.invoke('intoponet:feedback', { kind: 'later' }) as Promise<{ due: boolean }>,
  never: () => ipcRenderer.invoke('intoponet:feedback', { kind: 'never' }) as Promise<{ due: boolean }>,
  send: (rating: number | null, comment: string) => ipcRenderer.invoke('intoponet:feedback', { kind: 'send', rating, comment }) as Promise<{ due: boolean; sent?: boolean }>,
}

const passwordInvoke = (command: PasswordCommand): Promise<unknown> => ipcRenderer.invoke(passwordChannels.command, command)
const passwords: PasswordApi = {
  pageState: () => passwordInvoke({ type: 'page-state' }) as Promise<PasswordPageState | null>,
  decide: async (id, decision) => { await passwordInvoke({ type: 'decide', id, decision }) },
  fill: async (id) => { await passwordInvoke({ type: 'fill', id }) },
  dismissChoice: async () => { await passwordInvoke({ type: 'dismiss-choice' }) },
  list: () => passwordInvoke({ type: 'list' }) as Promise<SavedLogin[]>,
  status: () => passwordInvoke({ type: 'status' }) as Promise<PasswordVaultStatus>,
  reveal: (id) => passwordInvoke({ type: 'reveal', id }) as Promise<string | null>,
  copy: (id) => passwordInvoke({ type: 'copy', id }) as Promise<boolean>,
  remove: async (id) => { await passwordInvoke({ type: 'remove', id }) },
  neverList: () => passwordInvoke({ type: 'never-list' }) as Promise<string[]>,
  removeNever: async (origin) => { await passwordInvoke({ type: 'remove-never', origin }) },
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, event: PasswordEvent): void => listener(event)
    ipcRenderer.on(passwordChannels.event, handler)
    return () => { ipcRenderer.removeListener(passwordChannels.event, handler) }
  },
}

const downloadInvoke = (command: DownloadCommand): Promise<DownloadEntry[]> => ipcRenderer.invoke(downloadChannels.command, command) as Promise<DownloadEntry[]>
const downloads: DownloadsApi = {
  list: () => downloadInvoke({ type: 'list' }),
  pause: (id) => downloadInvoke({ type: 'pause', id }),
  resume: (id) => downloadInvoke({ type: 'resume', id }),
  cancel: (id) => downloadInvoke({ type: 'cancel', id }),
  open: (id) => downloadInvoke({ type: 'open', id }),
  show: (id) => downloadInvoke({ type: 'show', id }),
  remove: (id) => downloadInvoke({ type: 'remove', id }),
  retry: (id) => downloadInvoke({ type: 'retry', id }),
  keep: (id) => downloadInvoke({ type: 'keep', id }),
  discard: (id) => downloadInvoke({ type: 'discard', id }),
  allowMultiple: (id) => downloadInvoke({ type: 'allow-multiple', id }),
  blockMultiple: (id) => downloadInvoke({ type: 'block-multiple', id }),
  clearFinished: () => downloadInvoke({ type: 'clear-finished' }),
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, event: DownloadEvent): void => listener(event)
    ipcRenderer.on(downloadChannels.event, handler)
    return () => { ipcRenderer.removeListener(downloadChannels.event, handler) }
  },
}

const historyInvoke = (command: HistoryCommand): Promise<unknown> => ipcRenderer.invoke(historyChannels.command, command)
const history: HistoryApi = {
  search: (query, options) => historyInvoke({ type: 'search', query, cursor: options?.cursor ?? 0, limit: options?.limit ?? 100 }) as ReturnType<HistoryApi['search']>,
  delete: async (ids) => { await historyInvoke({ type: 'delete', ids }) },
  deleteDay: async (day) => { await historyInvoke({ type: 'delete-day', day }) },
  clear: async () => { await historyInvoke({ type: 'clear' }) },
  setPolicy: async (policy) => { await historyInvoke({ type: 'set-policy', policy }) },
  clearBrowsingData: (request) => historyInvoke({ type: 'clear-browsing-data', request }) as ReturnType<HistoryApi['clearBrowsingData']>,
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, event: HistoryEvent): void => listener(event)
    ipcRenderer.on(historyChannels.event, handler)
    return () => { ipcRenderer.removeListener(historyChannels.event, handler) }
  },
}

const browsingInvoke = (command: BrowsingCommand): Promise<unknown> => ipcRenderer.invoke(browsingChannels.command, command)
const browsing: BrowsingApi = {
  decideExternal: async (id, decision, always) => { await browsingInvoke({ type: 'external-decide', id, decision, always: always === true }) },
  pendingExternal: () => browsingInvoke({ type: 'external-pending' }) as Promise<ExternalOpenRequest[]>,
  settings: () => browsingInvoke({ type: 'settings' }) as Promise<BrowsingSettings>,
  setPageAppearance: (appearance) => browsingInvoke({ type: 'set-page-appearance', appearance }) as Promise<BrowsingSettings>,
  makeDefaultBrowser: () => browsingInvoke({ type: 'make-default-browser' }) as Promise<BrowsingSettings>,
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, event: BrowsingEvent): void => listener(event)
    ipcRenderer.on(browsingChannels.event, handler)
    return () => { ipcRenderer.removeListener(browsingChannels.event, handler) }
  },
}

contextBridge.exposeInMainWorld('intoponet', Object.freeze({ browserHost, captures, olds, knowledge, laya, translate, privacy, sitePermissions, beacons, favicons, articles, access, downloads, history, browsing, updates, feedback, passwords }))
