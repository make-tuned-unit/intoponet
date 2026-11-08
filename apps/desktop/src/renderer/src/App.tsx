import brandLogo from './brand/intoponet-horizontal-on-dark.svg'
import { UpdateBanner } from './settings/UpdateBanner'
import type {
  BrowserPanelSnapshot,
  FindInPageResult,
  NavigationIntent,
  OpenDisposition,
  PageTabSnapshot,
  ProtectionSnapshot,
  PublicFieldStatus,
  TabSidebarState,
  ArchivedTabSnapshot,
  TabFolderSnapshot,
  WorkspacesState,
} from '@intoponet/browser-api'
import { TAB_SIDEBAR_WIDTH } from '@intoponet/browser-api'
import { demoFieldSnapshot, parseFieldSnapshot, snapshotLabel } from '@intoponet/field-snapshot'
import type { FieldSnapshot } from '@intoponet/field-snapshot'
import { latLonToOrbit, syntheticTopicGraph } from '@intoponet/frequency-field'
import {
  absorbPage,
  mergePrivateLibraries,
  parsePrivateLibrary,
  historicalFixtures,
  privateLibrarySchema,
  relationshipLabel,
  searchAbsorbed,
  serializePrivateLibrary,
  type AbsorbRecord,
} from '@intoponet/local-knowledge'
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  Copy,
  Expand,
  FolderPlus,
  Globe2,
  KeyRound,
  Check,
  LockKeyhole,
  EyeOff,
  Library,
  Aperture,
  Ellipsis,
  MapPin,
  Pencil,
  Printer,
  RefreshCw,
  Search,
  Shrink,
  Shield,
  Settings as SettingsIcon,
  ShieldAlert,
  ShieldOff,
  Square,
  Trash2,
  X,
  Languages,
  LoaderCircle,
  History,
  FileDown,
  ChevronDown,
} from 'lucide-react'
import { TranslateBar } from './translate/TranslateBar'
import { PdfBar } from './pdf/PdfBar'
import type { PdfExportEvent } from '@intoponet/browser-api'
import { formatPublicSourceHealth } from './globe/publicFieldStatus'
import { SiteIcon } from './SiteIcon'
import { FreeCoverageBar, freeCoverageFor } from './access/FreeCoverageBar'
import { learnedPaywalls, mayRememberSite, rememberPaywall } from './access/learnedPaywalls'
import { hostIsPaywalled } from '../../shared/news/paywall'
import { hostOf } from './favicons'
import { formatMegabytes, languageName, modelFor, useTranslate } from './translate/useTranslate'
import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  defaultAnchor,
  readExplorationState,
  nudgeOrbit,
  readScale,
  scaleDistance,
  scaleFromDistance,
  scaleLabel,
  restoreAfterTopic,
  shouldSnapshotBeforeTopic,
  writeExplorationState,
  writeScale,
  zoomTowardEarth,
  zoomTowardTopic,
  type ExplorationScale,
  type OrbitPose,
} from './exploration'
import { FrequencyField } from './FrequencyField'
import { FieldLab } from './FieldLab'
import { resolveSelectedTopic, snapshotKind, syntheticTopics, topicOptions } from './fieldPresentation'
import { syntheticPreviewInterestSignals } from './interestField'
import type { InterestSignal } from './interestField'
import { evaluateFrequencyEligibility, filterSnapshotForFrequencyEligibility } from './contentEligibility'
import {
  emptyPersonalActivity,
  personalTrafficVisits,
  personalVisitSignals,
  recordPersonalVisit,
  unplacedPersonalVisitCount,
  PERSONAL_DISPLAY_RADIUS_KM,
  type PersonalTopicLocation,
} from './personalInterest'
import type { OrganicMembraneMetrics, OrganicMembraneSettings } from './earth/OrganicMembrane'
import {
  createCollection,
  parseStoredPrivateLibrary,
  readBookmarks,
  readCollections,
  readRecents,
  rememberRecent,
  writeRecents,
  tagsOf,
  pruneRecents,
  hasLegacyLibraryStorage,
  clearLegacyLibraryStorage,
  mergeCollections,
  splitCollectionBySite,
  explainCollection,
  renameCollection,
  topicKey,
  upsertBookmark,
  writeBookmarks,
  writeCollections,
  type RecentPage,
  type SavedBookmark,
  type SavedCollection,
} from './localLibrary'
import { aggregateTopicTraffic, topicTrafficDemoResult } from './topicTraffic'
import { inferUnifiedLauncherIntent } from './launcherIntent'
import { TabDock } from './TabDock'
import { TabRail } from './TabRail'
import { ACCENT_COLOURS, type WorkspaceRequest } from './WorkspaceBar'
import { headlinesNearAnchor } from '../../shared/news/anchorHeadlines'
import { useNowPlaying } from './nowPlaying/NowPlayingControl'
import { PageTabStrip } from './PageTabStrip'
import './shellChrome.css'
import { OtherSideFrame, SplitChrome, SplitStartFrame, shellDrawnSide } from './SplitPages'
import { BookmarkPane, type PaneFilter } from './BookmarkPane'
import { groupOf, moveBookmarkToGroup, UNSORTED_GROUP_ID } from './bookmarkGroups'
import { AnimatePresence } from 'motion/react'
import type { CaptureCrop, CaptureRecord, PendingCapture } from '@intoponet/browser-api'
import { CaptureOverlay, type CaptureMode } from './captures/CaptureOverlay'
import { CaptureViewer } from './captures/CaptureViewer'
import { CaptureToast, type CaptureToastState } from './captures/CaptureToast'
import { RecordingPill } from './captures/RecordingPill'
import { useCaptures } from './captures/useCaptures'
import { useRecorder } from './captures/useRecorder'
import { PinEditor, type PinEditorValue } from './PinEditor'
import { createGlobeProjection, type GlobeMarker } from './globe/GlobeMarkers'
import { CountryNames, createCountryView } from './globe/CountryNames'
import { headlinesAbout } from './globe/naturalEvent'
import type { PlaceTrendState } from './globe/PlaceTrendList'
import type { PlaceTrends } from '../../shared/news/placeTrends'
import { countryAt, countryShape } from '../../shared/places/countryAt'
import { GlobeOverlay, type GlobeLabel } from './globe/GlobeOverlay'
import { labelViewChanged, viewLabelSignals, type LabelView } from './globe/viewLabels'
import { GlobeHeader, HoverCardContent, LayerCard, SignalPanel, type FieldView, type ListView } from './globe/GlobeHud'
import { OldsPanel, type OldsState } from './olds/OldsPanel'
import type { CoverageArticle } from './olds/OldsCoverage'
import { MinePanel } from './globe/MinePanel'
import { normalizeLanguage, type AbsorbScope, type KnowledgeRecord, type OldsNode, type OldsQuery } from '@intoponet/browser-api'
import { AbsorbSheet, type AbsorbState } from './knowledge/AbsorbSheet'
import { KnowledgeSheet } from './knowledge/KnowledgeSheet'
import { placeMatches } from './globe/PlaceSuggestions'
import { OmniboxSuggestions, useOmnibox } from './OmniboxSuggestions'
import { commandQuery, type OmniboxAction, type OmniboxSuggestion } from './omnibox'
import { menuActions } from './commandMenu'
import { saveFolderAsCollections } from './tabFolders'
import { poseToward, radiusForSpan } from './globe/flyTo'
import {
  filterGlobeSignals,
  freshness,
  GLOBE_LAYER_ORDER,
  GLOBE_LAYERS,
  globeSignalsFromSnapshot,
  layerCounts,
  newsGlobeSignals,
  membraneSignals,
  MEMBRANE_MAX_SIGNALS,
  spreadGlobeSignals,
  spreadRidgeSignals,
  nearbySignals,
  PIN_COLOR,
  relativeTime,
  type GlobeLayerId,
  type GlobeSignal,
  type GlobeWindow,
  interleaveLayers,
  risingSignals,
  fadingSignals,
} from './globe/globeSignals'
import { dayPhaseText } from './earth/sun'
import { cityAliases, countryPlace, distanceKm as placeDistanceKm, nearestCountry, placesNamedIn, PLACE_ATTRIBUTION, placeLabel, searchPlaces, type Place } from '../../shared/places/places'
import { Tour } from './tour/Tour'
import type { TourControls } from './tour/steps'
import { parseNewsDigest, type NewsDigest, type NewsHeadline, type RisingTerm } from '../../shared/news/newsDigest'
import { matchTabsToStories, withWorldStories, type StoryHeadlines } from '../../shared/news/storyTabs'
import type { GlobalStory } from '../../shared/news/globalStories'
import { isExcludedSite, type PrivacyState } from '@intoponet/browser-api'
import { PrivacyPane } from './privacy/PrivacyPane'
import { SettingsPanel } from './settings/SettingsPanel'
import { mergeImportedLibrary } from './browserImport/mergeImport'
import { backgroundTabLabel, PermissionBar, SitePermissionChips } from './permissions/PermissionBar'
import { ExternalOpenBar, useExternalOpenRequests } from './browsing/ExternalOpenBar'
import { ErrorCard, ErrorPage, navigationErrorMessage } from './browsing/ErrorPage'
import { SiteTweaksPanel } from './siteTweaks/SiteTweaksPanel'
import { PasswordBar } from './passwords/PasswordBar'
import { BookmarkSiteBar, type BookmarkSiteOffer } from './passwords/BookmarkSiteBar'
import { siteLabel, type PasswordPageState } from '../../shared/passwords'
import { BeaconConsent } from './beacons/BeaconConsent'
import type { BeaconDraft } from '@intoponet/browser-api'
import type { SitePermissionMap, SitePermissionRequest } from '@intoponet/browser-api'
import { autoTranslatePlan, isNeverTranslated, readAppSettings, siteKey, withNeverTranslate, writeAppSettings, type AppSettings } from './settings/appSettings'
import { useHeadlinePref } from './translate/headlinePref'
import { readPrivacySettings, writePrivacySettings, type PrivacySettings } from './privacy/privacySettings'
import { StartPage } from './StartPage'
import { DownloadsButton } from './browsingData/DownloadsPane'
import { HistoryHost } from './browsingData/HistoryPane'
import { openHistory } from './browsingData/historyAccess'
import { forgetRecentPages } from './browsingData/browsingDataModel'
import { FeedbackPrompt } from './FeedbackPrompt'
import { startBookmarks, startNews, startRecents } from './startPageModel'
import { buildStoryTerrain, storyAt, storyTerrainKey } from './globe/storyTerrain'
import { HighestPeakButton, STORY_MARKER_PREFIX, StoryCardContent, StoryPanel, SUMMIT_COLOR, storyLabel, storyMarkerId, storyMarkers, strandEnds } from './globe/StoryPeaks'
import { inferLauncherIntent, resolveNavigationIntent } from '@intoponet/browser-api'
import { LauncherClear } from './launcherClear'

const bookmarkPaneOpenKey = 'intoponet.bookmark-pane.open.v1'
const globePrefsKey = 'intoponet.globe.v2'
const KNOWLEDGE_COLOR = '#d6c9ff'

type GlobePrefs = { view: FieldView; layers: GlobeLayerId[]; window: GlobeWindow; pins: boolean; dayNight: boolean }

function readGlobePrefs(): GlobePrefs {
  const fallback: GlobePrefs = { view: 'public', layers: [...GLOBE_LAYER_ORDER], window: '7d', pins: true, dayNight: true }
  try {
    const raw = JSON.parse(localStorage.getItem(globePrefsKey) ?? 'null') as Partial<GlobePrefs> | null
    if (!raw || typeof raw !== 'object') return fallback
    return {
      view: raw.view === 'personal' ? 'personal' : 'public',
      layers: Array.isArray(raw.layers) ? raw.layers.filter((layer): layer is GlobeLayerId => GLOBE_LAYER_ORDER.includes(layer as GlobeLayerId)) : fallback.layers,
      window: raw.window === '24h' || raw.window === '30d' ? raw.window : '7d',
      pins: raw.pins !== false,
      dayNight: raw.dayNight !== false,
    }
  } catch {
    return fallback
  }
}
const captureGroupKey = 'intoponet.capture-group.v1'

type LibraryTab = 'locations' | 'collections' | 'recent' | 'absorbed' | 'privacy'
type TopicLocationOption = PersonalTopicLocation & { topicId?: string }

const emptyPanel: BrowserPanelSnapshot = {
  url: '',
  title: '',
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  isVisible: false,
}

const emptyProtection: ProtectionSnapshot = {
  origin: '',
  enabled: true,
  blockedAds: 0,
  blockedTrackers: 0,
  adsEnabled: true,
  trackersEnabled: true,
}

const syntheticFixtureTopicIds: Record<string, string> = {
  'Open knowledge': 'world-knowledge',
  'Local archives': 'local-archives',
  'Civic memory': 'civic-memory',
  'Open research': 'public-research',
}
const romanColosseumTopicLocation: PersonalTopicLocation & { topicId: string } = {
  id: 'topic-location:roman-colosseum',
  topicId: 'Roman Colosseum',
  label: 'Roman Colosseum, Rome',
  lat: 41.8902,
  lon: 12.4922,
  radiusKm: PERSONAL_DISPLAY_RADIUS_KM,
}
const activityMembraneSettings: OrganicMembraneSettings = {
  macro: 1,
  meso: 1,
  micro: 1,
  material: 'glass',
  paused: false,
  quality: 'auto',
}

function syntheticSignalsForTopic(topic: string): InterestSignal[] {
  const fixtureTopicId = syntheticFixtureTopicIds[topic] ?? topic
  const matching = syntheticPreviewInterestSignals.filter((signal) => signal.topicId === fixtureTopicId)
  return (matching.length ? matching : syntheticPreviewInterestSignals).map((signal) => ({ ...signal }))
}

