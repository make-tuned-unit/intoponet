import type { ExplorationScale, GeoAnchor, OrbitPose } from './exploration'
import type { FrequencyBand } from '@intoponet/frequency-field'
import type { MembraneDiagnostics } from './earth/FrequencyMembrane'
import type { OrganicMembraneMetrics, OrganicMembraneSettings } from './earth/OrganicMembrane'
import type { InterestSignal } from './interestField'
import { useEffect, useState } from 'react'
import { EarthScene } from './earth/EarthScene'

export function FrequencyField({
  paused = false,
  panelOpen = false,
  scale = 'earth',
  anchor = null,
  pose,
  bands,
  signals,
  mapPins,
  onPinSelect,
  membraneSettings,
  onDistanceChange,
  onPoseChange,
  onDiagnostics,
  onOrganicMetrics,
}: {
  paused?: boolean
  panelOpen?: boolean
  scale?: ExplorationScale
  topic?: string
  anchor?: GeoAnchor | null
  pose?: OrbitPose | undefined
  bands?: FrequencyBand[] | undefined
  signals?: InterestSignal[] | undefined
  mapPins?: { url: string; title: string; fieldAnchor?: { lat: number; lon: number; label: string } }[] | undefined
  onPinSelect?: ((url: string) => void) | undefined
  membraneSettings?: OrganicMembraneSettings | undefined
  onDistanceChange?: ((radius: number) => void) | undefined
  onPoseChange?: ((pose: OrbitPose) => void) | undefined
  onDiagnostics?: ((diagnostics: MembraneDiagnostics) => void) | undefined
  onOrganicMetrics?: ((metrics: OrganicMembraneMetrics) => void) | undefined
}) {
  const [pageHidden, setPageHidden] = useState(
    () => typeof document !== 'undefined' && document.hidden,
  )
  useEffect(() => {
    const onVisibility = (): void => setPageHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  return (
    <EarthScene
      paused={paused || pageHidden}
      panelOpen={panelOpen}
      scale={scale}
      anchor={anchor}
      pose={pose}
      bands={bands}
      signals={signals}
      mapPins={mapPins}
      onPinSelect={onPinSelect}
      membraneSettings={membraneSettings}
      onDistanceChange={onDistanceChange}
      onPoseChange={onPoseChange}
      onDiagnostics={onDiagnostics}
      onOrganicMetrics={onOrganicMetrics}
    />
  )
}
