import * as THREE from "three";
import type { CityLayout } from "../traffic/TrafficSimulator";
import type { ReactiveParams } from "../audio/AudioReactiveController";

/** Original procedural sample city (not San Francisco geometry): grid of roads, instanced audio-reactive towers, streetlights. */
export const SAMPLE_LAYOUT: CityLayout = { roadCoords: [-300, -200, -100, 0, 100, 200, 300], roadWidth: 16, extent: 360 };

const VERT = /* glsl */ `
uniform float uDeform;
attribute float aSeed;
varying vec3 vWorld; varying vec3 vNormalW; varying float vSeed; varying float vTop;
void main() {
  vec3 p = position;
  p.y *= 1.0 + uDeform * 0.05 * (0.4 + aSeed);   // bounded: at most +7% height
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = w.xyz; vSeed = aSeed; vTop = position.y;
  vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform float uTime, uGlow, uWave, uNeon, uPulse, uHue, uNight, uReactive;
uniform vec3 uFogColor; uniform float uFogDensity; uniform vec3 uSunDir;
varying vec3 vWorld; varying vec3 vNormalW; varying float vSeed; varying float vTop;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 hsv(float h, float s, float v){ vec3 k = clamp(abs(mod(h*6.0+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.); return v*mix(vec3(1.),k,s); }
void main() {
  vec3 n = normalize(vNormalW);
  float diff = 0.30 + 0.70 * max(dot(n, uSunDir), 0.0);
  vec3 wall = mix(vec3(0.10, 0.12, 0.17), vec3(0.20, 0.19, 0.20), vSeed) * diff * mix(1.0, 0.35, uNight);
  vec3 col = wall;
  if (abs(n.y) < 0.5) {
    float u = vWorld.x * abs(n.z) + vWorld.z * abs(n.x);
    vec2 cell = floor(vec2(u / 3.2, vWorld.y / 3.6));
    vec2 f = fract(vec2(u / 3.2, vWorld.y / 3.6));
    float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.22, f.y) * step(f.y, 0.78);
    float h = hash(cell + vSeed * 91.0);
    float lit = step(0.42, h);
    float wave = 0.5 + 0.5 * sin(vWorld.y * 0.18 - uTime * 3.0 + vSeed * 6.2831);     // mid-band facade pattern
    float level = lit * (0.25 + uGlow * 1.1 + uWave * wave * 1.4 * uReactive) + uPulse * 0.9 * step(0.8, h);
    vec3 pal = hsv(fract(uHue + h * 0.18), 0.55, 1.0);
    vec3 glass = mix(vec3(0.05, 0.08, 0.13), pal * level * (0.4 + uNight * 2.2), win * clamp(level, 0.0, 1.0) + 0.0);
    col = mix(col, glass + pal * level * win * (0.6 + 2.0 * uNight), win);
    // neon trim at roofline driven by treble
    float trim = smoothstep(0.985, 1.0, vTop) * (0.15 + uNeon * 2.5 * uReactive);
    col += hsv(fract(uHue + 0.5), 0.9, 1.0) * trim;
  }
  float d = length(vWorld - cameraPosition);
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
  gl_FragColor = vec4(mix(col, uFogColor, clamp(fog, 0.0, 1.0)), 1.0);
}`;

