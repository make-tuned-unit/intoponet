import { describe, expect, it } from 'vitest'
import { parseFeedXml } from './feed-adapter'
import { feedCharset, sanitizeFeedXml } from './feed-sanitize'

const options = { sourceId: 'test-feed', feedUrl: 'https://news.example/rss', discoveredAt: '2026-10-26T12:00:00.000Z', language: 'en' }

describe('sanitizeFeedXml', () => {
  it('drops bodies so oversized article text no longer breaks the strict parser', async () => {
    const body = 'x'.repeat(300_000)
    const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>T</title>
      <item><title>Storm closes ports</title><link>https://news.example/a</link><pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate>
      <description><![CDATA[${body}]]></description><content:encoded><![CDATA[<p>${body}</p>]]></content:encoded></item></channel></rss>`
    await expect(parseFeedXml(xml, options)).rejects.toThrow(/text exceeds/)
    const items = await parseFeedXml(sanitizeFeedXml(xml), options)
    expect(items.map((item) => item.title)).toEqual(['Storm closes ports'])
  })

  it('repairs HTML entities, bare ampersands and undeclared prefixes', async () => {
    const xml = `<rss version="2.0"><channel><title>T</title>
      <item><title>Q&amp;A: Budget &ndash; what&rsquo;s next for AT&T&nbsp;workers</title><link>https://news.example/b</link>
      <media:content url="https://img.example/x.jpg"/><dc:creator>Desk</dc:creator></item></channel></rss>`
    const items = await parseFeedXml(sanitizeFeedXml(xml), options)
    expect(items[0]!.title).toBe('Q&A: Budget – what’s next for AT&T workers')
  })

  it('removes a bare DOCTYPE but keeps entity declarations rejected', async () => {
    const plain = `<!DOCTYPE rss><rss version="2.0"><channel><title>T</title><item><title>Hello world</title><link>https://news.example/c</link></item></channel></rss>`
    expect((await parseFeedXml(sanitizeFeedXml(plain), options)).length).toBe(1)
    const hostile = `<!DOCTYPE rss [<!ENTITY x "boom">]><rss version="2.0"><channel><title>T</title><item><title>&x;</title><link>https://news.example/d</link></item></channel></rss>`
    await expect(parseFeedXml(sanitizeFeedXml(hostile), options)).rejects.toThrow(/DOCTYPE|entity/)
  })
})

describe('feedCharset', () => {
  it('reads the header first, then the XML prolog', () => {
    expect(feedCharset('text/xml; charset=ISO-8859-1', new Uint8Array())).toBe('iso-8859-1')
    expect(feedCharset('text/xml', new TextEncoder().encode('<?xml version="1.0" encoding="windows-1252"?>'))).toBe('windows-1252')
    expect(feedCharset(null, new TextEncoder().encode('<rss>'))).toBe('utf-8')
  })
})
