import { useFrame } from '@react-three/fiber'
import { bandsFromSnapshot, demoFieldSnapshot, type FieldScale } from '@intoponet/field-snapshot'
import type { FrequencyBand, GpuBandSegment } from '@intoponet/frequency-field'
import {
  DISPLACEMENT_GAIN,
  MAX_BAND_SEGMENTS,
  MEMBRANE_HEIGHT,
  latLonToRender,
  segmentsFromBands,
} from '@intoponet/frequency-field'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { FrontSide, ShaderMaterial, Vector4 } from 'three'

const BLEND_MS = 2000

const vertexShader = /* glsl */ `
  const int MAX_SEG = 20;
  uniform int uCount;
  uniform vec4 uA[MAX_SEG];
  uniform vec4 uB[MAX_SEG];
  uniform vec4 uP0[MAX_SEG];
  uniform vec4 uP1[MAX_SEG];
  uniform float uTime;
  uniform float uHeight;
  uniform float uDmax;
  uniform float uGain;
  uniform float uDim;
  varying float vField;
  varying float vFilament;
  varying float vMix;
  varying vec3 vNormalW;
  varying vec3 vView;

  float ang(vec3 a, vec3 b) {
    return acos(clamp(dot(normalize(a), normalize(b)), -1.0, 1.0));
  }

  vec2 distToArc(vec3 p, vec3 a, vec3 b) {
    vec3 axis = cross(a, b);
    if (length(axis) < 1e-6) {
      return vec2(ang(p, a), 0.0);
    }
    vec3 closest = normalize(cross(axis, cross(p, axis)));
    float ab = ang(a, b);
    float ac = ang(a, closest);
    float bc = ang(b, closest);
    if (ac <= ab + 0.0008 && bc <= ab + 0.0008) {
      float distance = abs(asin(clamp(dot(normalize(p), normalize(axis)), -1.0, 1.0)));
      return vec2(distance, ac);
    }
    float toA = ang(p, a);
    float toB = ang(p, b);
    return toA < toB ? vec2(toA, 0.0) : vec2(toB, ab);
  }

  vec3 sampleField(vec3 p) {
    float sum = 0.0;
    float mixC = 0.0;
    float filament = 0.0;
    for (int i = 0; i < MAX_SEG; i++) {
      if (i >= uCount) break;
      vec2 near = distToArc(p, uA[i].xyz, uB[i].xyz);
      float sigma = max(uP0[i].x, 0.008);
      float lambda = max(uP0[i].y, 0.02);
      float envelope = exp(-0.5 * pow(near.x / sigma, 2.0));
      float wave = 0.5 + 0.5 * cos(6.283185 * near.y / lambda + uP0[i].w + uP1[i].x * uTime);
      float unit = clamp(wave, 0.0, 1.0);
      float smoothWave = unit * unit * (3.0 - 2.0 * unit);
      float contribution = uP0[i].z * envelope * smoothWave;
      sum += contribution;
      mixC += contribution * uP1[i].y;
      filament += envelope * pow(abs(sin(6.283185 * near.y / lambda + uP0[i].w + uP1[i].x * uTime)), 10.0);
    }
    float displacement = uDmax * (1.0 - exp(-uGain * sum));
    return vec3(displacement, sum, mixC / max(sum, 0.0001) + filament * 0.08);
  }

  void main() {
    vec3 n = normalize(position);
    vec3 offsetU = normalize(n + vec3(0.012, 0.0, 0.0));
    vec3 offsetV = normalize(n + vec3(0.0, 0.012, 0.0));
    vec3 field = sampleField(n);
    float du = sampleField(offsetU).x;
    float dv = sampleField(offsetV).x;
    vec3 pu = offsetU * (1.0 + uHeight + du);
    vec3 pv = offsetV * (1.0 + uHeight + dv);
    vec3 p = n * (1.0 + uHeight + field.x);
    vNormalW = normalize(cross(pu - p, pv - p));
    if (dot(vNormalW, n) < 0.0) vNormalW *= -1.0;
    vField = field.y;
    vFilament = field.z;
    vMix = clamp(field.z, 0.0, 1.0);
    vec4 world = modelViewMatrix * vec4(p, 1.0);
    vView = -world.xyz;
    gl_Position = projectionMatrix * world;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uTeal;
  uniform vec3 uViolet;
  uniform float uDim;
  varying float vField;
  varying float vFilament;
  varying float vMix;
  varying vec3 vNormalW;
  varying vec3 vView;

  void main() {
    float intensity = smoothstep(0.02, 0.55, vField);
    vec3 color = mix(uTeal, uViolet, clamp(vMix, 0.0, 0.55));
    float fresnel = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vView))), 2.0);
    float alpha = (0.055 + intensity * 0.4 + vFilament * 0.1 + fresnel * 0.07) * uDim;
    color += vec3(0.18, 0.22, 0.24) * vFilament;
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.62));
  }
`

function emptyVec4(): Vector4 {
  return new Vector4()
}

type SlotBank = {
  a: Vector4[]
  b: Vector4[]
  p0: Vector4[]
  p1: Vector4[]
}

function makeBank(): SlotBank {
  return {
    a: Array.from({ length: MAX_BAND_SEGMENTS }, emptyVec4),
    b: Array.from({ length: MAX_BAND_SEGMENTS }, emptyVec4),
    p0: Array.from({ length: MAX_BAND_SEGMENTS }, emptyVec4),
    p1: Array.from({ length: MAX_BAND_SEGMENTS }, emptyVec4),
  }
}

