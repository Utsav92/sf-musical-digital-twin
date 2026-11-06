import type { AudioFeatures } from "./features";

export type FeatureSource = "bass" | "mid" | "treble" | "rms" | "centroidNorm" | "beatEnv";
export type VisualTarget = "glow" | "deform" | "facadeWave" | "neon" | "pulse" | "hue" | "atmosphere";

export interface Mapping {
  id: string;
  source: FeatureSource;
  target: VisualTarget;
  gain: number;
  /** Seconds to rise / fall (exponential smoothing time constants). */
  attack: number;
  release: number;
  enabled: boolean;
}

export type ReactiveParams = Record<VisualTarget, number>;

export const DEFAULT_MAPPINGS: Mapping[] = [
  { id: "bass-glow", source: "bass", target: "glow", gain: 1, attack: 0.03, release: 0.25, enabled: true },
  { id: "bass-deform", source: "bass", target: "deform", gain: 1, attack: 0.05, release: 0.4, enabled: true },
  { id: "mid-wave", source: "mid", target: "facadeWave", gain: 1, attack: 0.05, release: 0.3, enabled: true },
  { id: "treble-neon", source: "treble", target: "neon", gain: 1, attack: 0.02, release: 0.18, enabled: true },
  { id: "beat-pulse", source: "beatEnv", target: "pulse", gain: 1, attack: 0.01, release: 0.2, enabled: true },
  { id: "centroid-hue", source: "centroidNorm", target: "hue", gain: 1, attack: 0.6, release: 0.6, enabled: true },
  { id: "rms-atmo", source: "rms", target: "atmosphere", gain: 1, attack: 0.4, release: 1.2, enabled: true },
];

const TARGETS: VisualTarget[] = ["glow", "deform", "facadeWave", "neon", "pulse", "hue", "atmosphere"];

/**
 * Maps audio features to bounded visual parameters (all outputs in [0,1]).
 * Anti-flicker: asymmetric exponential smoothing, per-target slew limit, user gain, global intensity.
 */
export class AudioReactiveController {
  mappings: Mapping[] = DEFAULT_MAPPINGS.map((m) => ({ ...m }));
  /** Global reactivity multiplier (0 = static city). */
  intensity = 1;
  /** Max change per second for any output, prevents strobing. */
  maxSlew = 8;
  params: ReactiveParams = { glow: 0, deform: 0, facadeWave: 0, neon: 0, pulse: 0, hue: 0.5, atmosphere: 0 };
  private smoothed = new Map<string, number>();
  private beatEnv = 0;

  update(f: AudioFeatures, dt: number): ReactiveParams {
    dt = Math.min(Math.max(dt, 1e-4), 0.1);
    // Beat envelope: instant attack on beat, exponential decay.
    this.beatEnv = f.beat ? Math.max(this.beatEnv, f.beatStrength) : this.beatEnv * Math.exp(-dt / 0.18);
    const src: Record<FeatureSource, number> = {
      bass: f.bass, mid: f.mid, treble: f.treble, rms: f.rms, centroidNorm: f.centroidNorm, beatEnv: this.beatEnv,
    };
    const acc: Record<VisualTarget, number> = { glow: 0, deform: 0, facadeWave: 0, neon: 0, pulse: 0, hue: 0, atmosphere: 0 };
    const hasHue = this.mappings.some((m) => m.enabled && m.target === "hue");
    for (const m of this.mappings) {
      if (!m.enabled) continue;
      const prev = this.smoothed.get(m.id) ?? 0;
      const x = src[m.source];
      const tau = Math.max(1e-3, x > prev ? m.attack : m.release);
      const s = prev + (x - prev) * (1 - Math.exp(-dt / tau));
      this.smoothed.set(m.id, s);
      acc[m.target] += s * m.gain;
    }
    for (const t of TARGETS) {
      const mult = t === "hue" ? 1 : this.intensity;
      const target = Math.min(1, Math.max(0, acc[t] * mult));
      if (t === "hue" && !hasHue) { this.params.hue = 0.5; continue; }
      const cur = this.params[t];
      const step = this.maxSlew * dt;
      this.params[t] = cur + Math.max(-step, Math.min(step, target - cur));
    }
    return this.params;
  }
}
