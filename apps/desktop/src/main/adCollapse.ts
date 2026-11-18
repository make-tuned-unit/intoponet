/**
 * No blank boxes where ads were. With ads blocked, a page still has the space it kept for them:
 * an empty frame, or a slot with only "Advertisement" in it. Run in each frame after the page
 * loads and soon after an ad request is blocked, this hides those leftovers: the elements whose
 * address was blocked, and the containers around them (up to four levels) that hold nothing else
 * but an ad label. Known ad slots are only hidden when they are empty like this too, so a
 * container that also holds the article is never touched.
 */

import { measuredSlotSelectors } from '@intoponet/protection-engine'

/** What an ad slot's own label may say (it is then hidden with the slot). */
export const AD_LABEL = /^(advertisement|advertisements|advertising|advert|ad|ads|sponsored|sponsored content|promoted|anzeige|werbung|publicité|publicidade|publicidad|pubblicità|reklama|reklame|annonce|annons|annonse|advertentie|mainos|reklam|διαφήμιση|реклама|реклама и спонсоры|广告|廣告|広告|광고|إعلان|פרסומת|विज्ञापन)$/i

/** Elements that are ad slots by their name; hidden only once nothing but a label is left in them. */
export const AD_SLOT_SELECTOR = [
  '[id^="div-gpt-ad"]', '[id^="google_ads"]', '[id^="gpt-ad"]', '[id^="ad-slot"]', '[id^="adslot"]',
  '[class~="ad-slot"]', '[class~="ad-container"]', '[class~="ad-wrapper"]', '[class~="ad-unit"]', '[class~="ad-banner"]',
  '[class~="ad"]', '[class~="ads"]', '[class~="advert"]', '[class~="advertisement"]', '[class*="ad-placeholder"]',
  '[data-ad]', '[data-ad-slot]', '[data-ad-unit]', '[data-ad-placeholder]', '[data-google-query-id]',
  '[aria-label="Advertisement" i]', '[aria-label="Ad" i]', 'amp-ad', 'ins.adsbygoogle',
  // The ad units of fontanka.ru and its sister city sites (read from their pages, 17 November 2026): each keeps
  // 250 to 400 px for a banner whether or not one arrives. The site's own promotions carry none of these names.
  '[data-hsm-adunit]', '[data-creative-placeholder-wrapper]', '[class~="inline-adv-slot"]',
  // Slot names Intoponet's own measurement of news pages found (packages/protection-engine/data/element-rules.json).
  ...measuredSlotSelectors,
].join(',')

export function collapseAdSlotsScript(blockedUrls: readonly string[]): string {
  return `(() => {
  const blocked = new Set(${JSON.stringify(blockedUrls.slice(-200))});
  const label = ${AD_LABEL.toString()};
  const media = 'img,picture,video,canvas,svg,iframe,embed,object,input,textarea,select,button,a[href]';
  const keep = /^(MAIN|ARTICLE|BODY|HTML|HEADER|FOOTER|NAV|FORM)$/;
  const done = (element) => element.hasAttribute('data-intoponet-collapsed') || !!element.closest('[data-intoponet-collapsed]');
  const hide = (element) => {
    element.setAttribute('data-intoponet-collapsed', '');
    element.style.setProperty('display', 'none', 'important');
  };
  const shown = (element) => {
    if (done(element)) return false;
    const box = element.getBoundingClientRect();
    return box.width > 2 && box.height > 2;
  };
  // Nothing in it but an ad label: no other words, no picture, frame, field or link still showing.
  const emptyish = (element) => {
    const text = (element.innerText || '').replace(/\\s+/g, ' ').trim();
    if (text && !label.test(text)) return false;
    return ![...element.querySelectorAll(media)].some(shown);
  };
  const collapse = (element) => {
    hide(element);
    let node = element.parentElement;
    for (let level = 0; level < 4 && node && !keep.test(node.tagName); level += 1) {
      if (!emptyish(node)) break;
      hide(node);
      node = node.parentElement;
    }
  };
  const addressOf = (element) => {
    const value = element.currentSrc || element.src || element.data || '';
    try { return value ? new URL(value, location.href).href : ''; } catch { return ''; }
  };
  for (const element of document.querySelectorAll('iframe,img,embed,object,video,source')) {
    if (done(element)) continue;
    const address = addressOf(element);
    if (address && blocked.has(address)) collapse(element.tagName === 'SOURCE' && element.parentElement ? element.parentElement : element);
  }
  for (const element of document.querySelectorAll(${JSON.stringify(AD_SLOT_SELECTOR)})) {
    if (!done(element) && !keep.test(element.tagName) && emptyish(element)) collapse(element);
  }
})()`
}

/** Protection paused for the site: everything collapsed comes back at once. */
export const UNCOLLAPSE_AD_SLOTS_SCRIPT = `(() => {
  for (const element of document.querySelectorAll('[data-intoponet-collapsed]')) {
    element.removeAttribute('data-intoponet-collapsed');
    element.style.removeProperty('display');
  }
})()`
