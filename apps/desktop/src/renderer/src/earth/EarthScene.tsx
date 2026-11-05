import type { FrequencyBand } from '@intoponet/frequency-field'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Color, ImageBitmapLoader, type MeshStandardMaterial, SRGBColorSpace, Texture, Vector3 } from 'three'
import earthDay from '../../assets/earth-day.jpg' // NASA Blue Marble, public domain
import earthNight from '../../assets/earth-night.jpg' // NASA Black Marble 2016, public domain
import { sunDirection } from './sun'
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
import { CountryProjector, type CountryView } from '../globe/CountryNames'
import { AMBIENT_FPS, useAmbientFrames, useInvalidateOnRender } from './frameDemand'

const EARTH_TINT = new Color('#74838a')
const EARTH_FADE_MS = 1_400
const SUN_REFRESH_MS = 30_000

/**
 * Day and night (real time): the day side is lit by the actual sun, the night
 * side shows NASA's Black Marble city lights, and a faint warm band marks
 * twilight. Injected after the standard material's lighting, so turning it off
 * restores the studio-lit globe exactly.
 */
const DAY_NIGHT_GLSL = /* glsl */ `
  {
    vec3 n = normalize(normal);
    float ndl = dot(n, uSunView);
    float dayAmount = smoothstep(-0.08, 0.08, ndl);
    // The day side in Blue Marble's natural colour (not the studio tint), lit by the sun.
    vec3 photo = texture2D(map, vMapUv).rgb * uFade;
    vec3 sunColor = vec3(1.0, 0.97, 0.92);
    float lambert = max(ndl, 0.0);
    vec3 sunlit = photo * sunColor * (0.22 + 1.05 * pow(lambert, 0.6));
    // A soft sheen on open water toward the sun.
    vec3 viewDir = normalize(vViewPosition);
    float water = smoothstep(0.03, 0.0, photo.r - photo.b * 0.7) * smoothstep(0.2, 0.04, dot(photo, vec3(0.33)));
    float mirror = max(dot(reflect(-uSunView, n), viewDir), 0.0) * step(0.0, ndl);
    // Daylit sea reads blue, as in a photo, with a gentle sheen toward the sun.
    sunlit += water * vec3(0.014, 0.05, 0.15) * pow(lambert, 0.6);
    sunlit += sunColor * water * pow(mirror, 16.0) * 0.07;
    // Night: the land faintly, under city lights.
    vec3 lights = texture2D(uNightMap, vMapUv).rgb;
    vec3 night = photo * vec3(0.05, 0.06, 0.09) + vec3(0.002, 0.005, 0.014) + lights * vec3(1.0, 0.82, 0.58) * 0.95 * uFade;
    float twilight = exp(-pow(ndl / 0.05, 2.0));
    vec3 lit = mix(night, sunlit, dayAmount) + vec3(1.0, 0.5, 0.25) * 0.04 * twilight * uFade;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, lit, uDayNight);
  }
`

