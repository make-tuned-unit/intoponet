import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeLanguage, parseTranslateCommand, type TranslateEvent } from '@intoponet/browser-api'
import { CATALOG, catalogLanguages, pairFor, routeFor, attachmentUrl, type Catalog } from './catalog'
import { detectFromText, detectLanguage } from '../../shared/translate/detect'
import { TranslationEngine, type TranslateWorker, type WorkerRequest, type WorkerResponse } from './engine'
import { batches, TranslateService, type TranslatePage } from './service'
import { TranslateStore } from './store'
import { applyScript, collectScript, parseCollected, restoreScript, TRANSLATE_WORLD_ID } from './pageScript'

const sha = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex')

function fakeCatalog(): { catalog: Catalog; blobs: Map<string, Buffer> } {
  const blobs = new Map<string, Buffer>()
  const file = (type: 'model' | 'lex' | 'vocab', name: string) => {
    const data = Buffer.from(`${name}-bytes`)
    const location = `main-workspace/translations-models/${name}.bin`
    blobs.set(location, data)
    return { type, name, bytes: data.byteLength, sha256: sha(data), location }
  }
  const pair = (from: string, to: string) => ({ from, to, version: '2.0', files: [file('lex', `lex.${from}${to}`), file('model', `model.${from}${to}.intgemm.alphas.bin`), file('vocab', `vocab.${from}${to}`)] })
  const wasm = Buffer.from('wasm-bytes')
  blobs.set('main-workspace/translations-wasm/engine.wasm', wasm)
  return {
    blobs,
    catalog: {
      schemaVersion: 1,
      generatedAt: '2026-10-26T00:00:00Z',
      source: 'test',
      licence: 'MPL-2.0',
      licenceUrl: 'https://mozilla.org/MPL/2.0/',
      attachmentsBase: 'https://attachments.example/',
      engine: { name: 'bergamot-translator', version: '3.0', glueVersion: 'v0.6.0', file: { name: 'engine.wasm', bytes: wasm.byteLength, sha256: sha(wasm), location: 'main-workspace/translations-wasm/engine.wasm' } },
      pairs: Object.fromEntries([pair('es', 'en'), pair('en', 'es'), pair('fr', 'en'), pair('en', 'fr')].map((p) => [`${p.from}-${p.to}`, p])),
    },
  }
}

function fakeFetch(blobs: Map<string, Buffer>, requested: string[] = [], tamper?: string): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    requested.push(url)
    const location = url.replace('https://attachments.example/', '')
    let data = blobs.get(location)
    if (!data) return new Response('missing', { status: 404 })
    if (tamper && location.includes(tamper)) data = Buffer.from(data.toString().toUpperCase())
    return new Response(new Uint8Array(data))
  }) as typeof fetch
}

/** A worker that "translates" by tagging text with the model chain. */
function fakeWorker(log: WorkerRequest[]): TranslateWorker {
  const listeners: Record<string, Array<(value: never) => void>> = { message: [], error: [], exit: [] }
  return {
    postMessage(message: WorkerRequest) {
      log.push(message)
      const reply = (response: WorkerResponse): void => { queueMicrotask(() => listeners['message']!.forEach((listener) => listener(response as never))) }
      if (message.type === 'translate') reply({ id: message.id, ok: true, texts: message.texts.map((text) => `[${message.keys.map((key) => key.split('@')[0]).join('|')}] ${text}`) })
      else reply({ id: message.id, ok: true })
    },
    on(event: string, listener: (value: never) => void) { listeners[event]!.push(listener); return this },
    async terminate() { listeners['exit']!.forEach((listener) => listener(0 as never)); return 0 },
  } as TranslateWorker
}

const dirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'intoponet-translate-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

