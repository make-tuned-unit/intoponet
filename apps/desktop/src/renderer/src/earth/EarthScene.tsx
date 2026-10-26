import { latLonToRender, type FrequencyBand } from '@intoponet/frequency-field'
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
  mapPins,
  onPinSelect,
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
  mapPins?: { url: string; title: string; fieldAnchor?: { lat: number; lon: number; label: string } }[] | undefined
  onPinSelect?: ((url: string) => void) | undefined
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
      {/* Private saved locations are separate from observed interest geometry. */}
      {!panelOpen && mapPins?.filter((pin) => pin.fieldAnchor).map((pin) => {
        const point = latLonToRender(pin.fieldAnchor!.lat, pin.fieldAnchor!.lon)
        return (
          <mesh
            key={pin.url}
            position={[point.x * 1.04, point.y * 1.04, point.z * 1.04]}
            onClick={(event) => { event.stopPropagation(); onPinSelect?.(pin.url) }}
          >
            <sphereGeometry args={[Math.max(0.0015, Math.min(0.014, ((pose?.radius ?? scaleDistance.earth) - 1.04) * 0.004)), 20, 12]} />
            <meshBasicMaterial color="#a99aff" />
          </mesh>
        )
      })}
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
