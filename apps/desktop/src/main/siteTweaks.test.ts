import { describe, expect, it } from 'vitest'
import { parseSiteTweakDraft, parseSiteTweakSite } from '@intoponet/browser-api'
import { checkTweakInput, cssProblem, decodeCss, hideCss, isEmptyTweak, listItem, PICK_ELEMENT_SCRIPT, selectorProblem, SITE_TWEAK_LIMITS, SiteTweaks, SiteTweakStore, siteOf, tweakCss } from './siteTweaks'

const NOW = 1_700_000_000_000

describe('selectors', () => {
  it('accepts the selectors the picker makes', () => {
    for (const selector of ['#sidebar', '.ad-slot', 'div.promo.banner', 'main > aside:nth-of-type(2)', 'section > div:nth-of-type(3) > p', 'a[href^="https"]', 'input[name=q]']) {
      expect(selectorProblem(selector), selector).toBeNull()
    }
  })

  it('refuses anything that could leave its rule or inject markup', () => {
    for (const selector of ['body}*{display:block', 'div{}', 'a;b', 'a/*x*/', 'a\\7d', '@import x', '<script>', 'a<b', 'a!important', 'div\nspan']) {
      expect(selectorProblem(selector), JSON.stringify(selector)).not.toBeNull()
    }
  })

  it('refuses selectors that hide the whole page, the universal selector and broken syntax', () => {
    expect(selectorProblem('*')).toMatch(/cannot use \*/)
    expect(selectorProblem('div *')).toMatch(/cannot use \*/)
    expect(selectorProblem('body')).toMatch(/whole page/)
    expect(selectorProblem('HTML')).toMatch(/whole page/)
    expect(selectorProblem(':root')).toMatch(/whole page/)
    expect(selectorProblem('div[class')).toMatch(/not complete/)
    expect(selectorProblem('p:nth-of-type(2')).toMatch(/not complete/)
    expect(selectorProblem('a > ')).toMatch(/not complete/)
    expect(selectorProblem('> a')).toMatch(/not complete/)
    expect(selectorProblem('a[title="x]')).toMatch(/not complete/)
  })

  it('enforces the length cap and the type', () => {
    expect(selectorProblem('a'.repeat(SITE_TWEAK_LIMITS.selector + 1))).toMatch(/too long/)
    expect(selectorProblem('a'.repeat(SITE_TWEAK_LIMITS.selector))).toBeNull()
    expect(selectorProblem(42)).toMatch(/must be a selector/)
    expect(selectorProblem('   ')).toMatch(/empty/)
  })
})

