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

MEASUREMENT_NUMBERS

The raw records are not in git (about RAW_SIZE). The crawler, the rules, `reviewed.json` and the
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
an ad label is left in it) if it held only ads at 80% of 3 or more. Both need a person's yes in
`reviewed.json`; the classifier refuses a name that does not meet its bar.

LIST_NUMBERS

## The hold-out check

HOLDOUT_NUMBERS

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
