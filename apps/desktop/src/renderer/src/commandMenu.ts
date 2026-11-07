import type { OmniboxAction } from './omnibox'

/**
 * Menu-bar commands the command menu (⌘K) offers, each run through the menu's own table in main.
 * Every command in that table (main/appMenu.ts APP_SHORTCUTS) is here, except the bar itself (Open
 * Location, Commands) and the app window's own developer tools; a test keeps the two lists in step.
 */
export const COMMAND_MENU_LEFT_OUT = ['open-location', 'command-menu', 'shell-devtools', 'open-quick-in-main'] as const

export type CommandMenuState = {
  hasPage: boolean
  pageShown: boolean
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  tabCount: number
  privateMode: boolean
  sidebarHidden: boolean
  /** The shown tab is side by side with another. */
  splitActive?: boolean
}

/** The menu commands that apply now, in the order offered. */
export function menuActions(state: CommandMenuState): OmniboxAction[] {
  const page = state.hasPage
  const rows: Array<OmniboxAction | false> = [
    { id: 'new-tab', label: 'New tab', shortcut: '⌘T', keywords: 'open' },
    { id: 'new-quick-window', label: 'New quick window', shortcut: '⌥⌘N', keywords: 'small floating window link' },
    { id: 'toggle-private', label: state.privateMode ? 'Leave private browsing' : 'Private browsing', shortcut: '⇧⌘N', keywords: 'incognito' },
    state.tabCount > 0 && { id: 'close-tab', label: 'Close tab', shortcut: '⌘W' },
    { id: 'reopen-closed-tab', label: 'Reopen closed tab', shortcut: '⇧⌘T', keywords: 'undo restore' },
    page && { id: 'copy-address', label: 'Copy page address', shortcut: '⇧⌘C', keywords: 'link url clean tracking' },
    page && { id: 'copy-address-raw', label: 'Copy page address exactly', shortcut: '⌥⇧⌘C', keywords: 'link url' },
    page && { id: 'export-pdf', label: 'Save page as PDF', shortcut: '⌥⌘E', keywords: 'pdf export print' },
    page && { id: 'save-page', label: 'Save page as…', shortcut: '⌘S', keywords: 'download html' },
    page && { id: 'print', label: 'Print…', shortcut: '⌘P' },
    page && { id: 'find', label: 'Find on page', shortcut: '⌘F', keywords: 'search text' },
    page && { id: 'find-next', label: 'Find next', shortcut: '⌘G' },
    page && { id: 'find-previous', label: 'Find previous', shortcut: '⇧⌘G' },
    page && { id: 'reload', label: 'Reload page', shortcut: '⌘R', keywords: 'refresh' },
    page && { id: 'force-reload', label: 'Reload page ignoring cache', shortcut: '⇧⌘R', keywords: 'refresh hard' },
    page && state.loading && { id: 'stop', label: 'Stop loading', shortcut: '⌘.' },
    page && { id: 'zoom-in', label: 'Zoom in', shortcut: '⌘+', keywords: 'bigger larger' },
    page && { id: 'zoom-out', label: 'Zoom out', shortcut: '⌘−', keywords: 'smaller' },
    page && { id: 'zoom-reset', label: 'Actual size', shortcut: '⌘0', keywords: 'zoom reset 100' },
    page && { id: 'inspect-page', label: 'Inspect page', shortcut: '⌥⌘I', keywords: 'developer tools devtools' },
    page && state.canGoBack && { id: 'back', label: 'Back', shortcut: '⌘[' },
    page && state.canGoForward && { id: 'forward', label: 'Forward', shortcut: '⌘]' },
    page && { id: 'bookmark', label: 'Bookmark this page', shortcut: '⌘D', keywords: 'save star' },
    { id: 'show-bookmarks', label: 'Show bookmarks', shortcut: '⇧⌘B', keywords: 'library collections' },
    { id: 'show-history', label: 'Show all history', shortcut: '⌘Y', keywords: 'visited recent' },
    state.tabCount > 1 && { id: 'next-tab', label: 'Next tab', shortcut: '⌃Tab', keywords: 'switch' },
    state.tabCount > 1 && { id: 'previous-tab', label: 'Previous tab', shortcut: '⌃⇧Tab', keywords: 'switch' },
    state.pageShown && state.tabCount > 0 && { id: 'toggle-tab-sidebar', label: state.sidebarHidden ? 'Show tab sidebar' : 'Hide tab sidebar', shortcut: '⌃⌘S', keywords: 'vertical tabs' },
    state.pageShown && state.tabCount > 1 && !state.splitActive && { id: 'split-tab', label: 'Split with next tab', shortcut: '⌃⇧=', keywords: 'side by side two pages' },
    state.pageShown && { id: 'unsplit-tab', label: 'Unsplit tabs', shortcut: '⌃⇧-', keywords: 'side by side separate' },
    state.pageShown && { id: 'home', label: 'Show the globe', shortcut: '⇧⌘H', keywords: 'earth home map' },
    { id: 'settings', label: 'Settings…', shortcut: '⌘,', keywords: 'preferences options' },
  ]
  return rows.filter((row): row is OmniboxAction => !!row)
}
