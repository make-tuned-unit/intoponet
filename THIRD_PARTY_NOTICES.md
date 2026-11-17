# Third-Party Notices

Intoponet's own source code is proprietary; all rights reserved (see `LICENSE`).
The licence on Intoponet's own code does not cover the third-party software,
models, data and content listed below. Each of them stays under its own licence
or terms, as set out here. Where a licence requires a notice or attribution,
this file provides it. The full text of each licence comes with the component
(its `LICENSE` file, its file header, or the URL given).

Last reviewed: 2026-11-17, against `package-lock.json` and the source tree at that date.

---

## 1. Bundled software

### Electron and Chromium

| Component | Version | Licence | Source |
|---|---|---|---|
| Electron | 45.0.0 | MIT | https://github.com/electron/electron |
| Chromium, Node.js, V8 and their dependencies (shipped inside Electron) | per Electron 45.0.0 | BSD-3-Clause, LGPL-2.1, MPL-2.0, MIT, Apache-2.0 and others | https://www.chromium.org |

Electron's own licence is in `node_modules/electron/dist/LICENSE`. The licences
of Chromium and everything else it bundles are collected in
`node_modules/electron/dist/LICENSES.chromium.html`. **Both files must ship with
every distributed build.** Electron's packaged app includes them by default, so
do not strip them out. Some Chromium components, such as FFmpeg and parts of
Blink/WebKit, are LGPL-2.1. Electron ships them as part of its own binaries,
and Intoponet does not modify them.

### npm packages in the app bundle

These are the production dependencies of `apps/desktop`, plus everything they
pull in. The workspace packages `@intoponet/*` are Intoponet's own proprietary
code; one of them, `@intoponet/protection-engine`, depends on the Ghostery
adblocker library listed below, and the others have no third-party runtime
dependencies. Development-only tools
(TypeScript, Vite, electron-vite, Vitest, `@types/*`) are not distributed and are
not listed. The licences below are the `license` fields from `package-lock.json`
and each package's `package.json`.

