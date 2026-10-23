import type { FrequencyBand } from '@intoponet/frequency-field'
import { Canvas, useLoader } from '@react-three/fiber'
import { Suspense } from 'react'
import { BackSide, Color, SRGBColorSpace, TextureLoader } from 'three'
import earthDay from '../../assets/earth-day.jpg' // NASA Blue Marble, public domain
import {
  scaleDisplacement,
  scaleDistance,
  type ExplorationScale,
  type GeoAnchor,
  type OrbitPose,
} from '../exploration'
import { FrequencyMembrane } from './FrequencyMembrane'
import { OrbitRig } from './OrbitRig'

function EarthSphere() {
  const texture = useLoader(TextureLoader, earthDay)
  texture.colorSpace = SRGBColorSpace
  return (
    <mesh>
      <sphereGeometry args={[1, 96, 64]} />
      <meshStandardMaterial
        map={texture}
        color={new Color('#8b9aa3')}
        roughness={0.92}
        metalness={0.04}
        emissive={new Color('#07111b')}
        emissiveIntensity={0.18}
      />
    </mesh>
  )
}

function Atmosphere() {
  return (
    <mesh scale={1.045}>
      <sphereGeometry args={[1, 64, 48]} />
      <meshBasicMaterial
        color="#6aaeb8"
        transparent
        opacity={0.07}
        side={BackSide}
        depthWrite={false}
      />
    </mesh>
  )
}

export function EarthScene({
  paused = false,
  panelOpen = false,
  scale = 'earth',
  pose,
  bands,
  onDistanceChange,
  onPoseChange,
}: {
  paused?: boolean
  panelOpen?: boolean
  scale?: ExplorationScale
  anchor?: GeoAnchor | null
  pose?: OrbitPose | undefined
  bands?: FrequencyBand[] | undefined
  onDistanceChange?: ((radius: number) => void) | undefined
  onPoseChange?: ((pose: OrbitPose) => void) | undefined
}) {
  const aimed = {
    theta: pose?.theta ?? 0.35,
    phi: pose?.phi ?? 1.28,
  }

  return (
    <Canvas
      className="frequency-canvas"
      camera={{ position: [0, 0.45, 3.52], fov: 38 }}
      dpr={[1, 1.75]}
      frameloop={paused ? 'demand' : 'always'}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: false }}
    >
      <color attach="background" args={['#07111b']} />
      <ambientLight intensity={0.22} />
      <directionalLight position={[4.2, 1.8, 2.4]} intensity={1.55} color="#f2efe6" />
      <directionalLight position={[-3, -0.8, -2]} intensity={0.18} color="#a69be8" />
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
        <EarthSphere />
      </Suspense>
      <Atmosphere />
      <FrequencyMembrane
        paused={paused}
        dimmed={panelOpen}
        dMax={scaleDisplacement[scale]}
        bands={bands}
        scale={scale}
      />
    </Canvas>
  )
}
