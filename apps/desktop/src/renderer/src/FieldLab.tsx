import { Canvas, useLoader, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CanvasTexture, SRGBColorSpace, TextureLoader, Vector3 } from 'three'
import earthDayTexture from '../assets/earth-day.jpg'
import { syntheticInterestSignals } from './interestField'
import type { InterestSignal } from './interestField'
import { OrganicMembrane } from './earth/OrganicMembrane'
import type { OrganicMembraneMetrics, OrganicMembraneSettings } from './earth/OrganicMembrane'
import { OrbitRig } from './earth/OrbitRig'
import { FrequencyLighting } from './earth/FrequencyLighting'
import './FieldLab.css'

type LabView = 'geometry' | 'material' | 'earth'
type LabMaterial = OrganicMembraneSettings['material']
type CameraScale = 'earth' | 'region' | 'city'
type FixtureMode = 'full' | 'quiet' | 'single' | 'overlap'

const materials: LabMaterial[] = ['clay', 'silk', 'glass']
const materialNames: Record<LabMaterial, string> = { clay: 'Clay', silk: 'Silk', glass: 'Contours' }
const initialSettings: OrganicMembraneSettings = {
  macro: 1,
  meso: 1,
  micro: 1,
  material: 'glass',
  paused: false,
  quality: 'auto',
}
const cameraDistances: Record<CameraScale, number> = { earth: 4.35, region: 2.65, city: 1.8 }

function EarthBase({ visible }: { visible: boolean }) {
  const texture = useLoader(TextureLoader, earthDayTexture)
  useEffect(() => {
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 4
    texture.needsUpdate = true
  }, [texture])
  if (!visible) return null
  return (
    <mesh>
      <sphereGeometry args={[1, 128, 96]} />
      <meshStandardMaterial map={texture} color="#74838a" roughness={0.96} metalness={0} />
    </mesh>
  )
}

function PhaseSynchronizedMembranes({
  signals,
  settings,
  compare,
  resetEpoch,
  onMetrics,
}: {
  signals: InterestSignal[]
  settings: OrganicMembraneSettings
  compare: boolean
  resetEpoch: number
  onMetrics: (metrics: OrganicMembraneMetrics) => void
}) {
  // All membranes share this Canvas' R3F frame delta. Keying by resetEpoch
  // resets their internal phase clocks together without React state per frame.
  if (!compare) {
    return <OrganicMembrane key={resetEpoch} signals={signals} settings={settings} onMetrics={onMetrics} />
  }
  return <>
    {materials.map((material, index) => (
      <group key={`${resetEpoch}-${material}`} position={new Vector3([-2.1, -0.6, 0.9][index] ?? 0, 0, 0)} scale={0.6}>
        <MaterialTag label={materialNames[material]} />
        <OrganicMembrane
          key={resetEpoch}
          signals={signals}
          settings={{ ...settings, material }}
          {...(index === 1 ? { onMetrics } : {})}
        />
      </group>
    ))}
  </>
}

function FrameProbe({ onCanvas }: { onCanvas: (canvas: HTMLCanvasElement) => void }) {
  const { gl } = useThree()
  useEffect(() => onCanvas(gl.domElement), [gl, onCanvas])
  return null
}

const materialTagTextures = new Map<string, CanvasTexture>()

