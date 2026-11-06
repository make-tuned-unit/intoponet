import { latLonToRender } from '@intoponet/frequency-field'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, ShaderMaterial, Vector3 } from 'three'
import { ORGANIC_MACRO_DMAX, ORGANIC_STANDOFF, STORY_HEIGHT_FULL } from '../earth/organicShader'
import { heightAt, type StoryTerrain } from './storyTerrain'

export type StrandEnd = { id: string; lat: number; lon: number; weight: number }

/**
 * Strands from a story's summit to its coverage hills in the other countries
 * that carried it, drawn in the order each country's coverage first appeared
 * (staggered, once). They run along the great circle and ride the terrain
 * itself, just above the surface, over mountains and down valleys: never up
 * into space. A strand shows that both covered the same story, not that one
 * copied the other, so it carries no flowing particles.
 */
export type StoryStrandsProps = {
  summit: { lat: number; lon: number; height: number } | null
  ends: StrandEnd[]
  /** Draw complete at once (reduced motion). */
  still: boolean
  /** The terrain the strands ride on. */
  terrain: StoryTerrain | null
}

/** Rough relief scale for things placed on summits from outside the shader (markers). */
const EXAGGERATION = 0.85
/** About 110 km per segment on the longest strands, so they follow each rise and fall. */
const MAX_SEGMENTS = 180
const STAGGER_MS = 150
const DRAW_MS = 700
/** Clearance above the surface, in globe radii (the membrane's smoothing rounds summits slightly). */
const CLEARANCE = 0.0035

export function summitRadius(height: number): number {
  return ORGANIC_STANDOFF + EXAGGERATION * ORGANIC_MACRO_DMAX * (height / STORY_HEIGHT_FULL) + 0.004
}

/** The membrane's relief exaggeration at a camera distance (OrganicMembrane uses the same). */
export function reliefExaggeration(cameraDistance: number): number {
  const zoom = Math.min(1, Math.max(0, (cameraDistance - 1.6) / (4.35 - 1.6)))
  const eased = zoom * zoom * (3 - 2 * zoom)
  return 0.62 + 0.38 * eased
}

const vertexShader = /* glsl */ `
  attribute vec3 aDirection;
  attribute vec3 aSideways;
  attribute float aHeight;
  attribute float aAlong;
  attribute float aSide;
  attribute float aStrand;
  uniform float uExaggeration;
  varying float vAlong;
  varying float vStrand;
  varying float vSide;
  void main() {
    vAlong = aAlong;
    vStrand = aStrand;
    vSide = aSide;
    // On the displaced membrane, as it is drawn at this zoom, plus a little clearance.
    float radius = ${ORGANIC_STANDOFF.toFixed(4)} + uExaggeration * ${ORGANIC_MACRO_DMAX.toFixed(4)} * (aHeight / ${STORY_HEIGHT_FULL.toFixed(4)}) + ${CLEARANCE.toFixed(4)};
    vec3 p = aDirection * radius + aSideways;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform float uProgress[16];
  uniform vec3 uFrom;
  uniform vec3 uTo;
  varying float vAlong;
  varying float vStrand;
  varying float vSide;
  void main() {
    int index = int(vStrand + 0.5);
    float progress = 0.0;
    for (int i = 0; i < 16; i++) if (i == index) progress = uProgress[i];
    if (vAlong > progress) discard;
    float across = 1.0 - smoothstep(0.35, 1.0, abs(vSide));
    float head = smoothstep(progress - 0.04, progress, vAlong) * step(progress, 0.999);
    vec3 color = mix(uFrom, uTo, vAlong);
    float alpha = across * (0.38 + 0.42 * smoothstep(0.0, 0.1, vAlong)) + head * 0.6;
    gl_FragColor = vec4(color * alpha, alpha);
  }
`

function toVector(lat: number, lon: number): Vector3 {
  const p = latLonToRender(lat, lon)
  return new Vector3(p.x, p.y, p.z).normalize()
}

function toLatLon(v: Vector3): { lat: number; lon: number } {
  return { lat: (Math.asin(Math.max(-1, Math.min(1, v.y))) * 180) / Math.PI, lon: (Math.atan2(-v.z, v.x) * 180) / Math.PI }
}

