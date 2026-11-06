/** Lane-based traffic with the Intelligent Driver Model (IDM) and fixed-phase signals. Deterministic (seeded RNG, fixed timestep). */

export interface CityLayout {
  /** Coordinates (metres) of the roads running along each axis. Symmetric grid: same values for x- and z-aligned roads. */
  roadCoords: number[];
  roadWidth: number;
  /** Half extent of the road network from origin. */
  extent: number;
}

export type Axis = "x" | "z";
export type SignalState = "green" | "yellow" | "red";
export type VehicleKind = "car" | "bus" | "bike";

export interface Lane {
  id: number; axis: Axis; dir: 1 | -1;
  /** Fixed world coordinate on the perpendicular axis. */
  fixed: number;
  /** Indices (row, col) of the road this lane is on. */
  roadIndex: number;
  uStart: number; uEnd: number;
  crossings: { u: number; stopU: number; crossIndex: number }[];
}

export interface Vehicle {
  id: number; kind: VehicleKind; lane: Lane; u: number; v: number; a: number;
  length: number; width: number; v0: number; active: boolean; braking: boolean;
  x: number; z: number; heading: number;
}

export interface TrafficOptions {
  seed?: number;
  maxVehicles?: number;
  signalOverride?: (axis: Axis, t: number, intersection: number) => SignalState;
}

const CYCLE = 16;
export function signalState(axis: Axis, t: number, intersection: number): SignalState {
  const p = (((t + intersection * 3) % CYCLE) + CYCLE) % CYCLE;
  const x = axis === "x";
  if (p < 6) return x ? "green" : "red";
  if (p < 8) return x ? "yellow" : "red";
  if (p < 14) return x ? "red" : "green";
  return x ? "red" : "yellow";
}

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// IDM parameters
const A_MAX = 1.6, B_COMF = 2.2, T_HEAD = 1.2, S0 = 2.5, DELTA = 4, B_HARD = 9;

export class TrafficSimulator {
  readonly lanes: Lane[] = [];
  readonly vehicles: Vehicle[] = [];
  time = 0;
  speedMultiplier = 1;
  signalsEnabled = true;
  private density = 0.5;
  private opts: TrafficOptions;

  constructor(public layout: CityLayout, opts: TrafficOptions = {}) {
    this.opts = opts;
    const rng = mulberry32(opts.seed ?? 1337);
    const { roadCoords: rc, extent } = layout;
    const off = 3.6;
    const half = layout.roadWidth / 2;
    let id = 0;
    for (const axis of ["x", "z"] as Axis[]) {
      rc.forEach((roadC, roadIndex) => {
        for (const dir of [1, -1] as const) {
          const fixed = roadC + (dir === 1 ? off : -off) * (axis === "x" ? 1 : -1);
          const lane: Lane = { id: id++, axis, dir, fixed, roadIndex, uStart: -extent, uEnd: extent, crossings: [] };
          rc.forEach((c, crossIndex) => {
            const uc = dir * c;
            lane.crossings.push({ u: uc, stopU: uc - half - 1.5, crossIndex });
          });
          lane.crossings.sort((a, b) => a.u - b.u);
          this.lanes.push(lane);
        }
      });
    }
    // Pre-place vehicles with deterministic spacing per lane.
    const max = opts.maxVehicles ?? 160;
    const perLane = Math.ceil(max / this.lanes.length);
    let vid = 0;
    for (let slot = 0; slot < perLane; slot++) {
      for (const lane of this.lanes) {
        if (vid >= max) break;
        const r = rng();
        const kind: VehicleKind = r < 0.1 ? "bus" : r < 0.2 ? "bike" : "car";
        const length = kind === "bus" ? 11 : kind === "bike" ? 1.9 : 4.5;
        const width = kind === "bus" ? 2.6 : kind === "bike" ? 0.7 : 1.9;
        const span = lane.uEnd - lane.uStart;
        const u = lane.uStart + ((slot + rng() * 0.6) / perLane) * span;
        const v0 = (kind === "bus" ? 9 : kind === "bike" ? 5.5 : 12.5) * (0.9 + rng() * 0.2);
        const veh: Vehicle = { id: vid++, kind, lane, u, v: v0 * 0.5, a: 0, length, width, v0, active: true, braking: false, x: 0, z: 0, heading: 0 };
        this.vehicles.push(veh);
        this.syncWorld(veh);
      }
    }
    this.setDensity(this.density);
  }

