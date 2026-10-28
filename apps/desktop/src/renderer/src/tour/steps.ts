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
    id: 'fly',
    chapter: 'The living globe',
    title: 'Fly anywhere by name',
    body: 'Type a city, region or country into the search — even misspelled — and the globe turns to it and marks the exact spot. Every country is named as you reach it, and you can click any of them.',
    target: '.command-dock',
    seconds: 9,
    run: async (controls) => { await controls.flyTo('Lisbon') },
  },
  {
    id: 'world',
    chapter: 'Stories',
    title: 'Stories the whole world is covering',
    body: 'World ranks the stories that local outlets in many countries are covering at once. Open one to read every country’s headline side by side, translated on this Mac.',
    target: '.globe-panel',
    seconds: 10,
    run: async (controls, context) => {
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
    title: 'Story, Timeline and List',
    body: 'Read it as a story, drag through it as a timeline, or scan it as a list. Pick any step to follow its own history. Links say whether they are a cause, a part, or only a sequence.',
    target: '.olds-sheet',
    seconds: 9,
  },
  {
    id: 'bookmarks',
    chapter: 'Your library',
    title: 'Bookmarks that remember where things are',
    body: 'Everything you save keeps its place on Earth and its collection. The library is encrypted on this Mac and never leaves it.',
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
    body: 'Open any site and the toolbar gives you protection from ads and trackers, translation on this Mac, capture, pins and Absorb. The page is paused behind the tour while we look at them.',
    target: '.browser-actions',
    seconds: 10,
    run: async (controls) => {
      controls.showMyMap(false)
      await controls.openPage(PAGE)
      controls.hidePage(true)
    },
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
    id: 'done',
    chapter: 'That’s the tour',
    title: 'The world is your start page',
    body: 'Fly somewhere, open a story, follow its history. You can replay this tour any time from Settings.',
    target: '.settings-button',
    seconds: 9,
    run: (controls) => controls.finish(),
  },
]
