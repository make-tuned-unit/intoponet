import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Color,
  DataTexture,
  FloatType,
  FrontSide,
  LinearFilter,
  MeshPhysicalMaterial,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  ClampToEdgeWrapping,
  type WebGLRenderer,
} from 'three'
import { buildInterestTextureData, INTEREST_FIELD_LIMITS, type InterestSignal } from '../interestField'
import type { StoryTerrain } from '../globe/storyTerrain'
import { useInvalidateOnRender } from './frameDemand'
import { ORGANIC_SHADER_CACHE_KEY, patchOrganicShader, type OrganicShaderUniforms } from './organicShader'

export type OrganicMembraneSettings = {
  macro: number
  meso: number
  micro: number
  material: 'clay' | 'silk' | 'glass'
  paused: boolean
  quality: 'auto' | 'high' | 'low'
  /** Contour self-luminance, 0–1.5. 0 is the no-glow geometry proof. Default 1. */
  lineGlow?: number | undefined
}

export const DEFAULT_ORGANIC_MEMBRANE_SETTINGS: OrganicMembraneSettings = {
  macro: 1,
  meso: 1,
  micro: 1,
  material: 'clay',
  paused: false,
  quality: 'auto',
}

export type OrganicMembraneMetrics = {
  fps: number
  frameMs: number
  drawCalls: number
  triangles: number
  gpuTimeMs: number | null
  gpuTiming: 'supported' | 'unavailable'
}

export type OrganicMembraneProps = {
  signals: InterestSignal[]
  /** Story terrain (storyTerrain.ts). When given it is the field, and `signals` is ignored. */
  terrain?: StoryTerrain | null | undefined
  settings: OrganicMembraneSettings
  phaseTimeSeconds?: number | undefined
  onMetrics?: ((metrics: OrganicMembraneMetrics) => void) | undefined
}

type InterestTextureData = ReturnType<typeof buildInterestTextureData>
type SignalKind = 'none' | 'synthetic' | 'public-aggregate' | 'private-local' | 'mixed' | 'story'
type TextureState = {
  from: DataTexture
  to: DataTexture
  fromData: Float32Array
  toData: Float32Array
  width: number
  height: number
  snapshotKey: string
  sourceKind: SignalKind
  transition: number
  transitionStart: number
}
type TimerExtension = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
type TimerState = { active: WebGLQuery | null; pending: WebGLQuery[]; lastMs: number | null }
type RendererRuntime = {
  extension: TimerExtension | null
  timer: TimerState
  lastFrame: number
  qualityStart: number
  lowWindows: number
  highWindows: number
  quality: 'low' | 'auto' | 'high'
  owners: Set<object>
}

export const ORGANIC_SNAPSHOT_TRANSITION_MS = 12_500
/** Story terrain eases to each digest in a few seconds; its own measure (12 h half-life) already smooths it. */
export const STORY_TERRAIN_TRANSITION_MS = 3_000
/** Entrance: relief grows from the flat sphere so contour rings bloom outward from data peaks. */
export const ORGANIC_REVEAL_MS = 5_500

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const smoothstep = (value: number) => value * value * (3 - 2 * value)
const rendererRuntimes = new WeakMap<WebGLRenderer, RendererRuntime>()

function getRendererRuntime(renderer: WebGLRenderer): RendererRuntime {
  let runtime = rendererRuntimes.get(renderer)
  if (!runtime) {
    runtime = {
      extension: timerExtension(renderer),
      timer: { active: null, pending: [], lastMs: null },
      lastFrame: -1,
      qualityStart: performance.now(),
      lowWindows: 0,
      highWindows: 0,
      quality: 'auto',
      owners: new Set(),
    }
    rendererRuntimes.set(renderer, runtime)
  }
  return runtime
}

function disposeRendererRuntime(renderer: WebGLRenderer, runtime: RendererRuntime): void {
  const context = renderer.getContext() as WebGL2RenderingContext
  if (runtime.extension && runtime.timer.active) {
    try { context.endQuery(runtime.extension.TIME_ELAPSED_EXT) } catch { /* context may already be lost */ }
    context.deleteQuery(runtime.timer.active)
  }
  runtime.timer.pending.forEach((query) => context.deleteQuery(query))
  runtime.timer.active = null
  runtime.timer.pending = []
  if (rendererRuntimes.get(renderer) === runtime) rendererRuntimes.delete(renderer)
}

