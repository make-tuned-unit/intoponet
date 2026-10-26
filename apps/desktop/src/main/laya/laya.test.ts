import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { KnowledgeDocument, KnowledgeHit, KnowledgeRecord } from '@intoponet/browser-api'
import { createAesGcmCrypto } from '../knowledge/crypto'
import { parseLayaCommand } from './contract'
import { downloadModel, modelDir } from './model'
import { installNetworkStubs } from './networkStubs'
import type { Embedder } from './pool'
import { chunkParagraphs, fuseRanks, kmeans, normalise, trimPassage } from './retrieval'
import { LayaService, type ModelOps } from './service'
import { basicTokenize, WordPieceTokenizer } from './tokenizer'
import { decodeVectors, encodeVectors, VectorStore } from './vectors'

const words = (text: string): number => text.split(/\s+/).filter(Boolean).length

describe('tokenizer', () => {
  it('lowercases, strips accents, splits punctuation and CJK', () => {
    expect(basicTokenize('Hello, Zürich! 東京')).toEqual(['hello', ',', 'zurich', '!', '東', '京'])
  })
  it('does greedy WordPiece with ## continuations', () => {
    const tokenizer = new WordPieceTokenizer(['[PAD]', '[UNK]', '[CLS]', '[SEP]', 'un', '##aff', '##able', 'hello'].join('\n'))
    expect(tokenizer.pieces('unaffable hello xyz')).toEqual([4, 5, 6, 7, 1])
    expect(tokenizer.encode('hello', 8)).toEqual([2, 7, 3])
  })
})

describe('chunking', () => {
  it('merges short paragraphs and keeps citation ranges', () => {
    const chunks = chunkParagraphs(['one two', 'three four', 'five six seven eight nine ten'], words, 5)
    expect(chunks.map((chunk) => [chunk.paragraphStart, chunk.paragraphEnd])).toEqual([[0, 1], [2, 2], [2, 2]])
    expect(chunks[0]!.text).toBe('one two\nthree four')
  })
  it('splits long paragraphs at sentences', () => {
    const chunks = chunkParagraphs(['Alpha beta gamma. Delta epsilon zeta. Eta theta iota.'], words, 4)
    expect(chunks.map((chunk) => chunk.text)).toEqual(['Alpha beta gamma.', 'Delta epsilon zeta.', 'Eta theta iota.'])
    expect(chunks.every((chunk) => chunk.paragraphStart === 0)).toBe(true)
  })
})

describe('ranking and themes', () => {
  it('fuses word and meaning ranks, marking which matched', () => {
    const fused = fuseRanks(['a', 'b'], ['b', 'c'])
    expect(fused[0]).toMatchObject({ key: 'b', matchedBy: 'both' })
    expect(fused.find((item) => item.key === 'a')?.matchedBy).toBe('words')
    expect(fused.find((item) => item.key === 'c')?.matchedBy).toBe('meaning')
  })
  it('clusters deterministically', () => {
    const v = (x: number, y: number) => normalise(new Float32Array([x, y, 0]))
    const points = [v(1, 0.05), v(1, 0.1), v(0.05, 1), v(0.1, 1), v(1, 0)]
    const first = kmeans(points, 2)
    expect(kmeans(points, 2)).toEqual(first)
    expect(first[0]).toBe(first[1])
    expect(first[2]).toBe(first[3])
    expect(first[0]).not.toBe(first[2])
  })
  it('trims passages to whole sentences around the match, verbatim', () => {
    const text = 'Cats sleep a lot. Auroras are caused by the solar wind hitting the magnetosphere. Dogs bark. '.repeat(6)
    const passage = trimPassage(text, 'what causes auroras', 120)
    expect(passage.length).toBeLessThanOrEqual(122)
    expect(passage).toContain('Auroras are caused by the solar wind')
    expect(text.replace(/\s+/g, ' ')).toContain(passage.replace(/^… /, '').replace(/ …$/, ''))
  })
})

