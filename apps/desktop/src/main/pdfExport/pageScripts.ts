import readabilitySource from '@mozilla/readability/Readability.js?raw'
import readerableSource from '@mozilla/readability/Readability-readerable.js?raw'
import purifySource from 'dompurify/dist/purify.min.js?raw'

/**
 * Scripts run in the page for Export as PDF, all in a private isolated world (never the page's own
 * scripts' world), so the page cannot tamper with what they see or return.
 *
 * 1. PREPARE (live page): load lazy images, scroll once if images are still missing, wait for
 *    images and fonts, read the page's own description of itself, and copy only what is visible
 *    on screen (no hidden or clipped text, no fixed overlays, no ads) into a detached document.
 * 2. FINALIZE (detached copy): decide whether this is an article, extract it with Readability,
 *    keep only images the page really showed, and sanitize the result with DOMPurify.
 * 3. CLEAN_LIVE / REVERT (As seen): hide ads, overlays and scroll locks on the live page just
 *    for printing, then put every change back.
 */
export const PDF_WORLD_ID = 1309

const word = (key: string): string[] => [`[class^="${key}" i]`, `[class*=" ${key}" i]`, `[class*="-${key}" i]`, `[class*="_${key}" i]`, `[id^="${key}" i]`]

/** Ad containers. Class fragments only match at a word start ("head-container" is not an ad). */
export const AD_SELECTORS: readonly string[] = [
  '.adsbygoogle', 'amp-ad', 'amp-embed', 'amp-sticky-ad',
  '[id^="google_ads"]', '[id^="div-gpt-ad"]', '[id^="gpt-ad"]', '[id^="dfp-"]', '[class^="dfp-"]',
  '[data-google-query-id]', '[data-ad]', '[data-ad-slot]', '[data-ad-unit]', '[data-adunit]', '[data-ad-placement]', '[data-ad-type]', '[data-ad-id]',
  '[data-testid*="ad-slot" i]', '[data-testid*="adslot" i]', '[data-testid="ad" i]',
  ...['ad-slot', 'adslot', 'ad-container', 'ad-wrapper', 'ad-unit', 'adunit', 'ad-banner', 'ad-box', 'ad-placement', 'advert', 'taboola', 'outbrain', 'sponsored-content', 'promoted-content', 'native-ad', 'dfp-ad'].flatMap(word),
  '[class*="OUTBRAIN"]', '[id*="taboola" i]', '[id*="outbrain" i]', '[id*="advert" i]',
  '.ad', '.ads', '.advertisement', '.advertising', '#ad', '#ads',
  '[aria-label="advertisement" i]', '[aria-label="advertisements" i]', '[aria-label="sponsored" i]', '[aria-roledescription="advertisement" i]',
  'iframe[src*="doubleclick.net"]', 'iframe[src*="googlesyndication.com"]', 'iframe[src*="amazon-adsystem.com"]', 'iframe[id^="google_ads"]',
]

const AD_HOSTS = 'doubleclick\\.net|googlesyndication\\.com|googleadservices\\.com|adservice\\.google|amazon-adsystem\\.com|taboola\\.com|outbrain\\.com|adnxs\\.com|criteo\\.(?:com|net)|pubmatic\\.com|rubiconproject\\.com|openx\\.net|teads\\.tv|moatads\\.com|adsafeprotected\\.com|yieldmo\\.com|sharethrough\\.com|33across\\.com|smartadserver\\.com|media\\.net|adform\\.net|casalemedia\\.com'

const SHARED = (adSelector: string) => `
  const AD_SELECTOR = ${JSON.stringify(adSelector)};
  const AD_HOST = /(?:^|\\.)(?:${AD_HOSTS})/i;
  const AD_LABEL = /^(advertisement|advertisements|advert|adverts|ad|ads|sponsored|sponsored content|paid content|paid post|promoted|anzeige|werbung|publicité|publicidad|pubblicità|reklame|reklama|annonce)$/i;
  const adSet = new Set();
  try { for (const el of document.querySelectorAll(AD_SELECTOR)) adSet.add(el); } catch (e) {}
  const hostOf = (url) => { try { return new URL(url, location.href).hostname; } catch (e) { return ''; } };
  const labelOnly = (el) => el.childElementCount === 0 && AD_LABEL.test((el.textContent || '').trim());
`

export type PrepareOptions = {
  /** Copy the visible page for Formatted mode (As seen only needs the images loaded). */
  clone: boolean
  images: boolean
  scroll: boolean
  budgetMs: number
}

