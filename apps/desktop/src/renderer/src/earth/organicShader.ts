/*
 * Organic membrane displacement + contour patch for MeshPhysicalMaterial.
 *
 * Simplex noise below is from Ashima Arts' webgl-noise project, noise3D.glsl:
 * https://github.com/ashima/webgl-noise
 * Copyright (C) 2011 Ashima Arts. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * The cubic B-spline sampler follows Sigg & Hadwiger, "Fast Third-Order
 * Texture Filtering", GPU Gems 2, chapter 20.
 */

/** Relief budget in unit-sphere radii. Spec §6 starting value is ≈0.045R. */
export const ORGANIC_MACRO_DMAX = 0.045
export const ORGANIC_MESO_AMPLITUDE = 0.0135
export const ORGANIC_MICRO_AMPLITUDE = 0.0018
/** Saturation constant for D = Dmax(1 - e^{-kS}) / (1 - e^{-k}). */
export const ORGANIC_MACRO_SATURATION = 1.6
/** Contour levels across the macro relief budget at full exaggeration. */
export const ORGANIC_CONTOUR_LEVELS = 44
export const ORGANIC_STANDOFF = 1.025

const glslFloat = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(value))

const simplexNoise3D = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m *= m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`

/* Shared by both stages so the fragment contour height is the same function
 * that displaces the vertices. */
const organicFieldFunctions = /* glsl */ `
uniform highp sampler2D uInterestFrom;
uniform highp sampler2D uInterestTo;
uniform float uInterestTransition;
uniform float uOrganicTime;
uniform float uVisualExaggeration;
uniform float uMacroAmount;
uniform float uMesoAmount;
uniform float uMicroAmount;
uniform float uOrganicGlass;
uniform float uOrganicReveal;
uniform float uOrganicLineGlow;
uniform float uOrganicWarp;

const float ORGANIC_MACRO_DMAX = ${glslFloat(ORGANIC_MACRO_DMAX)};
const float ORGANIC_MESO_AMPLITUDE = ${glslFloat(ORGANIC_MESO_AMPLITUDE)};
const float ORGANIC_MICRO_AMPLITUDE = ${glslFloat(ORGANIC_MICRO_AMPLITUDE)};
const float ORGANIC_MACRO_SATURATION = ${glslFloat(ORGANIC_MACRO_SATURATION)};
const float ORGANIC_STANDOFF = ${glslFloat(ORGANIC_STANDOFF)};

vec2 organicUv(vec3 n) {
  float lon = atan(-n.z, n.x);
  float lat = asin(clamp(n.y, -1.0, 1.0));
  return vec2(lon / 6.28318530718 + 0.5, lat / 3.14159265359 + 0.5);
}

// Cubic B-spline weights; C2-continuous reconstruction removes the texel-grid
// kinks that bilinear filtering puts into every isoline.
vec4 organicBSplineWeights(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  return vec4(x, y, z, 6.0 - x - y - z) / 6.0;
}

vec4 organicSampleSmooth(highp sampler2D field, vec2 uv) {
  vec2 resolution = vec2(textureSize(field, 0));
  vec2 inverse = 1.0 / resolution;
  vec2 texel = uv * resolution - 0.5;
  vec2 f = fract(texel);
  texel -= f;
  vec4 xw = organicBSplineWeights(f.x);
  vec4 yw = organicBSplineWeights(f.y);
  vec4 corner = texel.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xw.xz + xw.yw, yw.xz + yw.yw);
  vec4 offset = (corner + vec4(xw.yw, yw.yw) / s) * inverse.xxyy;
  vec4 s0 = texture(field, offset.xz);
  vec4 s1 = texture(field, offset.yz);
  vec4 s2 = texture(field, offset.xw);
  vec4 s3 = texture(field, offset.yw);
  float sx = s.x / (s.x + s.y);
  float sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}

