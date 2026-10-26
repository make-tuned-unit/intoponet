import { useMemo } from 'react'
import { AdditiveBlending, BackSide, Color, FrontSide, ShaderMaterial } from 'three'

/*
 * Restrained atmospheric limb (spec §1/§9). Two cheap Fresnel shells,
 * computed in world space so the glow does not fade as the camera zooms:
 * an outer back-face halo beyond the silhouette and a thin inner rim that
 * meets it at the limb. Purely presentational; no data enters here.
 */

const vertexShader = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const haloFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSunDirection;
  uniform float uIntensity;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  void main() {
    vec3 view = normalize(cameraPosition - vWorldPosition);
    // Back faces: the normal points away from the viewer; facing → 0 at limb.
    float facing = clamp(dot(-vWorldNormal, view), 0.0, 1.0);
    float halo = pow(smoothstep(0.0, 0.62, facing), 2.2) * (1.0 - smoothstep(0.62, 1.0, facing));
    float day = 0.35 + 0.65 * smoothstep(-0.35, 0.6, dot(-vWorldNormal, uSunDirection));
    gl_FragColor = vec4(uColor * halo * day * uIntensity, 1.0);
  }
`

const rimFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSunDirection;
  uniform float uIntensity;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  void main() {
    vec3 view = normalize(cameraPosition - vWorldPosition);
    float rim = pow(1.0 - clamp(dot(vWorldNormal, view), 0.0, 1.0), 4.0);
    float day = 0.25 + 0.75 * smoothstep(-0.25, 0.7, dot(vWorldNormal, uSunDirection));
    gl_FragColor = vec4(uColor * rim * day * uIntensity, 1.0);
  }
`

const sun = [-3, 4, 1] as const

function shellMaterial(fragmentShader: string, side: typeof BackSide | typeof FrontSide, color: string, intensity: number): ShaderMaterial {
  const length = Math.hypot(...sun)
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uColor: { value: new Color(color) },
      uSunDirection: { value: sun.map((value) => value / length) },
      uIntensity: { value: intensity },
    },
    side,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
}

export function Atmosphere({ dimmed = false }: { dimmed?: boolean }) {
  const halo = useMemo(() => shellMaterial(haloFragment, BackSide, '#2f8fb0', 0.55), [])
  const rim = useMemo(() => shellMaterial(rimFragment, FrontSide, '#3fb6c9', 0.42), [])
  halo.uniforms.uIntensity!.value = dimmed ? 0.3 : 0.55
  rim.uniforms.uIntensity!.value = dimmed ? 0.22 : 0.42
  return (
    <>
      <mesh renderOrder={-1}>
        <sphereGeometry args={[1.13, 96, 64]} />
        <primitive object={halo} attach="material" />
      </mesh>
      <mesh>
        <sphereGeometry args={[1.004, 96, 64]} />
        <primitive object={rim} attach="material" />
      </mesh>
    </>
  )
}