describe('vector storage', () => {
  it('round-trips vectors through the sealed store', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'laya-vec-'))
    try {
      const store = new VectorStore(dir, createAesGcmCrypto(randomBytes(32)))
      const value = { recordId: 'kn-0123456789abcdef', revision: 'r1', dims: 3, chunks: [{ paragraphStart: 0, paragraphEnd: 1, text: 'hello' }], vectors: [new Float32Array([0.5, -0.25, 1])] }
      expect(decodeVectors(encodeVectors(value))).toEqual(value)
      await store.put(value)
      expect(await store.get(value.recordId)).toEqual(value)
      expect(await store.ids()).toEqual([value.recordId])
      await store.remove(value.recordId)
      expect(await store.get(value.recordId)).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('model download', () => {
  it('discards a file whose fingerprint does not match', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'laya-model-'))
    try {
      const bytes = Buffer.from('not the real model')
      const fetchImpl = (async () => new Response(bytes)) as unknown as typeof fetch
      await expect(downloadModel(dir, fetchImpl, () => undefined, () => undefined, [{ name: 'vocab.txt', bytes: bytes.length, sha256: '0'.repeat(64) }]))
        .rejects.toThrow(/fingerprint/)
      expect(existsSync(join(modelDir(dir), 'vocab.txt'))).toBe(false)
      const good = createHash('sha256').update(bytes).digest('hex')
      await downloadModel(dir, fetchImpl, () => undefined, () => undefined, [{ name: 'vocab.txt', bytes: bytes.length, sha256: good }])
      expect(existsSync(join(modelDir(dir), 'vocab.txt'))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('network isolation', () => {
  it('refuses fetch, http and sockets inside the worker', async () => {
    const code = `
      const { parentPort } = require('node:worker_threads');
      (${installNetworkStubs.toString()})();
      const results = [];
      const attempt = async (name, fn) => { try { await fn(); results.push(name + ':allowed') } catch (error) { results.push(name + ':refused') } };
      (async () => {
        await attempt('fetch', () => fetch('https://example.org'));
        await attempt('http', () => require('node:http').get('http://example.org'));
        await attempt('https', () => require('node:https').request('https://example.org'));
        await attempt('net', () => require('node:net').connect(80, 'example.org'));
        await attempt('dns', () => require('node:dns').lookup('example.org', () => {}));
        parentPort.postMessage(results);
      })();`
    const worker = new Worker(code, { eval: true })
    const results = await new Promise<string[]>((resolve, reject) => {
      worker.once('message', resolve)
      worker.once('error', reject)
    })
    await worker.terminate()
    expect(results).toEqual(['fetch:refused', 'http:refused', 'https:refused', 'net:refused', 'dns:refused'])
  })
})

describe('commands', () => {
  it('validates commands', () => {
    expect(parseLayaCommand({ type: 'disable', deleteModel: true })).toEqual({ type: 'disable', deleteModel: true })
    expect(parseLayaCommand({ type: 'related', recordId: 'kn-0123456789abcdef', limit: 3 })).toEqual({ type: 'related', recordId: 'kn-0123456789abcdef', limit: 3 })
    expect(() => parseLayaCommand({ type: 'related', recordId: 'kn-0123456789abcdef', text: 'x' })).toThrow()
    expect(() => parseLayaCommand({ type: 'search', query: '' })).toThrow()
    expect(() => parseLayaCommand({ type: 'download' })).toThrow()
  })
})

// ---- Service, with a fake embedder (hashed bag of words) and a fake knowledge store ----

function fakeEmbedder(): Embedder {
  const vectorFor = (text: string): Float32Array => {
    const vector = new Float32Array(384)
    for (const word of text.toLowerCase().match(/\p{L}{3,}/gu) ?? []) {
      let h = 2166136261
      for (const char of word.slice(0, 5)) h = Math.imul(h ^ char.charCodeAt(0), 16777619)
      vector[(h >>> 0) % 384] = vector[(h >>> 0) % 384]! + 1
    }
    return normalise(vector)
  }
  return { embed: async (texts) => texts.map(vectorFor), countTokens: words, close: async () => undefined }
}

const docs: KnowledgeDocument[] = [
  { id: 'kn-aaaaaaaaaaaaaaaa', title: 'Aurora', paragraphs: ['Auroras glow when the solar wind meets the magnetosphere.', 'Green light comes from oxygen atoms high above the poles.'], entities: [{ text: 'Solar wind', kind: 'term', count: 4 }, { text: 'Magnetosphere', kind: 'term', count: 3 }] },
  { id: 'kn-bbbbbbbbbbbbbbbb', title: 'Solar storms', paragraphs: ['Coronal mass ejections push the solar wind and disturb the magnetosphere.'], entities: [{ text: 'Solar wind', kind: 'term', count: 3 }, { text: 'Coronal', kind: 'term', count: 3 }] },
  { id: 'kn-cccccccccccccccc', title: 'Sourdough', paragraphs: ['Bread rises when yeast ferments the dough overnight.', 'Bake the loaf in a very hot oven.'], entities: [{ text: 'Yeast', kind: 'term', count: 3 }, { text: 'Dough', kind: 'term', count: 4 }] },
].map((doc) => ({
  url: `https://example.org/${doc.title.toLowerCase().replace(/\s+/g, '-')}`,
  siteName: null, lang: 'en', publishedAt: null, absorbedAt: '2026-10-26T00:00:00.000Z', scope: 'article' as const,
  wordCount: 20, paragraphCount: doc.paragraphs.length, places: [], dates: [], note: null,
  ...doc,
  entities: doc.entities as KnowledgeDocument['entities'],
}))

function fakeKnowledge(documents: KnowledgeDocument[]) {
  return {
    list: async (): Promise<KnowledgeRecord[]> => documents.map(({ paragraphs: _p, ...record }) => record),
    get: async (id: string): Promise<KnowledgeDocument> => {
      const found = documents.find((doc) => doc.id === id)
      if (!found) throw new Error('missing')
      return found
    },
    search: async (query: string): Promise<KnowledgeHit[]> => {
      const terms = query.toLowerCase().split(/\s+/)
      return documents.flatMap((doc) => {
        const index = doc.paragraphs.findIndex((paragraph) => terms.some((term) => paragraph.toLowerCase().includes(term)))
        return index < 0 ? [] : [{ recordId: doc.id, url: doc.url, title: doc.title, paragraphIndex: index, snippet: doc.paragraphs[index]!, matches: [], score: 1 }]
      })
    },
  }
}

describe('Laya service', () => {
  let dir = ''
  let fetches = 0
  const crypto = createAesGcmCrypto(randomBytes(32))
  const fetchImpl = (async () => { fetches += 1; throw new Error('network') }) as unknown as typeof fetch
  const okModel: ModelOps = { download: async () => undefined, verify: async () => true, present: () => true, remove: async () => undefined }
  const make = (modelOps: ModelOps = okModel) => new LayaService({ dir, crypto, knowledge: fakeKnowledge(docs), openEmbedder: async () => fakeEmbedder(), fetchImpl, modelOps })

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'laya-svc-'))
    fetches = 0
  })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('does nothing and downloads nothing until enabled (LAY-005)', async () => {
    const laya = new LayaService({ dir, crypto, knowledge: fakeKnowledge(docs), openEmbedder: async () => fakeEmbedder(), fetchImpl })
    expect((await laya.status()).enabled).toBe(false)
    await expect(laya.search('aurora')).rejects.toThrow(/Laya is off/)
    await expect(laya.ask('what makes auroras')).rejects.toThrow(/Laya is off/)
    await laya.backfill()
    expect(fetches).toBe(0)
  })

  it('stays off when the download fails', async () => {
    const laya = new LayaService({ dir, crypto, knowledge: fakeKnowledge(docs), openEmbedder: async () => fakeEmbedder(), fetchImpl })
    await expect(laya.enable()).rejects.toThrow()
    expect((await laya.status()).enabled).toBe(false)
    expect((await laya.status()).lastError).toBeTruthy()
  })

  it('indexes, searches by meaning, answers with cited passages, relates and themes', async () => {
    const laya = make()
    await laya.enable()
    await laya.backfill()
    const status = await laya.status()
    expect(status).toMatchObject({ enabled: true, indexedDocuments: 3, totalDocuments: 3 })

    const hits = await laya.search('solar wind magnetosphere')
    expect(hits.slice(0, 2).map((hit) => hit.recordId).sort()).toEqual(['kn-aaaaaaaaaaaaaaaa', 'kn-bbbbbbbbbbbbbbbb'])
    expect(hits[0]!.matchedBy).toBe('both')

    const passages = await laya.ask('Why do auroras glow green from oxygen?')
    expect(passages[0]).toMatchObject({ recordId: 'kn-aaaaaaaaaaaaaaaa', title: 'Aurora' })
    expect(docs[0]!.paragraphs.join(' ')).toContain(passages[0]!.text.replace(/^… /, '').replace(/ …$/, '').split('\n')[0]!)
    expect(passages.every((passage) => passage.recordId !== 'kn-cccccccccccccccc')).toBe(true)

    const related = await laya.related({ recordId: 'kn-aaaaaaaaaaaaaaaa' })
    expect(related[0]?.recordId).toBe('kn-bbbbbbbbbbbbbbbb')
    expect(related.some((item) => item.recordId === 'kn-aaaaaaaaaaaaaaaa')).toBe(false)

    const themes = await laya.themes()
    expect(themes.flatMap((theme) => theme.recordIds).sort()).toEqual(['kn-aaaaaaaaaaaaaaaa', 'kn-bbbbbbbbbbbbbbbb', 'kn-cccccccccccccccc'])
    expect(await laya.themes()).toEqual(themes)
    expect(fetches).toBe(0)
  })

  it('drops vectors when a page is removed and when Laya is turned off with deletion', async () => {
    const laya = make()
    await laya.enable()
    await laya.backfill()
    laya.onKnowledgeChange({ type: 'remove', id: 'kn-cccccccccccccccc' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(existsSync(join(dir, 'vectors', 'kn-cccccccccccccccc.vec'))).toBe(false)
    await laya.disable({ deleteModel: true })
    expect(existsSync(join(dir, 'vectors'))).toBe(false)
    expect((await laya.status()).enabled).toBe(false)
  })

  it('refuses to run on an unverified model', async () => {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ enabled: true }))
    const laya = make({ ...okModel, verify: async () => false })
    await expect(laya.search('aurora')).rejects.toThrow(/missing or changed/)
  })
})
