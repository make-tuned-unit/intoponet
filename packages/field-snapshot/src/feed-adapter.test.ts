import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FEED_ADAPTER_LIMITS, parseFeedXml } from './feed-adapter'

const rssFixture = readFileSync(new URL('./fixtures/feeds/rss.xml', import.meta.url), 'utf8')
const atomFixture = readFileSync(new URL('./fixtures/feeds/atom.xml', import.meta.url), 'utf8')
const discoveredAt = '2026-10-23T12:00:00.000Z'

const options = {
  sourceId: 'fixture-source',
  feedUrl: 'https://publisher.example/feeds/news.xml',
  discoveredAt,
  language: 'en-CA',
  topicIds: ['civic-news'],
}

describe('controlled RSS and Atom adapter', () => {
  it('parses RSS metadata, resolves safe links, keeps timestamps distinct and selects the newest revision', async () => {
    const items = await parseFeedXml(rssFixture, options)
    expect(items).toHaveLength(2)
    const updated = items.find((item) => item.title.includes('updated'))
    expect(updated).toMatchObject({
      sourceId: 'fixture-source',
      canonicalUrl: 'https://publisher.example/news/harbour-1?campaign=one',
      title: 'Harbour announcement & response updated',
      publishedAt: '2026-10-20T12:30:00.000Z',
      updatedAt: '2026-10-22T08:00:00.000Z',
      discoveredAt,
      language: 'en-CA',
      topicIds: ['civic-news', 'publisher:local-council'],
      aboutLocations: [],
      provenanceId: expect.stringMatching(/^prov-[a-f0-9]{64}$/),
      sourceContentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(updated?.id).toMatch(/^feed-[a-f0-9]{64}$/)

    const undated = items.find((item) => item.title === 'Undated notice')
    expect(undated).toBeDefined()
    expect(undated).not.toHaveProperty('publishedAt')
    expect(undated).not.toHaveProperty('updatedAt')
    expect(undated?.discoveredAt).toBe(discoveredAt)
    expect(undated?.language).toBe('en-NZ')
    expect(items.some((item) => item.title === 'Unsafe destination' || item.title === 'No safe link field')).toBe(false)
    expect(JSON.stringify(items)).not.toContain('Not retained as a PublicItem')
  })

  it('uses Atom namespaces and alternate links, strips title markup and keeps missing dates absent', async () => {
    const items = await parseFeedXml(atomFixture, {
      ...options,
      feedUrl: 'https://news.example/feeds/current/atom.xml',
    })
    expect(items).toHaveLength(2)
    const published = items.find((item) => item.title.startsWith('Harbour'))
    expect(published).toMatchObject({
      canonicalUrl: 'https://news.example/feeds/stories/alpha?source=feed',
      title: 'Harbour plan & public meeting',
      publishedAt: '2026-10-20T15:30:00.000Z',
      updatedAt: '2026-10-21T08:00:00.000Z',
      language: 'en-CA',
      topicIds: ['civic-news', 'publisher:local-news', 'publisher:public-meeting', expect.stringMatching(/^publisher:tag-[a-f0-9]{16}$/)],
      aboutLocations: [],
    })
    const undated = items.find((item) => item.title === 'Undated item')
    expect(undated).toBeDefined()
    expect(undated).not.toHaveProperty('publishedAt')
    expect(undated).not.toHaveProperty('updatedAt')
    expect(undated?.language).toBe('en-GB')
    expect(items.every((item) => item.canonicalUrl.startsWith('https://'))).toBe(true)
  })

  it('keeps item IDs stable across revisions while changing the metadata hash', async () => {
    const oldRevision = `<rss><channel><item><guid isPermaLink="false">news:harbour-1</guid><title>Harbour announcement &amp; response</title><link>/news/harbour-1?campaign=one</link><pubDate>Tue, 20 Oct 2026 12:30:00 GMT</pubDate><atom:updated xmlns:atom="http://www.w3.org/2005/Atom">2026-10-21T08:00:00Z</atom:updated></item></channel></rss>`
    const [oldItem] = await parseFeedXml(oldRevision, options)
    const currentItem = (await parseFeedXml(rssFixture, options))
      .find((item) => item.title.includes('Harbour'))
    expect(oldItem?.id).toBe(currentItem?.id)
    expect(oldItem?.provenanceId).toBe(currentItem?.provenanceId)
    expect(oldItem?.sourceContentHash).not.toBe(currentItem?.sourceContentHash)
    expect(currentItem?.updatedAt).toBe('2026-10-22T08:00:00.000Z')
  })

  it('gives the same items when the caller supplies a synchronous SHA-256, calling it twice per item', async () => {
    let calls = 0
    const sha256Hex = (value: string): string => {
      calls += 1
      return createHash('sha256').update(value).digest('hex')
    }
    for (const [fixture, feedUrl] of [[rssFixture, options.feedUrl], [atomFixture, 'https://publisher.example/feeds/atom.xml']] as const) {
      calls = 0
      const viaWebCrypto = await parseFeedXml(fixture, { ...options, feedUrl })
      const viaCaller = await parseFeedXml(fixture, { ...options, feedUrl, sha256Hex })
      expect(viaCaller).toEqual(viaWebCrypto)
      expect(viaCaller.length).toBeGreaterThan(0)
      // Every row that became a candidate was hashed twice (its id and its content), none through Web Crypto.
      expect(calls).toBeGreaterThanOrEqual(viaCaller.length * 2)
      expect(calls % 2).toBe(0)
    }
    // Non-ASCII text is hashed as UTF-8 either way.
    const accented = rssFixture.replace('Harbour announcement', 'Peña y Kraków — 東京')
    expect(await parseFeedXml(accented, { ...options, sha256Hex })).toEqual(await parseFeedXml(accented, options))
  })

  it('rejects declarations and unknown entities without expanding them', async () => {
    const payloads = [
      '<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss><channel/></rss>',
      '<!ENTITY secret "expanded"><rss><channel/></rss>',
      '<rss><channel><item><title>&secret;</title></item></channel></rss>',
      '<rss><channel><item><title>broken &amp</title></item></channel></rss>',
    ]
    for (const payload of payloads) {
      await expect(parseFeedXml(payload, options)).rejects.toThrow('Invalid RSS/Atom feed')
    }
  })

  it('rejects malformed XML and ignores invalid calendar dates instead of inventing replacements', async () => {
    await expect(parseFeedXml('<rss><channel></rss>', options)).rejects.toThrow('mismatched closing tag')
    await expect(parseFeedXml('<rss/>', options)).rejects.toThrow('missing its channel')
    const malformed = '<rss><channel><item><title>Bad date</title><link>/bad-date</link><pubDate>2026-02-30T12:00:00Z</pubDate></item></channel></rss>'
    const [item] = await parseFeedXml(malformed, options)
    expect(item).toBeDefined()
    expect(item).not.toHaveProperty('publishedAt')
  })

  it('rejects duplicate expanded XML attributes even when prefixes differ', async () => {
    const duplicateExpandedNames = '<rss xmlns:a="urn:same" xmlns:b="urn:same" a:flag="1" b:flag="2"><channel/></rss>'
    await expect(parseFeedXml(duplicateExpandedNames, options)).rejects.toThrow('duplicate expanded XML attribute')
  })

  it('enforces byte, text and item limits', async () => {
    const oversizedPayload = `<rss><channel>${' '.repeat(FEED_ADAPTER_LIMITS.bytes)}</channel></rss>`
    await expect(parseFeedXml(oversizedPayload, options)).rejects.toThrow('payload exceeds')

    const oversizedText = `<rss><channel><description>${'x'.repeat(FEED_ADAPTER_LIMITS.textCharacters + 1)}</description></channel></rss>`
    await expect(parseFeedXml(oversizedText, options)).rejects.toThrow('text exceeds')

    const tooManyItems = `<rss><channel>${'<item/>' .repeat(FEED_ADAPTER_LIMITS.items + 1)}</channel></rss>`
    await expect(parseFeedXml(tooManyItems, options)).rejects.toThrow('item count exceeds')
  })

  it('ignores foreign-namespace Atom entries and rejects unsafe feed origins and observation timestamps', async () => {
    const mixedNamespace = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:x="urn:foreign"><x:entry><x:id>x:1</x:id><x:title>Must ignore</x:title><x:link href="https://news.example/x"/></x:entry></feed>`
    await expect(parseFeedXml(mixedNamespace, options)).resolves.toEqual([])
    await expect(parseFeedXml(atomFixture, { ...options, feedUrl: 'file:///tmp/feed.xml' }))
      .rejects.toThrow('feed URL must be HTTP or HTTPS')
    await expect(parseFeedXml(atomFixture, { ...options, discoveredAt: '2026-02-30T12:00:00Z' }))
      .rejects.toThrow('discoveredAt must be a valid UTC timestamp')
  })
})
