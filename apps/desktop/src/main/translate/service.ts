import { PIVOT_LANGUAGE, type PageTranslationState, type TranslateCommand, type TranslateEvent, type TranslateStatus } from '@intoponet/browser-api'
import { CATALOG, catalogLanguages, isSupportedLanguage, pairBytes, pairsForLanguage, routeFor, TRANSLATE_ATTRIBUTION, type Catalog, type CatalogPair } from './catalog'
import { detectLanguage } from '../../shared/translate/detect'
import { pairKey, type Translator } from './engine'
import { applyScript, collectScript, parseCollected, parseSample, resetScript, restoreScript, sampleScript, TRANSLATE_WORLD_ID } from './pageScript'
import type { TranslateStore } from './store'

/** The part of WebContents page translation needs; WebContents satisfies it. */
export type TranslatePage = {
  id: number
  getURL(): string
  executeJavaScriptInIsolatedWorld(worldId: number, scripts: Array<{ code: string }>): Promise<unknown>
}

type PageRecord = { url: string; generation: number; state: PageTranslationState; detected: string | null }

const CACHE_LIMIT = 6_000
const BATCH_UNITS = 12
const BATCH_CHARS = 2_400

export class TranslateService {
  private downloading: { code: string; receivedBytes: number; totalBytes: number } | null = null
  private lastError: string | null = null
  private readonly cache = new Map<string, string>()
  private readonly pages = new Map<number, PageRecord>()
  private lastEmit = 0

  constructor(private readonly options: {
    store: TranslateStore
    engine: Translator & { forget?(keys: string[]): Promise<void> }
    emit: (event: TranslateEvent) => void
    getActivePage: () => TranslatePage | null
    /** Private tabs translate too (on this Mac), but their text is never kept in the cache. */
    isPrivatePage?: (page: TranslatePage) => boolean
    catalog?: Catalog
  }) {}

  private get catalog(): Catalog {
    return this.options.catalog ?? CATALOG
  }

  handle(command: TranslateCommand): Promise<unknown> {
    switch (command.type) {
      case 'status': return this.status()
      case 'install': return this.install(command.code)
      case 'remove': return this.remove(command.code)
      case 'translate': return this.translate(command.from, command.to, command.texts, command.html)
      case 'page-state': return this.pageState()
      case 'page-translate': return this.translatePage(command.from, command.to)
      case 'page-restore': return this.restorePage()
    }
  }

  async status(): Promise<TranslateStatus> {
    const languages = await Promise.all(catalogLanguages(this.catalog).map(async (code) => {
      const pairs = pairsForLanguage(code, this.catalog)
      const present = await Promise.all(pairs.map((pair) => this.options.store.hasPair(pair)))
      return { code, bytes: pairs.reduce((sum, pair) => sum + pairBytes(pair), 0), downloaded: present.every(Boolean) }
    }))
    return {
      languages,
      engine: { bytes: this.catalog.engine.file.bytes, downloaded: await this.options.store.hasEngine() },
      downloading: this.downloading,
      lastError: this.lastError,
      attribution: TRANSLATE_ATTRIBUTION,
    }
  }

  private async emitStatus(): Promise<void> {
    this.options.emit({ type: 'status', status: await this.status() })
  }

  async isInstalled(code: string): Promise<boolean> {
    if (code === PIVOT_LANGUAGE) return true
    const pairs = pairsForLanguage(code, this.catalog)
    if (pairs.length < 2) return false
    for (const pair of pairs) if (!(await this.options.store.hasPair(pair))) return false
    return true
  }

