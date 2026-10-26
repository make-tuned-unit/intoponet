import type { FrequencyBand, GeoPoint } from '@intoponet/frequency-field'
import { displacementAt, fieldAt, latLonToOrbit, latLonToUnit, segmentsFromBands } from '@intoponet/frequency-field'
import { useMemo, useState } from 'react'
import { EarthScene } from './EarthScene'
import { scaleDistance } from '../exploration'
import type { OrbitPose } from '../exploration'
import { scaleDisplacement } from '../exploration'
import type { MembraneDiagnostics } from './FrequencyMembrane'
import './fieldLab.css'

type SceneId = 'quiet' | 'single' | 'intensity' | 'reach' | 'overlap' | 'multi' | 'decay' | 'missing' | 'edges' | 'stale'
type Scene = { id: SceneId; label: string; status: string; description: string; bands: FrequencyBand[]; sample: GeoPoint }

const updatedAt = '2026-10-23T19:00:00.000Z'
function band(id: string, centerline: GeoPoint[], amplitude: number, widthKm: number, phase = 0): FrequencyBand {
  return {
    id, centerline, amplitude, widthKm, wavelengthKm: Math.max(100, widthKm * 0.8), phase,
    phaseVelocity: 0.035, phaseModulation: 0.14, confidence: 0.8, topicIds: ['synthetic-demo'],
    updatedAt, sourceType: 'synthetic',
  }
}
const halifax: GeoPoint[] = [{ lat: 44.5, lon: -64.4 }, { lat: 44.8, lon: -62.8 }]
const halifaxRegional: GeoPoint[] = [{ lat: 42.8, lon: -70.5 }, { lat: 44.1, lon: -66.7 }, { lat: 45.5, lon: -62.5 }, { lat: 47.1, lon: -57.8 }]
const halifaxCity: GeoPoint[] = [{ lat: 44.25, lon: -64.25 }, { lat: 44.55, lon: -63.55 }, { lat: 44.95, lon: -62.95 }]

function makeScenes(intensity: number, reachKm: number, scale: 'earth' | 'region' | 'city' | 'topic'): Scene[] {
  const singleLine = scale === 'city' || scale === 'topic' ? halifaxCity : halifaxRegional
  const singleWidth = scale === 'city' || scale === 'topic' ? 42 : 360
  const localAmplitude = 0.78
  return [
    { id: 'quiet', label: 'Quiet Earth', status: 'LOW OBSERVED · SYNTHETIC', description: 'A low but measured synthetic signal remains near-flat.', bands: [band('quiet-low', halifax, 0.045, 420)], sample: { lat: 44.65, lon: -63.6 } },
    { id: 'single', label: 'Single local signal', status: 'OBSERVED · SYNTHETIC', description: scale === 'city' || scale === 'topic' ? 'A synthetic city-scale corridor is bounded around Halifax.' : 'A synthetic regional corridor runs several wavelengths through the Halifax region.', bands: [band('single-halifax', singleLine, localAmplitude, singleWidth)], sample: { lat: 44.65, lon: -63.6 } },
    { id: 'intensity', label: 'Intensity change', status: 'OBSERVED · SYNTHETIC', description: 'Intensity changes while the corridor footprint and center stay fixed.', bands: [band('intensity-halifax', halifax, intensity, 620)], sample: { lat: 44.65, lon: -63.6 } },
    { id: 'reach', label: 'Reach change', status: 'OBSERVED · SYNTHETIC', description: 'Reach widens at fixed intensity; the centerline amplitude remains unchanged.', bands: [band('reach-halifax', halifax, 0.55, reachKm)], sample: { lat: 44.65, lon: -63.6 } },
    { id: 'overlap', label: 'Two overlapping signals', status: 'OBSERVED · SYNTHETIC', description: 'Two related corridor contributions combine through bounded saturation.', bands: [band('overlap-east-west', [{ lat: 43.9, lon: -65.1 }, { lat: 45.2, lon: -61.8 }], 0.7, 750), band('overlap-north-south', [{ lat: 42.8, lon: -63.5 }, { lat: 46.1, lon: -63.5 }], 0.7, 680, 0.8)], sample: { lat: 44.65, lon: -63.5 } },
    { id: 'multi', label: 'Multi-region topic', status: 'OBSERVED · SYNTHETIC', description: 'A topic has separate source-backed synthetic anchors; no ring is drawn between them.', bands: [band('multi-halifax', halifax, 0.58, 460), band('multi-kyoto', [{ lat: 34.7, lon: 135.6 }, { lat: 35.2, lon: 136.3 }], 0.58, 460, 1.2)], sample: { lat: 44.65, lon: -63.6 } },
    { id: 'decay', label: 'Decay', status: 'OBSERVED · SYNTHETIC', description: 'Lower intensity smoothly lowers the same anchored corridor.', bands: [band('decay-halifax', halifax, Math.min(0.8, intensity), 620)], sample: { lat: 44.65, lon: -63.6 } },
    { id: 'missing', label: 'Missing data', status: 'INSUFFICIENT COVERAGE · UNKNOWN', description: 'No qualified signal is available here. This is unknown coverage, not measured low activity.', bands: [], sample: { lat: 44.65, lon: -63.6 } },
    { id: 'edges', label: 'Pole / antimeridian', status: 'OBSERVED · SYNTHETIC', description: 'Spherical corridors cross the date line and approach the pole without invented global stripes.', bands: [band('date-line', [{ lat: 4, lon: 177 }, { lat: 5, lon: -178 }], 0.58, 800), band('polar', [{ lat: 82, lon: -100 }, { lat: 84, lon: 15 }, { lat: 82, lon: 130 }], 0.48, 900, 0.5)], sample: { lat: 0, lon: 180 } },
    { id: 'stale', label: 'Stale feed', status: 'STALE · SYNTHETIC FIXTURE', description: 'The prior observed shape remains visible while freshness is disclosed; no falloff is simulated.', bands: [band('stale-halifax', halifax, 0.5, 620)], sample: { lat: 44.65, lon: -63.6 } },
  ]
}

