import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  APP_SHORTCUTS,
  appCommandForInput,
  appMenuStateKey,
  appMenuTemplate,
  createAppMenuController,
  menuCommandById,
  parseAccelerator,
  routeAppCommand,
  templateAccelerators,
  type AppCommand,
  type AppMenuState,
} from './appMenu'

const state = (overrides: Partial<AppMenuState> = {}): AppMenuState => ({
  platform: 'darwin',
  tabShowing: true,
  hasPage: true,
  canGoBack: true,
  canGoForward: false,
  isLoading: false,
  tabCount: 3,
  privateMode: false,
  recentlyClosed: [],
  developer: false,
  quickWindowFocused: false,
  ...overrides,
})

function findItem(template: MenuItemConstructorOptions[], id: string): MenuItemConstructorOptions | undefined {
  for (const entry of template) {
    if (entry.id === id) return entry
    if (Array.isArray(entry.submenu)) {
      const found = findItem(entry.submenu, id)
      if (found) return found
    }
  }
  return undefined
}

/** Two accelerators are the same chord if they parse the same (CmdOrCtrl vs Cmd on macOS…). */
const chordKey = (accelerator: string) => JSON.stringify(parseAccelerator(accelerator, 'darwin'))

describe('the menu bar', () => {
  it('uses every key chord once (no shortcut can fire two items)', () => {
    for (const developer of [false, true]) {
      const accelerators = templateAccelerators(appMenuTemplate(state({ developer }), () => undefined))
      const chords = accelerators.map(chordKey)
      expect(new Set(chords).size).toBe(chords.length)
      // The roles' own chords (⌘Q, ⌘H, ⌘M, ⌃⌘F, ⌘C…) are not taken by a command.
      for (const reserved of ['Cmd+Q', 'Cmd+H', 'Cmd+M', 'Ctrl+Cmd+F', 'Cmd+C', 'Cmd+V', 'Cmd+X', 'Cmd+A', 'Cmd+Z', 'Shift+Cmd+Z', 'Alt+Cmd+H']) {
        expect(chords).not.toContain(chordKey(reserved))
      }
    }
  })

  it('has the expected menus and key chords', () => {
    const template = appMenuTemplate(state(), () => undefined)
    expect(template.map((entry) => entry.label)).toEqual(['Intoponet', 'File', 'Edit', 'View', 'History', 'Bookmarks', 'Window', 'Help'])
    const accelerators = templateAccelerators(template)
    for (const chord of ['CmdOrCtrl+,', 'CmdOrCtrl+T', 'CmdOrCtrl+W', 'CmdOrCtrl+Shift+T', 'CmdOrCtrl+L', 'CmdOrCtrl+S', 'CmdOrCtrl+P', 'CmdOrCtrl+F', 'CmdOrCtrl+G', 'CmdOrCtrl+Shift+G', 'CmdOrCtrl+R', 'CmdOrCtrl+Shift+R', 'CmdOrCtrl+0', 'CmdOrCtrl+Plus', 'CmdOrCtrl+=', 'CmdOrCtrl+-', 'CmdOrCtrl+Alt+I', 'CmdOrCtrl+[', 'CmdOrCtrl+]', 'CmdOrCtrl+D', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'CmdOrCtrl+Shift+]', 'CmdOrCtrl+Shift+[', 'CmdOrCtrl+1', 'CmdOrCtrl+8', 'CmdOrCtrl+9']) {
      expect(accelerators).toContain(chord)
    }
    // Escape is never a menu chord: the app window uses it for its own panels.
    expect(accelerators.some((chord) => /esc/i.test(chord))).toBe(false)
    // The app window's developer tools only in development.
    expect(findItem(template, 'shell-devtools')).toBeUndefined()
    expect(findItem(appMenuTemplate(state({ developer: true }), () => undefined), 'shell-devtools')).toBeDefined()
  })

  it('enables page items only when a page is showing', () => {
    const globe = appMenuTemplate(state({ tabShowing: false, hasPage: false, canGoBack: false }), () => undefined)
    // With no tab in front, ⌘W closes the window instead (it would otherwise do nothing).
    expect(findItem(globe, 'close-tab')).toBeUndefined()
    expect(findItem(globe, 'close-window')).toMatchObject({ role: 'close', accelerator: 'CmdOrCtrl+W', label: 'Close Window' })
    expect(findItem(appMenuTemplate(state(), () => undefined), 'close-window')).toBeUndefined()
    for (const id of ['save-page', 'export-pdf', 'print', 'find', 'find-next', 'reload', 'force-reload', 'zoom-in', 'zoom-in-alt-1', 'inspect-page', 'back', 'bookmark', 'home']) {
      expect(findItem(globe, id)?.enabled, id).toBe(false)
    }
    for (const id of ['new-tab', 'open-location', 'settings', 'show-bookmarks']) expect(findItem(globe, id)?.enabled, id).toBe(true)
    // A start page: the tab can close, but there is no page to print or save.
    const start = appMenuTemplate(state({ hasPage: false }), () => undefined)
    expect(findItem(start, 'close-tab')?.enabled).toBe(true)
    expect(findItem(start, 'print')?.enabled).toBe(false)
    const page = appMenuTemplate(state(), () => undefined)
    expect(findItem(page, 'back')?.enabled).toBe(true)
    expect(findItem(page, 'forward')?.enabled).toBe(false)
    expect(findItem(page, 'stop')?.enabled).toBe(false)
    expect(findItem(appMenuTemplate(state({ isLoading: true }), () => undefined), 'stop')?.enabled).toBe(true)
  })

  it('enables tab numbers that exist, and lists recently closed tabs', () => {
    const run = vi.fn<(command: AppCommand) => void>()
    const template = appMenuTemplate(state({ tabCount: 2, recentlyClosed: [{ id: 'c1', title: 'Closed page', url: 'https://a.example/' }, { id: 'c2', title: '', url: 'https://b.example/x' }] }), run)
    expect(findItem(template, 'select-tab-2')?.enabled).toBe(true)
    expect(findItem(template, 'select-tab-3')?.enabled).toBe(false)
    expect(findItem(template, 'select-tab-last')?.enabled).toBe(true)
    expect(findItem(template, 'reopen-closed-tab')?.enabled).toBe(true)
    expect(findItem(template, 'closed-c1')?.label).toBe('Closed page')
    expect(findItem(template, 'closed-c2')?.label).toBe('b.example')
    ;(findItem(template, 'closed-c2')?.click as () => void)()
    expect(run).toHaveBeenCalledWith({ type: 'reopen-closed-tab', id: 'c2' })
    ;(findItem(template, 'select-tab-last')?.click as () => void)()
    expect(run).toHaveBeenCalledWith({ type: 'select-tab', index: -1 })
    const empty = appMenuTemplate(state(), () => undefined)
    expect(findItem(empty, 'reopen-closed-tab')?.enabled).toBe(false)
    expect(findItem(empty, 'closed-none')?.enabled).toBe(false)
  })

  it('switches workspaces with ⌃1–9 (⌘1–9 stay with tabs), in the menu and inside a page', () => {
    const run = vi.fn<(command: AppCommand) => void>()
    const template = appMenuTemplate(state({ workspaceCount: 2 }), run)
    expect(findItem(template, 'select-workspace-2')).toMatchObject({ accelerator: 'Ctrl+2', enabled: true, visible: false })
    expect(findItem(template, 'select-workspace-3')?.enabled).toBe(false)
    ;(findItem(template, 'select-workspace-2')?.click as () => void)()
    expect(run).toHaveBeenCalledWith({ type: 'select-workspace', index: 1 })
    expect(routeAppCommand({ type: 'select-workspace', index: 1 })).toEqual({ kind: 'host', command: { type: 'switch-workspace', index: 1 } })
    const key = (digit: string, mods: { meta?: boolean; control?: boolean; alt?: boolean }) => appCommandForInput({ type: 'keyDown', key: digit, code: `Digit${digit}`, meta: false, control: false, shift: false, alt: false, ...mods }, { platform: 'darwin' })
    expect(key('2', { control: true })).toEqual({ type: 'select-workspace', index: 1 })
    expect(key('2', { meta: true })).toEqual({ type: 'select-tab', index: 1 })
    expect(key('9', { control: true })).toEqual({ type: 'select-workspace', index: 8 })
    expect(appMenuStateKey(state({ workspaceCount: 2 }))).not.toBe(appMenuStateKey(state({ workspaceCount: 3 })))
  })

  it('shows private browsing as a checkbox in its current state', () => {
    expect(findItem(appMenuTemplate(state({ privateMode: true }), () => undefined), 'toggle-private')).toMatchObject({ type: 'checkbox', checked: true, accelerator: 'CmdOrCtrl+Shift+N' })
  })

  it('routes each command to the interface, the browser host or the main process', () => {
    expect(routeAppCommand({ type: 'find-next' })).toEqual({ kind: 'shell', action: 'find-next' })
    expect(routeAppCommand({ type: 'settings' })).toEqual({ kind: 'shell', action: 'open-settings' })
    expect(routeAppCommand({ type: 'close-tab' })).toEqual({ kind: 'host', command: { type: 'close-active-tab' } })
    expect(routeAppCommand({ type: 'reopen-closed-tab' })).toEqual({ kind: 'host', command: { type: 'reopen-closed-tab' } })
    expect(routeAppCommand({ type: 'home' })).toEqual({ kind: 'host', command: { type: 'close' } })
    expect(routeAppCommand({ type: 'zoom-in' })).toEqual({ kind: 'host', command: { type: 'zoom', action: 'in' } })
    expect(routeAppCommand({ type: 'inspect-page' })).toEqual({ kind: 'native', action: 'inspect-page' })
  })

  it('every shortcut in the table matches its own command when pressed in a page', () => {
    for (const [type, accelerators] of Object.entries(APP_SHORTCUTS)) {
      for (const accelerator of accelerators) {
        const chord = parseAccelerator(accelerator, 'darwin')
        const key = chord.key === 'tab' ? 'Tab' : chord.key
        const input = { type: 'keyDown', key, meta: chord.meta, control: chord.control, alt: chord.alt, shift: chord.shift === true, code: /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : '' }
        expect(appCommandForInput(input, { developer: true, platform: 'darwin' }), accelerator).toEqual({ type })
      }
    }
  })
})

