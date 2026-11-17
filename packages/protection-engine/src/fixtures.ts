import type { CompiledRule } from './types'

// The built-in host rules. The two test hosts always apply. The rest are what the app blocks when
// the public filter lists (EasyList and EasyPrivacy, see lists.ts and ../lists) could not be
// loaded; with the lists loaded, the lists decide for these hosts, exceptions included.
export const fixtureRules: CompiledRule[] = [
  { id: 'fix-ads-intoponet-test', host: 'ads.intoponet.test', category: 'ad', always: true },
  { id: 'fix-track-intoponet-test', host: 'track.intoponet.test', category: 'tracker', always: true },
  { id: 'fix-doubleclick', host: 'doubleclick.net', category: 'ad' },
  { id: 'fix-googlesyndication', host: 'googlesyndication.com', category: 'ad' },
  { id: 'fix-googleadservices', host: 'googleadservices.com', category: 'ad' },
  { id: 'fix-googletagservices', host: 'googletagservices.com', category: 'ad' },
  { id: 'fix-googletagmanager', host: 'googletagmanager.com', category: 'tracker' },
  { id: 'fix-google-analytics', host: 'google-analytics.com', category: 'tracker' },
  { id: 'fix-scorecardresearch', host: 'scorecardresearch.com', category: 'tracker' },
  { id: 'fix-adsrvr', host: 'adsrvr.org', category: 'ad' },
  { id: 'fix-ads-twitter', host: 'ads-twitter.com', category: 'ad' },
  { id: 'fix-facebook-pixel', host: 'facebook.net', category: 'tracker' },
  { id: 'fix-hotjar', host: 'hotjar.com', category: 'tracker' },
  { id: 'fix-taboola', host: 'taboola.com', category: 'ad' },
  { id: 'fix-outbrain', host: 'outbrain.com', category: 'ad' },
  { id: 'fix-criteo', host: 'criteo.com', category: 'ad' },
  { id: 'fix-amazon-adsystem', host: 'amazon-adsystem.com', category: 'ad' },
  { id: 'fix-2mdn', host: '2mdn.net', category: 'ad' },
  { id: 'fix-pagead2', host: 'pagead2.googlesyndication.com', category: 'ad' },
  { id: 'fix-adnxs', host: 'adnxs.com', category: 'ad' },
  { id: 'fix-rubiconproject', host: 'rubiconproject.com', category: 'ad' },
  { id: 'fix-pubmatic', host: 'pubmatic.com', category: 'ad' },
  { id: 'fix-openx', host: 'openx.net', category: 'ad' },
  { id: 'fix-moatads', host: 'moatads.com', category: 'ad' },
  { id: 'fix-casalemedia', host: 'casalemedia.com', category: 'ad' },
  { id: 'fix-quantserve', host: 'quantserve.com', category: 'tracker' },
  { id: 'fix-chartbeat', host: 'chartbeat.com', category: 'tracker' },
  { id: 'fix-newrelic', host: 'nr-data.net', category: 'tracker' },
  { id: 'fix-segment', host: 'segment.com', category: 'tracker' },
  { id: 'fix-mixpanel', host: 'mixpanel.com', category: 'tracker' },
  { id: 'fix-clarity', host: 'clarity.ms', category: 'tracker' },
  { id: 'fix-hotjar-io', host: 'hotjar.io', category: 'tracker' },
]

// Conservative container selectors, Intoponet's own (not from a public list). They are also what
// Export as PDF removes and what the empty-slot cleanup looks for; EasyList's element rules are added
// to pages as CSS beside them (see ProtectionLists.pageCss and elementCss).
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