  async install(code: string): Promise<TranslateStatus> {
    if (!isSupportedLanguage(code, this.catalog) || code === PIVOT_LANGUAGE) throw new Error('That language is not available.')
    if (this.downloading) throw new Error('Another language is downloading. Try again when it finishes.')
    const { store } = this.options
    const pairs = pairsForLanguage(code, this.catalog)
    let totalBytes = pairs.reduce((sum, pair) => sum + pairBytes(pair), 0)
    // Take the slot before any await so two requests cannot both start.
    this.downloading = { code, receivedBytes: 0, totalBytes }
    this.lastError = null
    let needEngine: boolean
    try {
      needEngine = !(await store.hasEngine())
    } catch (error) {
      this.downloading = null
      throw error
    }
    if (needEngine) totalBytes += this.catalog.engine.file.bytes
    this.downloading = { code, receivedBytes: 0, totalBytes }
    const onBytes = (bytes: number): void => {
      if (!this.downloading) return
      this.downloading = { ...this.downloading, receivedBytes: Math.min(totalBytes, this.downloading.receivedBytes + bytes) }
      const now = Date.now()
      if (now - this.lastEmit > 150) {
        this.lastEmit = now
        void this.emitStatus()
      }
    }
    try {
      await this.emitStatus()
      if (needEngine) await store.downloadEngine(onBytes)
      for (const pair of pairs) await store.downloadPair(pair, onBytes)
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'The download failed.'
      throw new Error(this.lastError)
    } finally {
      this.downloading = null
      await this.emitStatus()
    }
    return this.status()
  }

  async remove(code: string): Promise<TranslateStatus> {
    if (this.downloading?.code === code) throw new Error('That language is still downloading.')
    const pairs = pairsForLanguage(code, this.catalog)
    await this.options.engine.forget?.(pairs.map(pairKey))
    for (const pair of pairs) await this.options.store.removePair(pair)
    for (const key of [...this.cache.keys()]) if (key.startsWith(`${code}>`) || key.includes(`>${code}>`)) this.cache.delete(key)
    const status = await this.status()
    if (!status.languages.some((language) => language.downloaded)) {
      await this.options.engine.close()
      await this.options.store.removeEngine()
    }
    await this.emitStatus()
    return this.status()
  }

  private async routeOrThrow(from: string, to: string): Promise<CatalogPair[]> {
    const route = routeFor(from, to, this.catalog)
    if (!route) throw new Error('No model covers that pair of languages.')
    for (const code of [from, to]) {
      if (!(await this.isInstalled(code))) throw new Error(`Add ${code} under Languages first.`)
    }
    if (!(await this.options.store.hasEngine())) throw new Error('The translation engine is not downloaded.')
    return route
  }

  async translate(from: string, to: string, texts: string[], html: boolean): Promise<string[]> {
    const route = await this.routeOrThrow(from, to)
    const out: string[] = []
    for (let start = 0; start < texts.length; start += BATCH_UNITS) {
      out.push(...(await this.translateRoute(route, from, to, texts.slice(start, start + BATCH_UNITS), html)))
    }
    return out
  }

