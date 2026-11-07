/**
 * The guided tour: what each step shows, where the spotlight goes, and what
 * the app does to show it. Steps drive the real interface through TourControls,
 * and the tour leaves the user's data alone (nothing is saved, shared or
 * absorbed); everything it opens is closed again at the end.
 */

export type TourControls = {
  /** Back to the whole Earth, every panel closed. */
  reset(): void
  /** Turn the globe slowly by this many degrees. */
  spin(degrees: number, ms: number): Promise<void>
  /** Fly to a place by name, typing it into the search first so you see how. */
  flyTo(name: string): Promise<boolean>
  /** Fly to the tallest story mountain and pin its coverage; false when no news has loaded. */
  findHighestPeak(): Promise<boolean>
  /** Unpin a story mountain. */
  closeStory(): void
  /** Type into the address bar a letter at a time (without going anywhere), or clear it with ''. */
  typeInAddressBar(text: string): Promise<void>
  /** Show the globe's list: World stories, Peaks… */
  showList(view: 'world' | 'top' | 'rising'): void
  /** Open the most widely covered story in the World list; its headline, if any. */
  openWorldStory(): Promise<string | null>
  /** Look up a headline's history ahead of time (so its step opens at once). */
  prepareOlds(headline: string): void
  /** Open The Olds for a headline; resolves when its story is showing. */
  openOlds(headline: string): Promise<void>
  closeOlds(): void
  showBookmarks(open: boolean): void
  showMyMap(open: boolean): void
  /** Open a web page, and keep it out of the way while the tour talks. */
  openPage(url: string): Promise<void>
  hidePage(hidden: boolean): void
  showKnowledge(open: boolean): void
  /** Put everything back as it was. */
  finish(): void
}

export type TourStep = {
  id: string
  chapter: string
  title: string
  body: string
  /** What to spotlight (CSS selector); none for a centred card. */
  target?: string
  /** How long the step stays when playing. */
  seconds?: number
  run?: (controls: TourControls, context: TourContext) => Promise<void> | void
}

/** Things learned during the tour (the story it opened), for later steps. */
export type TourContext = { headline: string | null }