describe('menu refreshes', () => {
  it('rebuilds only when what the menu shows changed', async () => {
    let current = state()
    const apply = vi.fn()
    const controller = createAppMenuController({ state: () => current, run: () => undefined, apply })
    controller.refresh()
    expect(apply).toHaveBeenCalledTimes(1)
    controller.schedule()
    controller.schedule()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(apply).toHaveBeenCalledTimes(1)
    current = state({ isLoading: true })
    controller.schedule()
    controller.schedule()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(apply).toHaveBeenCalledTimes(2)
    // Tab counts past nine change nothing in the menu.
    expect(appMenuStateKey(state({ tabCount: 10 }))).toBe(appMenuStateKey(state({ tabCount: 12 })))
  })

  it('offers every menu command in the command menu (⌘K)', async () => {
    const { menuActions, COMMAND_MENU_LEFT_OUT } = await import('../renderer/src/commandMenu')
    // Split and Unsplit exclude each other: both states together offer every command.
    const state = { hasPage: true, pageShown: true, canGoBack: true, canGoForward: true, loading: true, tabCount: 3, privateMode: false, sidebarHidden: false }
    const offered = [...new Set([...menuActions(state), ...menuActions({ ...state, splitActive: true })].map((action) => action.id))]
    expect([...offered, ...COMMAND_MENU_LEFT_OUT].sort()).toEqual(Object.keys(APP_SHORTCUTS).sort())
    for (const id of offered) expect(menuCommandById(id)).toEqual({ type: id })
    expect(menuCommandById('shell-devtools')).toBeNull()
    expect(menuCommandById('toString')).toBeNull()
  })
})

