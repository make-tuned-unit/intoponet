import type { PageAppearance } from '@intoponet/browser-api'
import { isPageAppearance } from '@intoponet/browser-api'

/**
 * How web pages colour themselves (prefers-color-scheme). By default pages follow the Mac's
 * appearance (light or dark, as macOS tells Chromium); "Light" or "Dark" in Settings overrides it
 * for pages only, through DevTools-protocol media emulation, so the app's own window, menus and
 * dialogs keep following macOS.
 *
 * Earlier builds forced every page to light this way; nothing else (protection, translation,
 * captures) relied on that debugger session. Chromium's automatic "force dark" stays off (the
 * WebContentsForceDark feature is disabled at startup), so a page is never recoloured against its
 * own design.
 */

/** The prefers-color-scheme to emulate, or null to leave pages on the system appearance. */
export function emulatedColorScheme(appearance: PageAppearance): 'light' | 'dark' | null {
  return appearance === 'system' ? null : appearance
}

export function parsePageAppearanceFile(raw: unknown): PageAppearance {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const value = (raw as Record<string, unknown>)['pageAppearance']
    if (isPageAppearance(value)) return value
  }
  return 'system'
}

/** The part of a page's debugger this needs (Electron's `webContents.debugger`). */
export type PageDebugger = {
  isAttached(): boolean
  attach(protocolVersion?: string): void
  detach(): void
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>
}

export type ThemedPage = {
  debugger: PageDebugger
  isDestroyed(): boolean
  on(event: 'did-start-navigation', listener: () => void): unknown
  once(event: 'destroyed', listener: () => void): unknown
}

/** Applies the page appearance to every page view, and again whenever it changes. */
export class PageAppearanceController {
  private appearance: PageAppearance
  /** Pages whose debugger session this attached (and may detach again). */
  private readonly ours = new WeakSet<ThemedPage>()
  private readonly pages = new Set<ThemedPage>()

  constructor(initial: PageAppearance) {
    this.appearance = initial
  }

  get current(): PageAppearance {
    return this.appearance
  }

  /** A new page view: keep it on the chosen appearance across its navigations. */
  watch(page: ThemedPage): void {
    this.pages.add(page)
    void this.apply(page)
    page.on('did-start-navigation', () => { void this.apply(page) })
    page.once('destroyed', () => this.forget(page))
  }

  forget(page: ThemedPage): void {
    this.pages.delete(page)
  }

  set(appearance: PageAppearance): void {
    this.appearance = appearance
    for (const page of this.pages) {
      if (page.isDestroyed()) this.pages.delete(page)
      else void this.apply(page)
    }
  }

  private async apply(page: ThemedPage): Promise<void> {
    if (page.isDestroyed()) return
    const scheme = emulatedColorScheme(this.appearance)
    try {
      if (!scheme) {
        // Back to the system appearance: leaving the session drops its emulation.
        if (this.ours.has(page) && page.debugger.isAttached()) {
          await page.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] }).catch(() => undefined)
          page.debugger.detach()
        }
        this.ours.delete(page)
        return
      }
      if (!page.debugger.isAttached()) {
        page.debugger.attach('1.3')
        this.ours.add(page)
      }
      await page.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
    } catch {
      // DevTools may already own the page's debugger session; the page keeps the system appearance.
    }
  }
}
