import type { MenuItemConstructorOptions } from 'electron'
import type { BrowserHostCommand, ShellShortcut } from '@intoponet/browser-api'

/** Everything the menu bar (and the same keys pressed inside a page) can ask for. */
export type AppCommand =
  | { type: 'settings' }
  | { type: 'new-tab' }
  | { type: 'toggle-private' }
  | { type: 'open-location' }
  | { type: 'close-tab' }
  | { type: 'reopen-closed-tab'; id?: string }
  | { type: 'save-page' }
  | { type: 'export-pdf' }
  | { type: 'print' }
  | { type: 'find' }
  | { type: 'find-next' }
  | { type: 'find-previous' }
  | { type: 'reload' }
  | { type: 'force-reload' }
  | { type: 'stop' }
  | { type: 'zoom-reset' }
  | { type: 'zoom-in' }
  | { type: 'zoom-out' }
  | { type: 'inspect-page' }
  | { type: 'shell-devtools' }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'home' }
  | { type: 'show-history' }
  | { type: 'bookmark' }
  | { type: 'show-bookmarks' }
  | { type: 'next-tab' }
  | { type: 'previous-tab' }
  /** 0-based; -1 is the last tab (⌘9). */
  | { type: 'select-tab'; index: number }
  /** 0-based: ⌃1 is the first workspace. */
  | { type: 'select-workspace'; index: number }
  | { type: 'help' }
  /** The open page's address, tracking parameters removed (raw: exactly as it is). */
  | { type: 'copy-address' }
  | { type: 'copy-address-raw' }
  | { type: 'toggle-tab-sidebar' }
  /** Pages side by side: the shown tab with the next one (splitPages.ts). */
  | { type: 'split-tab' }
  /** End the split the shown tab is in. */
  | { type: 'unsplit-tab' }
  | { type: 'command-menu' }
  /** An empty quick window (⌥⌘N). */
  | { type: 'new-quick-window' }
  /** Moves the focused quick window's page into a tab (⌘O). */
  | { type: 'open-quick-in-main' }

/** What the menu needs to know to enable its items. */
export type AppMenuState = {
  platform: NodeJS.Platform
  /** A tab is showing (a web page or a new tab's start page). */
  tabShowing: boolean
  /** A web page is showing (not the globe, not a start page). */
  hasPage: boolean
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  tabCount: number
  privateMode: boolean
  recentlyClosed: { id: string; title: string; url: string }[]
  /** Development builds also offer the app window's own developer tools. */
  developer: boolean
  /** Workspaces there are (⌃1–9 switch to them); 1 when absent. */
  workspaceCount?: number
  /** A quick window (links from other apps) has keyboard focus: ⌘O can move its page into a tab. */
  quickWindowFocused: boolean
  /** The shown tab is side by side with another (⌃⇧- unsplits). */
  splitActive?: boolean
}

/**
 * Key chords, in Electron's accelerator syntax. The first one is shown in the menu; the others work
 * as hidden alternatives. One table serves the menu bar and the keys pressed while a page has focus.
 */
