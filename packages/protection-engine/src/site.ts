// Which site a host belongs to ("cdn.bbc.co.uk" → "bbc.co.uk"), so a page's own requests are never
// blocked and two customers of one hosting service count as different sites.
//
// This table is Intoponet's own, written by hand from general knowledge of how country registries
// and hosting services hand out names. It is NOT the Public Suffix List and is not derived from it.
// It is deliberately small, so it is incomplete, and the direction of its mistakes is chosen:
//
//   An unknown suffix makes two hosts look like the SAME site. A request to the same site is never
//   blocked, so the mistake under-blocks and can never break a page.
//
// (Listing something here that is really one organisation's domain has no cost either: its hosts
// are then different sites to each other, which only matters for a host that is on the blocklist.)

/** Second-level labels that registries of two-letter country domains hand names out under ("co.uk", "com.au", "gob.mx", "ac.jp"). */
const COUNTRY_SECOND_LEVEL = new Set([
  'co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'mil', 'gob', 'gouv', 'go', 'or', 'ne', 'nom', 'sch',
  'info', 'biz', 'gen', 'ltd', 'name', 'int', 'k12', 'govt', 'gv', 'firm', 'ind',
])

/** Country suffixes the general rule above does not cover, and hosting services whose customers each get a name under the suffix. */
const SUFFIXES = new Set([
  // United Kingdom, Australia, New Zealand
  'me.uk', 'plc.uk', 'nhs.uk', 'police.uk', 'asn.au', 'id.au', 'school.nz', 'geek.nz', 'kiwi.nz', 'maori.nz', 'iwi.nz', 'cri.nz', 'health.nz',
  // East and South-East Asia
  'ad.jp', 'ed.jp', 'gr.jp', 'lg.jp', 're.kr', 'pe.kr', 'hs.kr', 'ms.kr', 'es.kr', 'sc.kr', 'kg.kr',
  'idv.tw', 'game.tw', 'club.tw', 'ebiz.tw', 'idv.hk', 'web.id', 'my.id', 'desa.id', 'ponpes.id', 'in.th', 'mi.th',
  'health.vn', 'pro.vn', 'per.sg', 'ngo.ph', 'i.ph',
  // South Asia
  'res.in', 'nic.in', 'ernet.in', 'web.pk', 'fam.pk', 'gop.pk', 'gos.pk', 'gok.pk', 'web.lk', 'ngo.lk', 'soc.lk', 'assn.lk', 'grp.lk', 'hotel.lk',
  // Middle East and Turkey
  'muni.il', 'idf.il', 'eun.eg', 'sci.eg', 'med.sa', 'pub.sa', 'bel.tr', 'av.tr', 'web.tr', 'tv.tr', 'pol.tr', 'tsk.tr', 'bbs.tr', 'dr.tr', 'kep.tr',
  'id.ir', 'in.ua', 'kiev.ua', 'kyiv.ua', 'lviv.ua', 'kharkov.ua', 'odessa.ua', 'dp.ua', 'pp.ua', 'pp.ru', 'msk.ru', 'spb.ru',
  // Africa
  'web.za', 'law.za', 'school.za', 'ngo.za', 'mobi.ng', 'i.ng', 'sc.ke', 'me.ke', 'mobi.ke', 'sc.tz', 'me.tz', 'mobi.tz', 'tv.tz', 'hotel.tz', 'sc.ug',
  'press.ma', 'asso.dz', 'art.dz', 'pol.dz', 'tm.mg', 'prd.mg', 'asso.ci', 'presse.ci', 'art.sn', 'univ.sn', 'perso.sn', 'ens.tn', 'fin.tn', 'ind.tn', 'nat.tn', 'tourism.tn', 'rnu.tn', 'rns.tn', 'rnrt.tn',
  // Latin America
  'art.br', 'blog.br', 'tv.br', 'jor.br', 'eco.br', 'emp.br', 'inf.br', 'radio.br', 'rec.br', 'srv.br', 'tur.br', 'etc.br', 'esp.br', 'adv.br', 'eng.br', 'med.br', 'psi.br', 'pro.br', 'vlog.br', 'wiki.br', 'app.br', 'dev.br', 'fm.br', 'coop.br', 'leg.br', 'mus.br', 'flog.br', 'agr.br', 'am.br', 'bio.br', 'cim.br', 'cnt.br', 'ecn.br', 'far.br', 'fot.br', 'g12.br', 'imb.br', 'mat.br', 'ntr.br', 'odo.br', 'ppg.br', 'seg.br', 'slg.br', 'taxi.br', 'teo.br', 'tmp.br', 'trd.br', 'vet.br', 'zlg.br',
  'tur.ar', 'musica.ar', 'web.ve', 'tec.ve', 'rec.ve', 'web.co', 'fin.ec', 'med.ec', 'pro.ec', 'sld.cu', 'sld.pa', 'abo.pa', 'ing.pa', 'med.pa', 'tv.bo',
  // Europe
  'tm.fr', 'asso.fr', 'presse.fr', 'priv.at', 'waw.pl', 'tm.ro', 'nt.ro', 'arts.ro', 'priv.no', 'tm.se', 'pp.se', 'press.se', 'parti.se', 'priv.hu', 'tm.hu', 'sport.hu', 'in.rs', 'iz.hr', 'from.hr', 'tm.mc', 'asso.mc',
  // Names sold under a registry-like domain
  'uk.com', 'us.com', 'eu.com', 'de.com', 'gb.com', 'gb.net', 'uk.net', 'jpn.com', 'br.com', 'cn.com', 'ru.com', 'sa.com', 'za.com', 'se.net', 'in.net', 'co.com', 'us.org', 'eu.org', 'com.de', 'com.se',
  // Hosting and site builders: each customer is a different site
  'github.io', 'githubusercontent.com', 'gitlab.io', 'pages.dev', 'workers.dev', 'r2.dev', 'vercel.app', 'now.sh', 'netlify.app', 'netlify.com', 'herokuapp.com', 'onrender.com', 'fly.dev', 'deno.dev', 'glitch.me', 'surge.sh', 'repl.co', 'replit.app', 'replit.dev',
  'web.app', 'firebaseapp.com', 'appspot.com', 'azurewebsites.net', 'azurestaticapps.net', 'ondigitalocean.app', 'digitaloceanspaces.com', 'railway.app', 'up.railway.app', 'pythonanywhere.com', 'ngrok.io', 'ngrok.app', 'ngrok-free.app', 'trycloudflare.com',
  'blogspot.com', 'wordpress.com', 'wpcomstaging.com', 'wpengine.com', 'tumblr.com', 'substack.com', 'typepad.com', 'livejournal.com', 'wixsite.com', 'wixstudio.com', 'weebly.com', 'squarespace.com', 'myshopify.com', 'webflow.io', 'framer.app', 'framer.website', 'carrd.co', 'notion.site', 'bubbleapps.io', 'strikingly.com', 'jimdofree.com', 'jimdosite.com', 'godaddysites.com', 'mystrikingly.com', 'site123.me', 'ucoz.ru', 'ucoz.com', 'narod.ru', 'hatenablog.com', 'hateblo.jp', 'fc2.com', 'livedoor.blog', 'ameblo.jp', 'over-blog.com', 'canalblog.com', 'blog.hu', 'blogfa.com', 'blog.ir', 'tistory.com', 'neocities.org', 'readthedocs.io', 'gitbook.io', 'itch.io', 'hubspotpagebuilder.com', 'translate.goog',
  // Content networks that give every customer a host
  'cloudfront.net', 'akamaihd.net', 'akamaized.net', 'azureedge.net', 'b-cdn.net', 'cdn77.org', 'kxcdn.com', 'netdna-ssl.com', 'netdna-cdn.com', 'stackpathcdn.com', 'edgekey.net', 'edgesuite.net', 'azurefd.net', 'trafficmanager.net', 'cloudflare.net', 'gcdn.co', 'rackcdn.com', 'llnwd.net', 'hwcdn.net', 'cdngslb.com', 'alicdn.com', 'aliyuncs.com', 'myqcloud.com', 'qiniucdn.com', 'bcebos.com', 'backblazeb2.com', 'wasabisys.com', 'supabase.co', 'imgix.net', 'cloudinary.com',
])