export function prepareScript(options: PrepareOptions, extraAdSelectors: string[]): string {
  const adSelector = [...AD_SELECTORS, ...extraAdSelectors.filter((selector) => selector.length < 200)].join(',')
  return `(async () => {
  const options = ${JSON.stringify(options)};
  const started = Date.now();
  const deadline = started + options.budgetMs;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  ${SHARED(adSelector)}

  // 1. Lazy images: load them now instead of when scrolled to.
  const LAZY = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url', 'data-hi-res-src', 'data-full-src'];
  const placeholder = (src) => !src || /^data:image\\/(gif|svg)/i.test(src) || /(blank|placeholder|spacer|transparent|pixel|lazy)[^/]*\\.(gif|png|svg)/i.test(src);
  let lazy = 0;
  for (const img of Array.from(document.images)) {
    if (img.getAttribute('loading') === 'lazy') { img.setAttribute('loading', 'eager'); lazy += 1; }
    if (placeholder(img.getAttribute('src'))) {
      for (const name of LAZY) {
        const value = img.getAttribute(name);
        if (value && /^(https?:)?\\/\\/|^\\//.test(value)) { img.setAttribute('src', value); lazy += 1; break; }
      }
      const set = img.getAttribute('data-srcset') || img.getAttribute('data-lazy-srcset');
      if (set && !img.getAttribute('srcset')) { img.setAttribute('srcset', set); lazy += 1; }
    }
  }
  for (const source of Array.from(document.querySelectorAll('source[data-srcset]'))) {
    if (!source.getAttribute('srcset')) { source.setAttribute('srcset', source.getAttribute('data-srcset')); lazy += 1; }
  }

  // 2. Pages that load images as they scroll: scroll down once (never past the page's first
  //    length, so endless feeds stop), then go back to where the reader was.
  const scroller = document.scrollingElement || document.documentElement;
  const startX = scrollX, startY = scrollY;
  const missingNow = Array.from(document.images).some((img) => !img.complete || img.naturalWidth === 0);
  let scrolled = false;
  if (options.scroll && (missingNow || lazy > 0) && scroller.scrollHeight > innerHeight * 1.3) {
    scrolled = true;
    const limit = Math.min(scroller.scrollHeight, 80000);
    const step = Math.max(240, Math.round(innerHeight * 0.85));
    for (let y = 0; y < limit && Date.now() < started + 9000; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await sleep(110);
    }
    window.scrollTo({ top: limit, behavior: 'instant' });
    await sleep(160);
    window.scrollTo({ left: startX, top: startY, behavior: 'instant' });
  }

  // 3. Wait for images and fonts, within the time allowed.
  const loading = Array.from(document.images).filter((img) => !img.complete).map((img) => new Promise((resolve) => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
  }));
  await Promise.race([
    Promise.all([Promise.all(loading), document.fonts ? document.fonts.ready : null]),
    sleep(Math.max(400, Math.min(6000, deadline - Date.now() - 2000))),
  ]);

  // 4. What the page says about itself. Never the JSON-LD articleBody (it can hold text the page hides).
  const metaOf = (selector) => { const el = document.querySelector(selector); return el ? (el.getAttribute('content') || '').trim() : ''; };
  const metaAll = (selector) => Array.from(document.querySelectorAll(selector)).map((el) => (el.getAttribute('content') || '').trim()).filter(Boolean);
  const ld = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const value = JSON.parse(script.textContent || '');
      for (const item of (Array.isArray(value) ? value : [value])) {
        if (item && Array.isArray(item['@graph'])) ld.push(...item['@graph']); else if (item) ld.push(item);
      }
    } catch (e) {}
  }
  const typesOf = (item) => [].concat(item && item['@type'] || []).filter((type) => typeof type === 'string');
  const types = [...new Set(ld.flatMap(typesOf))].slice(0, 40);
  const ARTICLE = /Article$|BlogPosting|Report$|Thesis|Chapter|LiveBlogPosting|Review$|Recipe$/;
  const article = ld.find((item) => typesOf(item).some((type) => ARTICLE.test(type))) || null;
  const names = (value) => [].concat(value || []).map((item) => typeof item === 'string' ? item : (item && typeof item.name === 'string' ? item.name : '')).filter(Boolean);
  const text = (value) => typeof value === 'string' ? value.replace(/\\s+/g, ' ').trim() : '';
  const seenAuthors = new Set();
  const authors = [...metaAll('meta[name="citation_author"]'), ...(article ? names(article.author) : []), metaOf('meta[name="author"]'), metaOf('meta[name="parsely-author"]')]
    .map(text).filter((name) => name && name.length < 120 && !/^https?:/i.test(name))
    .filter((name) => { const key = name.toLowerCase(); if (seenAuthors.has(key)) return false; seenAuthors.add(key); return true; })
    .slice(0, 8);
  const canonicalEl = document.querySelector('link[rel="canonical"]');
  const timeEl = document.querySelector('article time[datetime], main time[datetime]');
  const doiRaw = metaOf('meta[name="citation_doi"]') || metaOf('meta[name="dc.identifier" i]') || metaOf('meta[name="DC.Identifier"]');
  const doiMatch = /10\\.\\d{4,9}\\/\\S+/.exec(doiRaw);
  const ogType = metaOf('meta[property="og:type"]');
  // The page's title without the site's name on the end ("Charlottetown - Wikipedia" → "Charlottetown", site "Wikipedia").
  let site = text(metaOf('meta[property="og:site_name"]') || metaOf('meta[name="application-name"]'));
  let title = text(metaOf('meta[name="citation_title"]') || metaOf('meta[property="og:title"]') || document.title || (article && text(article.headline)) || '');
  const SEPARATOR = /\\s+(?:[|–—-]|·|::)\\s+/;
  for (let round = 0; round < 2; round += 1) {
    const parts = title.split(SEPARATOR);
    if (parts.length < 2) break;
    const last = parts[parts.length - 1].trim();
    const related = !site || last.toLowerCase().includes(site.toLowerCase()) || site.toLowerCase().includes(last.toLowerCase()) || last.toLowerCase().replace(/\\s+/g, '') === location.hostname.replace(/^www\\./, '').split('.')[0];
    if (last.length > 40 || !related) break;
    if (!site) site = last;
    const separators = new RegExp(SEPARATOR.source, 'g');
    let cut = -1;
    for (let match = separators.exec(title); match; match = separators.exec(title)) cut = match.index;
    if (cut <= 0) break;
    title = title.slice(0, cut).trim();
  }
  if (!site && article && article.publisher) site = text(article.publisher.name);
  const meta = {
    title: title.slice(0, 300),
    authors,
    site: site.slice(0, 120),
    published: text(metaOf('meta[name="citation_publication_date"]') || metaOf('meta[name="citation_date"]') || metaOf('meta[property="article:published_time"]') || (article && text(article.datePublished)) || metaOf('meta[name="date"]') || (timeEl ? timeEl.getAttribute('datetime') : '')).slice(0, 60),
    modified: text(metaOf('meta[property="article:modified_time"]') || (article && text(article.dateModified)) || '').slice(0, 60),
    url: location.href,
    canonicalUrl: canonicalEl && /^https?:/i.test(canonicalEl.href) ? canonicalEl.href : (/^https?:/i.test(metaOf('meta[property="og:url"]')) ? metaOf('meta[property="og:url"]') : ''),
    doi: doiMatch ? doiMatch[0] : '',
    lang: (document.documentElement.getAttribute('lang') || metaOf('meta[http-equiv="content-language" i]') || '').trim().slice(0, 20),
    dir: document.body ? (getComputedStyle(document.body).direction === 'rtl' ? 'rtl' : 'ltr') : '',
    description: text(metaOf('meta[property="og:description"]') || metaOf('meta[name="description"]')).slice(0, 400),
    keywords: [...metaOf('meta[name="keywords"]').split(','), ...metaAll('meta[property="article:tag"]')].map(text).filter(Boolean).slice(0, 12),
  };

  // How much of what is visible is links: home pages and listings are mostly links, articles are not.
  let linkChars = 0;
  for (const a of Array.from(document.querySelectorAll('a[href]')).slice(0, 4000)) {
    if (a.parentElement && a.parentElement.closest('a[href]')) continue;
    linkChars += (a.innerText || '').replace(/\\s+/g, ' ').trim().length;
  }
  const stats = { lazy, scrolled, images: 0, missingImages: 0, ads: 0, nodes: 0, truncated: false };
  let appShell = false;
  for (const el of document.querySelectorAll('canvas, [class*="mapboxgl" i], .leaflet-container, gmp-map')) {
    const r = el.getBoundingClientRect();
    if (r.width * r.height > innerWidth * innerHeight * 0.45) { appShell = true; break; }
  }
  if (!options.clone || !document.body) return { meta, images: [], stats, appShell };

  // 5. A copy of what is visible: hidden, faded, blurred, clipped-away and fixed-position content is
  //    left out, and so are ads. The copy lives in a document with no window: nothing in it loads or runs.
  const doc = document.implementation.createHTMLDocument('');
  const allowed = new Set();
  const pageNoHash = location.href.split('#')[0];
  const DROP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'DIALOG', 'VIDEO', 'AUDIO', 'SOURCE', 'TRACK', 'SLOT', 'PORTAL', 'FENCEDFRAME', 'MENU']);
  const EMBED = /(^|\\.)(youtube(-nocookie)?\\.com|youtu\\.be|vimeo\\.com|dailymotion\\.com|twitter\\.com|x\\.com|instagram\\.com|tiktok\\.com|soundcloud\\.com|spotify\\.com|bsky\\.app)$/i;
  const SVG_NS = 'http://www.w3.org/2000/svg', MATH_NS = 'http://www.w3.org/1998/Math/MathML';
  const fixLink = (live, copy) => {
    if (live.getAttribute('href') === null) return;
    const href = live.href || '';
    if (!/^(https?|mailto):/i.test(href)) { copy.removeAttribute('href'); return; }
    const hash = href.indexOf('#');
    copy.setAttribute('href', hash > 0 && href.slice(0, hash) === pageNoHash && href.length > hash + 1 ? href.slice(hash) : href);
  };
  const walk = (live, into, clipBottom) => {
    for (let child = live.firstChild; child; child = child.nextSibling) {
      if (stats.nodes > 150000 || Date.now() > deadline) { stats.truncated = true; return; }
      if (child.nodeType === 3) { into.appendChild(doc.createTextNode(child.data)); continue; }
      if (child.nodeType !== 1) continue;
      stats.nodes += 1;
      const el = child;
      const tag = el.tagName;
      if (DROP.has(tag) && tag !== 'IFRAME') continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || Number(cs.opacity) < 0.1 || cs.position === 'fixed' || /blur\\(/.test(cs.filter) || el.getAttribute('aria-modal') === 'true') continue;
      if (adSet.has(el) || labelOnly(el)) { stats.ads += 1; continue; }
      // A box that starts with an "Advertisement" label and holds little else is the ad itself.
      if (el.firstElementChild && labelOnly(el.firstElementChild) && (el.textContent || '').length < 400 && !/^(ARTICLE|MAIN|BODY)$/.test(tag)) { stats.ads += 1; continue; }
      if (cs.display !== 'contents' && el.getClientRects().length === 0) continue;
      const rect = el.getBoundingClientRect();
      const top = rect.top + scrollY;
      if (rect.height > 0 && top >= clipBottom - 1) continue;
      if (tag === 'IFRAME') {
        const host = hostOf(el.src);
        if (EMBED.test(host) && !AD_HOST.test(host)) {
          const p = doc.createElement('p');
          const a = doc.createElement('a');
          a.setAttribute('href', el.src);
          a.textContent = 'Embedded from ' + host.replace(/^www\\./, '') + (el.title ? ': ' + el.title : '');
          p.appendChild(a);
          into.appendChild(p);
        }
        continue;
      }
      if (el.namespaceURI === SVG_NS || el.namespaceURI === MATH_NS) {
        if (el.namespaceURI === SVG_NS && rect.width < 24 && rect.height < 24) continue;
        into.appendChild(doc.importNode(el, true));
        continue;
      }
      if (tag === 'IMG') {
        if (!options.images || (rect.width < 24 && rect.height < 24)) continue;
        const src = el.currentSrc || el.src || '';
        if (!el.complete || !el.naturalWidth || !/^(https?:|data:image\\/(png|jpe?g|gif|webp|avif);)/i.test(src) || src.length > 3000000 || AD_HOST.test(hostOf(src))) { stats.missingImages += 1; continue; }
        const img = doc.createElement('img');
        img.setAttribute('src', src);
        img.setAttribute('alt', el.getAttribute('alt') || '');
        img.setAttribute('width', String(Math.round(rect.width)));
        img.setAttribute('height', String(Math.round(rect.height)));
        if (!src.startsWith('data:')) allowed.add(src);
        stats.images += 1;
        into.appendChild(img);
        continue;
      }
      if (tag === 'CANVAS') {
        if (!options.images || rect.width * rect.height < 40000) continue;
        try {
          const data = el.toDataURL('image/png');
          if (data.length > 4000000) continue;
          const img = doc.createElement('img');
          img.setAttribute('src', data);
          img.setAttribute('width', String(Math.round(rect.width)));
          img.setAttribute('height', String(Math.round(rect.height)));
          stats.images += 1;
          into.appendChild(img);
        } catch (e) { stats.missingImages += 1; }
        continue;
      }
      if (tag === 'DETAILS' && !el.open) {
        // Closed sections are printed open (only their visible summary was checked).
        const copy = doc.importNode(el, true);
        copy.setAttribute('open', '');
        for (const bad of copy.querySelectorAll('script, style, iframe, object, embed, img, video, audio')) bad.remove();
        into.appendChild(copy);
        continue;
      }
      const copy = doc.importNode(el, false);
      if (tag === 'A') fixLink(el, copy);
      into.appendChild(copy);
      let nextClip = clipBottom;
      if ((cs.overflowY === 'hidden' || cs.overflowY === 'clip') && el.scrollHeight > el.clientHeight + 8 && tag !== 'BODY') nextClip = Math.min(clipBottom, rect.bottom + scrollY);
      walk(el.shadowRoot && !el.firstElementChild ? el.shadowRoot : el, copy, nextClip);
    }
  };
  walk(document.body, doc.body, Infinity);
  const visibleChars = (document.body.innerText || '').replace(/\\s+/g, ' ').length;
  const homePage = (location.pathname === '/' || location.pathname === '') && !location.search;
  globalThis.__intoponetPdf = { doc, meta, allowed, visibleChars, linkDensity: visibleChars ? linkChars / visibleChars : 0, homePage, types, ogType, articleType: !!article, appShell };
  return { meta, images: [...allowed], stats, appShell };
})()`
}

