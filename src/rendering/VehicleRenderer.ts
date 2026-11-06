import * as THREE from "three";
import type { TrafficSimulator } from "../traffic/TrafficSimulator";

/** Draws simulated vehicles as instanced boxes with headlamps and brake lights (tail colour follows braking). */
export class VehicleRenderer {
  readonly group = new THREE.Group();
  private body: THREE.InstancedMesh; private head: THREE.InstancedMesh; private tail: THREE.InstancedMesh;
  private geo = new THREE.BoxGeometry(1, 1, 1); private lamp = new THREE.BoxGeometry(0.25, 0.3, 1);
  private mats: THREE.Material[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private c = new THREE.Color();
  private palette = [0xc9d2e8, 0x7a8aa8, 0xd24a4a, 0x2f6fd0, 0xe5c24a, 0x3a3f4d].map((h) => new THREE.Color(h));

  constructor(private sim: TrafficSimulator) {
    const n = sim.maxVehicles;
    const mk = (g: THREE.BufferGeometry, color: number, count: number) => { const mat = new THREE.MeshBasicMaterial({ color }); this.mats.push(mat); return new THREE.InstancedMesh(g, mat, count); };
    this.body = mk(this.geo, 0xffffff, n); this.head = mk(this.lamp, 0xfff2cc, n * 2); this.tail = mk(this.lamp, 0xffffff, n * 2);
    for (const mesh of [this.body, this.head, this.tail]) { mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; this.group.add(mesh); }
    sim.vehicles.forEach((v, i) => this.body.setColorAt(i, v.kind === "bus" ? this.palette[4] : this.palette[i % this.palette.length]));
    for (let i = 0; i < n * 2; i++) this.tail.setColorAt(i, this.c.set(0x551010));
  }

  update(): void {
    const s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    this.sim.vehicles.forEach((v, i) => {
      const h = v.kind === "bus" ? 3.2 : v.kind === "bike" ? 1.5 : 1.45;
      if (!v.active) { this.m.makeScale(0, 0, 0); this.body.setMatrixAt(i, this.m); for (let k = 0; k < 2; k++) { this.head.setMatrixAt(i * 2 + k, this.m); this.tail.setMatrixAt(i * 2 + k, this.m); } return; }
      this.q.setFromEuler(e.set(0, v.heading, 0));
      this.m.compose(p.set(v.x, h / 2 + 0.2, v.z), this.q, s.set(v.length, h, v.width)); this.body.setMatrixAt(i, this.m);
      const cos = Math.cos(v.heading), sin = Math.sin(v.heading);
      for (let k = 0; k < 2; k++) {
        const side = (k === 0 ? -1 : 1) * v.width * 0.35, hx = v.length / 2, lz = side;
        const at = (lx: number) => p.set(v.x + lx * cos + lz * sin, 0.2 + h * 0.4, v.z - lx * sin + lz * cos);
        this.m.compose(at(hx), this.q, one); this.head.setMatrixAt(i * 2 + k, this.m);
        this.m.compose(at(-hx), this.q, one); this.tail.setMatrixAt(i * 2 + k, this.m);
        this.tail.setColorAt(i * 2 + k, this.c.set(v.braking ? 0xff2a2a : 0x551010));
      }
    });
    for (const mesh of [this.body, this.head, this.tail]) mesh.instanceMatrix.needsUpdate = true;
    if (this.tail.instanceColor) this.tail.instanceColor.needsUpdate = true;
  }

  dispose(): void { this.geo.dispose(); this.lamp.dispose(); this.mats.forEach((m) => m.dispose()); this.body.dispose(); this.head.dispose(); this.tail.dispose(); }
}
