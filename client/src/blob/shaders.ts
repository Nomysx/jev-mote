// The blob's custom shader: a clay-like sphere deformed by layered 3D noise.
// Every visual parameter is a uniform, eased on the CPU (never snapped).

// Ashima Arts / Stefan Gustavson 3D simplex noise (MIT).
const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
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
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
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
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

export const vertexShader = /* glsl */ `
uniform float uPhase;      // accumulated movement phase (speed is integrated on the CPU)
uniform float uAmp;
uniform float uLump;
uniform float uSpikes;
uniform float uDroop;
uniform float uRound;
uniform float uInward;
uniform float uWobble;
uniform float uLean;
uniform float uAvoid;
uniform float uSeed;
uniform vec3 uCursorDir;

varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vObj;
varying float vDisp;

${NOISE}

float displacement(vec3 p) {
  float t = uPhase;
  vec3 s = vec3(uSeed);
  float n1 = snoise(p * 1.1 + s + vec3(0.0, t * 0.35, t * 0.2));
  float n2 = snoise(p * 2.4 + s.zxy + vec3(t * 0.5, 0.0, -t * 0.3)) * 0.45;
  float lumps = (n1 + n2) * uLump * (1.0 - 0.7 * uRound) * 0.24;
  float motion = snoise(p * 0.9 + vec3(t * 0.8) + s.yzx) * uAmp * 0.14;
  // Anger: sharp spikes, cone-like peaks at the noise maxima.
  float sn = snoise(p * 4.6 + vec3(t * 0.4) + s);
  float spikes = pow(max(0.0, sn - 0.3) / 0.7, 1.35) * uSpikes * 0.55;
  // Disgust: pulls inward in pockets.
  float pocket = -smoothstep(0.05, 0.6, snoise(p * 1.8 - vec3(t * 0.15))) * uInward * 0.24 - uInward * 0.05;
  // Mixed feelings: fast, jelly-like wobble.
  float wob = snoise(p * 0.75 + vec3(t * 2.4)) * uWobble * 0.14;
  // Cursor: curiosity bulges toward it, fear flattens away from it.
  float facing = dot(p, uCursorDir);
  float cursor = smoothstep(0.0, 1.0, facing) * uLean * 0.2 - smoothstep(0.0, 1.0, facing) * uAvoid * 0.14;
  return lumps + motion + spikes + pocket + wob + cursor;
}

vec3 deform(vec3 unitP) {
  float d = displacement(unitP);
  vec3 p = unitP * (1.0 + d);
  // Sadness: droops. The bottom sags and widens, the top flattens a little.
  float below = smoothstep(0.3, -1.0, unitP.y);
  p.xz *= 1.0 + uDroop * 0.14 * below;
  p.y -= uDroop * (0.16 * below + 0.1 * smoothstep(0.2, 1.0, unitP.y));
  return p;
}

void main() {
  vec3 n = normalize(position);
  vec3 helper = abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tangent = normalize(cross(n, helper));
  vec3 bitangent = normalize(cross(n, tangent));
  float eps = 0.012;
  vec3 p0 = deform(n);
  vec3 p1 = deform(normalize(n + tangent * eps));
  vec3 p2 = deform(normalize(n + bitangent * eps));
  vec3 dn = normalize(cross(p1 - p0, p2 - p0));
  if (dot(dn, n) < 0.0) dn = -dn;

  vObj = n;
  vDisp = length(p0) - 1.0;
  vec4 mv = modelViewMatrix * vec4(p0, 1.0);
  vViewPos = mv.xyz;
  vNormalV = normalize(normalMatrix * dn);
  gl_Position = projectionMatrix * mv;
}
`;

export const fragmentShader = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uLightTint;
uniform float uSplit;
uniform float uHaze;
uniform float uBright;
uniform float uGrey;
uniform float uDim;
uniform float uListen;
uniform float uPulse;
uniform float uTime;
uniform float uOpacity;
uniform float uSeed;

varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vObj;
varying float vDisp;

${NOISE}

void main() {
  vec3 N = normalize(vNormalV);
  vec3 V = normalize(-vViewPos);

  // Two color zones for mixed emotions.
  float zn = snoise(vObj * 1.2 + vec3(uSeed) + vec3(0.0, uTime * 0.04, 0.0)) + vObj.y * 0.7;
  float zone = smoothstep(-0.18, 0.18, zn);
  vec3 base = mix(uColorA, mix(uColorA, uColorB, zone), uSplit);

  // Clay lighting: wrapped diffuse, soft fill, gentle specular, rim, and a hint of subsurface glow.
  vec3 L = normalize(vec3(0.45, 0.8, 0.55));
  float wrap = 0.5;
  float diff = clamp((dot(N, L) + wrap) / (1.0 + wrap), 0.0, 1.0);
  vec3 L2 = normalize(vec3(-0.7, -0.3, 0.4));
  float fill = (dot(N, L2) * 0.5 + 0.5) * 0.22;
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 24.0) * 0.16;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.2);
  float cavity = smoothstep(-0.12, 0.12, vDisp) * 0.18 + 0.82;

  vec3 col = base * uLightTint * (0.32 + 0.78 * diff + fill) * cavity;
  col += spec * vec3(1.0, 0.97, 0.92);
  col += fres * mix(base, vec3(1.0), 0.45) * 0.32;
  col += base * (1.0 - diff) * 0.08; // subsurface-ish
  col *= 0.975 + 0.025 * snoise(vObj * 38.0); // clay grain

  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lum), clamp(uGrey + uDim * 0.6, 0.0, 1.0));
  col *= uBright;

  // Listening shimmer: soft bands drifting over the surface.
  float band = sin(vObj.y * 13.0 - uTime * 3.2 + snoise(vObj * 2.0 + uTime * 0.2) * 2.5) * 0.5 + 0.5;
  col += uListen * band * (0.22 * fres + 0.05);

  col += uPulse * (0.18 + 0.4 * fres);
  col *= mix(1.0, 0.38, uDim);

  // Low confidence: hazy, semi-transparent, with fuzzy edges.
  float speckle = snoise(vObj * 9.0 + vec3(uTime * 0.6)) * 0.5 + 0.5;
  float alpha = mix(1.0, 0.62 - 0.45 * fres - 0.12 * speckle, uHaze) * uOpacity;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`;

export const mistVertexShader = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
uniform float uPixelRatio;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelRatio * (6.0 / -mv.z);
  vAlpha = aAlpha;
}
`;

export const mistFragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(uColor, a * a * vAlpha * uOpacity);
}
`;
