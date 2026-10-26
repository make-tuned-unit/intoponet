import { useFrame, useThree } from '@react-three/fiber'
import { bandsFromSnapshot, demoFieldSnapshot, type FieldScale } from '@intoponet/field-snapshot'
import type { FrequencyBand, FieldTextureBundle } from '@intoponet/frequency-field'
import {
  MEMBRANE_HEIGHT,
  buildFieldTexture,
  buildFieldDetailTile,
  emptyFieldTexture,
  interpolateFieldTextures,
} from '@intoponet/frequency-field'
import { useLayoutEffect, useMemo, useRef, useEffect } from 'react'
import {
  ClampToEdgeWrapping,
  DataTexture,
  FrontSide,
  LinearFilter,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  RepeatWrapping,
  Vector3,
} from 'three'
import type { GeoAnchor } from '../exploration'

export const SNAPSHOT_TRANSITION_MS = 15_000

export type MembraneDiagnostics = {
  frameMs: number
  transition: number
  phaseTime: number
  dMax: number
  textures: Array<{ name: string; version: number; size: string; sampleLatLon: [number, number]; cpuSample: number[]; maxRed: number; pixelsWithCoverage: number; gpuTextureAllocated: boolean; gpuSample: number[] | null; framebufferStatus: string }>
  programLinked: boolean | null
  programLog: string | null
  calls: number
  triangles: number
}