vec4 organicSignalAt(vec2 uv) {
  return mix(organicSampleSmooth(uInterestFrom, uv), organicSampleSmooth(uInterestTo, uv), uInterestTransition);
}

// Static geographic warp (≤ ~140 km at planet scale, less when zoomed in)
// lets broad swell flanks meander like terrain instead of evenly spaced
// rings. It is fixed in time, so it never relocates an event, and its
// intensity is gated by the unwarped support so relief cannot leave (or
// widen) measured support. Confidence, momentum and support stay local.
const float ORGANIC_WARP_RADIANS = 0.022;
vec4 organicSignal(vec3 n) {
  n = normalize(n);
  vec4 local = organicSignalAt(organicUv(n));
  if (uOrganicWarp <= 0.0001 || local.a <= 0.0) return local;
  vec3 w = vec3(
    snoise(n * 2.3 + vec3(1.7, 9.2, 3.3)),
    snoise(n * 2.3 + vec3(8.1, 2.6, 7.4)),
    snoise(n * 2.3 + vec3(5.5, 4.4, 0.9))
  );
  w -= n * dot(w, n);
  vec3 warped = normalize(n + w * ORGANIC_WARP_RADIANS * uOrganicWarp);
  // Near the support edge fall back to the unwarped intensity, which already
  // tapers smoothly to zero: no cliff, and nothing outside measured support.
  float intensity = mix(local.r, min(organicSignalAt(organicUv(warped)).r, 1.0), smoothstep(0.08, 0.45, local.a));
  intensity *= step(0.000001, local.a);
  return vec4(intensity, local.gba);
}

// Bounded, monotonic macro swell. Intensity is already kernel-weighted by
// anchor support, so zero intensity is exactly zero relief.
float organicMacro(float field) {
  return ORGANIC_MACRO_DMAX * (1.0 - exp(-ORGANIC_MACRO_SATURATION * field))
    / (1.0 - exp(-ORGANIC_MACRO_SATURATION));
}

// microWeight 0 excludes fine ripples: they shade the surface through its
// normals, but would otherwise trace hundreds of tiny contour loops.
float organicRelief(vec3 n, vec4 signal, float microWeight) {
  float support = clamp(signal.a, 0.0, 1.0);
  float field = clamp(signal.r, 0.0, 1.0);
  float momentum = abs(clamp(signal.g, -1.0, 1.0));
  float macroRelief = uMacroAmount * organicMacro(field);
  float detailSupport = smoothstep(0.01, 0.08, support);
  float mesoRelief = 0.0;
  float microRelief = 0.0;

  if ((uMesoAmount > 0.0001 || uMicroAmount > 0.0001) && detailSupport > 0.0001) {
    // Slow 3D advection morphs the folds without moving data-defined centers.
    // Slow enough that dense contours breathe (≈20–40 s) instead of boiling.
    vec3 drift = vec3(uOrganicTime * 0.0062, uOrganicTime * -0.0047, uOrganicTime * 0.0071);
    vec3 warp = vec3(
      snoise(n * 1.7 + drift),
      snoise(n * 1.7 + drift + vec3(13.1, 5.2, 2.4)),
      snoise(n * 1.7 + drift + vec3(3.7, 17.4, 9.6))
    );
    vec3 q = normalize(n + warp * 0.12);
    if (uMesoAmount > 0.0001) {
      // Domain-warped noise gives islands and saddles; two low detuned folds
      // add a faint directional grain. Both are scaled by observed intensity,
      // so meso relief cannot exist (or widen) outside measured support.
      float islands = snoise(q * 2.9 + drift * 1.6);
      vec3 foldDirectionA = normalize(vec3(0.42, 0.79, -0.45));
      vec3 foldDirectionB = normalize(vec3(-0.68, 0.24, 0.69));
      float foldA = dot(q, foldDirectionA) * 9.0 + uOrganicTime * 0.013;
      float foldB = dot(q, foldDirectionB) * 13.0 - uOrganicTime * 0.009;
      float islandsFine = snoise(q * 6.3 - drift * 2.2);
      float meso = 0.58 * islands + 0.22 * islandsFine + 0.20 * 0.5 * (sin(foldA) + sin(foldB));
      mesoRelief = ORGANIC_MESO_AMPLITUDE * uMesoAmount * field * detailSupport * meso;
    }
    if (uMicroAmount * microWeight > 0.0001) {
      // Two detuned interference fields. Signed momentum shifts phase within a
      // bounded range; it never multiplies the clock.
      float waveWarp = snoise(q * 3.7 + drift * 2.4);
      vec3 waveDirectionA = normalize(vec3(0.79, 0.38, -0.48));
      vec3 waveDirectionB = normalize(vec3(-0.31, 0.81, 0.50));
      float phaseA = dot(q, waveDirectionA) * 32.0 + waveWarp * 2.1
        + uOrganicTime * 0.62 + signal.g * 2.0 * sin(uOrganicTime * 0.18);
      float phaseB = dot(q, waveDirectionB) * 43.0 - waveWarp * 1.8
        + uOrganicTime * 0.47 + signal.g * 1.5 * sin(uOrganicTime * 0.13 + 1.0);
      float micro = 0.5 * (sin(phaseA) + sin(phaseB));
      microRelief = ORGANIC_MICRO_AMPLITUDE * uMicroAmount * microWeight * field * detailSupport * (0.75 + 0.25 * momentum) * micro;
    }
  }
  return uOrganicReveal * max(0.0, macroRelief + mesoRelief + microRelief);
}

