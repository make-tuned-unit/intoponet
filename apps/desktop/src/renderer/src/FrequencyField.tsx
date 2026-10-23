import type { ExplorationScale, GeoAnchor, OrbitPose } from './exploration'
import type { FrequencyBand } from '@intoponet/frequency-field'
import { useEffect, useState } from 'react'
import { EarthScene } from './earth/EarthScene'

export function FrequencyField({
  paused = false,
  panelOpen = false,
  scale = 'earth',
  anchor = null,
  pose,
  bands,
  onDistanceChange,
  onPoseChange,
}: {
  paused?: boolean
  panelOpen?: boolean
  scale?: ExplorationScale
  topic?: string
  anchor?: GeoAnchor | null
  pose?: OrbitPose | undefined
  bands?: FrequencyBand[] | undefined
  onDistanceChange?: ((radius: number) => void) | undefined
  onPoseChange?: ((pose: OrbitPose) => void) | undefined
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
      onDistanceChange={onDistanceChange}
      onPoseChange={onPoseChange}
    />
  )
}
