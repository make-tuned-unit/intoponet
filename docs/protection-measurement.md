# How Intoponet's ad and tracker list is made

Intoponet blocks ads and trackers with its own matcher and its own list. Nothing in this path comes
from anyone else: no ad blocker's code, no filter list, no hosts file, no tracker database, and not
the Public Suffix List. None is bundled, fetched or consulted, by the app or by the tools below.
This page says where every part comes from, so the claim can be checked.

| Part | Where | How it was produced |
|---|---|---|
| The matcher | `packages/protection-engine/src/engine.ts` | Written for Intoponet. Rules by host in a map; a request is looked up by its host and each domain above it. |
| "Same site" | `packages/protection-engine/src/site.ts` | A table of multi-part suffixes and hosting services, written by hand from general knowledge. Checked against the hosts of the repo's own 3,252 news feeds (no value shared by unrelated publishers turned up that the table should have split). An unknown suffix makes two hosts the same site: it under-blocks, it can not break a page. |
| Authored services | `packages/protection-engine/data/authored-services.json` | Written out by hand from general knowledge of which companies run advertising and tracking services and which hosts they serve from. |
| Never-block list | `packages/protection-engine/data/never-block.json` | Written by hand: hosted libraries, fonts, consent dialogs, payments, captchas, sign-in, players, maps, podcast audio. Also exceptions in the engine. Hosts the measurement showed to be needed were added. |
| Measured hosts | `scripts/protection-crawl.mjs` → `scripts/protection-classify.mjs` → `data/reviewed.json` | Intoponet's own visits to news pages; rules below; every listed host looked at by a person. |
| The list the app uses | `packages/protection-engine/data/blocklist.json` | Generated from the three files above. Every entry: host or narrowed rule, ad or tracker, service, company, kind, source, evidence. |
| Page-element rules | `src/fixtures.ts`, `data/element-rules.json`, `apps/desktop/src/main/adCollapse.ts` | Hand-written selectors; container names the measurement showed to hold only ads; the empty-slot cleanup. |

## The measurement

`scripts/protection-crawl.mjs` runs the repo's own Electron in a temporary profile that is deleted
afterwards, with blocking off. For each outlet it reads the outlet's feed once, then opens the
outlet's home page and its newest article, a few pages at a time, in hidden windows drawn off
screen. Each page is scrolled for about 15 seconds and closed. It sends the user agent the app
sends. It never signs in, never submits a form and never clicks, so consent dialogs stay unanswered:
a page that waits for consent before loading its ads shows the crawler fewer ad and tracker hosts
than a person who agrees would get.

Outlets come from `apps/desktop/src/main/news/newsFeeds.json` and `internationalFeeds.json`, one
per publisher (`independentPublisherGroupId`), picked by a hash so every run takes the same ones
(`scripts/protection-outlets.mjs`): 60 are held out (at most one per country), the rest are taken
country by country in turns.

For every host of another site it records, per page: the number of requests by kind; status codes;
bytes; 1×1 pictures and empty answers; cookies set (name, lifetime, length and a hash of the value,
never the value) and cookies sent; whether the page's address or a long identifier went along in the
query or the body; which frames asked; what the host put on the page (frames and their sizes,
pictures shown inside and outside ad-like containers, stylesheets, video). And the page's ad-like
containers: their names, and whether they held anything but ads.

**The run the current list is built from (2026-11-17, from one Mac in North America):** 520 outlets were
visited; 504 publishers gave at least one usable page (the others showed an error page or a bot
check), 970 pages in all, from 220 countries and in 66 languages.

The raw records are not in git (about 20 MB). The crawler, the rules, `reviewed.json` and the
evidence on each entry are.

## The classification rules

A "publisher" is one `independentPublisherGroupId`; sister outlets count once.

0. **Never.** A host on the never-block list, or under one, is not listed. A domain on the
   "handWrittenOnly" list (google.com, facebook.com, yahoo.com, …: they serve both what pages need and
   tracking) is only touched by a hand-written rule, for one host under it or narrowed to a path. A
   host under a shared hosting or content-network suffix is never proposed.
1. **Functional.** A host that gave pages stylesheets, fonts, audio or video, or pictures shown
   outside ad containers, at 10% or more of the publishers that used it (and at least one) is
   functional. It is not proposed; if it is authored, the classifier flags it for a look.