float organicRelief(vec3 n, vec4 signal) {
  return organicRelief(n, signal, 1.0);
}

float organicRelief(vec3 n) {
  return organicRelief(n, organicSignal(n), 1.0);
}

float organicRadius(vec3 n) {
  return ORGANIC_STANDOFF + uVisualExaggeration * organicRelief(normalize(n));
}
`

const organicVertexFunctions = /* glsl */ `
varying vec3 vOrganicDirection;

// Forward differences sharing the centre sample: three relief evaluations
// per vertex (centre, east, north) instead of five plus a sixth for the
// displacement itself. The half-step bias is far below the mesh spacing.
vec3 organicNormal(vec3 n, float centreRadius) {
  n = normalize(n);
  vec3 reference = abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tangent = normalize(cross(reference, n));
  vec3 bitangent = normalize(cross(n, tangent));
  // About one 512×256 texel from the sample.
  const float stepAngle = 0.0123;
  vec3 nU = normalize(n + tangent * stepAngle);
  vec3 nV = normalize(n + bitangent * stepAngle);
  vec3 centre = n * centreRadius;
  vec3 dU = nU * organicRadius(nU) - centre;
  vec3 dV = nV * organicRadius(nV) - centre;
  vec3 result = normalize(cross(dU, dV));
  return dot(result, n) < 0.0 ? -result : result;
}
`

const organicFragmentFunctions = /* glsl */ `
varying vec3 vOrganicDirection;

// Anti-aliased isoline of a continuous level coordinate, width in pixels.
// When lines crowd below ~2px they fade to their average coverage instead of
// aliasing into moiré (B. Golus, "pristine grid").
// The derivative is passed in, not taken here: v is divided by a per-pixel
// LOD interval, and differentiating across an interval change would read
// the jump as a steep gradient and stipple the line.
float organicIsoline(float v, float dv, float widthPx) {
  float d = max(dv, 1e-6);
  float px = abs(fract(v - 0.5) - 0.5) / d;
  float line = 1.0 - smoothstep(widthPx * 0.5 - 0.5, widthPx * 0.5 + 0.5, px);
  return mix(line, clamp(widthPx * d, 0.0, 1.0), clamp(d * 2.0 - 1.0, 0.0, 1.0));
}

