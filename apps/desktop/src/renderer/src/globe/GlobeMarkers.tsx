import { latLonToRender } from '@intoponet/frequency-field'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial, Vector3 } from 'three'

export type GlobeMarker = {
  id: string
  lat: number
  lon: number
  color: string
  /** 0..1 prominence inside the marker's own layer. */
  size: number
  kind: 'signal' | 'pin'
}

/**
 * Screen positions of markers, written every frame by the scene and read by
 * the HTML label layer without React re-renders.
 */
export type GlobeProjection = {
  ids: string[]
  index: Map<string, number>
  x: Float32Array
  y: Float32Array
  /** > 0 when the marker faces the camera; fades towards the limb. */
  facing: Float32Array
  width: number
  height: number
  /** The point on the globe at the centre of the view (degrees). */
  centerLat?: number
  centerLon?: number
}

export function createGlobeProjection(): GlobeProjection {
  return { ids: [], index: new Map(), x: new Float32Array(0), y: new Float32Array(0), facing: new Float32Array(0), width: 0, height: 0 }
}

const MARKER_RADIUS = 1.014
const PICK_PX = 18

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aState;
  uniform float uPixelRatio;
  uniform float uTime;
  varying vec3 vColor;
  varying float vState;
  varying float vFacing;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 normal = normalize(position);
    vFacing = dot(normal, normalize(cameraPosition - position));
    vColor = aColor;
    vState = aState;
    float zoom = clamp(3.2 / -mv.z, 0.75, 2.4);
    float lift = aState > 1.5 ? 1.9 : aState > 0.5 ? 1.45 : aState < -0.5 ? 0.6 : 1.0;
    gl_PointSize = aSize * uPixelRatio * sqrt(zoom) * lift;
    gl_Position = projectionMatrix * mv;
  }
`

const fragmentShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vColor;
  varying float vState;
  varying float vFacing;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0 || vFacing < 0.0) discard;
    float limb = smoothstep(0.0, 0.28, vFacing);
    float core = smoothstep(0.34, 0.12, d);
    float halo = exp(-d * d * 5.0) * 0.55;
    float ring = 0.0;
    if (vState > 1.5) {
      float pulse = fract(uTime * 0.55);
      ring = smoothstep(0.08, 0.0, abs(d - (0.42 + pulse * 0.55))) * (1.0 - pulse);
      ring += smoothstep(0.06, 0.0, abs(d - 0.5)) * 0.8;
    }
    vec3 color = mix(vColor, vec3(1.0), core * 0.55);
    float alpha = (core + halo + ring) * limb * (vState < -0.5 ? 0.22 : 1.0);
    gl_FragColor = vec4(color * alpha, alpha);
  }
`