| Package | Version | Licence | Source |
|---|---|---|---|
| react | 19.3.1 | MIT | https://github.com/facebook/react |
| react-dom | 19.3.1 | MIT | https://github.com/facebook/react |
| scheduler | 0.28.0 | MIT | https://github.com/facebook/react |
| three | 0.172.0 | MIT | https://github.com/mrdoob/three.js |
| @react-three/fiber | 9.8.2 | MIT | https://github.com/pmndrs/react-three-fiber |
| its-fine | 2.1.1 | MIT | https://github.com/pmndrs/its-fine |
| react-use-measure | 2.1.7 | MIT | https://github.com/pmndrs/react-use-measure |
| suspend-react | 0.1.3 | MIT | https://github.com/pmndrs/suspend-react |
| zustand | 5.0.16 | MIT | https://github.com/pmndrs/zustand |
| motion | 12.43.0 | MIT | https://github.com/motiondivision/motion |
| framer-motion | 12.43.0 | MIT | https://github.com/motiondivision/motion |
| motion-dom | 12.43.0 | MIT | https://github.com/motiondivision/motion |
| motion-utils | 12.39.0 | MIT | https://github.com/motiondivision/motion |
| lucide-react | 0.468.0 | ISC (some icons MIT, from Feather) | https://github.com/lucide-icons/lucide |
| use-sync-external-store | 1.7.0 | MIT | https://github.com/facebook/react |
| @babel/runtime | 7.29.10 | MIT | https://github.com/babel/babel |
| buffer | 6.0.3 | MIT | https://github.com/feross/buffer |
| base64-js | 1.5.1 | MIT | https://github.com/beatgammit/base64-js |
| ieee754 | 1.2.1 | BSD-3-Clause | https://github.com/feross/ieee754 |
| tslib | 2.8.1 | 0BSD | https://github.com/microsoft/tslib |
| @types/react-reconciler, @types/webxr | 0.28.9, 0.5.24 | MIT | type declarations only; nothing reaches the bundle |
| @mozilla/readability (Export as PDF: finds the article) | 0.6.0 | Apache-2.0 | https://github.com/mozilla/readability |
| dompurify (Export as PDF: cleans the article's HTML) | 3.4.17 | MPL-2.0 OR Apache-2.0 (used under Apache-2.0) | https://github.com/cure53/DOMPurify |
| @cantoo/pdf-lib (Export as PDF: title, author and compression) | 2.11.1 | MIT | https://github.com/cantoo-scribe/pdf-lib |
| fflate | 0.8.3 | MIT | https://github.com/101arrowz/fflate |
| jpeg-js (Export as PDF: photos stored as JPEG) | 0.4.4 | BSD-3-Clause | https://github.com/eugeneware/jpeg-js |
| culori | 4.0.2 | MIT | https://github.com/Evercoder/culori |
| node-html-better-parser | 1.5.9 | MIT | https://github.com/Sharcoux/node-html-parser |
| html-entities | 2.6.0 | MIT | https://github.com/mdevils/html-entities |
| @ghostery/adblocker (matches requests and page elements against the filter lists) | 2.20.3 | MPL-2.0 | https://github.com/ghostery/adblocker |
| @ghostery/adblocker-content, @ghostery/adblocker-extended-selectors | 2.20.3 | MPL-2.0 | https://github.com/ghostery/adblocker |
| @ghostery/url-parser | 1.3.1 | MPL-2.0 | https://github.com/ghostery/url-parser |
| @remusao/guess-url-type, @remusao/small, @remusao/trie | 2.1.0 | MPL-2.0 | https://github.com/remusao/mono |
| @remusao/smaz, @remusao/smaz-compress, @remusao/smaz-decompress | 2.2.0 | MPL-2.0 | https://github.com/remusao/mono |
| tldts-experimental, tldts-core (which site a host belongs to; includes the Public Suffix List, MPL-2.0, https://publicsuffix.org) | 7.5.4 | MIT | https://github.com/remusao/tldts |

The Export as PDF packages are listed under `devDependencies` because the build
bundles them into the app's own files (Readability and DOMPurify as scripts run
in the page, pdf-lib in a worker); they are distributed all the same. Readability
and DOMPurify are taken under Apache-2.0, whose licence text must go with the app
(neither package has a NOTICE file). DOMPurify's MPL-2.0 option is not used.

**The Ghostery adblocker library and its `@ghostery/*` and `@remusao/*`
dependencies are MPL-2.0 (file-level copyleft).** The build puts them,
unmodified and with their licence headers kept, in a file of their own beside
the main process's code (`out/main/adblocker-<hash>.js`, together with the
MIT-licensed tldts; see `manualChunks` in `apps/desktop/electron.vite.config.ts`),
not inside Intoponet's own files. What MPL-2.0 requires is the same as for
the vendored file in §2: the copyleft covers those files only, and Intoponet's
own code, which calls them, is a "Larger Work" ("a work that combines Covered
Software with other material, in a separate file or files, that is not Covered
Software", §1.7), which §3.3 allows to be distributed "under terms of Your
choice, provided that You also comply with the requirements of this License for
the Covered Software". The requirement that applies is §3.2(a): the library
"must also be made available in Source Code Form", and recipients told how to
get it. Its source is the published npm packages at the versions above and the
repositories named. If any of these files is ever changed for Intoponet, the
changed file must be published under MPL-2.0. The Public Suffix List inside
tldts is MPL-2.0 data, used unmodified.

No other bundled npm package is copyleft. MIT, ISC and BSD-3-Clause all
require the copyright and permission notice to go with copies of the software.
To meet that, distributed builds must include each package's `LICENSE` file, or
a notices file generated from them (for example with `rollup-plugin-license`, or
by collecting `node_modules/<pkg>/LICENSE`). Bundling and minification strip
these notices, so they have to be added back. Lucide's licence states that
"portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT)".

---

## 2. Vendored code

### bergamot-translator Emscripten glue: MPL-2.0 (file-level copyleft)

- File: `apps/desktop/src/main/translate/vendor/bergamot-translator.js`
- Upstream: Mozilla Firefox, `toolkit/components/translations/bergamot-translator/bergamot-translator.js`,
  generated from https://github.com/mozilla/translations release v0.6.0
  (revision `eea6e5a80aa4ddd86d9cc35ce9a65b79aa3ab96d`). Copied unmodified,
  SHA-256 `faff1ef6285b0d26f01787776fd49299dfb756ecb9688aa990c250e66797b47d`.
- Licence: Mozilla Public License 2.0, https://mozilla.org/MPL/2.0/. The licence
  header is kept in the file:

  > This Source Code Form is subject to the terms of the Mozilla Public License,
  > v. 2.0. If a copy of the MPL was not distributed with this file, You can
  > obtain one at http://mozilla.org/MPL/2.0/.

**What MPL-2.0 requires:** the copyleft applies to the file, not to the whole
app. The vendored file, and any changes ever made to it, stay under MPL-2.0. Its
source code must be available to anyone who receives the app, and the licence
header must stay in place. Intoponet's other files, which only call this glue,
are a "Larger Work" (MPL-2.0 §3.3) and can stay proprietary. To comply:
(a) do not edit the file in place without publishing the modified version under
MPL-2.0; (b) when distributing, say where its source can be obtained (the
upstream URL above while the file is unmodified, or a published copy of the
modified file); (c) keep this notice.

No other third-party code is vendored into the source tree. A search for
`vendor`, `LICENSE`, `Copyright` and `SPDX` found no other copied files.

---

## 3. Models (downloaded on demand, not bundled)

### Firefox Translations models and the bergamot-translator WebAssembly engine

- What: `bergamot-translator.wasm` (engine 3.0, about 5 MB), plus per-language
  translation models, lexical shortlists and vocabularies. They are listed and
  pinned by SHA-256 in `apps/desktop/src/main/translate/catalog.json`.
- Where from: Mozilla Firefox Remote Settings (`main/translations-models`,
  `main/translations-wasm`), downloaded from https://firefox-settings-attachments.cdn.mozilla.net/
  when the user first uses a language.
- Licence: MPL-2.0 (https://mozilla.org/MPL/2.0/), as recorded in the catalogue.
  Models: https://github.com/mozilla/translations and
  https://github.com/mozilla/firefox-translations-models. Engine source:
  https://github.com/browsermt/bergamot-translator (MPL-2.0). The engine is
  compiled together with Marian NMT (MIT), intgemm (MIT), SentencePiece
  (Apache-2.0) and other libraries; their notices are in the upstream
  repositories.
- Attribution shown in the app: "Translation models by Mozilla (Firefox
  Translations, MPL-2.0)."
- Obligation: these are unmodified MPL-2.0 files fetched from Mozilla's own
  servers, so their source is already available upstream. If Intoponet ever
  mirrors or bundles them, it must keep their source available, as above.

### Laya embedding model: sentence-transformers/all-MiniLM-L6-v2

- Where from: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2,
  pinned to revision `1110a243fdf4706b3f48f1d95db1a4f5529b4d41` (`model.safetensors`,
  `vocab.txt`) and checked by SHA-256 in `apps/desktop/src/main/laya/model.ts`.
  It downloads only after the user turns Laya on.
- Licence: Apache-2.0 (https://www.apache.org/licenses/LICENSE-2.0).
  Copyright the sentence-transformers authors. `vocab.txt` comes from Google's
  BERT (Apache-2.0).
- Obligation: if the model is ever redistributed (mirrored or bundled), include
  the Apache-2.0 licence text and any upstream NOTICE file. Intoponet runs the
  model with its own code (`laya/bert.ts`), so no third-party inference runtime
  is shipped.

---

## 4. Data and content sources

### Bundled data

| Data | Where | Licence | Required attribution |
|---|---|---|---|
| GeoNames place directory (countries, admin-1 regions, cities with population ≥ 250,000 and capitals, taken from `cities15000`, `countryInfo` and `admin1CodesASCII`) | `apps/desktop/src/shared/places/placeData.ts`, generated by `packages/place-catalog/scripts/` | CC BY 4.0, https://creativecommons.org/licenses/by/4.0/ | "Place data © GeoNames (https://www.geonames.org/), CC BY 4.0." GeoNames provides the data "as is", without warranty. The aliases (such as "NYC") are Intoponet's additions. |
| Country names in the languages of the news feeds (Unicode CLDR 48 region names, read through `Intl.DisplayNames`) | `apps/desktop/src/shared/places/countryNameData.ts`, generated by `scripts/build-country-names.mjs` | Unicode License v3, https://www.unicode.org/license.txt | "Copyright © 1991-2026 Unicode, Inc. All rights reserved." Distributed under the Unicode License v3. |
| EasyList and EasyPrivacy: the filter lists that say which requests are ads and trackers and which page elements are ads. Copied exactly as published; the versions and the date fetched are in `manifest.json`. | `packages/protection-engine/lists/easylist.txt`, `easyprivacy.txt`, with `manifest.json` (source address, date, SHA-256) and `NOTICE.txt`; fetched by `scripts/update-protection-lists.mjs`, never edited. Shipped in the app as separate data files in `out/main/protection/`, beside `engine.bin`, the same rules compiled for the blocker when the app is built (`apps/desktop/protectionListsPlugin.ts`). | CC BY-SA 3.0 Unported or later, https://creativecommons.org/licenses/by-sa/3.0/ (the authors offer GPL-3.0-or-later or CC BY-SA 3.0-or-later, https://easylist.to/pages/licence.html; Intoponet takes CC BY-SA) | "EasyList and EasyPrivacy by The EasyList authors (https://easylist.to/), CC BY-SA 3.0." See "Filter lists" below. |
| Curated news feed directory (3,221 local and 31 international RSS/Atom feed URLs and publisher names) | `apps/desktop/src/main/news/newsFeeds.json`, `internationalFeeds.json`; evidence in `docs/data/` | Intoponet's own compilation. Each feed belongs to its publisher. | See "News feeds" below. |

**Filter lists.** The authors' licence statement, read 2026-11-17 at
https://easylist.to/pages/licence.html (the address each list's header gives as
its licence):

> Unless otherwise noted, the contents of the EasyList repository (https://github.com/easylist) is dual licensed under the GNU General Public License version 3 of the License, or (at your option) any later version, and Creative Commons Attribution-ShareAlike 3.0 Unported, or (at your option) any later version. You may use and/or modify the files as permitted by either licence; if required, "The EasyList authors (https://easylist.to/)" should be attributed as the source of the material. All relevant licence files are included in the repository.

Intoponet uses the lists under CC BY-SA 3.0 Unported (or later), not under the
GPL. What that licence requires, and how it is met:

- *Attribution, and the licence's address with every copy* (§4(a), §4(c)): the
  list files keep their headers; `NOTICE.txt` ships beside them; the app shows
  the credit under Settings › Credits and licences; this file.
- *Share-alike for adaptations* (§4(b)): `engine.bin` is an adaptation of the
  lists (their rules, compiled; rules of kinds the blocker does not use are left
  out). It is offered under the same licence, and `NOTICE.txt` says so and says
  what was changed (§3(b)).
- *The app itself is not an adaptation.* The lists are separate data files that
  the app reads. A work "in which the Work is included in its entirety in
  unmodified form along with one or more other contributions, each constituting
  separate and independent works in themselves" is a Collection (§1(b)), "a
  work that constitutes a Collection will not be considered an Adaptation", and
  the licence "does not require the Collection apart from the Work itself to be
  made subject to the terms of this License" (§4(a)). None of the lists' text
  is in Intoponet's code: the build copies the files and never inlines them.
  Keep it that way. (This is the project's own reading of the licence text at
  https://creativecommons.org/licenses/by-sa/3.0/legalcode, the usual one for
  browsers that ship these lists; it has not been reviewed by a lawyer.)
- *No added restrictions* (§4(a)): the list files and `engine.bin` in the app
  bundle may be copied out and reused by anyone under CC BY-SA.

The lists are refreshed by running `node scripts/update-protection-lists.mjs`
(which stops if the licence page no longer states these terms) and committing
the result; their header asks for a refresh every 4 days, so run it before each
release. `--check` verifies the files against the manifest, as does a unit test.

Lists considered and not used, because their terms do not allow shipping them
in this app:

- Peter Lowe's ad and tracking server list (https://pgl.yoyo.org/adservers/):
  the list states no licence of its own, and the site's licence
  (https://pgl.yoyo.org/license/, "McRae General Public License") says "it is
  strictly forbidden to redistribute or use the work in any manner that could
  possibly be construed as making anybody any money".
- DuckDuckGo Tracker Radar (https://github.com/duckduckgo/tracker-radar):
  "licensed under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0
  International License"; commercial use needs a separate licence from
  DuckDuckGo.
- uBlock Origin's lists (https://github.com/uBlockOrigin/uAssets) and AdGuard's
  (https://github.com/AdguardTeam/AdguardFilters) are under the GNU General
  Public License version 3 (the `LICENSE` file of each repository, read
  2026-11-17), with no Creative Commons option. They, and uBlock Origin's
  scriptlet and redirect resources (GPL version 3, https://github.com/gorhill/uBlock),
  are not used.

### Fetched live at runtime (shown with links, not redistributed)

| Source | Used for | Licence / terms | Attribution |
|---|---|---|---|
| Wikidata (`www.wikidata.org/w/api.php`, `query.wikidata.org/sparql`) | The Olds: entities, labels, descriptions, relations | CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/ | Not required. The app links each statement back to Wikidata. |
| English Wikipedia (Action API extracts and geosearch, REST `feed/featured`) | The Olds history summaries, World Stories ("In the news"), field article titles and thumbnails | Text CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/. Images carry their own licences on Wikimedia Commons. | Required: credit "Wikipedia contributors", link to the article, name CC BY-SA 4.0, and say whether the text was changed (excerpts and lead sentences count as changes). Share-alike applies only to the displayed or adapted text, not to the app. |
| Wikimedia Analytics pageviews (`wikimedia.org/api/rest_v1/metrics/pageviews/…`) | Reading-attention field | CC0 1.0 (Analytics API access policy) | Not required. The app credits "Wikimedia pageviews". |
| USGS Earthquake Hazards, ComCat GeoJSON M4.5+ past week (`earthquake.usgs.gov`) | Earthquake layer | U.S. Government work, public domain; https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits | Credit "U.S. Geological Survey" and link each event (requested, not required). |
| NASA EONET v3 (`eonet.gsfc.nasa.gov`) | Natural-events layer | U.S. Government work, public domain; https://eonet.gsfc.nasa.gov/docs/v3 | Credit "NASA EONET". Events link to their originating agencies (e.g. JTWC/`metoc.navy.mil`, NOAA NHC, IRWIN), whose own terms apply to their linked files. |
| NASA Worldview (`worldview.earthdata.nasa.gov`) | Outbound "Satellite view" link only | NASA terms | Link only. Nothing is fetched. |
| Internet Archive Wayback Machine (`web.archive.org` CDX index and archived copies of an outlet's topic pages) | The Olds: an outlet's earlier headlines on a story | Internet Archive Terms of Use, https://archive.org/about/terms.php. The archived pages remain their publishers'. | The app says "Snapshots from the Internet Archive’s Wayback Machine" and links each headline to its archived copy. |
| News publishers' RSS/Atom feeds | Headlines (titles, links, dates) | Each publisher's own terms. **Not open-licensed.** | See below. |

**News feeds.** Headlines and all other feed content remain the property of their
publishers. Intoponet shows each item's title, publisher, date and a link to the
original article; it does not republish article bodies. Some publishers set
limits that apply to a commercial product. `docs/architecture/NEWS_SOCIAL_FEEDS.md`
records, for example, that Guardian RSS is for personal non-commercial use and
that BBC terms require a licence for business use. Sources under the UK Open
Government Licence v3.0 must carry the text "Contains public sector information
licensed under the Open Government Licence v3.0", with the publisher named. Each
publisher's terms need checking before release, following the governance in
`docs/architecture/ADR-005-public-source-governance.md` and
`docs/data/public-source-registry.json`.

---

## 5. Images and fonts

| Asset | Source | Licence | Attribution |
|---|---|---|---|
| `apps/desktop/src/renderer/assets/earth-night.jpg` (4096×2048) | NASA Earth Observatory, Black Marble 2016 (Night Lights), https://earthobservatory.nasa.gov/features/NightLights | Public domain (NASA) | "NASA Earth Observatory / Black Marble" (requested, not required) |
| `apps/desktop/src/renderer/assets/earth-day.jpg` (4096×2048) | The source comment says "NASA Blue Marble". **The exact file and its origin are not recorded. Check before release.** If it is NASA Visible Earth Blue Marble (https://visibleearth.nasa.gov/collection/1484/blue-marble), it is public domain. If it came from a third-party remix (for example a texture pack), that source's licence applies instead. | Licence not determined; check before release | "NASA Visible Earth / Blue Marble", if confirmed |
| Icons | lucide-react (see §1) | ISC / MIT | Covered by §1 |
| Fonts | Inter (variable, optical size), by Rasmus Andersson and The Inter Project Authors, https://github.com/rsms/inter. Bundled in the app via `@fontsource-variable/inter` 5.3.0 and self-hosted on the website (`website/fonts/`, with `Inter-LICENSE.txt`). Nothing is loaded from web font services. | SIL Open Font License 1.1 | Copyright notice and licence shipped alongside the font files |
| Brand assets | `apps/desktop/src/renderer/src/brand/`, `apps/desktop/resources/Intoponet.icns`, `website/brand/`, the website icons and Open Graph image: Intoponet Cinematic Brand Kit v3 (October 2026), made for this project. | Owned by the project (not third-party). Not yet trademark-cleared. | None |

---

## Open items before a public release

1. Ship `LICENSE` and `LICENSES.chromium.html` from Electron, and the npm licence
   notices, with every build (§1).
2. Keep the MPL-2.0 vendored glue unmodified, or publish any change to it (§2).
3. Confirm where `earth-day.jpg` came from and what licence it has (§5).
4. Done: the CC BY-SA 4.0 attribution for Wikipedia text, the CC BY 4.0
   attribution for GeoNames and the CC BY-SA 3.0 attribution for EasyList and
   EasyPrivacy are shown in the app under Settings › Credits and licences (§4).
5. Clear each news publisher's terms for commercial display (§4).

## Natural Earth (country shapes)

`apps/desktop/src/shared/places/countryShapes.ts` is derived from Natural Earth 1:50m Admin 0 – Countries
(https://www.naturalearthdata.com/), which is in the public domain. Simplified and re-encoded by
`packages/place-catalog/scripts/build-country-shapes.mjs`. Made with Natural Earth.

## Wikipedia test fixture

`apps/desktop/src/main/olds/__fixtures__/current-events-2026-10-27.wikitext` is the wikitext of
"Portal:Current events/2026 October 27" from English Wikipedia (https://en.wikipedia.org/wiki/Portal:Current_events/2026_October_27),
by Wikipedia contributors, licensed CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). Used unmodified as test data.
