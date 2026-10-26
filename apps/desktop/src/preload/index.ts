import { layaChannels, type LayaApi, type LayaCommand, type LayaHit, type LayaPassage, type LayaProgress, type LayaRelated, type LayaStatus, type LayaTheme } from '@intoponet/browser-api'
import { knowledgeChannels, oldsChannels, type AbsorbPreview, type AbsorbRefusal, type KnowledgeApi, type KnowledgeCommand, type KnowledgeDocument, type KnowledgeHit, type KnowledgeRecord, type OldsApi, type OldsQuery, type OldsThread } from '@intoponet/browser-api'
import { contextBridge, ipcRenderer } from 'electron'
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
  type PageTabSnapshot,
  type PrivateLibraryReadResult,
  type ProtectionSnapshot,
} from '@intoponet/browser-api'

const invoke = (
  command: BrowserHostCommand,
): Promise<
  | BrowserPanelSnapshot
  | ProtectionSnapshot
  | PageTabSnapshot[]
  | PrivateLibraryReadResult
  | string
  | null
> =>
  ipcRenderer.invoke(browserHostChannels.command, command)

const browserHost: BrowserHostApi = {
  open: async (intent) => {
    await invoke({ type: 'open', intent })
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
  readPrivateLibrary: () =>
    invoke({ type: 'read-private-library' }) as Promise<PrivateLibraryReadResult>,
  writePrivateLibrary: async (payload) => {
    await invoke({ type: 'write-private-library', payload })
  },
  deletePrivateLibrary: async () => {
    await invoke({ type: 'delete-private-library' })
  },
  getFieldSnapshot: () => invoke({ type: 'get-field-snapshot' }) as Promise<string | null>,
  getNewsDigest: () => invoke({ type: 'get-news-digest' }) as Promise<string | null>,
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
  removeAll: async () => { await knowledgeInvoke({ type: 'remove-all' }) },
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

contextBridge.exposeInMainWorld('intoponet', Object.freeze({ browserHost, captures, olds, knowledge, laya }))