export function GlobeMarkers({
  markers,
  selectedId,
  hoveredId,
  projection,
  interactive,
  onHover,
  onSelect,
  emphasis = null,
}: {
  markers: GlobeMarker[]
  selectedId: string | null
  hoveredId: string | null
  projection: GlobeProjection
  interactive: boolean
  onHover: (id: string | null) => void
  onSelect: (id: string | null) => void
  /** When set, markers outside it are dimmed (e.g. countries using a rising term). */
  emphasis?: ReadonlySet<string> | null
}) {
  const { camera, gl, size } = useThree()
  const callbacks = useRef({ onHover, onSelect, interactive })
  callbacks.current = { onHover, onSelect, interactive }
  const hoverRef = useRef<string | null>(null)

  const positions = useMemo(() => markers.map((marker) => {
    const p = latLonToRender(marker.lat, marker.lon)
    return new Vector3(p.x * MARKER_RADIUS, p.y * MARKER_RADIUS, p.z * MARKER_RADIUS)
  }), [markers])

  const geometry = useMemo(() => {
    const geo = new BufferGeometry()
    const pos = new Float32Array(markers.length * 3)
    const colors = new Float32Array(markers.length * 3)
    const sizes = new Float32Array(markers.length)
    const color = new Color()
    markers.forEach((marker, i) => {
      const p = positions[i]!
      pos.set([p.x, p.y, p.z], i * 3)
      color.set(marker.color)
      colors.set([color.r, color.g, color.b], i * 3)
      sizes[i] = marker.kind === 'pin' ? 15 : 9 + marker.size * 13
    })
    geo.setAttribute('position', new BufferAttribute(pos, 3))
    geo.setAttribute('aColor', new BufferAttribute(colors, 3))
    geo.setAttribute('aSize', new BufferAttribute(sizes, 1))
    geo.setAttribute('aState', new BufferAttribute(new Float32Array(markers.length), 1))
    return geo
  }, [markers, positions])
  useEffect(() => () => geometry.dispose(), [geometry])

  const material = useMemo(() => new ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: AdditiveBlending,
    uniforms: { uPixelRatio: { value: 1 }, uTime: { value: 0 } },
  }), [])
  useEffect(() => () => material.dispose(), [material])

  // Selection/hover state lives in a per-vertex attribute.
  useEffect(() => {
    const state = geometry.getAttribute('aState') as BufferAttribute
    markers.forEach((marker, i) => {
      state.setX(i, marker.id === selectedId ? 2 : marker.id === hoveredId ? 1 : emphasis && !emphasis.has(marker.id) ? -1 : 0)
    })
    state.needsUpdate = true
  }, [geometry, markers, selectedId, hoveredId, emphasis])

  // Keep the projection store sized to the marker list.
  useEffect(() => {
    projection.ids = markers.map((marker) => marker.id)
    projection.index = new Map(projection.ids.map((id, i) => [id, i]))
    projection.x = new Float32Array(markers.length)
    projection.y = new Float32Array(markers.length)
    projection.facing = new Float32Array(markers.length)
  }, [markers, projection])

  const scratch = useMemo(() => new Vector3(), [])
  useFrame((state) => {
    material.uniforms['uPixelRatio']!.value = gl.getPixelRatio()
    material.uniforms['uTime']!.value = state.clock.elapsedTime
    projection.width = size.width
    projection.height = size.height
    const cam = camera.position
    const camLength = cam.length()
    if (camLength > 0) {
      projection.centerLat = Math.asin(Math.max(-1, Math.min(1, cam.y / camLength))) * 180 / Math.PI
      projection.centerLon = Math.atan2(-cam.z, cam.x) * 180 / Math.PI
    }
    for (let i = 0; i < positions.length && i < projection.x.length; i += 1) {
      const p = positions[i]!
      scratch.copy(p).project(camera)
      projection.x[i] = (scratch.x + 1) * 0.5 * size.width
      projection.y[i] = (1 - scratch.y) * 0.5 * size.height
      // Horizon test for a point on a sphere seen from `cam`.
      projection.facing[i] = (p.dot(cam) / MARKER_RADIUS - MARKER_RADIUS) / Math.max(0.001, camLength - MARKER_RADIUS)
    }
  })

  useEffect(() => {
    const element = gl.domElement
    let down: { x: number; y: number } | null = null
    const nearest = (event: PointerEvent): string | null => {
      const rect = element.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      let best: string | null = null
      let bestDistance = PICK_PX * PICK_PX
      for (let i = 0; i < projection.ids.length; i += 1) {
        if (projection.facing[i]! <= 0.02) continue
        const dx = projection.x[i]! - px
        const dy = projection.y[i]! - py
        const d = dx * dx + dy * dy
        if (d < bestDistance) {
          bestDistance = d
          best = projection.ids[i]!
        }
      }
      return best
    }
    const onMove = (event: PointerEvent): void => {
      if (!callbacks.current.interactive || event.buttons !== 0) return
      const id = nearest(event)
      if (id === hoverRef.current) return
      hoverRef.current = id
      element.style.cursor = id ? 'pointer' : ''
      callbacks.current.onHover(id)
    }
    const onLeave = (): void => {
      if (hoverRef.current === null) return
      hoverRef.current = null
      element.style.cursor = ''
      callbacks.current.onHover(null)
    }
    const onDown = (event: PointerEvent): void => { down = { x: event.clientX, y: event.clientY } }
    const onUp = (event: PointerEvent): void => {
      if (!down || !callbacks.current.interactive) return
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y)
      down = null
      if (moved > 5) return
      callbacks.current.onSelect(nearest(event))
    }
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerleave', onLeave)
    element.addEventListener('pointerdown', onDown)
    element.addEventListener('pointerup', onUp)
    return () => {
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerleave', onLeave)
      element.removeEventListener('pointerdown', onDown)
      element.removeEventListener('pointerup', onUp)
      element.style.cursor = ''
    }
  }, [gl, projection])

  if (!markers.length) return null
  return <points geometry={geometry} material={material} renderOrder={20} frustumCulled={false} />
}
