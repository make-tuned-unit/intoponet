import type {
  BrowserPanelSnapshot,
  FindInPageResult,
  PageTabSnapshot,
  ProtectionSnapshot,
} from '@intoponet/browser-api'
import { demoFieldSnapshot, parseFieldSnapshot, snapshotLabel } from '@intoponet/field-snapshot'
import type { FieldSnapshot } from '@intoponet/field-snapshot'
import { latLonToOrbit, syntheticTopicGraph } from '@intoponet/frequency-field'
import {
  absorbPage,
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
  ChevronLeft,
  ChevronRight,
  Copy,
  Expand,
  FolderPlus,
  Globe2,
  LockKeyhole,
  Library,
  MapPin,
  Pencil,
  Printer,
  RefreshCw,
  Search,
  Shrink,
  Shield,
  ShieldAlert,
  ShieldOff,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { signalsFromSnapshot, syntheticPreviewInterestSignals } from './interestField'
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
import { PinEditor, type PinEditorValue } from './PinEditor'

type LibraryTab = 'locations' | 'collections' | 'recent' | 'absorbed'
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
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function tabCaption(tab: PageTabSnapshot): string {
  const raw = (tab.title || originLabel(tab.url)).replace(/\s+/g, ' ').trim()
  return raw.slice(0, 10)
}

export function App() {
  const [query, setQuery] = useState('')
  const [panel, setPanel] = useState<BrowserPanelSnapshot>(emptyPanel)
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
  const [recents, setRecents] = useState(readRecents)
  const [absorbed, setAbsorbed] = useState<AbsorbRecord[]>([])
  const [absorbExcerpt, setAbsorbExcerpt] = useState('')
  const [absorbQuery, setAbsorbQuery] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [libraryReady, setLibraryReady] = useState(false)
  const [publicSnapshot, setPublicSnapshot] = useState<FieldSnapshot | null>(null)
  const [personalActivity, setPersonalActivity] = useState(emptyPersonalActivity)
  const [fieldView, setFieldView] = useState<'personal' | 'public'>('personal')
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
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('locations')
  const [pinEditor, setPinEditor] = useState<{ initial: PinEditorValue; originalUrl: string; restoreBrowser: boolean; restoreFullWidth: boolean } | null>(null)
  const [selectedPinUrl, setSelectedPinUrl] = useState('')
  const [collectionDraft, setCollectionDraft] = useState('')
  const [expandedCollection, setExpandedCollection] = useState('')
  const [renamingCollection, setRenamingCollection] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findResult, setFindResult] = useState<FindInPageResult | null>(null)
  const [protection, setProtection] = useState<ProtectionSnapshot>(emptyProtection)
  const [shieldOpen, setShieldOpen] = useState(false)
  const [tabs, setTabs] = useState<PageTabSnapshot[]>([])
  const [fullWidth, setFullWidth] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [libraryReadError, setLibraryReadError] = useState('')
  const panelBody = useRef<HTMLDivElement>(null)
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
    const eligibleSnapshot = eligiblePublicSnapshot
    const topicIds = [...new Set([
      ...eligibleSnapshot.sources.flatMap((source) => source.topics),
      ...eligibleSnapshot.bands.flatMap((band) => band.topicIds),
    ])]
    return topicIds.flatMap((topicId) => signalsFromSnapshot(eligibleSnapshot, topicId))
      .filter((signal) => signal.sourceType === 'public-aggregate')
      .filter((signal, index, all) => all.findIndex((candidate) => candidate.id === signal.id) === index)
  }, [designPreview, previewTopic, previewIntensity, previewRadiusScale, fieldView, personalActivity, eligiblePublicSnapshot])
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
  const fieldNote = publicSnapshot ? snapshotLabel(publicSnapshot) : demoFieldSnapshot().coverageNote
  const fieldProvenanceNote = designPreview
    ? 'Synthetic radial preview for visual QA. Not public activity; observed sources remain unchanged. Surface shading · glow off.'
    : fieldView === 'personal'
      ? `This session: ${personalActivity.visits.length} eligible visits · ${unplacedPersonalVisitCount(personalActivity)} without a topic destination. Nothing is shared.`
      : publicSnapshot
        ? `${fieldNote} Adult or ineligible public records are filtered before rendering.`
        : 'No public snapshot is available. Design preview is synthetic and explicitly labeled.'

  useEffect(() => {
    if (!publicSnapshot || !selectedTopic || activeTopic === selectedTopic.label) return
    setActiveTopic(selectedTopic.label)
    localStorage.setItem(topicKey, selectedTopic.label)
  }, [activeTopic, publicSnapshot, selectedTopic])
  const isBookmarked = useMemo(
    () => bookmarks.some((bookmark) => bookmark.url === panel.url),
    [bookmarks, panel.url],
  )
  const isSecureOrigin = panel.url.startsWith('https:')
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (): void => setReduceMotion(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const unsubscribe = window.intoponet.browserHost.subscribe((event) => {
      if (event.type === 'panel-state') {
        setPanel(event.panel)
        setError('')
        return
      }
      if (event.type === 'frequency-visit') {
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
      if (event.type === 'navigation-failed') {
        setError(`${event.reason} (${event.url})`)
        return
      }
      if (event.type === 'field-snapshot') {
        setPublicSnapshot(parseFieldSnapshot(event.payload))
      }
    })
    void window.intoponet.browserHost.getState().then(setPanel)
    void window.intoponet.browserHost.getProtection().then(setProtection)
    void window.intoponet.browserHost.getTabs().then((nextTabs) => {
      activeTabId.current = nextTabs.find((tab) => tab.active)?.id ?? null
      setTabs(nextTabs)
    })
    void window.intoponet.browserHost.getFieldSnapshot().then((payload) => {
      if (payload) setPublicSnapshot(parseFieldSnapshot(payload))
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!panel.url || !/^https?:\/\//.test(panel.url)) return
    setRecents((current) =>
      rememberRecent(current, {
        url: panel.url,
        title: panel.title || originLabel(panel.url),
        visitedAt: new Date().toISOString(),
      }),
    )
  }, [panel.title, panel.url])

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
          setBookmarks(parsed.library.bookmarks)
          setCollections(parsed.library.collections)
          setRecents(parsed.library.recents)
          setAbsorbed(parsed.library.absorbed)
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

  useEffect(() => {
    if (!libraryReady) return
    const payload = serializePrivateLibrary({
      schema: privateLibrarySchema,
      bookmarks,
      collections,
      recents,
      absorbed,
    })
    void window.intoponet.browserHost.writePrivateLibrary(payload).catch(() => {
      if (sealWarned.current) return
      sealWarned.current = true
      setNotice('Private library stayed in this window. On-device encryption is unavailable.')
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
  }, [findOpen, fullWidth, panel.isVisible, shieldOpen])

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (pinEditor) return
      const key = event.key.toLowerCase()
      const meta = event.metaKey || event.ctrlKey
      if (meta && key === 'l') {
        event.preventDefault()
        if (panel.url) {
          setQuery(panel.url)
        }
        input.current?.focus()
        input.current?.select()
      }
      if (meta && key === 'f' && panel.isVisible) {
        event.preventDefault()
        openFind()
      }
      if (meta && key === 'p' && panel.isVisible) {
        event.preventDefault()
        void window.intoponet.browserHost.print()
      }
      if (meta && (event.key === '=' || event.key === '+') && panel.isVisible) {
        event.preventDefault()
        void window.intoponet.browserHost.zoom('in')
      }
      if (meta && event.key === '-' && panel.isVisible) {
        event.preventDefault()
        void window.intoponet.browserHost.zoom('out')
      }
      if (meta && event.key === '0' && panel.isVisible) {
        event.preventDefault()
        void window.intoponet.browserHost.zoom('reset')
      }
      if (meta && event.shiftKey && key === 'c' && panel.url) {
        event.preventDefault()
        void navigator.clipboard.writeText(panel.url).then(() => {
          setNotice('Copied page address')
        })
      }
      if (meta && key === 'w' && panel.isVisible) {
        event.preventDefault()
        closeFind()
        void window.intoponet.browserHost.close()
      }
      if (meta && key === 'r' && panel.isVisible) {
        event.preventDefault()
        void window.intoponet.browserHost.reload()
      }
      if (meta && key === '[' && panel.canGoBack) {
        event.preventDefault()
        void window.intoponet.browserHost.back()
      }
      if (meta && key === ']' && panel.canGoForward) {
        event.preventDefault()
        void window.intoponet.browserHost.forward()
      }
      if (event.ctrlKey && event.key === 'Tab' && tabs.length > 0) {
        event.preventDefault()
        void window.intoponet.browserHost.cycleTabs(event.shiftKey ? 'previous' : 'next')
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
      } else if (event.key === 'Escape' && panel.isVisible) {
        void window.intoponet.browserHost.close()
      } else if (event.key === 'Escape' && scale !== 'earth') {
        rememberScale(zoomTowardEarth(scale))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTopic, findOpen, fullWidth, libraryOpen, panel.canGoBack, panel.canGoForward, panel.isVisible, panel.url, pinEditor, pose, scale, selectedTopicId, selectedTopicLabel, shieldOpen, tabs.length])

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

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const submittedDraft = query
    const value = submittedDraft.trim()
    if (!value) return
    setError('')
    let intent: ReturnType<typeof inferUnifiedLauncherIntent>
    try {
      intent = inferUnifiedLauncherIntent(value, launcherTopics)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not understand that search or address.')
      return
    }
    if (intent.kind === 'topic') {
      rememberTopic(intent.value)
      setQuery('')
      void window.intoponet.browserHost.close()
      return
    }
    if (intent.kind === 'search') setResearchTopic(intent.value)
    void window.intoponet.browserHost.open(intent).then(() => {
      if (input.current?.value === submittedDraft) setQuery('')
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Navigation failed.')
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
  }

  const deleteLibrary = async (): Promise<void> => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    try {
      await window.intoponet.browserHost.deletePrivateLibrary()
    } catch {
      setError('The private library could not be deleted. Existing data was left untouched.')
      return
    }
    setBookmarks([])
    setCollections([])
    setRecents([])
    setAbsorbed([])
    writeBookmarks([])
    writeCollections([])
    localStorage.removeItem('intoponet.recents.v1')
    setConfirmDelete(false)
    setLibraryReady(true)
    setLibraryReadError('')
    setNotice('Private library deleted from this device')
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

  const showLibrary = (): void => {
    if (panel.isVisible) void window.intoponet.browserHost.close()
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
    void navigator.clipboard.writeText(panel.url).then(() => {
      setNotice('Copied page address')
    })
  }

  const setSiteProtection = (enabled: boolean): void => {
    void window.intoponet.browserHost.setSiteProtection(enabled).then(() => {
      void window.intoponet.browserHost.reload()
    })
  }

  const showEarth = (): void => {
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
    if (!panel.url) return
    setQuery(panel.url)
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

  const setBrowserFullWidth = (enabled: boolean): void => {
    setFullWidth(enabled)
    void window.intoponet.browserHost.setFullWidth(enabled)
  }

  return (
    <main className={`app-shell${panel.isVisible ? ' page-open' : ''}${fullWidth && panel.isVisible ? ' browser-full' : ''}${tabs.length > 0 ? ' tabs-open' : ''}`}>
      {!fieldLabOpen && <FrequencyField
        paused={reduceMotion || (fullWidth && panel.isVisible)}
        panelOpen={panel.isVisible}
        scale={scale}
        topic={visibleTopicLabel}
        anchor={selectedTopicLocation ? { lat: selectedTopicLocation.lat, lon: selectedTopicLocation.lon } : null}
        pose={pose}
        signals={fieldSignals}
        mapPins={bookmarks.map(({ url, title, fieldAnchor }) => ({
          url,
          title,
          ...(fieldAnchor ? { fieldAnchor } : {}),
        }))}
        onPinSelect={selectMapPin}
        membraneSettings={activityMembraneSettings}
        onOrganicMetrics={diagnosticsOpen ? setOrganicMetrics : undefined}
        onDistanceChange={(radius) => {
          const next = scaleFromDistance(radius)
          setPose((current) => ({ ...current, radius }))
          if (next !== scale) rememberScale(next, radius)
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
      <TabDock tabs={tabs} fullWidth={fullWidth} visible={panel.isVisible} />
      {!fieldLabOpen && <div className="field-wash" aria-hidden="true" />}
      {fieldLabOpen && <FieldLab onClose={() => setFieldLabOpen(false)} reducedMotion={reduceMotion} />}

      <header className="topbar">
        <button
          type="button"
          className="brand"
          aria-label="Return to field"
          onClick={showEarth}
        >
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>intoponet</span>
        </button>
        <div className="topbar-actions">
          <div className="privacy-state">
            <LockKeyhole size={13} />
            Personal field stays on this device
          </div>
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
          <button type="button" className="bookmark-library-button" onClick={showLibrary}>
            <MapPin size={14} />
            My map
            {bookmarks.length > 0 && <span>{bookmarks.length}</span>}
          </button>
        </div>
      </header>

      {pinEditor && (
        <PinEditor
          initial={pinEditor.initial}
          locations={pinLocationOptions}
          onCancel={() => finishPinEditor(pinEditor.restoreBrowser, pinEditor.restoreFullWidth)}
          onSave={savePin}
        />
      )}


      {!fieldLabOpen && <section className="exploration-context" aria-labelledby="field-title">
        <p className="sr-only" role="status">
          {scaleLabel(scale)}. {visibleTopicLabel}. {designPreview
            ? 'Design preview. Synthetic frequency membrane, not public activity.'
            : sourceMode === 'personal'
            ? `Personal field. ${personalActivity.visits.length} eligible completed visits this session; ${unplacedPersonalVisitCount(personalActivity)} unplaced.`
            : sourceMode === 'public'
            ? `Public source measurements${selectedTopic?.measurements.length ? `: ${selectedTopic.measurements.join(', ')}.` : '.'}`
            : sourceMode === 'mixed'
              ? 'Mixed public and synthetic field.'
              : sourceMode === 'prototype'
                ? 'No eligible public source field is available.'
                : 'No personal visits have been recorded in this session.'}
        </p>
        <div className="spatial-path" role="navigation" aria-label="Field scale">
          <button type="button" className={scale === 'earth' ? 'current' : ''} aria-current={scale === 'earth' ? 'true' : undefined} onClick={showEarth}>
            Earth
          </button>
          <ChevronRight size={14} />
          <button
            type="button"
            className={scale === 'region' ? 'current' : ''}
            aria-current={scale === 'region' ? 'true' : undefined}
            onClick={showRegion}
          >
            Region
          </button>
          <ChevronRight size={14} />
          <button
            type="button"
            className={scale === 'city' ? 'current' : ''}
            aria-current={scale === 'city' ? 'true' : undefined}
            onClick={showCity}
          >
            City
          </button>
          <ChevronRight size={14} />
          <button
            type="button"
            className={scale === 'topic' ? 'current' : ''}
            aria-current={scale === 'topic' ? 'true' : undefined}
            onClick={() => rememberScale('topic', scaleDistance.topic, activeTopic)}
          >
            {visibleTopicLabel}
          </button>
        </div>
        <h1 id="field-title">{visibleTopicLabel}</h1>
        <p>{topicModeDescription} Move through the field, or go directly to any place on the web.</p>
        {designPreview && scale === 'topic' && (syntheticTopicGraph[visibleTopicLabel]?.length ?? 0) > 0 && (
          <div className="related-topics">
            <span>Related · synthetic</span>
            {syntheticTopicGraph[visibleTopicLabel]?.map((topic) => (
              <button key={topic} type="button" onClick={() => designPreview ? setPreviewTopic(topic) : rememberTopic(topic)}>
                {topic}
              </button>
            ))}
          </div>
        )}
      </section>}

      {!fieldLabOpen && <aside className="coverage-note">
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
      {!fieldLabOpen && fieldView === 'public' && !designPreview && selectedTopicSources.some((source) => source.kind === 'public-record') && (
        <ul className="field-sources" aria-label="Public source records">
          {selectedTopicSources.filter((source) => source.kind === 'public-record').slice(0, 6).map((source) => (
            <li key={source.id}>
              <button
                type="button"
                onClick={() =>
                  void window.intoponet.browserHost.open({ kind: 'url', value: source.url })
                }
              >
                {source.title}
              </button>
            </li>
          ))}
        </ul>
      )}

      {libraryOpen && (
        <aside className="bookmark-drawer" aria-labelledby="bookmark-heading">
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
          </div>
          <div className="library-tools">
            <button type="button" onClick={exportLibrary}>
              Export
            </button>
            <button type="button" onClick={deleteLibrary}>
              {confirmDelete ? 'Confirm delete' : 'Delete library'}
            </button>
          </div>
          {libraryTab === 'recent' ? (
            recents.length === 0 ? (
              <div className="bookmark-empty">
                <Globe2 size={22} />
                <p>Visited pages will appear here on this device only.</p>
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
                      <span>{originLabel(page.url)}</span>
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
                        <span>{originLabel(bookmark.url)}</span>
                        <small>Topic · {bookmark.topic}</small>
                      </button>
                      <div className="bookmark-pin-actions">
                        <span>{bookmark.fieldAnchor ? `Map pin · ${bookmark.fieldAnchor.label}` : 'Conceptual pin · no geographic location'}</span>
                        {bookmark.fieldAnchor && (
                          <button type="button" onClick={() => showPinOnGlobe(bookmark)}>Show on globe</button>
                        )}
                        <button type="button" onClick={() => openPinEditor(bookmark)}>Edit pin</button>
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
                                  <span>{originLabel(bookmark.url)}</span>
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

      {!fieldLabOpen && <section className="accessible-signals" aria-label="Field topics">
        {menuTopics.map((topic) => (
            <button
              key={topic.id}
              type="button"
              aria-pressed={designPreview
                ? previewTopic === topic.label
                : fieldView === 'personal'
                  ? (researchTopic ?? 'General browsing') === topic.id
                  : selectedTopicId === topic.id}
              onClick={() => designPreview ? setPreviewTopic(topic.label) : rememberTopic(topic.label)}
            >
              <span>{topic.label}</span>
              <small>{fieldView === 'personal' && !designPreview
                ? 'Session topic for completed page activity'
                : topic.kind === 'public'
                ? topic.measurements.join(' · ') || 'Public source topic'
                : topic.kind === 'mixed'
                  ? 'Public and synthetic sources'
                  : 'Synthetic topic'}</small>
            </button>
        ))}
      </section>}

      {panel.isVisible && !pinEditor && (
        <section className={`browser-panel${fullWidth ? ' full-width' : ''}`} aria-label="Web browser">
          <div className="browser-chrome">
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
            <button
              type="button"
              className={`origin-badge ${isSecureOrigin ? '' : 'insecure'}`}
              title={panel.url}
              aria-label={
                isSecureOrigin
                  ? `Secure origin ${originLabel(panel.url)}. Edit address`
                  : `Not secure: ${originLabel(panel.url)}. Edit address`
              }
              onClick={fillLauncherFromPage}
            >
              {isSecureOrigin ? <LockKeyhole size={13} /> : <ShieldAlert size={13} />}
              {!isSecureOrigin && <strong>Not secure</strong>}
              <span>{originLabel(panel.url)}</span>
            </button>
            <div className="browser-actions">
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
                  {protection.enabled &&
                    protection.blockedAds + protection.blockedTrackers > 0 && (
                      <em>{protection.blockedAds + protection.blockedTrackers}</em>
                    )}
                </button>
              </div>
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
              <button
                type="button"
                className={isBookmarked ? 'selected' : ''}
                aria-label={isBookmarked ? 'Edit current page pin' : 'Pin current page to My map'}
                aria-pressed={isBookmarked}
                onClick={() => openPinEditor()}
              >
                <MapPin size={15} />
              </button>
              <button
                type="button"
                className={isBookmarked ? 'selected' : ''}
                aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark page'}
                aria-pressed={isBookmarked}
                onClick={toggleBookmark}
              >
                <Bookmark size={15} fill={isBookmarked ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                aria-label="Absorb this page"
                onClick={() => {
                  setLibraryOpen(true)
                  setLibraryTab('absorbed')
                }}
              >
                <Library size={15} />
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
          {shieldOpen && (
            <div className="shield-panel" id="protection-panel" role="dialog" aria-label="Site protection">
              <p>
                <strong>Protection on this site</strong>
                <span>{protection.enabled ? 'On' : 'Paused'}</span>
              </p>
              <dl>
                <div>
                  <dt>Advertising</dt>
                  <dd>{protection.blockedAds}</dd>
                </div>
                <div>
                  <dt>Tracking</dt>
                  <dd>{protection.blockedTrackers}</dd>
                </div>
              </dl>
              <fieldset className="shield-categories">
                <legend>Protection settings</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={protection.adsEnabled}
                    onChange={(event) =>
                      void window.intoponet.browserHost.setProtectionCategories({
                        ads: event.target.checked,
                        trackers: protection.trackersEnabled,
                      })
                    }
                  />
                  Block advertising
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={protection.trackersEnabled}
                    onChange={(event) =>
                      void window.intoponet.browserHost.setProtectionCategories({
                        ads: protection.adsEnabled,
                        trackers: event.target.checked,
                      })
                    }
                  />
                  Block tracking
                </label>
              </fieldset>
              <button
                type="button"
                className="shield-toggle"
                onClick={() => setSiteProtection(!protection.enabled)}
              >
                {protection.enabled ? 'Pause protection, then retry' : 'Resume protection'}
              </button>
            </div>
          )}
          <div ref={panelBody} className="browser-body" />
        </section>
      )}

      <div className="command-dock">
        {tabs.length > 0 && (
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
            <div className="page-tabs" ref={tabStrip} role="tablist" aria-label="Open screens">
              {tabs.map((tab) => {
                const caption = tabCaption(tab)
                return (
                  <div key={tab.id} className={`page-tab${tab.active ? ' selected' : ''}`}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab.active}
                      title={tab.title || originLabel(tab.url)}
                      onClick={() => void window.intoponet.browserHost.activateTab(tab.id)}
                    >
                      {tab.favicon ? (
                        <img src={tab.favicon} alt="" width={14} height={14} />
                      ) : (
                        <Globe2 size={12} />
                      )}
                      <span>{caption}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Close ${tab.title || originLabel(tab.url)}`}
                      onClick={() => void window.intoponet.browserHost.closeTab(tab.id)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
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
          <label className="command-input">
            <span className="sr-only">Search, explore a topic, or enter a web address</span>
            <input
              ref={input}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search, explore a topic, or enter a web address"
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
