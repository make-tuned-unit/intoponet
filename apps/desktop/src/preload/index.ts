import { contextBridge, ipcRenderer } from 'electron'
import {
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
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: BrowserHostEvent): void => {
      listener(payload)
    }
    ipcRenderer.on(browserHostChannels.event, handler)
    return () => ipcRenderer.removeListener(browserHostChannels.event, handler)
  },
}

contextBridge.exposeInMainWorld('intoponet', Object.freeze({ browserHost }))
