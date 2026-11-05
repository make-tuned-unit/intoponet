import { describe, expect, it } from 'vitest'
import { ArticlePreviews, decodeEntities, parseArticlePreview, previewableUrl } from './articlePreview'

const PAGE = `<!doctype html><html lang="fr-CA"><head>
<meta charset="utf-8"><title>Fallback title</title>
<meta property="og:title" content="EN DIRECT | Élections de mi-mandat&nbsp;: Trump juge &laquo;vrai&raquo;">
<meta property="og:site_name" content="Le Journal de Montréal">
<meta property="og:description" content="Les Américains aux urnes &amp; les premiers bureaux ouvrent.">
<meta property="og:image" content="/images/hero.jpg">
<meta property="og:image:alt" content="Un bureau de vote">
<meta property="article:published_time" content="2026-11-03T12:30:00-05:00">
<meta property="article:section" content="Monde">
<meta name="keywords" content="élections, États-Unis, Trump">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"LiveBlogPosting","headline":"x","author":[{"@type":"Person","name":"Marie Tremblay"},{"@type":"Person","name":"Agence QMI"}],"wordCount":1150,"isAccessibleForFree":false,"dateModified":"2026-11-03T18:00:00Z"}]}</script>
</head><body></body></html>`

describe('parseArticlePreview', () => {
  it('reads Open Graph, article tags and JSON-LD', () => {
    const preview = parseArticlePreview(PAGE, 'https://www.journaldemontreal.com/2026/11/03/en-direct')
    expect(preview.title).toBe('EN DIRECT | Élections de mi-mandat : Trump juge «vrai»')
    expect(preview.siteName).toBe('Le Journal de Montréal')
    expect(preview.description).toBe('Les Américains aux urnes & les premiers bureaux ouvrent.')
    expect(preview.image).toBe('https://www.journaldemontreal.com/images/hero.jpg')
    expect(preview.imageAlt).toBe('Un bureau de vote')
    expect(preview.authors).toEqual(['Marie Tremblay', 'Agence QMI'])
    expect(preview.publishedAt).toBe('2026-11-03T17:30:00.000Z')
    expect(preview.modifiedAt).toBe('2026-11-03T18:00:00.000Z')
    expect(preview.section).toBe('Monde')
    expect(preview.keywords).toEqual(['élections', 'États-Unis', 'Trump'])
    expect(preview.readingMinutes).toBe(5)
    expect(preview.lang).toBe('fr-CA')
    expect(preview.live).toBe(true)
    expect(preview.paywalled).toBe(true)
  })

  it('falls back to the title tag and meta author, splitting several writers', () => {
    const preview = parseArticlePreview('<html><head><title>Plain &amp; simple</title><meta name="author" content="By Ana Silva and John Doe"><meta content="https://x.test/p.png" name="twitter:image"></head></html>', 'https://x.test/a')
    expect(preview.title).toBe('Plain & simple')
    expect(preview.authors).toEqual(['Ana Silva', 'John Doe'])
    expect(preview.image).toBe('https://x.test/p.png')
    expect(preview.live).toBe(false)
    expect(preview.paywalled).toBe(false)
  })

  it('ignores profile links, staff bylines and unsafe image addresses', () => {
    const preview = parseArticlePreview('<meta property="article:author" content="https://facebook.com/someone"><meta name="author" content="Staff"><meta property="og:image" content="javascript:alert(1)">', 'https://x.test/a')
    expect(preview.authors).toEqual([])
    expect(preview.image).toBeNull()
  })
})

describe('bylines and images', () => {
  it('finds writers in byl, rel="author" links and JSON-LD creator', () => {
    expect(parseArticlePreview('<meta name="byl" content="By Jane Roe">', 'https://x.test/a').authors).toEqual(['Jane Roe'])
    expect(parseArticlePreview('<p>Par <a href="/auteur/1" rel="author">Luc Martin</a></p>', 'https://x.test/a').authors).toEqual(['Luc Martin'])
    expect(parseArticlePreview('<script type="application/ld+json">{"@type":"NewsArticle","creator":"Kim Lee"}</script>', 'https://x.test/a').authors).toEqual(['Kim Lee'])
  })
  it('falls back to a byline element in the page, but not a photo credit', () => {
    const html = '<span class="picture__author">Foto: Jens Hansen</span><div class="publish__author">Ritzau</div>'
    expect(parseArticlePreview(html, 'https://x.test/a').authors).toEqual(['Ritzau'])
    expect(parseArticlePreview('<p class="c-byline">Par Luc Martin et Ana Roy</p>', 'https://x.test/a').authors).toEqual(['Luc Martin', 'Ana Roy'])
  })
  it('keeps only the first section name', () => {
    expect(parseArticlePreview('<meta property="article:section" content="noticias,sonora">', 'https://x.test/a').section).toBe('noticias')
  })
  it('drops logos and placeholders as the story image', () => {
    expect(parseArticlePreview('<meta property="og:image" content="https://x.test/static/logo-tva-1200.png">', 'https://x.test/a').image).toBeNull()
    expect(parseArticlePreview('<meta property="og:image" content="https://x.test/assets/brand/share.jpg">', 'https://x.test/a').image).toBeNull()
    expect(parseArticlePreview('<meta property="og:image" content="https://x.test/2026/11/trump-rally.jpg?w=1200">', 'https://x.test/a').image).toBe('https://x.test/2026/11/trump-rally.jpg?w=1200')
  })
})