describe('CSS checks', () => {
  it('keeps ordinary style rules', () => {
    expect(cssProblem('p { color: red; }\n.note::before { content: "\\201C"; }')).toBeNull()
    expect(cssProblem('.hero { background: url(data:image/png;base64,iVBORw0KGgo=) no-repeat; }')).toBeNull()
    expect(cssProblem('')).toBeNull()
  })

  it('refuses @import, however it is written', () => {
    expect(cssProblem('@import url("https://evil.example/a.css");')).toMatch(/@import/)
    expect(cssProblem('@\\69mport "https://evil.example/a.css";')).toMatch(/@import/)
    expect(cssProblem('@IMPORT "x";')).toMatch(/@import/)
  })

  it('refuses any url() that is not embedded data, including escaped spellings', () => {
    expect(cssProblem('a { background: url(https://tracker.example/p.gif) }')).toMatch(/embedded with data/)
    expect(cssProblem('a { background: url( "//cdn.example/x.png" ) }')).toMatch(/embedded with data/)
    expect(cssProblem('a { background: url(javascript:alert(1)) }')).toMatch(/embedded with data/)
    expect(cssProblem('a { background: u\\72l(https://x.example/y) }')).toMatch(/embedded with data/)
    expect(cssProblem('a { background: url(data:image/gif;base64,R0lGOD) url(http://x.example/a) }')).toMatch(/embedded with data/)
  })

  it('refuses image(), image-set() and src(), which can name remote files without url()', () => {
    expect(cssProblem('a { background: image("https://x.example/a.png") }')).toMatch(/image\(\)/)
    expect(cssProblem('a { background-image: -webkit-image-set("https://x.example/a.png" 1x) }')).toMatch(/image\(\)/)
    expect(cssProblem('a { background: src("https://x.example/a.png") }')).toMatch(/image\(\)/)
  })

  it('refuses markup, including the </style><script> escape', () => {
    expect(cssProblem('</style><script>window.SITE_TWEAK_SENTINEL = 1</script>')).toMatch(/cannot contain HTML/)
    expect(cssProblem('p{}<img src=x onerror=1>')).toMatch(/cannot contain HTML/)
    expect(cssProblem('p{} <!-- hidden')).toMatch(/cannot contain HTML/)
  })

  it('refuses rules that are not allowed in a modern engine', () => {
    expect(cssProblem('a { width: expression(alert(1)) }')).toMatch(/not allowed/)
    expect(cssProblem('a { -moz-binding: url(x) }')).toMatch(/not allowed/)
    expect(cssProblem('a { behavior: url(x.htc) }')).toMatch(/not allowed/)
  })

  it('caps the size in bytes, not characters', () => {
    expect(cssProblem('a{}'.repeat(SITE_TWEAK_LIMITS.css / 3))).toBeNull()
    expect(cssProblem('a'.repeat(SITE_TWEAK_LIMITS.css + 1))).toMatch(/longer than 20 KB/)
    // 'é' is two bytes: 10 KB of them is over 20 KB of bytes.
    expect(cssProblem('é'.repeat(SITE_TWEAK_LIMITS.css / 2 + 1))).toMatch(/longer than 20 KB/)
  })

  it('refuses NUL bytes and non-text', () => {
    expect(cssProblem('a{}\0')).toMatch(/not allowed/)
    expect(cssProblem(12)).toMatch(/must be text/)
  })

  it('decodes comments and escapes before checking', () => {
    expect(decodeCss('@\\69 mport x')).toBe('@import x')
    expect(decodeCss('a/* @import */b')).toBe('ab')
    expect(decodeCss('\\\\')).toBe('\\')
  })
})

describe('checkTweakInput', () => {
  it('keeps a full, valid draft and trims the CSS', () => {
    const result = checkTweakInput({ enabled: true, hidden: ['#a', '.b', '#a'], width: 'narrow', font: 'serif', colors: 'dark', css: '  p { color: red }  ' }, NOW)
    expect(result).toEqual({
      ok: true,
      tweak: { enabled: true, hidden: ['#a', '.b'], width: 'narrow', font: 'serif', colors: 'dark', css: 'p { color: red }', updatedAt: NOW },
    })
  })

  it('defaults to enabled, and leaves out choices that are not set', () => {
    const result = checkTweakInput({ hidden: ['#x'], width: null }, NOW)
    expect(result).toEqual({ ok: true, tweak: { enabled: true, hidden: ['#x'], updatedAt: NOW } })
  })

  it('refuses values outside the choices', () => {
    expect(checkTweakInput({ width: 'huge' }, NOW)).toEqual({ ok: false, error: 'Width is not one of the choices.' })
    expect(checkTweakInput({ font: 'comic' }, NOW)).toEqual({ ok: false, error: 'Font is not one of the choices.' })
    expect(checkTweakInput({ colors: 'pink' }, NOW)).toEqual({ ok: false, error: 'Colours is not one of the choices.' })
    expect(checkTweakInput({ enabled: 'yes' }, NOW).ok).toBe(false)
  })

  it('refuses too many hidden elements, and bad selectors anywhere in the list', () => {
    const many = Array.from({ length: SITE_TWEAK_LIMITS.hidden + 1 }, (_, i) => `#n${i}`)
    expect(checkTweakInput({ hidden: many }, NOW)).toEqual({ ok: false, error: `A site can hide at most ${SITE_TWEAK_LIMITS.hidden} elements.` })
    expect(checkTweakInput({ hidden: ['#ok', 'body'] }, NOW)).toEqual({ ok: false, error: 'A selector cannot hide the whole page.' })
    expect(checkTweakInput({ hidden: 'x' }, NOW)).toEqual({ ok: false, error: 'Hidden elements must be a list.' })
  })

  it('refuses CSS with a reason the person can read', () => {
    const result = checkTweakInput({ css: '@import "https://x.example/a.css"' }, NOW)
    expect(result).toEqual({ ok: false, error: 'Your styles cannot load other style sheets (@import).' })
  })

  it('refuses things that are not objects', () => {
    expect(checkTweakInput(null, NOW)).toEqual({ ok: false, error: 'Nothing to save.' })
    expect(checkTweakInput(['x'], NOW)).toEqual({ ok: false, error: 'Nothing to save.' })
  })
})

