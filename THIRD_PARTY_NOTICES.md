# Third-Party Notices

Intoponet's own source code is proprietary; all rights reserved (see `LICENSE`).
The licence on Intoponet's own code does not cover the third-party software,
models, data and content listed below. Each of them stays under its own licence
or terms, as set out here. Where a licence requires a notice or attribution,
this file provides it. The full text of each licence comes with the component
(its `LICENSE` file, its file header, or the URL given).

Last reviewed: 2026-10-27, against `package-lock.json` and the source tree at that date.

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
code and have no third-party runtime dependencies. Development-only tools
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

None of the bundled npm packages is copyleft. MIT, ISC and BSD-3-Clause all
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
| Curated news feed directory (451 local and 31 international RSS/Atom feed URLs and publisher names) | `apps/desktop/src/main/news/newsFeeds.json`, `internationalFeeds.json`; evidence in `docs/data/` | Intoponet's own compilation. Each feed belongs to its publisher. | See "News feeds" below. |

### Fetched live at runtime (shown with links, not redistributed)

| Source | Used for | Licence / terms | Attribution |
|---|---|---|---|
| Wikidata (`www.wikidata.org/w/api.php`, `query.wikidata.org/sparql`) | The Olds: entities, labels, descriptions, relations | CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/ | Not required. The app links each statement back to Wikidata. |
| English Wikipedia (Action API extracts and geosearch, REST `feed/featured`) | The Olds history summaries, World Stories ("In the news"), field article titles and thumbnails | Text CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/. Images carry their own licences on Wikimedia Commons. | Required: credit "Wikipedia contributors", link to the article, name CC BY-SA 4.0, and say whether the text was changed (excerpts and lead sentences count as changes). Share-alike applies only to the displayed or adapted text, not to the app. |
| Wikimedia Analytics pageviews (`wikimedia.org/api/rest_v1/metrics/pageviews/…`) | Reading-attention field | CC0 1.0 (Analytics API access policy) | Not required. The app credits "Wikimedia pageviews". |
| USGS Earthquake Hazards, ComCat GeoJSON M4.5+ past week (`earthquake.usgs.gov`) | Earthquake layer | U.S. Government work, public domain; https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits | Credit "U.S. Geological Survey" and link each event (requested, not required). |
| NASA EONET v3 (`eonet.gsfc.nasa.gov`) | Natural-events layer | U.S. Government work, public domain; https://eonet.gsfc.nasa.gov/docs/v3 | Credit "NASA EONET". Events link to their originating agencies (e.g. JTWC/`metoc.navy.mil`, NOAA NHC, IRWIN), whose own terms apply to their linked files. |
| NASA Worldview (`worldview.earthdata.nasa.gov`) | Outbound "Satellite view" link only | NASA terms | Link only. Nothing is fetched. |
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
4. Show the CC BY-SA 4.0 attribution for Wikipedia text and the CC BY 4.0
   attribution for GeoNames somewhere in the app, such as an About or Credits
   screen (§4).
5. Clear each news publisher's terms for commercial display (§4).

## Natural Earth (country shapes)

`apps/desktop/src/shared/places/countryShapes.ts` is derived from Natural Earth 1:50m Admin 0 – Countries
(https://www.naturalearthdata.com/), which is in the public domain. Simplified and re-encoded by
`packages/place-catalog/scripts/build-country-shapes.mjs`. Made with Natural Earth.

## Wikipedia test fixture

`apps/desktop/src/main/olds/__fixtures__/current-events-2026-10-27.wikitext` is the wikitext of
"Portal:Current events/2026 October 27" from English Wikipedia (https://en.wikipedia.org/wiki/Portal:Current_events/2026_October_27),
by Wikipedia contributors, licensed CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). Used unmodified as test data.