describe('helpers', () => {
  it('decodes numeric and named entities', () => {
    expect(decodeEntities('&#233;t&#xE9; &quot;ok&quot; &amp;')).toBe('été "ok" &')
  })
  it('only previews public web pages', () => {
    expect(previewableUrl('https://www.bbc.com/news/1')).toBe(true)
    expect(previewableUrl('http://localhost:3000/')).toBe(false)
    expect(previewableUrl('file:///etc/passwd')).toBe(false)
    expect(previewableUrl('https://192.168.1.1/')).toBe(false)
  })
})

const publicDns = async () => ['93.184.216.34']

describe('ArticlePreviews', () => {
  it('fetches without cookies, shrinks the image, and caches', async () => {
    const calls: Array<{ url: string; credentials: string | undefined }> = []
    const fetchImpl = (async (input: string, init?: RequestInit) => {
      calls.push({ url: input, credentials: init?.credentials })
      if (input.endsWith('.jpg')) return new Response(new Uint8Array([0xff, 0xd8, 1, 2]), { headers: { 'content-type': 'image/jpeg' } })
      return new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }) as typeof fetch
    const previews = new ArticlePreviews((bytes) => ({ data: bytes.subarray(0, 2), mime: 'image/jpeg' }), fetchImpl, publicDns)
    const preview = await previews.get('https://www.journaldemontreal.com/a')
    expect(preview?.image).toBe('data:image/jpeg;base64,/9g=')
    expect(preview?.url).toBe('https://www.journaldemontreal.com/a')
    await previews.get('https://www.journaldemontreal.com/a')
    expect(calls.map((call) => call.url)).toEqual(['https://www.journaldemontreal.com/a', 'https://www.journaldemontreal.com/images/hero.jpg'])
    expect(calls.every((call) => call.credentials === 'omit')).toBe(true)
  })

  describe('redirects', () => {
    const shrink = (bytes: Buffer) => ({ data: bytes.subarray(0, 2), mime: 'image/jpeg' })
    const dns = async (host: string) => (host.startsWith('router.') ? ['192.168.1.1'] : host.startsWith('loop.') ? ['127.0.0.1', '93.184.216.34'] : ['93.184.216.34'])
    const redirect = (location: string) => new Response(null, { status: 302, headers: { location } })
    const html = (body = PAGE) => new Response(body, { headers: { 'content-type': 'text/html' } })

    it('follows public redirects one hop at a time, checking each address', async () => {
      const calls: Array<{ url: string; redirect: string | undefined }> = []
      const fetchImpl = (async (input: string, init?: RequestInit) => {
        calls.push({ url: input, redirect: init?.redirect })
        if (input === 'https://news.example.org/a') return redirect('/b')
        if (input.endsWith('.jpg')) return new Response(new Uint8Array([0xff, 0xd8, 1, 2]), { headers: { 'content-type': 'image/jpeg' } })
        return html()
      }) as typeof fetch
      const preview = await new ArticlePreviews(shrink, fetchImpl, dns).get('https://news.example.org/a')
      expect(preview?.title).toContain('Élections')
      expect(preview?.image).toBe('data:image/jpeg;base64,/9g=')
      expect(calls.map((call) => call.url)).toEqual(['https://news.example.org/a', 'https://news.example.org/b', 'https://news.example.org/images/hero.jpg'])
      expect(calls.every((call) => call.redirect === 'manual')).toBe(true)
    })

    it('refuses redirects to the local network, this Mac or literal addresses', async () => {
      for (const target of ['http://router.example.org/admin', 'https://loop.example.org/', 'http://192.168.1.1/', 'http://127.0.0.1:8080/', 'http://localhost/']) {
        const calls: string[] = []
        const fetchImpl = (async (input: string) => {
          calls.push(input)
          return input === 'https://news.example.org/a' ? redirect(target) : html()
        }) as typeof fetch
        expect(await new ArticlePreviews(shrink, fetchImpl, dns).get('https://news.example.org/a'), target).toBeNull()
        expect(calls, target).toEqual(['https://news.example.org/a'])
      }
    })

    it('refuses a page whose own name resolves to a private address', async () => {
      const calls: string[] = []
      const fetchImpl = (async (input: string) => { calls.push(input); return html() }) as typeof fetch
      expect(await new ArticlePreviews(shrink, fetchImpl, dns).get('https://router.example.org/a')).toBeNull()
      expect(calls).toEqual([])
    })

    it('refuses a final address that a transport reached by following redirects itself', async () => {
      const fetchImpl = (async () => {
        const response = html()
        Object.defineProperty(response, 'url', { value: 'https://router.example.org/' })
        return response
      }) as typeof fetch
      expect(await new ArticlePreviews(shrink, fetchImpl, dns).get('https://news.example.org/a')).toBeNull()
    })

    it('does not fetch an og:image that points or redirects at a private address', async () => {
      for (const image of ['https://router.example.org/cam.jpg', 'https://news.example.org/redirecting.jpg']) {
        const calls: string[] = []
        const fetchImpl = (async (input: string) => {
          calls.push(input)
          if (input === 'https://news.example.org/redirecting.jpg') return redirect('http://router.example.org/cam.jpg')
          if (input.endsWith('.jpg')) return new Response(new Uint8Array([0xff, 0xd8, 1, 2]), { headers: { 'content-type': 'image/jpeg' } })
          return html(`<meta property="og:title" content="T"><meta property="og:image" content="${image}">`)
        }) as typeof fetch
        const preview = await new ArticlePreviews(shrink, fetchImpl, dns).get('https://news.example.org/a')
        expect(preview?.title).toBe('T')
        expect(preview?.image).toBeNull()
        expect(calls.some((url) => url.startsWith('https://router.') || url.startsWith('http://router.'))).toBe(false)
      }
    })
  })
})