/** Services with names several levels deep ("bucket.s3.eu-west-1.amazonaws.com"): every host is its own site. */
const EVERY_HOST_ITS_OWN_SITE = ['amazonaws.com', 'windows.net', 'cloudapp.azure.com', 'googleusercontent.com', 'fastly.net', 'fastlylb.net', 'cloudflarestorage.com', 'oraclecloud.com', 'linodeobjects.com']

const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * The registrable domain of a host: the part a registry or hosting service handed out, with one
 * label above its suffix. A host under an unknown suffix gets its last two labels (see the note at
 * the top: that errs towards "same site"). IP addresses, single-label hosts and IPv6 are returned whole.
 */
export function siteOfHost(hostname: string): string {
  let host = hostname.toLowerCase()
  if (host.endsWith('.')) host = host.slice(0, -1)
  if (!host || host.startsWith('[') || ipv4.test(host)) return host
  const labels = host.split('.')
  const count = labels.length
  if (count <= 2) return host
  for (const deep of EVERY_HOST_ITS_OWN_SITE) {
    if (host.endsWith(`.${deep}`)) return host
  }
  // "blogspot" before any country ending: blogspot.co.uk, blogspot.com.au, blogspot.de.
  const blog = labels.lastIndexOf('blogspot')
  if (blog > 0 && blog >= count - 3) return labels.slice(blog - 1).join('.')
  // The longest listed suffix wins: three labels ("up.railway.app"), then two.
  if (count >= 4 && SUFFIXES.has(labels.slice(-3).join('.'))) return labels.slice(-4).join('.')
  const top = labels[count - 1] ?? ''
  const second = labels[count - 2] ?? ''
  const lastTwo = `${second}.${top}`
  if (SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.')
  if (top.length === 2 && COUNTRY_SECOND_LEVEL.has(second)) return labels.slice(-3).join('.')
  return lastTwo
}

/** Whether a request to `requestHost` stays on the site of the page at `pageHost` (same registrable domain, or a host under the page's own). */
export function sameSite(requestHost: string, pageHost: string): boolean {
  if (requestHost === pageHost || requestHost.endsWith(`.${pageHost}`)) return true
  return siteOfHost(requestHost) === siteOfHost(pageHost)
}
