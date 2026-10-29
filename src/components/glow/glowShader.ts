// src/components/glow/glowShader.ts
// Apple-Intelligence-style edge glow shader (adapted from reacticx "Apple Intelligence", MIT).
// Differences from the original:
//   - NO screen snapshot / content warping: this outputs ONLY the glow (premultiplied alpha),
//     so your live screen (progress bars, animations) keeps running underneath it.
//   - The interior of the screen is skipped in the steady state, so it is cheap to run.
import { Skia } from '@shopify/react-native-skia';

const SHADER_SOURCE = `
uniform float  iTime;
uniform float  intensity;
uniform float2 iResolution;

uniform float  uMargin;
uniform float  uExcess;
uniform float  uRadius;
uniform float  uWaveSpeed;
uniform float2 uWaveOrigin;
uniform float  uNoiseScale;
uniform float  uNoiseSpeed;
uniform float  uNoiseStrength;
uniform float  uGlowSpeed;
uniform float  uShimmerAmount;
uniform float  uShimmerSpeed;

uniform float  uColorCount;
uniform float3 uColor0;
uniform float3 uColor1;
uniform float3 uColor2;
uniform float3 uColor3;
uniform float3 uColor4;
uniform float3 uColor5;
uniform float3 uColor6;
uniform float3 uColor7;

float3 hash33(float3 p3) {
  p3 = fract(p3 * float3(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yxz + 19.19);
  return -1.0 + 2.0 * fract(float3(p3.x + p3.y, p3.x + p3.z, p3.y + p3.z) * p3.zyx);
}

float snoise3(float3 p) {
  const float K1 = 0.333333333;
  const float K2 = 0.166666667;
  float3 i  = floor(p + (p.x + p.y + p.z) * K1);
  float3 d0 = p - (i - (i.x + i.y + i.z) * K2);
  float3 e  = step(float3(0.0), d0 - d0.yzx);
  float3 i1 = e * (1.0 - e.zxy);
  float3 i2 = 1.0 - e.zxy * (1.0 - e);
  float3 d1 = d0 - (i1 - K2);
  float3 d2 = d0 - (i2 - K1);
  float3 d3 = d0 - 0.5;
  float4 h = max(0.6 - float4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
  float4 n = h * h * h * h * float4(
    dot(d0, hash33(i)), dot(d1, hash33(i + i1)),
    dot(d2, hash33(i + i2)), dot(d3, hash33(i + 1.0)));
  return dot(float4(31.316), n);
}

float circle(float2 st, float2 center, float radius) {
  float2 dist = st - center;
  float dd = dot(dist, dist) * 4.0;
  // radius is 0 on the very first frame of the intro; smoothstep(0, 0, x) is undefined (NaN on some GPUs)
  float r = max(radius, 0.0001);
  return smoothstep(r - r * 0.5, r, dd);
}

float3 getColor(int idx) {
  if (idx == 0) return uColor0;
  if (idx == 1) return uColor1;
  if (idx == 2) return uColor2;
  if (idx == 3) return uColor3;
  if (idx == 4) return uColor4;
  if (idx == 5) return uColor5;
  if (idx == 6) return uColor6;
  return uColor7;
}

float3 sampleGradient(float t) {
  float ft = fract(t) * uColorCount;
  int i0 = int(floor(ft));
  int i1 = i0 + 1;
  if (float(i1) >= uColorCount) i1 = 0;
  float f = fract(ft);
  f = f * f * (3.0 - 2.0 * f);
  return mix(getColor(i0), getColor(i1), f);
}

half4 main(float2 fragCoord) {
  float2 uv = fragCoord / iResolution;
  float range = intensity;
  float2 margin = uMargin / iResolution;
  float2 excess = uExcess / iResolution;
  float2 radius = uRadius / iResolution;
  float2 pt     = abs(uv - 0.5);
  float2 corner = 0.5 - margin - radius - excess;
  float2 offset = max(pt - corner, 0.0);
  float dist    = length(offset / radius) - 1.0;

  // Steady state: the whole screen interior is transparent, skip the expensive noise there.
  float edgeStart = uMargin / uRadius;
  if (range > 0.98 && dist + 0.6 * uNoiseStrength < edgeStart) {
    return half4(0.0);
  }

  float2 st = uv;
  float  r  = uWaveSpeed * range;
  float  c1 = circle(st, uWaveOrigin, r);

  float vol   = 0.35 + 0.15 * sin(iTime * 2.0);
  float noise = max(0.0, snoise3(float3(uv * uNoiseScale, iTime / uNoiseSpeed)) * (vol * uNoiseStrength));
  float alpha = smoothstep(uMargin / uRadius, (uMargin + uExcess) / uRadius, dist + noise);

  float angle = atan(uv.y - 0.5, uv.x - 0.5);
  float t     = fract((angle / 6.2832) + iTime * uGlowSpeed);

  float3 glow    = sampleGradient(t);
  float shimmer  = 0.5 + 0.5 * sin(angle * 3.0 + iTime * uShimmerSpeed);
  glow = min(mix(glow, glow * 1.4, shimmer * uShimmerAmount), float3(1.0));

  float edge   = alpha * (1.0 - c1);
  float bgMask = 1.0 - (1.0 - edge) * (1.0 - (1.0 - c1) * (1.0 - range) * 0.5);

  float2 q      = abs(fragCoord - iResolution * 0.5) - iResolution * 0.5 + uRadius;
  float  boxSDF = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float  clip   = 1.0 - smoothstep(-1.0, 0.5, boxSDF);

  float a = clamp(bgMask * intensity * clip, 0.0, 1.0);
  return half4(half3(glow) * half(a), half(a));   // premultiplied: glow only, live screen shows through
}
`;

export const GLOW_EFFECT = Skia.RuntimeEffect.Make(SHADER_SOURCE);
if (!GLOW_EFFECT) {
  console.warn('[EdgeGlow] shader failed to compile - glow disabled');
}

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

// Colours of the Siri-style glow (max 8): purple, indigo, blue, cyan, deep red - no pink.
// They travel slowly around the screen edge.
export const GLOW_HEX = ['#A64DDB', '#7A4DFF', '#2D8CFF', '#12B5E5', '#7A4DFF', '#C0394F', '#A64DDB'];
const COLORS = GLOW_HEX.map(hex);
const pad = (i: number): [number, number, number] => COLORS[i] ?? [0, 0, 0];

// Tweak the look here.
export const GLOW_PARAMS = {
  uMargin: 6, // gap between the screen edge and the glow (dp)
  uExcess: 26, // how far the glow spreads inwards (dp)
  uRadius: 44, // corner radius of the glow (dp) - match your phone's screen corners
  uWaveSpeed: 10, // how fast the intro bloom spreads from the bottom
  uWaveOrigin: [0.5, 1.0] as [number, number], // where the intro starts: bottom centre
  uNoiseScale: 2.0,
  uNoiseSpeed: 4.0,
  uNoiseStrength: 0.6,
  uGlowSpeed: 0.15, // how fast the colours travel around the edge
  uShimmerAmount: 0.3,
  uShimmerSpeed: 2.5,
  uColorCount: COLORS.length,
  uColor0: pad(0),
  uColor1: pad(1),
  uColor2: pad(2),
  uColor3: pad(3),
  uColor4: pad(4),
  uColor5: pad(5),
  uColor6: pad(6),
  uColor7: pad(7),
};