describe('pages side by side keys', () => {
  const key = (typed: string, code: string, mods: { control?: boolean; shift?: boolean }) => ({
    type: 'keyDown', key: typed, code, meta: false, control: !!mods.control, shift: !!mods.shift, alt: false,
  })

  it('⌃⇧= splits and ⌃⇧- unsplits, whether the key comes as "=" or as the shifted "+" (and ⌃⇧_ as well)', () => {
    expect(appCommandForInput(key('=', 'Equal', { control: true, shift: true }), { platform: 'darwin' })).toEqual({ type: 'split-tab' })
    expect(appCommandForInput(key('+', 'Equal', { control: true, shift: true }), { platform: 'darwin' })).toEqual({ type: 'split-tab' })
    expect(appCommandForInput(key('-', 'Minus', { control: true, shift: true }), { platform: 'darwin' })).toEqual({ type: 'unsplit-tab' })
    expect(appCommandForInput(key('_', 'Minus', { control: true, shift: true }), { platform: 'darwin' })).toEqual({ type: 'unsplit-tab' })
  })

  it('leaves ⌘= and ⌘- (zoom) alone', () => {
    const cmd = (typed: string, code: string) => ({ type: 'keyDown', key: typed, code, meta: true, control: false, shift: false, alt: false })
    expect(appCommandForInput(cmd('=', 'Equal'), { platform: 'darwin' })).toEqual({ type: 'zoom-in' })
    expect(appCommandForInput(cmd('-', 'Minus'), { platform: 'darwin' })).toEqual({ type: 'zoom-out' })
  })
})
