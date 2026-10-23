import type {
  BrowserPanelSnapshot,
  FindInPageResult,
  NavigationIntent,
  PageTabSnapshot,
  ProtectionSnapshot,
} from '@intoponet/browser-api'
import { inferLauncherIntent } from '@intoponet/browser-api'
import { demoFieldSnapshot, parseFieldSnapshot, snapshotLabel, bandsFromSnapshot } from '@intoponet/field-snapshot'
import type { FieldSnapshot } from '@intoponet/field-snapshot'
import { latLonToOrbit, syntheticTopicGraph } from '@intoponet/frequency-field'
import {
  absorbPage,
  historicalFixtures,
  parsePrivateLibrary,
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
  Compass,
  Copy,
  Expand,
  FolderPlus,
  Globe2,
  LockKeyhole,
  Library,
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
import {
  createCollection,
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

type LauncherMode = NavigationIntent['kind']
type LibraryTab = 'locations' | 'collections' | 'recent' | 'absorbed'

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
  const [mode, setMode] = useState<LauncherMode>('topic')
  const [query, setQuery] = useState('')
  const [panel, setPanel] = useState<BrowserPanelSnapshot>(emptyPanel)
  const [activeTopic, setActiveTopic] = useState(
    () => localStorage.getItem(topicKey) ?? 'Open knowledge',
  )
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
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('locations')
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
  const panelBody = useRef<HTMLDivElement>(null)
  const tabStrip = useRef<HTMLDivElement>(null)
  const [tabEdges, setTabEdges] = useState({ overflow: false, atStart: true, atEnd: true })
  const input = useRef<HTMLInputElement>(null)
  const findInput = useRef<HTMLInputElement>(null)
  const lastSyncedUrl = useRef('')
  const launcherFocused = useRef(false)
  const topicReturnPose = useRef<OrbitPose | null>(null)
  const sealWarned = useRef(false)
  const [reduceMotion, setReduceMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  const fieldBands = useMemo(
    () => (publicSnapshot ? bandsFromSnapshot(publicSnapshot, scale) : undefined),
    [publicSnapshot, scale],
  )
  const fieldNote = publicSnapshot ? snapshotLabel(publicSnapshot) : demoFieldSnapshot().coverageNote
  const isBookmarked = useMemo(
    () => bookmarks.some((bookmark) => bookmark.url === panel.url),
    [bookmarks, panel.url],
  )
  const isSecureOrigin = panel.url.startsWith('https:')
  const inferredKind = useMemo(() => {
    try {
      return query.trim() ? inferLauncherIntent(query, mode).kind : mode
    } catch {
      return mode
    }
  }, [mode, query])

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
    void window.intoponet.browserHost.getTabs().then(setTabs)
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
    if (!panel.url) return
    if (launcherFocused.current) return
    if (!query || query === lastSyncedUrl.current) {
      setQuery(panel.url)
      lastSyncedUrl.current = panel.url
      setMode('url')
    }
  }, [panel.url, query])

  useEffect(() => {
    let cancelled = false
    void window.intoponet.browserHost
      .readPrivateLibrary()
      .then((raw) => {
        if (cancelled) return
        const parsed = raw ? parsePrivateLibrary(raw) : null
        if (parsed) {
          setBookmarks(parsed.bookmarks)
          setCollections(parsed.collections)
          setRecents(parsed.recents)
          setAbsorbed(parsed.absorbed)
          writeBookmarks(parsed.bookmarks)
          writeCollections(parsed.collections)
        }
        setLibraryReady(true)
      })
      .catch(() => {
        if (!cancelled) setLibraryReady(true)
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
      const key = event.key.toLowerCase()
      const meta = event.metaKey || event.ctrlKey
      if (meta && key === 'l') {
        event.preventDefault()
        if (panel.url && !query) {
          setQuery(panel.url)
          lastSyncedUrl.current = panel.url
          setMode('url')
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
          geographicAnchor: defaultAnchor(activeTopic),
          selectedTopicId: activeTopic,
          pose: next,
        })
      }
      if (event.key === 'Escape' && fullWidth) {
        event.preventDefault()
        setFullWidth(false)
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
  }, [activeTopic, findOpen, fullWidth, libraryOpen, panel.canGoBack, panel.canGoForward, panel.isVisible, panel.url, pose, query, scale, shieldOpen, tabs.length])

  const rememberScale = (
    next: ExplorationScale,
    radius = scaleDistance[next],
    topic = activeTopic,
  ): void => {
    if (shouldSnapshotBeforeTopic(scale, next)) {
      topicReturnPose.current = pose
    }
    const restored = restoreAfterTopic(scale, next, topicReturnPose.current)
    const anchor = defaultAnchor(topic)
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
      selectedTopicId: topic,
      pose: nextPose,
    })
  }

  const rememberTopic = (topic: string): void => {
    setActiveTopic(topic)
    localStorage.setItem(topicKey, topic)
    rememberScale('topic', scaleDistance.topic, topic)
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const value = query.trim()
    if (!value) return
    setError('')
    const intent = inferLauncherIntent(value, mode)
    if (intent.kind === 'topic') {
      rememberTopic(intent.value)
      setQuery('')
      lastSyncedUrl.current = ''
      void window.intoponet.browserHost.close()
      return
    }
    lastSyncedUrl.current = intent.kind === 'url' ? intent.value : ''
    void window.intoponet.browserHost.open(intent).catch((reason: unknown) => {
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

  const deleteLibrary = (): void => {
    if (!confirmDelete) {
      setConfirmDelete(true)
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
    void window.intoponet.browserHost.deletePrivateLibrary()
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
    lastSyncedUrl.current = page.url
    setQuery(page.url)
    setMode('url')
    void window.intoponet.browserHost.open({ kind: 'url', value: page.url })
  }

  const openBookmark = (bookmark: SavedBookmark): void => {
    rememberTopic(bookmark.topic)
    setLibraryOpen(false)
    lastSyncedUrl.current = bookmark.url
    setQuery(bookmark.url)
    setMode('url')
    void window.intoponet.browserHost.open({ kind: 'url', value: bookmark.url })
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
    lastSyncedUrl.current = panel.url
    setMode('url')
    input.current?.focus()
    input.current?.select()
  }

  const runFind = (findNext = false, forward = true): void => {
    if (!findQuery.trim()) return
    void window.intoponet.browserHost.find(findQuery, { findNext, forward })
  }

  return (
    <main className={`app-shell${panel.isVisible ? ' page-open' : ''}${fullWidth && panel.isVisible ? ' browser-full' : ''}${tabs.length > 0 ? ' tabs-open' : ''}`}>
      <FrequencyField
        paused={reduceMotion || (fullWidth && panel.isVisible)}
        panelOpen={panel.isVisible}
        scale={scale}
        topic={activeTopic}
        anchor={defaultAnchor(activeTopic)}
        pose={pose}
        bands={fieldBands}
        onDistanceChange={(radius) => {
          const next = scaleFromDistance(radius)
          setPose((current) => ({ ...current, radius }))
          if (next !== scale) rememberScale(next, radius)
        }}
        onPoseChange={(next) => {
          setPose(next)
          writeExplorationState({
            scale,
            geographicAnchor: defaultAnchor(activeTopic),
            selectedTopicId: activeTopic,
            pose: next,
          })
        }}
      />
      <div className="field-wash" aria-hidden="true" />

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
          <button type="button" className="bookmark-library-button" onClick={showLibrary}>
            <Library size={14} />
            Saved
            {bookmarks.length > 0 && <span>{bookmarks.length}</span>}
          </button>
        </div>
      </header>

      <section className="exploration-context" aria-labelledby="field-title">
        <p className="sr-only" role="status">
          {scaleLabel(scale)}. {activeTopic}. Synthetic frequency membrane, not public activity.
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
            onClick={() => rememberTopic(activeTopic)}
          >
            {activeTopic}
          </button>
        </div>
        <h1 id="field-title">{activeTopic}</h1>
        <p>
          A quiet field of relationships. Move through it, or go directly to any
          place on the web.
        </p>
        {scale === 'topic' && (syntheticTopicGraph[activeTopic]?.length ?? 0) > 0 && (
          <div className="related-topics">
            <span>Related · synthetic</span>
            {syntheticTopicGraph[activeTopic]?.map((topic) => (
              <button key={topic} type="button" onClick={() => rememberTopic(topic)}>
                {topic}
              </button>
            ))}
          </div>
        )}
      </section>

      <aside className="coverage-note">
        <span className="coverage-pulse" aria-hidden="true" />
        <div>
          <strong>{publicSnapshot ? 'Public field' : 'Visual prototype'}</strong>
          <span>{fieldNote}</span>
        </div>
      </aside>
      {publicSnapshot && (
        <ul className="field-sources" aria-label="Original sources">
          {publicSnapshot.sources.slice(0, 6).map((source) => (
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
                  ? 'Saved locations'
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
                        <small>Saved from {bookmark.topic}</small>
                      </button>
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

      <section className="accessible-signals" aria-label="Field topics">
        {(['Open knowledge', 'Local archives', 'Civic memory', 'Open research'] as const).map(
          (topic) => (
            <button
              key={topic}
              type="button"
              aria-pressed={activeTopic === topic}
              onClick={() => rememberTopic(topic)}
            >
              <span>{topic}</span>
              <small>Synthetic topic</small>
            </button>
          ),
        )}
      </section>

      {panel.isVisible && (
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
                onClick={() => setFullWidth((current) => !current)}
              >
                {fullWidth ? <Shrink size={15} /> : <Expand size={15} />}
              </button>
              <button
                type="button"
                aria-label="Close screen"
                onClick={() => {
                  closeFind()
                  setFullWidth(false)
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
        <form className="command-launcher" onSubmit={submit}>
          <div className="mode-switcher" aria-label="Command type">
            <button
              type="button"
              className={mode === 'topic' ? 'active' : ''}
              onClick={() => setMode('topic')}
            >
              <Compass size={15} /> Explore
            </button>
            <button
              type="button"
              className={mode === 'search' ? 'active' : ''}
              onClick={() => setMode('search')}
            >
              <Search size={15} /> Search
            </button>
            <button
              type="button"
              className={mode === 'url' ? 'active' : ''}
              onClick={() => setMode('url')}
            >
              <Globe2 size={15} /> URL
            </button>
          </div>
          <label className="command-input">
            <span className="sr-only">
              {mode === 'topic' ? 'Explore a topic' : mode === 'search' ? 'Search the web' : 'Open a URL'}
            </span>
            <input
              ref={input}
              value={query}
              onFocus={() => {
                launcherFocused.current = true
              }}
              onBlur={() => {
                launcherFocused.current = false
              }}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                mode === 'topic'
                  ? 'Explore a subject'
                  : mode === 'search'
                    ? 'Search the web'
                    : 'Enter a web address'
              }
              autoComplete="off"
              spellCheck={mode !== 'url'}
            />
          </label>
          <button className="go-button" type="submit" aria-label="Go">
            <ChevronRight size={18} />
          </button>
        </form>
        <span className="shortcut-hint">
          {inferredKind !== mode ? 'Looks like a web address · ' : ''}
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

      <div className="scale-indicator" aria-hidden="true">
        <span />
        <small>{scaleLabel(scale)}</small>
      </div>
    </main>
  )
}
