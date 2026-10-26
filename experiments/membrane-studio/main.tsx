/*
 * Membrane Studio: renders the production EarthScene + OrganicMembrane with
 * URL-controlled camera, phase clock and fixture so visual changes can be
 * captured deterministically. Synthetic fixtures only; never public data.
 *
 * Params: theta, phi, radius, t (fixed phase seconds; omit for live clock),
 * fixture=preview|lab|single|quiet, material=glass|clay|silk, reduce=1
 */
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { EarthScene } from '../../apps/desktop/src/renderer/src/earth/EarthScene'
import {
  syntheticInterestSignals,
  syntheticPreviewInterestSignals,
  type InterestSignal,
} from '../../apps/desktop/src/renderer/src/interestField'
import type { OrganicMembraneMetrics, OrganicMembraneSettings } from '../../apps/desktop/src/renderer/src/earth/OrganicMembrane'

const params = new URLSearchParams(location.search)
const num = (key: string, fallback: number) => {
  const value = Number(params.get(key))
  return params.has(key) && Number.isFinite(value) ? value : fallback
}

function fixture(): InterestSignal[] {
  const name = params.get('fixture') ?? 'preview'
  if (name === 'quiet') return []
  if (name === 'lab') return syntheticInterestSignals.map((s) => ({ ...s }))
  if (name === 'single') return [{ ...syntheticInterestSignals[2]!, intensity: num('intensity', 0.82), radiusKm: num('radiusKm', 4700) }]
  return syntheticPreviewInterestSignals.map((s) => ({ ...s }))
}

const settings: OrganicMembraneSettings = {
  macro: num('macro', 1),
  meso: num('meso', 1),
  micro: num('micro', 1),
  material: (params.get('material') as OrganicMembraneSettings['material']) ?? 'glass',
  paused: false,
  lineGlow: num('glow', 1),
  quality: (params.get('quality') as OrganicMembraneSettings['quality']) ?? 'high',
}

function Studio() {
  const [signals, setSignals] = useState(fixture)
  const [fixed, setFixed] = useState(params.has('t') ? num('t', 0) : undefined)
  // Capture hooks: step the phase clock or swap the synthetic snapshot.
  Object.assign(window, {
    __setT: (t: number | undefined) => setFixed(t),
    __setSignals: (next: InterestSignal[]) => setSignals(next),
    __fixtures: { lab: syntheticInterestSignals, preview: syntheticPreviewInterestSignals },
  })
  const onMetrics = (m: OrganicMembraneMetrics) => {
    const hud = document.getElementById('hud')
    if (hud) hud.textContent = `${m.fps.toFixed(0)} fps · ${m.frameMs.toFixed(1)} ms · gpu ${m.gpuTimeMs?.toFixed(2) ?? 'n/a'} ms · ${m.triangles} tris`
    ;(window as unknown as { __metrics: OrganicMembraneMetrics }).__metrics = m
  }
  return (
    <EarthScene
      paused={params.get('reduce') === '1'}
      phasePaused={false}
      phaseTimeSeconds={fixed}
      pose={{ theta: num('theta', 0.35), phi: num('phi', 1.28), radius: num('radius', 4.35) }}
      signals={signals}
      membraneSettings={settings}
      onOrganicMetrics={params.get('hud') === '0' ? undefined : onMetrics}
    />
  )
}

createRoot(document.getElementById('root')!).render(<Studio />)
