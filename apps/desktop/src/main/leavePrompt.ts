import type { BrowserWindow, MessageBoxSyncOptions, WebContents } from 'electron'

/** Pages and popups: a page that keeps showing dialogs gets a box to stop them. */
export const SAFE_DIALOG_PREFERENCES = {
  safeDialogs: true,
  safeDialogsMessage: 'Stop this page from showing more dialogs',
} as const

export const LEAVE_PAGE_DIALOG: MessageBoxSyncOptions = {
  type: 'question',
  buttons: ['Leave', 'Stay'],
  defaultId: 0,
  cancelId: 1,
  message: 'Leave this page?',
  detail: 'Changes you made may not be saved.',
}

type ShowSync = (window: BrowserWindow, options: MessageBoxSyncOptions) => number

/**
 * A page's beforeunload handler asked to stay. Electron's default is to cancel the navigation
 * silently, so a page could trap you; instead ask, natively, and leave when the person says so.
 */
export function bindLeavePrompt(contents: Pick<WebContents, 'on'>, owner: () => BrowserWindow | null, showSync: ShowSync): void {
  contents.on('will-prevent-unload', (event: Electron.Event) => {
    const window = owner()
    // No window to ask in: leaving is the safe answer (the page cannot hold the app).
    if (!window || window.isDestroyed()) {
      event.preventDefault()
      return
    }
    if (showSync(window, LEAVE_PAGE_DIALOG) === 0) event.preventDefault()
  })
}