export function finalizeScript(input: { blocked: string[]; mode: 'auto' | 'formatted' }): string {
  return `(() => {
  const state = globalThis.__intoponetPdf;
  globalThis.__intoponetPdf = null;
  if (!state) return { formatted: null, reason: 'The page changed while it was being saved.' };
  const blocked = new Set(${JSON.stringify(input.blocked)});
  const mode = ${JSON.stringify(input.mode)};
  const Readability = (function () { var module = { exports: {} }; var exports = module.exports;
${readabilitySource}
  ; return module.exports; })();
  const isProbablyReaderable = (function () { var module = { exports: {} }; var exports = module.exports;
${readerableSource}
  ; return module.exports; })();
  const DOMPurify = (function () { var module = { exports: {} }; var exports = module.exports; var define;
${purifySource}
  ; return module.exports; })();

  const doc = state.doc;
  const base = doc.createElement('base');
  base.setAttribute('href', location.href);
  doc.head.appendChild(base);
  doc.title = state.meta.title;
  const readerable = isProbablyReaderable(doc, { minContentLength: 140, minScore: 20, visibilityChecker: () => true });
  let parsed = null;
  try { parsed = new Readability(doc, { charThreshold: 500, keepClasses: false, disableJSONLD: true, serializer: (el) => el }).parse(); } catch (e) {}
  const text = parsed && parsed.textContent ? parsed.textContent.replace(/\\s+/g, ' ').trim() : '';
  const ratio = state.visibleChars ? text.length / state.visibleChars : 0;
  const NON_ARTICLE = /^(Product|ProductGroup|ItemList|SearchResultsPage|CollectionPage|ProfilePage|AggregateOffer)$/;
  const nonArticle = (!state.articleType && state.types.some((type) => NON_ARTICLE.test(type))) || /^(product|profile|video|music|books?\\.author)/i.test(state.ogType);
  // Pages that say they are articles get the benefit of the doubt; others must look like one.
  const articleSignal = state.articleType || /^article$/i.test(state.ogType) || !!state.meta.published;
  let reason = '';
  if (!parsed || text.length < 500) reason = 'too little article text';
  // Plain essays (text in <font> and <br>, no paragraphs) fail Readability's quick test but are mostly article.
  else if (!readerable && !(text.length >= 2000 && ratio >= 0.5 && state.linkDensity < 0.3)) reason = 'no clear article';
  else if (nonArticle) reason = 'a shop, profile or listing page';
  else if (state.appShell) reason = 'mostly a map or chart';
  else if (state.homePage && !state.articleType) reason = 'a home page';
  else if (!articleSignal && state.linkDensity > 0.55) reason = 'mostly links';
  else if (ratio < (articleSignal ? 0.08 : 0.2)) reason = 'the article is a small part of the page';
  if (mode === 'auto' && reason) return { formatted: null, reason };
  if (!parsed || text.length < 60) return { formatted: null, reason: reason || 'no article text' };

  const root = parsed.content;
  const norm = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const first = root.querySelector('h1, h2');
  if (first && norm(first.textContent) === norm(state.meta.title || parsed.title)) first.remove();
  // Only images the page showed (Readability can turn lazy placeholders into addresses that never loaded).
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src') || '';
    if (!(src.startsWith('data:image/') || state.allowed.has(src)) || blocked.has(src)) { img.remove(); continue; }
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
  }
  for (const el of Array.from(root.querySelectorAll('picture source, figure:empty'))) el.remove();
  const html = DOMPurify.sanitize(root.outerHTML, {
    FORBID_TAGS: ['style', 'script', 'iframe', 'frame', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'base', 'foreignObject', 'video', 'audio', 'source', 'track', 'dialog', 'template', 'noscript'],
    FORBID_ATTR: ['style', 'srcset', 'sizes', 'loading', 'ping', 'target', 'class', 'decoding', 'fetchpriority', 'background', 'poster', 'xlink:href', 'formaction', 'action'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|#|data:image\\/(?:png|jpe?g|gif|webp|avif);)/i,
    ALLOW_DATA_ATTR: false,
  });
  return {
    formatted: { html, title: parsed.title || '', byline: parsed.byline || '', lang: parsed.lang || '', dir: parsed.dir || '', chars: text.length },
    reason,
  };
})()`
}