export const APP_SHORTCUTS = {
  settings: ['CmdOrCtrl+,'],
  'new-tab': ['CmdOrCtrl+T'],
  'toggle-private': ['CmdOrCtrl+Shift+N'],
  'open-location': ['CmdOrCtrl+L'],
  'close-tab': ['CmdOrCtrl+W'],
  'reopen-closed-tab': ['CmdOrCtrl+Shift+T'],
  'save-page': ['CmdOrCtrl+S'],
  'export-pdf': ['CmdOrCtrl+Alt+E'],
  print: ['CmdOrCtrl+P'],
  find: ['CmdOrCtrl+F'],
  'find-next': ['CmdOrCtrl+G'],
  'find-previous': ['CmdOrCtrl+Shift+G'],
  reload: ['CmdOrCtrl+R'],
  'force-reload': ['CmdOrCtrl+Shift+R'],
  stop: ['CmdOrCtrl+.'],
  'zoom-reset': ['CmdOrCtrl+0'],
  'zoom-in': ['CmdOrCtrl+Plus', 'CmdOrCtrl+='],
  'zoom-out': ['CmdOrCtrl+-'],
  'inspect-page': ['CmdOrCtrl+Alt+I'],
  'shell-devtools': ['CmdOrCtrl+Alt+Shift+I'],
  back: ['CmdOrCtrl+['],
  forward: ['CmdOrCtrl+]'],
  home: ['CmdOrCtrl+Shift+H'],
  'show-history': ['CmdOrCtrl+Y'],
  bookmark: ['CmdOrCtrl+D'],
  'show-bookmarks': ['CmdOrCtrl+Shift+B'],
  'next-tab': ['Ctrl+Tab', 'CmdOrCtrl+Shift+]'],
  'previous-tab': ['Ctrl+Shift+Tab', 'CmdOrCtrl+Shift+['],
  'copy-address': ['CmdOrCtrl+Shift+C'],
  'copy-address-raw': ['CmdOrCtrl+Alt+Shift+C'],
  // The Mac's own "Show Sidebar" key (⇧⌘S is Capture).
  'toggle-tab-sidebar': ['Ctrl+Cmd+S'],
  // Pages side by side: ⌃⇧= splits the shown tab with the next one, ⌃⇧- ends the split.
  'split-tab': ['Ctrl+Shift+='],
  'unsplit-tab': ['Ctrl+Shift+-'],
  'command-menu': ['CmdOrCtrl+K'],
  'new-quick-window': ['Alt+CmdOrCtrl+N'],
  'open-quick-in-main': ['CmdOrCtrl+O'],
} as const satisfies Partial<Record<AppCommand['type'], readonly string[]>>

type SimpleCommandType = keyof typeof APP_SHORTCUTS

/** ⌘1–⌘8 select those tabs; ⌘9 the last one. */
const TAB_NUMBER_SHORTCUTS: { accelerator: string; index: number }[] = [
  ...Array.from({ length: 8 }, (_, index) => ({ accelerator: `CmdOrCtrl+${index + 1}`, index })),
  { accelerator: 'CmdOrCtrl+9', index: -1 },
]

/**
 * ⌃1–⌃9 show workspaces 1–9 (⌘1–9 already select tabs). Elsewhere than the Mac, ⌃ is the command
 * key, so they take ⌥ instead.
 */
export function workspaceNumberShortcuts(platform: NodeJS.Platform): { accelerator: string; index: number }[] {
  return Array.from({ length: 9 }, (_, index) => ({ accelerator: `${platform === 'darwin' ? 'Ctrl' : 'Alt'}+${index + 1}`, index }))
}

/** Where a command is carried out: in the app window's interface, in the browser host, or natively. */
export type AppCommandRoute =
  | { kind: 'shell'; action: ShellShortcut }
  | { kind: 'host'; command: BrowserHostCommand }
  | { kind: 'native'; action: 'inspect-page' | 'shell-devtools' | 'show-history' | 'new-quick-window' | 'open-quick-in-main' }