function writeSegment(bank: SlotBank, index: number, segment: GpuBandSegment | undefined): void {
  const a = bank.a[index]
  const b = bank.b[index]
  const p0 = bank.p0[index]
  const p1 = bank.p1[index]
  if (!a || !b || !p0 || !p1) return
  if (!segment) {
    a.set(0, 0, 0, 0)
    b.set(0, 0, 0, 0)
    p0.set(0, 0, 0, 0)
    p1.set(0, 0, 0, 0)
    return
  }
  a.set(segment.ax, segment.ay, segment.az, 0)
  b.set(segment.bx, segment.by, segment.bz, 0)
  p0.set(segment.sigma, segment.lambda, segment.amplitude, segment.phase)
  p1.set(segment.omega, segment.colorMix, 0, 0)
}

function fillBank(bank: SlotBank, segments: GpuBandSegment[]): void {
  for (let index = 0; index < MAX_BAND_SEGMENTS; index += 1) {
    writeSegment(bank, index, segments[index])
  }
}

function copyBank(from: SlotBank, to: SlotBank): void {
  for (let index = 0; index < MAX_BAND_SEGMENTS; index += 1) {
    to.a[index]?.copy(from.a[index] ?? emptyVec4())
    to.b[index]?.copy(from.b[index] ?? emptyVec4())
    to.p0[index]?.copy(from.p0[index] ?? emptyVec4())
    to.p1[index]?.copy(from.p1[index] ?? emptyVec4())
  }
}

function liveCount(bank: SlotBank): number {
  let count = 0
  for (let index = 0; index < MAX_BAND_SEGMENTS; index += 1) {
    const amplitude = bank.p0[index]?.z ?? 0
    if (amplitude > 0.0008) count = index + 1
  }
  return count
}

function lerpBank(origin: SlotBank, target: SlotBank, live: SlotBank, amount: number): number {
  let count = 0
  for (let index = 0; index < MAX_BAND_SEGMENTS; index += 1) {
    const a = live.a[index]
    const b = live.b[index]
    const p0 = live.p0[index]
    const p1 = live.p1[index]
    if (!a || !b || !p0 || !p1) continue
    a.lerpVectors(origin.a[index] ?? a, target.a[index] ?? a, amount)
    b.lerpVectors(origin.b[index] ?? b, target.b[index] ?? b, amount)
    p0.lerpVectors(origin.p0[index] ?? p0, target.p0[index] ?? p0, amount)
    p1.lerpVectors(origin.p1[index] ?? p1, target.p1[index] ?? p1, amount)
    const fading =
      (origin.p0[index]?.z ?? 0) > 0.0008 || (target.p0[index]?.z ?? 0) > 0.0008 || p0.z > 0.0008
    if (fading) count = index + 1
  }
  return count
}

export function FrequencyMembrane({
  paused,
  dimmed,
  dMax = 0.042,
  bands,
  scale = 'earth',
}: {
  paused: boolean
  dimmed: boolean
  dMax?: number
  bands?: FrequencyBand[] | undefined
  scale?: FieldScale
}) {
  const material = useRef<ShaderMaterial>(null)
  const live = useRef<SlotBank>(makeBank())
  const origin = useRef<SlotBank>(makeBank())
  const target = useRef<SlotBank>(makeBank())
  const seen = useRef(false)
  const blending = useRef(false)
  const blendStart = useRef(0)
  const segments = useMemo(
    () => segmentsFromBands(bands ?? bandsFromSnapshot(demoFieldSnapshot(), scale), latLonToRender),
    [bands, scale],
  )
  const uniforms = useMemo(
    () => ({
      uCount: { value: 0 },
      uA: { value: live.current.a },
      uB: { value: live.current.b },
      uP0: { value: live.current.p0 },
      uP1: { value: live.current.p1 },
      uTime: { value: 0 },
      uHeight: { value: MEMBRANE_HEIGHT },
      uDmax: { value: dMax },
      uGain: { value: DISPLACEMENT_GAIN },
      uDim: { value: 1 },
      uTeal: { value: [0.314, 0.851, 0.78] },
      uViolet: { value: [0.651, 0.608, 0.91] },
    }),
    [],
  )

  useLayoutEffect(() => {
    fillBank(target.current, segments)
    if (!seen.current || paused) {
      copyBank(target.current, live.current)
      copyBank(target.current, origin.current)
      uniforms.uCount.value = liveCount(live.current)
      seen.current = true
      blending.current = false
      return
    }
    copyBank(live.current, origin.current)
    blendStart.current = performance.now()
    blending.current = true
  }, [paused, segments, uniforms])

  useFrame(({ clock }) => {
    if (!material.current) return
    if (!paused) material.current.uniforms['uTime']!.value = clock.elapsedTime
    if (blending.current) {
      const elapsed = Math.min(1, (performance.now() - blendStart.current) / BLEND_MS)
      const eased = elapsed * elapsed * (3 - 2 * elapsed)
      uniforms.uCount.value = lerpBank(origin.current, target.current, live.current, eased)
      if (elapsed >= 1) blending.current = false
    }
    material.current.uniforms['uDim']!.value += ((dimmed ? 0.55 : 1) - material.current.uniforms['uDim']!.value) * 0.06
    material.current.uniforms['uDmax']!.value += (dMax - material.current.uniforms['uDmax']!.value) * 0.08
  })

  return (
    <mesh>
      <sphereGeometry args={[1, 160, 96]} />
      <shaderMaterial
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
