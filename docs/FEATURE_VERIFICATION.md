# Feature verification

Run 2026-11-06 02:35 UTC · tier `network` · only PDF_EXPORT · **1 passed, 0 failed, 0 blocked, 0 skipped, 36 assumed**.

Each feature makes a promise to the user; its check drives the built app end to end. Defined in `docs/FEATURE_DAG.json`, checks in `experiments/e2e/checks.mjs`, run with `npm run verify:features`.

| | Feature | Promise | Depends on | Result |
| --- | --- | --- | --- | --- |
| · | **Typecheck, unit tests and production build** (`BUILD`) | The app is built from code that typechecks and passes every unit test. | — | assumed |
| · | **App starts** (`APP_BOOT`) | Intoponet opens to the globe with Private, Bookmarks, The Olds, Knowledge, My map and Settings in the header. | BUILD | assumed |
| · | **Settings and Privacy** (`SETTINGS`) | Settings covers language, automatic translation, beacons, credits and privacy; Privacy covers private browsing, footprints, sites to leave out, pins and backups. | APP_BOOT | assumed |
| · | **Accessible and keyboard friendly** (`ACCESSIBILITY`) | No WCAG 2.2 AA violations (axe); every header panel opens with Enter, closes with Escape and returns focus to its button. | APP_BOOT | assumed |
| · | **Modern tabs** (`TABS`) | Tabs show a spinner while loading and a speaker that mutes a playing tab; they reorder by drag or keyboard, pin first as icons (kept for next launch), and stay accessible. | APP_BOOT | assumed |
| · | **Encrypted private library, pins and beacon consent** (`LIBRARY`) | Saved pages live only in the encrypted library (old plain copies migrate without loss); pins can be hidden; publishing a pin as a beacon needs explicit agreement. | APP_BOOT | assumed |
| · | **Collections explained and split; tags** (`COLLECTIONS_IMPORT`) | A collection explains what it holds (sites, topics, places) and can be split by site; pins carry several tags. | LIBRARY | assumed |
| · | **Fly to a place** (`FLY_TO`) | Typing a place (even "Charlottetown PEI" or "Fredericto") and pressing Enter spins the globe there, closes any open page and marks the exact spot. | APP_BOOT | assumed |
| · | **Globe stays where you put it** (`GLOBE_MOTION`) | Zooming after moving the globe keeps the place in view; it never swings back. | FLY_TO | assumed |
| · | **Every country named and clickable** (`COUNTRY_NAMES`) | Country names fade in by zoom without overlapping; the country you spin or zoom to is always named, tiny ones included (Vatican, Nauru, Tuvalu); clicking any country, with or without news, opens it. | FLY_TO | assumed |
| · | **Live public globe** (`GLOBE_LIVE`) | The globe shows live public signals (local news, reading, hazards) with World, Peaks, Rising and Fading highlights. | APP_BOOT | assumed |
| · | **Sources carousel** (`SOURCE_CAROUSEL`) | A world story with several sources opens a carousel of every outlet's headline to flip through; choosing one grows its card into the browser with that article open. | GLOBE_LIVE | assumed |
| · | **Stories covered across the world** (`WORLD_STORIES`) | The World tab lists stories covered by outlets in many countries, and the whole list can be scrolled. | GLOBE_LIVE | assumed |
| · | **A country's news and bigger picture** (`COUNTRY_PANEL`) | Opening a country shows key facts, genuinely recent history and its local headlines, without clipping. | GLOBE_LIVE, FLY_TO | assumed |
| · | **The history behind a headline** (`OLDS_HEADLINE`) | A headline opens the right topic with a dated, ordered chronology quoted from Wikipedia and relevant topics from the right country; broad matches give way to the actual event; no junk for unmatched headlines. | APP_BOOT | assumed |
| · | **A country's history** (`OLDS_COUNTRY`) | A country's history has key facts, chapters and events from the last ten years. | APP_BOOT | assumed |
| · | **Competing interpretations** (`OLDS_DEBATE`) | Where Wikipedia attributes competing views, The Olds shows them side by side with who holds each. | APP_BOOT | assumed |
| · | **The Olds panel from a headline** (`OLDS_UI`) | A headline's history button opens The Olds with Story and Timeline views, no clipped timeline cards, and Escape closes it. | COUNTRY_PANEL, OLDS_HEADLINE | assumed |
| · | **Browse the web** (`BROWSE`) | Pages open in tabs with a named toolbar (Translate, Capture, Pin, Absorb, Bookmarks), and closing tabs never crashes the app. | APP_BOOT | assumed |
| · | **Address bar suggestions** (`OMNIBOX`) | Typing the start of a visited site's host completes it inline (Backspace removes the completion) and offers that page first, from history or as "Switch to tab"; Enter lands on it without a duplicate tab, ⌘↵ opens it in a background tab, and a typed place name still flies the globe. | BROWSE | assumed |
| · | **Ad and tracker protection** (`PROTECTION`) | Ads and trackers are blocked and the protection bar under the toolbar shows what was blocked. | BROWSE | assumed |
| · | **Site permissions and sign-in popups** (`PERMISSIONS`) | Sites ask for camera, microphone or location in a bar you answer; sign-in popups keep working; new-tab links open as tabs. | BROWSE | assumed |
| · | **Links to other apps** (`EXTERNAL_APPS`) | A mailto:, tel: or zoommtg: link asks "Open <app>?" (Open / Cancel, Always allow per site) and never navigates the tab; files and scripts are never handed to other apps. | APP_BOOT | assumed |
| · | **Error page with Retry** (`ERROR_PAGE`) | A page that cannot load shows a clear error page in the tab (offline, can't find, too slow, not secure with certificate details) with Retry and Back; the address stays in the toolbar. | APP_BOOT | assumed |
| · | **PDFs open in the tab** (`PDF_VIEWER`) | PDF links open in Chromium's viewer in the tab; PDFs sent as attachments still download. | APP_BOOT | assumed |
| · | **Light and dark pages** (`PAGE_APPEARANCE`) | Pages follow the Mac's light or dark appearance by default, or Light/Dark chosen in Settings, which also shows the default-browser status. | APP_BOOT | assumed |
| · | **Private browsing** (`PRIVATE_BROWSING`) | Private tabs are marked, leave no footprints, and close with their session when private browsing ends. | BROWSE | assumed |
| · | **Saved passwords** (`SAVED_PASSWORDS`) | After you sign in, Intoponet offers to save the password, keeps it sealed on this Mac, fills it next time (or asks which account), lists it in Settings, and never saves or fills in a private tab. | SETTINGS | assumed |
| · | **Sites to leave out** (`EXCLUDED_SITES`) | Sites you leave out are never absorbed and leave no recent pages. | BROWSE | assumed |
| · | **Downloads and History** (`DOWNLOADS_HISTORY`) | A download shows its progress in the toolbar’s Downloads list until it is done, lands on disk with the macOS quarantine flag, and can be opened or shown in Finder; pages visited in normal tabs appear in History (never private ones), can be searched and deleted. | BROWSE | assumed |
| · | **Screenshots into folders** (`CAPTURE`) | A screenshot of the page is saved, and you can make a new folder while saving. | BROWSE | assumed |
| ✅ | **Save page as PDF** (`PDF_EXPORT`) | One click saves the page as a tagged PDF in Downloads, formatted for reading with its source on page one and page numbers, with ads, hidden text and overlays left out, lazy images loaded, an outline of its headings, a Finder "Where from", and, when a bookmark group is chosen, a bookmark in that group linked to the PDF. Pages that are not articles are saved as seen, still without ads. | SETTINGS | pass · 24 s — Article: 5 pages, 2 images, tagged with outline, ads/hidden/overlay text left out, bookmarked in "Reading" with the PDF linked; shop page saved as seen without ads; private tab asked where, neutral name, no Where-from or bookmark; 2 PDFs in Bookmarks › PDFs (private one not listed), removing one keeps the file. |
| · | **Paywall detection** (`PAYWALL_ALTERNATIVES`) | Paywalled outlets are recognised so free coverage of the same story can be offered (never circumvented). | BROWSE, GLOBE_LIVE | assumed |
| · | **Absorb, search and claims** (`ABSORB`) | Absorbing a page (or just a selection) keeps it on this Mac; search returns the cited paragraph; claims are listed without false disputes. | BROWSE | assumed |
| · | **Beacon registry on Neon** (`BEACONS_REGISTRY`) | The app reaches the live beacon registry, which is healthy and refuses unsigned requests. | LIBRARY | assumed |
| · | **Automatic page translation** (`AUTO_TRANSLATE`) | With automatic translation on, a Russian page is detected and translated into your language on this Mac. | SETTINGS, BROWSE | assumed |
| · | **Languages without a model** (`ROUGH_TRANSLATE`) | Faroese headlines translate roughly through Icelandic and say so. | COUNTRY_PANEL | assumed |
