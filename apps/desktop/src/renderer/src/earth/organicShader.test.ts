import { ShaderLib } from 'three'
import { describe, expect, it } from 'vitest'
import {
  ORGANIC_CONTOUR_LEVELS,
  ORGANIC_MACRO_DMAX,
  ORGANIC_MACRO_SATURATION,
  ORGANIC_MESO_AMPLITUDE,
  ORGANIC_MICRO_AMPLITUDE,
  ORGANIC_SHADER_CACHE_KEY,
  patchOrganicShader,
  type OrganicShaderUniforms,
} from './organicShader'

function uniforms(): OrganicShaderUniforms {
  return {
    uInterestFrom: { value: null },
    uInterestTo: { value: null },
    uInterestTransition: { value: 1 },
    uOrganicTime: { value: 0 },
    uVisualExaggeration: { value: 1 },
    uMacroAmount: { value: 1 },
    uMesoAmount: { value: 1 },
    uMicroAmount: { value: 1 },
    uOrganicGlass: { value: 0 },
    uOrganicReveal: { value: 1 },
    uOrganicLineGlow: { value: 1 },
    uOrganicWarp: { value: 1 },
  }
}

function patched() {
  const shader = {
    uniforms: {},
    vertexShader: ShaderLib.physical.vertexShader,
    fragmentShader: ShaderLib.physical.fragmentShader,
  }
  patchOrganicShader(shader, uniforms())
  return shader
}

/** Extract one GLSL function body (first match) by brace counting. */
function glslFunction(source: string, signature: string): string {
  const start = source.indexOf(signature)
  expect(start, `missing ${signature}`).toBeGreaterThanOrEqual(0)
  let depth = 0
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1)
  }
  throw new Error(`unterminated ${signature}`)
}

// CPU mirror of organicMacro().
const macro = (field: number) =>
  ORGANIC_MACRO_DMAX * (1 - Math.exp(-ORGANIC_MACRO_SATURATION * field)) / (1 - Math.exp(-ORGANIC_MACRO_SATURATION))

describe('organic membrane relief budget', () => {
  it('stays near the spec Dmax (≈0.045R) so swells read as membrane, not mountains', () => {
    expect(ORGANIC_MACRO_DMAX).toBeGreaterThanOrEqual(0.03)
    expect(ORGANIC_MACRO_DMAX).toBeLessThanOrEqual(0.06)
    expect(macro(0)).toBe(0)
    expect(macro(1)).toBeCloseTo(ORGANIC_MACRO_DMAX, 12)
  })

  it('keeps total relief monotonic in observed intensity', () => {
    // Relief = macro(f) + f·c(n) with |c| ≤ meso + micro amplitude. Its
    // derivative is smallest at f = 1, so that slope must dominate.
    const minimumMacroSlope = ORGANIC_MACRO_DMAX * ORGANIC_MACRO_SATURATION * Math.exp(-ORGANIC_MACRO_SATURATION)
      / (1 - Math.exp(-ORGANIC_MACRO_SATURATION))
    expect(minimumMacroSlope).toBeGreaterThan(ORGANIC_MESO_AMPLITUDE + ORGANIC_MICRO_AMPLITUDE)
    for (let f = 0; f < 1; f += 0.05) expect(macro(f + 0.05)).toBeGreaterThan(macro(f))
  })

  it('draws enough contour levels for the dense reference linework', () => {
    expect(ORGANIC_CONTOUR_LEVELS).toBeGreaterThanOrEqual(32)
  })
})