function EarthSphere({ reducedMotion, dayNight, onSun }: { reducedMotion: boolean; dayNight: boolean; onSun?: (direction: [number, number, number]) => void }) {
  // Decoded off the main thread (createImageBitmap) rather than during the first upload, which
  // blocked the UI for ~200 ms. Flipped and left unconverted here exactly as WebGL's unpack
  // settings did for the <img> path (flipY; no colour-space conversion for sRGB textures).
  const bitmaps = useLoader(ImageBitmapLoader, [earthDay, earthNight], (loader) => {
    loader.setOptions({ imageOrientation: 'flipY', colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  })
  const [texture, nightTexture] = useMemo(() => bitmaps.map((bitmap) => {
    const map = new Texture(bitmap)
    map.flipY = false
    map.colorSpace = SRGBColorSpace
    map.needsUpdate = true
    return map
  }), [bitmaps]) as [Texture, Texture]
  useEffect(() => () => { texture.dispose(); nightTexture.dispose() }, [texture, nightTexture])
  const material = useRef<MeshStandardMaterial>(null)
  const shownAt = useRef<number | null>(null)
  const sunWorld = useRef(new Vector3(...sunDirection(new Date())))
  const sunAt = useRef(0)
  const uniforms = useMemo(() => ({
    uNightMap: { value: nightTexture },
    uSunView: { value: new Vector3() },
    uDayNight: { value: dayNight ? 1 : 0 },
    uFade: { value: reducedMotion ? 1 : 0 },
  }), [nightTexture]) // eslint-disable-line react-hooks/exhaustive-deps
  const onBeforeCompile = useMemo(() => (shader: { uniforms: Record<string, unknown>; fragmentShader: string }) => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uNightMap;\nuniform vec3 uSunView;\nuniform float uDayNight;\nuniform float uFade;')
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${DAY_NIGHT_GLSL}`)
  }, [uniforms])
  useInvalidateOnRender()
  // The sun moves on its own; keep the terminator current even when nothing else asks for a frame.
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    if (!dayNight) return
    const timer = window.setInterval(() => invalidate(), SUN_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [dayNight, invalidate])
  // Fade the substrate up from black once its texture is ready, so it
  // arrives under the membrane rather than popping in.
  useFrame(({ camera, invalidate: next }, delta) => {
    const now = performance.now()
    if (now - sunAt.current > SUN_REFRESH_MS) {
      sunAt.current = now
      const direction = sunDirection(new Date())
      sunWorld.current.set(...direction)
      onSun?.(direction)
    }
    uniforms.uSunView.value.copy(sunWorld.current).transformDirection(camera.matrixWorldInverse)
    const target = dayNight ? 1 : 0
    uniforms.uDayNight.value = reducedMotion ? target : uniforms.uDayNight.value + (target - uniforms.uDayNight.value) * Math.min(1, delta * 4)
    if (Math.abs(target - uniforms.uDayNight.value) > 1e-4) next()
    if (!material.current) return
    if (reducedMotion) { material.current.color.copy(EARTH_TINT); uniforms.uFade.value = 1; return }
    shownAt.current ??= now
    const t = Math.min(1, (now - shownAt.current) / EARTH_FADE_MS)
    if (t < 1) next()
    const eased = t * t * (3 - 2 * t)
    material.current.color.copy(EARTH_TINT).multiplyScalar(eased)
    uniforms.uFade.value = eased
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
        onBeforeCompile={onBeforeCompile}
      />
    </mesh>
  )
}

/**
 * Inside the Canvas: a frame for every change from React, and the ambient
 * frames while something on the globe gently animates by itself.
 */
function SceneFrames({ ambientFps }: { ambientFps: number | null }) {
  // A resize clears the canvas: re-render (and so redraw) when the size or pixel ratio changes.
  useThree((state) => state.size)
  useThree((state) => state.viewport.dpr)
  useInvalidateOnRender()
  useAmbientFrames(ambientFps)
  return null
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
  dayNight = false,
  countryView,
  onSurfaceHover,
  onSurfaceClick,
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
  /** Light the globe by the real sun and show night with city lights. */
  dayNight?: boolean
  /** Where each country's name sits on screen (for the name layer). */
  countryView?: CountryView | undefined
  onSurfaceHover?: ((point: { lat: number; lon: number } | null) => boolean) | undefined
  onSurfaceClick?: ((point: { lat: number; lon: number }) => boolean) | undefined
}) {
  const [sun, setSun] = useState<[number, number, number]>(() => sunDirection(new Date()))
  const organic = signals !== undefined
  const phaseRunning = !(phasePaused ?? paused) && phaseTimeSeconds === undefined
  // The membrane shimmers while its phase runs; the selected marker pulses (markers are hidden while a panel is open).
  const pulsing = !panelOpen && selectedMarkerId !== null && !!markers?.some((marker) => marker.id === selectedMarkerId)
  const ambientFps = !organic ? null : pulsing ? AMBIENT_FPS.pulse : phaseRunning ? AMBIENT_FPS.shimmer : null
  const aimed = {
    theta: pose?.theta ?? 0.35,
    phi: pose?.phi ?? 1.28,
  }

  return (
    <Canvas
      className="frequency-canvas"
      camera={{ position: [0, 0.45, scaleDistance.earth], fov: 38 }}
      dpr={[1, 1.5]}
      // The organic globe renders on demand (see frameDemand.ts); the legacy membrane (Field Lab) keeps its continuous loop.
      frameloop={organic ? 'demand' : 'always'}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: false }}
    >
      <color attach="background" args={['#061320']} />
      <SceneFrames ambientFps={ambientFps} />
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
        <EarthSphere reducedMotion={paused} dayNight={dayNight} onSun={setSun} />
      </Suspense>
      <Atmosphere dimmed={panelOpen} sunDirection={dayNight ? sun : null} />
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
          onSurfaceHover={panelOpen ? undefined : onSurfaceHover}
          onSurfaceClick={panelOpen ? undefined : onSurfaceClick}
        />
      )}
      {countryView && <CountryProjector view={countryView} />}
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