// Narrow periodic pulse with a smooth (cosine) profile; never a sawtooth.
float organicPulse(float phase, float sharpness) {
  return pow(0.5 + 0.5 * cos(6.28318530718 * phase), sharpness);
}
`

export type OrganicShaderUniforms = {
  uInterestFrom: { value: unknown }
  uInterestTo: { value: unknown }
  uInterestTransition: { value: number }
  uOrganicTime: { value: number }
  uVisualExaggeration: { value: number }
  uMacroAmount: { value: number }
  uMesoAmount: { value: number }
  uMicroAmount: { value: number }
  uOrganicGlass: { value: number }
  /** 0→1 entrance scale on relief; 1 whenever motion is reduced or fixed. */
  uOrganicReveal: { value: number }
  /** Self-luminance of contour strokes. 0 is the no-glow geometry proof. */
  uOrganicLineGlow: { value: number }
  /** 0–1 scale on the static, support-gated geographic meander. */
  uOrganicWarp: { value: number }
}

export type OrganicShaderProgram = {
  uniforms: Record<string, { value: unknown }>
  vertexShader: string
  fragmentShader: string
}

function injectAfter(source: string, marker: string, code: string): string {
  if (!source.includes(marker)) throw new Error(`Organic membrane shader chunk not found: ${marker}`)
  return source.replace(marker, `${marker}\n${code}`)
}

const contourFragment = /* glsl */ `
  // ---- Contour field, evaluated per pixel from the same relief function ----
  vec3 oDir = normalize(vOrganicDirection);
  vec2 oUv = organicUv(oDir);
  vec4 oFrom = texture(uInterestFrom, oUv);
  vec4 oTo = texture(uInterestTo, oUv);
  vec4 oSignal = organicSignal(oDir);
  float oSupport = smoothstep(0.01, 0.10, clamp(oSignal.a, 0.0, 1.0));
  float oIntensity = clamp(oSignal.r, 0.0, 1.0);
  float oMomentum = clamp(oSignal.g, -1.0, 1.0);
  float oConfidence = mix(0.62, 1.0, clamp(oSignal.b, 0.0, 1.0));
  float oRelief = uVisualExaggeration * organicRelief(oDir, oSignal, 0.0);
  // Contour spacing is fixed in relief units (not per-swell), so line density
  // reads as slope and count reads as height across the whole globe.
  float oHeight = oRelief / (ORGANIC_MACRO_DMAX * uVisualExaggeration);
  float oLevel = oHeight * ${glslFloat(ORGANIC_CONTOUR_LEVELS)};

  // Pixel-density LOD: power-of-two intervals nest, so crossfading only
  // retires odd lines and nothing pops. Index contours every fifth interval.
  float oLevelDerivative = max(fwidth(oLevel), 1e-5);
  // Negative LOD subdivides the interval when zoomed in (same relief, finer
  // cartographic interval), keeping on-screen line density consistent.
  float oLod = max(log2(oLevelDerivative * 5.0), -1.0);
  float oLodBase = exp2(floor(oLod));
  float oLodBlend = smoothstep(0.0, 1.0, fract(oLod));
  float oDv = oLevelDerivative / oLodBase;
  float oMinor = mix(organicIsoline(oLevel / oLodBase, oDv, 0.9), organicIsoline(oLevel / (2.0 * oLodBase), oDv * 0.5, 0.9), oLodBlend);
  float oIndex = mix(organicIsoline(oLevel / (5.0 * oLodBase), oDv * 0.2, 1.3), organicIsoline(oLevel / (10.0 * oLodBase), oDv * 0.1, 1.3), oLodBlend);
  float oHalo = mix(organicIsoline(oLevel / (5.0 * oLodBase), oDv * 0.2, 6.0), organicIsoline(oLevel / (10.0 * oLodBase), oDv * 0.1, 6.0), oLodBlend);
  // The zero level is the unobserved sphere; do not outline the whole globe.
  // Skip the near-flat outer skirt, where an isoline of an almost level
  // surface breaks into dots; also fade where the level field is too flat
  // for its line to be stable (< ~1/40 level per pixel).
  float oLineGate = smoothstep(0.5, 1.2, oLevel) * oSupport;
  float oGrazing = smoothstep(0.04, 0.28, abs(dot(normalize(normal), normalize(vViewPosition))));
  oLineGate *= oGrazing;
  oMinor *= oLineGate;
  oIndex *= oLineGate;
  oHalo *= oLineGate;

  // ---- Form and view ----
  vec3 oNormal = normalize(normal);
  vec3 oView = normalize(vViewPosition);
  float oFacing = clamp(abs(dot(oNormal, oView)), 0.0, 1.0);
  float oFresnel = pow(1.0 - oFacing, 3.0);
  vec3 oKeyLight = normalize((viewMatrix * vec4(-3.0, 4.0, 1.0, 0.0)).xyz);
  float oLambert = max(dot(oNormal, oKeyLight), 0.0);
  float oTerminator = smoothstep(-0.15, 0.55, dot(normalize(vOrganicRadialNormal), oKeyLight));

  // ---- Presentation motion (material phase only; frozen with reduced motion) ----
  // Level-phase pulses travel down-slope (outward) where observed momentum is
  // rising and up-slope (inward) where it is falling. They brighten existing
  // strokes only: no relief, location or support is created.
  float oOutward = smoothstep(-0.14, 0.0, oMomentum);
  float oPulseOut = organicPulse(oHeight * 1.7 + uOrganicTime / 9.0, 9.0);
  float oPulseIn = organicPulse(oHeight * 1.7 - uOrganicTime / 9.0, 9.0);
  float oPulse = mix(oPulseIn, oPulseOut, oOutward) * smoothstep(0.05, 0.45, oIntensity);
  // Two detuned travelling interference terms: a soft shimmer along strokes.
  float oShimmer = 0.86 + 0.14 * (sin(dot(oDir, vec3(9.1, 4.3, -6.7)) + uOrganicTime * 0.31)
    + sin(dot(oDir, vec3(-5.2, 8.8, 3.9)) - uOrganicTime * 0.23));

  // A validated snapshot update is a meaningful event, distinct from phase:
  // strokes where intensity actually changed flare while the field morphs.
  float oChange = smoothstep(0.01, 0.10, abs(oTo.r - oFrom.r)) * sin(3.14159265 * clamp(uInterestTransition, 0.0, 1.0));

  // ---- Color: teal low ground → cyan swell → pale crest, violet at the limb
  // and where observed momentum is falling. Linear-light tokens. ----
  vec3 oTeal = vec3(0.030, 0.520, 0.440);
  vec3 oCyan = vec3(0.090, 0.640, 0.860);
  vec3 oCrest = vec3(0.560, 0.900, 0.980);
  vec3 oViolet = vec3(0.330, 0.250, 0.820);
  // Slow spatial hue field: occasional violet passages, fixed to geography.
  float oHueField = smoothstep(0.35, 0.95, sin(dot(oDir, vec3(1.9, 1.2, -1.6)) * 1.7 + 1.3 * sin(dot(oDir, vec3(-1.1, 2.2, 0.9)) * 1.9)));
  vec3 oLineColor = mix(oTeal, oCyan, smoothstep(0.08, 0.7, oHeight));
  oLineColor = mix(oLineColor, oCrest, 0.45 * smoothstep(0.7, 1.05, oHeight) * oIndex);
  oLineColor = mix(oLineColor, oViolet, clamp(0.55 * oHueField + 0.65 * oFresnel + 0.45 * smoothstep(0.0, -0.45, oMomentum), 0.0, 0.85));
  oLineColor = mix(oLineColor, oCrest, 0.55 * oChange);

  float oLight = mix(0.30, 1.0, oTerminator) * (0.70 + 0.45 * oLambert);
  float oStroke = (0.55 * oMinor + 0.85 * oIndex) * oConfidence;
  float oGlowStroke = oStroke * oShimmer * (1.0 + 1.35 * oPulse + 1.1 * oChange);
  float oHaloStrength = oHalo * (0.10 + 0.22 * oPulse + 0.35 * oChange) * oConfidence;

  // Dark glass body between strokes: faint hypsometric tint gives swells
  // volume; the rim is restrained so the linework stays primary.
  vec3 oFill = vec3(0.004, 0.014, 0.024) + oTeal * (0.035 * oHeight + 0.05 * oFresnel) * oSupport;
  float oFillAlpha = 0.035 + (0.10 * clamp(oHeight, 0.0, 1.0) + 0.12 * oFresnel) * oSupport;

  float oStrokeAlpha = clamp(oStroke * (0.78 + 0.22 * oPulse) + oHaloStrength, 0.0, 1.0);
  float oAlpha = oFillAlpha + (1.0 - oFillAlpha) * oStrokeAlpha;
  diffuseColor.rgb = mix(diffuseColor.rgb, oFill, uOrganicGlass);
  float organicSpecCoverage = oSupport * oConfidence * mix(0.18, 1.0, clamp(oStroke, 0.0, 1.0));