export function StoryStrands({ summit, ends, still, terrain }: StoryStrandsProps) {
  const { camera, invalidate } = useThree()
  const started = useRef(performance.now())
  const shown = ends.slice(0, 16)

  const geometry = useMemo(() => {
    const geo = new BufferGeometry()
    if (!summit || !shown.length) return geo
    const from = toVector(summit.lat, summit.lon)
    const direction: number[] = []
    const sideways: number[] = []
    const heights: number[] = []
    const along: number[] = []
    const side: number[] = []
    const strand: number[] = []
    const indices: number[] = []
    let vertex = 0
    shown.forEach((end, k) => {
      const to = toVector(end.lat, end.lon)
      const angle = from.angleTo(to)
      if (angle < 1e-4) return
      const segments = Math.max(16, Math.min(MAX_SEGMENTS, Math.round(angle / 0.017)))
      // Ribbon half-width in globe radii: wider for countries with more outlets carrying it.
      const width = 0.0018 + 0.0024 * Math.min(1, end.weight)
      // Sideways is along the great circle's axis: always level with the surface beneath.
      const axis = from.clone().cross(to).normalize()
      for (let i = 0; i <= segments; i += 1) {
        const t = i / segments
        // Along the great circle on the unit sphere: it bends with the Earth by construction.
        const d = from.clone().multiplyScalar(Math.sin((1 - t) * angle) / Math.sin(angle)).add(to.clone().multiplyScalar(Math.sin(t * angle) / Math.sin(angle))).normalize()
        const point = toLatLon(d)
        const h = terrain ? heightAt(terrain, point.lat, point.lon) : 0
        const taper = 1 - 0.45 * t
        for (const sign of [-1, 1]) {
          direction.push(d.x, d.y, d.z)
          sideways.push(axis.x * sign * width * taper, axis.y * sign * width * taper, axis.z * sign * width * taper)
          heights.push(h)
          along.push(t)
          side.push(sign)
          strand.push(k)
        }
        if (i < segments) {
          const a = vertex + i * 2
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
        }
      }
      vertex += (segments + 1) * 2
    })
    geo.setAttribute('position', new BufferAttribute(new Float32Array(direction.length), 3))
    geo.setAttribute('aDirection', new BufferAttribute(new Float32Array(direction), 3))
    geo.setAttribute('aSideways', new BufferAttribute(new Float32Array(sideways), 3))
    geo.setAttribute('aHeight', new BufferAttribute(new Float32Array(heights), 1))
    geo.setAttribute('aAlong', new BufferAttribute(new Float32Array(along), 1))
    geo.setAttribute('aSide', new BufferAttribute(new Float32Array(side), 1))
    geo.setAttribute('aStrand', new BufferAttribute(new Float32Array(strand), 1))
    geo.setIndex(indices)
    return geo
  }, [summit?.lat, summit?.lon, terrain?.key, shown.map((end) => `${end.id}:${end.weight.toFixed(2)}`).join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => geometry.dispose(), [geometry])

  const material = useMemo(() => new ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    // Ribbons face either way depending on the strand's direction.
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: {
      uProgress: { value: new Array(16).fill(0) },
      uExaggeration: { value: 1 },
      // Gold at the summit to pale blue-white at the far end.
      uFrom: { value: new Color('#ffd166').convertSRGBToLinear() },
      uTo: { value: new Color('#cfe6ee').convertSRGBToLinear() },
    },
  }), [])
  useEffect(() => () => material.dispose(), [material])

  useEffect(() => {
    started.current = performance.now()
    invalidate()
  }, [geometry, invalidate])

  useFrame(() => {
    material.uniforms['uExaggeration']!.value = reliefExaggeration(camera.position.length())
    const progress = material.uniforms['uProgress']!.value as number[]
    const elapsed = performance.now() - started.current
    let animating = false
    for (let k = 0; k < 16; k += 1) {
      const p = still ? 1 : Math.min(1, Math.max(0, (elapsed - k * STAGGER_MS) / DRAW_MS))
      progress[k] = 1 - (1 - p) ** 3
      if (k < shown.length && p < 1) animating = true
    }
    if (animating) invalidate()
  })

  if (!summit || !shown.length) return null
  return <mesh geometry={geometry} material={material} renderOrder={22} frustumCulled={false} />
}
