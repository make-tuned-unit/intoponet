import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, WebContentsView: class {} }))
const { escapeIsTheAddressFields, jsonForScript, parseQuickToolbarMessage, quickToolbarHtml, quickWindowBounds, quickWindowKeyAction, QUICK_WINDOW_SIZE } = await import('./quickWindow')

const state = (overrides: Partial<Parameters<typeof quickToolbarHtml>[0]> = {}) => ({
  address: 'https://example.org/',
  hasPage: true,
  secure: true,
  isPrivate: false,
  blocked: 3,
  protectionOn: true,
  error: '',
  ...overrides,
})

/** The text between the first <script> and its closing tag. */
const scriptOf = (html: string): string => /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''
const styleOf = (html: string): string => /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? ''
const cspOf = (html: string): string => /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? ''
const hashOf = (text: string): string => `'sha256-${createHash('sha256').update(text).digest('base64')}'`

describe('quick window bounds', () => {
  const area = { x: 0, y: 25, width: 1440, height: 875 }

  it('is the default size, centred on the work area', () => {
    const bounds = quickWindowBounds(area)
    expect(bounds).toEqual({ x: 270, y: 25 + Math.round((875 - 640) / 2), width: 900, height: 640 })
  })

  it('stays inside a small screen and never below the minimum it can keep', () => {
    const small = quickWindowBounds({ x: 0, y: 0, width: 700, height: 500 })
    expect(small.width).toBe(700 - 48)
    expect(small.height).toBe(500 - 48)
    expect(small.x).toBeGreaterThanOrEqual(0)
    const tiny = quickWindowBounds({ x: 0, y: 0, width: 300, height: 200 })
    expect(tiny.width).toBe(252)
    expect(tiny.height).toBe(152)
  })

  it('keeps the screen offset of a second display', () => {
    const bounds = quickWindowBounds({ x: 1440, y: 0, width: 1920, height: 1080 })
    expect(bounds.x).toBeGreaterThanOrEqual(1440)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1440 + 1920)
    expect(QUICK_WINDOW_SIZE.minWidth).toBeLessThanOrEqual(bounds.width)
  })
})

describe('the toolbar page', () => {
  it('uses a strict CSP that allows only its own script and style, by hash', () => {
    const html = quickToolbarHtml(state())
    const csp = cspOf(html)
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain(`script-src ${hashOf(scriptOf(html))}`)
    expect(csp).toContain(`style-src ${hashOf(styleOf(html))}`)
    expect(csp).not.toContain("'unsafe-inline'")
    expect(csp).not.toContain("'unsafe-eval'")
  })

  it('keeps a page address that tries to close the script element inside its JSON', () => {
    const hostile = 'https://a.example/</script><img src=x onerror="alert(1)">&\u2028'
    const html = quickToolbarHtml(state({ address: hostile }))
    // Only the element's own closing tag appears: the page address cannot open or close markup.
    expect(html.match(/<\/script>/g)).toHaveLength(1)
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('\u2028')
    // The CSP hash still covers exactly what the element holds.
    expect(cspOf(html)).toContain(`script-src ${hashOf(scriptOf(html))}`)
    expect(scriptOf(html)).toContain('\\u003c/script\\u003e')
  })

  it('shows its state from the JSON it was built with', () => {
    const html = quickToolbarHtml(state({ isPrivate: true, error: 'Nope' }))
    expect(scriptOf(html)).toContain('"isPrivate":true')
    expect(scriptOf(html)).toContain('"error":"Nope"')
    expect(html).toContain('id="open"')
    expect(html).toContain('aria-label="Address"')
  })

  it('renders text through textContent only (no innerHTML in the script)', () => {
    const html = quickToolbarHtml(state())
    expect(scriptOf(html)).not.toContain('innerHTML')
    expect(scriptOf(html)).not.toContain('insertAdjacentHTML')
  })

  it('keeps the address being edited while the window is in the back, and stops when the field is left', () => {
    // The toolbar script against a small stand-in for its page: focus and blur as Chromium does them.
    type Fake = { id: string; value: string; readOnly: boolean; hidden: boolean; textContent: string; listeners: Record<string, Array<(event: unknown) => void>>; addEventListener: (type: string, listener: (event: unknown) => void) => void; focus: () => void; blur: () => void; select: () => void }
    const body = { id: 'body' }
    const document = { activeElement: body as unknown, getElementById: (id: string) => elements[id] }
    const fire = (element: Fake, type: string): void => { for (const listener of element.listeners[type] ?? []) listener({ key: '', preventDefault() {} }) }
    const fake = (id: string): Fake => {
      const element: Fake = {
        id, value: '', readOnly: false, hidden: false, textContent: '', listeners: {},
        addEventListener: (type, listener) => { (element.listeners[type] ??= []).push(listener) },
        focus: () => { document.activeElement = element; fire(element, 'focus') },
        // The field is left: focus is already elsewhere when blur arrives.
        blur: () => { document.activeElement = body; fire(element, 'blur') },
        select: () => undefined,
      }
      return element
    }
    const elements: Record<string, Fake> = Object.fromEntries(['address', 'secure', 'private', 'protection', 'error', 'always', 'open', 'close'].map((id) => [id, fake(id)]))
    const sent: unknown[] = []
    const window: Record<string, unknown> = {}
    const console = { log: (line: string) => sent.push(parseQuickToolbarMessage(line)) }
    new Function('document', 'window', 'console', scriptOf(quickToolbarHtml(state())))(document, window, console)
    const address = elements['address']!
    expect(address.readOnly).toBe(true)

    ;(window['quickFocusAddress'] as () => void)()
    expect(address.readOnly).toBe(false)
    expect(sent.at(-1)).toEqual({ type: 'editing', on: true })
    // Another app comes forward: the field gets blur but keeps focus (Chromium refocuses it on return).
    fire(address, 'blur')
    expect(address.readOnly).toBe(false)
    expect(sent.at(-1)).toEqual({ type: 'editing', on: true })
    // Leaving the field ends the edit.
    address.blur()
    expect(address.readOnly).toBe(true)
    expect(sent.at(-1)).toEqual({ type: 'editing', on: false })
  })
})