export function FieldLab() {
  const [sceneId, setSceneId] = useState<SceneId>('single')
  const [intensity, setIntensity] = useState(0.55)
  const [reachKm, setReachKm] = useState(620)
  const [paused, setPaused] = useState(false)
  const [phaseTime, setPhaseTime] = useState(0)
  const [scale, setScale] = useState<'earth' | 'region' | 'city' | 'topic'>('earth')
  const [gpuInspector, setGpuInspector] = useState(false)
  const [gpuDiagnostics, setGpuDiagnostics] = useState<MembraneDiagnostics | null>(null)
  const scenes = useMemo(() => makeScenes(intensity, reachKm, scale), [intensity, reachKm, scale])
  const scene = scenes.find((candidate) => candidate.id === sceneId) ?? scenes[1]!
  const intensityEditable = sceneId === 'intensity' || sceneId === 'decay'
  const reachEditable = sceneId === 'reach'
  const displayedIntensity = intensityEditable ? intensity.toFixed(2) : (scene.bands[0]?.amplitude.toFixed(2) ?? 'n/a')
  const displayedReach = reachEditable ? `${reachKm} km` : (scene.bands[0] ? `${scene.bands[0].widthKm} km (fixture)` : 'no signal')
  const gpuSegments = useMemo(() => segmentsFromBands(scene.bands), [scene.bands])
  const sampleVector = useMemo(() => latLonToUnit(scene.sample.lat, scene.sample.lon), [scene.sample])
  const orientation = useMemo(() => latLonToOrbit(scene.sample.lat, scene.sample.lon), [scene.sample])
  const pose = useMemo<OrbitPose>(() => ({ ...orientation, radius: scaleDistance[scale] }), [orientation, scale])
  const value = fieldAt(sampleVector, gpuSegments, 0)
  const height = displacementAt(sampleVector, gpuSegments, 0, scaleDisplacement[scale])

  return (
    <main className="field-lab">
      <div className="field-lab__scene" aria-label="Interactive synthetic Earth frequency field">
        <EarthScene phasePaused={paused} phaseTimeSeconds={paused ? phaseTime : undefined} scale={scale} pose={pose} anchor={scene.sample} bands={scene.bands} onDiagnostics={gpuInspector ? setGpuDiagnostics : undefined} />
      </div>
      <header className="field-lab__header">
        <p className="field-lab__eyebrow">ENGINEERING HARNESS · NO PUBLIC DATA</p>
        <h1>Frequency field lab</h1>
        <p>Every shape below is a deterministic synthetic fixture, never a report about real people or places.</p>
      </header>
      <section className="field-lab__panel" aria-label="Synthetic field controls">
        <label className="field-lab__control">
          <span>Test scene</span>
          <select value={sceneId} onChange={(event) => setSceneId(event.target.value as SceneId)}>
            {scenes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <div className="field-lab__control">
          <label htmlFor="field-intensity">Intensity {displayedIntensity}{intensityEditable ? '' : ' (fixed)'}</label>
          <input id="field-intensity" type="range" min="0.05" max="1" step="0.01" value={intensity} onChange={(event) => setIntensity(Number(event.target.value))} disabled={!intensityEditable} />
        </div>
        <label className="field-lab__toggle">
          <input type="checkbox" checked={gpuInspector} onChange={(event) => setGpuInspector(event.target.checked)} />
          GPU texture inspector (WebGL readback)
        </label>
        {gpuInspector && <pre className="field-lab__gpu-diagnostics" aria-live="polite">{gpuDiagnostics ? JSON.stringify(gpuDiagnostics, null, 2) : 'Waiting for GPU diagnostics…'}</pre>}
        <div className="field-lab__control">
          <label htmlFor="field-reach">Geographic reach {displayedReach}</label>
          <input id="field-reach" type="range" min="250" max="1800" step="10" value={reachKm} onChange={(event) => setReachKm(Number(event.target.value))} disabled={!reachEditable} />
        </div>
        <fieldset className="field-lab__scales">
          <legend>Scale</legend>
          {(['earth', 'region', 'city', 'topic'] as const).map((item) => (
            <button key={item} type="button" aria-pressed={scale === item} onClick={() => setScale(item)}>{item}</button>
          ))}
        </fieldset>
        <label className="field-lab__toggle">
          <input type="checkbox" checked={paused} onChange={(event) => setPaused(event.target.checked)} />
          Freeze decorative phase (reduced motion)
        </label>
        <div className="field-lab__control">
          <label htmlFor="field-phase-time">Reference phase time {phaseTime.toFixed(1)} s</label>
          <input id="field-phase-time" type="range" min="0" max="120" step="0.5" value={phaseTime} onChange={(event) => setPhaseTime(Number(event.target.value))} />
          <button type="button" onClick={() => setPhaseTime(0)}>Reset phase</button>
        </div>
        <div className="field-lab__status" role="status">
          <strong>{scene.status}</strong>
          <span>{scene.description}</span>
        </div>
        <details className="field-lab__measurements">
          <summary>On-demand measurements</summary>
          <dl>
            <div><dt>Sample location</dt><dd>{scene.sample.lat.toFixed(2)}°, {scene.sample.lon.toFixed(2)}°</dd></div>
            <div><dt>Field envelope</dt><dd>{value.toFixed(4)} (normalized synthetic units)</dd></div>
            <div><dt>Displacement</dt><dd>{height.toFixed(5)} R (scale cap {scaleDisplacement[scale].toFixed(3)} R)</dd></div>
            <div><dt>Measurement phase</dt><dd>Fixed reference t = 0; β = 0.14</dd></div>
            <div><dt>Displayed phase</dt><dd>{paused ? `Frozen at fixed t = ${phaseTime.toFixed(1)} s` : 'Slow restrained oscillation'}</dd></div>
            <div><dt>Signal origin</dt><dd>About-location fixture; not audience location</dd></div>
          </dl>
        </details>
      </section>
      <p className="field-lab__footer">Synthetic QA only · no feeds, profile, private library, browsing history, or telemetry are loaded here.</p>
    </main>
  )
}