const vertexShader = /* glsl */ `
  uniform sampler2D uFieldFrom;
  uniform sampler2D uFieldTo;
  uniform sampler2D uWaveFrom;
  uniform sampler2D uWaveTo;
  uniform sampler2D uDetailFieldFrom;
  uniform sampler2D uDetailFieldTo;
  uniform sampler2D uDetailWaveFrom;
  uniform sampler2D uDetailWaveTo;
  uniform vec3 uDetailCenterFrom;
  uniform vec3 uDetailEastFrom;
  uniform vec3 uDetailNorthFrom;
  uniform vec3 uDetailCenterTo;
  uniform vec3 uDetailEastTo;
  uniform vec3 uDetailNorthTo;
  uniform float uDetailExtentFrom;
  uniform float uDetailExtentTo;
  uniform float uTransition;
  uniform float uTime;
  uniform float uMaterialPhaseRate;
  uniform float uHeight;
  uniform float uDmax;
  uniform float uDim;

  varying float vIntensity;
  varying float vCoverage;
  varying float vGeographicConfidence;
  varying float vMomentum;
  varying vec3 vNormalView;
  varying vec3 vView;
  varying vec3 vKeyLightView;

  vec2 fieldUv(vec3 n) {
    float lon = atan(-n.z, n.x);
    float lat = asin(clamp(n.y, -1.0, 1.0));
    return vec2(lon / 6.28318530718 + 0.5, lat / 3.14159265359 + 0.5);
  }

  vec3 detailUv(vec3 n, vec3 center, vec3 east, vec3 north, float extent, out float weight) {
    if (extent <= 0.0) { weight = 0.0; return vec3(0.0); }
    float angle = acos(clamp(dot(center, n), -1.0, 1.0));
    if (angle > 2.3) { weight = 0.0; return vec3(-4.0, -4.0, 0.0); }
    float scale = angle < 0.000001 ? 0.0 : angle / max(sin(angle), 0.000001);
    vec3 tangent = (n - center * cos(angle)) * scale;
    vec2 km = vec2(dot(tangent, east), dot(tangent, north)) * 6371.0;
    vec2 uv = km / (2.0 * extent) + 0.5;
    float edge = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
    weight = smoothstep(0.0, 0.08, edge);
    return vec3(uv, weight);
  }

  vec4 withDetail(vec4 globalField, sampler2D detailTexture, vec3 n, vec3 center, vec3 east, vec3 north, float extent) {
    float weight;
    vec3 projection = detailUv(n, center, east, north, extent, weight);
    vec4 detailField = texture2D(detailTexture, projection.xy);
    // Resolution blending follows tile geometry, not evidence confidence.
    // Low coverage must not suppress a valid local activity measurement.
    return mix(globalField, detailField, projection.z);
  }

  // Signed texture channels reserve byte 128 for exact neutral.
  float decodeSigned(float value) {
    float b = value * 255.0;
    return b <= 128.0 ? b / 128.0 - 1.0 : (b - 128.0) / 127.0;
  }

  float encodeSigned(float value) {
    return (128.0 + value * (value <= 0.0 ? 128.0 : 127.0)) / 255.0;
  }

  vec4 fieldAt(vec3 n) {
    vec2 uv = fieldUv(n);
    vec4 fromField = withDetail(texture2D(uFieldFrom, uv), uDetailFieldFrom, n, uDetailCenterFrom, uDetailEastFrom, uDetailNorthFrom, uDetailExtentFrom);
    vec4 toField = withDetail(texture2D(uFieldTo, uv), uDetailFieldTo, n, uDetailCenterTo, uDetailEastTo, uDetailNorthTo, uDetailExtentTo);
    vec4 result = mix(fromField, toField, uTransition);
    result.g = encodeSigned(mix(decodeSigned(fromField.g), decodeSigned(toField.g), uTransition));
    return result;
  }

  vec4 waveAt(vec3 n) {
    vec2 uv = fieldUv(n);
    float weight;
    vec3 projectionFrom = detailUv(n, uDetailCenterFrom, uDetailEastFrom, uDetailNorthFrom, uDetailExtentFrom, weight);
    vec4 fromWave = mix(texture2D(uWaveFrom, uv), texture2D(uDetailWaveFrom, projectionFrom.xy), projectionFrom.z);
    vec3 projectionTo = detailUv(n, uDetailCenterTo, uDetailEastTo, uDetailNorthTo, uDetailExtentTo, weight);
    vec4 toWave = mix(texture2D(uWaveTo, uv), texture2D(uDetailWaveTo, projectionTo.xy), projectionTo.z);
    if (uTransition <= 0.0) return fromWave;
    if (uTransition >= 1.0) return toWave;
    float a = atan(fromWave.g * 2.0 - 1.0, fromWave.r * 2.0 - 1.0);
    float b = atan(toWave.g * 2.0 - 1.0, toWave.r * 2.0 - 1.0);
    float delta = atan(sin(b - a), cos(b - a));
    float phase = a + delta * uTransition;
    return vec4(vec2(cos(phase), sin(phase)) * 0.5 + 0.5,
      encodeSigned(mix(decodeSigned(fromWave.b), decodeSigned(toWave.b), uTransition)),
      mix(fromWave.a, toWave.a, uTransition));
  }

  float reliefAt(vec4 field, vec4 wave) {
    float phaseCos = wave.r * 2.0 - 1.0;
    float phaseSin = wave.g * 2.0 - 1.0;
    float phase = atan(phaseSin, phaseCos) + decodeSigned(wave.b) * 0.25 * uTime * uMaterialPhaseRate;
    float beta = wave.a * 0.20;
    float carrier = cos(phase);
    // Observation intensity sets the stable broad swell. A very small shared
    // breath keeps supported swells from feeling inert; the local texture phase
    // carries the finer traveling ridge without changing its center or extent.
    float macroBreath = 1.0 + 0.015 * sin(uTime * 0.055);
    float momentum = abs(decodeSigned(field.g));
    // Reserve crest headroom instead of flattening the strongest observed
    // swells. Ripple relief remains proportional to the supported baseline.
    float activity = field.r * (0.86 * macroBreath + beta * (0.5 + 0.15 * momentum) * carrier);
    return uDmax * clamp(activity, 0.0, 1.0);
  }

  float reliefAt(vec3 n) {
    return reliefAt(fieldAt(n), waveAt(n));
  }

  void main() {
    vec3 n = normalize(position);
    // Stable tangent frame: the finite-difference axes remain defined at poles.
    vec3 reference = abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 tangent = normalize(cross(reference, n));
    vec3 bitangent = normalize(cross(n, tangent));
    const float stepAngle = 0.01;
    vec3 offsetUPlus = normalize(n + tangent * stepAngle);
    vec3 offsetUMinus = normalize(n - tangent * stepAngle);
    vec3 offsetVPlus = normalize(n + bitangent * stepAngle);
    vec3 offsetVMinus = normalize(n - bitangent * stepAngle);
    vec4 field = fieldAt(n);
    vec4 wave = waveAt(n);
    vec3 p = n * (1.0 + uHeight + reliefAt(field, wave));
    vec3 pu = offsetUPlus * (1.0 + uHeight + reliefAt(offsetUPlus));
    vec3 mu = offsetUMinus * (1.0 + uHeight + reliefAt(offsetUMinus));
    vec3 pv = offsetVPlus * (1.0 + uHeight + reliefAt(offsetVPlus));
    vec3 mv = offsetVMinus * (1.0 + uHeight + reliefAt(offsetVMinus));
    vec3 normalObject = normalize(cross(pu - mu, pv - mv));
    if (dot(normalObject, n) < 0.0) normalObject *= -1.0;
    vNormalView = normalize(normalMatrix * normalObject);
    vIntensity = field.r;
    vCoverage = field.a;
    vGeographicConfidence = field.b;
    vMomentum = decodeSigned(field.g);
    vKeyLightView = normalize(mat3(viewMatrix) * normalize(vec3(4.2, 1.8, 2.4)));
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    vView = -viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uTeal;
  uniform vec3 uViolet;
  uniform float uDim;
  varying float vIntensity;
  varying float vCoverage;
  varying float vGeographicConfidence;
  varying float vMomentum;
  varying vec3 vNormalView;
  varying vec3 vView;
  varying vec3 vKeyLightView;

  void main() {
    // A restrained translucent material lit by the scene's key light. Relief,
    // not emission, carries the field; specular reflection requires both data
    // coverage and a physically oriented surface normal.
    vec3 normal = normalize(vNormalView);
    vec3 viewDirection = normalize(vView);
    vec3 lightDirection = normalize(vKeyLightView);
    vec3 halfDirection = normalize(lightDirection + viewDirection);
    float diffuse = 0.10 + 0.90 * max(dot(normal, lightDirection), 0.0);
    float specular = pow(max(dot(normal, halfDirection), 0.0), 64.0)
      * 1.4 * smoothstep(0.02, 0.55, vCoverage);
    float violetMix = clamp(0.25 + vMomentum * 0.14, 0.08, 0.48);
    vec3 baseColor = mix(uTeal, uViolet, violetMix);
    vec3 color = baseColor * diffuse + vec3(0.88, 0.96, 0.94) * specular;
    float certainty = mix(0.72, 1.0, clamp(vGeographicConfidence, 0.0, 1.0));
    float alpha = (0.035 + 0.72 * vIntensity + 0.07 * vCoverage) * certainty * uDim;
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.78));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

type TexturePair = { bundle: FieldTextureBundle; detailBundle: FieldTextureBundle; field: DataTexture; wave: DataTexture; detailField: DataTexture; detailWave: DataTexture }

function makeDataTexture(data: Uint8Array, width: number, height: number, local = false): DataTexture {
  const texture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType)
  texture.wrapS = local ? ClampToEdgeWrapping : RepeatWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

function makeTexturePair(bundle: FieldTextureBundle, detailBundle: FieldTextureBundle): TexturePair {
  return {
    bundle,
    detailBundle,
    field: makeDataTexture(bundle.field, bundle.width, bundle.height),
    wave: makeDataTexture(bundle.wave, bundle.width, bundle.height),
    detailField: makeDataTexture(detailBundle.field, detailBundle.width, detailBundle.height, true),
    detailWave: makeDataTexture(detailBundle.wave, detailBundle.width, detailBundle.height, true),
  }
}

function disposePair(pair: TexturePair): void {
  pair.field.dispose()
  pair.wave.dispose()
  pair.detailField.dispose()
  pair.detailWave.dispose()
}

function disposeUniquePairs(...pairs: Array<TexturePair | null>): void {
  const unique = new Set(pairs.filter((pair): pair is TexturePair => pair !== null))
  unique.forEach(disposePair)
}

function setDetailUniforms(uniforms: Record<string, { value: any }>, suffix: 'From' | 'To', bundle: FieldTextureBundle): void {
  const center = bundle.manifest.detailCenter ?? { lat: 0, lon: 0 }
  const lat = center.lat * Math.PI / 180
  const lon = center.lon * Math.PI / 180
  uniforms[`uDetailCenter${suffix}`]!.value.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon))
  uniforms[`uDetailEast${suffix}`]!.value.set(-Math.sin(lon), 0, -Math.cos(lon))
  uniforms[`uDetailNorth${suffix}`]!.value.set(-Math.sin(lat) * Math.cos(lon), Math.cos(lat), Math.sin(lat) * Math.sin(lon))
  uniforms[`uDetailExtent${suffix}`]!.value = bundle.manifest.bandIds.length > 0 ? (bundle.manifest.detailHalfExtentKm ?? 0) : 0
}

export function FrequencyMembrane({
  paused,
  dimmed,
  dMax = 0.18,
  bands,
  scale = 'earth',
  anchor,
  phaseTimeSeconds,
  onDiagnostics,
}: {
  /** Phase-only freeze. Snapshot transitions continue under reduced motion. */
  paused: boolean
  dimmed: boolean
  dMax?: number
  bands?: FrequencyBand[] | undefined
  scale?: FieldScale
  anchor?: GeoAnchor | null | undefined
  /** Fixed phase clock for deterministic engineering captures. */
  phaseTimeSeconds?: number | undefined
  onDiagnostics?: ((diagnostics: MembraneDiagnostics) => void) | undefined
}) {
  const { gl } = useThree()
  const material = useRef<ShaderMaterial>(null)
  const phaseClock = useRef(0)
  const initialized = useRef(false)
  const transitionStart = useRef(0)
  const transitionValue = useRef(1)
  const fromPair = useRef<TexturePair | null>(null)
  const toPair = useRef<TexturePair | null>(null)
  const lifecycleGeneration = useRef(0)
  const lastDiagnosticsAt = useRef(0)
  const frameMs = useRef(16.7)
  const activeBands = useMemo(
    () => bands ?? bandsFromSnapshot(demoFieldSnapshot(), scale),
    [bands, scale],
  )
  const fieldBundle = useMemo(() => buildFieldTexture(activeBands, scale), [activeBands, scale])
  const detailBundle = useMemo(() => anchor
    ? buildFieldDetailTile(activeBands, anchor, scale)
    : buildFieldDetailTile([], { lat: 0, lon: 0 }, scale), [activeBands, anchor, scale])
  const emptyBundle = useMemo(() => emptyFieldTexture(scale), [scale])
  const emptyDetailBundle = useMemo(() => buildFieldDetailTile([], anchor ?? { lat: 0, lon: 0 }, scale), [anchor, scale])
  const firstPair = useMemo(() => makeTexturePair(emptyFieldTexture('earth'), buildFieldDetailTile([], { lat: 0, lon: 0 }, 'earth')), [])
  if (!fromPair.current) fromPair.current = firstPair
  if (!toPair.current) toPair.current = firstPair
  const uniforms = useMemo(
    () => ({
      uFieldFrom: { value: firstPair.field },
      uFieldTo: { value: firstPair.field },
      uWaveFrom: { value: firstPair.wave },
      uWaveTo: { value: firstPair.wave },
      uDetailFieldFrom: { value: firstPair.detailField },
      uDetailFieldTo: { value: firstPair.detailField },
      uDetailWaveFrom: { value: firstPair.detailWave },
      uDetailWaveTo: { value: firstPair.detailWave },
      uDetailCenterFrom: { value: new Vector3(1, 0, 0) },
      uDetailEastFrom: { value: new Vector3(0, 0, -1) },
      uDetailNorthFrom: { value: new Vector3(0, 1, 0) },
      uDetailCenterTo: { value: new Vector3(1, 0, 0) },
      uDetailEastTo: { value: new Vector3(0, 0, -1) },
      uDetailNorthTo: { value: new Vector3(0, 1, 0) },
      uDetailExtentFrom: { value: 1 },
      uDetailExtentTo: { value: 1 },
      uTransition: { value: 1 },
      uTime: { value: 0 },
      // Source rates are intentionally slow; a separate visual clock scale
      // makes their anchored crests perceptible without changing observations.
      uMaterialPhaseRate: { value: 1.75 },
      uHeight: { value: MEMBRANE_HEIGHT },
      uDmax: { value: dMax },
      uDim: { value: 1 },
      uTeal: { value: new Vector3(0.065, 0.46, 0.39) },
      uViolet: { value: new Vector3(0.26, 0.19, 0.48) },
    }),
    [],
  )

  useLayoutEffect(() => {
    // R3F may reconcile/copy ShaderMaterial uniforms; mutate the live material
    // uniform table so texture swaps always reach the GPU.
    const live = (material.current?.uniforms ?? uniforms) as typeof uniforms
    const currentTarget = toPair.current
    if (initialized.current && currentTarget?.bundle.manifest.dataVersion === fieldBundle.manifest.dataVersion && currentTarget.detailBundle.manifest.dataVersion === detailBundle.manifest.dataVersion) return
    const nextPair = makeTexturePair(fieldBundle, detailBundle)
    const previousKinds = [currentTarget?.bundle.manifest.sourceType,
      ...(transitionValue.current < 1 ? [fromPair.current?.bundle.manifest.sourceType] : [])]
    const nextKind = fieldBundle.manifest.sourceType
    if (initialized.current && nextKind !== 'none' && previousKinds.some(kind => kind && kind !== 'none' && kind !== nextKind)) {
      // Synthetic fixtures and observed public records must never share a fade.
      disposeUniquePairs(fromPair.current, toPair.current)
      fromPair.current = nextPair
      toPair.current = nextPair
      for (const suffix of ['From', 'To'] as const) {
        live[`uField${suffix}`].value = nextPair.field
        live[`uWave${suffix}`].value = nextPair.wave
        live[`uDetailField${suffix}`].value = nextPair.detailField
        live[`uDetailWave${suffix}`].value = nextPair.detailWave
        setDetailUniforms(live, suffix, nextPair.detailBundle)
      }
      transitionValue.current = 1
      live.uTransition.value = 1
      return
    }
    if (!initialized.current) {
      toPair.current = nextPair
      live.uFieldTo.value = nextPair.field
      live.uWaveTo.value = nextPair.wave
      live.uFieldFrom.value = firstPair.field
      live.uWaveFrom.value = firstPair.wave
      live.uDetailFieldTo.value = nextPair.detailField
      live.uDetailWaveTo.value = nextPair.detailWave
      setDetailUniforms(live, 'To', nextPair.detailBundle)
      live.uDetailFieldFrom.value = firstPair.detailField
      live.uDetailWaveFrom.value = firstPair.detailWave
      setDetailUniforms(live, 'From', firstPair.detailBundle)
      transitionValue.current = 1
      live.uTransition.value = 1
      initialized.current = true
      return
    }

    const oldFrom = fromPair.current
    const oldTo = toPair.current
    let originBundle = oldTo?.bundle ?? emptyBundle
    let originDetailBundle = oldTo?.detailBundle ?? emptyDetailBundle
    if (oldFrom && oldTo && transitionValue.current < 1) {
      originBundle = interpolateFieldTextures(oldFrom.bundle, oldTo.bundle, transitionValue.current)
      originDetailBundle = interpolateFieldTextures(oldFrom.detailBundle, oldTo.detailBundle, transitionValue.current)
    }
    const originPair = makeTexturePair(originBundle, originDetailBundle)
    fromPair.current = originPair
    toPair.current = nextPair
    disposeUniquePairs(oldFrom, oldTo)
    live.uFieldFrom.value = originPair.field
    live.uWaveFrom.value = originPair.wave
    live.uDetailFieldFrom.value = originPair.detailField
    live.uDetailWaveFrom.value = originPair.detailWave
    setDetailUniforms(live, 'From', originPair.detailBundle)
    live.uFieldTo.value = nextPair.field
    live.uWaveTo.value = nextPair.wave
    live.uDetailFieldTo.value = nextPair.detailField
    live.uDetailWaveTo.value = nextPair.detailWave
    setDetailUniforms(live, 'To', nextPair.detailBundle)
    transitionStart.current = performance.now()
    transitionValue.current = 0
    live.uTransition.value = 0
  }, [detailBundle, emptyBundle, emptyDetailBundle, fieldBundle, firstPair, uniforms])

  useEffect(() => {
    lifecycleGeneration.current += 1
    return () => {
      const generation = ++lifecycleGeneration.current
      // StrictMode immediately replays effect setup after cleanup in dev.
      // Defer disposal one microtask so that replay can retain live textures.
      queueMicrotask(() => {
        if (lifecycleGeneration.current === generation) disposeUniquePairs(fromPair.current, toPair.current)
      })
    }
  }, [])

  useFrame((_, delta) => {
    frameMs.current += (Math.min(delta * 1000, 1000) - frameMs.current) * 0.05
    if (!material.current) return
    const live = material.current.uniforms as typeof uniforms
    // Rebind retained texture pairs after React/R3F reconciliation or hot reload.
    for (const [suffix, pair] of [['From', fromPair.current], ['To', toPair.current]] as const) {
      if (!pair) continue
      live[`uField${suffix}`].value = pair.field
      live[`uWave${suffix}`].value = pair.wave
      live[`uDetailField${suffix}`].value = pair.detailField
      live[`uDetailWave${suffix}`].value = pair.detailWave
      setDetailUniforms(live, suffix, pair.detailBundle)
    }
    live.uTransition.value = transitionValue.current
    if (phaseTimeSeconds !== undefined) phaseClock.current = Math.max(0, phaseTimeSeconds)
    else if (!paused) phaseClock.current += Math.min(delta, 0.1)
    live.uTime.value = phaseClock.current
    if (transitionValue.current < 1) {
      const linear = Math.min(1, (performance.now() - transitionStart.current) / SNAPSHOT_TRANSITION_MS)
      const eased = linear * linear * (3 - 2 * linear)
      transitionValue.current = eased
      live.uTransition.value = eased
    }
    live.uDim.value += ((dimmed ? 0.55 : 1) - live.uDim.value) * 0.06
    live.uDmax.value += (dMax - live.uDmax.value) * 0.08
    if (onDiagnostics && performance.now() - lastDiagnosticsAt.current > 750) {
      lastDiagnosticsAt.current = performance.now()
      const context = gl.getContext()
      const readTexture = (name: string, texture: DataTexture, bundle: FieldTextureBundle) => {
        const data = texture.image.data as Uint8Array
        const point = bundle.manifest.detailCenter ?? anchor ?? { lat: 0, lon: 0 }
        const x = bundle.manifest.projection === 'local-azimuthal-equidistant'
          ? Math.floor(texture.image.width / 2)
          : Math.max(0, Math.min(texture.image.width - 1, Math.floor(((point.lon + 180) / 360) * texture.image.width)))
        const y = bundle.manifest.projection === 'local-azimuthal-equidistant'
          ? Math.floor(texture.image.height / 2)
          : Math.max(0, Math.min(texture.image.height - 1, Math.floor(((point.lat + 90) / 180) * texture.image.height)))
        const offset = (y * texture.image.width + x) * 4
        let maxRed = 0
        let pixelsWithCoverage = 0
        for (let index = 0; index < data.length; index += 4) {
          maxRed = Math.max(maxRed, data[index] ?? 0)
          if ((data[index + 3] ?? 0) > 0) pixelsWithCoverage += 1
        }
        const properties = gl.properties.get(texture) as { __webglTexture?: WebGLTexture }
        let gpuSample: number[] | null = null
        let framebufferStatus = 'texture not uploaded'
        if (properties.__webglTexture) {
          const previousFramebuffer = context.getParameter(context.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
          const previousTexture = context.getParameter(context.TEXTURE_BINDING_2D) as WebGLTexture | null
          const framebuffer = context.createFramebuffer()
          if (framebuffer) {
            context.bindFramebuffer(context.FRAMEBUFFER, framebuffer)
            context.framebufferTexture2D(context.FRAMEBUFFER, context.COLOR_ATTACHMENT0, context.TEXTURE_2D, properties.__webglTexture, 0)
            const status = context.checkFramebufferStatus(context.FRAMEBUFFER)
            framebufferStatus = `0x${status.toString(16)}`
            if (status === context.FRAMEBUFFER_COMPLETE) {
              const pixel = new Uint8Array(4)
              context.readPixels(x, y, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel)
              gpuSample = [...pixel]
            }
            context.bindFramebuffer(context.FRAMEBUFFER, previousFramebuffer)
            context.deleteFramebuffer(framebuffer)
          }
          context.bindTexture(context.TEXTURE_2D, previousTexture)
          gl.resetState()
        }
        return {
          name,
          version: texture.version,
          size: `${texture.image.width}×${texture.image.height}`,
          sampleLatLon: [point.lat, point.lon] as [number, number],
          cpuSample: Array.from(data.slice(offset, offset + 4)),
          maxRed,
          pixelsWithCoverage,
          gpuTextureAllocated: Boolean(properties.__webglTexture),
          gpuSample,
          framebufferStatus,
        }
      }
      const materialProperties = gl.properties.get(material.current) as { currentProgram?: { program?: WebGLProgram } }
      const program = materialProperties.currentProgram?.program
      const linked = program ? context.getProgramParameter(program, context.LINK_STATUS) as boolean : null
      onDiagnostics({
        frameMs: Math.round(frameMs.current * 10) / 10,
        transition: live.uTransition.value,
        phaseTime: live.uTime.value,
        dMax: live.uDmax.value,
        textures: [
          readTexture('field-from', live.uFieldFrom.value, fromPair.current?.bundle ?? emptyBundle),
          readTexture('field-to', live.uFieldTo.value, toPair.current?.bundle ?? fieldBundle),
          readTexture('wave-from', live.uWaveFrom.value, fromPair.current?.bundle ?? emptyBundle),
          readTexture('wave-to', live.uWaveTo.value, toPair.current?.bundle ?? fieldBundle),
          readTexture('detail-from', live.uDetailFieldFrom.value, fromPair.current?.detailBundle ?? emptyDetailBundle),
          readTexture('detail-to', live.uDetailFieldTo.value, toPair.current?.detailBundle ?? detailBundle),
          readTexture('detail-wave-from', live.uDetailWaveFrom.value, fromPair.current?.detailBundle ?? emptyDetailBundle),
          readTexture('detail-wave-to', live.uDetailWaveTo.value, toPair.current?.detailBundle ?? detailBundle),
        ],
        programLinked: linked,
        programLog: program ? context.getProgramInfoLog(program) : null,
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
      })
    }
  })

  return (
    <mesh>
      <sphereGeometry args={[1, 512, 256]} />
      <shaderMaterial
        key={vertexShader + fragmentShader}
        ref={material}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={FrontSide}
      />
    </mesh>
  )
}