describe('organic physical shader integration', () => {
  it('patches the installed MeshPhysicalMaterial without losing its PBR output line', () => {
    expect(ShaderLib.physical.fragmentShader).toContain('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;')
    const shader = patched()
    expect(shader.uniforms).toMatchObject(uniforms())
    expect(shader.vertexShader).toContain('objectNormal = organicNormal(organicN, ORGANIC_STANDOFF + uVisualExaggeration * organicDisplacement);')
    expect(shader.vertexShader).toContain('transformed = organicDirection * (ORGANIC_STANDOFF + uVisualExaggeration * organicDisplacement);')
    expect(shader.fragmentShader).toContain('outgoingLight = mix(outgoingLight, organicColor, uOrganicGlass);')
    expect(ORGANIC_SHADER_CACHE_KEY).toMatch(/^[0-9a-f]{8}$/)
  })

  it('derives fragment contours from the same relief function as the displacement', () => {
    const { vertexShader, fragmentShader } = patched()
    const vertexRelief = glslFunction(vertexShader, 'float organicRelief(vec3 n, vec4 signal, float microWeight)')
    const fragmentRelief = glslFunction(fragmentShader, 'float organicRelief(vec3 n, vec4 signal, float microWeight)')
    expect(fragmentRelief).toBe(vertexRelief)
    // Per-pixel, B-spline sampled height: no faceted per-vertex contours.
    expect(fragmentShader).toContain('vec4 oSignal = organicSignal(oDir);')
    expect(glslFunction(fragmentShader, 'vec4 organicSignalAt(vec2 uv)')).toContain('organicSampleSmooth')
    // Micro ripples shade the surface but never trace contour loops.
    expect(fragmentShader).toContain('organicRelief(oDir, oSignal, 0.0)')
  })

  it('keeps meso and micro relief inside observed intensity', () => {
    const relief = glslFunction(patched().vertexShader, 'float organicRelief(vec3 n, vec4 signal, float microWeight)')
    expect(relief).toMatch(/mesoRelief = ORGANIC_MESO_AMPLITUDE \* uMesoAmount \* field \*/)
    expect(relief).toMatch(/microRelief = ORGANIC_MICRO_AMPLITUDE \* uMicroAmount \* microWeight \* field \*/)
    expect(relief).toContain('max(0.0, macroRelief + mesoRelief + microRelief)')
  })

  it('uses a time-invariant, support-gated geographic warp', () => {
    const signal = glslFunction(patched().vertexShader, 'vec4 organicSignal(vec3 n)')
    // Presentation phase must not relocate events.
    expect(signal).not.toContain('uOrganicTime')
    // Outside support the local (zero) value is returned; near the edge the
    // unwarped intensity is used; support/confidence/momentum stay local.
    expect(signal).toContain('local.a <= 0.0) return local;')
    expect(signal).toContain('smoothstep(0.08, 0.45, local.a)')
    expect(signal).toContain('return vec4(intensity, local.gba);')
  })

  it('anti-aliases contours with analytic LOD derivatives (no stipple at interval changes)', () => {
    const { fragmentShader } = patched()
    expect(glslFunction(fragmentShader, 'float organicIsoline(float v, float dv, float widthPx)')).not.toContain('fwidth')
    expect(fragmentShader).toContain('float oLevelDerivative = max(fwidth(oLevel), 1e-5);')
    expect(fragmentShader).toContain('float oDv = oLevelDerivative / oLodBase;')
  })

  it('separates presentation phase from meaningful snapshot change', () => {
    const { fragmentShader } = patched()
    // Snapshot flare depends only on the actual texture delta and transition.
    expect(fragmentShader).toMatch(/oChange = smoothstep\(0\.01, 0\.10, abs\(oTo\.r - oFrom\.r\)\) \* sin\(3\.14159265 \* clamp\(uInterestTransition/)
    // Pulses brighten strokes only; they never feed relief.
    const relief = glslFunction(fragmentShader, 'float organicRelief(vec3 n, vec4 signal, float microWeight)')
    expect(relief).not.toContain('oPulse')
    // Self-luminance is optional: lineGlow 0 is the no-glow geometry proof.
    expect(fragmentShader).toContain('(0.26 + 0.62 * uOrganicLineGlow)')
  })
})