/** One elapsed-time query and one shared quality tier per renderer/frame. */
function advanceRendererRuntime(renderer: WebGLRenderer, runtime: RendererRuntime, now: number): void {
  const frame = renderer.info.render.frame
  if (runtime.lastFrame === frame) return
  runtime.lastFrame = frame
  try { stepGpuTimer(renderer, runtime.extension, runtime.timer) } catch { runtime.timer.lastMs = null }
  if (now - runtime.qualityStart < 2_000) return
  const gpuMs = runtime.timer.lastMs
  runtime.lowWindows = gpuMs !== null && gpuMs > 14 ? runtime.lowWindows + 1 : 0
  runtime.highWindows = gpuMs !== null && gpuMs < 9.5 ? runtime.highWindows + 1 : 0
  if (runtime.lowWindows >= 2 && runtime.quality !== 'low') {
    runtime.quality = 'low'
    runtime.lowWindows = 0
    runtime.highWindows = 0
  } else if (runtime.highWindows >= 5 && runtime.quality !== 'high') {
    runtime.quality = 'high'
    runtime.lowWindows = 0
    runtime.highWindows = 0
  } else if (runtime.quality === 'high' && gpuMs !== null && gpuMs > 11.5) {
    runtime.quality = 'auto'
    runtime.highWindows = 0
  }
  runtime.qualityStart = now
}

function createInterestTexture(data: InterestTextureData): DataTexture {
  const texture = new DataTexture(data.data, data.width, data.height, RGBAFormat, FloatType)
  texture.wrapS = RepeatWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.generateMipmaps = false
  texture.colorSpace = NoColorSpace
  texture.unpackAlignment = 1
  texture.needsUpdate = true
  return texture
}

function assignTextureData(texture: DataTexture, data: Float32Array): void {
  texture.image.data = data
  texture.needsUpdate = true
}

function mixSnapshotData(from: Float32Array, to: Float32Array, amount: number): Float32Array {
  const mixed = new Float32Array(to.length)
  const t = clamp(amount, 0, 1)
  for (let index = 0; index < mixed.length; index += 1) {
    mixed[index] = (from[index] ?? 0) * (1 - t) + (to[index] ?? 0) * t
  }
  return mixed
}

function signalKind(signals: InterestSignal[]): SignalKind {
  const kinds = new Set(signals.map((signal) => signal.sourceType))
  if (kinds.size === 0) return 'none'
  if (kinds.size > 1) return 'mixed'
  return [...kinds][0]!
}

function snapshotKey(signals: InterestSignal[]): string {
  return JSON.stringify([...signals]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, lat, lon, intensity, radiusKm, momentum, confidence, timestamp, topicId, sourceType }) =>
      [id, lat, lon, intensity, radiusKm, momentum, confidence, timestamp, topicId, sourceType]))
}

function getMaterialOptions(kind: OrganicMembraneSettings['material']): ConstructorParameters<typeof MeshPhysicalMaterial>[0] {
  if (kind === 'silk') return {
    color: new Color('#74b8ac'),
    roughness: 0.34,
    metalness: 0.03,
    clearcoat: 0.32,
    clearcoatRoughness: 0.28,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    side: FrontSide,
  }
  if (kind === 'glass') return {
    color: new Color('#07131e'),
    roughness: 0.22,
    metalness: 0.08,
    // A thin translucent PBR surface keeps the underlying Earth legible and
    // avoids the high-cost refractive transmission pass at globe scale.
    transmission: 0,
    thickness: 0,
    ior: 1.45,
    specularIntensity: 1,
    specularColor: new Color('#d7dde2'),
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: FrontSide,
  }
  // Opaque neutral clay is the geometry QA material; it contains no emission.
  return {
    color: new Color('#c8c4ba'),
    roughness: 0.86,
    metalness: 0,
    clearcoat: 0,
    transparent: false,
    depthWrite: true,
    side: FrontSide,
  }
}