export interface SampleCity {
  group: THREE.Group;
  update(p: ReactiveParams, time: number, night: number, reactive: number, fogColor: THREE.Color, fogDensity: number): void;
  dispose(): void;
}

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function buildSampleCity(layout: CityLayout = SAMPLE_LAYOUT, seed = 11): SampleCity {
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  const rc = layout.roadCoords, half = layout.roadWidth / 2;
  const disposables: { dispose(): void }[] = [];

  // Ground + roads
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(layout.extent * 3, layout.extent * 3), new THREE.MeshBasicMaterial({ color: 0x0a0d14 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; group.add(ground);
  const roadMat = new THREE.MeshBasicMaterial({ color: 0x151a26 });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x5ad1ff });
  const roadGeo = new THREE.BoxGeometry(1, 0.1, 1);
  const roads = new THREE.InstancedMesh(roadGeo, roadMat, rc.length * 2);
  const lines = new THREE.InstancedMesh(roadGeo, lineMat, rc.length * 2);
  const m = new THREE.Matrix4();
  rc.forEach((c, i) => {
    m.compose(new THREE.Vector3(0, 0, c), new THREE.Quaternion(), new THREE.Vector3(layout.extent * 2, 1, layout.roadWidth)); roads.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(0, 0.08, c), new THREE.Quaternion(), new THREE.Vector3(layout.extent * 2, 1, 0.25)); lines.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(c, 0, 0), new THREE.Quaternion(), new THREE.Vector3(layout.roadWidth, 1, layout.extent * 2)); roads.setMatrixAt(rc.length + i, m);
    m.compose(new THREE.Vector3(c, 0.08, 0), new THREE.Quaternion(), new THREE.Vector3(0.25, 1, layout.extent * 2)); lines.setMatrixAt(rc.length + i, m);
  });
  group.add(roads, lines);
  disposables.push(roadGeo, roadMat, lineMat, ground.geometry, ground.material as THREE.Material);

  // Buildings: 2x2 lots per block
  const lots: { x: number; z: number; w: number; d: number; h: number; seed: number }[] = [];
  for (let i = 0; i + 1 < rc.length; i++) for (let j = 0; j + 1 < rc.length; j++) {
    const x0 = rc[i] + half + 3, x1 = rc[i + 1] - half - 3, z0 = rc[j] + half + 3, z1 = rc[j + 1] - half - 3;
    const cx = (rc[i] + rc[i + 1]) / 2, cz = (rc[j] + rc[j + 1]) / 2;
    const downtown = Math.exp(-(cx * cx + cz * cz) / (2 * 150 * 150));
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const w = (x1 - x0) / 2 - 2, d = (z1 - z0) / 2 - 2;
      lots.push({ x: x0 + (a + 0.5) * (x1 - x0) / 2, z: z0 + (b + 0.5) * (z1 - z0) / 2, w, d, h: 14 + rng() * 30 + downtown * (30 + rng() * 120), seed: rng() });
    }
  }
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const seeds = new Float32Array(lots.length);
  const bm: THREE.InstancedMesh = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial(), lots.length);
  lots.forEach((l, k) => { m.compose(new THREE.Vector3(l.x, 0, l.z), new THREE.Quaternion(), new THREE.Vector3(l.w, l.h, l.d)); bm.setMatrixAt(k, m); seeds[k] = l.seed; });
  box.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
  const bmat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 }, uGlow: { value: 0 }, uWave: { value: 0 }, uNeon: { value: 0 }, uPulse: { value: 0 }, uHue: { value: 0.5 },
      uNight: { value: 0.5 }, uReactive: { value: 1 }, uDeform: { value: 0 }, uFogColor: { value: new THREE.Color(0x0b1020) },
      uFogDensity: { value: 0.0012 }, uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
    },
  });
  (bm.material as THREE.Material).dispose(); bm.material = bmat; bm.frustumCulled = false;
  group.add(bm);
  disposables.push(box, bmat);

  // Streetlights (instanced poles + emissive heads)
  const spots: THREE.Vector3[] = [];
  for (const c of rc) for (let s = -layout.extent; s <= layout.extent; s += 30) for (const side of [-1, 1]) {
    spots.push(new THREE.Vector3(s, 0, c + side * (half + 0.5)), new THREE.Vector3(c + side * (half + 0.5), 0, s));
  }
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.15, 8, 5); poleGeo.translate(0, 4, 0);
  const poleMat = new THREE.MeshBasicMaterial({ color: 0x2a3042 });
  const headGeo = new THREE.SphereGeometry(0.5, 8, 6);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, spots.length);
  const heads = new THREE.InstancedMesh(headGeo, headMat, spots.length);
  spots.forEach((p, k) => { m.makeTranslation(p.x, 0, p.z); poles.setMatrixAt(k, m); m.makeTranslation(p.x, 8.3, p.z); heads.setMatrixAt(k, m); });
  group.add(poles, heads);
  disposables.push(poleGeo, poleMat, headGeo, headMat);
  const tmp = new THREE.Color();

  return {
    group,
    update(p, time, night, reactive, fogColor, fogDensity) {
      const u = bmat.uniforms;
      u.uTime.value = time; u.uGlow.value = p.glow; u.uWave.value = p.facadeWave; u.uNeon.value = p.neon; u.uPulse.value = p.pulse;
      u.uHue.value = 0.55 + 0.4 * p.hue; u.uNight.value = night; u.uReactive.value = reactive; u.uDeform.value = p.deform * reactive;
      (u.uFogColor.value as THREE.Color).copy(fogColor); u.uFogDensity.value = fogDensity;
      tmp.setHSL((0.1 + 0.5 * p.hue) % 1, 0.8, 0.45 + 0.2 * p.neon * reactive + 0.25 * p.pulse * reactive).multiplyScalar(0.25 + 1.6 * night);
      headMat.color.copy(tmp);
      lineMat.color.setHSL((0.55 + 0.3 * p.hue) % 1, 0.9, 0.25 + 0.3 * p.glow * reactive + 0.2 * p.pulse * reactive);
    },
    dispose() { disposables.forEach((d) => d.dispose()); bm.dispose(); roads.dispose(); lines.dispose(); poles.dispose(); heads.dispose(); },
  };
}
