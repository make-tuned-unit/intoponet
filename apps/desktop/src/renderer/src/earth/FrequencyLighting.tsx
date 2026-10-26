import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import {
  ClampToEdgeWrapping,
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  LinearFilter,
  NoColorSpace,
  PMREMGenerator,
  RGBAFormat,
  Vector3,
} from 'three'

const ENVIRONMENT_WIDTH = 256
const ENVIRONMENT_HEIGHT = 128

function createSoftStudioEnvironment() {
  const lobes = [
    { direction: new Vector3(-3, 4, 1).normalize(), color: [3.27, 3.27, 3.27] as const, width: 0.28 },
    { direction: new Vector3(4, 0, 2).normalize(), color: [0.8, 0.8, 0.8] as const, width: 0.4 },
    { direction: new Vector3(1, 2, -4).normalize(), color: [0.9, 0.9, 0.9] as const, width: 0.35 },
  ]
  const pixels = new Float32Array(ENVIRONMENT_WIDTH * ENVIRONMENT_HEIGHT * 4)

  for (let y = 0; y < ENVIRONMENT_HEIGHT; y += 1) {
    const latitude = (0.5 - (y + 0.5) / ENVIRONMENT_HEIGHT) * Math.PI
    const latitudeCosine = Math.cos(latitude)
    for (let x = 0; x < ENVIRONMENT_WIDTH; x += 1) {
      const longitude = ((x + 0.5) / ENVIRONMENT_WIDTH - 0.5) * Math.PI * 2
      const directionX = latitudeCosine * Math.cos(longitude)
      const directionY = Math.sin(latitude)
      const directionZ = latitudeCosine * Math.sin(longitude)
      const offset = (y * ENVIRONMENT_WIDTH + x) * 4
      pixels[offset] = 0.012
      pixels[offset + 1] = 0.014
      pixels[offset + 2] = 0.019
      pixels[offset + 3] = 1

      for (const lobe of lobes) {
        const dot = Math.max(
          -1,
          Math.min(
            1,
            directionX * lobe.direction.x + directionY * lobe.direction.y + directionZ * lobe.direction.z,
          ),
        )
        const angularWeight = Math.exp(-(1 - dot) / (lobe.width * lobe.width))
        pixels[offset] = pixels[offset]! + lobe.color[0] * angularWeight
        pixels[offset + 1] = pixels[offset + 1]! + lobe.color[1] * angularWeight
        pixels[offset + 2] = pixels[offset + 2]! + lobe.color[2] * angularWeight
      }
    }
  }

  const texture = new DataTexture(
    pixels,
    ENVIRONMENT_WIDTH,
    ENVIRONMENT_HEIGHT,
    RGBAFormat,
    FloatType,
  )
  texture.mapping = EquirectangularReflectionMapping
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.colorSpace = NoColorSpace
  texture.needsUpdate = true
  return texture
}

function LowStudioEnvironment() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl)
    pmrem.compileEquirectangularShader()
    const source = createSoftStudioEnvironment()
    const target = pmrem.fromEquirectangular(source)
    const previous = scene.environment
    const previousIntensity = scene.environmentIntensity
    scene.environment = target.texture
    scene.environmentIntensity = 1.0
    return () => {
      if (scene.environment === target.texture) {
        scene.environment = previous
        scene.environmentIntensity = previousIntensity
      }
      target.dispose()
      pmrem.dispose()
      source.dispose()
    }
  }, [gl, scene])
  return null
}

/** Shared physical lighting for the app and material lab. Geometry QA stays neutral. */
export function FrequencyLighting({ profile }: { profile: 'physical' | 'geometry' | 'legacy' }) {
  if (profile === 'geometry') {
    return (
      <>
        <ambientLight intensity={0.12} />
        <hemisphereLight args={['#e7f0ee', '#4b5358', 0.25]} />
        <directionalLight position={[-3.5, 4.5, 4]} intensity={1.6} />
        <directionalLight position={[3, -1.5, -3]} intensity={0.22} />
      </>
    )
  }

  if (profile === 'legacy') {
    return (
      <>
        <ambientLight intensity={0.22} />
        <directionalLight position={[4.2, 1.8, 2.4]} intensity={1.55} color="#f2efe6" />
        <directionalLight position={[-3, -0.8, -2]} intensity={0.18} color="#a69be8" />
      </>
    )
  }

  return (
    <>
      <LowStudioEnvironment />
      <ambientLight intensity={0.08} />
      <hemisphereLight args={['#dce7e4', '#29353d', 0.15]} />
      <directionalLight position={[-3, 4, 1]} intensity={3} color="#f1eee7" />
      <directionalLight position={[4, 0, 2]} intensity={0.38} color="#e8eceb" />
      <directionalLight position={[1, 2, -4]} intensity={0.24} color="#d9d5e2" />
    </>
  )
}
