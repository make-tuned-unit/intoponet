import type { ExplorationScale, GeoAnchor, OrbitPose } from './exploration'
import type { FrequencyBand } from '@intoponet/frequency-field'
import type { MembraneDiagnostics } from './earth/FrequencyMembrane'
import type { OrganicMembraneMetrics, OrganicMembraneSettings } from './earth/OrganicMembrane'
import type { InterestSignal } from './interestField'
import { useEffect, useState } from 'react'
import { EarthScene } from './earth/EarthScene'
import type { GlobeMarker, GlobeProjection } from './globe/GlobeMarkers'

export function FrequencyField({
  paused = false,
  panelOpen = false,
  scale = 'earth',
  anchor = null,
  pose,
  bands,
  signals,
  markers,
  selectedMarkerId,
  hoveredMarkerId,
  projection,
  onMarkerHover,
  onMarkerSelect,
  markerEmphasis,
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
  markers?: GlobeMarker[] | undefined
  selectedMarkerId?: string | null
  hoveredMarkerId?: string | null
  projection?: GlobeProjection | undefined
  onMarkerHover?: ((id: string | null) => void) | undefined
  onMarkerSelect?: ((id: string | null) => void) | undefined
  markerEmphasis?: ReadonlySet<string> | null
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
      markers={markers}
      selectedMarkerId={selectedMarkerId ?? null}
      hoveredMarkerId={hoveredMarkerId ?? null}
      projection={projection}
      onMarkerHover={onMarkerHover}
      onMarkerSelect={onMarkerSelect}
      markerEmphasis={markerEmphasis ?? null}
      membraneSettings={membraneSettings}
      onDistanceChange={onDistanceChange}
      onPoseChange={onPoseChange}
      onDiagnostics={onDiagnostics}
      onOrganicMetrics={onOrganicMetrics}
    />
  )
}