function geometrySegments(quality: OrganicMembraneSettings['quality']): [number, number] {
  if (quality === 'high') return [384, 192]
  if (quality === 'low') return [192, 128]
  return [256, 160]
}

function timerExtension(renderer: WebGLRenderer): TimerExtension | null {
  if (!renderer.capabilities.isWebGL2) return null
  return renderer.getContext().getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null
}

function stepGpuTimer(renderer: WebGLRenderer, extension: TimerExtension | null, state: TimerState): void {
  if (!extension) return
  const context = renderer.getContext() as WebGL2RenderingContext
  if (state.active) {
    context.endQuery(extension.TIME_ELAPSED_EXT)
    state.pending.push(state.active)
    state.active = null
  }
  for (let index = state.pending.length - 1; index >= 0; index -= 1) {
    const query = state.pending[index]!
    if (!context.getQueryParameter(query, context.QUERY_RESULT_AVAILABLE)) continue
    if (!context.getParameter(extension.GPU_DISJOINT_EXT)) {
      state.lastMs = (context.getQueryParameter(query, context.QUERY_RESULT) as number) / 1_000_000
    }
    context.deleteQuery(query)
    state.pending.splice(index, 1)
  }
  const next = context.createQuery()
  if (next) {
    context.beginQuery(extension.TIME_ELAPSED_EXT, next)
    state.active = next
  }
}