describe('jsonForScript', () => {
  it('escapes angle brackets, ampersands and the line separators', () => {
    const text = jsonForScript({ a: '</x>&\u2028\u2029' })
    expect(text).not.toMatch(/[<>&\u2028\u2029]/)
    expect(JSON.parse(text)).toEqual({ a: '</x>&\u2028\u2029' })
  })
})

describe('messages from the toolbar', () => {
  it('reads its own commands', () => {
    expect(parseQuickToolbarMessage('intoponet-quick:{"type":"open-in-main"}')).toEqual({ type: 'open-in-main' })
    expect(parseQuickToolbarMessage('intoponet-quick:{"type":"close"}')).toEqual({ type: 'close' })
    expect(parseQuickToolbarMessage('intoponet-quick:{"type":"always-here"}')).toEqual({ type: 'always-here' })
    expect(quickToolbarHtml({ address: '', hasPage: false, secure: false, isPrivate: false, blocked: 0, protectionOn: true, error: '' })).toContain('id="always"')
    expect(parseQuickToolbarMessage('intoponet-quick:{"type":"go","value":"lisbon"}')).toEqual({ type: 'go', value: 'lisbon' })
    expect(parseQuickToolbarMessage('intoponet-quick:{"type":"editing","on":true}')).toEqual({ type: 'editing', on: true })
    expect(parseQuickToolbarMessage('intoponet-quick:{"type":"editing","on":"yes"}')).toBeNull()
  })

  it('ignores anything else', () => {
    expect(parseQuickToolbarMessage('some other log line')).toBeNull()
    expect(parseQuickToolbarMessage('intoponet-quick:not json')).toBeNull()
    expect(parseQuickToolbarMessage('intoponet-quick:[]')).toBeNull()
    expect(parseQuickToolbarMessage('intoponet-quick:{"type":"reload"}')).toBeNull()
    expect(parseQuickToolbarMessage('intoponet-quick:{"type":"go","value":3}')).toBeNull()
    expect(parseQuickToolbarMessage('intoponet-quick:{"type":"go","value":"' + 'a'.repeat(8193) + '"}')).toBeNull()
    expect(parseQuickToolbarMessage('intoponet-quick:{"type":"close"' + ' '.repeat(9000) + '}')).toBeNull()
    expect(parseQuickToolbarMessage(42)).toBeNull()
  })
})

describe('keys in a quick window', () => {
  const key = (overrides: Partial<Parameters<typeof quickWindowKeyAction>[0]> = {}) => ({
    type: 'keyDown', key: 'o', meta: true, control: false, shift: false, alt: false, ...overrides,
  })

  it('maps ⌘O, ⌘W, Escape, ⌘L, ⌥⌘N, ⌘R and history keys', () => {
    expect(quickWindowKeyAction(key())).toBe('open-in-main')
    expect(quickWindowKeyAction(key({ key: 'w' }))).toBe('close')
    expect(quickWindowKeyAction(key({ key: 'Escape', meta: false }))).toBe('close')
    expect(quickWindowKeyAction(key({ key: 'l' }))).toBe('focus-address')
    expect(quickWindowKeyAction(key({ key: 'n', alt: true, code: 'KeyN' }))).toBe('new-window')
    expect(quickWindowKeyAction(key({ key: 'r' }))).toBe('reload')
    expect(quickWindowKeyAction(key({ key: '[' }))).toBe('back')
    expect(quickWindowKeyAction(key({ key: ']' }))).toBe('forward')
  })

  it('hands other menu commands to the main window (they never act on the quick page)', () => {
    expect(quickWindowKeyAction(key({ key: 't' }))).toBe('main')
    expect(quickWindowKeyAction(key({ key: 'k' }))).toBe('main')
    expect(quickWindowKeyAction(key({ key: ',' }))).toBe('main')
  })

  it('leaves Escape to the address field only when it is typed there; in the page it still closes the window', () => {
    expect(escapeIsTheAddressFields(true, true)).toBe(true)
    // The field keeps focus in the toolbar when the page is clicked, so editing alone is not enough.
    expect(escapeIsTheAddressFields(true, false)).toBe(false)
    expect(escapeIsTheAddressFields(false, true)).toBe(false)
  })

  it('leaves ordinary typing and key-ups alone', () => {
    expect(quickWindowKeyAction(key({ key: 'a', meta: false }))).toBeNull()
    expect(quickWindowKeyAction(key({ key: 'c' }))).toBeNull()
    expect(quickWindowKeyAction(key({ type: 'keyUp' }))).toBeNull()
  })
})