export function cleanLiveScript(extraAdSelectors: string[]): string {
  const adSelector = [...AD_SELECTORS, ...extraAdSelectors.filter((selector) => selector.length < 200)].join(',')
  return `(() => {
  ${SHARED(adSelector)}
  const changes = [];
  const set = (el, prop, value) => {
    changes.push([el, prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
    el.style.setProperty(prop, value, 'important');
  };
  let ads = 0, overlays = 0;
  for (const el of adSet) { set(el, 'display', 'none'); ads += 1; }
  const AD_SIZES = new Set(['300x250', '728x90', '320x50', '160x600', '300x600', '970x250', '970x90', '320x100', '336x280', '468x60', '300x50']);
  for (const el of document.querySelectorAll('iframe')) {
    const r = el.getBoundingClientRect();
    if (AD_HOST.test(hostOf(el.src)) || AD_SIZES.has(Math.round(r.width) + 'x' + Math.round(r.height))) { set(el, 'display', 'none'); ads += 1; }
  }
  // "Advertisement" labels, and the box they label when it holds nothing else to read.
  for (const el of document.querySelectorAll('body span, body div, body p, body small, body aside')) {
    if (!labelOnly(el)) continue;
    const parent = el.parentElement;
    if (parent && parent !== document.body && (parent.innerText || '').trim().length < 40) set(parent, 'display', 'none'); else set(el, 'display', 'none');
    ads += 1;
  }
  const vw = innerWidth, vh = innerHeight;
  const OVERLAY = /consent|cookie|gdpr|cmp|newsletter|subscribe|paywall|modal|dialog|popup|overlay|chat|banner|interstitial|signup|sign-up|regwall/;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    if (cs.position === 'sticky') { set(el, 'position', 'static'); continue; }
    const r = el.getBoundingClientRect();
    const cover = (Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))) / (vw * vh);
    const label = ((el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '') + ' ' + (el.getAttribute('role') || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
    // A bar along the top (the site's header) stays, once, at the top of page one; anything else fixed goes.
    if (r.top <= 2 && r.width > vw * 0.6 && r.height < vh * 0.25 && cover < 0.3 && !OVERLAY.test(label)) set(el, 'position', 'absolute');
    else { set(el, 'display', 'none'); overlays += 1; }
  }
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.overflowY === 'hidden' || cs.overflowY === 'clip') { set(el, 'overflow', 'visible'); set(el, 'height', 'auto'); }
    if (cs.position === 'fixed') set(el, 'position', 'static');
  }
  globalThis.__intoponetPdfRevert = changes;
  return { ads, overlays };
})()`
}

export const REVERT_LIVE_SCRIPT = `(() => {
  const changes = globalThis.__intoponetPdfRevert || [];
  globalThis.__intoponetPdfRevert = null;
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const [el, prop, value, priority] = changes[index];
    if (value) el.style.setProperty(prop, value, priority); else el.style.removeProperty(prop);
  }
  return changes.length;
})()`