export function routeAppCommand(command: AppCommand): AppCommandRoute {
  switch (command.type) {
    case 'settings': return { kind: 'shell', action: 'open-settings' }
    case 'new-tab': return { kind: 'shell', action: 'new-tab' }
    case 'toggle-private': return { kind: 'shell', action: 'toggle-private' }
    case 'open-location': return { kind: 'shell', action: 'focus-launcher' }
    case 'find': return { kind: 'shell', action: 'find' }
    case 'find-next': return { kind: 'shell', action: 'find-next' }
    case 'find-previous': return { kind: 'shell', action: 'find-previous' }
    case 'bookmark': return { kind: 'shell', action: 'bookmark' }
    case 'show-bookmarks': return { kind: 'shell', action: 'toggle-bookmarks' }
    case 'close-tab': return { kind: 'host', command: { type: 'close-active-tab' } }
    case 'reopen-closed-tab': return { kind: 'host', command: command.id ? { type: 'reopen-closed-tab', id: command.id } : { type: 'reopen-closed-tab' } }
    case 'save-page': return { kind: 'host', command: { type: 'save-page' } }
    case 'export-pdf': return { kind: 'host', command: { type: 'export-pdf' } }
    case 'print': return { kind: 'host', command: { type: 'print' } }
    case 'reload': return { kind: 'host', command: { type: 'reload' } }
    case 'force-reload': return { kind: 'host', command: { type: 'force-reload' } }
    case 'stop': return { kind: 'host', command: { type: 'stop' } }
    case 'zoom-reset': return { kind: 'host', command: { type: 'zoom', action: 'reset' } }
    case 'zoom-in': return { kind: 'host', command: { type: 'zoom', action: 'in' } }
    case 'zoom-out': return { kind: 'host', command: { type: 'zoom', action: 'out' } }
    case 'back': return { kind: 'host', command: { type: 'back' } }
    case 'forward': return { kind: 'host', command: { type: 'forward' } }
    // The globe: the page is put away (as Escape does), its tab stays open.
    case 'home': return { kind: 'host', command: { type: 'close' } }
    case 'next-tab': return { kind: 'host', command: { type: 'cycle-tabs', direction: 'next' } }
    case 'previous-tab': return { kind: 'host', command: { type: 'cycle-tabs', direction: 'previous' } }
    case 'select-tab': return { kind: 'host', command: { type: 'select-tab', index: command.index } }
    case 'select-workspace': return { kind: 'host', command: { type: 'switch-workspace', index: command.index } }
    case 'command-menu': return { kind: 'shell', action: 'command-menu' }
    case 'toggle-tab-sidebar': return { kind: 'shell', action: 'toggle-tab-sidebar' }
    case 'split-tab': return { kind: 'host', command: { type: 'split-tab' } }
    case 'unsplit-tab': return { kind: 'host', command: { type: 'unsplit-tab' } }
    case 'copy-address': return { kind: 'host', command: { type: 'copy-page-address', clean: true } }
    case 'copy-address-raw': return { kind: 'host', command: { type: 'copy-page-address', clean: false } }
    case 'help': return { kind: 'host', command: { type: 'open', intent: { kind: 'url', value: 'https://intoponet.com/' } } }
    case 'inspect-page': return { kind: 'native', action: 'inspect-page' }
    case 'show-history': return { kind: 'native', action: 'show-history' }
    case 'shell-devtools': return { kind: 'native', action: 'shell-devtools' }
    case 'new-quick-window': return { kind: 'native', action: 'new-quick-window' }
    case 'open-quick-in-main': return { kind: 'native', action: 'open-quick-in-main' }
  }
}

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

function closedLabel(entry: { title: string; url: string }): string {
  if (entry.title.trim()) return truncate(entry.title.trim(), 60)
  try {
    return truncate(new URL(entry.url).hostname, 60)
  } catch {
    return truncate(entry.url, 60)
  }
}