`

export function patchOrganicShader(shader: OrganicShaderProgram, uniforms: OrganicShaderUniforms): void {
  Object.assign(shader.uniforms, uniforms)
  shader.vertexShader = injectAfter(shader.vertexShader, '#include <common>', `${simplexNoise3D}\n${organicFieldFunctions}\n${organicVertexFunctions}\nvarying vec3 vOrganicRadialNormal;`)
  shader.vertexShader = injectAfter(shader.vertexShader, '#include <beginnormal_vertex>', /* glsl */ `
    vec3 organicN = normalize(position);
    float organicDisplacement = organicRelief(organicN);
    objectNormal = organicNormal(organicN, ORGANIC_STANDOFF + uVisualExaggeration * organicDisplacement);
  `)
  shader.vertexShader = injectAfter(shader.vertexShader, '#include <begin_vertex>', /* glsl */ `
    vec3 organicDirection = organicN;
    vOrganicDirection = organicDirection;
    vOrganicRadialNormal = normalize(normalMatrix * organicDirection);
    transformed = organicDirection * (ORGANIC_STANDOFF + uVisualExaggeration * organicDisplacement);
  `)
  shader.fragmentShader = injectAfter(shader.fragmentShader, '#include <common>', `${simplexNoise3D}\n${organicFieldFunctions}\n${organicFragmentFunctions}\nvarying vec3 vOrganicRadialNormal;`)
  shader.fragmentShader = injectAfter(shader.fragmentShader, '#include <normal_fragment_maps>', contourFragment)
  shader.fragmentShader = injectAfter(shader.fragmentShader, 'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;', /* glsl */ `
    vec3 organicSpecularTint = mix(vec3(0.92, 0.98, 1.00), vec3(0.82, 0.74, 1.04), oFresnel);
    vec3 organicBody = totalDiffuse + 0.5 * totalSpecular * organicSpecularTint * organicSpecCoverage;
    // Strokes: lit by the key light (form) plus optional self-luminance.
    vec3 organicStrokeLight = oLineColor * oLight * (0.26 + 0.62 * uOrganicLineGlow) * oGlowStroke
      + oLineColor * oHaloStrength * 1.2 * uOrganicLineGlow;
    // Premultiplied composite of body and strokes, divided back for blending.
    vec3 organicColor = (organicBody * oFillAlpha + organicStrokeLight) / max(oAlpha, 0.001);
    outgoingLight = mix(outgoingLight, organicColor, uOrganicGlass);
    diffuseColor.a = mix(diffuseColor.a, oAlpha, uOrganicGlass);
  `)
}

function hashSource(source: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export const ORGANIC_SHADER_CACHE_KEY = hashSource(`${simplexNoise3D}\n${organicFieldFunctions}\n${organicVertexFunctions}\n${organicFragmentFunctions}\n${contourFragment}\norganic-contours-v14`)