export function OrganicMembrane({ signals, terrain, settings, phaseTimeSeconds, onMetrics }: OrganicMembraneProps) {
  if (!terrain && signalKind(signals) === 'mixed') {
    throw new Error('OrganicMembrane accepts one signal source type per snapshot.')
  }
  const { gl, camera } = useThree()
  const materialRef = useRef<MeshPhysicalMaterial | null>(null)
  const ownedMaterials = useRef(new Set<MeshPhysicalMaterial>())
  const transitionRef = useRef(1)
  const phaseClockRef = useRef(phaseTimeSeconds ?? 0)
  const lifecycleGeneration = useRef(0)
  const metricsState = useRef({ start: performance.now(), lastFrame: 0, frameCount: 0, frameMsSum: 0, enabled: false })
  const [autoQuality, setAutoQuality] = useState<'low' | 'auto' | 'high'>('auto')
  const runtime = useMemo(() => getRendererRuntime(gl), [gl])
  const rendererLease = useMemo(() => ({}), [])

  const key = useMemo(() => (terrain ? `story:${terrain.key}` : snapshotKey(signals)), [signals, terrain])
  const kind: SignalKind = terrain ? 'story' : signalKind(signals)
  const transitionMs = kind === 'story' ? STORY_TERRAIN_TRANSITION_MS : ORGANIC_SNAPSHOT_TRANSITION_MS
  // Never let an oversized input take the globe down: keep the strongest that fit the budget.
  const targetData = useMemo(() => {
    if (terrain && terrain.width === 512 && terrain.height === 256) return { data: terrain.data, width: terrain.width, height: terrain.height, pixelWidthKm: 78, undersampledSignalIds: [] }
    const budget = Math.floor(INTEREST_FIELD_LIMITS.rasterWork / (512 * 256))
    const fitted = signals.length > budget ? [...signals].sort((a, b) => b.intensity - a.intensity).slice(0, budget) : signals
    return buildInterestTextureData(fitted, 512, 256)
  }, [key])
  const currentResources = useMemo(() => {
    const fromData = targetData.data.slice()
    const toData = targetData.data.slice()
    return {
      from: createInterestTexture({ ...targetData, data: fromData }),
      to: createInterestTexture({ ...targetData, data: toData }),
      fromData,
      toData,
      width: targetData.width,
      height: targetData.height,
      snapshotKey: key,
      sourceKind: kind,
      transition: 1,
      transitionStart: 0,
    } satisfies TextureState
  }, [])
  const resources = useRef<TextureState>(currentResources)
  const uniforms = useMemo<OrganicShaderUniforms>(() => ({
    uInterestFrom: { value: currentResources.from },
    uInterestTo: { value: currentResources.to },
    uInterestTransition: { value: 1 },
    uOrganicTime: { value: 0 },
    uVisualExaggeration: { value: 1 },
    uMacroAmount: { value: clamp(settings.macro, 0, 2) },
    uMesoAmount: { value: clamp(settings.meso, 0, 2) },
    uMicroAmount: { value: clamp(settings.micro, 0, 2) },
    uOrganicGlass: { value: settings.material === 'glass' ? 1 : 0 },
    uOrganicReveal: { value: 1 },
    uOrganicWarp: { value: 1 },
    uOrganicLineGlow: { value: clamp(settings.lineGlow ?? 1, 0, 1.5) },
    uStoryTerrain: { value: kind === 'story' ? 1 : 0 },
  }), [])
  // Reduced motion and fixed-clock captures start fully formed. Otherwise the
  // entrance starts on the first rendered frame (after shader compile and
  // texture upload), not at mount, so it is never spent off-screen.
  const revealStart = useRef<number | null | 'pending'>(settings.paused || phaseTimeSeconds !== undefined ? null : 'pending')

  useLayoutEffect(() => {
    const state = resources.current
    if (state.snapshotKey === key) return
    const now = performance.now()
    const linear = state.transition >= 1
      ? 1
      : clamp((now - state.transitionStart) / transitionMs, 0, 1)
    const visible = mixSnapshotData(state.fromData, state.toData, smoothstep(linear))
    const next = targetData.data.slice()
    const nextKind = kind
    const crossesSourceBoundary = state.sourceKind !== nextKind
    state.fromData = crossesSourceBoundary ? next.slice() : visible
    state.toData = next
    state.sourceKind = nextKind
    state.snapshotKey = key
    state.transitionStart = now
    state.transition = crossesSourceBoundary ? 1 : 0
    assignTextureData(state.from, state.fromData)
    assignTextureData(state.to, state.toData)
    uniforms.uInterestTransition.value = state.transition
    uniforms.uStoryTerrain.value = nextKind === 'story' ? 1 : 0
  }, [key, kind, targetData, uniforms])

  useEffect(() => {
    lifecycleGeneration.current += 1
    return () => {
      const generation = ++lifecycleGeneration.current
      // StrictMode replays effect setup after cleanup; defer disposal until the
      // replay has had a chance to retain the same GPU resources.
      queueMicrotask(() => {
        if (lifecycleGeneration.current !== generation) return
        resources.current.from.dispose()
        resources.current.to.dispose()
        for (const material of ownedMaterials.current) material.dispose()
        ownedMaterials.current.clear()
      })
    }
  }, [])

  useEffect(() => {
    runtime.owners.add(rendererLease)
    return () => {
      runtime.owners.delete(rendererLease)
      // The ownership set prevents StrictMode effect replay from retiring the
      // shared query service while another membrane is still attached.
      queueMicrotask(() => {
        if (runtime.owners.size === 0) disposeRendererRuntime(gl, runtime)
      })
    }
  }, [gl, rendererLease, runtime])

  const material = useMemo(() => {
    const instance = new MeshPhysicalMaterial(getMaterialOptions(settings.material))
    instance.onBeforeCompile = (shader) => patchOrganicShader(shader, uniforms)
    instance.customProgramCacheKey = () => ORGANIC_SHADER_CACHE_KEY
    instanceRefBind(instance)
    ownedMaterials.current.add(instance)
    return instance
  }, [settings.material, uniforms])

  useEffect(() => {
    const owned = material
    return () => {
      // StrictMode replays this effect while the same material remains active.
      // Dispose replaced presets after React has committed the new material.
      queueMicrotask(() => {
        if (materialRef.current === owned) return
        owned.dispose()
        ownedMaterials.current.delete(owned)
      })
    }
  }, [material])

  // Keep the compiled program's uniforms and texture bindings live after R3F
  // reconciliation or hot reload.
  function instanceRefBind(instance: MeshPhysicalMaterial): void {
    materialRef.current = instance
  }

  const effectiveQuality = settings.quality === 'auto' ? autoQuality : settings.quality
  const [widthSegments, heightSegments] = geometrySegments(effectiveQuality)

  useInvalidateOnRender()
  useFrame(({ invalidate }, delta) => {
    const state = resources.current
    const now = performance.now()
    for (const [name, texture] of [['uInterestFrom', state.from], ['uInterestTo', state.to]] as const) {
      uniforms[name].value = texture
    }
    if (phaseTimeSeconds !== undefined) phaseClockRef.current = Math.max(0, phaseTimeSeconds)
    else if (!settings.paused) phaseClockRef.current += Math.min(delta, 0.1)
    uniforms.uOrganicTime.value = phaseClockRef.current
    const linear = state.transition >= 1
      ? 1
      : clamp((now - state.transitionStart) / transitionMs, 0, 1)
    state.transition = smoothstep(linear)
    transitionRef.current = state.transition
    uniforms.uInterestTransition.value = state.transition
    const cameraDistance = camera.position.length()
    const zoom = clamp((cameraDistance - 1.6) / (4.35 - 1.6), 0, 1)
    const easedZoom = smoothstep(zoom)
    uniforms.uVisualExaggeration.value = 0.62 + 0.38 * easedZoom
    // Planet-scale meander only; city views stay close to measured geometry.
    // Story summits stay where they are measured: no meander.
    uniforms.uOrganicWarp.value = state.sourceKind === 'story' ? 0 : 0.3 + 0.7 * easedZoom
    uniforms.uMacroAmount.value = clamp(settings.macro, 0, 2)
    uniforms.uMesoAmount.value = clamp(settings.meso, 0, 2)
    uniforms.uMicroAmount.value = clamp(settings.micro, 0, 2)
    uniforms.uOrganicGlass.value = settings.material === 'glass' ? 1 : 0
    uniforms.uOrganicLineGlow.value = clamp(settings.lineGlow ?? 1, 0, 1.5)
    if (revealStart.current !== null && (settings.paused || phaseTimeSeconds !== undefined)) revealStart.current = null
    if (revealStart.current === 'pending') {
      revealStart.current = now
      uniforms.uOrganicReveal.value = 0
    } else if (revealStart.current === null) uniforms.uOrganicReveal.value = 1
    else {
      const t = clamp((now - revealStart.current) / ORGANIC_REVEAL_MS, 0, 1)
      // Ease-out cubic: rings spawn at the peaks and travel outward, then
      // settle. No overshoot, which would briefly exaggerate observed intensity.
      uniforms.uOrganicReveal.value = 1 - (1 - t) ** 3
      if (t >= 1) revealStart.current = null
    }
    // The entrance and data transitions play at the display's full rate.
    if (state.transition < 1 || revealStart.current !== null) invalidate()

    if (settings.quality === 'auto' || onMetrics) advanceRendererRuntime(gl, runtime, now)
    if (settings.quality === 'auto' && autoQuality !== runtime.quality) setAutoQuality(runtime.quality)
    const stats = metricsState.current
    const metricsEnabled = !!onMetrics
    if (stats.enabled !== metricsEnabled || (stats.lastFrame > 0 && now - stats.lastFrame > 2_000)) {
      stats.start = now
      stats.frameCount = 0
      stats.frameMsSum = 0
    }
    stats.enabled = metricsEnabled
    stats.lastFrame = now
    if (!onMetrics) return
    stats.frameCount += 1
    stats.frameMsSum += delta * 1000
    if (now - stats.start < 750) return
    const elapsed = Math.max(1, now - stats.start)
    onMetrics({
      fps: stats.frameCount / (elapsed / 1000),
      frameMs: stats.frameMsSum / Math.max(1, stats.frameCount),
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      gpuTimeMs: runtime.extension ? runtime.timer.lastMs : null,
      gpuTiming: runtime.extension ? 'supported' : 'unavailable',
    })
    stats.start = now
    stats.frameCount = 0
    stats.frameMsSum = 0
  })

  return (
    <mesh>
      <sphereGeometry args={[1, widthSegments, heightSegments]} />
      <primitive object={material} attach="material" />
    </mesh>
  )
}