2. **Tracker signals**, per publisher: *id-cookie* (it set a cookie lasting 30 days or more with a
   value of 8+ characters); *same-id* (the same cookie value was sent to it from pages of two or more
   publishers); *page* (the page's address went to it); *id-query* (a long identifier went to it);
   *beacon* (most of its answers were 1×1 pictures or empty, or it only got pings and posts).
   Proposed as a tracker: seen at 3+ publishers, not functional, and same-id with any other signal,
   or id-cookie with page or id-query at half the publishers, or beacon with page at half.
3. **Ad signals**: *ad-frame* (a frame from it had a standard ad size); *from-ads* (half or more of
   its requests were made inside frames of hosts already known as ad hosts); *ad-picture* (its
   pictures were only shown inside ad containers). Proposed as an ad host: seen at 3+ publishers,
   not functional, with an ad signal at a third of them or from-ads. An ad signal wins.
4. A proposal is for the whole registrable domain when no host under it is functional, else for
   the host.
5. **Review.** Nothing proposed is listed until a person has looked at what it did (its request
   paths, cookies, the frames that asked) and written a decision in `data/reviewed.json`: the
   service, yes or no, and why. A host seen at fewer than 3 publishers is listed only this way,
   when the reviewer can say what the service is.
6. Every entry carries its evidence: at how many measured publishers it was seen, and which signals
   it showed at how many.

Page-element rules: a container name is hidden always only if it held nothing but ads at every
publisher where it was seen, at 5 or more publishers; it is treated as an ad slot (hidden once only
an ad label is left in it) if it held only ads at 80% of 3 or more and an ad was seen in it. Both need a person's yes in
`reviewed.json`; the classifier refuses a name that does not meet its bar.

## The list as of 2026-11-17

920 rules for 918 hosts. They belong to 584 named services, 440 of them written out by hand; the
count includes 26 hosts whose company could not be named, and the company names on measured hosts
are the reviewer's recollection of who runs the host, not something the measurement shows:

| Source | Rules | Ad | Tracker |
|---|---|---|---|
| authored (from knowledge, not seen in the measurement) | 436 | 226 | 210 |
| authored, measured (from knowledge, and seen at work) | 279 | 167 | 112 |
| authored after hold-out (services the author knows, added because the hold-out check showed them missing; 18 of the 34 were also seen in the build measurement) | 34 | 15 | 19 |
| measured (proposed by the rules, accepted on review) | 133 | 107 | 26 |
| measured, listed on review (seen, below the rules' thresholds or under a portal's domain) | 38 | 27 | 11 |
| **all** | **920** | **542** | **378** |

66 rules are narrowed to a path (the list file has no way to narrow a rule to a kind of request yet, though the matcher can). For 26 of the measured rules the company behind the host could not
be named (`"company": "unidentified"`); they are listed for what they did (cookie matching between
ad exchanges, mostly) and each says so. The reviewer refused 20 proposals: advertisers' own sites,
shared hosting, a hosted animation library, two portals and a government agency (only their ad or
measurement hosts are listed), a booking widget, video players' own reports, and hosts whose
purpose could not be established. The never-block list has 173 hosts and 73 domains that only a
hand-written rule may touch.

The hosts seen at the most publishers (of 504): googletagmanager.com 408, doubleclick.net 372,
googlesyndication.com 278, adtrafficquality.google 258, google-analytics.com 248,
cloudflareinsights.com 173, 2mdn.net 139, criteo.com 113, mediago.io 91, admaster.cc 89,
id5-sync.com 85.

Page elements: no measured name met the bar for "always hidden" (the closest, ids starting
`gpt_unit_/`, held only ads at 30 of 31 publishers). 7 names were accepted as ad slots that are
hidden once empty: each held only ads at 80% or more of the publishers where it was seen and had an
ad in it at one at least. Refused: `.banner_logo` (a site's logo); `.text-ad`, `.text_ad`,
`.pub_300x250` and `.afs_ads` (the empty decoys pages use to detect a blocker); and eight names
only ever seen empty, which may be decoys too.

Known gaps, by design or for now: a site's own ads and measurement (same site: never blocked);
video ads served through Google's player SDK (`imasdk.googleapis.com` is on the never-block list
because players wait for it; a CNN video page still played an ad before the clip); push-notification
services; a shop's cookie-matching pixel on its own domain (`www.temu.com/api/adx/cm/`); anything
only served after a consent dialog is answered.

## The hold-out check

60 outlets (one per country at most) are never used to build the list. On 2026-11-17, with the
list frozen (commit `35eef6f`, 886 rules), `scripts/protection-crawl.mjs` visited their home page
and newest article twice, with blocking off and with `--protect` (the engine deciding as it does
in the app), each outlet with a cookie jar of its own. 54 outlets gave a usable page in both runs.
The numbers (`docs/data/protection-holdout.json`; the verdict on every host is in
`docs/data/protection-holdout-judgement.json`):

| | Blocking off | Blocking on |
|---|---|---|
| Hosts of other sites reached, added up over the 54 outlets | 3,395 | 701 |
| Cookies from other sites left behind, added up | 3,590 | 144 |
| Other sites that left a cookie, added up | 1,378 | 64 |

With blocking on, pages still reached 425 different hosts of other sites. Reading what each asked
for, the reviewer judged 275 not to be ad or tracker hosts (fonts, libraries, players and their own
reports, embeds, consent dialogs, comments, push-notification services, publishers' own other
domains, widgets), 125 to be ad or tracker hosts the list missed, and 25 could not be established
and are counted as missed.

**The miss rate: 28.5%.** Counting each ad or tracker host once per outlet it appeared at, the
list stopped 442 and missed 176 (176 ÷ 618). By requests it is 840 missed to 1,538 stopped (35.3%),
which is harsh on the list: a stopped script never makes the further requests it would have made,
while a missed one makes all of its own. Seen from the other side, 3,395 host appearances fell to
701, of which 176 were ad or tracker hosts.

What was missed, mostly: Google's video ads SDK (`imasdk.googleapis.com`, at 10 outlets, left
alone on purpose because players wait for it); regional and small ad networks and video-ad
players seen at one or two outlets each (Membrana, iZooto, Flipp, AdsWizz, Azerion, Content
Exchange, Linker, 360playvid, Adfinix, Jubna's second domain, Yandex's ad code on yandex.ru);
analytics and data services (Sirdata, mParticle, Zoho PageSense, Azure Application Insights,
DTScout, whos.amung.us, Trafic.ro, Affectv); advertising inside Disqus; and 25 hosts of unclear
purpose.