  get maxVehicles() { return this.vehicles.length; }
  get activeCount() { return this.vehicles.reduce((n, v) => n + (v.active ? 1 : 0), 0); }

  setDensity(d: number): void {
    this.density = Math.min(1, Math.max(0, d));
    const n = Math.round(this.density * this.vehicles.length);
    this.vehicles.forEach((v, i) => (v.active = i < n));
  }

  private signal(axis: Axis, crossIndex: number, roadIndex: number): SignalState {
    if (!this.signalsEnabled) return "green";
    const inter = roadIndex * this.layout.roadCoords.length + crossIndex;
    return (this.opts.signalOverride ?? signalState)(axis, this.time, inter);
  }

  private syncWorld(v: Vehicle): void {
    const { lane } = v;
    const along = lane.dir * v.u;
    if (lane.axis === "x") { v.x = along; v.z = lane.fixed; v.heading = lane.dir === 1 ? 0 : Math.PI; }
    else { v.z = along; v.x = lane.fixed; v.heading = lane.dir === 1 ? -Math.PI / 2 : Math.PI / 2; }
  }

  step(dt: number): void {
    this.time += dt;
    for (const lane of this.lanes) {
      const list = this.vehicles.filter((v) => v.active && v.lane === lane).sort((a, b) => a.u - b.u);
      for (let i = 0; i < list.length; i++) {
        const veh = list[i];
        const leader = list[i + 1];
        let gap = Infinity, dv = 0;
        if (leader) { gap = leader.u - leader.length / 2 - (veh.u + veh.length / 2); dv = veh.v - leader.v; }
        // Traffic signal acts as a stationary obstacle at the stop line while red (or yellow if we can stop).
        const front = veh.u + veh.length / 2;
        for (const c of lane.crossings) {
          if (c.stopU < front - 0.5) continue; // already past this stop line
          const s = this.signal(lane.axis, c.crossIndex, lane.roadIndex);
          const g = c.stopU - front;
          const canStop = g > (veh.v * veh.v) / (2 * 4.5);
          if (s === "red" || (s === "yellow" && canStop)) { if (g < gap) { gap = Math.max(g, 0.05); dv = veh.v; } }
          break; // only the next stop line matters
        }
        const v0 = veh.v0 * this.speedMultiplier;
        let acc = A_MAX * (1 - Math.pow(veh.v / Math.max(v0, 0.1), DELTA));
        if (gap < Infinity) {
          const sStar = S0 + Math.max(0, veh.v * T_HEAD + (veh.v * dv) / (2 * Math.sqrt(A_MAX * B_COMF)));
          acc -= A_MAX * (sStar / Math.max(gap, 0.05)) ** 2;
        }
        acc = Math.max(-B_HARD, Math.min(A_MAX, acc));
        veh.a = acc;
        veh.braking = acc < -0.8;
        veh.v = Math.max(0, veh.v + acc * dt);
        veh.u += veh.v * dt;
        // Wrap at lane end; hold if the entry is not clear.
        if (veh.u > lane.uEnd) {
          const blocked = list.some((o) => o !== veh && o.u < lane.uStart + 14 && o.u > lane.uStart - 14);
          if (blocked) { veh.u = lane.uEnd; veh.v = 0; } else { veh.u = lane.uStart; veh.v = Math.min(veh.v, veh.v0); }
        }
        this.syncWorld(veh);
      }
    }
  }
}
