import type { FrequencyBand } from '@intoponet/frequency-field'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { Suspense, useRef } from 'react'
import { Color, type MeshStandardMaterial, SRGBColorSpace, TextureLoader } from 'three'
import earthDay from '../../assets/earth-day.jpg' // NASA Blue Marble, public domain
import {
  scaleDisplacement,
  scaleDistance,
  type ExplorationScale,
  type GeoAnchor,
  type OrbitPose,
} from '../exploration'
import { FrequencyMembrane, type MembraneDiagnostics } from './FrequencyMembrane'
import { DEFAULT_ORGANIC_MEMBRANE_SETTINGS, OrganicMembrane } from './OrganicMembrane'
import type { OrganicMembraneMetrics, OrganicMembraneSettings } from './OrganicMembrane'
import type { InterestSignal } from '../interestField'
import { OrbitRig } from './OrbitRig'
import { FrequencyLighting } from './FrequencyLighting'
import { Atmosphere } from './Atmosphere'
import { GlobeMarkers, type GlobeMarker, type GlobeProjection } from '../globe/GlobeMarkers'

const EARTH_TINT = new Color('#74838a')
const EARTH_FADE_MS = 1_400

function EarthSphere({ reducedMotion }: { reducedMotion: boolean }) {
  const texture = useLoader(TextureLoader, earthDay)
  texture.colorSpace = SRGBColorSpace
  const material = useRef<MeshStandardMaterial>(null)
  const shownAt = useRef<number | null>(null)
  // Fade the substrate up from black once its texture is ready, so it
  // arrives under the membrane rather than popping in.
  useFrame(() => {
    if (!material.current) return
    if (reducedMotion) { material.current.color.copy(EARTH_TINT); return }
    shownAt.current ??= performance.now()
    const t = Math.min(1, (performance.now() - shownAt.current) / EARTH_FADE_MS)
    material.current.color.copy(EARTH_TINT).multiplyScalar(t * t * (3 - 2 * t))
  })
  return (
    <mesh>
      <sphereGeometry args={[1, 96, 64]} />
      <meshStandardMaterial
        ref={material}
        map={texture}
        color={reducedMotion ? EARTH_TINT : new Color(0, 0, 0)}
        roughness={0.96}
        metalness={0.04}
      />
    </mesh>
  )
}

export function EarthScene({
  paused = false,
  phasePaused,
  phaseTimeSeconds,
  onDiagnostics,
  panelOpen = false,
  scale = 'earth',
  pose,
  anchor,
  bands,
  signals,
  markers,
  selectedMarkerId = null,
  hoveredMarkerId = null,
  projection,
  onMarkerHover,
  onMarkerSelect,
  markerEmphasis = null,
  membraneSettings,
  onDistanceChange,
  onPoseChange,
  onOrganicMetrics,
}: {
  paused?: boolean
  /** Freeze membrane material phase while leaving camera interaction/rendering active. */
  phasePaused?: boolean | undefined
  phaseTimeSeconds?: number | undefined
  onDiagnostics?: ((diagnostics: MembraneDiagnostics) => void) | undefined
  panelOpen?: boolean
  scale?: ExplorationScale
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
  onOrganicMetrics?: ((metrics: OrganicMembraneMetrics) => void) | undefined
}) {
  const aimed = {
    theta: pose?.theta ?? 0.35,
    phi: pose?.phi ?? 1.28,
  }

  return (
    <Canvas
      className="frequency-canvas"
      camera={{ position: [0, 0.45, scaleDistance.earth], fov: 38 }}
      dpr={[1, 1.5]}
      frameloop="always"
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: false }}
    >
      <color attach="background" args={['#07111b']} />
      <FrequencyLighting profile={signals === undefined ? 'legacy' : 'physical'} />
      <OrbitRig
        distance={pose?.radius ?? scaleDistance[scale]}
        theta={aimed.theta}
        phi={aimed.phi}
        enabled
        reducedMotion={paused}
        onDistanceChange={onDistanceChange}
        onPoseChange={onPoseChange}
      />
      <Suspense fallback={null}>
        <EarthSphere reducedMotion={paused} />
      </Suspense>
      <Atmosphere dimmed={panelOpen} />
      {projection && markers && (
        <GlobeMarkers
          markers={panelOpen ? [] : markers}
          selectedId={selectedMarkerId}
          hoveredId={hoveredMarkerId}
          projection={projection}
          interactive={!panelOpen}
          onHover={(id) => onMarkerHover?.(id)}
          onSelect={(id) => onMarkerSelect?.(id)}
          emphasis={markerEmphasis}
        />
      )}
      {signals === undefined ? (
        <FrequencyMembrane
          paused={phasePaused ?? paused}
          dimmed={panelOpen}
          dMax={scaleDisplacement[scale]}
          bands={bands}
          scale={scale}
          anchor={anchor}
          phaseTimeSeconds={phaseTimeSeconds}
          onDiagnostics={onDiagnostics}
        />
      ) : (
        <OrganicMembrane
          signals={signals}
          settings={{ ...(membraneSettings ?? DEFAULT_ORGANIC_MEMBRANE_SETTINGS), paused: phasePaused ?? paused }}
          phaseTimeSeconds={phaseTimeSeconds}
          onMetrics={onOrganicMetrics}
        />
      )}
    </Canvas>
  )
}
