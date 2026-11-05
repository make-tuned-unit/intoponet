/** Zoom steps as in other browsers: ⌘+ and ⌘− move to the next one. */
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 3
const EPSILON = 0.005
/** Sites kept; the least recently zoomed go first. */
const MAX_SITES = 2_000

/** The next zoom step in a direction (a factor between steps moves to the nearest one that way). */
export function stepZoom(current: number, direction: 'in' | 'out'): number {
  const value = Number.isFinite(current) ? current : 1
  if (direction === 'in') return ZOOM_STEPS.find((step) => step > value + EPSILON) ?? MAX_ZOOM
  return [...ZOOM_STEPS].reverse().find((step) => step < value - EPSILON) ?? MIN_ZOOM
}

export function isDefaultZoom(factor: number): boolean {
  return Math.abs(factor - 1) < EPSILON
}

/** The site a zoom belongs to: the host of an http(s) page, without a leading "www.". */
export function zoomSite(url: string): string | null {
  try {
    const parsed = new URL(url)
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || !parsed.hostname) return null
    return parsed.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

function validFactor(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_ZOOM - EPSILON && value <= MAX_ZOOM + EPSILON
}

type ZoomFile = { version: 1; sites: Record<string, number> }

/**
 * Per-site zoom kept between launches (host → factor). Only sites not at 100% are stored.
 * Private tabs never read or write it (the caller checks).
 */
export class ZoomStore {
  private readonly sites = new Map<string, number>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly io: {
      /** The saved file's text, or null when there is none. */
      read: () => string | null
      /** Writes the file (atomically). */
      write: (data: string) => Promise<void>
    },
    private readonly saveDelayMs = 400,
  ) {
    this.load()
  }

  private load(): void {
    let raw: string | null = null
    try {
      raw = this.io.read()
    } catch {
      return
    }
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as Partial<ZoomFile>
      if (parsed?.version !== 1 || typeof parsed.sites !== 'object' || parsed.sites === null || Array.isArray(parsed.sites)) return
      for (const [site, factor] of Object.entries(parsed.sites).slice(-MAX_SITES)) {
        if (site.length > 253 || !validFactor(factor) || isDefaultZoom(factor)) continue
        this.sites.set(site, factor)
      }
    } catch {
      // A damaged file starts over at 100% everywhere.
    }
  }

  /** The site's zoom, 1 when none is saved. */
  get(url: string): number {
    const site = zoomSite(url)
    return (site && this.sites.get(site)) || 1
  }

  /** Remembers a site's zoom (100% forgets it). Returns whether anything changed. */
  set(url: string, factor: number): boolean {
    const site = zoomSite(url)
    if (!site || !validFactor(factor)) return false
    const previous = this.sites.get(site)
    if (isDefaultZoom(factor)) {
      if (previous === undefined) return false
      this.sites.delete(site)
    } else {
      if (previous !== undefined && Math.abs(previous - factor) < EPSILON) return false
      this.sites.delete(site)
      this.sites.set(site, Number(factor.toFixed(3)))
      while (this.sites.size > MAX_SITES) {
        const oldest = this.sites.keys().next().value
        if (oldest === undefined) break
        this.sites.delete(oldest)
      }
    }
    this.scheduleSave()
    return true
  }

  get size(): number {
    return this.sites.size
  }

  serialize(): string {
    return JSON.stringify({ version: 1, sites: Object.fromEntries(this.sites) } satisfies ZoomFile)
  }

  /** Writes now if a save is waiting (on quit). */
  flush(): Promise<void> {
    if (!this.saveTimer) return Promise.resolve()
    clearTimeout(this.saveTimer)
    this.saveTimer = null
    return this.io.write(this.serialize())
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.io.write(this.serialize()).catch((error: unknown) => console.error('Could not save page zoom:', error))
    }, this.saveDelayMs)
    this.saveTimer.unref?.()
  }
}