/** The menu bar for the current state. `run` carries out a chosen command. */
export function appMenuTemplate(state: AppMenuState, run: (command: AppCommand) => void): MenuItemConstructorOptions[] {
  const isMac = state.platform === 'darwin'
  const item = (
    label: string,
    type: SimpleCommandType,
    enabled = true,
  ): MenuItemConstructorOptions[] => {
    const [accelerator, ...aliases] = APP_SHORTCUTS[type]
    const click = (): void => run({ type } as AppCommand)
    return [
      { id: type, label, ...(accelerator ? { accelerator } : {}), enabled, click },
      // Other chords for the same command: hidden, but their keys still work.
      ...aliases.map((alias, index): MenuItemConstructorOptions => ({
        id: `${type}-alt-${index + 1}`, label, accelerator: alias, enabled, click, visible: false, acceleratorWorksWhenHidden: true,
      })),
    ]
  }
  const page = state.hasPage

  const recentlyClosed: MenuItemConstructorOptions[] = state.recentlyClosed.length
    ? state.recentlyClosed.slice(0, 15).map((entry) => ({
        id: `closed-${entry.id}`,
        label: closedLabel(entry),
        click: () => run({ type: 'reopen-closed-tab', id: entry.id }),
      }))
    : [{ id: 'closed-none', label: 'No Recently Closed Tabs', enabled: false }]

  const tabNumbers: MenuItemConstructorOptions[] = TAB_NUMBER_SHORTCUTS.map(({ accelerator, index }) => ({
    id: `select-tab-${index === -1 ? 'last' : index + 1}`,
    label: index === -1 ? 'Select Last Tab' : `Select Tab ${index + 1}`,
    accelerator,
    enabled: index === -1 ? state.tabCount > 0 : state.tabCount > index,
    visible: false,
    acceleratorWorksWhenHidden: true,
    click: () => run({ type: 'select-tab', index }),
  }))
  const workspaceCount = state.workspaceCount ?? 1
  const workspaceNumbers: MenuItemConstructorOptions[] = workspaceNumberShortcuts(state.platform).map(({ accelerator, index }) => ({
    id: `select-workspace-${index + 1}`,
    label: `Workspace ${index + 1}`,
    accelerator,
    enabled: workspaceCount > index,
    visible: false,
    acceleratorWorksWhenHidden: true,
    click: () => run({ type: 'select-workspace', index }),
  }))

  return [
    ...(isMac
      ? [{
          label: 'Intoponet',
          submenu: [
            { role: 'about', label: 'About Intoponet' },
            { type: 'separator' },
            ...item('Settings…', 'settings'),
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide', label: 'Hide Intoponet' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit', label: 'Quit Intoponet' },
          ],
        } satisfies MenuItemConstructorOptions]
      : []),
    {
      label: 'File',
      submenu: [
        ...item('New Tab', 'new-tab'),
        ...item('New Quick Window', 'new-quick-window'),
        { ...item('Private Browsing', 'toggle-private')[0], type: 'checkbox', checked: state.privateMode },
        ...item('Open Location…', 'open-location'),
        ...item('Commands…', 'command-menu'),
        { type: 'separator' },
        ...item('Close Tab', 'close-tab', state.tabShowing),
        ...item('Open in Intoponet', 'open-quick-in-main', state.quickWindowFocused),
        ...item('Reopen Closed Tab', 'reopen-closed-tab', state.recentlyClosed.length > 0),
        { type: 'separator' },
        ...item('Save Page As…', 'save-page', page),
        ...item('Export as PDF', 'export-pdf', page),
        { type: 'separator' },
        ...item('Print…', 'print', page),
        ...(isMac ? [] : [{ type: 'separator' } as const, { role: 'quit' } as const]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [{ role: 'pasteAndMatchStyle' } as const] : []),
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        // Shown, not registered: in a page the key goes to a focused text field first (main/index.ts),
        // and the shell handles it itself, so the menu never runs it a second time.
        ...item('Copy Page Address', 'copy-address', page).map((entry) => ({ ...entry, registerAccelerator: false })),
        ...item('Copy Page Address Exactly', 'copy-address-raw', page).map((entry) => ({ ...entry, registerAccelerator: false, visible: false })),
        { type: 'separator' },
        {
          label: 'Find',
          submenu: [
            ...item('Find…', 'find', page),
            ...item('Find Next', 'find-next', page),
            ...item('Find Previous', 'find-previous', page),
          ],
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        ...item('Show or Hide Tab Sidebar', 'toggle-tab-sidebar'),
        { type: 'separator' },
        ...item('Split with Next Tab', 'split-tab', state.tabShowing),
        ...item('Unsplit Tabs', 'unsplit-tab', state.splitActive === true),
        { type: 'separator' },
        ...item('Reload Page', 'reload', page),
        ...item('Reload Page Ignoring Cache', 'force-reload', page),
        ...item('Stop Loading', 'stop', page && state.isLoading),
        { type: 'separator' },
        ...item('Actual Size', 'zoom-reset', page),
        ...item('Zoom In', 'zoom-in', page),
        ...item('Zoom Out', 'zoom-out', page),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Developer',
          submenu: [
            ...item('Inspect Page', 'inspect-page', page),
            ...(state.developer ? item('App Window Developer Tools', 'shell-devtools') : []),
          ],
        },
      ],
    },
    {
      label: 'History',
      submenu: [
        ...item('Back', 'back', page && state.canGoBack),
        ...item('Forward', 'forward', page && state.canGoForward),
        ...item('Globe', 'home', state.tabShowing),
        ...item('Show All History', 'show-history', true),
        { type: 'separator' },
        { label: 'Recently Closed', submenu: recentlyClosed },
      ],
    },
    {
      label: 'Bookmarks',
      submenu: [
        ...item('Bookmark This Page…', 'bookmark', page),
        ...item('Show Bookmarks', 'show-bookmarks'),
      ],
    },
    {
      label: 'Window',
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        ...item('Select Next Tab', 'next-tab', state.tabCount > 1),
        ...item('Select Previous Tab', 'previous-tab', state.tabCount > 1),
        ...tabNumbers,
        ...workspaceNumbers,
        ...(isMac ? [{ type: 'separator' } as const, { role: 'front' } as const] : []),
      ],
    },
    {
      label: 'Help',
      role: 'help',
      submenu: [{ id: 'help', label: 'Intoponet Website', click: () => run({ type: 'help' }) }],
    },
  ]
}