describe('catalog', () => {
  it('pins every file of every pair by size and SHA-256', () => {
    const languages = catalogLanguages()
    expect(languages.length).toBeGreaterThanOrEqual(50)
    expect(languages).toEqual(expect.arrayContaining(['es', 'fr', 'de', 'ja', 'ko', 'zh-Hans', 'ar', 'hi', 'ru', 'pt']))
    for (const pair of Object.values(CATALOG.pairs)) {
      expect(pair.files.some((file) => file.type === 'model')).toBe(true)
      for (const file of pair.files) {
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
        expect(file.bytes).toBeGreaterThan(0)
        expect(() => attachmentUrl(file.location)).not.toThrow()
      }
    }
    expect(CATALOG.engine.file.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(CATALOG.attachmentsBase).toMatch(/^https:\/\/[a-z0-9.-]+\.mozilla\.net\/$/)
  })

  it('routes directly through English or pivots through it', () => {
    expect(routeFor('es', 'en')?.map((pair) => `${pair.from}>${pair.to}`)).toEqual(['es>en'])
    expect(routeFor('ja', 'fr')?.map((pair) => `${pair.from}>${pair.to}`)).toEqual(['ja>en', 'en>fr'])
    expect(routeFor('es', 'es')).toBeNull()
    expect(routeFor('xx', 'en')).toBeNull()
    expect(pairFor('en', 'zh-Hans')).not.toBeNull()
  })

  it('refuses locations that could escape the attachments host', () => {
    expect(() => attachmentUrl('../evil')).toThrow()
    expect(() => attachmentUrl('a/b?c=d')).toThrow()
  })
})

describe('language tags', () => {
  it('maps page and feed tags to model codes', () => {
    expect(normalizeLanguage('pt-BR')).toBe('pt')
    expect(normalizeLanguage('zh-TW')).toBe('zh-Hant')
    expect(normalizeLanguage('zh-CN')).toBe('zh-Hans')
    expect(normalizeLanguage('zh_Hant_HK')).toBe('zh-Hant')
    expect(normalizeLanguage('no')).toBe('nb')
    expect(normalizeLanguage('iw')).toBe('he')
    expect(normalizeLanguage('EN-us')).toBe('en')
    expect(normalizeLanguage('<script>')).toBeNull()
    expect(normalizeLanguage('')).toBeNull()
  })

  it('validates commands', () => {
    expect(parseTranslateCommand({ type: 'translate', from: 'es', to: 'en', texts: ['hola'], html: false })).toEqual({ type: 'translate', from: 'es', to: 'en', texts: ['hola'], html: false })
    expect(() => parseTranslateCommand({ type: 'translate', from: 'es', to: 'es', texts: [], html: false })).toThrow()
    expect(() => parseTranslateCommand({ type: 'translate', from: 'es', to: 'en', texts: ['x'.repeat(7_000)], html: false })).toThrow()
    expect(() => parseTranslateCommand({ type: 'install', code: 'en' })).toThrow()
    expect(() => parseTranslateCommand({ type: 'install', code: '../x' })).toThrow()
    expect(parseTranslateCommand({ type: 'page-translate', from: 'zh-Hans', to: 'en' })).toEqual({ type: 'page-translate', from: 'zh-Hans', to: 'en' })
  })
})

describe('detection', () => {
  it('recognises writing systems', () => {
    expect(detectFromText('東京で大規模な地震が発生し、交通機関が一時停止しました。東京で大規模な地震が発生')).toBe('ja')
    expect(detectFromText('서울에서 대규모 지진이 발생하여 교통이 일시 중단되었습니다. 서울에서 대규모')).toBe('ko')
    expect(detectFromText('الرئيس يعلن عن إجراءات اقتصادية جديدة لمكافحة التضخم في البلاد اليوم')).toBe('ar')
    expect(detectFromText('Президент объявил о новых экономических мерах по борьбе с инфляцией в стране')).toBe('ru')
    expect(detectFromText('Президент оголосив про нові економічні заходи для боротьби з інфляцією в країні її')).toBe('uk')
    expect(detectFromText('這個國家的經濟發展與人民的生活息息相關，我們應該關注這些問題的發展')).toBe('zh-Hant')
    expect(detectFromText('这个国家的经济发展与人民的生活息息相关，我们应该关注这些问题的发展')).toBe('zh-Hans')
  })

  it('recognises Latin-script languages by common words', () => {
    expect(detectFromText('El presidente anunció nuevas medidas económicas para combatir la inflación en el país y los mercados.')).toBe('es')
    expect(detectFromText('Le président a annoncé de nouvelles mesures économiques pour lutter contre la hausse des prix dans le pays.')).toBe('fr')
    expect(detectFromText('Der Präsident hat neue wirtschaftliche Maßnahmen angekündigt, die gegen die Inflation in dem Land helfen sollen.')).toBe('de')
    expect(detectFromText('The president announced new economic measures to fight inflation in the country and this is the plan.')).toBe('en')
    expect(detectFromText('hi')).toBeNull()
  })

  it('trusts a declared tag unless the text clearly disagrees', () => {
    const spanish = 'El presidente anunció nuevas medidas económicas para combatir la inflación en el país y los mercados.'
    expect(detectLanguage('es-MX', spanish)).toBe('es')
    expect(detectLanguage('en', spanish)).toBe('es')
    expect(detectLanguage('ca', spanish)).toBe('ca')
    expect(detectLanguage('en', '東京で大規模な地震が発生し、交通機関が一時停止しました。東京で大規模な地震が発生')).toBe('ja')
    expect(detectLanguage(null, '')).toBeNull()
  })
})

describe('store', () => {
  it('downloads, verifies and reads back pinned files', async () => {
    const { catalog, blobs } = fakeCatalog()
    const requested: string[] = []
    const store = new TranslateStore(await tempDir(), fakeFetch(blobs, requested), catalog)
    const pair = catalog.pairs['es-en']!
    let bytes = 0
    await store.downloadEngine((n) => { bytes += n })
    await store.downloadPair(pair, (n) => { bytes += n })
    expect(bytes).toBe(catalog.engine.file.bytes + pair.files.reduce((sum, file) => sum + file.bytes, 0))
    expect(await store.hasPair(pair)).toBe(true)
    expect(Buffer.from(await store.readEngine()).toString()).toBe('wasm-bytes')
    const files = await store.readPair(pair)
    expect(Buffer.from(files.model!).toString()).toContain('model.esen')
    expect(requested.every((url) => url.startsWith('https://attachments.example/main-workspace/'))).toBe(true)
    // A second download is skipped once the hash matches.
    requested.length = 0
    await store.downloadPair(pair, () => undefined)
    expect(requested).toEqual([])
  })

  it('discards a file that does not match its fingerprint', async () => {
    const { catalog, blobs } = fakeCatalog()
    const dir = await tempDir()
    const store = new TranslateStore(dir, fakeFetch(blobs, [], 'model.esen'), catalog)
    await expect(store.downloadPair(catalog.pairs['es-en']!, () => undefined)).rejects.toThrow(/fingerprint/)
    expect(await store.hasPair(catalog.pairs['es-en']!)).toBe(false)
  })

  it('refuses to load a file changed on disk', async () => {
    const { catalog, blobs } = fakeCatalog()
    const store = new TranslateStore(await tempDir(), fakeFetch(blobs), catalog)
    const pair = catalog.pairs['es-en']!
    await store.downloadPair(pair, () => undefined)
    const model = pair.files.find((file) => file.type === 'model')!
    const path = join(store.pairDir(pair), model.name)
    const original = await readFile(path)
    await writeFile(path, Buffer.from(original.toString().toUpperCase()))
    await expect(store.readPair(pair)).rejects.toThrow(/fingerprint/)
  })
})

async function setup(options: { page?: TranslatePage | null; isPrivate?: boolean } = {}) {
  const { catalog, blobs } = fakeCatalog()
  const store = new TranslateStore(await tempDir(), fakeFetch(blobs), catalog)
  const log: WorkerRequest[] = []
  let started = 0
  const engine = new TranslationEngine(store, () => { started += 1; return fakeWorker(log) }, 60_000)
  const events: TranslateEvent[] = []
  const service = new TranslateService({ store, engine, emit: (event) => events.push(event), getActivePage: () => options.page ?? null, isPrivatePage: () => options.isPrivate === true, catalog })
  return { service, engine, log, events, store, catalog, started: () => started }
}

describe('service and engine', () => {
  it('installs a language with the engine, then translates directly and via English', async () => {
    const { service, log, events, engine, started } = await setup()
    const before = await service.status()
    expect(before.languages.map((language) => language.code)).toEqual(['es', 'fr'])
    expect(before.languages.every((language) => !language.downloaded)).toBe(true)
    await expect(service.translate('es', 'en', ['hola'], false)).rejects.toThrow(/Add es/)
    await service.install('es')
    await service.install('fr')
    const after = await service.status()
    expect(after.engine.downloaded).toBe(true)
    expect(after.languages.every((language) => language.downloaded)).toBe(true)
    expect(events.some((event) => event.type === 'status' && event.status.downloading?.code === 'es')).toBe(true)

    expect(await service.translate('es', 'en', ['hola', ''], false)).toEqual(['[es>en] hola', '[es>en] '])
    expect(await service.translate('es', 'fr', ['hola'], false)).toEqual(['[es>en|en>fr] hola'])
    expect(log.filter((message) => message.type === 'init')).toHaveLength(1)
    expect(log.filter((message) => message.type === 'load').map((message) => message.type === 'load' && message.key)).toEqual(['es>en@2.0', 'en>fr@2.0'])
    expect(log.find((message) => message.type === 'load' && message.gemm !== 'int8shiftAlphaAll')).toBeUndefined()
    // Cached: the engine is not asked again.
    const translations = log.filter((message) => message.type === 'translate').length
    expect(await service.translate('es', 'en', ['hola'], false)).toEqual(['[es>en] hola'])
    expect(log.filter((message) => message.type === 'translate').length).toBe(translations)
    expect(started()).toBe(1)
    await engine.close()
  })

  it('removes a language and the engine once none remain', async () => {
    const { service, store, catalog } = await setup()
    await service.install('es')
    await service.remove('es')
    const status = await service.status()
    expect(status.languages.find((language) => language.code === 'es')?.downloaded).toBe(false)
    expect(status.engine.downloaded).toBe(false)
    expect(await store.hasPair(catalog.pairs['es-en']!)).toBe(false)
  })

  it('refuses a second download while one is running', async () => {
    const { service } = await setup()
    const first = service.install('es')
    await expect(service.install('fr')).rejects.toThrow(/Another language/)
    await first
  })

  it('batches units by kind and size, keeping order', () => {
    const units = [
      ...Array.from({ length: 14 }, (_, i) => ({ id: i, html: true, source: 'x'.repeat(10) })),
      { id: 99, html: false, source: 'loose text' },
      { id: 100, html: true, source: 'y'.repeat(3_000) },
    ]
    const groups = batches(units)
    expect(groups.map((group) => group.length)).toEqual([12, 2, 1, 1])
    expect(groups.flat().map((unit) => unit.id)).toEqual(units.map((unit) => unit.id))
  })

  it('translates a page in batches in the isolated world, then restores it', async () => {
    const scripts: Array<{ world: number; code: string }> = []
    const page: TranslatePage = {
      id: 7,
      getURL: () => 'https://example.es/noticias',
      async executeJavaScriptInIsolatedWorld(world, [script]) {
        scripts.push({ world, code: script!.code })
        if (script!.code === collectScript()) {
          return { url: 'https://example.es/noticias', lang: 'es', sample: '', units: Array.from({ length: 15 }, (_, i) => ({ id: i + 1, html: true, source: `<span data-i="0">uno</span> ${i}` })) }
        }
        if (script!.code.includes('const results =')) return 1
        return 0
      },
    }
    const { service, events } = await setup({ page })
    await service.install('es')
    const state = await service.translatePage('es', 'en')
    expect(state).toEqual({ status: 'translated', from: 'es', to: 'en', blocks: 15 })
    expect(scripts.every((script) => script.world === TRANSLATE_WORLD_ID)).toBe(true)
    const applies = scripts.filter((script) => script.code.includes('const results ='))
    expect(applies).toHaveLength(2)
    expect(applies[0]!.code).toContain('[es>en] <span data-i=\\"0\\">uno</span> 0')
    expect(events.filter((event) => event.type === 'page').map((event) => event.type === 'page' && event.state.status)).toEqual(['translating', 'translating', 'translating', 'translated'])
    const restored = await service.restorePage()
    expect(restored.status).toBe('idle')
    expect(scripts.at(-1)!.code).toBe(restoreScript())
  })

  it('stops applying a page translation after navigation', async () => {
    let calls = 0
    const page: TranslatePage = {
      id: 9,
      getURL: () => 'https://example.fr/',
      async executeJavaScriptInIsolatedWorld(_world, [script]) {
        if (script!.code === collectScript()) return { url: 'https://example.fr/', lang: 'fr', sample: '', units: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, html: false, source: `mot ${i}` })) }
        if (script!.code.includes('const results =')) {
          calls += 1
          if (calls === 1) service.forgetPage(9)
        }
        return 1
      },
    }
    const { service } = await setup({ page })
    await service.install('fr')
    await service.translatePage('fr', 'en')
    expect(calls).toBe(1)
  })

  it('translates a private page without keeping its text in the cache', async () => {
    const page: TranslatePage = {
      id: 11,
      getURL: () => 'https://example.es/privado',
      async executeJavaScriptInIsolatedWorld(_world, [script]) {
        if (script!.code === collectScript()) return { url: 'https://example.es/privado', lang: 'es', sample: '', units: [{ id: 1, html: false, source: 'secreto' }] }
        return 1
      },
    }
    const { service, log } = await setup({ page, isPrivate: true })
    await service.install('es')
    expect((await service.translatePage('es', 'en')).status).toBe('translated')
    const asked = log.filter((message) => message.type === 'translate').length
    // Not cached: the same text goes to the engine again.
    await service.translate('es', 'en', ['secreto'], false)
    expect(log.filter((message) => message.type === 'translate').length).toBe(asked + 1)
  })
})

describe('page script payloads', () => {
  it('embeds results as JSON data, never as code', () => {
    const code = applyScript([{ id: 1, text: '</script><img src=x onerror=alert(1)> "`${x}`' }])
    const json = code.slice(code.indexOf('const results = ') + 16, code.indexOf('\n', code.indexOf('const results = ')))
    expect(JSON.parse(json)).toEqual([{ id: 1, text: '</script><img src=x onerror=alert(1)> "`${x}`' }])
  })

  it('rejects malformed collections', () => {
    expect(parseCollected(null)).toBeNull()
    expect(parseCollected({ url: 'https://a.example/', units: [{ id: 'x' }, { id: 1, html: true, source: 'ok' }] })?.units).toEqual([{ id: 1, html: true, source: 'ok' }])
  })
})