  private remember(key: string, value: string): void {
    this.cache.delete(key)
    this.cache.set(key, value)
    while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!)
  }

  // ---- Page translation --------------------------------------------------

  private record(page: TranslatePage): PageRecord {
    const url = page.getURL()
    const current = this.pages.get(page.id)
    // In-page navigations (history.pushState) keep the record; full loads call forgetPage.
    if (current) {
      current.url = url
      return current
    }
    const fresh: PageRecord = { url, generation: 1, state: { status: 'idle', detected: null }, detected: null }
    this.pages.set(page.id, fresh)
    return fresh
  }

  private setState(page: TranslatePage, record: PageRecord, state: PageTranslationState): PageTranslationState {
    record.state = state
    if (this.options.getActivePage()?.id === page.id) this.options.emit({ type: 'page', url: record.url, state })
    return state
  }

  /** Called when a page navigates or closes: its translation no longer applies. */
  forgetPage(id: number): void {
    const record = this.pages.get(id)
    if (!record) return
    this.pages.set(id, { url: '', generation: record.generation + 1, state: { status: 'idle', detected: null }, detected: null })
    if (this.options.getActivePage()?.id === id) this.options.emit({ type: 'page', url: '', state: { status: 'idle', detected: null } })
  }

  async pageState(): Promise<PageTranslationState> {
    const page = this.options.getActivePage()
    if (!page || !/^https?:/i.test(page.getURL())) return { status: 'idle', detected: null }
    const record = this.record(page)
    if (record.state.status !== 'idle') return record.state
    if (!record.detected) {
      try {
        const sample = parseSample(await page.executeJavaScriptInIsolatedWorld(TRANSLATE_WORLD_ID, [{ code: sampleScript() }]))
        if (sample && sample.url === record.url) record.detected = detectLanguage(sample.lang, sample.sample)
      } catch {
        // Page not ready; the renderer asks again after load.
      }
    }
    record.state = { status: 'idle', detected: record.detected }
    return record.state
  }

  async translatePage(from: string, to: string): Promise<PageTranslationState> {
    const page = this.options.getActivePage()
    if (!page || !/^https?:/i.test(page.getURL())) throw new Error('Open a web page to translate it.')
    const route = await this.routeOrThrow(from, to)
    const record = this.record(page)
    // Always translate from the originals: restore first when already translated.
    if (record.state.status !== 'idle') await page.executeJavaScriptInIsolatedWorld(TRANSLATE_WORLD_ID, [{ code: restoreScript() }]).catch(() => undefined)
    const generation = ++record.generation
    const live = (): boolean => record.generation === generation && this.pages.get(page.id) === record
    let collected
    try {
      collected = parseCollected(await page.executeJavaScriptInIsolatedWorld(TRANSLATE_WORLD_ID, [{ code: collectScript() }]))
    } catch {
      collected = null
    }
    if (!collected) return this.setState(page, record, { status: 'error', from, to, message: 'This page could not be read yet. Try again once it has loaded.' })
    if (!collected.units.length) return this.setState(page, record, { status: 'error', from, to, message: 'There is no text on this page to translate.' })
    const total = collected.units.length
    const keep = !this.options.isPrivatePage?.(page)
    let done = 0
    this.setState(page, record, { status: 'translating', from, to, done, total })
    try {
      for (const batch of batches(collected.units)) {
        if (!live()) return record.state
        const texts = await this.translateRoute(route, from, to, batch.map((unit) => unit.source), batch[0]!.html, keep)
        if (!live()) return record.state
        await page.executeJavaScriptInIsolatedWorld(TRANSLATE_WORLD_ID, [{ code: applyScript(batch.map((unit, i) => ({ id: unit.id, text: texts[i]! }))) }])
        done += batch.length
        this.setState(page, record, { status: 'translating', from, to, done, total })
      }
    } catch (error) {
      await page.executeJavaScriptInIsolatedWorld(TRANSLATE_WORLD_ID, [{ code: resetScript() }]).catch(() => undefined)
      if (!live()) return record.state
      return this.setState(page, record, { status: 'error', from, to, message: error instanceof Error ? error.message : 'Translation failed.' })
    }
    return this.setState(page, record, { status: 'translated', from, to, blocks: total })
  }

  private async translateRoute(route: CatalogPair[], from: string, to: string, texts: string[], html: boolean, keep = true): Promise<string[]> {
    const out = new Array<string>(texts.length)
    const missing: number[] = []
    texts.forEach((text, index) => {
      const hit = this.cache.get(cacheKey(from, to, html, text))
      if (hit !== undefined) out[index] = hit
      else missing.push(index)
    })
    if (missing.length) {
      const results = await this.options.engine.translate(route, missing.map((index) => texts[index]!), html)
      missing.forEach((textIndex, i) => {
        out[textIndex] = results[i]!
        if (keep) this.remember(cacheKey(from, to, html, texts[textIndex]!), results[i]!)
      })
    }
    return out
  }

  async restorePage(): Promise<PageTranslationState> {
    const page = this.options.getActivePage()
    if (!page) return { status: 'idle', detected: null }
    const record = this.record(page)
    record.generation += 1
    await page.executeJavaScriptInIsolatedWorld(TRANSLATE_WORLD_ID, [{ code: restoreScript() }]).catch(() => undefined)
    return this.setState(page, record, { status: 'idle', detected: record.detected })
  }

  async close(): Promise<void> {
    await this.options.engine.close()
  }
}

function cacheKey(from: string, to: string, html: boolean, text: string): string {
  return `${from}>${to}>${html ? 1 : 0}>${text}`
}

/** Group units into engine batches of one kind (HTML or text), most-visible first. */
export function batches<T extends { html: boolean; source: string }>(units: T[]): T[][] {
  const out: T[][] = []
  let current: T[] = []
  let chars = 0
  for (const unit of units) {
    const full = current.length >= BATCH_UNITS || chars + unit.source.length > BATCH_CHARS
    if (current.length && (full || current[0]!.html !== unit.html)) {
      out.push(current)
      current = []
      chars = 0
    }
    current.push(unit)
    chars += unit.source.length
  }
  if (current.length) out.push(current)
  return out
}