/** A short key for the state, so the menu bar is rebuilt only when something it shows changed. */
export function appMenuStateKey(state: AppMenuState): string {
  return JSON.stringify([
    state.tabShowing, state.hasPage, state.canGoBack, state.canGoForward, state.isLoading,
    Math.min(state.tabCount, 9), state.privateMode, state.developer, state.workspaceCount ?? 1, state.quickWindowFocused, state.splitActive === true,
    state.recentlyClosed.slice(0, 15).map((entry) => [entry.id, closedLabel(entry)]),
  ])
}

/** Keeps the menu bar current, rebuilding it (on the next tick, at most once) only when its state changed. */
export function createAppMenuController(options: {
  state: () => AppMenuState
  run: (command: AppCommand) => void
  apply: (template: MenuItemConstructorOptions[]) => void
}): { refresh: () => void; schedule: () => void } {
  let key = ''
  let scheduled = false
  const refresh = (): void => {
    scheduled = false
    const state = options.state()
    const next = appMenuStateKey(state)
    if (next === key) return
    key = next
    options.apply(appMenuTemplate(state, options.run))
  }
  return {
    refresh,
    schedule: () => {
      if (scheduled) return
      scheduled = true
      setTimeout(refresh, 0)
    },
  }
}

// ---- The same chords pressed while a web page has keyboard focus -------------------------------

export type KeyInput = { type: string; key: string; code?: string; meta: boolean; control: boolean; shift: boolean; alt: boolean }

type Chord = { meta: boolean; control: boolean; alt: boolean; shift: boolean | 'any'; key: string }

/** Parses an accelerator ("CmdOrCtrl+Shift+]") into the modifiers and key a keystroke must have. */
export function parseAccelerator(accelerator: string, platform: NodeJS.Platform = process.platform): Chord {
  const parts = accelerator.split('+')
  // "CmdOrCtrl+Plus" names the key; a literal trailing "+" would split into an empty part.
  const keyPart = parts.pop() ?? ''
  const chord: Chord = { meta: false, control: false, alt: false, shift: false, key: keyPart.toLowerCase() }
  for (const part of parts) {
    const name = part.toLowerCase()
    if (name === 'cmdorctrl' || name === 'commandorcontrol') {
      if (platform === 'darwin') chord.meta = true
      else chord.control = true
    } else if (name === 'cmd' || name === 'command' || name === 'super' || name === 'meta') chord.meta = true
    else if (name === 'ctrl' || name === 'control') chord.control = true
    else if (name === 'alt' || name === 'option') chord.alt = true
    else if (name === 'shift') chord.shift = true
  }
  // ⌘+ is ⇧= on most keyboards: either way it zooms in.
  if (chord.key === 'plus') {
    chord.key = '+'
    chord.shift = 'any'
  }
  return chord
}