function originLabel(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'No page open'
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  // An empty search box isn't "typing": Escape there closes the open panel.
  if (target instanceof HTMLInputElement && target.closest('.command-input') && !target.value) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function tabCaption(tab: PageTabSnapshot): string {
  const raw = (tab.title || originLabel(tab.url)).replace(/\s+/g, ' ').trim()
  return raw.slice(0, 10)
}

/** One thread in the Olds stack; a news headline also carries its article, for the outlet's earlier coverage. */
type OldsEntry = { query: OldsQuery; label: string; article?: CoverageArticle }

export function App() {
  const [query, setQueryNow] = useState('')
  // After Enter the bar clears once the navigation starts; anything that changes the bar since (typing,
  // ⌘L) goes through setQuery, which keeps that late clear from wiping it.
  const launcherClear = useRef(new LauncherClear())
  const setQuery = (value: string): void => {
    launcherClear.current.edited()
    setQueryNow(value)
  }
  const [panel, setPanel] = useState<BrowserPanelSnapshot>(emptyPanel)
  const translation = useTranslate(panel.isVisible ? panel.url : '', panel.isLoading)
  // Paywalled articles: offer the same story from other (free) outlets.
  const [pageAccess, setPageAccess] = useState<{ url: string; title: string; signals: string[] } | null>(null)
  const [accessHidden, setAccessHidden] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('intoponet.paywall-bar-hidden.v1') ?? '[]') as string[] } catch { return [] }
  })
  useEffect(() => {
    setPageAccess(null)
    if (!panel.isVisible || panel.isLoading || !/^https?:/i.test(panel.url)) return
    const url = panel.url
    const isPrivate = panel.isPrivate
    const timer = setTimeout(() => {
      void window.intoponet.access.page().then((access) => {
        if (!access || access.url !== url) return
        const known = hostIsPaywalled(url, learnedPaywalls())
        // Private tabs and left-out sites are never written to local storage.
        if (access.paywalled && mayRememberSite(url, isPrivate, excludedSitesRef.current)) rememberPaywall(url)
        if (access.paywalled || known) setPageAccess({ url, title: access.title, signals: access.signals })
      }).catch(() => undefined)
    }, 1_200)
    return () => clearTimeout(timer)
  }, [panel.url, panel.isLoading, panel.isVisible, panel.isPrivate])
  // "Free coverage" in a Compare side's header: that side's page, whose choices show even if its bar was closed.
  const [coverageAsked, setCoverageAsked] = useState<string | null>(null)
  const freeCoverage = freeCoverageFor({ url: panel.url, title: panel.title }, pageAccess, accessHidden, coverageAsked)
  const [activeTopic, setActiveTopic] = useState(
    () => localStorage.getItem(topicKey) ?? 'Open knowledge',
  )
  const [researchTopic, setResearchTopic] = useState<string | null>(null)
  const [scale, setScale] = useState<ExplorationScale>(readScale)
  const [pose, setPose] = useState<OrbitPose>(
    () =>
      readExplorationState()?.pose ?? {
        theta: 0.35,
        phi: 1.28,
        radius: scaleDistance[readScale()],
      },
  )
  const [bookmarks, setBookmarks] = useState(readBookmarks)
  const [collections, setCollections] = useState(readCollections)
  const [privacySettings, setPrivacySettingsState] = useState(readPrivacySettings)
  const privacySettingsRef = useRef(privacySettings)
  privacySettingsRef.current = privacySettings
  const [privacyState, setPrivacyState] = useState<PrivacyState | null>(null)
  const excludedSitesRef = useRef<string[]>([])
  excludedSitesRef.current = privacyState?.excludedSites ?? []
  const [recents, setRecents] = useState(() => pruneRecents(readRecents(), readPrivacySettings().retentionDays))
  const [absorbed, setAbsorbed] = useState<AbsorbRecord[]>([])
  const [absorbExcerpt, setAbsorbExcerpt] = useState('')
  const [absorbQuery, setAbsorbQuery] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [libraryReady, setLibraryReady] = useState(false)
  const [publicSnapshot, setPublicSnapshot] = useState<FieldSnapshot | null>(null)
  const [publicFieldStatus, setPublicFieldStatus] = useState<PublicFieldStatus | null>(null)
  const publicFieldStatusEvents = useRef(0)
  const [personalActivity, setPersonalActivity] = useState(emptyPersonalActivity)
  const [globePrefs, setGlobePrefs] = useState(readGlobePrefs)
  const fieldView = globePrefs.view
  const updateGlobePrefs = (patch: Partial<GlobePrefs>): void => {
    setGlobePrefs((current) => {
      const next = { ...current, ...patch }
      try { localStorage.setItem(globePrefsKey, JSON.stringify(next)) } catch { /* convenience only */ }
      return next
    })
  }
  const setFieldView = (view: FieldView): void => updateGlobePrefs({ view })
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null)
  const [newsDigest, setNewsDigest] = useState<NewsDigest | null>(null)
  // World first: what the world is reporting together; Peaks, Rising and Fading are a tab away.
  const [listView, setListView] = useState<ListView>('world')
  const [activeTerm, setActiveTerm] = useState<RisingTerm | null>(null)
  const [olds, setOlds] = useState<{ stack: OldsEntry[]; state: OldsState } | null>(null)
  const oldsRequest = useRef(0)
  const [absorb, setAbsorb] = useState<AbsorbState | null>(null)
  const [knowledgeView, setKnowledgeView] = useState<{ focus: string | null } | null>(null)
  const [knowledgeRecords, setKnowledgeRecords] = useState<KnowledgeRecord[]>([])
  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null)
  const [focusedPlace, setFocusedPlace] = useState<Place | null>(null)
  const [placesDismissed, setPlacesDismissed] = useState(false)
  const [clock, setClock] = useState(() => Date.now())
  const [globeProjection] = useState(createGlobeProjection)
  // Where every country's name sits on screen; written by the scene each frame.
  const [countryView] = useState(createCountryView)
  const [topicLocations, setTopicLocations] = useState<Record<string, PersonalTopicLocation>>({})
  const [designPreview, setDesignPreview] = useState(false)
  const [fieldLabOpen, setFieldLabOpen] = useState(
    () => import.meta.env.DEV && new URLSearchParams(window.location.search).get('fieldLab') === '1',
  )
  const [previewIntensity, setPreviewIntensity] = useState(1.25)
  const [previewRadiusScale, setPreviewRadiusScale] = useState(1.2)
  const [previewTopic, setPreviewTopic] = useState<string>(syntheticTopics[0])
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [organicMetrics, setOrganicMetrics] = useState<OrganicMembraneMetrics | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // The guided tour (from Settings): it drives the app, then puts everything back.
  const [tourOpen, setTourOpen] = useState(false)
  /** The page the tour opened: false, true (shown in a tab it did not make), or the id of the tab it made (closed at the end). */
  const tourOpenedPage = useRef<boolean | string>(false)
  /** Counts the tour's scene changes: a step's setup still running stops once a later step has set up its own. */
  const tourScene = useRef(0)
  /** The tour opens or shows its page one step at a time (so two quick steps never open two tabs). */
  const tourPageQueue = useRef<Promise<unknown>>(Promise.resolve())
  const [beaconDraft, setBeaconDraft] = useState<BeaconDraft | null>(null)
  const [appSettings, setAppSettingsState] = useState(readAppSettings)
  // Headlines and titles in your language (default) or as published; shared with every headline list.
  const [headlinesTranslated, setHeadlinesPref] = useHeadlinePref()
  const [bookmarksOpen, setBookmarksOpenState] = useState(() => {
    try { return localStorage.getItem(bookmarkPaneOpenKey) === '1' } catch { return false }
  })
  const [dockFocusRequest, setDockFocusRequest] = useState(0)
  const [chromeRevealed, setChromeRevealed] = useState(false)
  const [chromeHeld, setChromeHeld] = useState(false)
  const [moreToolsOpen, setMoreToolsOpen] = useState(false)
  const [railExpanded, setRailExpanded] = useState(false)
  /**
   * The tab sidebar: icons (expanding on hover), kept open (also in full width), or hidden (resting the
   * pointer at the window's left edge brings it back over the page until the pointer leaves). Kept by main.
   */
  const [sidebar, setSidebarState] = useState<TabSidebarState>({ mode: 'icons', width: TAB_SIDEBAR_WIDTH.initial })
  /** The mode to return to when ⌃⌘S shows a hidden sidebar again. */
  const sidebarShownMode = useRef<'icons' | 'open'>('icons')
  const [railPeek, setRailPeek] = useState(false)
  /** The guided tour's workspace steps show the sidebar open; the saved sidebar is left as it is. */
  const [tourSidebar, setTourSidebar] = useState(false)
  const railPinned = sidebar.mode === 'open'
  const setSidebar = (next: TabSidebarState): void => {
    setSidebarState(next)
    if (next.mode !== 'hidden') sidebarShownMode.current = next.mode
    if (next.mode !== 'open') setRailExpanded(false)
    setRailPeek(false)
    void window.intoponet.browserHost.setTabSidebar(next)
  }
  const setRailPinned = (pinned: boolean): void => setSidebar({ ...sidebar, mode: pinned ? 'open' : 'icons' })
  const toggleSidebar = (): void => setSidebar({ ...sidebar, mode: sidebar.mode === 'hidden' ? sidebarShownMode.current : 'hidden' })
  useEffect(() => {
    let mounted = true
    void window.intoponet.browserHost.getTabSidebar().then((saved) => {
      if (!mounted) return
      if (saved) {
        setSidebarState(saved)
        if (saved.mode !== 'hidden') sidebarShownMode.current = saved.mode
        return
      }
      // Earlier builds kept only "Keep open" in this window's storage: carried over once.
      let pinned = false
      try { pinned = localStorage.getItem('intoponet.tab-rail.pinned.v1') === '1' } catch { /* none */ }
      if (pinned) {
        setSidebarState({ mode: 'open', width: TAB_SIDEBAR_WIDTH.initial })
        sidebarShownMode.current = 'open'
        void window.intoponet.browserHost.setTabSidebar({ mode: 'open', width: TAB_SIDEBAR_WIDTH.initial })
      }
    }, () => undefined)
    return () => { mounted = false }
  }, [])
  const { records: captureRecords, error: captureStoreError } = useCaptures()
  const [captureSession, setCaptureSession] = useState<{ pending: PendingCapture; mode: CaptureMode } | null>(null)
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [captureToast, setCaptureToast] = useState<CaptureToastState>(null)
  const [freshCaptureId, setFreshCaptureId] = useState<string | null>(null)
  const lastCaptureBounds = useRef<PendingCapture['viewBounds'] | null>(null)
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('locations')
  const [pinEditor, setPinEditor] = useState<{ initial: PinEditorValue; originalUrl: string; restoreBrowser: boolean; restoreFullWidth: boolean } | null>(null)
  const [selectedPinUrl, setSelectedPinUrl] = useState('')
  const [collectionDraft, setCollectionDraft] = useState('')
  const [expandedCollection, setExpandedCollection] = useState('')
  const [renamingCollection, setRenamingCollection] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  const [findOpen, setFindOpen] = useState(false)
  const [translateOpen, setTranslateOpen] = useState(false)
  const [pdfStatus, setPdfStatus] = useState<PdfExportEvent | null>(null)
  const [pdfOptionsOpen, setPdfOptionsOpen] = useState(false)
  /** Files a saved PDF into its bookmark group (kept current each render: the event listener is long-lived). */
  const [bookmarkFilterRequest, setBookmarkFilterRequest] = useState<{ filter: PaneFilter; at: number } | null>(null)
  const [savedPdfVersion, setSavedPdfVersion] = useState(0)
  const pdfSavedRef = useRef<(event: Extract<PdfExportEvent, { state: 'saved' }>) => void>(() => undefined)
  const [findQuery, setFindQuery] = useState('')
  const [findResult, setFindResult] = useState<FindInPageResult | null>(null)
  const [protection, setProtection] = useState<ProtectionSnapshot>(emptyProtection)
  const [shieldOpen, setShieldOpen] = useState(false)
  /** Customize site (SITE_TWEAKS), opened from the protection bar. */
  const [siteTweaksOpen, setSiteTweaksOpen] = useState(false)
  /** The failed page's site has tweaks that can be turned off from the error page. */
  const [failedSiteHasTweaks, setFailedSiteHasTweaks] = useState(false)
  useEffect(() => {
    if (!shieldOpen) setSiteTweaksOpen(false)
  }, [shieldOpen])
  useEffect(() => {
    if (!panel.loadError) {
      setFailedSiteHasTweaks(false)
      return
    }
    void window.intoponet.browserHost.siteTweaks.state().then(
      (state) => setFailedSiteHasTweaks(state.tweak?.enabled === true),
      () => setFailedSiteHasTweaks(false),
    )
  }, [panel.loadError, panel.url])
  const [permissionRequests, setPermissionRequests] = useState<SitePermissionRequest[]>([])
  /** Pages asking to open another app (mailto:, zoommtg:…). */
  const externalRequests = useExternalOpenRequests()
  // Saved passwords for the page in front: a save offer, or accounts to pick from.
  const [passwordState, setPasswordState] = useState<PasswordPageState | null>(null)
  const [bookmarkSiteOffer, setBookmarkSiteOffer] = useState<BookmarkSiteOffer | null>(null)
  const [passwordPicking, setPasswordPicking] = useState(false)
  const [sitePermissionMap, setSitePermissionMap] = useState<SitePermissionMap>({})
  const [tabs, setTabs] = useState<PageTabSnapshot[]>([])
  const nowPlaying = useNowPlaying()
  const [fullWidth, setFullWidth] = useState(false)
  const [notice, setNotice] = useState('')
  /** Shown in the address field for a moment after the page address is copied (a notice would sit under the page). */
  const [addressCopied, setAddressCopied] = useState('')
  /** The recent-tabs switcher (drawn by main over the page): announced here, and ended by ⌃ or Escape from the shell. */
  const [tabSwitcherAnnouncement, setTabSwitcherAnnouncement] = useState('')
  const tabSwitcherOpen = useRef(false)
  /** Archived tabs (offered in the address bar), and the tabs just archived (Undo for 10 seconds). */
  const [archivedTabs, setArchivedTabs] = useState<ArchivedTabSnapshot[]>([])
  const [justArchived, setJustArchived] = useState<{ ids: string[]; titles: string[] } | null>(null)
  useEffect(() => {
    let mounted = true
    const refresh = (): void => { void window.intoponet.browserHost.getArchivedTabs().then((list) => { if (mounted) setArchivedTabs(list) }, () => undefined) }
    refresh()
    let timer: number | null = null
    const unsubscribe = window.intoponet.browserHost.subscribe((event) => {
      if (event.type === 'archived-tabs-changed') refresh()
      if (event.type === 'tabs-archived') {
        refresh()
        // Tabs archived a moment apart join the same notice (Undo reopens them all).
        setJustArchived((current) => current ? { ids: [...current.ids, ...event.ids], titles: [...current.titles, ...event.titles] } : { ids: event.ids, titles: event.titles })
        if (timer !== null) window.clearTimeout(timer)
        timer = window.setTimeout(() => setJustArchived(null), 10_000)
      }
    })
    return () => { mounted = false; unsubscribe(); if (timer !== null) window.clearTimeout(timer) }
  }, [])
  /** Tab sidebar folders (kept by main). */
  const [tabFolders, setTabFolders] = useState<TabFolderSnapshot[]>([])
  const [renameFolderId, setRenameFolderId] = useState<string | null>(null)
  const [railMessage, setRailMessage] = useState('')
  const railMessageTimer = useRef<number | null>(null)
  /** Said in the sidebar while it shows (a notice would sit under the page), otherwise as a notice. */
  const sayInRail = (text: string): void => {
    if (!document.querySelector('.tab-rail')) {
      setNotice(text)
      return
    }
    setRailMessage(text)
    if (railMessageTimer.current !== null) window.clearTimeout(railMessageTimer.current)
    railMessageTimer.current = window.setTimeout(() => setRailMessage(''), 5_000)
  }
  useEffect(() => {
    let mounted = true
    void window.intoponet.browserHost.getTabFolders().then((list) => { if (mounted) setTabFolders(list) }, () => undefined)
    const unsubscribe = window.intoponet.browserHost.subscribe((event) => {
      if (event.type !== 'tab-folders') return
      setTabFolders(event.folders)
      if (event.rename) setRenameFolderId(event.rename)
    })
    return () => { mounted = false; unsubscribe() }
  }, [])
  /** Workspaces and the favourites row (kept by main). */
  const [workspaces, setWorkspaces] = useState<WorkspacesState | null>(null)
  const [workspaceRequest, setWorkspaceRequest] = useState<WorkspaceRequest | null>(null)
  useEffect(() => {
    let mounted = true
    void window.intoponet.workspaces.get().then((state) => { if (mounted) setWorkspaces(state) }, () => undefined)
    const unsubscribe = window.intoponet.browserHost.subscribe((event) => {
      if (event.type === 'workspaces') setWorkspaces(event.state)
    })
    return () => { mounted = false; unsubscribe() }
  }, [])
  /** The shown workspace's anchor place, and the latest headlines for it (from the public news digest only). */
  const shownWorkspace = workspaces?.workspaces.find((workspace) => workspace.id === workspaces.activeId) ?? null
  const shownAnchor = shownWorkspace?.anchor ?? null
  const anchorHeadlines = useMemo(() => (shownAnchor ? headlinesNearAnchor(shownAnchor, newsDigest) : null), [shownAnchor, newsDigest])
  const undoArchive = (): void => {
    if (!justArchived) return
    void window.intoponet.browserHost.reopenArchivedTabs(justArchived.ids)
    setJustArchived(null)
  }
  /** Settings › ⌃Tab order (also orders open tabs in the address bar). */
  const [tabSwitchOrder, setTabSwitchOrder] = useState<'strip' | 'recent'>('strip')
  useEffect(() => {
    let mounted = true
    void window.intoponet.browsing.settings().then((settings) => { if (mounted) setTabSwitchOrder(settings.tabSwitchOrder) }, () => undefined)
    const unsubscribe = window.intoponet.browsing.subscribe((event) => { if (event.type === 'settings' && mounted) setTabSwitchOrder(event.settings.tabSwitchOrder) })
    return () => { mounted = false; unsubscribe() }
  }, [])
  const addressCopiedTimer = useRef<number | null>(null)
  const [error, setError] = useState('')
  const [libraryReadError, setLibraryReadError] = useState('')
  const panelBody = useRef<HTMLDivElement>(null)
  const shortcutHandlers = useRef({ find: () => {}, findAgain: (_forward: boolean) => {}, openSettings: () => {}, bookmark: () => {}, newTab: () => {}, focusAddress: () => {}, toggleBookmarksPane: () => {}, capture: () => {}, togglePrivate: () => {}, absorbSelection: () => {}, toggleSidebar: () => {}, commandMenu: () => {} })
  const tabStrip = useRef<HTMLDivElement>(null)
  const [tabEdges, setTabEdges] = useState({ overflow: false, atStart: true, atEnd: true })
  const input = useRef<HTMLInputElement>(null)
  const findInput = useRef<HTMLInputElement>(null)
  const pinBrowserClose = useRef<Promise<void> | null>(null)
  const activeTabId = useRef<string | null>(null)
  const topicReturnPose = useRef<OrbitPose | null>(null)
  const focusedMapAnchor = useRef<PersonalTopicLocation | null>(null)
  const sealWarned = useRef(false)
  const researchTopicRef = useRef(researchTopic)
  const topicLocationsRef = useRef(topicLocations)
  const seenFrequencyNavigationIds = useRef(new Set<string>())
  researchTopicRef.current = researchTopic
  topicLocationsRef.current = topicLocations
  const [reduceMotion, setReduceMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  const eligiblePublicSnapshot = useMemo(
    () => publicSnapshot ? filterSnapshotForFrequencyEligibility(publicSnapshot).snapshot : null,
    [publicSnapshot],
  )
  const personalTopicLabels = useMemo(
    () => [...new Set([researchTopic ?? 'General browsing', ...personalActivity.visits.map((visit) => visit.topicId)])].sort((a, b) => a.localeCompare(b)),
    [researchTopic, personalActivity],
  )
  const currentPersonalTopic = researchTopic ?? 'General browsing'
  const selectedTopicLocation = topicLocations[currentPersonalTopic] ?? null
  const topicTrafficVisits = useMemo(
    () => personalTrafficVisits(personalActivity, currentPersonalTopic, selectedTopicLocation),
    [currentPersonalTopic, personalActivity, selectedTopicLocation?.id],
  )
  const topicTraffic = useMemo(() => selectedTopicLocation
    ? aggregateTopicTraffic({
      destinationId: selectedTopicLocation.id,
      topicId: currentPersonalTopic,
      visits: topicTrafficVisits,
      now: new Date().toISOString(),
      currentWindowMs: 24 * 60 * 60 * 1_000,
    })
    : null, [currentPersonalTopic, selectedTopicLocation, topicTrafficVisits])
  const availableTopics = useMemo(() => eligiblePublicSnapshot
    ? topicOptions(eligiblePublicSnapshot)
    : personalTopicLabels.map((label) => ({ id: label, label, kind: 'synthetic' as const, measurements: ['Session activity'] })),
  [eligiblePublicSnapshot, personalTopicLabels])
  const selectedTopic = resolveSelectedTopic(availableTopics, activeTopic)
  const selectedTopicLabel = selectedTopic?.label ?? (fieldView === 'public' ? 'Public activity' : activeTopic)
  const selectedTopicId = selectedTopic?.id
  const visibleTopicLabel = designPreview ? previewTopic : fieldView === 'personal' ? 'Personal visits' : 'Public activity'
  const menuTopics = designPreview
    ? syntheticTopics.map((label) => ({ id: label, label, kind: 'synthetic' as const, measurements: ['Synthetic fixture'] }))
    : fieldView === 'personal'
      ? personalTopicLabels.map((label) => ({ id: label, label, kind: 'synthetic' as const, measurements: ['Personal session activity'] }))
      : availableTopics
  const launcherTopics = designPreview ? [] : menuTopics
  const selectedTopicSources = eligiblePublicSnapshot?.sources.filter((source) => selectedTopicId && source.topics.includes(selectedTopicId)) ?? []
  const selectedTopicKind = designPreview ? 'synthetic' : selectedTopic?.kind ?? (fieldView === 'public' ? 'public' : 'synthetic')
  const sourceMode = designPreview
    ? 'synthetic'
    : fieldView === 'personal'
      ? 'personal'
      : eligiblePublicSnapshot?.sources.some((source) => source.kind === 'public-record')
        ? snapshotKind(eligiblePublicSnapshot)
        : 'prototype'
  const topicModeDescription = designPreview
    ? 'Synthetic design preview. Not public activity.'
    : fieldView === 'personal'
      ? `Session-only personal activity across topics. New completed pages are tagged “${researchTopic ?? 'General browsing'}”.`
      : selectedTopicKind === 'public'
    ? `Public source measurements${selectedTopic?.measurements.length ? `: ${selectedTopic.measurements.join(', ')}.` : '.'}`
    : selectedTopicKind === 'mixed'
      ? `Mixed public and synthetic topic${selectedTopic?.measurements.length ? `: ${selectedTopic.measurements.join(', ')}.` : '.'}`
      : fieldView === 'public'
        ? 'No eligible public source measurements are available.'
        : 'No session visits have been recorded yet.'
  const allGlobeSignals = useMemo(
    () => [
      // Stories spreading between places rank among the news peaks, not after them.
      ...[...spreadGlobeSignals(newsDigest, Date.now()), ...newsGlobeSignals(newsDigest)].sort((a, b) => b.intensity - a.intensity),
      ...globeSignalsFromSnapshot(eligiblePublicSnapshot),
    ],
    [newsDigest, eligiblePublicSnapshot],
  )
  const globeLayerSet = useMemo(() => new Set(globePrefs.layers), [globePrefs.layers])
  const windowGlobeSignals = useMemo(
    () => filterGlobeSignals(allGlobeSignals, { layers: new Set(GLOBE_LAYER_ORDER), window: globePrefs.window, now: clock }),
    [allGlobeSignals, globePrefs.window, clock],
  )
  const visibleGlobeSignals = useMemo(
    () => windowGlobeSignals.filter((signal) => globeLayerSet.has(signal.layer)),
    [windowGlobeSignals, globeLayerSet],
  )
  const fieldSignals = useMemo(() => {
    if (designPreview) {
      return syntheticSignalsForTopic(previewTopic).map((signal) => ({
        ...signal,
        intensity: Math.min(1, signal.intensity * previewIntensity),
        radiusKm: Math.min(20_100, signal.radiusKm * previewRadiusScale),
      }))
    }
    if (fieldView === 'personal') return personalVisitSignals(personalActivity, new Date().toISOString())
    if (!eligiblePublicSnapshot) return []
    // Ridges from where a story started to the places that picked it up share the field's budget.
    const ridges = globeLayerSet.has('news') ? spreadRidgeSignals(newsDigest?.spreading ?? [], selectedSignalId, eligiblePublicSnapshot.createdAt) : []
    return [...membraneSignals(visibleGlobeSignals, eligiblePublicSnapshot.createdAt, MEMBRANE_MAX_SIGNALS - ridges.length), ...ridges]
  }, [designPreview, previewTopic, previewIntensity, previewRadiusScale, fieldView, personalActivity, eligiblePublicSnapshot, visibleGlobeSignals, newsDigest, selectedSignalId, globeLayerSet])
  // Story mountains: with local news on, the terrain is the stories outlets are covering (storyMountains.ts).
  const storyStories = useMemo(() => newsDigest?.mountains ?? [], [newsDigest])
  // Open tabs that are articles of a story, matched here on this Mac against the digest (nothing about tabs is sent).
  // Story mountains first (their summits can be highlighted), then the World tab's stories (storyTabs.ts withWorldStories).
  const storyEvidence = useMemo<StoryHeadlines[]>(() => withWorldStories(storyStories.map((story) => ({
    id: story.id,
    label: storyLabel(story),
    headlines: [{ title: story.title, url: story.url }, ...story.countries.map((country) => country.headline)],
  })), newsDigest?.global ?? []), [storyStories, newsDigest])
  const tabStories = useMemo(() => matchTabsToStories(tabs, storyEvidence), [tabs, storyEvidence])
  /** A story folder hovered or focused in the sidebar: its summit and strands are drawn, the camera stays put. */
  const [storyHighlightId, setStoryHighlightId] = useState<string | null>(null)
  const [groupRequest, setGroupRequest] = useState<number | undefined>(undefined)
  const [tidyRequest, setTidyRequest] = useState<number | undefined>(undefined)
  const storyMode = fieldView === 'public' && !designPreview && globeLayerSet.has('news') && storyStories.length > 0
  const storyKey = storyMode ? storyTerrainKey(storyStories) : ''
  // Rebuilt only when a height or story changes, not on every digest.
  const storyTerrain = useMemo(() => (storyMode ? buildStoryTerrain(storyStories) : null), [storyKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const zoomCommit = useRef(0)
  const [pinnedStoryId, setPinnedStoryId] = useState<string | null>(null)
  const [peakIndex, setPeakIndex] = useState(-1)
  const storyRank = (id: string): number => storyStories.findIndex((story) => story.id === id) + 1
  const topicLocationOptions = useMemo<TopicLocationOption[]>(() => {
    const seen = new Set<string>()
    const sourceAnchors = (eligiblePublicSnapshot?.sources ?? []).filter((source) => {
      if (source.kind !== 'public-record') return false
      const key = `${source.lat}|${source.lon}`
      if (seen.has(key)) return false
      seen.add(key)
      return Number.isFinite(source.lat) && source.lat >= -90 && source.lat <= 90 &&
        Number.isFinite(source.lon) && source.lon >= -180 && source.lon <= 180
    }).slice(0, 100).map((source) => ({
      id: source.id,
      label: `${source.title} · ${source.lat.toFixed(2)}, ${source.lon.toFixed(2)}`,
      lat: source.lat,
      lon: source.lon,
      radiusKm: PERSONAL_DISPLAY_RADIUS_KM,
    }))
    return [romanColosseumTopicLocation, ...sourceAnchors]
  }, [eligiblePublicSnapshot])
  const pinLocationOptions = useMemo(() => {
    const known = [...topicLocationOptions, ...Object.values(topicLocations)]
    const seen = new Set<string>()
    return known.flatMap((location) => {
      if (seen.has(location.id)) return []
      seen.add(location.id)
      return [{ id: location.id, label: location.label, lat: location.lat, lon: location.lon }]
    })
  }, [topicLocationOptions, topicLocations])
  const publicSourceHealthNote = publicFieldStatus ? formatPublicSourceHealth(publicFieldStatus) : ''
  const publicFieldStatusNote = publicFieldStatus
    ? `${publicFieldStatus.mode === 'shared' ? 'Shared mode' : 'Local mode'} · ${publicFieldStatus.sourceLabel}${publicFieldStatus.configuredOrigin ? ` (${publicFieldStatus.configuredOrigin})` : ''} · ${publicFieldStatus.state}: ${publicFieldStatus.message}${publicSourceHealthNote ? ` Source detail: ${publicSourceHealthNote}.` : ''}`
    : ''
  const fieldNote = publicSnapshot
    ? `${snapshotLabel(publicSnapshot)}${publicFieldStatusNote ? ` ${publicFieldStatusNote}` : ''}`
    : demoFieldSnapshot().coverageNote
  const fieldProvenanceNote = designPreview
    ? 'Synthetic radial preview for visual QA. Not public activity; observed sources remain unchanged. Surface shading · glow off.'
    : fieldView === 'personal'
      ? `This session: ${personalActivity.visits.length} eligible visits · ${unplacedPersonalVisitCount(personalActivity)} without a topic destination. Nothing is shared.`
      : publicSnapshot
        ? `${fieldNote} Adult or ineligible public records are filtered before rendering.`
        : `No public snapshot is available.${publicFieldStatusNote ? ` ${publicFieldStatusNote}` : ''} Design preview is synthetic and explicitly labeled.`

  useEffect(() => {
    if (!publicSnapshot || !selectedTopic || activeTopic === selectedTopic.label) return
    setActiveTopic(selectedTopic.label)
    localStorage.setItem(topicKey, selectedTopic.label)
  }, [activeTopic, publicSnapshot, selectedTopic])
  const isBookmarked = useMemo(
    () => bookmarks.some((bookmark) => bookmark.url === panel.url),
    [bookmarks, panel.url],
  )
  // The address the toolbar shows: the page's, or the one a tab is loading before its first page arrives.
  const shownAddress = panel.pendingUrl ?? panel.url
  const isSecureOrigin = shownAddress.startsWith('https:')
  const onStartPage = panel.isVisible && panel.isStartPage === true
  // Pages side by side: the side not in focus whose error or start page the shell draws in its half.
  const otherSide = shellDrawnSide(panel.split)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (): void => setReduceMotion(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const unsubscribe = window.intoponet.browserHost.subscribe((event) => {
      if (event.type === 'tab-rail-state') {
        if (!event.expanded) {
          setRailExpanded(false)
          setRailPeek(false)
        }
        return
      }
      if (event.type === 'tab-sidebar-edge') {
        setRailPeek(true)
        return
      }
      if (event.type === 'tab-switcher') {
        tabSwitcherOpen.current = event.open
        setTabSwitcherAnnouncement(event.open && event.selected ? `${event.selected}, tab ${event.position ?? 1} of ${event.count ?? 1}` : '')
        return
      }
      if (event.type === 'address-copied') {
        setAddressCopied(event.cleaned ? 'Address copied · tracking removed' : 'Address copied')
        if (addressCopiedTimer.current !== null) window.clearTimeout(addressCopiedTimer.current)
        // In full width the toolbar is tucked away: bring it out so the confirmation is seen, then tuck it again.
        setChromeRevealed(true)
        addressCopiedTimer.current = window.setTimeout(() => {
          setAddressCopied('')
          if (!document.querySelector('.browser-chrome:hover, .browser-chrome:focus-within')) setChromeRevealed(false)
        }, 1_800)
        return
      }
      if (event.type === 'chrome-state') {
        setChromeRevealed(event.revealed)
        if (!event.revealed) {
          setChromeHeld(false)
          setMoreToolsOpen(false)
        }
        return
      }
      if (event.type === 'shortcut') {
        if (event.action === 'new-tab') shortcutHandlers.current.newTab()
        else if (event.action === 'find') shortcutHandlers.current.find()
        else if (event.action === 'find-next' || event.action === 'find-previous') shortcutHandlers.current.findAgain(event.action === 'find-next')
        else if (event.action === 'open-settings') shortcutHandlers.current.openSettings()
        else if (event.action === 'bookmark') shortcutHandlers.current.bookmark()
        else if (event.action === 'next-tab' || event.action === 'previous-tab') void window.intoponet.browserHost.cycleTabs(event.action === 'next-tab' ? 'next' : 'previous')
        else if (event.action === 'focus-launcher') shortcutHandlers.current.focusAddress()
        else if (event.action === 'capture') shortcutHandlers.current.capture()
        else if (event.action === 'toggle-private') shortcutHandlers.current.togglePrivate()
        else if (event.action === 'absorb-selection') shortcutHandlers.current.absorbSelection()
        else if (event.action === 'toggle-tab-sidebar') shortcutHandlers.current.toggleSidebar()
        else if (event.action === 'command-menu') shortcutHandlers.current.commandMenu()
        else shortcutHandlers.current.toggleBookmarksPane()
        return
      }
      if (event.type === 'panel-state') {
        setPanel(event.panel)
        setError('')
        return
      }
      if (event.type === 'frequency-visit') {
        // No interest signals when footprints are off (private tabs never send them).
        if (!privacySettingsRef.current.footprints) return
        if (seenFrequencyNavigationIds.current.has(event.navigationId)) return
        seenFrequencyNavigationIds.current.add(event.navigationId)
        if (seenFrequencyNavigationIds.current.size > 1_024) {
          seenFrequencyNavigationIds.current = new Set([...seenFrequencyNavigationIds.current].slice(-512))
        }
        const topicId = (researchTopicRef.current ?? 'General browsing').trim().slice(0, 160)
        const eligibility = evaluateFrequencyEligibility({
          url: event.url,
          title: event.title,
          topic: topicId,
          rating: event.rating,
        })
        setPersonalActivity((current) => recordPersonalVisit(current, {
          url: event.url,
          title: event.title,
          topicId,
          timestamp: new Date().toISOString(),
          eligible: eligibility.eligible,
          topicLocation: topicLocationsRef.current[topicId] ?? null,
        }).state)
        return
      }
      if (event.type === 'find-result') {
        setFindResult(event)
        return
      }
      if (event.type === 'pdf-export') {
        setPdfStatus(event.event)
        if (event.event.state === 'saved') { pdfSavedRef.current(event.event); setSavedPdfVersion((value) => value + 1) }
        return
      }
      if (event.type === 'download-finished') {
        if (event.state === 'completed') {
          setNotice(`Saved ${event.filename} to Downloads`)
        } else {
          setError(`${event.filename} did not finish downloading.`)
        }
        return
      }
      if (event.type === 'protection-state') {
        setProtection(event.protection)
        return
      }
      if (event.type === 'tabs') {
        const nextActiveTabId = event.tabs.find((tab) => tab.active)?.id ?? null
        if (activeTabId.current && nextActiveTabId && activeTabId.current !== nextActiveTabId) {
          setQuery('')
        }
        activeTabId.current = nextActiveTabId
        setTabs(event.tabs)
        return
      }
      if (event.type === 'navigation-started') {
        if (launcherClear.current.started(event.url)) setQueryNow('')
        return
      }
      if (event.type === 'navigation-failed') {
        setError(`${event.reason} (${event.url})`)
        return
      }
      if (event.type === 'news-digest') {
        setNewsDigest(parseNewsDigest(event.payload))
      }
      if (event.type === 'field-snapshot') {
        setPublicSnapshot(parseFieldSnapshot(event.payload))
        return
      }
      if (event.type === 'public-field-status') {
        publicFieldStatusEvents.current += 1
        setPublicFieldStatus(event.status)
      }
    })
    void window.intoponet.browserHost.getState().then(setPanel)
    void window.intoponet.browserHost.getProtection().then(setProtection)
    void window.intoponet.browserHost.getTabs().then((nextTabs) => {
      activeTabId.current = nextTabs.find((tab) => tab.active)?.id ?? null
      setTabs(nextTabs)
    })
    void window.intoponet.browserHost.getNewsDigest().then((payload) => {
      if (payload) setNewsDigest((current) => current ?? parseNewsDigest(payload))
    })
    void window.intoponet.browserHost.getFieldSnapshot().then((payload) => {
      if (payload) setPublicSnapshot(parseFieldSnapshot(payload))
    })
    void window.intoponet.browserHost.getPublicFieldStatus().then((status) => {
      if (publicFieldStatusEvents.current === 0) setPublicFieldStatus(status)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!panel.url || !/^https?:\/\//.test(panel.url)) return
    // An address that failed to load (a typo, a site that is down) is not a page visited, and would come back
    // as an address bar completion. Nor is one still loading, before any page has arrived (isPending).
    if (panel.loadError || panel.isPending) return
    // Nor is a page in a private tab, or the tour's own page (it leaves no trace).
    if (panel.isPrivate || panel.untracked || !privacySettings.footprints || isExcludedSite(panel.url, privacyState?.excludedSites ?? [])) return
    setRecents((current) =>
      rememberRecent(current, {
        url: panel.url,
        title: panel.title || originLabel(panel.url),
        visitedAt: new Date().toISOString(),
      }),
    )
  }, [panel.title, panel.url, panel.loadError, panel.isPending, panel.isPrivate, panel.untracked, privacySettings.footprints, privacyState?.excludedSites])

  useEffect(() => {
    void window.intoponet.passwords.pageState().then(setPasswordState, () => undefined)
    return window.intoponet.passwords.subscribe((event) => {
      if (event.type === 'page-state') setPasswordState(event.state)
    })
  }, [])
  useEffect(() => setPasswordPicking(false), [passwordState?.origin])
  // The bookmark offer is for the site just signed in to; leaving it drops the offer.
  useEffect(() => {
    setBookmarkSiteOffer((current) => (current && passwordState?.origin && !current.url.startsWith(`${passwordState.origin}/`) ? null : current))
  }, [passwordState?.origin])
  // Sites asking for camera, microphone, location, notifications or the clipboard.
  useEffect(() => {
    void window.intoponet.sitePermissions.pending().then(setPermissionRequests, () => undefined)
    return window.intoponet.sitePermissions.subscribe((event) => {
      if (event.type === 'request') setPermissionRequests((current) => [...current, event.request])
      else if (event.type === 'resolved') setPermissionRequests((current) => current.filter((item) => item.id !== event.id))
    })
  }, [])
  const pageOrigin = (() => { try { return panel.url ? new URL(panel.url).origin : '' } catch { return '' } })()
  useEffect(() => {
    if (!shieldOpen || !/^https?:/.test(pageOrigin)) return
    void window.intoponet.sitePermissions.list(pageOrigin).then(setSitePermissionMap, () => setSitePermissionMap({}))
    return window.intoponet.sitePermissions.subscribe((event) => {
      if (event.type === 'changed' && event.origin === pageOrigin) void window.intoponet.sitePermissions.list(pageOrigin).then(setSitePermissionMap, () => undefined)
    })
  }, [shieldOpen, pageOrigin])

  // Leaving a site out also forgets what was already kept from it, however the list was changed.
  const excludedKey = (privacyState?.excludedSites ?? []).join('|')
  useEffect(() => {
    const sites = privacyState?.excludedSites ?? []
    if (!sites.length) return
    setRecents((current) => {
      const next = current.filter((page) => !isExcludedSite(page.url, sites))
      return next.length === current.length ? current : next
    })
  }, [excludedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Private browsing state from the main process.
  useEffect(() => {
    void window.intoponet.privacy.state().then(setPrivacyState, () => undefined)
    return window.intoponet.privacy.subscribe(setPrivacyState)
  }, [])

  // Retention: drop recent pages older than the chosen window (checked hourly).
  useEffect(() => {
    const prune = (): void => setRecents((current) => {
      const next = pruneRecents(current, privacySettings.retentionDays)
      if (next.length === current.length) return current
      writeRecents(next)
      return next
    })
    prune()
    const timer = window.setInterval(prune, 3_600_000)
    return () => window.clearInterval(timer)
  }, [privacySettings.retentionDays])

  useEffect(() => {
    let cancelled = false
    void window.intoponet.browserHost
      .readPrivateLibrary()
      .then((result) => {
        if (cancelled) return
        if (result.status === 'error') {
          const reason = {
            'encryption-unavailable':
              'On-device encryption is unavailable, so the saved private library could not be opened.',
            'decrypt-failed': 'The saved private library could not be decrypted.',
            'reencrypt-failed':
              'The saved private library opened, but its encryption could not be refreshed.',
          }[result.reason]
          setLibraryReadError(`${reason} Existing data was left untouched, and changes will not be autosaved. Confirm Delete library to reset it.`)
          return
        }
        const parsed = parseStoredPrivateLibrary(result.payload)
        if (parsed.status === 'invalid') {
          setLibraryReadError('The saved private library has an unsupported or damaged format. Existing data was left untouched, and changes will not be autosaved. Confirm Delete library to reset it.')
          return
        }
        if (parsed.status === 'valid') {
          // An old plain-text copy (earlier versions) is merged in before it is deleted, so nothing is lost.
          const library = hasLegacyLibraryStorage()
            ? mergePrivateLibraries(parsed.library, { schema: privateLibrarySchema, bookmarks: readBookmarks(), collections: readCollections(), recents: readRecents(), absorbed: [] }).library
            : parsed.library
          setBookmarks(library.bookmarks)
          setCollections(library.collections)
          setRecents(pruneRecents(library.recents, privacySettingsRef.current.retentionDays))
          setAbsorbed(library.absorbed)
          writeBookmarks(parsed.library.bookmarks)
          writeCollections(parsed.library.collections)
        }
        setLibraryReadError('')
        setError('')
        setLibraryReady(true)
      })
      .catch(() => {
        if (!cancelled) {
          setLibraryReadError('The saved private library could not be read. Existing data was left untouched, and changes will not be autosaved. Confirm Delete library to reset it.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Full-screen toolbar auto-hide: main tucks it away when the pointer
  // enters the page; it also hides the traffic lights while tucked.
  useEffect(() => {
    void window.intoponet.browserHost.setChromeRevealed(chromeRevealed, chromeRevealed && chromeHeld)
  }, [chromeHeld, chromeRevealed])

  useEffect(() => {
    if (!fullWidth || !panel.isVisible) {
      setChromeRevealed(false)
      setChromeHeld(false)
    }
  }, [fullWidth, panel.isVisible])

  // An expanded (unpinned) tab rail collapses when the pointer enters the page.
  useEffect(() => {
    void window.intoponet.browserHost.setTabRailExpanded((railExpanded || railPeek) && !railPinned)
  }, [railExpanded, railPeek, railPinned])

  // A hidden sidebar comes back when the pointer rests at the window's left edge (main watches the
  // edge when a full-width page covers it), and goes again once the pointer moves well away from it.
  useEffect(() => {
    if (sidebar.mode !== 'hidden' || !panel.isVisible || tabs.length === 0) return
    let timer: number | null = null
    const onMove = (event: MouseEvent): void => {
      if (railPeek) {
        const rail = document.querySelector('.tab-rail')?.getBoundingClientRect()
        if (rail && event.clientX > rail.right + 24) setRailPeek(false)
        return
      }
      if (event.clientX <= 6) {
        timer ??= window.setTimeout(() => setRailPeek(true), 300)
      } else if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
    }
    document.addEventListener('mousemove', onMove)
    return () => {
      document.removeEventListener('mousemove', onMove)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [sidebar.mode, panel.isVisible, tabs.length, railPeek])

  // Keep Finder capture folders named after the bookmark groups.
  useEffect(() => {
    if (!libraryReady) return
    void window.intoponet.captures.syncGroups(collections.map(({ id, label }) => ({ id, label }))).catch(() => undefined)
  }, [collections, libraryReady])

  useEffect(() => {
    if (!libraryReady) return
    const payload = serializePrivateLibrary({
      schema: privateLibrarySchema,
      bookmarks,
      collections,
      recents,
      absorbed,
    })
    void window.intoponet.browserHost.writePrivateLibrary(payload).then(() => {
      // The encrypted library now holds everything: drop the old plain-text copy (one-time migration).
      if (hasLegacyLibraryStorage()) clearLegacyLibraryStorage()
    }, (error: unknown) => {
      if (sealWarned.current) return
      sealWarned.current = true
      const reason = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : ''
      setNotice(`Your private library could not be saved on this Mac${reason ? ` (${reason.replace(/\.$/, '')})` : ''}. Recent changes are only in this window.`)
    })
  }, [absorbed, bookmarks, collections, libraryReady, recents])

  useEffect(() => {
    if (!panel.isVisible || !panelBody.current) return
    const body = panelBody.current
    const updateBounds = (): void => {
      const bounds = body.getBoundingClientRect()
      const inset = fullWidth ? 0 : 12
      const x = Math.ceil(bounds.x) + inset
      const y = Math.ceil(bounds.y)
      const width = Math.floor(bounds.right) - x - inset
      const height = Math.floor(bounds.bottom) - y - inset
      void window.intoponet.browserHost.setBounds({
        x,
        y,
        width: Math.max(280, width),
        height: Math.max(180, height),
      })
    }
    const observer = new ResizeObserver(updateBounds)
    observer.observe(body)
    if (body.parentElement) observer.observe(body.parentElement)
    window.addEventListener('resize', updateBounds)
    const frame = requestAnimationFrame(updateBounds)
    updateBounds()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', updateBounds)
    }
  }, [findOpen, translateOpen, pageAccess, fullWidth, panel.isVisible, shieldOpen])

  useLayoutEffect(() => {
    const el = tabStrip.current
    if (!el) return
    const measure = (): void => {
      const overflow = el.scrollWidth > el.clientWidth + 1
      setTabEdges({
        overflow,
        atStart: el.scrollLeft <= 2,
        atEnd: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
      })
    }
    measure()
    el.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
    return () => {
      el.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [panel.isVisible, tabs])

  useEffect(() => {
    if (!panel.isVisible) setShieldOpen(false)
  }, [panel.isVisible])

  const pageWasOpen = useRef(false)
  useEffect(() => {
    if (pageWasOpen.current && !panel.isVisible) {
      input.current?.focus()
    }
    pageWasOpen.current = panel.isVisible
  }, [panel.isVisible])

  const scrollTabs = (direction: -1 | 1): void => {
    tabStrip.current?.scrollBy({ left: direction * 180, behavior: 'smooth' })
  }

  const closeFind = (): void => {
    setFindOpen(false)
    setFindQuery('')
    setFindResult(null)
    void window.intoponet.browserHost.stopFind()
  }

  const openFind = (): void => {
    if (!panel.isVisible) return
    setFindOpen(true)
    requestAnimationFrame(() => findInput.current?.focus())
  }

  // The recent-tabs switcher with the shell focused: releasing ⌃ shows the highlighted tab, Escape keeps this one.
  useEffect(() => {
    const onKeyUp = (event: KeyboardEvent): void => {
      if (tabSwitcherOpen.current && event.key === 'Control') void window.intoponet.browserHost.tabSwitcher('commit')
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (tabSwitcherOpen.current && event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        void window.intoponet.browserHost.tabSwitcher('cancel')
      }
    }
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (pinEditor || captureSession || viewerId) return
      const key = event.key.toLowerCase()
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.shiftKey && key === 's') {
        event.preventDefault()
        void startCapture('image')
        return
      }
      // ⌘T, ⌘W, ⌘L, ⌘F, ⌘G, ⌘D, ⌘P, ⌘R, ⌘[ ⌘], zoom, ⌃Tab, ⌘1–9…: menu bar items (main/appMenu.ts).
      // ⇧⌘C (⌥⇧⌘C: exactly as it is) while the shell has focus; in a page, main handles the key.
      if (meta && event.shiftKey && event.code === 'KeyC' && panel.url && !isTypingTarget(event.target)) {
        event.preventDefault()
        void window.intoponet.browserHost.copyPageAddress(!event.altKey)
      }
      if (!meta && !panel.isVisible && event.key === '[') {
        event.preventDefault()
        rememberScale(zoomTowardEarth(scale))
      }
      if (!meta && !panel.isVisible && event.key === ']') {
        event.preventDefault()
        rememberScale(zoomTowardTopic(scale))
      }
      if (
        !meta &&
        !panel.isVisible &&
        !libraryOpen &&
        !isTypingTarget(event.target) &&
        (event.key === 'ArrowLeft' ||
          event.key === 'ArrowRight' ||
          event.key === 'ArrowUp' ||
          event.key === 'ArrowDown')
      ) {
        event.preventDefault()
        const direction =
          event.key === 'ArrowLeft'
            ? 'left'
            : event.key === 'ArrowRight'
              ? 'right'
              : event.key === 'ArrowUp'
                ? 'up'
                : 'down'
        const next = nudgeOrbit(pose, direction)
        setPose(next)
        writeExplorationState({
          scale,
          geographicAnchor: focusedMapAnchor.current ?? defaultAnchor(selectedTopicLabel),
          selectedTopicId: selectedTopicId ?? activeTopic,
          pose: next,
        })
      }
      if (event.key === 'Escape' && fullWidth) {
        event.preventDefault()
        setBrowserFullWidth(false)
      } else if (event.key === 'Escape' && shieldOpen) {
        event.preventDefault()
        setShieldOpen(false)
      } else if (event.key === 'Escape' && findOpen) {
        event.preventDefault()
        closeFind()
      } else if (event.key === 'Escape' && libraryOpen) {
        setLibraryOpen(false)
      } else if (event.key === 'Escape' && bookmarksOpen) {
        setBookmarksOpen(false)
      } else if (event.key === 'Escape' && panel.isVisible) {
        void window.intoponet.browserHost.close()
      } else if (event.key === 'Escape' && absorb) {
        cancelAbsorb()
      } else if (event.key === 'Escape' && knowledgeView) {
        closeKnowledge()
      } else if (event.key === 'Escape' && olds && !isTypingTarget(event.target)) {
        closeOlds()
      } else if (event.key === 'Escape' && selectedSignalId && !isTypingTarget(event.target)) {
        setSelectedSignalId(null)
      } else if (event.key === 'Escape' && scale !== 'earth') {
        rememberScale(zoomTowardEarth(scale))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTopic, bookmarks, bookmarksOpen, captureSession, viewerId, findOpen, fullWidth, libraryOpen, panel.canGoBack, panel.canGoForward, panel.isVisible, panel.url, pinEditor, pose, scale, selectedSignalId, olds, absorb, knowledgeView, selectedTopicId, selectedTopicLabel, shieldOpen, tabs.length])

  const rememberScale = (
    next: ExplorationScale,
    radius = scaleDistance[next],
    topic = activeTopic,
  ): void => {
    if (shouldSnapshotBeforeTopic(scale, next)) {
      topicReturnPose.current = pose
    }
    const restored = restoreAfterTopic(scale, next, topicReturnPose.current)
    const anchor = focusedMapAnchor.current ?? defaultAnchor(topic)
    const topicId = availableTopics.find((option) => option.id === topic || option.label === topic)?.id ?? topic
    const aim = latLonToOrbit(anchor.lat, anchor.lon)
    const nextPose = restored ?? {
      theta: next === 'earth' ? pose.theta : aim.theta,
      phi: next === 'earth' ? pose.phi : aim.phi,
      radius,
    }
    setScale(next)
    writeScale(next)
    setPose(nextPose)
    writeExplorationState({
      scale: next,
      geographicAnchor: anchor,
      selectedTopicId: topicId,
      pose: nextPose,
    })
  }

  const rememberTopic = (topic: string): void => {
    focusedMapAnchor.current = null
    setActiveTopic(topic)
    setResearchTopic(topic)
    localStorage.setItem(topicKey, topic)
    rememberScale('topic', scaleDistance.topic, topic)
  }

  /**
   * Shared by the field launcher and the full-screen dock search. `clear`: Enter in the address bar,
   * which clears it once the navigation has started (launcherClear.ts).
   */
  const navigateFromLauncher = (raw: string, options: { intent?: NavigationIntent; disposition?: OpenDisposition; clear?: boolean } = {}): Promise<void> => {
    const value = raw.trim()
    if (!value) return Promise.resolve()
    setError('')
    let intent: ReturnType<typeof inferUnifiedLauncherIntent>
    try {
      intent = options.intent ?? inferUnifiedLauncherIntent(value, launcherTopics)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not understand that search or address.')
      return Promise.reject(reason)
    }
    let started: string | null = null
    try {
      started = intent.kind === 'topic' ? null : resolveNavigationIntent(intent)
    } catch {
      started = null
    }
    const ticket = options.clear ? launcherClear.current.submit(started) : 0
    const settled = (): void => {
      if (options.clear && launcherClear.current.settled(ticket)) setQueryNow('')
    }
    if (intent.kind === 'topic') {
      rememberTopic(intent.value)
      setBrowserFullWidth(false)
      void window.intoponet.browserHost.close()
      settled()
      return Promise.resolve()
    }
    // A search tags what is browsed and saved next with its words; one made privately leaves nothing behind.
    if (intent.kind === 'search' && !privacyState?.privateMode && !panel.isPrivate) setResearchTopic(intent.value)
    return window.intoponet.browserHost.open(intent, options.disposition).then(settled, (reason: unknown) => {
      if (options.clear) launcherClear.current.failed(ticket)
      setError(navigationErrorMessage(reason))
      throw reason
    })
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (omnibox.submit()) return
    void navigateFromLauncher(query, { clear: true }).catch(() => undefined)
  }

  const setBookmarksOpen = (open: boolean): void => {
    setBookmarksOpenState(open)
    if (open) setLibraryOpen(false)
    try { localStorage.setItem(bookmarkPaneOpenKey, open ? '1' : '0') } catch { /* convenience only */ }
  }

  const toggleBookmarksPane = (): void => setBookmarksOpen(!bookmarksOpen)

  /** + in the tab rail and ⌘T: a new tab on the start page, made active at once. */
  const openNewTab = (): void => {
    setError('')
    void window.intoponet.browserHost.newTab().catch(() => setError('A new tab could not be opened.'))
  }

  /** From a start page: a search or address opens in that same tab. */
  const submitFromStartPage = (value: string): Promise<void> => {
    setError('')
    let intent: ReturnType<typeof inferLauncherIntent>
    try {
      intent = inferLauncherIntent(value, 'search')
    } catch (reason) {
      setError('Could not understand that search or address.')
      return Promise.reject(reason)
    }
    if (intent.kind === 'search' && !privacyState?.privateMode && !panel.isPrivate) setResearchTopic(intent.value)
    return window.intoponet.browserHost.open(intent).catch((reason: unknown) => {
      setError(navigationErrorMessage(reason))
      throw reason
    })
  }

  /** ⌘L: the dock search in full screen, otherwise the field launcher. */
  const focusAddress = (): void => {
    if (fullWidth && panel.isVisible && tabs.length > 0) {
      setDockFocusRequest((count) => count + 1)
      return
    }
    if (panel.url) setQuery(panel.url)
    input.current?.focus()
    input.current?.select()
  }

  const captureGroups = useMemo(
    () => [...collections.map((collection) => ({ id: collection.id, label: collection.label })), { id: UNSORTED_GROUP_ID, label: 'Unsorted' }],
    [collections],
  )

  pdfSavedRef.current = (saved) => {
    if (!saved.groupId || saved.isPrivate) return
    const savedAt = new Date().toISOString()
    setBookmarks((current) => {
      const existing = current.find((bookmark) => bookmark.url === saved.url)
      const next = upsertBookmark(current, {
        url: saved.url,
        title: existing?.title || saved.title || originLabel(saved.url),
        topic: existing?.topic || (researchTopic ?? activeTopic),
        savedAt: existing?.savedAt || savedAt,
        pdf: { path: saved.path, savedAt },
      })
      writeBookmarks(next)
      return next
    })
    if (saved.groupId !== UNSORTED_GROUP_ID && collections.some((collection) => collection.id === saved.groupId)) {
      setCollections((current) => {
        const next = moveBookmarkToGroup(current, saved.url, UNSORTED_GROUP_ID, saved.groupId)
        writeCollections(next)
        return next
      })
    }
  }

  // A finished save stays up for a while, then the bar goes (unless its options are open).
  useEffect(() => {
    if (!pdfStatus || pdfStatus.state === 'working' || pdfOptionsOpen) return
    const timer = setTimeout(() => setPdfStatus(null), pdfStatus.state === 'saved' ? 20_000 : 30_000)
    return () => clearTimeout(timer)
  }, [pdfStatus, pdfOptionsOpen])

  const groupLabel = (groupId: string | null): string =>
    collections.find((collection) => collection.id === groupId)?.label ?? 'Unsorted'

  /** Default group: the current page's bookmark group, else the last one used. */
  const defaultCaptureGroup = (): string => {
    if (panel.url && bookmarks.some((bookmark) => bookmark.url === panel.url)) {
      const group = groupOf(collections, panel.url)
      if (group !== UNSORTED_GROUP_ID) return group
    }
    let last: string | null = null
    try { last = localStorage.getItem(captureGroupKey) } catch { /* convenience only */ }
    return last && collections.some((collection) => collection.id === last) ? last : UNSORTED_GROUP_ID
  }

  const showCaptureSaved = (record: CaptureRecord): void => {
    const bounds = lastCaptureBounds.current
    const anchor = bounds
      ? { x: bounds.x + bounds.width / 2, y: Math.max(8, bounds.y - 45) }
      : { x: window.innerWidth / 2, y: 12 }
    setCaptureToast({ record, groupLabel: groupLabel(record.groupId), anchor })
    setFreshCaptureId(record.id)
    window.setTimeout(() => setFreshCaptureId((current) => (current === record.id ? null : current)), 1600)
  }

  const recorder = useRecorder(showCaptureSaved, (message) => setError(message))

  const startCapture = async (mode: CaptureMode = 'image'): Promise<void> => {
    if (captureSession || recorder.state.status !== 'idle') return
    // An error page is drawn here, over a blank view: there is no page to capture.
    if (!panel.isVisible || !panel.url || panel.loadError) {
      setNotice('Open a page to capture it')
      return
    }
    closeFind()
    setShieldOpen(false)
    try {
      const pending = await window.intoponet.captures.begin()
      lastCaptureBounds.current = pending.viewBounds
      setCaptureSession({ pending, mode })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This page could not be captured.')
    }
  }

  const finishCaptureSession = (mode: CaptureMode, crop: CaptureCrop, groupId: string): void => {
    const session = captureSession
    if (!session) return
    try { localStorage.setItem(captureGroupKey, groupId) } catch { /* convenience only */ }
    const group = groupId === UNSORTED_GROUP_ID ? null : groupId
    setCaptureSession(null)
    if (mode === 'video') {
      void recorder.start(session.pending.pendingId, crop, group)
      return
    }
    void window.intoponet.captures.saveImage(session.pending.pendingId, crop, group)
      .then(showCaptureSaved)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'The screenshot could not be saved.'))
  }

  const cancelCaptureSession = (): void => {
    const session = captureSession
    setCaptureSession(null)
    if (session) void window.intoponet.captures.cancel(session.pending.pendingId)
  }

  const moveCapture = (id: string, groupId: string | null): void => {
    void window.intoponet.captures.update(id, { groupId }).catch(() => setError('The capture could not be moved.'))
  }

  const setPrivateMode = (on: boolean): void => {
    void window.intoponet.privacy.setPrivateMode(on).then((state) => {
      setPrivacyState(state)
      setNotice(on ? 'Private browsing on: new tabs leave no footprints.' : 'Private browsing off: private tabs closed and their session wiped.')
    }, () => setError('Private browsing could not be changed.'))
  }
  const setBackupExclusion = (on: boolean): void => {
    void window.intoponet.privacy.setBackupExclusion(on).then(setPrivacyState, () => setError('The Time Machine setting could not be changed.'))
  }
  const updatePrivacySettings = (next: PrivacySettings): void => {
    setPrivacySettingsState(next)
    writePrivacySettings(next)
  }
  const deleteFootprints = (): void => {
    setRecents([])
    writeRecents([])
    setPersonalActivity(emptyPersonalActivity)
    void window.intoponet.history.clear().catch(() => undefined)
    setNotice('Footprints deleted: recent pages, history and interest signals.')
  }
  const toggleHiddenPin = (url: string): void => {
    setBookmarks((current) => {
      const next = current.map((bookmark) => {
        if (bookmark.url !== url) return bookmark
        if (bookmark.hiddenOnMap) {
          const { hiddenOnMap: _hidden, ...rest } = bookmark
          return rest
        }
        return { ...bookmark, hiddenOnMap: true }
      })
      writeBookmarks(next)
      return next
    })
  }
  const mergeCollectionInto = (fromId: string, intoId: string): void => {
    setCollections((current) => {
      const next = mergeCollections(current, fromId, intoId)
      writeCollections(next)
      return next
    })
    setExpandedCollection(intoId)
  }
  const splitCollection = (id: string): void => {
    setCollections((current) => {
      const next = splitCollectionBySite(current, id)
      writeCollections(next)
      return next
    })
  }

  shortcutHandlers.current = { find: () => { if (panel.isVisible && !panel.isStartPage) openFind() }, findAgain: (forward) => { if (!panel.isVisible || panel.isStartPage) return; if (findOpen && findQuery.trim()) runFind(true, forward); else openFind() }, openSettings: () => setSettingsOpen(true), bookmark: () => { if (panel.isVisible && panel.url) toggleBookmark() }, newTab: openNewTab, focusAddress, toggleBookmarksPane, capture: () => void startCapture('image'), togglePrivate: () => setPrivateMode(!(privacyState?.privateMode ?? false)), absorbSelection: () => startAbsorb('selection'), toggleSidebar, commandMenu: () => openCommandMenu() }

  const saveCurrentToGroup = (groupId: string): void => {
    if (!panel.url) return
    persistBookmarks(upsertBookmark(bookmarks, {
      url: panel.url,
      title: panel.title || originLabel(panel.url),
      topic: researchTopic ?? activeTopic,
      savedAt: new Date().toISOString(),
    }))
    if (groupId !== UNSORTED_GROUP_ID) {
      persistCollections(moveBookmarkToGroup(collections, panel.url, UNSORTED_GROUP_ID, groupId))
    }
  }

  /** After a password is saved: offer to bookmark the site, unless it already is. */
  const offerBookmarkForSite = (origin: string): void => {
    const url = `${origin}/`
    if (bookmarks.some((bookmark) => bookmark.url === url || (panel.url && bookmark.url === panel.url))) return
    setBookmarkSiteOffer({ url, title: siteLabel(origin), site: siteLabel(origin) })
  }

  const bookmarkSiteToGroup = (offer: BookmarkSiteOffer, group: { id: string } | { label: string }): void => {
    persistBookmarks(upsertBookmark(bookmarks, { url: offer.url, title: offer.title, topic: activeTopic, savedAt: new Date().toISOString() }))
    let next = collections
    let groupId: string
    let label: string
    if ('id' in group) {
      groupId = group.id
      label = collections.find((collection) => collection.id === group.id)?.label ?? 'your bookmarks'
    } else {
      const existing = collections.find((collection) => collection.label.trim().toLowerCase() === group.label.toLowerCase())
      const collection = existing ?? createCollection(group.label)
      if (!existing) next = [...collections, collection]
      groupId = collection.id
      label = collection.label
    }
    persistCollections(moveBookmarkToGroup(next, offer.url, UNSORTED_GROUP_ID, groupId))
    setBookmarkSiteOffer(null)
    setNotice(`Bookmarked ${offer.site} in ${label}`)
  }

  const createBookmarkGroup = (label: string): string | null => {
    if (!label.trim()) return null
    const collection = createCollection(label)
    persistCollections([...collections, collection])
    return collection.id
  }

  /** A tab folder (and the folders in it) saved as private collections, each page bookmarked. */
  const saveTabFolder = (folderId: string): void => {
    const folder = tabFolders.find((item) => item.id === folderId)
    if (!folder) return
    const result = saveFolderAsCollections({ folderId, folders: tabFolders, tabs, bookmarks, collections, topic: folder.name })
    persistBookmarks(result.bookmarks)
    persistCollections(result.collections)
    sayInRail(result.saved ? `Saved ${result.saved} ${result.saved === 1 ? 'page' : 'pages'} from “${folder.name}” as a collection.` : `“${folder.name}” is already saved as a collection.`)
  }

  const openBookmarkFromPane = (bookmark: SavedBookmark): void => {
    rememberTopic(bookmark.topic)
    void window.intoponet.browserHost.open({ kind: 'url', value: bookmark.url }).catch((reason: unknown) => {
      setError(navigationErrorMessage(reason))
    })
  }

  const persistBookmarks = (next: SavedBookmark[]): void => {
    setBookmarks(next)
    writeBookmarks(next)
  }

  const persistCollections = (next: SavedCollection[]): void => {
    setCollections(next)
    writeCollections(next)
  }

  const keepExcerpt = (event: FormEvent): void => {
    event.preventDefault()
    const result = absorbPage({
      url: panel.url,
      title: panel.title || originLabel(panel.url),
      excerpt: absorbExcerpt,
      topic: activeTopic,
    })
    if ('error' in result) {
      setError(result.error)
      return
    }
    setError('')
    setAbsorbed((current) => [result, ...current.filter((item) => item.url !== result.url)])
    setAbsorbExcerpt('')
    setNotice('Absorbed on this device')
  }

  const importLibrary = async (file: File): Promise<void> => {
    if (!libraryReady) {
      setError('The private library is not open, so nothing was imported.')
      return
    }
    if (file.size > 20_000_000) {
      setError('That file is too large to be an Intoponet library.')
      return
    }
    const incoming = parsePrivateLibrary(await file.text())
    if (!incoming) {
      setError('That file is not an Intoponet library export (intoponet-library.json). Nothing was imported.')
      return
    }
    const { library, added } = mergePrivateLibraries({ schema: privateLibrarySchema, bookmarks, collections, recents, absorbed }, incoming)
    setBookmarks(library.bookmarks)
    setCollections(library.collections)
    setRecents(library.recents)
    setAbsorbed(library.absorbed)
    const parts = [
      added.bookmarks && `${added.bookmarks} saved page${added.bookmarks === 1 ? '' : 's'}`,
      added.collections && `${added.collections} collection${added.collections === 1 ? '' : 's'}`,
      added.recents && `${added.recents} recent page${added.recents === 1 ? '' : 's'}`,
      added.absorbed && `${added.absorbed} excerpt${added.absorbed === 1 ? '' : 's'}`,
    ].filter(Boolean)
    setNotice(parts.length ? `Imported ${parts.join(', ')}. Pages you already had were kept, with any new tags added.` : 'Everything in that file was already in your library.')
  }

  /** Bookmarks from another browser (Settings › Import), merged like an imported library file. */
  const importBrowserLibrary = (payload: string) => {
    if (!libraryReady) return null
    const merged = mergeImportedLibrary({ schema: privateLibrarySchema, bookmarks, collections, recents, absorbed }, payload)
    if (!merged) return null
    setBookmarks(merged.library.bookmarks)
    setCollections(merged.library.collections)
    return merged.added
  }

  const exportLibrary = (): void => {
    const json = serializePrivateLibrary({
      schema: privateLibrarySchema,
      bookmarks,
      collections,
      recents,
      absorbed,
    })
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'intoponet-library.json'
    link.click()
    URL.revokeObjectURL(url)
    // Absorbed pages (text, places, citations) go in a second, JSON-LD file.
    if (knowledgeRecords.length) {
      void window.intoponet.knowledge.exportAll().then((jsonld) => {
        const knowledgeUrl = URL.createObjectURL(new Blob([jsonld], { type: 'application/ld+json' }))
        const knowledgeLink = document.createElement('a')
        knowledgeLink.href = knowledgeUrl
        knowledgeLink.download = 'intoponet-knowledge.jsonld'
        knowledgeLink.click()
        setTimeout(() => URL.revokeObjectURL(knowledgeUrl), 1_000)
      }).catch(() => setError('Absorbed pages could not be exported. The library file was saved.'))
    }
  }

  const deleteLibrary = async (): Promise<void> => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    try {
      await window.intoponet.browserHost.deletePrivateLibrary()
      await window.intoponet.captures.removeAll()
      await window.intoponet.knowledge.removeAll()
      setKnowledgeRecords([])
    } catch {
      setError('The private library could not be fully deleted. Some data may already have been removed; check the library and try again.')
      return
    }
    setBookmarks([])
    setCollections([])
    setRecents([])
    setAbsorbed([])
    writeBookmarks([])
    writeCollections([])
    clearLegacyLibraryStorage()
    setConfirmDelete(false)
    setLibraryReady(true)
    setLibraryReadError('')
    setViewerId(null)
    setNotice('Private library deleted. Captures were moved to the Trash.')
  }

  const toggleBookmark = (): void => {
    if (!panel.url) return
    persistBookmarks(
      isBookmarked
        ? bookmarks.filter((bookmark) => bookmark.url !== panel.url)
        : upsertBookmark(bookmarks, {
            url: panel.url,
            title: panel.title || originLabel(panel.url),
            topic: activeTopic,
            savedAt: new Date().toISOString(),
          }),
    )
  }

  /** Where a page is about: places in its title and address, then places in its absorbed text. */
  const pinSuggestionsFor = (title: string, url: string): Array<{ id: string; label: string; lat: number; lon: number }> => {
    let path = ''
    let host = ''
    try {
      const parsed = new URL(url)
      host = parsed.hostname.replace(/^www\./, '').split('.').slice(0, -1).join(' ')
      path = decodeURIComponent(`${parsed.pathname} ${parsed.hash}`).replace(/[_/#-]+/g, ' ')
    } catch {
      // Not a URL: title only.
    }
    const fromText = placesNamedIn(`${title} ${path}`, 4, host).map((place) => ({ id: place.id, label: placeLabel(place), lat: place.lat, lon: place.lon }))
    const absorbed = knowledgeRecords.find((record) => record.url.split('#')[0] === url.split('#')[0])
    const fromKnowledge = (absorbed?.places ?? []).slice(0, 3).map((place) => ({ id: `know:${place.name}:${place.countryCode}`, label: place.name, lat: place.lat, lon: place.lon }))
    const seen = new Set<string>()
    return [...fromText, ...fromKnowledge].filter((item) => {
      const key = item.label.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 5)
  }

  const openPinEditor = (bookmark?: SavedBookmark): void => {
    const currentBookmark = bookmark ?? bookmarks.find((item) => item.url === panel.url)
    const url = currentBookmark?.url ?? panel.url
    if (!url) return
    const topic = currentBookmark?.topic ?? researchTopic ?? 'General browsing'
    const topicLocation = topicLocations[topic]
    const anchor = currentBookmark
      ? currentBookmark.fieldAnchor
      : topicLocation ? { lat: topicLocation.lat, lon: topicLocation.lon, label: topicLocation.label } : undefined
    setPinEditor({
      originalUrl: url,
      restoreBrowser: panel.isVisible,
      restoreFullWidth: panel.isVisible && fullWidth,
      initial: {
        url,
        title: (currentBookmark?.title || panel.title || originLabel(url)).slice(0, 180),
        topic,
        ...(currentBookmark?.tags?.length ? { tags: currentBookmark.tags } : {}),
        note: currentBookmark?.note ?? '',
        ...(anchor ? { fieldAnchor: anchor } : {}),
      },
    })
    setSelectedPinUrl(url)
    setLibraryOpen(false)
    setFullWidth(false)
    void window.intoponet.browserHost.setFullWidth(false)
    if (panel.isVisible) {
      closeFind()
      pinBrowserClose.current = window.intoponet.browserHost.close()
    }
  }

  const finishPinEditor = (restoreBrowser: boolean, restoreFullWidth: boolean): void => {
    const closing = pinBrowserClose.current
    pinBrowserClose.current = null
    setPinEditor(null)
    setFullWidth(restoreBrowser && restoreFullWidth)
    void (async () => {
      await closing
      await window.intoponet.browserHost.setFullWidth(restoreBrowser && restoreFullWidth)
      if (restoreBrowser) await window.intoponet.browserHost.restore()
    })()
  }

  const savePin = (value: PinEditorValue): void => {
    if (!pinEditor) return
    const existing = bookmarks.find((bookmark) => bookmark.url === pinEditor.originalUrl)
    const bookmark: SavedBookmark = {
      url: value.url,
      title: value.title,
      topic: value.topic,
      tags: value.tags ?? [],
      savedAt: existing?.savedAt ?? new Date().toISOString(),
      note: value.note,
      ...(value.fieldAnchor ? { fieldAnchor: value.fieldAnchor } : {}),
    }
    const retained = bookmarks.filter((item) => item.url !== pinEditor.originalUrl)
    persistBookmarks(upsertBookmark(retained, bookmark))
    if (pinEditor.originalUrl !== value.url) {
      persistCollections(collections.map((collection) => ({
        ...collection,
        memberUrls: collection.memberUrls.map((url) => url === pinEditor.originalUrl ? value.url : url),
      })))
    }
    setSelectedPinUrl(value.url)
    finishPinEditor(pinEditor.restoreBrowser, pinEditor.restoreFullWidth)
  }

  const showPinOnGlobe = (bookmark: SavedBookmark): void => {
    const anchor = bookmark.fieldAnchor
    if (!anchor) return
    closeFind()
    setLibraryOpen(false)
    setShieldOpen(false)
    setActiveTopic(bookmark.topic)
    focusedMapAnchor.current = {
      id: `bookmark:${bookmark.url}`,
      label: anchor.label,
      lat: anchor.lat,
      lon: anchor.lon,
      radiusKm: PERSONAL_DISPLAY_RADIUS_KM,
    }
    localStorage.setItem(topicKey, bookmark.topic)
    if (shouldSnapshotBeforeTopic(scale, 'topic')) topicReturnPose.current = pose
    const aim = latLonToOrbit(anchor.lat, anchor.lon)
    const nextPose: OrbitPose = { ...aim, radius: scaleDistance.topic }
    setScale('topic')
    writeScale('topic')
    setPose(nextPose)
    writeExplorationState({
      scale: 'topic',
      geographicAnchor: { lat: anchor.lat, lon: anchor.lon },
      selectedTopicId: selectedTopicId ?? null,
      pose: nextPose,
    })
    if (panel.isVisible) void window.intoponet.browserHost.close()
  }

  const selectMapPin = (url: string): void => {
    setSelectedPinUrl(url)
    setLibraryOpen(true)
    setLibraryTab('locations')
  }

  const updateBookmarkNote = (url: string, note: string): void => {
    persistBookmarks(
      bookmarks.map((bookmark) =>
        bookmark.url === url ? { ...bookmark, note: note.slice(0, 500) } : bookmark,
      ),
    )
  }

  const updateAppSettings = (next: AppSettings): void => {
    setAppSettingsState(next)
    writeAppSettings(next)
    // The one switch covers headlines and titles too.
    if (next.autoTranslate !== appSettings.autoTranslate) setHeadlinesPref(next.autoTranslate)
  }
  const pageSite = panel.isVisible && panel.url ? siteKey(panel.url) : null
  const neverThisSite = !!panel.url && isNeverTranslated(panel.url, appSettings.neverTranslate)
  const setNeverSite = (never: boolean): void => {
    if (!pageSite) return
    // Turning a site back on translates the open page again.
    if (!never) for (const key of [...autoTried.current]) if (siteKey(key.split('|')[0]!) === pageSite) autoTried.current.delete(key)
    updateAppSettings(withNeverTranslate(appSettings, pageSite, never))
  }

  // Automatic translation (on by default): a page in another language is translated into yours as it
  // loads, in private tabs too (on this Mac; private page text is not kept in the translation cache).
  // A missing language downloads quietly first. "Original" sticks for that page (each page and language is tried once).
  const autoTried = useRef(new Set<string>())
  const livePageUrl = useRef(panel.url)
  livePageUrl.current = panel.url
  useEffect(() => {
    if (!translation.status || !panel.isVisible || !panel.url) return
    const page = translation.page
    if (page.status !== 'idle') return
    const key = `${panel.url.split('#')[0]}|${translation.target}`
    const plan = autoTranslatePlan({
      enabled: appSettings.autoTranslate,
      blocked: isNeverTranslated(panel.url, appSettings.neverTranslate),
      detected: page.detected,
      target: translation.target,
      supported: translation.supported,
      ready: translation.ready,
      alreadyTried: autoTried.current.has(key),
    })
    if (!plan) return
    autoTried.current.add(key)
    const url = panel.url
    void (async () => {
      const failed = plan.missing.length ? await translation.ensure(plan.missing, { urgent: true }) : []
      if (livePageUrl.current !== url) return
      if (failed.length) {
        setTranslateOpen(true) // the bar says what went wrong and offers to try again
        return
      }
      await translation.translatePage(plan.from, plan.to)
    })()
  }, [translation.page, translation.status, translation.target, panel.url, panel.isVisible, appSettings]) // eslint-disable-line react-hooks/exhaustive-deps
  // Settings closes with Escape, like the other panels.
  useEffect(() => {
    if (!settingsOpen) return
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setSettingsOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen])
  // When a header panel closes and focus was left nowhere, return it to that panel's button (keyboard and VoiceOver users keep their place).
  const panelFocus = useRef({ bookmarks: false, olds: false, knowledge: false, library: false, settings: false })
  useEffect(() => {
    const now = { bookmarks: bookmarksOpen, olds: !!olds, knowledge: !!knowledgeView, library: libraryOpen, settings: settingsOpen }
    const before = panelFocus.current
    const closed = (Object.keys(now) as Array<keyof typeof now>).find((key) => before[key] && !now[key])
    const opened = (Object.keys(now) as Array<keyof typeof now>).some((key) => now[key] && !before[key])
    panelFocus.current = now
    // A newly opened panel can close its predecessor in a second render. Do
    // not restore focus to that predecessor's header button while another
    // panel is already open; the new panel owns focus during a switch.
    if (!closed || opened || Object.values(now).some(Boolean)) return
    // After exit animations, which may move focus themselves.
    window.setTimeout(() => {
      // A new panel may have opened during the exit delay. In that case its
      // own focus target must win over this stale return target.
      if (Object.values(panelFocus.current).some(Boolean)) return
      const now = document.activeElement
      // Leave focus alone when it is somewhere outside the panel that is closing (a field, the tour that
      // closed the panel, the control that opened something else): only focus left nowhere comes back.
      const leaving = now?.closest('.olds-sheet, .knowledge-sheet, .knowledge-backdrop, .bookmark-drawer, .settings-drawer, .bm-surface')
      if (now && now !== document.body && !leaving) return
      // The tour opens and closes panels as it goes: while it is open, focus is its own.
      if (document.querySelector('.tour')) return
      document.querySelector<HTMLElement>(`[data-panel="${closed}"]`)?.focus()
    }, 350)
  }, [bookmarksOpen, olds, knowledgeView, libraryOpen, settingsOpen])

  // The beacon consent screen floats over the page too.
  useEffect(() => {
    if (!beaconDraft) return
    void window.intoponet.captures.setPageHidden(true)
    return () => { void window.intoponet.captures.setPageHidden(false) }
  }, [beaconDraft])

  // Settings floats over the page: hide the native page view while it is open.
  useEffect(() => {
    if (!settingsOpen) return
    void window.intoponet.captures.setPageHidden(true)
    return () => { void window.intoponet.captures.setPageHidden(false) }
  }, [settingsOpen])

  const showLibrary = (): void => {
    if (panel.isVisible) void window.intoponet.browserHost.close()
    setBookmarksOpen(false)
    setLibraryOpen(true)
  }

  const removeBookmark = (url: string): void => {
    persistBookmarks(bookmarks.filter((bookmark) => bookmark.url !== url))
    persistCollections(
      collections.map((collection) => ({
        ...collection,
        memberUrls: collection.memberUrls.filter((member) => member !== url),
      })),
    )
  }

  const openRecent = (page: RecentPage): void => {
    setLibraryOpen(false)
    const currentDraft = input.current?.value ?? ''
    void window.intoponet.browserHost.open({ kind: 'url', value: page.url }).then(() => {
      if (input.current?.value === currentDraft) setQuery('')
    })
  }

  const openBookmark = (bookmark: SavedBookmark): void => {
    rememberTopic(bookmark.topic)
    setLibraryOpen(false)
    const currentDraft = input.current?.value ?? ''
    void window.intoponet.browserHost.open({ kind: 'url', value: bookmark.url }).then(() => {
      if (input.current?.value === currentDraft) setQuery('')
    })
  }

  const addCollection = (event: FormEvent): void => {
    event.preventDefault()
    const label = collectionDraft.trim()
    if (!label) return
    persistCollections([...collections, createCollection(label)])
    setCollectionDraft('')
    setLibraryTab('collections')
  }

  const addPageToCollection = (collectionId: string): void => {
    if (!panel.url) return
    persistBookmarks(
      upsertBookmark(bookmarks, {
        url: panel.url,
        title: panel.title || originLabel(panel.url),
        topic: activeTopic,
        savedAt: new Date().toISOString(),
      }),
    )
    persistCollections(
      collections.map((collection) =>
        collection.id === collectionId && !collection.memberUrls.includes(panel.url)
          ? { ...collection, memberUrls: [...collection.memberUrls, panel.url] }
          : collection,
      ),
    )
  }

  const removeCollection = (id: string): void => {
    persistCollections(collections.filter((collection) => collection.id !== id))
    if (expandedCollection === id) setExpandedCollection('')
    if (renamingCollection === id) setRenamingCollection('')
  }

  const commitCollectionRename = (id: string): void => {
    persistCollections(renameCollection(collections, id, renameDraft))
    setRenamingCollection('')
  }

  const copyPageAddress = (): void => {
    if (!panel.url) return
    void window.intoponet.browserHost.copyPageAddress(true)
  }

  const setSiteProtection = (enabled: boolean): void => {
    void window.intoponet.browserHost.setSiteProtection(enabled).then(() => {
      void window.intoponet.browserHost.reload()
    })
  }

  const showEarth = (): void => {
    setFocusedPlace(null)
    setSelectedSignalId(null)
    focusedMapAnchor.current = null
    closeFind()
    setShieldOpen(false)
    setLibraryOpen(false)
    rememberScale('earth')
    void window.intoponet.browserHost.close()
    input.current?.focus()
  }

  const showRegion = (): void => {
    closeFind()
    setLibraryOpen(false)
    rememberScale('region')
    void window.intoponet.browserHost.close()
  }

  const showCity = (): void => {
    closeFind()
    setLibraryOpen(false)
    rememberScale('city')
    void window.intoponet.browserHost.close()
  }

  const fillLauncherFromPage = (): void => {
    if (!shownAddress) return
    setQuery(shownAddress)
    input.current?.focus()
    input.current?.select()
  }

  const runFind = (findNext = false, forward = true): void => {
    if (!findQuery.trim()) return
    void window.intoponet.browserHost.find(findQuery, { findNext, forward })
  }

  const toggleDesignPreview = (): void => {
    if (designPreview) {
      setDiagnosticsOpen(false)
      setOrganicMetrics(null)
    }
    setDesignPreview((current) => !current)
  }

  const clearPersonalActivity = (): void => {
    setPersonalActivity(emptyPersonalActivity)
    setResearchTopic(null)
    setTopicLocations({})
  }

  // ---- Living globe ------------------------------------------------------
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const publicGlobe = fieldView === 'public' && !designPreview
  const selectedSignal = useMemo(
    () => (selectedSignalId ? allGlobeSignals.find((signal) => signal.id === selectedSignalId) ?? null : null),
    [allGlobeSignals, selectedSignalId],
  )
  const pinMarkers = useMemo<GlobeMarker[]>(() => globePrefs.pins /* managed from My map › Privacy and per pin in Locations */
    ? bookmarks.flatMap((bookmark) => bookmark.fieldAnchor && !bookmark.hiddenOnMap
      ? [{ id: `pin:${bookmark.url}`, lat: bookmark.fieldAnchor.lat, lon: bookmark.fieldAnchor.lon, color: PIN_COLOR, size: 1, kind: 'pin' as const }]
      : [])
    : [], [bookmarks, globePrefs.pins])
  // Anchored workspaces show on My map only, never in the public field. Clicking one switches to it.
  const workspaceMarkers = useMemo<GlobeMarker[]>(() => fieldView === 'personal'
    ? (workspaces?.workspaces ?? []).flatMap((workspace) => workspace.anchor
      ? [{ id: `workspace:${workspace.id}`, lat: workspace.anchor.lat, lon: workspace.anchor.lon, color: ACCENT_COLOURS[workspace.accent], size: 1, kind: 'pin' as const }]
      : [])
    : [], [fieldView, workspaces])
  // Places mentioned in absorbed pages: a private overlay, shown only in Mine.
  const knowledgeMarkers = useMemo<GlobeMarker[]>(() => fieldView === 'personal'
    ? knowledgeRecords.flatMap((record) => record.places.slice(0, 8).map((place, index) => ({
      id: `know:${record.id}:${index}`,
      lat: place.lat,
      lon: place.lon,
      color: KNOWLEDGE_COLOR,
      size: Math.min(1, 0.4 + place.count * 0.12),
      kind: 'signal' as const,
    })))
    : [], [fieldView, knowledgeRecords])
  const globeMarkers = useMemo<GlobeMarker[]>(() => [
    // With story mountains, a country's news dot would sit on its summits: countries open by clicking the land instead.
    ...(publicGlobe ? visibleGlobeSignals.filter((signal) => !(storyMode && signal.id.startsWith('news:country:'))).map((signal) => ({
      id: signal.id,
      lat: signal.lat,
      lon: signal.lon,
      color: GLOBE_LAYERS[signal.layer].color,
      size: signal.intensity,
      kind: 'signal' as const,
    })) : []),
    ...(storyMode ? storyMarkers(storyStories) : []),
    ...pinMarkers,
    ...knowledgeMarkers,
    ...workspaceMarkers,
    // The place you flew to: projected like any marker so the locator can sit exactly on it.
    ...(focusedPlace ? [{ id: `locator:${focusedPlace.id}`, lat: focusedPlace.lat, lon: focusedPlace.lon, color: '#ffffff', size: 0, kind: 'pin' as const }] : []),
  ], [publicGlobe, visibleGlobeSignals, pinMarkers, knowledgeMarkers, workspaceMarkers, focusedPlace, storyMode, storyStories])
  // What part of Earth is in view, sampled a few times a second: labels follow it as you zoom and turn.
  const [labelView, setLabelView] = useState<LabelView | null>(null)
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!countryView.width) return
      const next: LabelView = { centerLat: countryView.centerLat, centerLon: countryView.centerLon, distance: countryView.distance, degPerPx: countryView.degPerPx, width: countryView.width, height: countryView.height }
      setLabelView((current) => (labelViewChanged(current, next) ? next : current))
    }, 250)
    return () => window.clearInterval(timer)
  }, [countryView])
  const globeLabels = useMemo<GlobeLabel[]>(() => {
    const short = (text: string): string => (text.length > 34 ? `${text.slice(0, 32)}…` : text)
    const signals = publicGlobe ? visibleGlobeSignals : []
    const ordered = viewLabelSignals(signals, labelView, selectedSignal?.id ?? null)
    return [
      // Summits first: the label layer places in order, so the tallest peaks always keep theirs.
      ...(storyMode ? storyStories.slice(0, 8).map((story, index) => ({ id: storyMarkerId(story), text: `${index === 0 ? '▲ ' : ''}${storyLabel(story)}`, color: SUMMIT_COLOR })) : []),
      ...ordered.map((signal) => ({ id: signal.id, text: short(signal.title), color: GLOBE_LAYERS[signal.layer].color })),
      ...bookmarks.filter((bookmark) => bookmark.fieldAnchor).slice(0, 12)
        .map((bookmark) => ({ id: `pin:${bookmark.url}`, text: short(bookmark.title || bookmark.url), color: PIN_COLOR })),
      ...(fieldView === 'personal'
        ? knowledgeRecords.flatMap((record) => record.places.slice(0, 8).map((place, index) => ({ id: `know:${record.id}:${index}`, text: place.name, color: KNOWLEDGE_COLOR, count: place.count })))
          .sort((a, b) => b.count - a.count).slice(0, 14).map(({ count: _count, ...label }) => label)
        : []),
    ]
  }, [publicGlobe, visibleGlobeSignals, selectedSignal, labelView, bookmarks, globePrefs.pins, fieldView, knowledgeRecords, storyMode, storyStories])
  const hoveredStory = hoveredMarkerId?.startsWith(STORY_MARKER_PREFIX) ? storyStories.find((story) => storyMarkerId(story) === hoveredMarkerId) ?? null : null
  const pinnedStory = storyMode && pinnedStoryId ? storyStories.find((story) => story.id === pinnedStoryId) ?? null : null
  const highlightStory = storyMode && storyHighlightId ? storyStories.find((story) => story.id === storyHighlightId) ?? null : null
  const strandStory = pinnedStory ?? hoveredStory ?? highlightStory
  useEffect(() => {
    // The highlighted story, for checks and assistive tools that read the shell.
    document.documentElement.dataset['storyHighlight'] = highlightStory?.id ?? ''
  }, [highlightStory?.id])
  const storyStrands = useMemo(() => (storyMode && strandStory
    ? { summit: { ...strandStory.summit, height: strandStory.height }, ends: strandEnds(strandStory, pinnedStory ? 16 : 8), still: reduceMotion, terrain: storyTerrain }
    : null), [storyMode, strandStory, pinnedStory, reduceMotion, storyTerrain])
  const hoverCard = useMemo(() => {
    if (!hoveredMarkerId) return null
    if (hoveredStory) return <StoryCardContent story={hoveredStory} rank={storyRank(hoveredStory.id)} />
    if (hoveredMarkerId.startsWith('know:')) {
      const [, recordId, index] = hoveredMarkerId.split(':')
      const record = knowledgeRecords.find((item) => item.id === recordId)
      const place = record?.places[Number(index)]
      return record && place ? <HoverCardContent title={record.title} kind={`From your knowledge · ${place.name}`} detail={`${record.siteName ?? new URL(record.url).hostname} · mentioned ${place.count}×`} color={KNOWLEDGE_COLOR} /> : null
    }
    if (hoveredMarkerId.startsWith('pin:')) {
      const bookmark = bookmarks.find((item) => `pin:${item.url}` === hoveredMarkerId)
      return bookmark ? <HoverCardContent title={bookmark.title || bookmark.url} kind="My pin" detail={bookmark.fieldAnchor?.label ?? bookmark.topic} color={PIN_COLOR} /> : null
    }
    const signal = allGlobeSignals.find((item) => item.id === hoveredMarkerId)
    return signal ? (
      <HoverCardContent
        title={signal.title}
        kind={`${GLOBE_LAYERS[signal.layer].label} · ${signal.kind}`}
        detail={signal.layer === 'reading' ? signal.measurement : `${signal.measurement} · ${relativeTime(signal.observedAt, clock)}`}
        color={GLOBE_LAYERS[signal.layer].color}
        sun={dayPhaseText(signal.lat, signal.lon, new Date(clock))}
      />
    ) : null
  }, [hoveredMarkerId, hoveredStory, bookmarks, allGlobeSignals, clock, knowledgeRecords]) // eslint-disable-line react-hooks/exhaustive-deps
  const panelSignals = useMemo(() => {
    const base = focusedPlace
      ? nearbySignals(visibleGlobeSignals, focusedPlace, Math.max(1_200, focusedPlace.radiusKm * 3), 400)
      : visibleGlobeSignals
    if (listView === 'rising') return risingSignals(base).slice(0, 40)
    if (listView === 'fading') return fadingSignals(base).slice(0, 40)
    if (!focusedPlace) return interleaveLayers(base).slice(0, 40)
    // The place's own peaks first (what is in it, highest first), then what is around it, nearest first.
    const own = nearbySignals(base, focusedPlace, Math.max(focusedPlace.kind === 'country' ? focusedPlace.radiusKm : 40, focusedPlace.radiusKm * 1.2), 400)
    const ownIds = new Set(own.map((signal) => signal.id))
    return [...own.sort((a, b) => b.intensity - a.intensity), ...base.filter((signal) => !ownIds.has(signal.id))].slice(0, 40)
  }, [focusedPlace, visibleGlobeSignals, listView])
  // At a place: what is rising and fading in its own news (computed from the feeds, for any city or country).
  const [placeTrends, setPlaceTrends] = useState<PlaceTrendState | null>(null)
  const placesAliasesOf = (name: string): string[] => cityAliases(name)
  useEffect(() => {
    if (!focusedPlace) { setPlaceTrends(null); return }
    let cancelled = false
    const name = focusedPlace.kind === 'country' ? undefined : focusedPlace.name
    const aliases = name ? [...new Set([name.replace(/\s+City$/i, ''), ...placesAliasesOf(name)])].filter((alias) => alias !== name) : undefined
    setPlaceTrends({ label: focusedPlace.name, status: 'loading', data: null })
    const geonameId = focusedPlace.id.match(/^city:(\d+)$/)?.[1]
    void window.intoponet.browserHost.getPlaceTrends({ countryCode: focusedPlace.countryCode, ...(name ? { name } : {}), ...(aliases?.length ? { aliases } : {}), ...(geonameId ? { geonameId } : {}) }).then((raw) => {
      if (!cancelled) setPlaceTrends({ label: focusedPlace.name, status: 'ready', data: raw ? JSON.parse(raw) as PlaceTrends : null })
    }, () => { if (!cancelled) setPlaceTrends({ label: focusedPlace.name, status: 'ready', data: null }) })
    return () => { cancelled = true }
  }, [focusedPlace, newsDigest])
  const risingTerms = newsDigest?.rising ?? []
  const [worldStory, setWorldStory] = useState<GlobalStory | null>(null)
  /** The world story whose sources the guided tour shows, so its Compare button is there to see. */
  const [worldSources, setWorldSources] = useState<string | null>(null)
  const termEmphasis = useMemo(
    () => (activeTerm
      ? new Set(activeTerm.recentCountries.map((code) => `news:country:${code}`))
      : worldStory && listView === 'world' ? new Set(worldStory.countries.map((code) => `news:country:${code}`)) : null),
    [activeTerm, worldStory, listView],
  )

  /** Which history thread a signal leads to, if any. */
  const oldsQueryFor = (signal: GlobeSignal): { query: OldsQuery; label: string } | null => {
    if (signal.layer === 'reading') return { query: { kind: 'wikipedia', title: signal.title }, label: signal.title }
    const country = signal.id.match(/^news:country:([A-Z]{2})$/)?.[1]
    if (country) return { query: { kind: 'country', countryCode: country }, label: signal.title }
    return null
  }

  const loadOlds = (stack: OldsEntry[]): void => {
    const top = stack[stack.length - 1]
    if (!top) return
    const request = ++oldsRequest.current
    setOlds({ stack, state: { status: 'loading', label: top.label } })
    window.intoponet.olds.thread(top.query).then((thread) => {
      if (request !== oldsRequest.current) return
      setOlds({ stack, state: { status: 'ready', thread } })
    }, (reason: unknown) => {
      if (request !== oldsRequest.current) return
      setOlds({ stack, state: { status: 'error', label: top.label, message: reason instanceof Error && /network|fetch|timed out|ENOTFOUND/i.test(reason.message) ? 'Could not reach Wikidata. Check your connection and try again.' : 'No sourced history could be found for this.' } })
    })
  }
  /** The Olds for what you're looking at: the selected signal, the focused place, or the country in view. */
  const oldsHere = (): { query: OldsQuery; label: string } | null => {
    if (selectedSignal) {
      const target = oldsQueryFor(selectedSignal)
      if (target) return target
    }
    if (focusedPlace) {
      return focusedPlace.kind === 'country'
        ? { query: { kind: 'country', countryCode: focusedPlace.countryCode }, label: focusedPlace.name }
        : { query: { kind: 'wikipedia', title: focusedPlace.name }, label: focusedPlace.name }
    }
    // The live camera's centre point (the saved pose can lag behind a drag).
    const sinPhi = Math.sin(pose.phi)
    const lat = globeProjection.centerLat ?? Math.asin(Math.max(-1, Math.min(1, Math.cos(pose.phi)))) * 180 / Math.PI
    const lon = globeProjection.centerLon ?? Math.atan2(-sinPhi * Math.cos(pose.theta), sinPhi * Math.sin(pose.theta)) * 180 / Math.PI
    const nearest = nearestCountry(lat, lon)
    return nearest ? { query: { kind: 'country', countryCode: nearest.place.countryCode }, label: nearest.place.name } : null
  }
  const openOldsHere = (): void => {
    if (olds) { closeOlds(); return }
    const target = oldsHere()
    if (target) loadOlds([target])
  }
  /** The history behind a news story: matched to a topic, then traced back through sourced links. */
  const openOldsForHeadline = (headline: NewsHeadline, englishText: string | null, signal: GlobeSignal | null): void => {
    // Where the story's outlet is: a city or region signal, a spreading story's origin, or the city you are looking at.
    const localPlace = ((): { name: string; geonameId?: string; countryCode: string } | null => {
      const placeSignal = signal?.id.match(/^news:(city|region):(.+)$/)
      if (signal && placeSignal) {
        const country = nearestCountry(signal.lat, signal.lon)?.place.countryCode
        return country ? { name: signal.title, ...(placeSignal[1] === 'city' ? { geonameId: placeSignal[2] } : {}), countryCode: country } : null
      }
      if (signal?.id.startsWith('news:spread:') && signal.placeLabel) {
        const country = nearestCountry(signal.lat, signal.lon)?.place.countryCode
        return country ? { name: signal.placeLabel, countryCode: country } : null
      }
      if (!signal && focusedPlace && focusedPlace.kind !== 'country') {
        const geonameId = focusedPlace.id.match(/^city:(\d+)$/)?.[1]
        return { name: focusedPlace.name, ...(geonameId ? { geonameId } : {}), countryCode: focusedPlace.countryCode }
      }
      return null
    })()
    const country = localPlace?.countryCode ?? (signal
      ? signal.id.match(/^news:country:([A-Z]{2})$/)?.[1] ?? (signal.layer === 'news' ? nearestCountry(signal.lat, signal.lon)?.place.countryCode : undefined)
      : focusedPlace?.countryCode)
    const lang = englishText ? undefined : normalizeLanguage(headline.lang)?.split('-')[0]
    const text = (englishText ?? headline.title).slice(0, 400)
    loadOlds([{
      query: {
        kind: 'headline' as const, text, ...(country ? { countryCode: country } : {}), ...(lang && lang !== 'en' ? { lang } : {}),
        ...(localPlace ? { place: localPlace.name, ...(localPlace.geonameId ? { geonameId: localPlace.geonameId } : {}) } : {}),
      },
      label: text.length > 60 ? `${text.slice(0, 57)}…` : text,
      // The article (a public feed item) leads to its outlet's earlier coverage of the story.
      article: { url: headline.url, title: headline.title, publisher: headline.publisher },
    }])
  }
  // A headline matched in its own language (no model installed): offer to translate it on this Mac and look again.
  const [oldsTranslating, setOldsTranslating] = useState(false)
  const oldsTranslateOffer = ((): { label: string; detail: string; busy: boolean; onTranslate: () => void } | null => {
    const top = olds?.stack[olds.stack.length - 1]
    if (!olds || !top || top.query.kind !== 'headline' || !top.query.lang || top.query.lang === 'en') return null
    const model = modelFor(top.query.lang, translation.supported)
    if (!model || translation.ready.has(model.code)) return null
    const name = languageName(top.query.lang)
    const bytes = (translation.status?.languages.find((item) => item.code === model.code)?.bytes ?? 0)
      + (translation.status && !translation.status.engine.downloaded ? translation.status.engine.bytes : 0)
    const query = top.query
    const stack = olds.stack
    return {
      label: oldsTranslating ? 'Translating…' : `Add ${name}${bytes ? ` (${formatMegabytes(bytes)})` : ''} and look again`,
      detail: `This ${name} headline was matched in ${name}, which often misses. Translated on this Mac (nothing leaves it), it matches far more reliably.`,
      busy: oldsTranslating,
      onTranslate: () => {
        if (oldsTranslating) return
        setOldsTranslating(true)
        void (async () => {
          try {
            if ((await translation.ensure([model.code])).length) return
            const [english] = await window.intoponet.translate.translate({ from: model.code, to: 'en', texts: [query.text] })
            if (english && english.trim() && english !== query.text) {
              const { lang: _lang, ...rest } = query
              loadOlds([...stack.slice(0, -1), { query: { ...rest, text: english.slice(0, 400) }, label: top.label }])
            }
          } catch {
            // The original match stays; the Languages settings show any download error.
          } finally {
            setOldsTranslating(false)
          }
        })()
      },
    }
  })()
  // With automatic translation on, a headline matched in its own language is translated and looked up again by itself.
  const oldsAutoTried = useRef(new Set<string>())
  const oldsTopQuery = olds?.stack[olds.stack.length - 1]?.query
  const oldsTopText = oldsTopQuery?.kind === 'headline' ? oldsTopQuery.text : ''
  useEffect(() => {
    if (!appSettings.autoTranslate || !oldsTranslateOffer || oldsTranslateOffer.busy || !oldsTopText) return
    if (oldsAutoTried.current.has(oldsTopText)) return
    oldsAutoTried.current.add(oldsTopText)
    oldsTranslateOffer.onTranslate()
  }, [oldsTopText, !!oldsTranslateOffer, appSettings.autoTranslate]) // eslint-disable-line react-hooks/exhaustive-deps
  const openOldsFor = (signal: GlobeSignal): void => {
    const target = oldsQueryFor(signal)
    if (target) loadOlds([target])
  }
  const followOlds = (node: OldsNode): void => {
    if (!olds) return
    loadOlds([...olds.stack, { query: { kind: 'qid' as const, qid: node.id }, label: node.label }].slice(-12))
  }
  const closeOlds = (): void => {
    oldsRequest.current += 1
    setOlds(null)
  }
  const selectedNearby = useMemo(() => selectedSignal
    ? nearbySignals(visibleGlobeSignals.filter((signal) => signal.id !== selectedSignal.id), selectedSignal, 900, 6)
    : [], [selectedSignal, visibleGlobeSignals])
  const fieldFreshness = freshness(eligiblePublicSnapshot, clock)
  const placeMatch = useMemo(
    // Places are offered even while a page is open: Enter on a place spins the globe there.
    () => (placesDismissed ? { places: [], preferred: -1 } : placeMatches(commandQuery(query) ?? query)),
    [query, placesDismissed],
  )

  const flyToPoint = (lat: number, lon: number, radius: number): void => {
    const nextPose = poseToward(pose, lat, lon, radius)
    const nextScale = scaleFromDistance(radius)
    setScale(nextScale)
    writeScale(nextScale)
    setPose(nextPose)
    writeExplorationState({
      scale: nextScale,
      geographicAnchor: { lat, lon },
      selectedTopicId: selectedTopicId ?? null,
      pose: nextPose,
    })
  }

  // Switching to an anchored workspace flies the globe to its place. The browser panel stays open (flyToPlace would close it).
  const shownWorkspaceId = workspaces?.activeId ?? null
  const lastShownWorkspaceId = useRef<string | null>(null)
  useEffect(() => {
    const previous = lastShownWorkspaceId.current
    lastShownWorkspaceId.current = shownWorkspaceId
    if (!shownWorkspaceId || previous === null || previous === shownWorkspaceId || !shownAnchor) return
    flyToPoint(shownAnchor.lat, shownAnchor.lon, radiusForSpan(60))
  }, [shownWorkspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectGlobeSignal = (signal: GlobeSignal): void => {
    setSelectedSignalId(signal.id)
    flyToPoint(signal.lat, signal.lon, Math.min(pose.radius, 3.1))
  }

  /** Fly to the n-th highest summit and pin it (H: the highest, then each next). */
  const findPeak = (index: number): void => {
    const story = storyStories[index]
    if (!story) return
    setPeakIndex(index)
    setPinnedStoryId(story.id)
    flyToPoint(story.summit.lat, story.summit.lon, Math.max(2.4, Math.min(pose.radius, 3.2)))
  }
  const findPeakRef = useRef(findPeak)
  findPeakRef.current = findPeak
  const peakIndexRef = useRef(peakIndex)
  peakIndexRef.current = peakIndex
  useEffect(() => {
    if (!storyMode || panel.isVisible) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'h' || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return
      event.preventDefault()
      const count = Math.min(storyStories.length, 10)
      const current = peakIndexRef.current
      findPeakRef.current(event.shiftKey ? (current <= 0 ? count - 1 : current - 1) : current < 0 ? 0 : (current + 1) % count)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [storyMode, panel.isVisible, storyStories.length])
  // New news moves the pinned story: "Next peak" counts on from where it stands now, and a story that has worn away
  // (or merged into another) is unpinned, so its panel does not come back by itself if it rises again.
  useEffect(() => {
    if (!pinnedStoryId || !storyStories.length) return
    const rank = storyStories.findIndex((story) => story.id === pinnedStoryId)
    if (rank < 0) {
      setPinnedStoryId(null)
      setPeakIndex(-1)
    } else if (peakIndex >= 0 && rank !== peakIndex) setPeakIndex(rank)
  }, [storyStories]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectGlobeMarker = (id: string | null): void => {
    if (!id) {
      setSelectedSignalId(null)
      setPinnedStoryId(null)
      return
    }
    if (id.startsWith(STORY_MARKER_PREFIX)) {
      setPinnedStoryId(id.slice(STORY_MARKER_PREFIX.length))
      return
    }
    if (id.startsWith('pin:')) {
      selectMapPin(id.slice(4))
      return
    }
    if (id.startsWith('know:')) {
      openKnowledge(id.split(':')[1] ?? null)
      return
    }
    if (id.startsWith('workspace:')) {
      void window.intoponet.workspaces.switchTo({ id: id.slice('workspace:'.length) }).catch(() => undefined)
      return
    }
    const signal = allGlobeSignals.find((item) => item.id === id)
    if (signal) selectGlobeSignal(signal)
  }

  /** Click a country anywhere on Earth: its news if it has coverage, otherwise fly there. */
  const selectCountry = (code: string): void => {
    const signal = allGlobeSignals.find((item) => item.id === `news:country:${code}`)
    if (signal) {
      setFocusedPlace(null)
      selectGlobeSignal(signal)
      return
    }
    const place = countryPlace(code)
    if (place) flyToPlace(place)
  }
  // About 10 px of the globe at the current zoom: how close a click must be to a speck like Vatican City.
  const surfaceCountry = (point: { lat: number; lon: number }) => countryAt(point.lat, point.lon, countryView.degPerPx * 10)

  const flyToPlace = (place: Place): void => {
    setFocusedPlace(place)
    setSelectedSignalId(null)
    setQuery('')
    setPlacesDismissed(false)
    focusedMapAnchor.current = { id: place.id, label: placeLabel(place), lat: place.lat, lon: place.lon, radiusKm: place.radiusKm }
    setBrowserFullWidth(false)
    if (panel.isVisible) void window.intoponet.browserHost.close()
    // A country is framed on its label point (its middle), not its capital, so it is the country named in view.
    const middle = place.kind === 'country' ? countryShape(place.countryCode) : null
    flyToPoint(middle?.lat ?? place.lat, middle?.lon ?? place.lon, radiusForSpan(place.radiusKm * (place.kind === 'city' ? 1.4 : 2.4)))
  }

  /** A chosen address bar suggestion: fly, switch to the open tab, or open (⌘↵ behind, ⌥↵ in front). */
  const pickOmnibox = (row: OmniboxSuggestion, disposition?: OpenDisposition): void => {
    if (row.kind === 'place') {
      flyToPlace(row.place)
      return
    }
    if (row.kind === 'action') {
      setQuery('')
      input.current?.blur()
      commandActionsRef.current.find((action) => action.id === row.id)?.run()
      return
    }
    if (row.kind === 'archived' && row.archivedId) {
      setQuery('')
      input.current?.blur()
      void window.intoponet.browserHost.reopenArchivedTabs([row.archivedId]).catch(() => setError('That archived tab could not be reopened.'))
      return
    }
    if (row.kind === 'tab' && row.tabId) {
      setQuery('')
      input.current?.blur()
      void window.intoponet.browserHost.activateTab(row.tabId).catch(() => setError('That tab could not be shown.'))
      return
    }
    const intent: NavigationIntent =
      row.kind === 'search' ? { kind: 'search', value: row.value }
        : row.kind === 'topic' ? { kind: 'topic', value: row.value }
          : row.kind === 'url' ? { kind: 'url', value: row.value }
            : { kind: 'url', value: row.url }
    void navigateFromLauncher(intent.value, { intent, clear: true, ...(disposition && intent.kind !== 'topic' ? { disposition } : {}) }).catch(() => undefined)
  }
  const omniboxTabs = useMemo(() => tabs.filter((tab) => !tab.isStartPage), [tabs])
  /**
   * Command mode (⌘K, or ">" typed first): every menu-bar command (run through the menu's own
   * table in main) and the app's own tools, offered when they apply.
   */
  const hasPage = panel.isVisible && !panel.isStartPage && !!panel.url
  const commandActions = useMemo((): Array<OmniboxAction & { run: () => void }> => {
    const app = (id: string, label: string, run: () => void, shortcut = '', keywords = ''): OmniboxAction & { run: () => void } => ({ id, label, shortcut, keywords, run })
    const list: Array<(OmniboxAction & { run: () => void }) | false> = [
      ...menuActions({ hasPage, pageShown: panel.isVisible, canGoBack: panel.canGoBack, canGoForward: panel.canGoForward, loading: panel.isLoading, tabCount: tabs.length, privateMode: privacyState?.privateMode ?? false, sidebarHidden: sidebar.mode === 'hidden', splitActive: !!panel.split })
        .map((action) => ({ ...action, run: () => void window.intoponet.browserHost.runMenuCommand(action.id) })),
      hasPage && app('protection', protection.enabled ? 'Turn protection off for this site' : 'Turn protection on for this site', () => setSiteProtection(!protection.enabled), '', 'ads trackers block shield'),
      hasPage && app('translate', 'Translate this page', () => setTranslateOpen(true), '', 'language'),
      hasPage && app('capture', 'Capture a screenshot or recording', () => void startCapture('image'), '⇧⌘S', 'screenshot record video'),
      hasPage && app('absorb', 'Absorb this page into Knowledge', () => startAbsorb('article'), '', 'save read'),
      app('olds', 'Open The Olds', openOldsHere, '', 'history past timeline'),
      app('knowledge', 'Open Knowledge', () => openKnowledge(null), '', 'absorbed laya ask'),
      app('my-map', 'Open My map', showLibrary, '', 'pins places'),
      hasPage && app('full-width', fullWidth ? 'Exit full width' : 'Full width', () => setBrowserFullWidth(!fullWidth), '', 'maximise'),
      storyStories.length > 0 && app('highest-peak', 'Fly to the highest story peak', () => findPeak(0), 'H', 'mountain news story'),
      // Tidy and Group by story act on the sidebar, so they are offered only while it is shown.
      tabs.length > 1 && sidebar.mode !== 'hidden' && app('group-tabs-by-story', 'Group tabs by story', () => setGroupRequest((n) => (n ?? 0) + 1), '', 'folder story match mountain'),
      tabs.length > 1 && sidebar.mode !== 'hidden' && app('tidy-tabs', 'Tidy tabs', () => setTidyRequest((n) => (n ?? 0) + 1), '', 'folders group suggest laya'),
      app('tour', 'Take the tour', () => setTourOpen(true), '', 'help guide'),
      // Workspaces: switch (⌃1–9 do the same), make, rename and delete. The sidebar asks for names and confirmation.
      ...(workspaces && workspaces.workspaces.length > 1 ? workspaces.workspaces.map((workspace, index) => workspace.id !== workspaces.activeId && app(
        `workspace-${workspace.id}`, `Switch to workspace ${workspace.name}`, () => void window.intoponet.workspaces.switchTo({ id: workspace.id }).catch(() => setError('That workspace could not be shown.')),
        `⌃${index + 1}`, 'space workspaces',
      )) : []),
      app('new-workspace', 'New workspace', () => {
        if (document.querySelector('.tab-rail')) setWorkspaceRequest({ kind: 'new', at: Date.now() })
        else void window.intoponet.workspaces.create().then((state) => setNotice(`Made ${state.workspaces.find((workspace) => workspace.id === state.activeId)?.name ?? 'a workspace'}`), (reason: unknown) => setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'No new workspace could be made.'))
      }, '', 'space workspaces add'),
      tabs.length > 0 && panel.isVisible && app('rename-workspace', 'Rename workspace…', () => setWorkspaceRequest({ kind: 'edit', at: Date.now() }), '', 'space workspaces icon colour'),
      tabs.length > 0 && panel.isVisible && !!workspaces && workspaces.workspaces.length > 1 && app('delete-workspace', 'Delete workspace…', () => setWorkspaceRequest({ kind: 'delete', at: Date.now() }), '', 'space workspaces remove'),
    ]
    return list.filter((item): item is OmniboxAction & { run: () => void } => !!item)
  }, [hasPage, panel.canGoBack, panel.canGoForward, panel.isVisible, panel.isLoading, tabs.length, privacyState?.privateMode, sidebar.mode, protection.enabled, fullWidth, storyStories.length, workspaces]) // eslint-disable-line react-hooks/exhaustive-deps
  const commandActionsRef = useRef(commandActions)
  commandActionsRef.current = commandActions
  /** ⌘K: the address bar in command mode (out of full width, where it is hidden). */
  const openCommandMenu = (): void => {
    if (fullWidth) setBrowserFullWidth(false)
    setQuery('> ')
    requestAnimationFrame(() => {
      input.current?.focus()
      const end = input.current?.value.length ?? 0
      input.current?.setSelectionRange(end, end)
    })
  }

  const omnibox = useOmnibox({
    query,
    setQuery: (value) => { setQuery(value); setPlacesDismissed(false) },
    inputRef: input,
    tabs: omniboxTabs,
    bookmarks,
    recents,
    places: placeMatch,
    topics: launcherTopics,
    privateMode: (privacyState?.privateMode ?? false) || panel.isPrivate === true,
    recentTabs: tabSwitchOrder === 'recent',
    archived: archivedTabs,
    actions: commandActions,
    onPick: pickOmnibox,
    onDismiss: () => setPlacesDismissed(true),
    onPasteAndGo: (text) => {
      setQuery(text)
      void navigateFromLauncher(text, { clear: true }).catch(() => undefined)
    },
  })

  const saveGlobeSignal = (signal: GlobeSignal): void => {
    if (bookmarks.some((bookmark) => bookmark.url === signal.url)) {
      setNotice('Already in your bookmarks')
      return
    }
    persistBookmarks(upsertBookmark(bookmarks, {
      url: signal.url,
      title: signal.title,
      topic: GLOBE_LAYERS[signal.layer].label,
      savedAt: new Date().toISOString(),
      fieldAnchor: { lat: signal.lat, lon: signal.lon, label: (signal.placeLabel ?? signal.title).slice(0, 160) },
    }))
    setNotice('Saved to bookmarks and pinned on your map')
  }

  // ---- Absorb and local knowledge ----------------------------------------
  const refreshKnowledge = (): void => {
    void window.intoponet.knowledge.list().then(setKnowledgeRecords, () => undefined)
  }
  useEffect(refreshKnowledge, [])

  const startAbsorb = (scope: AbsorbScope = 'article'): void => {
    if (panel.isStartPage) {
      setNotice('Open a page to absorb it')
      return
    }
    setAbsorb({ status: 'loading', scope })
    void window.intoponet.captures.setPageHidden(true)
    window.intoponet.knowledge.preview(scope).then((result) => {
      setAbsorb('refused' in result ? { status: 'refused', refusal: result } : { status: 'preview', preview: result })
    }, () => setAbsorb({ status: 'error', message: 'This page could not be read. Try again once it has finished loading.' }))
  }
  const finishAbsorb = (): void => {
    setAbsorb(null)
    void window.intoponet.captures.setPageHidden(false)
  }
  const cancelAbsorb = (): void => {
    if (absorb && (absorb.status === 'preview' || absorb.status === 'saving')) void window.intoponet.knowledge.cancel(absorb.preview.previewId).catch(() => undefined)
    finishAbsorb()
  }
  const commitAbsorb = (options: { removeEntities: string[]; note: string }): void => {
    if (!absorb || absorb.status !== 'preview') return
    const preview = absorb.preview
    setAbsorb({ status: 'saving', preview })
    window.intoponet.knowledge.commit(preview.previewId, { removeEntities: options.removeEntities, ...(options.note.trim() ? { note: options.note.trim() } : {}) }).then((record) => {
      finishAbsorb()
      refreshKnowledge()
      setNotice(`Absorbed “${record.title.slice(0, 60)}” · ${record.places.length ? `${record.places.length} places on your map · ` : ''}search it under Knowledge`)
    }, () => setAbsorb({ status: 'error', message: 'It could not be saved. Nothing was stored.' }))
  }
  const openKnowledge = (focus: string | null = null): void => {
    setKnowledgeView({ focus })
    if (panel.isVisible) void window.intoponet.captures.setPageHidden(true)
  }
  const closeKnowledge = (): void => {
    setKnowledgeView(null)
    void window.intoponet.captures.setPageHidden(false)
  }

  // Only one of Bookmarks, The Olds, Knowledge and My map is open at a time: whichever opened last wins,
  // however it was opened (top bar, shortcut, or a link inside another panel).
  const panelsOpen = useRef({ bookmarks: bookmarksOpen, olds: !!olds, knowledge: !!knowledgeView, library: libraryOpen, settings: settingsOpen })
  useEffect(() => {
    const now = { bookmarks: bookmarksOpen, olds: !!olds, knowledge: !!knowledgeView, library: libraryOpen, settings: settingsOpen }
    const before = panelsOpen.current
    const opened = (Object.keys(now) as Array<keyof typeof now>).find((key) => now[key] && !before[key])
    panelsOpen.current = now
    if (!opened) return
    if (opened !== 'bookmarks' && now.bookmarks) setBookmarksOpen(false)
    if (opened !== 'olds' && now.olds) closeOlds()
    if (opened !== 'knowledge' && now.knowledge) closeKnowledge()
    if (opened !== 'library' && now.library) setLibraryOpen(false)
    if (opened !== 'settings' && now.settings) setSettingsOpen(false)
  }, [bookmarksOpen, olds, knowledgeView, libraryOpen, settingsOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleGlobeLayer = (layer: GlobeLayerId): void => {
    const next = globeLayerSet.has(layer) ? globePrefs.layers.filter((item) => item !== layer) : [...globePrefs.layers, layer]
    updateGlobePrefs({ layers: GLOBE_LAYER_ORDER.filter((item) => next.includes(item)) })
  }

  // What the tour can do with the app. Nothing here saves, shares or absorbs anything.
  /** Every tour scene starts from nothing open over it: no panel, no typed text. */
  const tourClear = (keepOlds = false): void => {
    tourScene.current += 1
    if (!keepOlds) closeOlds()
    setBookmarksOpen(false)
    setKnowledgeView(null)
    setLibraryOpen(false)
    setSettingsOpen(false)
    setWorldSources(null)
    setTourSidebar(false)
    setQuery('')
    input.current?.blur()
  }
  /** Back on the globe, the tour's page is closed (a later page step opens it again), as it was before the first. */
  const tourPageAway = (): void => {
    const page = tourOpenedPage.current
    tourOpenedPage.current = false
    if (page || panel.isVisible) void window.intoponet.browserHost.close()
    if (typeof page === 'string') void window.intoponet.browserHost.closeTab(page)
  }
  const tourControls: TourControls = {
    reset: () => {
      tourScene.current += 1
      tourPageAway()
      setPinnedStoryId(null)
      setPeakIndex(-1)
      if (olds) closeOlds()
      setBookmarksOpen(false)
      setKnowledgeView(null)
      setLibraryOpen(false)
      setSettingsOpen(false)
      setWorldStory(null)
      setWorldSources(null)
      setTourSidebar(false)
      showEarth()
    },
    showGlobe: () => {
      tourClear()
      tourPageAway()
    },
    spin: (degrees, ms) => new Promise<void>((resolve) => {
      const started = performance.now()
      let turned = 0
      const step = (): void => {
        const progress = Math.min(1, (performance.now() - started) / ms)
        const eased = progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2
        const target = (degrees * Math.PI / 180) * eased
        const delta = target - turned
        turned = target
        setPose((current) => ({ ...current, theta: current.theta + delta }))
        if (progress < 1) requestAnimationFrame(step)
        else resolve()
      }
      requestAnimationFrame(step)
    }),
    flyTo: async (name) => {
      const place = searchPlaces(name, 1)[0]
      if (!place) return false
      const scene = tourScene.current
      // Typed into the search, a letter at a time, then flown to.
      input.current?.focus()
      for (let i = 1; i <= name.length; i += 1) {
        if (tourScene.current !== scene) return false
        setQuery(name.slice(0, i))
        await new Promise((resolve) => setTimeout(resolve, 110))
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
      if (tourScene.current !== scene) return false
      flyToPlace(place)
      input.current?.blur()
      return true
    },
    findHighestPeak: async () => {
      if (!storyMode || !storyStories.length) return false
      findPeak(0)
      for (let i = 0; i < 30 && !document.querySelector('.story-panel'); i += 1) await new Promise((resolve) => setTimeout(resolve, 100))
      return true
    },
    closeStory: () => { setPinnedStoryId(null); setPeakIndex(-1) },
    typeInAddressBar: async (text) => {
      if (!text) {
        setQuery('')
        input.current?.blur()
        return
      }
      const scene = tourScene.current
      input.current?.focus()
      for (let i = 1; i <= text.length; i += 1) {
        if (tourScene.current !== scene) return
        setQuery(text.slice(0, i))
        await new Promise((resolve) => setTimeout(resolve, 120))
      }
    },
    showList: (view) => setListView(view),
    openWorldStory: async (sources = false) => {
      const story = newsDigest?.global?.[0]
      if (!story) return null
      setListView('world')
      setWorldStory(story)
      setWorldSources(sources ? story.id : null)
      return story.headlines.find((headline) => /^en/i.test(headline.lang ?? 'en'))?.title ?? story.title
    },
    prepareOlds: (headline) => { void window.intoponet.olds.thread({ kind: 'headline', text: headline }).catch(() => undefined) },
    openOlds: async (headline) => {
      tourClear(true)
      tourPageAway()
      const top = olds?.stack[olds.stack.length - 1]?.query
      if (top?.kind !== 'headline' || top.text !== headline) {
        loadOlds([{ query: { kind: 'headline', text: headline }, label: headline.length > 60 ? `${headline.slice(0, 57)}…` : headline }])
      }
      // Until it has finished looking: its story, or why there is none (no network, nothing found). At most 30 s.
      for (let i = 0; i < 300; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (document.querySelector('.olds-sheet') && !document.querySelector('.olds-sheet .olds-status[role="status"]')) break
      }
    },
    showBookmarks: (open) => setBookmarksOpen(open),
    showMyMap: (open) => (open ? showLibrary() : setLibraryOpen(false)),
    showPage: (url, options) => {
      tourClear()
      setTourSidebar(options?.sidebar === true)
      const scene = tourScene.current
      const current = (): boolean => tourScene.current === scene
      const shown = tourPageQueue.current.then(async () => {
        if (!current()) return
        // In a tab of its own (never one of yours), closed again at the end; the next page step shows that tab again.
        const made = typeof tourOpenedPage.current === 'string' ? tourOpenedPage.current : null
        const before = await window.intoponet.browserHost.getTabs().catch(() => [])
        let tab = made && before.some((item) => item.id === made) ? made : null
        if (!tab) {
          // Made behind the globe, then shown already hidden (below): the page never covers the tour. It leaves no
          // trace: no history visit, no recent page, never in Recently closed or Archived tabs.
          const opening = window.intoponet.browserHost.open({ kind: 'url', value: url }, 'background-tab', { untracked: true }).catch(() => undefined)
          // Main makes the tab before it answers this (it handles the two in order); the page loads once shown.
          let after = await window.intoponet.browserHost.getTabs().catch(() => [])
          if (after.length === before.length) {
            await opening
            after = await window.intoponet.browserHost.getTabs().catch(() => [])
          }
          const opened = after.find((item) => !before.some((other) => other.id === item.id))?.id ?? null
          // A later step set up its own scene meanwhile: this page is not wanted any more.
          if (!current()) {
            if (opened) void window.intoponet.browserHost.closeTab(opened)
            return
          }
          tab = opened
          tourOpenedPage.current = tab ?? true
        }
        if (!current()) return
        // Covered first, then brought to the front (main handles the two in this order): it never shows over the tour,
        // and stays covered through the re-layouts that follow (the sidebar opening, the page loading).
        void window.intoponet.captures.setPageHidden(true)
        if (tab) void window.intoponet.browserHost.activateTab(tab).catch(() => undefined)
        for (let i = 0; i < 40 && current() && !document.querySelector('.browser-actions'); i += 1) await new Promise((resolve) => setTimeout(resolve, 100))
      })
      tourPageQueue.current = shown.catch(() => undefined)
      return shown
    },
    showKnowledge: (open) => {
      if (open) openKnowledge(null)
      else {
        setKnowledgeView(null)
        // Closing Knowledge shows the page again; the tour keeps it out of the way.
        if (panel.isVisible) void window.intoponet.captures.setPageHidden(true)
      }
    },
    finish: () => {
      tourScene.current += 1
      // Its page goes before it is shown again, so it never flashes up as the tour ends.
      tourPageAway()
      void window.intoponet.captures.setPageHidden(false)
      if (olds) closeOlds()
      setBookmarksOpen(false)
      setKnowledgeView(null)
      setLibraryOpen(false)
      setPinnedStoryId(null)
      setPeakIndex(-1)
      setQuery('')
      setWorldStory(null)
      setWorldSources(null)
      setTourSidebar(false)
    },
  }

  // Kept open, the sidebar stays in full width too (the bottom dock then shows no tabs); hidden, only a peek shows it.
  // The tour's workspace steps show it open whatever its mode, without changing the mode.
  const railShown = tourSidebar || (sidebar.mode === 'hidden' ? railPeek : !fullWidth || sidebar.mode === 'open' || railPeek)
  const railVisible = panel.isVisible && tabs.length > 0 && !fieldLabOpen && railShown
  const railOpen = railVisible && (railExpanded || railPinned || railPeek || tourSidebar)
  const startPageBookmarks = useMemo(() => startBookmarks(bookmarks, recents), [bookmarks, recents])
  const startPageRecents = useMemo(() => startRecents(recents, { isPrivate: panel.isPrivate === true }), [recents, panel.isPrivate])
  const startPageNews = useMemo(() => startNews(newsDigest), [newsDigest])

  const setBrowserFullWidth = (enabled: boolean): void => {
    setFullWidth(enabled)
    void window.intoponet.browserHost.setFullWidth(enabled)
  }

  return (
    <main className={`app-shell${panel.isVisible ? ' page-open' : ''}${fullWidth && panel.isVisible ? ' browser-full' : ''}${tabs.length > 0 ? ' tabs-open' : ''}${bookmarksOpen ? ' bookmarks-open' : ''}${railVisible ? ' rail-on' : ''}${railOpen ? ' rail-open' : ''}`} data-workspace-marks={workspaceMarkers.map((marker) => marker.id).join(' ')} style={{ '--rail-open-width': `${sidebar.width}px` } as CSSProperties}>
      {!fieldLabOpen && <FrequencyField
        paused={reduceMotion || (fullWidth && panel.isVisible)}
        panelOpen={panel.isVisible}
        scale={scale}
        topic={visibleTopicLabel}
        anchor={selectedTopicLocation ? { lat: selectedTopicLocation.lat, lon: selectedTopicLocation.lon } : null}
        pose={pose}
        signals={fieldSignals}
        terrain={storyTerrain}
        strands={storyStrands}
        markers={globeMarkers}
        selectedMarkerId={selectedSignalId}
        hoveredMarkerId={hoveredMarkerId}
        projection={globeProjection}
        onMarkerHover={setHoveredMarkerId}
        onMarkerSelect={selectGlobeMarker}
        countryView={countryView}
        onSurfaceHover={(point) => {
          // Over a mountain's flank, the mountain is what's under the cursor: its card and strands show.
          const story = point && storyTerrain ? storyAt(storyTerrain, point.lat, point.lon) : null
          const current = storyStories.find((item) => item.id === story?.id)
          if (current) {
            const id = storyMarkerId(current)
            if (hoveredMarkerId !== id) setHoveredMarkerId(id)
            countryView.hovered = null
            return true
          }
          if (hoveredMarkerId?.startsWith(STORY_MARKER_PREFIX)) setHoveredMarkerId(null)
          countryView.hovered = point ? surfaceCountry(point)?.code ?? null : null
          return countryView.hovered !== null
        }}
        onSurfaceClick={(point) => {
          // A click on a mountain pins its story: strands stay, and the coverage list opens.
          const story = storyTerrain ? storyAt(storyTerrain, point.lat, point.lon) : null
          if (story) {
            setPinnedStoryId(story.id)
            return true
          }
          // A click on or around the city you flew to stays with that city; elsewhere opens the country.
          if (focusedPlace && focusedPlace.kind !== 'country'
            && placeDistanceKm(point.lat, point.lon, focusedPlace.lat, focusedPlace.lon) <= Math.max(40, focusedPlace.radiusKm * 1.5)) {
            setSelectedSignalId(null)
            return true
          }
          const country = surfaceCountry(point)
          if (!country) return false
          selectCountry(country.code)
          return true
        }}
        markerEmphasis={termEmphasis}
        dayNight
        membraneSettings={activityMembraneSettings}
        onOrganicMetrics={diagnosticsOpen ? setOrganicMetrics : undefined}
        onDistanceChange={(radius) => {
          // Commit the radius when the wheel settles: setting it on every tick re-rendered the whole
          // app (~6 ms a tick). The camera already moved; OrbitRig ignores the echo of its own radius.
          if (zoomCommit.current) window.clearTimeout(zoomCommit.current)
          zoomCommit.current = window.setTimeout(() => {
            zoomCommit.current = 0
            setPose((current) => (current.radius === radius ? current : { ...current, radius }))
          }, 160)
          const next = scaleFromDistance(radius)
          // A wheel zoom only changes the scale label: the globe stays turned to wherever the cursor
          // zoomed it. rememberScale would aim at the topic's anchor (or restore a saved pose) and
          // swing the globe away mid-zoom.
          if (next !== scale) {
            if (shouldSnapshotBeforeTopic(scale, next)) topicReturnPose.current = { ...pose, radius }
            setScale(next)
            writeScale(next)
          }
        }}
        onPoseChange={(next) => {
          setPose(next)
          writeExplorationState({
            scale,
            geographicAnchor: focusedMapAnchor.current ?? defaultAnchor(activeTopic),
            selectedTopicId: activeTopic,
            pose: next,
          })
        }}
      />}
      <TabDock
        tabs={railVisible ? [] : tabs}
        fullWidth={fullWidth}
        visible={panel.isVisible}
        currentUrl={panel.url}
        bookmarksOpen={bookmarksOpen}
        focusRequest={dockFocusRequest}
        onNavigate={navigateFromLauncher}
        onToggleBookmarks={toggleBookmarksPane}
      />
      <TabRail
        tabs={tabs}
        visible={railVisible}
        expanded={railExpanded || railPeek || tourSidebar}
        pinned={railPinned}
        width={sidebar.width}
        onExpandedChange={(expanded) => {
          setRailExpanded(expanded)
          if (!expanded) setRailPeek(false)
        }}
        onPinnedChange={setRailPinned}
        onHide={toggleSidebar}
        onWidthChange={(width) => setSidebar({ ...sidebar, width })}
        onNewTab={openNewTab}
        archivedCount={justArchived?.ids.length ?? 0}
        onUndoArchive={undoArchive}
        nowPlaying={nowPlaying}
        folders={tabFolders}
        renameFolderId={renameFolderId}
        onRenameHandled={() => setRenameFolderId(null)}
        onSaveFolder={saveTabFolder}
        message={railMessage}
        workspaces={workspaces}
        workspaceRequest={workspaceRequest}
        anchorHeadlines={anchorHeadlines}
        onOpenHeadline={(url) => void window.intoponet.browserHost.open({ kind: 'url', value: url })}
        storyMatches={tabStories}
        onStoryHighlight={setStoryHighlightId}
        groupRequest={groupRequest}
        tidyRequest={tidyRequest}
      />
      <BookmarkPane
        open={bookmarksOpen && !fieldLabOpen}
        placement={fullWidth && panel.isVisible ? 'attached' : 'floating'}
        bookmarks={bookmarks}
        collections={collections}
        currentPage={panel.isVisible && panel.url ? { url: panel.url, title: panel.title || originLabel(panel.url) } : null}
        onOpen={openBookmarkFromPane}
        onSaveCurrent={saveCurrentToGroup}
        onRemove={removeBookmark}
        onCreateGroup={createBookmarkGroup}
        onRenameGroup={(id, label) => persistCollections(renameCollection(collections, id, label))}
        onDeleteGroup={removeCollection}
        onOpenGroupAsTabs={(id) => {
          const collection = collections.find((item) => item.id === id)
          if (!collection) return
          void window.intoponet.browserHost.openTabFolder(collection.label, collection.memberUrls)
            .then(() => setNotice(`Opened “${collection.label}” as a tab folder.`))
            .catch((reason: unknown) => setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'The collection could not be opened as tabs.'))
        }}
        onMove={(url, from, to) => persistCollections(moveBookmarkToGroup(collections, url, from, to))}
        onClose={() => setBookmarksOpen(false)}
        captures={captureRecords}
        freshCaptureId={freshCaptureId}
        onOpenCapture={setViewerId}
        onMoveCapture={moveCapture}
        onOpenFolder={(groupId) => void window.intoponet.captures.openFolder(groupId).catch(() => setError('The capture folder could not be opened.'))}
        requestedFilter={bookmarkFilterRequest}
        savedPdfVersion={savedPdfVersion}
      />
      <AnimatePresence>
        {captureSession && (
          <CaptureOverlay
            key={captureSession.pending.pendingId}
            pending={captureSession.pending}
            groups={captureGroups}
            initialGroupId={defaultCaptureGroup()}
            initialMode={captureSession.mode}
            onCancel={cancelCaptureSession}
            onConfirm={finishCaptureSession}
            onCreateGroup={createBookmarkGroup}
          />
        )}
      </AnimatePresence>
      <CaptureToast
        toast={captureToast}
        onDismiss={() => setCaptureToast(null)}
        onView={(id) => {
          setCaptureToast(null)
          setViewerId(id)
        }}
      />
      <AnimatePresence>
        {viewerId && (
          <CaptureViewer
            key="capture-viewer"
            records={captureRecords}
            openId={viewerId}
            groups={captureGroups}
            onNavigate={setViewerId}
            onClose={() => setViewerId(null)}
            onMove={moveCapture}
            onDelete={(id) => void window.intoponet.captures.remove(id).catch(() => setError('The capture could not be deleted.'))}
            onOpenSource={(url) => {
              setViewerId(null)
              void window.intoponet.browserHost.open({ kind: 'url', value: url }).catch(() => setError('Navigation failed.'))
            }}
            notify={setNotice}
          />
        )}
      </AnimatePresence>
      {!fieldLabOpen && <div className="field-wash" aria-hidden="true" />}
      {fieldLabOpen && <FieldLab onClose={() => setFieldLabOpen(false)} reducedMotion={reduceMotion} />}

      <header className="topbar">
        <button
          type="button"
          className="brand"
          aria-label="Return to field"
          onClick={showEarth}
        >
          <img className="brand-logo" src={brandLogo} alt="intoponet" width={144} height={28} draggable={false} />
        </button>
        <div className="topbar-actions">
          <div className="privacy-state">
            <LockKeyhole size={13} />
            Personal field stays on this device
          </div>
          <button
            type="button"
            className={`bookmark-library-button private-toggle${privacyState?.privateMode ? ' is-on' : ''}`}
            aria-pressed={privacyState?.privateMode ?? false}
            onClick={() => setPrivateMode(!(privacyState?.privateMode ?? false))}
            title={privacyState?.privateMode ? 'Private browsing is on: new tabs leave no footprints. Click to turn off (closes private tabs). ⇧⌘N' : 'Private browsing: new tabs leave no recent pages, signals, cookies or cache. ⇧⌘N'}
          >
            <EyeOff size={14} />
            {privacyState?.privateMode ? 'Private on' : 'Private'}
          </button>
          {import.meta.env.DEV && (
            <button
              type="button"
              className="bookmark-library-button"
              aria-pressed={fieldLabOpen}
              onClick={() => setFieldLabOpen((open) => !open)}
            >
              {fieldLabOpen ? 'Close field lab' : 'Field lab'}
            </button>
          )}
          <button
            type="button"
            className="bookmark-library-button"
            aria-pressed={bookmarksOpen}
            title="Bookmarks (⇧⌘B)"
            data-panel="bookmarks"
            onClick={toggleBookmarksPane}
          >
            <Bookmark size={14} />
            Bookmarks
          </button>
          <button
            type="button"
            className="bookmark-library-button"
            aria-pressed={!!olds}
            data-panel="olds"
            onClick={openOldsHere}
            title="The Olds: sourced history of what you're looking at (the selected place, or the country in the middle of the globe)"
          >
            <History size={14} />
            The Olds
          </button>
          <button type="button" className="bookmark-library-button" data-panel="knowledge" onClick={() => openKnowledge(null)} title="Your knowledge: everything you’ve absorbed">
            <BookOpenText size={14} />
            Knowledge
            {knowledgeRecords.length > 0 && <span>{knowledgeRecords.length}</span>}
          </button>
          <button type="button" className="bookmark-library-button" data-panel="library" onClick={showLibrary}>
            <MapPin size={14} />
            My map
            {bookmarks.length > 0 && <span>{bookmarks.length}</span>}
          </button>
          <button
            type="button"
            className="bookmark-library-button settings-button"
            aria-pressed={settingsOpen}
            aria-label="Settings"
            data-panel="settings"
            title="Settings: your language, automatic translation, privacy"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <SettingsIcon size={14} />
          </button>
        </div>
      </header>
      <HistoryHost
        policy={privacySettings}
        onOpenUrl={(url) => openRecent({ url, title: '', visitedAt: '' })}
        onForget={(forget) => setRecents((current) => forgetRecentPages(current, forget))}
        onNotice={setNotice}
      />
      {beaconDraft && (
        <BeaconConsent
          initial={beaconDraft}
          onClose={() => setBeaconDraft(null)}
          onPublished={(title) => {
            setBeaconDraft(null)
            setNotice(`Published “${title.slice(0, 60)}” as a public beacon. You can withdraw it in Settings › Beacons.`)
          }}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          onTour={() => { setSettingsOpen(false); setTourOpen(true) }}
          translation={translation}
          settings={appSettings}
          onSettings={updateAppSettings}
          headlinesTranslated={headlinesTranslated}
          onHeadlinesTranslated={setHeadlinesPref}
          onOpenPrivacy={() => {
            setSettingsOpen(false)
            setLibraryTab('privacy')
            showLibrary()
          }}
          onClose={() => setSettingsOpen(false)}
          libraryReady={libraryReady}
          onImportLibrary={importBrowserLibrary}
        />
      )}

      {pinEditor && (
        <PinEditor
          initial={pinEditor.initial}
          locations={pinLocationOptions}
          suggestions={pinSuggestionsFor(pinEditor.initial.title, pinEditor.initial.url)}
          onCancel={() => finishPinEditor(pinEditor.restoreBrowser, pinEditor.restoreFullWidth)}
          onSave={savePin}
          onSaveAndPublish={(value) => {
            savePin(value)
            setBeaconDraft({ url: value.url, title: value.title, topic: value.topic, ...(value.fieldAnchor ? { place: value.fieldAnchor } : {}) })
          }}
        />
      )}


      {!fieldLabOpen && !designPreview && (
        <GlobeHeader
          title={focusedPlace ? focusedPlace.name : fieldView === 'public' ? 'Earth, live' : 'My Earth'}
          eyebrow={fieldView === 'public'
            ? `${fieldFreshness.label}${fieldFreshness.stale && eligiblePublicSnapshot ? ' · may be out of date' : ''}`
            : 'Private · stays on this device'}
          stale={fieldView === 'public' ? fieldFreshness.stale : false}
          summary={fieldView === 'public'
            ? focusedPlace
              ? `${panelSignals.length} public ${panelSignals.length === 1 ? 'signal' : 'signals'} within ${Math.max(1_200, Math.round(focusedPlace.radiusKm * 3)).toLocaleString()} km of ${placeLabel(focusedPlace)}.`
              : `${visibleGlobeSignals.length} public signals across ${globeLayerSet.size} active ${globeLayerSet.size === 1 ? 'layer' : 'layers'}. Hover to preview, click to explore, or search a place below.`
            : `${bookmarks.filter((bookmark) => bookmark.fieldAnchor).length} pinned places · ${knowledgeRecords.length} absorbed ${knowledgeRecords.length === 1 ? 'page' : 'pages'} · ${personalActivity.visits.length} visits this session. Nothing here is shared.`}
          trail={focusedPlace ? (focusedPlace.kind === 'country' ? [focusedPlace.name] : [focusedPlace.country, focusedPlace.name].filter((step, index, all) => step && all.indexOf(step) === index)) : []}
          onEarth={showEarth}
        />
      )}
      <p className="sr-only" role="status">{scaleLabel(scale)}.{focusedPlace ? ` ${placeLabel(focusedPlace)}.` : ''}{selectedSignal ? ` Selected ${selectedSignal.title}.` : ''}</p>
      {!fieldLabOpen && !designPreview && (
        <LayerCard
          view={fieldView}
          onViewChange={(view) => { setFieldView(view); setSelectedSignalId(null); setHoveredMarkerId(null) }}
          layers={globeLayerSet}
          counts={layerCounts(windowGlobeSignals)}
          onToggleLayer={toggleGlobeLayer}
          onSetLayers={(group, on) => {
            const next = on ? [...new Set([...globePrefs.layers, ...group])] : globePrefs.layers.filter((item) => !group.includes(item))
            updateGlobePrefs({ layers: GLOBE_LAYER_ORDER.filter((item) => next.includes(item)) })
          }}
          window={globePrefs.window}
          onWindowChange={(window) => updateGlobePrefs({ window })}
          pinsVisible={globePrefs.pins}
          pinCount={bookmarks.filter((bookmark) => bookmark.fieldAnchor).length}
          onTogglePins={() => updateGlobePrefs({ pins: !globePrefs.pins })}
          dayNight={globePrefs.dayNight}
          onToggleDayNight={() => updateGlobePrefs({ dayNight: !globePrefs.dayNight })}
          coverageNote={eligiblePublicSnapshot
            ? `${snapshotLabel(eligiblePublicSnapshot)}${publicFieldStatusNote ? ` ${publicFieldStatusNote}` : ''}`
            : `No public snapshot yet.${publicFieldStatusNote ? ` ${publicFieldStatusNote}` : ''}`}
          placesAttribution={PLACE_ATTRIBUTION}
          personal={(
            <>
              <p>{fieldProvenanceNote}</p>
          {!designPreview && fieldView === 'personal' && (
            <label className="field-preview-control personal-context-picker">
              <span>Topic location · {currentPersonalTopic}</span>
              <select
                value={selectedTopicLocation?.id ?? ''}
                onChange={(event) => {
                  const selected = topicLocationOptions.find((location) => location.id === event.currentTarget.value) ?? null
                  const topicId = selected?.topicId ?? currentPersonalTopic
                  if (selected?.topicId) {
                    setResearchTopic(selected.topicId)
                  }
                  setTopicLocations((current) => {
                    const next = { ...current }
                    if (!selected) delete next[currentPersonalTopic]
                    else next[topicId] = selected
                    return next
                  })
                }}
              >
                <option value="">No topic destination selected</option>
                {topicLocationOptions.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
              </select>
              <small title="Swells use a 1,200 km display footprint; this is not measured geographic spread.">Signals are placed at the topic destination, never the visitor’s location.</small>
            </label>
          )}
          {!designPreview && fieldView === 'personal' && (
            <button className="globe-ghost" type="button" onClick={clearPersonalActivity} disabled={personalActivity.visits.length === 0}>
              Clear this session
            </button>
          )}
{import.meta.env.DEV && (
                <button className="globe-ghost" type="button" onClick={toggleDesignPreview}>Design preview</button>
              )}
            </>
          )}
        />
      )}
      {!fieldLabOpen && publicGlobe && (
        <SignalPanel
          heading={focusedPlace ? `Near ${focusedPlace.name}` : 'Highlights'}
          signals={panelSignals}
          selected={selectedSignal}
          nearby={selectedNearby}
          now={clock}
          saved={!!selectedSignal && bookmarks.some((bookmark) => bookmark.url === selectedSignal.url)}
          onSelect={selectGlobeSignal}
          onClear={() => setSelectedSignalId(null)}
          onOpen={(url) => void window.intoponet.browserHost.open({ kind: 'url', value: url })}
          onSave={saveGlobeSignal}
          onFly={(signal) => flyToPoint(signal.lat, signal.lon, 1.9)}
          onHistory={selectedSignal && oldsQueryFor(selectedSignal) ? openOldsFor : null}
          // Near a focused place, World stories are not about that place: show its peaks instead.
          listView={focusedPlace && listView === 'world' ? 'top' : listView}
          onListViewChange={setListView}
          risingTerms={risingTerms}
          activeTerm={activeTerm}
          onTerm={setActiveTerm}
          translation={translation}
          onHeadlineHistory={openOldsForHeadline}
          peers={windowGlobeSignals}
          placeTrends={placeTrends}
          coverageFor={(signal) => {
            if (!newsDigest) return []
            const all = [...newsDigest.countries.flatMap((country) => country.headlines), ...newsDigest.places.flatMap((place) => place.headlines), ...(newsDigest.global ?? []).flatMap((story) => story.headlines)]
            return headlinesAbout(signal, all)
          }}
          contextFor={(signal) => {
            if (signal.layer !== 'news') return null
            const code = signal.id.match(/^news:country:([A-Z]{2})$/)?.[1] ?? nearestCountry(signal.lat, signal.lon)?.place.countryCode
            if (!code) return null
            return { countryCode: code, name: code === signal.id.match(/^news:country:([A-Z]{2})$/)?.[1] ? signal.title : countryPlace(code)?.name ?? code }
          }}
          world={{
            stories: newsDigest?.global ?? [],
            inTheNews: newsDigest?.inTheNews ?? [],
            focusedId: worldStory?.id ?? null,
            sourcesFor: worldSources,
            onFocus: setWorldStory,
            onArticleHistory: (title) => loadOlds([{ query: { kind: 'wikipedia' as const, title }, label: title }]),
          }}
          onContextName={(name, countryCode, countryName) => loadOlds([{ query: { kind: 'headline' as const, text: `${name} ${countryName}`, countryCode }, label: `${name} · ${countryName}` }])}
          onOldsTopic={(node) => loadOlds([{ query: { kind: 'qid' as const, qid: node.id }, label: node.label }])}
          emptyText={eligiblePublicSnapshot
            ? focusedPlace ? 'No public signals observed near here in this window. That means no coverage, not no interest.' : 'Turn on a layer to see public signals.'
            : 'Loading public data…'}
        />
      )}
      {!fieldLabOpen && fieldView === 'personal' && !designPreview && (
        <MinePanel
          pins={bookmarks}
          records={knowledgeRecords}
          onFly={(lat, lon) => flyToPoint(lat, lon, Math.min(pose.radius, 2.4))}
          onOpenPin={selectMapPin}
          onOpenRecord={(id) => openKnowledge(id)}
        />
      )}
      <AnimatePresence>
        {absorb && (
          <AbsorbSheet
            key="absorb"
            state={absorb}
            onScope={(scope) => {
              if (absorb.status === 'preview') void window.intoponet.knowledge.cancel(absorb.preview.previewId).catch(() => undefined)
              startAbsorb(scope)
            }}
            onCommit={commitAbsorb}
            onCancel={cancelAbsorb}
          />
        )}
        {knowledgeView && (
          <KnowledgeSheet
            key="knowledge"
            focus={knowledgeView.focus}
            onClose={closeKnowledge}
            onOpen={(url) => {
              closeKnowledge()
              void window.intoponet.browserHost.open({ kind: 'url', value: url })
            }}
            onChanged={refreshKnowledge}
            onHistory={(title, lang) => {
              closeKnowledge()
              if (panel.isVisible) void window.intoponet.browserHost.close()
              loadOlds([{ query: { kind: 'wikipedia', title, lang }, label: title }])
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {olds && !fieldLabOpen && !panel.isVisible && (
          <OldsPanel
            key="olds"
            state={olds.state}
            trail={olds.stack.map((entry) => entry.label)}
            onFollow={followOlds}
            onBack={olds.stack.length > 1 ? () => loadOlds(olds.stack.slice(0, -1)) : null}
            onClose={closeOlds}
            onOpen={(url) => void window.intoponet.browserHost.open({ kind: 'url', value: url })}
            onPickTopic={(topic) => {
              const top = olds.stack[olds.stack.length - 1]
              if (top?.query.kind === 'headline') loadOlds([...olds.stack.slice(0, -1), { ...top, query: { ...top.query, topic } }])
            }}
            onFollowArticle={(title) => loadOlds([...olds.stack, { query: { kind: 'wikipedia' as const, title }, label: title }].slice(-12))}
            translateOffer={oldsTranslateOffer}
            article={olds.stack[olds.stack.length - 1]?.article ?? null}
          />
        )}
      </AnimatePresence>
      {!fieldLabOpen && <CountryNames view={countryView} hidden={panel.isVisible} />}
      {tourOpen && <Tour controls={tourControls} onClose={() => setTourOpen(false)} />}
      {!fieldLabOpen && (
        <GlobeOverlay
          projection={globeProjection}
          labels={globeLabels}
          hoverId={hoveredMarkerId}
          hoverCard={hoverCard}
          hidden={panel.isVisible}
          locator={focusedPlace ? { id: `locator:${focusedPlace.id}`, label: focusedPlace.name } : null}
          onLocatorSelect={() => setSelectedSignalId(null)}
          onLabelSelect={selectGlobeMarker}
        />
      )}
      {!fieldLabOpen && storyMode && !panel.isVisible && (
        <HighestPeakButton stories={storyStories} index={peakIndex} onFind={findPeak} />
      )}
      {!fieldLabOpen && pinnedStory && !panel.isVisible && (
        <StoryPanel
          story={pinnedStory}
          rank={storyRank(pinnedStory.id)}
          onClose={() => { setPinnedStoryId(null); setPeakIndex(-1) }}
          onOpen={(url) => void window.intoponet.browserHost.open({ kind: 'url', value: url })}
        />
      )}
      {!fieldLabOpen && import.meta.env.DEV && designPreview && <aside className="coverage-note">
        <span className="coverage-pulse" aria-hidden="true" />
        <div>
          <strong>{designPreview ? 'Design preview · synthetic' : sourceMode === 'personal' ? 'Personal field · this session only' : sourceMode === 'public' || sourceMode === 'mixed' ? 'Public source field' : 'Public field unavailable'}</strong>
          <span>{fieldProvenanceNote}</span>
        </div>
        <div className="field-preview-controls">
          <div className="field-mode-switch" role="group" aria-label="Field activity source">
            <button className="field-preview-toggle" type="button" aria-pressed={fieldView === 'personal'} onClick={() => { setDesignPreview(false); setFieldView('personal') }}>Personal visits</button>
            <button className="field-preview-toggle" type="button" aria-pressed={fieldView === 'public'} onClick={() => { setDesignPreview(false); setFieldView('public') }}>Public sources</button>
          </div>
          {!designPreview && fieldView === 'personal' && (
            <label className="field-preview-control personal-context-picker">
              <span>Topic location · {currentPersonalTopic}</span>
              <select
                value={selectedTopicLocation?.id ?? ''}
                onChange={(event) => {
                  const selected = topicLocationOptions.find((location) => location.id === event.currentTarget.value) ?? null
                  const topicId = selected?.topicId ?? currentPersonalTopic
                  if (selected?.topicId) {
                    setResearchTopic(selected.topicId)
                  }
                  setTopicLocations((current) => {
                    const next = { ...current }
                    if (!selected) delete next[currentPersonalTopic]
                    else next[topicId] = selected
                    return next
                  })
                }}
              >
                <option value="">No topic destination selected</option>
                {topicLocationOptions.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
              </select>
              <small title="Swells use a 1,200 km display footprint; this is not measured geographic spread.">Signals are placed at the topic destination, never the visitor’s location.</small>
              <small>Roman Colosseum is a curated destination. Selecting it tags future visits “Roman Colosseum.”</small>
            </label>
          )}
          {!designPreview && fieldView === 'personal' && (
            <button className="field-preview-toggle" type="button" onClick={clearPersonalActivity} disabled={personalActivity.visits.length === 0}>
              Clear this session
            </button>
          )}
          {!designPreview && fieldView === 'personal' && (
            <details className="topic-traffic-inspector">
              <summary>Topic traffic</summary>
              {!selectedTopicLocation || !topicTraffic ? (
                <p>Select a topic destination to inspect its local activity.</p>
              ) : (
                <>
                  <p><strong>{topicTraffic.current.totalVisits}</strong> eligible visits in the last 24 hours for {currentPersonalTopic}.</p>
                  <p>Visitor-country breakdown: unavailable. Origin countries are not collected.</p>
                  <p>{topicTraffic.current.unknownOriginVisits} visits have unknown country origin.</p>
                  <p>{topicTraffic.spike.status === 'no-baseline' ? 'No earlier comparison window is available.' : topicTraffic.spike.status === 'insufficient-baseline' ? 'Not enough session history for a comparison.' : `Session visit rate: ${topicTraffic.spike.status}.`}</p>
                </>
              )}
            </details>
          )}
        </div>
        {import.meta.env.DEV && (
          <div className="field-preview-controls">
            <button className="field-preview-toggle" type="button" aria-pressed={designPreview} onClick={toggleDesignPreview}>
            {designPreview ? (fieldView === 'personal' ? 'Personal visits' : publicSnapshot ? 'Public sources' : 'Observed field') : 'Design preview'}
            </button>
            {designPreview && (
              <div className="field-preview-sliders">
                <label className="field-preview-control">
                  <span>Synthetic intensity</span>
                  <input className="field-preview-slider" type="range" min="0.25" max="1.5" step="0.05" value={previewIntensity} onChange={(event) => setPreviewIntensity(Number(event.currentTarget.value))} />
                </label>
                <label className="field-preview-control">
                  <span>Synthetic radius scale</span>
                  <input className="field-preview-slider" type="range" min="0.5" max="1.5" step="0.05" value={previewRadiusScale} onChange={(event) => setPreviewRadiusScale(Number(event.currentTarget.value))} />
                </label>
              </div>
            )}
            {designPreview && (
              <details className="topic-traffic-inspector">
                <summary>Synthetic traffic example · Roman Colosseum</summary>
                {(() => {
                  const originName = (countryCode: string | null): string => countryCode === 'BO'
                    ? 'Bolivia'
                    : countryCode === 'IT'
                      ? 'Italy'
                      : countryCode === null ? 'Unknown' : countryCode
                  return (
                    <div className="topic-traffic-demo">
                      <p>Synthetic example only · not observed traffic.</p>
                      <table>
                        <thead><tr><th>Origin</th><th>Current 24h share</th><th>Previous 24h rate</th><th>Change</th></tr></thead>
                        <tbody>{topicTrafficDemoResult.countryTrends.map((row) => (
                          <tr key={row.countryCode ?? 'unknown'}>
                            <th scope="row">{originName(row.countryCode)}</th>
                            <td>{row.currentPercent.toFixed(0)}% · {row.currentVisits}</td>
                            <td>{row.baselineRatePerHour.toFixed(2)}/h</td>
                            <td>{row.ratio === null ? '—' : `${row.ratio.toFixed(1)}×`}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )
                })()}
              </details>
            )}
            {designPreview && (
              <details className="field-preview-diagnostics" onToggle={(event) => {
                const open = event.currentTarget.open
                setDiagnosticsOpen(open)
                if (!open) setOrganicMetrics(null)
              }}>
                <summary>Render diagnostics</summary>
                <pre>{organicMetrics ? JSON.stringify({ fps: organicMetrics.fps, frameMs: organicMetrics.frameMs, drawCalls: organicMetrics.drawCalls, triangles: organicMetrics.triangles, gpuTimeMs: organicMetrics.gpuTimeMs, gpuTiming: organicMetrics.gpuTiming }, null, 2) : 'Waiting for renderer metrics…'}</pre>
              </details>
            )}
          </div>
        )}
      </aside>}
      {libraryOpen && (
        <aside className="bookmark-drawer lg-surface" aria-labelledby="bookmark-heading">
          <div className="drawer-heading">
            <div>
              <span>Private library</span>
              <h2 id="bookmark-heading">
                {libraryTab === 'locations'
                  ? 'My map'
                  : libraryTab === 'collections'
                    ? 'Collections'
                    : libraryTab === 'absorbed'
                      ? 'Absorbed pages'
                      : libraryTab === 'privacy'
                        ? 'Privacy'
                        : 'Recent pages'}
              </h2>
            </div>
            <button type="button" onClick={() => setLibraryOpen(false)} aria-label="Close saved library">
              <X size={17} />
            </button>
          </div>
          <div className="drawer-tabs" role="tablist" aria-label="Library sections">
            <button
              type="button"
              role="tab"
              aria-selected={libraryTab === 'locations'}
              className={libraryTab === 'locations' ? 'active' : ''}
              onClick={() => setLibraryTab('locations')}
            >
              Locations
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={libraryTab === 'collections'}
              className={libraryTab === 'collections' ? 'active' : ''}
              onClick={() => setLibraryTab('collections')}
            >
              Collections
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={libraryTab === 'recent'}
              className={libraryTab === 'recent' ? 'active' : ''}
              onClick={() => setLibraryTab('recent')}
            >
              Recent
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={libraryTab === 'absorbed'}
              className={libraryTab === 'absorbed' ? 'active' : ''}
              onClick={() => setLibraryTab('absorbed')}
            >
              Absorbed
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={libraryTab === 'privacy'}
              className={libraryTab === 'privacy' ? 'active' : ''}
              onClick={() => setLibraryTab('privacy')}
            >
              Privacy
            </button>
          </div>
          <div className="library-tools">
            <button type="button" onClick={openHistory} title="History: every page visited in normal tabs (⌘Y)">
              History
            </button>
            <button type="button" onClick={exportLibrary}>
              Export
            </button>
            <label className="library-import" title="Merge an exported Intoponet library into this one. Nothing you have is removed.">
              Import
              <input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importLibrary(file) }} />
            </label>
            <button type="button" onClick={deleteLibrary}>
              {confirmDelete ? 'Confirm delete' : 'Delete library'}
            </button>
          </div>
          {libraryTab === 'privacy' ? (
            <PrivacyPane
              settings={privacySettings}
              onSettings={updatePrivacySettings}
              state={privacyState}
              onPrivateMode={setPrivateMode}
              onBackupExclusion={setBackupExclusion}
              showPins={globePrefs.pins}
              onShowPins={(on) => updateGlobePrefs({ pins: on })}
              pinCount={bookmarks.filter((bookmark) => bookmark.fieldAnchor).length}
              hiddenPins={bookmarks.filter((bookmark) => bookmark.fieldAnchor && bookmark.hiddenOnMap).length}
              recentCount={recents.length}
              onDeleteFootprints={deleteFootprints}
              currentUrl={panel.url}
              onExcludedSites={(sites) => {
                void window.intoponet.privacy.setExcludedSites(sites).then((state) => {
                  setPrivacyState(state)
                  // Forget what was already kept for newly excluded sites.
                  setRecents((current) => current.filter((page) => !isExcludedSite(page.url, state.excludedSites)))
                }, () => setError('The list of sites could not be saved.'))
              }}
            />
          ) : libraryTab === 'recent' ? (
            recents.length === 0 ? (
              <div className="bookmark-empty">
                <Globe2 size={22} />
                <p>{privacySettings.footprints ? 'Visited pages will appear here on this device only.' : 'Footprints are off: visited pages are not kept. Turn them on in Privacy.'}</p>
              </div>
            ) : (
              <ul className="bookmark-list">
                {recents.map((page) => (
                  <li key={`${page.url}-${page.visitedAt}`}>
                    <button
                      type="button"
                      className="bookmark-destination"
                      onClick={() => openRecent(page)}
                    >
                      <strong>{page.title || originLabel(page.url)}</strong>
                      <span className="origin-line"><SiteIcon url={page.url} />{originLabel(page.url)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : libraryTab === 'locations' ? (
            bookmarks.length === 0 ? (
              <div className="bookmark-empty">
                <Bookmark size={22} />
                <p>Save a page from its browser controls. It will stay on this device.</p>
              </div>
            ) : (
              <ul className="bookmark-list">
                {bookmarks
                  .slice()
                  .reverse()
                  .map((bookmark) => (
                    <li key={bookmark.url} className="bookmark-item">
                      <button
                        type="button"
                        className="bookmark-destination"
                        onClick={() => openBookmark(bookmark)}
                      >
                        <strong>{bookmark.title}</strong>
                        <span className="origin-line"><SiteIcon url={bookmark.url} />{originLabel(bookmark.url)}</span>
                        <small>{bookmark.tags?.length ? 'Tags' : 'Topic'} · {tagsOf(bookmark).join(', ')}</small>
                      </button>
                      <div className="bookmark-pin-actions">
                        <span>{bookmark.fieldAnchor ? `Map pin · ${bookmark.fieldAnchor.label}` : 'Conceptual pin · no geographic location'}</span>
                        {bookmark.fieldAnchor && !bookmark.hiddenOnMap && globePrefs.pins && (
                          <button type="button" onClick={() => showPinOnGlobe(bookmark)}>Show on globe</button>
                        )}
                        {bookmark.fieldAnchor && (
                          <button
                            type="button"
                            aria-pressed={!bookmark.hiddenOnMap}
                            title={bookmark.hiddenOnMap ? 'Hidden from the globe. The page stays saved.' : 'Hide this pin from the globe. The page stays saved.'}
                            onClick={() => toggleHiddenPin(bookmark.url)}
                          >
                            {bookmark.hiddenOnMap ? 'Show pin' : 'Hide pin'}
                          </button>
                        )}
                        <button type="button" onClick={() => openPinEditor(bookmark)}>Edit pin</button>
                        <button
                          type="button"
                          title="Recommend this page publicly as a beacon. You'll see exactly what is sent first."
                          onClick={() => setBeaconDraft({ url: bookmark.url, title: bookmark.title, topic: bookmark.topic, ...(bookmark.fieldAnchor ? { place: bookmark.fieldAnchor } : {}) })}
                        >
                          Publish beacon…
                        </button>
                      </div>
                      {selectedPinUrl === bookmark.url && (
                        <div className="bookmark-pin-detail" role="status">
                          <strong>{bookmark.title}</strong>
                          <span>{bookmark.fieldAnchor ? `${bookmark.fieldAnchor.label} · ${bookmark.fieldAnchor.lat.toFixed(4)}, ${bookmark.fieldAnchor.lon.toFixed(4)}` : 'This page is saved without a geographic claim.'}</span>
                          {bookmark.note && <small>{bookmark.note}</small>}
                        </div>
                      )}
                      <label className="bookmark-note">
                        <span className="sr-only">Private note for {bookmark.title}</span>
                        <input
                          value={bookmark.note ?? ''}
                          onChange={(event) =>
                            updateBookmarkNote(bookmark.url, event.target.value)
                          }
                          placeholder="Private note"
                          maxLength={500}
                        />
                      </label>
                      <button
                        type="button"
                        className="bookmark-delete"
                        aria-label={`Delete ${bookmark.title}`}
                        onClick={() => removeBookmark(bookmark.url)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </li>
                  ))}
              </ul>
            )
          ) : libraryTab === 'absorbed' ? (
            <div className="collection-pane">
              <form className="collection-create" onSubmit={keepExcerpt}>
                <p className="absorb-source">
                  {panel.url ? originLabel(panel.url) : 'Open a page, then keep a short excerpt.'}
                </p>
                <label>
                  <span className="sr-only">Excerpt to absorb</span>
                  <textarea
                    className="absorb-excerpt"
                    value={absorbExcerpt}
                    onChange={(event) => setAbsorbExcerpt(event.target.value)}
                    placeholder="Excerpt you choose to keep on this device"
                    maxLength={2000}
                  />
                </label>
                <button type="submit" disabled={!panel.url}>
                  Absorb
                </button>
              </form>
              <label className="bookmark-note">
                <span className="sr-only">Search absorbed pages</span>
                <input
                  value={absorbQuery}
                  onChange={(event) => setAbsorbQuery(event.target.value)}
                  placeholder="Search absorbed excerpts"
                />
              </label>
              <ul className="bookmark-list">
                {searchAbsorbed(absorbed, absorbQuery).map((record) => (
                  <li key={record.id}>
                    <button
                      type="button"
                      className="bookmark-destination"
                      onClick={() =>
                        void window.intoponet.browserHost.open({
                          kind: 'url',
                          value: record.citationUrl,
                        })
                      }
                    >
                      <strong>{record.citationTitle}</strong>
                      <span>{record.excerpt}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <h3>Historical links</h3>
              <ul className="bookmark-list">
                {historicalFixtures.map((edge) => (
                  <li key={edge.id}>
                    <strong>
                      {edge.from} → {edge.to}
                    </strong>
                    <span>{relationshipLabel(edge)}</span>
                    <small>{edge.citationTitle}</small>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="collection-pane">
              <form className="collection-create" onSubmit={addCollection}>
                <label>
                  <span className="sr-only">New collection name</span>
                  <input
                    value={collectionDraft}
                    onChange={(event) => setCollectionDraft(event.target.value)}
                    placeholder="Name a collection"
                    maxLength={80}
                  />
                </label>
                <button type="submit" aria-label="Create collection">
                  <FolderPlus size={15} />
                </button>
              </form>
              {collections.length === 0 ? (
                <div className="bookmark-empty">
                  <FolderPlus size={22} />
                  <p>Group saved pages into a private collection. Nothing leaves this device.</p>
                </div>
              ) : (
                <ul className="bookmark-list">
                  {collections.map((collection) => {
                    const members = bookmarks.filter((bookmark) =>
                      collection.memberUrls.includes(bookmark.url),
                    )
                    const isExpanded = expandedCollection === collection.id
                    return (
                      <li key={collection.id} className="collection-item">
                        <div className="collection-row">
                          {renamingCollection === collection.id ? (
                            <form
                              className="collection-rename"
                              onSubmit={(event) => {
                                event.preventDefault()
                                commitCollectionRename(collection.id)
                              }}
                            >
                              <label>
                                <span className="sr-only">Rename {collection.label}</span>
                                <input
                                  value={renameDraft}
                                  onChange={(event) => setRenameDraft(event.target.value)}
                                  onBlur={() => commitCollectionRename(collection.id)}
                                  maxLength={80}
                                  autoFocus
                                />
                              </label>
                            </form>
                          ) : (
                            <button
                              type="button"
                              className="bookmark-destination"
                              onClick={() =>
                                setExpandedCollection(isExpanded ? '' : collection.id)
                              }
                            >
                              <strong>{collection.label}</strong>
                              <span>{members.length} saved pages</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className="bookmark-delete"
                            aria-label={`Rename ${collection.label}`}
                            onClick={() => {
                              setRenamingCollection(collection.id)
                              setRenameDraft(collection.label)
                            }}
                          >
                            <Pencil size={14} />
                          </button>
                          {panel.url && (
                            <button
                              type="button"
                              className="bookmark-delete"
                              aria-label={`Add current page to ${collection.label}`}
                              onClick={() => addPageToCollection(collection.id)}
                            >
                              <Bookmark size={14} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="bookmark-delete"
                            aria-label={`Delete ${collection.label}`}
                            onClick={() => removeCollection(collection.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                        {isExpanded && (() => {
                          const why = explainCollection(collection, bookmarks)
                          const others = collections.filter((item) => item.id !== collection.id)
                          return (
                            <div className="collection-why">
                              {why.pages > 0 ? (
                                <p>
                                  <strong>What's in it:</strong> {why.pages} page{why.pages === 1 ? '' : 's'} from {why.sites.slice(0, 3).map((site) => `${site.name} (${site.count})`).join(', ')}{why.sites.length > 3 ? ` and ${why.sites.length - 3} more site${why.sites.length - 3 === 1 ? '' : 's'}` : ''}.
                                  {why.topics.length > 0 && <> Topics: {why.topics.slice(0, 3).map((topic) => topic.name).join(', ')}.</>}
                                  {why.places.length > 0 && <> Places: {why.places.slice(0, 3).map((place) => place.name).join(', ')}.</>}
                                </p>
                              ) : (
                                <p>Empty. Open a page and use the bookmark button on this row to add it.</p>
                              )}
                              <div className="collection-tools">
                                {others.length > 0 && why.pages > 0 && (
                                  <label>
                                    <span>Merge into</span>
                                    <select
                                      value=""
                                      onChange={(event) => { if (event.target.value) mergeCollectionInto(collection.id, event.target.value) }}
                                      title={`Move all of ${collection.label}'s pages into another collection, then remove ${collection.label}.`}
                                    >
                                      <option value="">Choose…</option>
                                      {others.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                                    </select>
                                  </label>
                                )}
                                {why.splittable && (
                                  <button
                                    type="button"
                                    onClick={() => splitCollection(collection.id)}
                                    title="Each site with two or more pages becomes its own collection. Single pages stay here."
                                  >
                                    Split by site
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })()}
                        {isExpanded && members.length > 0 && (
                          <ul className="collection-members">
                            {members.map((bookmark) => (
                              <li key={bookmark.url}>
                                <button
                                  type="button"
                                  className="bookmark-destination"
                                  onClick={() => openBookmark(bookmark)}
                                >
                                  <strong>{bookmark.title}</strong>
                                  <span className="origin-line"><SiteIcon url={bookmark.url} />{originLabel(bookmark.url)}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </aside>
      )}

      {panel.isVisible && !pinEditor && (
        <section className={`browser-panel${fullWidth ? ' full-width' : ''}`} aria-label="Web browser">
          <div
            className={`browser-chrome${fullWidth && !chromeRevealed ? ' is-tucked' : ''}`}
            onPointerEnter={() => fullWidth && setChromeRevealed(true)}
            onPointerLeave={(event) => {
              if (fullWidth && !event.currentTarget.contains(document.activeElement)) setChromeRevealed(false)
            }}
            onFocusCapture={() => {
              if (!fullWidth) return
              setChromeRevealed(true)
              setChromeHeld(true)
            }}
            onBlurCapture={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
              setChromeHeld(false)
            }}
          >
            {fullWidth && <span className="chrome-rail" aria-hidden="true" />}
            <div className="browser-controls">
              <button
                type="button"
                aria-label="Back"
                disabled={!panel.canGoBack}
                onClick={() => void window.intoponet.browserHost.back()}
              >
                <ArrowLeft size={16} />
              </button>
              <button
                type="button"
                aria-label="Forward"
                disabled={!panel.canGoForward}
                onClick={() => void window.intoponet.browserHost.forward()}
              >
                <ArrowRight size={16} />
              </button>
              <button
                type="button"
                aria-label={panel.isLoading ? 'Stop loading' : 'Reload'}
                onClick={() =>
                  void (panel.isLoading
                    ? window.intoponet.browserHost.stop()
                    : window.intoponet.browserHost.reload())
                }
              >
                {panel.isLoading ? (
                  <Square size={12} />
                ) : (
                  <RefreshCw size={15} />
                )}
              </button>
            </div>
            {!onStartPage && <button
              type="button"
              className={`origin-badge ${isSecureOrigin ? '' : 'insecure'}`}
              title={shownAddress}
              aria-label={
                isSecureOrigin
                  ? `Secure origin ${originLabel(shownAddress)}. Edit address`
                  : `Not secure: ${originLabel(shownAddress)}. Edit address`
              }
              onClick={fillLauncherFromPage}
            >
              {addressCopied ? <>
                <Check size={13} />
                <span className="origin-copied">{addressCopied}</span>
              </> : <>
                {isSecureOrigin ? <LockKeyhole size={13} /> : <ShieldAlert size={13} />}
                {!isSecureOrigin && <strong>Not secure</strong>}
                <span>{originLabel(shownAddress)}</span>
              </>}
            </button>}
            <span className="sr-only" role="status">{addressCopied}</span>
            <span className="sr-only" aria-live="assertive">{tabSwitcherAnnouncement}</span>
            {onStartPage && <span className="origin-badge start-origin" aria-label="New tab"><Globe2 size={13} /><span>New tab</span></span>}
            <div className="browser-actions">
              {!onStartPage && panel.zoomFactor !== undefined && Math.abs(panel.zoomFactor - 1) > 0.005 && (
                <button
                  type="button"
                  className="zoom-indicator"
                  title="Page zoom. Click to reset to 100%"
                  aria-label={`Page zoom ${Math.round(panel.zoomFactor * 100)}%. Reset to 100%`}
                  onClick={() => void window.intoponet.browserHost.zoom('reset')}
                >
                  {Math.round(panel.zoomFactor * 100)}%
                </button>
              )}
              {!onStartPage && <>
              <div className="shield-control">
                <button
                  type="button"
                  className={`${shieldOpen ? 'selected' : ''}${protection.enabled ? '' : ' paused'}`}
                  aria-expanded={shieldOpen}
                  aria-controls="protection-panel"
                  aria-label={
                    protection.enabled
                      ? `Protection on this site. ${protection.blockedAds + protection.blockedTrackers} blocked`
                      : 'Protection paused on this site'
                  }
                  onClick={() => setShieldOpen((open) => !open)}
                >
                  {protection.enabled ? <Shield size={15} /> : <ShieldOff size={15} />}
                  <span className="chrome-label">{protection.enabled ? 'Protected' : 'Paused'}</span>
                  {protection.enabled &&
                    protection.blockedAds + protection.blockedTrackers > 0 && (
                      <em>{protection.blockedAds + protection.blockedTrackers}</em>
                    )}
                </button>
              </div>
              {passwordState && !panel.isPrivate && (passwordState.accounts.length > 0 || passwordState.offer) && (
                <button
                  type="button"
                  className={`password-toggle${passwordState.offer || passwordState.choose || passwordPicking ? ' selected' : ''}${passwordState.offer ? ' has-offer' : ''}`}
                  aria-label={passwordState.offer ? 'Save password for this site' : `Saved sign-ins for this site (${passwordState.accounts.length})`}
                  aria-expanded={!!passwordState.offer || passwordState.choose || passwordPicking}
                  title={passwordState.offer ? 'Save the password you just used' : 'Fill a saved sign-in'}
                  onClick={() => setPasswordPicking((open) => !open)}
                >
                  <KeyRound size={15} />
                  <span className="chrome-label">Passwords</span>
                </button>
              )}
              {(() => {
                const detected = translation.page.status === 'idle' ? translation.page.detected : null
                const offer = !!detected && detected !== translation.target && translation.supported(detected)
                const active = translation.page.status === 'translated' || translation.page.status === 'translating'
                const fetching = translation.status?.downloading ?? null
                const fetchingForPage = !!fetching && !!detected && (fetching.code === detected || fetching.code === translation.target)
                return (
                  <button
                    type="button"
                    className={`translate-toggle${translateOpen || active ? ' selected' : ''}${offer ? ' has-offer' : ''}`}
                    aria-label={active ? 'Translation: showing translated page' : offer ? 'Translate this page' : 'Translate'}
                    aria-expanded={translateOpen}
                    title={fetchingForPage && fetching ? `Getting ${languageName(fetching.code)} to translate this page on this Mac · ${formatMegabytes(fetching.receivedBytes)} of ${formatMegabytes(fetching.totalBytes)}` : offer ? 'This page can be translated on this Mac' : 'Translate (on this Mac)'}
                    onClick={() => setTranslateOpen((open) => !open)}
                  >
                    {fetchingForPage ? <LoaderCircle size={15} className="tr-spin" /> : <Languages size={15} />}
                    <span className="chrome-label">{fetchingForPage && fetching ? `Getting ${languageName(fetching.code)} · ${fetching.totalBytes ? Math.round((fetching.receivedBytes / fetching.totalBytes) * 100) : 0}%` : active ? 'Translated' : 'Translate'}</span>
                  </button>
                )
              })()}
              <AnimatePresence mode="popLayout" initial={false}>
                {recorder.state.status !== 'idle' ? (
                  <RecordingPill key="rec" state={recorder.state} onStop={() => void recorder.stop()} />
                ) : (
                  <button
                    key="capture"
                    type="button"
                    className={captureSession ? 'selected' : ''}
                    aria-label="Capture this page: screenshot or recording"
                    title="Capture: screenshot or recording (⇧⌘S)"
                    onClick={() => void startCapture('image')}
                  >
                    <Aperture size={15} />
                    <span className="chrome-label">Capture</span>
                  </button>
                )}
              </AnimatePresence>
              <span className="pdf-tool">
                <button
                  type="button"
                  className={pdfStatus?.state === 'working' ? 'selected' : ''}
                  aria-label="Save this page as PDF"
                  aria-busy={pdfStatus?.state === 'working'}
                  title="Save as PDF in one click (⌥⌘E). ⌥-click for options."
                  onClick={(event) => {
                    if (event.altKey) { setPdfOptionsOpen((open) => !open); return }
                    if (pdfStatus?.state === 'working') return
                    void window.intoponet.browserHost.exportPdf().catch(() => undefined)
                  }}
                >
                  {pdfStatus?.state === 'working' ? <LoaderCircle size={15} className="pdf-spin" /> : <FileDown size={15} />}
                  <span className="chrome-label">PDF</span>
                </button>
                <button
                  type="button"
                  className={`pdf-more${pdfOptionsOpen ? ' selected' : ''}`}
                  aria-label="PDF options"
                  aria-expanded={pdfOptionsOpen}
                  title="PDF options: layout, paper, text size, bookmark group"
                  onClick={() => setPdfOptionsOpen((open) => !open)}
                >
                  <ChevronDown size={12} />
                </button>
              </span>
              <button
                type="button"
                className={isBookmarked ? 'selected' : ''}
                aria-label={isBookmarked ? 'Edit current page pin' : 'Pin current page to My map'}
                aria-pressed={isBookmarked}
                title="Pin this page to a place on My map"
                onClick={() => openPinEditor()}
              >
                <MapPin size={15} />
                <span className="chrome-label">Pin</span>
              </button>
              <button
                type="button"
                aria-label="Absorb this page into your knowledge"
                title="Absorb: keep this page's text in your private knowledge, searchable and askable"
                onClick={() => startAbsorb('article')}
              >
                <Library size={15} />
                <span className="chrome-label">Absorb</span>
              </button>
              <div className={`chrome-more${moreToolsOpen ? ' is-open' : ''}`} onPointerEnter={() => setMoreToolsOpen(true)} onPointerLeave={(event) => {
                if (!event.currentTarget.contains(document.activeElement)) setMoreToolsOpen(false)
              }} onFocusCapture={() => setMoreToolsOpen(true)} onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMoreToolsOpen(false)
              }}>
                <div className="chrome-more-tools" aria-hidden={!moreToolsOpen}>
                  <button
                    type="button"
                    aria-label="Copy page address"
                    onClick={copyPageAddress}
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    type="button"
                    className={findOpen ? 'selected' : ''}
                    aria-label="Find in page"
                    aria-pressed={findOpen}
                    onClick={openFind}
                  >
                    <Search size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label="Print page"
                    onClick={() => void window.intoponet.browserHost.print()}
                  >
                    <Printer size={15} />
                  </button>
                </div>
                <button
                  type="button"
                  className="chrome-more-toggle"
                  aria-label={moreToolsOpen ? 'Hide more tools' : 'More tools: copy address, find, print'}
                  aria-expanded={moreToolsOpen}
                  title="More tools"
                  onClick={() => setMoreToolsOpen((open) => !open)}
                >
                  <Ellipsis size={16} />
                </button>
              </div>
              </>}
              <DownloadsButton onError={setError} />
              <button
                type="button"
                className={bookmarksOpen ? 'selected' : ''}
                aria-label={`${bookmarksOpen ? 'Hide' : 'Show'} bookmarks${isBookmarked ? '. This page is saved' : ''}`}
                aria-pressed={bookmarksOpen}
                title="Bookmarks (⇧⌘B). Save this page with ⌘D."
                onClick={toggleBookmarksPane}
              >
                <Bookmark size={15} fill={isBookmarked ? 'currentColor' : 'none'} />
                <span className="chrome-label">Bookmarks</span>
              </button>
              <button
                type="button"
                aria-label={fullWidth ? 'Exit full width' : 'Full width'}
                aria-pressed={fullWidth}
                className={fullWidth ? 'selected' : ''}
                onClick={() => setBrowserFullWidth(!fullWidth)}
              >
                {fullWidth ? <Shrink size={15} /> : <Expand size={15} />}
              </button>
              <button
                type="button"
                aria-label="Close screen"
                onClick={() => {
                  closeFind()
                  setBrowserFullWidth(false)
                  void window.intoponet.browserHost.close()
                }}
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <PdfBar
            status={pdfStatus}
            optionsOpen={pdfOptionsOpen}
            groups={captureGroups}
            isPrivate={!!panel.isPrivate}
            onClose={() => setPdfStatus((current) => (current?.state === 'working' ? current : null))}
            onCloseOptions={() => setPdfOptionsOpen(false)}
            onError={setError}
            onShowAll={() => { setBookmarkFilterRequest({ filter: 'pdfs', at: Date.now() }); setBookmarksOpen(true) }}
          />
          {translateOpen && <TranslateBar model={translation} onClose={() => setTranslateOpen(false)} site={pageSite} neverSite={neverThisSite} onNeverSite={setNeverSite} />}
          {freeCoverage && (
            <FreeCoverageBar
              title={freeCoverage.title || panel.title}
              url={freeCoverage.url}
              signals={freeCoverage.signals}
              candidates={[
                ...(newsDigest?.global ?? []).flatMap((story) => story.headlines),
                ...(newsDigest?.countries ?? []).flatMap((country) => country.headlines.map((headline) => ({ ...headline, countryCode: country.countryCode }))),
                ...(newsDigest?.places ?? []).flatMap((place) => place.headlines.map((headline) => ({ ...headline, countryCode: place.countryCode }))),
                ...(newsDigest?.rising ?? []).flatMap((term) => term.headlines),
              ]}
              onOpen={(url) => void window.intoponet.browserHost.open({ kind: 'url', value: url })}
              onSearch={(query) => void window.intoponet.browserHost.open({ kind: 'search', value: query })}
              onClose={() => {
                setCoverageAsked(null)
                const next = [...new Set([hostOf(freeCoverage.url), ...accessHidden])].slice(0, 300)
                setAccessHidden(next)
                // Hidden for this session only when the tab is private or the site is left out.
                if (mayRememberSite(freeCoverage.url, panel.isPrivate, excludedSitesRef.current)) {
                  try {
                    // From what is stored, not this session's list (which may hold private or left-out hosts).
                    const stored = JSON.parse(localStorage.getItem('intoponet.paywall-bar-hidden.v1') ?? '[]') as unknown
                    const kept = Array.isArray(stored) ? stored.filter((host): host is string => typeof host === 'string') : []
                    localStorage.setItem('intoponet.paywall-bar-hidden.v1', JSON.stringify([...new Set([hostOf(freeCoverage.url), ...kept])].slice(0, 300)))
                  } catch { /* convenience only */ }
                }
              }}
            />
          )}
          {findOpen && (
            <form
              className="find-bar"
              onSubmit={(event) => {
                event.preventDefault()
                runFind(true, true)
              }}
            >
              <Search size={14} />
              <label>
                <span className="sr-only">Find in page</span>
                <input
                  ref={findInput}
                  value={findQuery}
                  onChange={(event) => {
                    setFindQuery(event.target.value)
                    if (event.target.value.trim()) {
                      void window.intoponet.browserHost.find(event.target.value)
                    } else {
                      void window.intoponet.browserHost.stopFind()
                      setFindResult(null)
                    }
                  }}
                  placeholder="Find in page"
                  autoComplete="off"
                />
              </label>
              <span className="find-count">
                {findResult && findQuery
                  ? `${findResult.activeMatchOrdinal} / ${findResult.matches}`
                  : 'Find'}
              </span>
              <button type="button" aria-label="Previous match" onClick={() => runFind(true, false)}>
                <ArrowLeft size={14} />
              </button>
              <button type="submit" aria-label="Next match">
                <ArrowRight size={14} />
              </button>
              <button type="button" aria-label="Close find" onClick={closeFind}>
                <X size={14} />
              </button>
            </form>
          )}
          {passwordState && !panel.isPrivate && !onStartPage && (
            <PasswordBar
              state={passwordState}
              picking={passwordPicking}
              onClosePicker={() => setPasswordPicking(false)}
              onError={setNotice}
              onSaved={offerBookmarkForSite}
            />
          )}
          {bookmarkSiteOffer && !passwordState?.offer && !panel.isPrivate && !onStartPage && (
            <BookmarkSiteBar
              offer={bookmarkSiteOffer}
              groups={collections.map((collection) => ({ id: collection.id, label: collection.label }))}
              onSave={(group) => bookmarkSiteToGroup(bookmarkSiteOffer, group)}
              onDismiss={() => setBookmarkSiteOffer(null)}
            />
          )}
          {permissionRequests[0] && (
            <PermissionBar
              request={permissionRequests[0]}
              more={permissionRequests.length - 1}
              background={backgroundTabLabel(permissionRequests[0], tabs)}
              onDecide={(decision) => void window.intoponet.sitePermissions.decide(permissionRequests[0]!.id, decision)}
            />
          )}
          {externalRequests[0] && <ExternalOpenBar request={externalRequests[0]} more={externalRequests.length - 1} />}
          {shieldOpen && (
            <div className={`shield-bar${protection.enabled ? '' : ' is-paused'}`} id="protection-panel" role="region" aria-label="Site protection">
              <span className="shield-bar-status">
                {protection.enabled ? <Shield size={14} aria-hidden="true" /> : <ShieldOff size={14} aria-hidden="true" />}
                <strong>{protection.enabled ? 'Protected' : 'Paused'}</strong>
                <span>{protection.blockedAds} ad{protection.blockedAds === 1 ? '' : 's'} · {protection.blockedTrackers} tracker{protection.blockedTrackers === 1 ? '' : 's'} blocked</span>
              </span>
              <span className="shield-bar-group" role="group" aria-label="Protection settings">
                <label>
                  <input
                    type="checkbox"
                    checked={protection.adsEnabled}
                    onChange={(event) => void window.intoponet.browserHost.setProtectionCategories({ ads: event.target.checked, trackers: protection.trackersEnabled })}
                  />
                  Block ads
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={protection.trackersEnabled}
                    onChange={(event) => void window.intoponet.browserHost.setProtectionCategories({ ads: protection.adsEnabled, trackers: event.target.checked })}
                  />
                  Block trackers
                </label>
              </span>
              {protection.network && (
                <span className="shield-bar-group shield-bar-network" aria-label="Network privacy">
                  <span className={protection.network.encryptedDns ? 'is-on' : 'is-off'} title={protection.network.encryptedDns ? `Encrypted DNS via ${protection.network.dnsProviders}` : 'Encrypted DNS unavailable'}>Encrypted DNS</span>
                  <span className={protection.network.webrtcLocalIpHidden ? 'is-on' : 'is-off'} title="Your local IP address is hidden from WebRTC">Local IP hidden</span>
                  <span className="is-pending" title="VPN not set up: sites can still see your public IP">No VPN</span>
                </span>
              )}
              {/^https?:/.test(pageOrigin) && (
                <SitePermissionChips
                  origin={pageOrigin}
                  map={sitePermissionMap}
                  onReset={(kind) => void window.intoponet.sitePermissions.reset(pageOrigin, kind).then((map) => {
                    setSitePermissionMap(map)
                    setNotice(kind === 'camera' || kind === 'microphone'
                      ? 'Saved permission cleared. Close or reload this page to stop any active camera or microphone capture.'
                      : 'Saved permission cleared. This site will ask again.')
                  }, () => setNotice('The saved permission could not be cleared. Try again.'))}
                />
              )}
              <span className="shield-bar-actions">
                <button type="button" className="shield-bar-toggle" aria-expanded={siteTweaksOpen} aria-controls="site-tweaks-panel" onClick={() => setSiteTweaksOpen((open) => !open)}>
                  Customize site
                </button>
                <button type="button" className="shield-bar-toggle" title={protection.enabled ? "Turn protection off for this site and reload it (use if the page looks broken)" : "Turn protection back on and reload"} onClick={() => setSiteProtection(!protection.enabled)}>
                  {protection.enabled ? 'Pause on this site' : 'Resume protection'}
                </button>
                <button type="button" className="shield-bar-close" aria-label="Close protection bar" onClick={() => setShieldOpen(false)}>
                  <X size={14} />
                </button>
              </span>
              {siteTweaksOpen && <SiteTweaksPanel pageUrl={panel.url} />}
            </div>
          )}
          <div ref={panelBody} className="browser-body">
            {/* Beside another page, a start or error page fills only its own half (the other is a page). */}
            {panel.isVisible && panel.loadError && !onStartPage && (
              <SplitStartFrame rect={panel.split?.sides[panel.split.focused]}>
                <ErrorPage
                  error={panel.loadError}
                  canGoBack={panel.canGoBack}
                  retrying={panel.isLoading}
                  onRetry={() => void window.intoponet.browserHost.reload()}
                  onBack={() => void window.intoponet.browserHost.back()}
                  onTurnOffTweaks={failedSiteHasTweaks ? () => void window.intoponet.browserHost.siteTweaks.setEnabled(false).then(() => window.intoponet.browserHost.reload()) : undefined}
                />
              </SplitStartFrame>
            )}
            {onStartPage && (
              <SplitStartFrame rect={panel.split?.sides[panel.split.focused]}>
                <StartPage
                  tabId={tabs.find((tab) => tab.active)?.id ?? ''}
                  bookmarks={startPageBookmarks}
                  recents={startPageRecents}
                  news={startPageNews}
                  newsLoaded={newsDigest !== null}
                  isPrivate={panel.isPrivate === true}
                  onSubmit={submitFromStartPage}
                  onOpen={(url) => void submitFromStartPage(url).catch(() => undefined)}
                />
              </SplitStartFrame>
            )}
            {/* The side not in focus, when its own view is hidden: its error card or start page fills its half (a click focuses it). */}
            {panel.isVisible && panel.split && otherSide && (
              <OtherSideFrame split={panel.split} side={otherSide.side}>
                {otherSide.tab.loadError ? (
                  <ErrorCard
                    error={otherSide.tab.loadError}
                    label={otherSide.side === 'left' ? 'Left page' : 'Right page'}
                    onRetry={() => void window.intoponet.browserHost.focusSplitSide(otherSide.side).then(() => window.intoponet.browserHost.reload(), () => undefined)}
                  />
                ) : (
                  <div className="split-other-start" inert>
                    <StartPage
                      tabId={otherSide.tab.id}
                      bookmarks={startPageBookmarks}
                      recents={startPageRecents}
                      news={startPageNews}
                      newsLoaded={newsDigest !== null}
                      isPrivate={panel.isPrivate === true}
                      onSubmit={() => Promise.resolve()}
                      onOpen={() => undefined}
                    />
                  </div>
                )}
              </OtherSideFrame>
            )}
          </div>
        </section>
      )}

      {panel.isVisible && (
        <SplitChrome
          split={panel.split}
          preview={panel.splitPreview}
          compare={{
            // A side's Translate: focus that side (Translate acts on the focused page), then open the bar.
            translate: (side) => { void window.intoponet.browserHost.focusSplitSide(side).then(() => setTranslateOpen(true), () => undefined) },
            // A side's Free coverage: that side takes the focus (if it has not) and its choices open, also where they were closed.
            freeCoverage: (side) => {
              const url = panel.split?.[side].url
              if (!url) return
              setCoverageAsked(url)
              if (panel.split?.focused !== side) void window.intoponet.browserHost.focusSplitSide(side).catch(() => undefined)
            },
            // The Olds for a Compare pair: the story's own history, as the world story's button opens it.
            olds: (storyId) => {
              const story = newsDigest?.global?.find((item) => item.id === storyId)
              if (!story) return
              // The Olds shows over the globe, so the browser steps aside (its pages stay open in their tabs).
              void window.intoponet.browserHost.close()
              const lang = story.headlines.find((item) => item.url === story.url)?.lang ?? 'en'
              openOldsForHeadline({ title: story.title, url: story.url, publisher: story.publisher, publishedAt: story.latestAt, lang }, /^en/i.test(lang) ? story.title : null, null)
            },
          }}
        />
      )}

      <div className="command-dock">
        {tabs.length > 0 && !railVisible && (
          <div className="page-tab-row">
            {tabEdges.overflow && (
              <button
                type="button"
                className="tab-scroll"
                aria-label="Previous tabs"
                disabled={tabEdges.atStart}
                onClick={() => scrollTabs(-1)}
              >
                <ChevronLeft size={14} />
              </button>
            )}
            <PageTabStrip tabs={tabs} stripRef={tabStrip} caption={tabCaption} label={(tab) => tab.title || originLabel(tab.url)} />
            {tabEdges.overflow && (
              <button
                type="button"
                className="tab-scroll"
                aria-label="Next tabs"
                disabled={tabEdges.atEnd}
                onClick={() => scrollTabs(1)}
              >
                <ChevronRight size={14} />
              </button>
            )}
          </div>
        )}
        <form className="command-launcher unified-launcher" onSubmit={submit}>
          <OmniboxSuggestions {...omnibox.list} />
          <label className="command-input">
            <span className="sr-only">Search, fly to a place, or enter a web address</span>
            <input
              ref={input}
              {...omnibox.inputProps}
              placeholder="Search, fly to a place, or enter a web address"
              autoComplete="off"
              spellCheck
            />
          </label>
          <button className="go-button" type="submit" aria-label="Go">
            <ChevronRight size={18} />
          </button>
        </form>
        <span className="shortcut-hint">
          ⌘L  ⌘F  ⌃⇥  [ ]
        </span>
      </div>

      <UpdateBanner />
      {/* Never over a web page (it would sit under it) or The Olds. */}
      <FeedbackPrompt hidden={panel.isVisible || !!olds || fieldLabOpen} />
      {/* Tabs just tidied away, when the sidebar is not there to say so (it is drawn under a page otherwise). */}
      {justArchived && !railVisible && !panel.isVisible && (
        <div className="notice-message tab-archive-notice" role="status">
          {justArchived.ids.length === 1 ? `Archived “${justArchived.titles[0]}”` : `${justArchived.ids.length} tabs archived`}
          <button type="button" className="notice-undo" onClick={undoArchive}>Undo</button>
        </div>
      )}
      {notice && (
        <div className="notice-message" role="status">
          {notice}
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss notice">
            <X size={14} />
          </button>
        </div>
      )}

      {error && (
        <div className="error-message" role="alert">
          {error}
          <button type="button" onClick={() => setError('')} aria-label="Dismiss error">
            <X size={14} />
          </button>
        </div>
      )}
      {captureStoreError && (
        <div className="error-message" role="alert">
          {captureStoreError}
        </div>
      )}
      {libraryReadError && (
        <div className="error-message" role="alert">
          {libraryReadError}
        </div>
      )}

      {!fieldLabOpen && <div className="scale-indicator" aria-hidden="true">
        <span />
        <small>{scaleLabel(scale)}</small>
      </div>}
    </main>
  )
}