describe('generated CSS', () => {
  it('hides selectors with display none, and nothing else', () => {
    expect(hideCss(['#a', '.b > p'])).toBe('#a { display: none !important; }\n.b > p { display: none !important; }')
    expect(hideCss([])).toBe('')
  })

  it('makes the reading width, font and colours, then the own CSS last', () => {
    const css = tweakCss({ enabled: true, width: 'medium', font: 'mono', colors: 'light', css: 'h1 { color: teal }' })
    expect(css).toContain('max-width: 56rem !important')
    expect(css).toContain('font-family: ui-monospace')
    expect(css).toContain('background-color: #ffffff !important')
    expect(css.trimEnd().endsWith('h1 { color: teal }')).toBe(true)
  })

  it('uses the three widths', () => {
    expect(tweakCss({ enabled: true, width: 'narrow' })).toContain('42rem')
    expect(tweakCss({ enabled: true, width: 'wide' })).toContain('72rem')
  })

  it('dark colours set the colour scheme and a dark body', () => {
    const css = tweakCss({ enabled: true, colors: 'dark' })
    expect(css).toContain('color-scheme: dark')
    expect(css).toContain('#1c1c1e')
  })

  it('is empty when the tweak is off, and never emits script or markup', () => {
    expect(tweakCss({ enabled: false, width: 'wide', css: 'p{}' })).toBe('')
    const css = tweakCss({ enabled: true, css: 'p { color: red }' })
    expect(css).not.toMatch(/<|script/i)
  })
})