function materialTagTexture(label: string): CanvasTexture {
  const cached = materialTagTextures.get(label)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 384
  canvas.height = 96
  const context = canvas.getContext('2d')
  if (context) {
    context.fillStyle = 'rgba(6, 19, 32, 0.72)'
    context.beginPath()
    context.roundRect(4, 4, 376, 88, 22)
    context.fill()
    context.fillStyle = '#cbd9d6'
    context.font = '500 38px sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(label, 192, 48)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  materialTagTextures.set(label, texture)
  return texture
}

function MaterialTag({ label }: { label: string }) {
  const texture = useMemo(() => materialTagTexture(label), [label])
  return (
    <sprite position={[0, 1.28, 0]} scale={[0.76, 0.19, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </sprite>
  )
}

function cameraPose(scale: CameraScale): { radius: number; theta: number; phi: number } {
  return { radius: cameraDistances[scale], theta: 0.54, phi: 1.18 }
}

export function FieldLab({ onClose, reducedMotion }: { onClose: () => void; reducedMotion: boolean }) {
  const [view, setView] = useState<LabView>('geometry')
  const [settings, setSettings] = useState(initialSettings)
  const [fixtureMode, setFixtureMode] = useState<FixtureMode>('full')
  const [compare, setCompare] = useState(false)
  const [cameraScale, setCameraScale] = useState<CameraScale>('earth')
  const [cameraRadius, setCameraRadius] = useState(cameraDistances.earth)
  const [signals, setSignals] = useState<InterestSignal[]>(() => syntheticInterestSignals.map((signal) => ({ ...signal })))
  const [selectedId, setSelectedId] = useState(syntheticInterestSignals[0]?.id ?? '')
  const [selectedIntensity, setSelectedIntensity] = useState(syntheticInterestSignals[0]?.intensity ?? 0.6)
  const [selectedRadius, setSelectedRadius] = useState(syntheticInterestSignals[0]?.radiusKm ?? 1000)
  const [phaseEpoch, setPhaseEpoch] = useState(0)
  const [respectReducedMotion, setRespectReducedMotion] = useState(reducedMotion)
  const [metrics, setMetrics] = useState<OrganicMembraneMetrics | null>(null)
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const [recording, setRecording] = useState(false)
  const [captureMessage, setCaptureMessage] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)
  const motionHeld = settings.paused || respectReducedMotion
  const fixtureSignals = useMemo(() => {
    if (fixtureMode === 'quiet') return []
    if (fixtureMode === 'single') return signals.slice(0, 1)
    if (fixtureMode === 'overlap') return signals.slice(0, 2)
    return signals
  }, [fixtureMode, signals])
  const activeSignals = useMemo(() => fixtureSignals.map((signal) => signal.id === selectedId
    ? { ...signal, intensity: selectedIntensity, radiusKm: selectedRadius }
    : signal), [fixtureSignals, selectedId, selectedIntensity, selectedRadius])
  const activeSettings: OrganicMembraneSettings = {
    ...settings,
    paused: motionHeld,
    material: view === 'geometry' ? 'clay' : settings.material,
  }
  const metricsUpdatedAt = useRef(0)
  const currentSignal = fixtureSignals.find((signal) => signal.id === selectedId)
  const comparisonActive = compare && view === 'material'
  const displayCameraRadius = comparisonActive ? Math.max(cameraRadius, 5.7) : cameraRadius
  const displayCameraTheta = comparisonActive ? 0 : cameraPose(cameraScale).theta
  const displayCameraPhi = comparisonActive ? Math.PI / 2 : cameraPose(cameraScale).phi

  useEffect(() => () => {
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
  }, [])

  useEffect(() => setRespectReducedMotion(reducedMotion), [reducedMotion])

  const onMetrics = (next: OrganicMembraneMetrics): void => {
    const now = performance.now()
    if (now - metricsUpdatedAt.current < 300) return
    metricsUpdatedAt.current = now
    setMetrics(next)
  }

  const updateSignal = (id: string): void => {
    const selected = signals.find((signal) => signal.id === id)
    if (!selected) return
    setSelectedId(id)
    setSelectedIntensity(selected.intensity)
    setSelectedRadius(selected.radiusKm)
  }

  const resetSeedAndTime = (): void => {
    const pristine = syntheticInterestSignals.map((signal) => ({ ...signal }))
    setSignals(pristine)
    const first = pristine[0]
    if (first) {
      setSelectedId(first.id)
      setSelectedIntensity(first.intensity)
      setSelectedRadius(first.radiusKm)
    }
    setPhaseEpoch((epoch) => epoch + 1)
    setCaptureMessage('Fixture and phase reset.')
  }

  const setCamera = (next: CameraScale): void => {
    setCameraScale(next)
    setCameraRadius(cameraDistances[next])
  }

  const downloadBlob = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.style.display = 'none'
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const saveScreenshot = (): void => {
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (!blob) {
        setCaptureMessage('PNG capture failed.')
        return
      }
      downloadBlob(blob, `intoponet-organic-lab-${view}.png`)
      setCaptureMessage('PNG saved from the live renderer.')
    }, 'image/png')
  }

  const recordEightSeconds = (): void => {
    if (!canvas || recording) return
    if (typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
      setCaptureMessage('This renderer does not support canvas WebM recording.')
      return
    }
    const stream = canvas.captureStream(30)
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find((candidate) => MediaRecorder.isTypeSupported(candidate))
    const chunks: BlobPart[] = []
    let activeRecorder: MediaRecorder
    try {
      activeRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    } catch {
      stream.getTracks().forEach((track) => track.stop())
      setCaptureMessage('WebM recording could not start.')
      return
    }
    recorder.current = activeRecorder
    activeRecorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data) }
    activeRecorder.onerror = () => {
      setRecording(false)
      setCaptureMessage('WebM recording failed.')
      stream.getTracks().forEach((track) => track.stop())
    }
    activeRecorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop())
      recorder.current = null
      setRecording(false)
      if (!chunks.length) {
        setCaptureMessage('WebM recording produced no frames.')
        return
      }
      downloadBlob(new Blob(chunks, { type: activeRecorder.mimeType || 'video/webm' }), `intoponet-organic-lab-${view}-8s.webm`)
      setCaptureMessage('8 second WebM saved from the live renderer.')
    }
    activeRecorder.start(250)
    setRecording(true)
    setCaptureMessage('Recording live canvas for 8 seconds…')
    window.setTimeout(() => {
      if (activeRecorder.state !== 'inactive') activeRecorder.stop()
    }, 8_000)
  }

  return (
    <section className="organic-lab" aria-label="Frequency material lab">
      <Canvas
        className="organic-lab-canvas"
        camera={{ position: [0, 0, displayCameraRadius], fov: 42, near: 0.1, far: 80 }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }}
        dpr={[1, 1.5]}
      >
        <FrameProbe onCanvas={setCanvas} />
        <FrequencyLighting profile={view === 'geometry' ? 'geometry' : 'physical'} />
        <OrbitRig
          distance={displayCameraRadius}
          theta={displayCameraTheta}
          phi={displayCameraPhi}
          enabled
          reducedMotion={respectReducedMotion}
          onDistanceChange={setCameraRadius}
          onPoseChange={() => undefined}
        />
        <EarthBase visible={view === 'earth'} />
        <PhaseSynchronizedMembranes
          signals={activeSignals}
          settings={activeSettings}
          compare={comparisonActive}
          resetEpoch={phaseEpoch}
          onMetrics={onMetrics}
        />
      </Canvas>


      <div className="organic-lab-toolbar">
        <div className="organic-lab-heading">
          <span className="organic-lab-eyebrow">Development tool · deterministic synthetic fixture</span>
          <h2>Frequency material lab</h2>
        </div>
        <button className="organic-lab-close" type="button" onClick={onClose}>Return to field</button>
      </div>

      <aside className="organic-lab-panel" aria-label="Lab controls">
        <div className="organic-lab-tabs" role="tablist" aria-label="Lab view">
          {(['geometry', 'material', 'earth'] as const).map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={view === tab} className={view === tab ? 'selected' : ''} onClick={() => setView(tab)}>
              {tab === 'earth' ? 'Earth integration' : tab[0]!.toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {view !== 'geometry' && (
          <div className="organic-lab-control">
            <span className="organic-lab-label">Surface material</span>
            <div className="organic-lab-segmented">
              {materials.map((material) => <button key={material} type="button" aria-pressed={settings.material === material} onClick={() => setSettings((current) => ({ ...current, material }))}>{materialNames[material]}</button>)}
            </div>
          </div>
        )}
        {view === 'material' && (
          <>
            <label className="organic-lab-check"><input type="checkbox" checked={compare} onChange={(event) => setCompare(event.currentTarget.checked)} /> Compare clay · silk · contours</label>
            {compare && <p className="organic-lab-compare-key">Left to right: clay · silk · contours. Shared signals, lights and phase.</p>}
            <label className="organic-lab-check"><input type="checkbox" checked={(settings.lineGlow ?? 1) === 0} onChange={(event) => {
              const lineGlow = event.currentTarget.checked ? 0 : 1
              setSettings((current) => ({ ...current, lineGlow }))
            }} /> No-glow proof · contour strokes lit, not self-luminous</label>
          </>
        )}

        <div className="organic-lab-control">
          <span className="organic-lab-label">Geometry signals</span>
          {(['macro', 'meso', 'micro'] as const).map((band) => (
            <label className="organic-lab-range" key={band}>
              <span>{band}<output>{settings[band].toFixed(2)}</output></span>
              <input aria-label={`${band} geometry`} type="range" min="0" max="2" step="0.05" value={settings[band]} onChange={(event) => {
                const value = Number(event.currentTarget.value)
                setSettings((current) => ({ ...current, [band]: value }))
              }} />
            </label>
          ))}
        </div>

        <div className="organic-lab-control">
          <span className="organic-lab-label">Geometry test fixture</span>
          <select value={fixtureMode} onChange={(event) => setFixtureMode(event.currentTarget.value as FixtureMode)} aria-label="Geometry test fixture">
            <option value="full">Full field · 14 signals</option>
            <option value="quiet">Quiet Earth · 0 signals</option>
            <option value="single">Single local signal</option>
            <option value="overlap">Two overlapping signals</option>
          </select>
        </div>

        <div className="organic-lab-control">
          <span className="organic-lab-label">Fixture signal</span>
          <select value={selectedId} onChange={(event) => updateSignal(event.currentTarget.value)} aria-label="Selected synthetic signal" disabled={fixtureSignals.length === 0}>
            {fixtureSignals.map((signal, index) => <option key={signal.id} value={signal.id}>{String(index + 1).padStart(2, '0')} · {signal.topicId} · {signal.id}</option>)}
          </select>
          {currentSignal && <>
            <label className="organic-lab-range"><span>Intensity<output>{selectedIntensity.toFixed(2)}</output></span><input aria-label="Selected signal intensity" type="range" min="0" max="1" step="0.01" value={selectedIntensity} onChange={(event) => setSelectedIntensity(Number(event.currentTarget.value))} /></label>
            <label className="organic-lab-range"><span>Radius · km<output>{Math.round(selectedRadius)}</output></span><input aria-label="Selected signal radius" type="range" min="300" max="6000" step="25" value={selectedRadius} onChange={(event) => setSelectedRadius(Number(event.currentTarget.value))} /></label>
          </>}
        </div>

        <div className="organic-lab-control">
          <span className="organic-lab-label">Camera · same geometry</span>
          <div className="organic-lab-segmented">
            {(['earth', 'region', 'city'] as const).map((scale) => <button key={scale} type="button" aria-pressed={cameraScale === scale} onClick={() => setCamera(scale)}>{scale === 'city' ? 'Close view' : scale[0]!.toUpperCase() + scale.slice(1)}</button>)}
          </div>
        </div>
        <p className="organic-lab-capture-status">Planetary field: 512 × 256 samples. Close view is not city-resolved.</p>

        <label className="organic-lab-check organic-lab-reduced-motion"><input type="checkbox" checked={respectReducedMotion} onChange={(event) => setRespectReducedMotion(event.currentTarget.checked)} /> Respect system reduced motion{reducedMotion ? ' · system preference on' : ''}</label>
        <div className="organic-lab-actions">
          <button type="button" onClick={() => setSettings((current) => ({ ...current, paused: !current.paused }))}>{settings.paused ? 'Resume' : 'Pause'}</button>
          <button type="button" onClick={resetSeedAndTime}>Reset seed / time</button>
        </div>
        <label className="organic-lab-quality">Quality<select value={settings.quality} onChange={(event) => {
          const quality = event.currentTarget.value as OrganicMembraneSettings['quality']
          setSettings((current) => ({ ...current, quality }))
        }}><option value="auto">Auto</option><option value="high">High</option><option value="low">Low</option></select></label>
        <div className="organic-lab-metrics" aria-live="polite">
          <strong>Renderer</strong>
          <span>{metrics ? `${metrics.fps.toFixed(0)} fps · ${metrics.frameMs.toFixed(1)} ms` : 'Measuring…'}</span>
          <span>{metrics ? `${metrics.triangles.toLocaleString()} triangles · ${metrics.drawCalls} draw calls · ${settings.quality} quality` : `${settings.quality} quality`}</span>
          <span>{metrics?.gpuTimeMs != null ? `GPU ${metrics.gpuTimeMs.toFixed(1)} ms` : `GPU timing ${metrics?.gpuTiming ?? 'pending'}`}</span>
          {motionHeld && <span>Phase held while pause or reduced motion is active.</span>}
        </div>
        <div className="organic-lab-export">
          <button type="button" onClick={saveScreenshot} disabled={!canvas}>Save PNG</button>
          <button type="button" onClick={recordEightSeconds} disabled={!canvas || recording}>{recording ? 'Recording…' : 'Record 8 seconds'}</button>
        </div>
        <p className="organic-lab-capture-status" aria-live="polite">{captureMessage || `Fixture signals: ${activeSignals.length}. No public source activity is represented.`}</p>
      </aside>
    </section>
  )
}
