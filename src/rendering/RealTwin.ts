import * as THREE from "three";
import type { ReactiveParams } from "../audio/AudioReactiveController";

/** Loads the REAL San Francisco digital twin tiles exported from the Blender pipeline (src/web/export_hd.py, export_city.py).
 *  Pilot district: Blender LOD1 (buildings, facade details, 1 m terrain lattice, roads). Surroundings: LOD0 context tiles. */

const VERT = /* glsl */ `
attribute float kind; varying float vKind; varying vec3 vWorld; varying vec3 vCol;
void main() {
  vKind = kind; vCol = color;
  vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FRAG = /* glsl */ `
uniform float uTime, uGlow, uWave, uNeon, uPulse, uHue, uNight, uReactive, uFogDensity, uFlat;
uniform vec3 uFogColor; uniform vec3 uSunDir;
varying float vKind; varying vec3 vWorld; varying vec3 vCol;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 hsv(float h, float s, float v){ vec3 k = clamp(abs(mod(h*6.0+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.); return v*mix(vec3(1.),k,s); }
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (!gl_FrontFacing) n = -n;
  vec3 base = pow(vCol, vec3(2.2));
  float diff = 0.28 + 0.72 * max(dot(n, uSunDir), 0.0);
  vec3 col = base * diff * mix(1.0, 0.30, uNight);
  bool wallKind = vKind > 0.5 && vKind < 2.5;
  if (wallKind && abs(n.y) < 0.5) {
    float u = vWorld.x * abs(n.z) + vWorld.z * abs(n.x);
    vec2 g = vec2(u / 2.8, vWorld.y / 3.3);
    vec2 cell = floor(g), f = fract(g);
    float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.30, f.y) * step(f.y, 0.85);
    float h = hash(cell + floor(vWorld.x * 0.013) * 7.0);
    float lit = step(0.40, h);
    float wave = 0.5 + 0.5 * sin(vWorld.y * 0.12 - uTime * 3.0 + h * 6.28);
    float level = lit * (0.25 + uGlow * 1.1 + uWave * wave * 1.4 * uReactive) + uPulse * 0.8 * step(0.82, h);
    vec3 pal = hsv(fract(uHue + h * 0.16), 0.5, 1.0);
    vec3 glass = (vKind > 1.5 ? vec3(0.04, 0.06, 0.10) : base * 0.2);
    vec3 lights = pal * level * (0.5 + uNight * 2.4);
    col = mix(col, glass * diff + lights, win);
  }
  float d = length(vWorld - cameraPosition);
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
  gl_FragColor = vec4(mix(col, uFogColor, clamp(fog, 0.0, 1.0)), 1.0);
}`;

export interface TileRec { id: string; group: THREE.Group; centre: THREE.Vector3; details?: THREE.Mesh; hd: boolean; tris: number }

export class RealTwin {
  readonly group = new THREE.Group();
  readonly tiles: TileRec[] = [];
  centre = new THREE.Vector3();
  totalTris = 0;
  detailRadius = 500;
  private mat: THREE.ShaderMaterial;
  private disposables: { dispose(): void }[] = [];

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, vertexColors: true, side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 }, uGlow: { value: 0 }, uWave: { value: 0 }, uNeon: { value: 0 }, uPulse: { value: 0 }, uHue: { value: 0.55 },
        uNight: { value: 0.5 }, uReactive: { value: 1 }, uFogDensity: { value: 0.0004 }, uFlat: { value: 0 },
        uFogColor: { value: new THREE.Color(0x0b1020) }, uSunDir: { value: new THREE.Vector3(-0.4, 0.7, 0.5).normalize() },
      },
    });
    this.disposables.push(this.mat);
  }

  private async fetchGz(url: string): Promise<ArrayBuffer> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return new Response(r.body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  }

  private build(id: string, c: number[], buf: ArrayBuffer, hd: boolean): TileRec {
    const hl = new DataView(buf).getUint32(0, true);
    const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)).replace(/\0+$/, ""));
    const base = 4 + hl, q: number = head.q ?? 0.05;
    const g = new THREE.Group(); g.position.set(c[0], c[1], c[2]);
    const rec: TileRec = { id, group: g, centre: new THREE.Vector3(c[0], c[1], c[2]), hd, tris: 0 };
    for (const L of head.layers) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Int16Array(buf, base + L.pos, L.nv * 3), 3));
      geo.setAttribute("color", new THREE.BufferAttribute(new Uint8Array(buf, base + L.col, L.nv * 3), 3, true));
      geo.setAttribute("kind", new THREE.BufferAttribute(new Uint8Array(buf, base + L.kind, L.nv), 1));
      geo.setIndex(new THREE.BufferAttribute(L.idx === "u16" ? new Uint16Array(buf, base + L.ind, L.ni) : new Uint32Array(buf, base + L.ind, L.ni), 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 40 / q, 0), 700 / q);  // geometry units are 1/q metres
      const mesh = new THREE.Mesh(geo, this.mat); mesh.scale.setScalar(q); mesh.matrixAutoUpdate = true;
      mesh.userData.layer = L.name; g.add(mesh); this.disposables.push(geo);
      rec.tris += L.ni / 3;
      if (L.name === "details") rec.details = mesh;
    }
    this.group.add(g); return rec;
  }

  /** Loads tiles with limited concurrency. onProgress(loaded,total). */
  async load(baseUrl: string, onProgress: (n: number, total: number, msg: string) => void): Promise<void> {
    const hdMan = await (await fetch(`${baseUrl}/hd/manifest.json`)).json();
    const loMan = await (await fetch(`${baseUrl}/lod0/manifest.json`)).json();
    const jobs: { id: string; c: number[]; url: string; hd: boolean }[] = [
      ...hdMan.tiles.map((t: { id: string; c: number[] }) => ({ id: t.id, c: t.c, url: `${baseUrl}/hd/${t.id}.bin.gz`, hd: true })),
      ...loMan.tiles.map((t: { id: string; c: number[] }) => ({ id: t.id, c: t.c, url: `${baseUrl}/lod0/${t.id}.bin.gz`, hd: false })),
    ];
    this.centre.set(loMan.center[0], 0, loMan.center[1]);
    let done = 0, next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const j = jobs[next++];
        const rec = this.build(j.id, j.c, await this.fetchGz(j.url), j.hd);
        this.tiles.push(rec); this.totalTris += rec.tris; onProgress(++done, jobs.length, `${j.hd ? "HD" : "LOD0"} ${j.id}`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  /** Per frame: hide the (very heavy) facade-detail layer for tiles far from the camera. */
  cull(cam: THREE.Vector3): number {
    let vis = 0;
    for (const t of this.tiles) if (t.details) { const on = t.centre.distanceTo(cam) < this.detailRadius + 350; t.details.visible = on; if (on) vis++; }
    return vis;
  }

  update(p: ReactiveParams, time: number, night: number, reactive: number, fogColor: THREE.Color, fogDensity: number): void {
    const u = this.mat.uniforms;
    u.uTime.value = time; u.uGlow.value = p.glow; u.uWave.value = p.facadeWave; u.uNeon.value = p.neon; u.uPulse.value = p.pulse;
    u.uHue.value = 0.55 + 0.4 * p.hue; u.uNight.value = night; u.uReactive.value = reactive; u.uFogDensity.value = fogDensity;
    (u.uFogColor.value as THREE.Color).copy(fogColor);
  }

  dispose(): void { this.disposables.forEach((d) => d.dispose()); }
}