describe('SiteTweakStore', () => {
  const memory = (initial: string | null = null) => {
    const writes: string[] = []
    let stored = initial
    return {
      writes,
      io: {
        read: () => stored,
        write: async (data: string) => { stored = data; writes.push(data) },
      },
    }
  }

  it('keys by host, saves on a delay, and loads what it saved', async () => {
    const memo = memory()
    const store = new SiteTweakStore(memo.io, 5)
    const checked = checkTweakInput({ hidden: ['#ad'] }, NOW)
    if (!checked.ok) throw new Error(checked.error)
    expect(store.put('example.org', checked.tweak)).toBe(true)
    expect(memo.writes).toEqual([])
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(memo.writes.length).toBe(1)
    const reloaded = new SiteTweakStore(memory(memo.writes[0]!).io)
    expect(reloaded.get('example.org')?.hidden).toEqual(['#ad'])
    expect(reloaded.get('other.example')).toBeNull()
  })

  it('flushes a waiting save at once', async () => {
    const memo = memory()
    const store = new SiteTweakStore(memo.io, 60_000)
    store.put('a.example', { enabled: true, hidden: ['#x'], updatedAt: NOW })
    await store.flush()
    expect(JSON.parse(memo.writes[0]!).sites['a.example'].hidden).toEqual(['#x'])
  })

  it('drops invalid entries on load instead of applying them', () => {
    const file = JSON.stringify({
      version: 1,
      sites: {
        'good.example': { enabled: true, hidden: ['#a'], updatedAt: NOW },
        'bad-css.example': { enabled: true, hidden: [], css: '@import "https://x.example/a.css"', updatedAt: NOW },
        'bad-selector.example': { enabled: true, hidden: ['body'], updatedAt: NOW },
        'EVIL HOST': { enabled: true, hidden: ['#a'], updatedAt: NOW },
        'empty.example': { enabled: true, hidden: [], updatedAt: NOW },
        'not-object.example': 'x',
      },
    })
    const store = new SiteTweakStore(memory(file).io)
    expect(store.list().map((item) => item.site)).toEqual(['good.example'])
  })

  it('starts empty from a damaged or unknown file', () => {
    expect(new SiteTweakStore(memory('{nope').io).list()).toEqual([])
    expect(new SiteTweakStore(memory('{"version":2,"sites":{}}').io).list()).toEqual([])
    expect(new SiteTweakStore(memory(null).io).list()).toEqual([])
  })

  it('refuses a new site past the limit, and still allows changes to a known one', () => {
    const store = new SiteTweakStore(memory().io, 60_000)
    for (let i = 0; i < SITE_TWEAK_LIMITS.sites; i += 1) expect(store.put(`s${i}.example`, { enabled: true, hidden: ['#a'], updatedAt: i })).toBe(true)
    expect(store.put('one-more.example', { enabled: true, hidden: ['#a'], updatedAt: NOW })).toBe(false)
    expect(store.put('s0.example', { enabled: false, hidden: ['#b'], updatedAt: NOW })).toBe(true)
  })

  it('lists newest first and removes entries', () => {
    const store = new SiteTweakStore(memory().io, 60_000)
    store.put('old.example', { enabled: true, hidden: ['#a'], updatedAt: 1 })
    store.put('new.example', { enabled: true, hidden: ['#a'], updatedAt: 2 })
    expect(store.list().map((item) => item.site)).toEqual(['new.example', 'old.example'])
    expect(store.remove('new.example')).toBe(true)
    expect(store.remove('new.example')).toBe(false)
    expect(store.list().map((item) => item.site)).toEqual(['old.example'])
  })
})