Caveats that flatter or hurt the number: the crawler answers no consent dialog, so European pages
loaded fewer ad hosts than they would for a person who agrees; one visit per page from one place
on one day; a site's own ads and measurement are not counted as misses, because they are never
blocked; the verdicts are one reviewer's.

Push-notification services were judged not to be ad or tracker hosts. If they are counted as
misses instead (OneSignal at 7 outlets, webpushr, Pushwoosh, PushPushGo: 25 more host appearances),
the miss rate is 31.3% (201 ÷ 643).

After the check, nineteen services and five hosts the author knows, which the hold-out showed
missing, were added to `authored-services.json` (34 rules, marked `authored after hold-out` with the
number of hold-out outlets that reached them; the list went from 886 to 920 rules), and one
never-block entry that hid two cookie-matching hosts was removed. The miss rate above was measured
before that and has not been measured again: these 60 outlets are no longer an untouched test of
the additions, so the next refresh should quote a new run.

## Refreshing the list before a release

The app does not download list updates. Before a release (about 90 minutes, mostly waiting; the
crawler shows no window and takes no focus):

```
npx electron scripts/protection-crawl.mjs --set build --limit 520 --out scratchpad/own-protection/crawl
node scripts/protection-classify.mjs --crawl scratchpad/own-protection/crawl
```

Read `scratchpad/own-protection/crawl/review.json`: for every proposal, look at what the host did
and add a decision to `packages/protection-engine/data/reviewed.json`. Then:

```
node scripts/protection-classify.mjs --crawl scratchpad/own-protection/crawl --write
npm test -w @intoponet/protection-engine
npx electron scripts/protection-crawl.mjs --set holdout --isolate --out scratchpad/own-protection/holdout-off
npx electron scripts/protection-crawl.mjs --set holdout --isolate --protect --out scratchpad/own-protection/holdout-on
node scripts/protection-holdout.mjs --write
```

and update the numbers on this page and wherever they are quoted. While doing any of this, do not
open, fetch or search for any existing blocklist or tracker database: the list's value to Intoponet
is that it is its own.
