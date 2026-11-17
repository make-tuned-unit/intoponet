import type { CompiledRule } from './types'

// The two hosts the unit tests and the e2e checks ask for. Every real rule is in
// data/blocklist.json (see blocklist.ts).
export const fixtureRules: CompiledRule[] = [
  { id: 'fix-ads-intoponet-test', host: 'ads.intoponet.test', category: 'ad' },
  { id: 'fix-track-intoponet-test', host: 'track.intoponet.test', category: 'tracker' },
]

// Conservative container selectors, Intoponet's own: each names something that holds only an ad.
// They are also what Export as PDF removes and what the empty-slot cleanup looks for.
export const fixtureHideSelectors = [
  '.adsbygoogle',
  '[id^="google_ads"]',
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'iframe[src*="amazon-adsystem.com"]',
  '[id^="taboola-"]',
  '[class*="OUTBRAIN"]',
  'ins.adsbygoogle',
  'amp-ad',
  'amp-embed[type="taboola"]',
  '[id^="div-gpt-ad"]',
  '[id^="google_ads_iframe"]',
  '[data-google-query-id]',
  'iframe[src*="adnxs.com"]',
  'iframe[src*="criteo.com"]',
  'iframe[src*="rubiconproject.com"]',
  'iframe[src*="pubmatic.com"]',
  'iframe[src*="taboola.com"]',
  'iframe[src*="outbrain.com"]',
  '.OUTBRAIN',
  '.trc_related_container',
]