const SHIFTED: Record<string, string> = { '{': '[', '}': ']', '_': '-', '<': ',', '>': '.', '?': '/', ':': ';', '"': "'", '|': '\\' }
const CODE_KEYS: Record<string, string> = {
  BracketLeft: '[', BracketRight: ']', Equal: '=', Minus: '-', Comma: ',', Period: '.', Tab: 'tab',
}

/** The key names a keystroke can match: its character, unshifted, and (with ⌥, which changes the character) its physical key. */
function inputKeys(input: KeyInput): Set<string> {
  const keys = new Set<string>()
  const key = input.key.toLowerCase()
  keys.add(key)
  if (SHIFTED[key]) keys.add(SHIFTED[key])
  if (key === '+' || (input.code === 'Equal' && input.shift)) keys.add('+')
  // With Shift, the key that is typed is "+" or "_", but ⌃⇧= and ⌃⇧- name the physical key: match it too.
  if (input.code === 'Equal') keys.add('=')
  if (input.code === 'Minus') keys.add('-')
  if (input.alt && input.code) {
    const letter = /^Key([A-Z])$/.exec(input.code)?.[1]
    const digit = /^Digit(\d)$/.exec(input.code)?.[1]
    const named = CODE_KEYS[input.code]
    if (letter) keys.add(letter.toLowerCase())
    if (digit) keys.add(digit)
    if (named) keys.add(named)
  }
  return keys
}

function matches(chord: Chord, input: KeyInput, keys: Set<string>): boolean {
  if (chord.meta !== input.meta || chord.control !== input.control || chord.alt !== input.alt) return false
  if (chord.shift !== 'any' && chord.shift !== input.shift) return false
  return keys.has(chord.key)
}

/**
 * The menu command for a key pressed inside a page, or null to leave it to the page. The page view
 * handles these itself (before-input-event, which also keeps the menu from running them a second time),
 * so they work whatever the page does with its keys.
 */
export function appCommandForInput(input: KeyInput, options: { developer?: boolean; platform?: NodeJS.Platform } = {}): AppCommand | null {
  if (input.type !== 'keyDown') return null
  const platform = options.platform ?? process.platform
  // Workspace numbers take ⌥ where ⌃ is the command key.
  if (!input.meta && !input.control && !(input.alt && platform !== 'darwin')) return null
  const keys = inputKeys(input)
  for (const [type, accelerators] of Object.entries(APP_SHORTCUTS) as [SimpleCommandType, readonly string[]][]) {
    if (type === 'shell-devtools' && !options.developer) continue
    if (accelerators.some((accelerator) => matches(parseAccelerator(accelerator, platform), input, keys))) return { type } as AppCommand
  }
  for (const { accelerator, index } of TAB_NUMBER_SHORTCUTS) {
    if (matches(parseAccelerator(accelerator, platform), input, keys)) return { type: 'select-tab', index }
  }
  for (const { accelerator, index } of workspaceNumberShortcuts(platform)) {
    if (matches(parseAccelerator(accelerator, platform), input, keys)) return { type: 'select-workspace', index }
  }
  return null
}

/** A menu command chosen by id from command mode, or null when there is no such simple command. */
export function menuCommandById(id: string, options: { developer?: boolean } = {}): AppCommand | null {
  if (!Object.prototype.hasOwnProperty.call(APP_SHORTCUTS, id)) return null
  if (id === 'shell-devtools' && !options.developer) return null
  return { type: id } as AppCommand
}

/** Every accelerator the menu bar declares (for checking that none is used twice). */
export function templateAccelerators(template: MenuItemConstructorOptions[]): string[] {
  const found: string[] = []
  const walk = (items: MenuItemConstructorOptions[]): void => {
    for (const entry of items) {
      if (typeof entry.accelerator === 'string') found.push(entry.accelerator)
      if (Array.isArray(entry.submenu)) walk(entry.submenu)
    }
  }
  walk(template)
  return found
}
