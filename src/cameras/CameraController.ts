import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type CameraMode = "orbit" | "fly";
export interface Viewpoint { pos: [number, number, number]; target: [number, number, number] }

/** Orbit and WASD/drag fly modes, plus saved viewpoints (localStorage). */
export class CameraController {
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.5, 6000);
  readonly orbit: OrbitControls;
  mode: CameraMode = "orbit";
  flySpeed = 60;
  private keys = new Set<string>();
  private yaw = 0; private pitch = -0.3; private dragging = false;
  private cleanup: (() => void)[] = [];
  viewpoints: (Viewpoint | null)[] = [null, null, null, null];

  constructor(dom: HTMLElement) {
    this.camera.position.set(260, 190, 320);
    this.orbit = new OrbitControls(this.camera, dom);
    this.orbit.target.set(0, 30, 0); this.orbit.enableDamping = true; this.orbit.maxDistance = 1500; this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.update();
    try { const raw = localStorage.getItem("sfmdt.viewpoints"); if (raw) this.viewpoints = JSON.parse(raw); } catch { /* storage unavailable */ }
    const on = (el: HTMLElement | Window, ev: string, fn: (e: never) => void) => { el.addEventListener(ev, fn as EventListener); this.cleanup.push(() => el.removeEventListener(ev, fn as EventListener)); };
    on(window, "keydown", (e: KeyboardEvent) => { this.keys.add(e.code); });
    on(window, "keyup", (e: KeyboardEvent) => { this.keys.delete(e.code); });
    on(dom, "pointerdown", (e: PointerEvent) => { if (this.mode === "fly") { this.dragging = true; dom.setPointerCapture(e.pointerId); } });
    on(dom, "pointerup", () => { this.dragging = false; });
    on(dom, "pointermove", (e: PointerEvent) => { if (this.mode === "fly" && this.dragging) { this.yaw -= e.movementX * 0.003; this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * 0.003)); } });
  }

  setMode(m: CameraMode): void {
    if (m === this.mode) return;
    if (m === "fly") {
      const d = new THREE.Vector3(); this.camera.getWorldDirection(d);
      this.yaw = Math.atan2(-d.x, -d.z); this.pitch = Math.asin(d.y);
    } else {
      const d = new THREE.Vector3(); this.camera.getWorldDirection(d);
      this.orbit.target.copy(this.camera.position).addScaledVector(d, 150);
    }
    this.mode = m; this.orbit.enabled = m === "orbit";
  }

  saveViewpoint(i: number): void {
    this.viewpoints[i] = { pos: this.camera.position.toArray() as [number, number, number], target: (this.mode === "orbit" ? this.orbit.target : this.lookPoint()).toArray() as [number, number, number] };
    try { localStorage.setItem("sfmdt.viewpoints", JSON.stringify(this.viewpoints)); } catch { /* ignore */ }
  }
  gotoViewpoint(i: number): boolean {
    const v = this.viewpoints[i]; if (!v) return false;
    this.camera.position.fromArray(v.pos); this.orbit.target.fromArray(v.target);
    if (this.mode === "orbit") this.orbit.update(); else this.camera.lookAt(...v.target);
    return true;
  }
  private lookPoint(): THREE.Vector3 { const d = new THREE.Vector3(); this.camera.getWorldDirection(d); return this.camera.position.clone().addScaledVector(d, 100); }

  update(dt: number): void {
    if (this.mode === "orbit") { this.orbit.update(); return; }
    const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const s = this.flySpeed * (this.keys.has("ShiftLeft") ? 3 : 1) * dt, p = this.camera.position;
    if (this.keys.has("KeyW")) p.addScaledVector(fwd, s);
    if (this.keys.has("KeyS")) p.addScaledVector(fwd, -s);
    if (this.keys.has("KeyD")) p.addScaledVector(right, s);
    if (this.keys.has("KeyA")) p.addScaledVector(right, -s);
    if (this.keys.has("KeyE")) p.y += s;
    if (this.keys.has("KeyQ")) p.y -= s;
    p.y = Math.max(2, p.y);
    this.camera.lookAt(p.clone().add(fwd));
  }

  resize(w: number, h: number): void { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  dispose(): void { this.cleanup.forEach((f) => f()); this.orbit.dispose(); }
}