const PAGE = 'https://en.wikipedia.org/wiki/Earth'

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    chapter: 'Welcome',
    title: 'A browser with the whole world in view',
    body: 'Intoponet starts from Earth, not a blank tab. What people are reading, reporting and living through shows up where it happens, and every page you open keeps its place on the map.',
    seconds: 9,
    run: async (controls) => {
      controls.reset()
      await controls.spin(70, 6_000)
    },
  },
  {
    id: 'signals',
    chapter: 'The living globe',
    title: 'Frequencies are signals from real places',
    body: 'Each ripple is public activity: local news from 450 outlets, what Wikipedia readers are opening, earthquakes and storms. Brighter and wider means more. Hover to preview, click to explore.',
    target: '.globe-panel',
    seconds: 9,
    run: (controls) => controls.showList('top'),
  },
  {
    id: 'peaks',
    chapter: 'Story mountains',
    title: 'The news rises as mountains',
    body: 'Every story outlets are covering becomes terrain: the more independent outlets carry it, the higher it stands, with a gold crest on top. Peaks rise and wear down as the news ebbs and flows. Spin the globe to find the highest, or press H.',
    target: '.story-highest',
    seconds: 10,
    run: async (controls) => {
      controls.reset()
      await controls.spin(40, 3_500)
    },
  },
  {
    id: 'strands',
    chapter: 'Story mountains',
    title: 'Follow a story around the world',
    body: 'Hover a summit and strands run over the Earth to every country that covered it. Click to pin it: each country’s first headline, in the order coverage appeared. Height counts outlets, not importance.',
    target: '.story-panel',
    seconds: 11,
    run: async (controls) => { await controls.findHighestPeak() },
  },
  {
    id: 'fly',
    chapter: 'The living globe',
    title: 'Fly anywhere by name',
    body: 'Type a city, region or country into the search — even misspelled — and the globe turns to it and marks the exact spot. Every country is named as you reach it, and you can click any of them.',
    target: '.command-dock',
    seconds: 9,
    run: async (controls) => {
      controls.closeStory()
      await controls.flyTo('Lisbon')
    },
  },
  {
    id: 'address',
    chapter: 'The living globe',
    title: 'One bar for places, pages and tabs',
    body: 'The same bar completes what you type from your open tabs, bookmarks, history and places, all ranked on this Mac. Nothing you type is sent anywhere until you choose a search.',
    target: '.command-dock',
    seconds: 9,
    run: async (controls) => { await controls.typeInAddressBar('wiki') },
  },
  {
    id: 'commands',
    chapter: 'The living globe',
    title: 'Every command, from the keyboard',
    body: 'Press ⌘K, or type > first, and the bar lists what Intoponet can do — copy a clean link, save a PDF, translate, hide the sidebar, fly to the highest peak — with your tabs and places below. Type a few letters and press Return.',
    target: '.command-dock',
    seconds: 9,
    run: async (controls) => { await controls.typeInAddressBar('> ') },
  },
  {
    id: 'world',
    chapter: 'Stories',
    title: 'Stories the whole world is covering',
    body: 'World ranks the stories that local outlets in many countries are covering at once. Open one and its sources line up as cards — each with the article’s own picture, writers and summary — translated on this Mac, and a card grows into the page itself.',
    target: '.globe-panel',
    seconds: 11,
    run: async (controls, context) => {
      await controls.typeInAddressBar('')
      controls.reset()
      context.headline = await controls.openWorldStory()
      if (context.headline) controls.prepareOlds(context.headline)
    },
  },
  {
    id: 'olds',
    chapter: 'The Olds',
    title: 'The history behind the news',
    body: 'The Olds finds the ongoing story a headline belongs to, then walks back through how we got here: dated events from Wikipedia and its daily Current events, with every step linked to its source.',
    target: '.olds-sheet',
    seconds: 12,
    run: (controls, context) => controls.openOlds(context.headline ?? 'Russia-Ukraine ceasefire talks'),
  },
  {
    id: 'olds-views',
    chapter: 'The Olds',
    title: 'Story, Timeline, List — and the outlet’s own past',
    body: 'Read it as a story, drag through it as a timeline, or scan it as a list. Pick any step to follow its own history. For a headline you open, The Olds also shows what that outlet wrote about the story before, from its topic pages and the Wayback Machine.',
    target: '.olds-sheet',
    seconds: 11,
  },
  {
    id: 'bookmarks',
    chapter: 'Your library',
    title: 'Bookmarks that remember where things are',
    body: 'Everything you save keeps its place on Earth and its collection, including the PDFs you save. The library is encrypted on this Mac and never leaves it.',
    target: '.bookmark-pane',
    seconds: 9,
    run: (controls) => {
      controls.closeOlds()
      controls.showBookmarks(true)
    },
  },
  {
    id: 'map',
    chapter: 'Your library',
    title: 'My map: your own layer of the world',
    body: 'Pins turn pages into places — a restaurant, a field report, a trail. My map is yours alone, unless you choose to share a pin.',
    target: '.topbar-actions [data-panel="library"]',
    seconds: 8,
    run: (controls) => {
      controls.showBookmarks(false)
      controls.showMyMap(true)
    },
  },
  {
    id: 'browse',
    chapter: 'Browsing',
    title: 'Every page, with tools built in',
    body: 'Open any site and the toolbar gives you protection from ads and trackers, translation, capture, PDF, pins and Absorb. The page is paused behind the tour while we look at them.',
    target: '.browser-actions',
    seconds: 10,
    run: async (controls) => {
      controls.showMyMap(false)
      await controls.openPage(PAGE)
      controls.hidePage(true)
    },
  },
  {
    id: 'translate',
    chapter: 'Browsing',
    title: 'Pages in your language, translated here',
    body: 'Pages and headlines in other languages translate themselves into yours, on this Mac: no text is sent to a translation service. Turn it off, or never translate a language, in Settings.',
    target: '.browser-actions [aria-label^="Translat"]',
    seconds: 9,
  },
  {
    id: 'tabs',
    chapter: 'Tabs',
    title: 'Tabs down the side, in every view',
    body: 'Keep the sidebar open, even full width, with pinned tabs on top. A pinned tab remembers its home and offers the way back; closing it only puts it to sleep. ⌃⌘S hides the sidebar — rest the pointer at the left edge to bring it back.',
    target: '.tab-rail',
    seconds: 11,
  },
  {
    id: 'tab-care',
    chapter: 'Tabs',
    title: 'Tabs that look after themselves',
    body: 'Tabs you have not looked at for an hour sleep to save memory and wake where you left them. ⌃Tab can go most-recently-used first, and ⇧⌘C copies a page’s address without its tracking codes. All in Settings › Browsing.',
    target: '.tab-rail',
    seconds: 10,
  },
  {
    id: 'tab-folders',
    chapter: 'Tabs',
    title: 'Folders, and tabs that tidy away',
    body: 'Drag tabs into folders that nest and fold, and save a folder as a collection in your library. If you choose, tabs you have not looked at for a while close into Archived tabs: the address bar finds them and reopens them where they were.',
    target: '.tab-rail',
    seconds: 10,
  },
  {
    id: 'pdf',
    chapter: 'Browsing',
    title: 'Save any page as a clean PDF',
    body: 'One click keeps a page as a tidy, searchable PDF without the ads and pop-ups, with links that still work. Add it to your bookmarks to find it on the map later.',
    target: '[aria-label="Save this page as PDF"]',
    seconds: 9,
  },
  {
    id: 'capture',
    chapter: 'Browsing',
    title: 'Screenshots and recordings, kept in folders',
    body: 'Capture a part of any page as an image, or record it as a video. Captures go into folders you name, on this Mac.',
    target: '[aria-label="Capture this page: screenshot or recording"]',
    seconds: 8,
  },
  {
    id: 'basics',
    chapter: 'Browsing',
    title: 'The everyday things, done carefully',
    body: 'Saved passwords that fill only when you click, downloads you can pause and check, History (⌘Y), reopening closed tabs (⇧⌘T), per-site zoom, and a real menu bar. Settings brings your bookmarks, tabs, history and passwords over from Chrome, Arc, Brave, Edge or Vivaldi, on this Mac, and makes Intoponet your default browser.',
    seconds: 10,
  },
  {
    id: 'absorb',
    chapter: 'Knowledge',
    title: 'Absorb what you read',
    body: 'Absorb keeps a page’s text — or just the passage you select — in your own knowledge: searchable, with its claims and figures checked against each other, and always cited back to the page.',
    target: '[aria-label="Absorb this page into your knowledge"]',
    seconds: 9,
  },
  {
    id: 'knowledge',
    chapter: 'Knowledge',
    title: 'Ask your own knowledge',
    body: 'Everything you absorb is here. Turn on Laya and it finds pages by meaning and answers with quotes from them — all on this Mac, with no network.',
    target: '.knowledge-sheet',
    seconds: 10,
    run: (controls) => {
      controls.hidePage(true)
      controls.showKnowledge(true)
    },
  },
  {
    id: 'beacons',
    chapter: 'Share with the world',
    title: 'Pins become beacons',
    body: 'Pin a page, then choose to publish it as a beacon: a signed, anonymous light on the public globe that others can follow. You see exactly what is shared before anything leaves this Mac, and you can withdraw it.',
    target: '[aria-label="Pin current page to My map"], [aria-label="Edit current page pin"]',
    seconds: 11,
    run: (controls) => controls.showKnowledge(false),
  },
  {
    id: 'workspaces',
    chapter: 'Tabs',
    title: 'Workspaces keep things apart',
    body: 'Make a workspace for work, a trip or a story you follow: each has its own name, colour, pinned tabs, folders and open tabs. Switch with ⌃1–9, a sideways swipe on the sidebar, or the command menu; sleeping tabs stay asleep. A favourites row can be shared by every workspace, and private browsing is never part of one.',
    target: '.tab-rail',
    seconds: 10,
  },
  {
    id: 'link-preview',
    chapter: 'Browsing',
    title: 'Peek at a link first',
    body: '⇧-click a link, or a headline in the World list, and it opens in a card over the page or the globe, with the same protection. Escape puts it away; Open as Tab keeps it.',
    target: '.browser-body',
    seconds: 8,
  },
  {
    id: 'site-tweaks',
    chapter: 'Browsing',
    title: 'Make a site yours',
    body: 'Open a site’s protection bar and choose Customize site: point at an element to hide it, pick a reading width, a font or light or dark colours, or add your own styles. They apply on every visit to that site, stay on this Mac, and never run a script.',
    target: '[aria-controls="protection-panel"]',
    seconds: 11,
  },
  {
    id: 'quick-window',
    chapter: 'Browsing',
    title: 'Links from other apps, in a quick window',
    body: 'In Settings › Browsing, a link from Mail or Slack can open in a small window that floats above your work, with protection on. ⌘O moves it into a tab with its history; closing it leaves nothing behind. ⌥⌘N opens an empty one.',
    target: '.settings-button',
    seconds: 11,
  },
  {
    id: 'video-follows-you',
    chapter: 'Browsing',
    title: 'Video follows you',
    body: 'Turn on “Float playing video when you switch tabs” in Settings › Browsing, and a video keeps playing in a small window when you leave its tab. The sidebar shows what is playing, with play, pause, mute and go-to-tab buttons.',
    target: '.tab-rail',
    seconds: 10,
  },
  {
    id: 'done',
    chapter: 'That’s the tour',
    title: 'The world is your start page',
    body: 'Find the highest peak, open a story, follow its history. You can replay this tour any time from Settings.',
    target: '.settings-button',
    seconds: 9,
    run: (controls) => controls.finish(),
  },
]