describe('SiteTweaks (saving, private tabs)', () => {
  const setup = () => {
    const writes: string[] = []
    const store = new SiteTweakStore({ read: () => null, write: async (data) => { writes.push(data) } }, 60_000)
    return { store, writes, tweaks: new SiteTweaks(store) }
  }

  it('saves a normal tab to the store and removes the entry when the tweak is empty', () => {
    const { tweaks, store } = setup()
    expect(tweaks.save('a.example', { hidden: ['#x'] }, false, NOW)).toEqual({ ok: true, tweak: { enabled: true, hidden: ['#x'], updatedAt: NOW } })
    expect(store.get('a.example')).not.toBeNull()
    expect(tweaks.save('a.example', { hidden: [] }, false, NOW)).toEqual({ ok: true, tweak: null })
    expect(store.get('a.example')).toBeNull()
  })

  it('a refused save changes nothing', () => {
    const { tweaks, store } = setup()
    tweaks.save('a.example', { hidden: ['#x'] }, false, NOW)
    expect(tweaks.save('a.example', { hidden: ['body'] }, false, NOW + 1).ok).toBe(false)
    expect(store.get('a.example')?.hidden).toEqual(['#x'])
  })

  it('a private tab reads saved tweaks but its changes are only in memory and never written', () => {
    const { tweaks, store, writes } = setup()
    tweaks.save('a.example', { hidden: ['#saved'] }, false, NOW)
    expect(tweaks.get('a.example', true)?.hidden).toEqual(['#saved'])
    expect(tweaks.save('a.example', { hidden: ['#private'] }, true, NOW + 5).ok).toBe(true)
    expect(tweaks.get('a.example', true)?.hidden).toEqual(['#private'])
    expect(tweaks.get('a.example', false)?.hidden).toEqual(['#saved'])
    expect(store.get('a.example')?.hidden).toEqual(['#saved'])
    expect(writes).toEqual([])
  })

  it('a private tab can remove a saved tweak for its session only', () => {
    const { tweaks, store } = setup()
    tweaks.save('a.example', { hidden: ['#saved'] }, false, NOW)
    tweaks.save('a.example', { hidden: [] }, true, NOW)
    expect(tweaks.get('a.example', true)).toBeNull()
    expect(store.get('a.example')).not.toBeNull()
  })

  it('turns a site on and off without changing its settings', () => {
    const { tweaks, store } = setup()
    tweaks.save('a.example', { hidden: ['#x'], font: 'serif' }, false, NOW)
    expect(tweaks.setEnabled('a.example', false, false, NOW + 1)?.enabled).toBe(false)
    expect(store.get('a.example')).toMatchObject({ enabled: false, hidden: ['#x'], font: 'serif' })
    expect(tweaks.setEnabled('nothing.example', false, false, NOW)).toBeNull()
  })

  it('answers a private tab that asks for a new site past the limit with the same message', () => {
    const { tweaks, store } = setup()
    for (let i = 0; i < SITE_TWEAK_LIMITS.sites; i += 1) store.put(`s${i}.example`, { enabled: true, hidden: ['#a'], updatedAt: i })
    expect(tweaks.save('new.example', { hidden: ['#a'] }, true, NOW)).toMatchObject({ ok: false })
    expect(tweaks.save('s1.example', { hidden: ['#b'] }, true, NOW)).toMatchObject({ ok: true })
  })
})

describe('helpers', () => {
  it('keys tweaks by host without www., and refuses other URLs', () => {
    expect(siteOf('https://www.Example.org/a?b=1')).toBe('example.org')
    expect(siteOf('http://127.0.0.1:8080/x')).toBe('127.0.0.1')
    expect(siteOf('file:///Users/me/a.html')).toBeNull()
    expect(siteOf('about:blank')).toBeNull()
  })

  it('reports an empty tweak and the list row', () => {
    expect(isEmptyTweak({ hidden: [] })).toBe(true)
    expect(isEmptyTweak({ hidden: [], colors: 'dark' })).toBe(false)
    expect(listItem('a.example', { enabled: false, hidden: ['#a'], css: 'p{}', width: 'wide', updatedAt: 3 })).toEqual({
      site: 'a.example', enabled: false, hiddenCount: 1, hasCss: true, width: 'wide', updatedAt: 3,
    })
  })

  it('the wire parsers accept hosts and drafts and refuse the rest', () => {
    expect(parseSiteTweakSite('localhost')).toBe('localhost')
    expect(() => parseSiteTweakSite('../etc')).toThrow('Invalid site.')
    expect(() => parseSiteTweakSite('A.example')).toThrow('Invalid site.')
    expect(() => parseSiteTweakDraft([])).toThrow('Invalid site tweak.')
    expect(() => parseSiteTweakDraft({ css: 'x'.repeat(70_000) })).toThrow('too large')
    expect(parseSiteTweakDraft({ hidden: [] })).toEqual({ hidden: [] })
  })

  it('the picker script is a single expression that resolves with a selector', () => {
    expect(PICK_ELEMENT_SCRIPT.startsWith('new Promise((resolve) => {')).toBe(true)
    expect(PICK_ELEMENT_SCRIPT).toContain('__intoponetPicker')
    // The script must never reach for the page's own scripts or markup.
    expect(PICK_ELEMENT_SCRIPT).not.toMatch(/innerHTML|document\.write|eval\(|new Function/)
  })
})
