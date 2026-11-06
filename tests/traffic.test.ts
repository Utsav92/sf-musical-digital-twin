import { describe, it, expect } from "vitest";
import { TrafficSimulator, type CityLayout } from "../src/traffic/TrafficSimulator";

const layout: CityLayout = { roadCoords: [-200, -100, 0, 100, 200], roadWidth: 16, extent: 300 };

describe("traffic", () => {
  it("is deterministic for a given seed", () => {
    const run = () => { const s = new TrafficSimulator(layout, { seed: 5 }); for (let i = 0; i < 600; i++) s.step(1 / 60); return s.vehicles.map((v) => [v.u.toFixed(4), v.v.toFixed(4)].join()).join("|"); };
    expect(run()).toBe(run());
  });
  it("never overlaps vehicles in a lane and never exceeds desired speed", () => {
    const s = new TrafficSimulator(layout, { seed: 3 }); s.setDensity(1);
    let minGap = Infinity;
    for (let i = 0; i < 60 * 120; i++) {
      s.step(1 / 60);
      if (i % 30) continue;
      for (const lane of s.lanes) {
        const l = s.vehicles.filter((v) => v.active && v.lane === lane).sort((a, b) => a.u - b.u);
        for (let k = 0; k + 1 < l.length; k++) minGap = Math.min(minGap, l[k + 1].u - l[k + 1].length / 2 - (l[k].u + l[k].length / 2));
      }
      for (const v of s.vehicles) expect(v.v).toBeLessThanOrEqual(v.v0 * 1.05 + 0.01);
    }
    expect(minGap).toBeGreaterThan(-0.05);
  });
  it("stops at a red light before the stop line, then proceeds on green", () => {
    let red = true;
    const s = new TrafficSimulator(layout, { seed: 1, maxVehicles: 1, signalOverride: () => (red ? "red" : "green") });
    const v = s.vehicles[0];
    const lane = v.lane; const stop = lane.crossings.find((c) => c.stopU > v.u + v.length / 2)!;
    for (let i = 0; i < 60 * 90; i++) s.step(1 / 60);
    expect(v.v).toBeLessThan(0.1);
    expect(v.u + v.length / 2).toBeLessThanOrEqual(stop.stopU + 0.1);
    red = false;
    for (let i = 0; i < 60 * 10; i++) s.step(1 / 60);
    expect(v.u).toBeGreaterThan(stop.stopU);
  });
});
