import { describe, it, expect } from "vitest";
import { magnitudeSpectrum, bandPower, DEFAULT_BANDS, AudioFeatureExtractor, spectralCentroid } from "../src/audio/features";

const SR = 44100, N = 2048;
const sine = (f: number, a = 1) => Float32Array.from({ length: N }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / SR));

describe("audio features", () => {
  it("recovers sine amplitude within 10% at a bin-centred frequency", () => {
    const f = (SR / N) * 20; // exactly bin 20
    const m = magnitudeSpectrum(sine(f, 0.5));
    expect(Math.max(...m)).toBeGreaterThan(0.45);
    expect(Math.max(...m)).toBeLessThan(0.55);
  });
  it.each([[100, "bass"], [1000, "mid"], [6000, "treble"]] as const)("%i Hz lands in the %s band", (f, band) => {
    const m = magnitudeSpectrum(sine(f));
    const p = Object.fromEntries(Object.entries(DEFAULT_BANDS).map(([k, r]) => [k, bandPower(m, SR, N, r)]));
    const others = Object.entries(p).filter(([k]) => k !== band).map(([, v]) => v);
    expect(p[band]).toBeGreaterThan(50 * Math.max(...others));
  });
  it("centroid of a pure tone is near its frequency", () => {
    expect(spectralCentroid(magnitudeSpectrum(sine(1000)), SR, N)).toBeGreaterThan(900);
    expect(spectralCentroid(magnitudeSpectrum(sine(1000)), SR, N)).toBeLessThan(1100);
  });
  it("detects a 120 BPM kick train and estimates tempo", () => {
    const hop = 512, dur = 10, total = SR * dur;
    const sig = new Float32Array(total + N);
    for (let b = 0; b < dur * 2; b++) {
      const s = Math.floor(b * 0.5 * SR);
      for (let i = 0; i < SR * 0.12 && s + i < sig.length; i++) sig[s + i] += Math.sin(2 * Math.PI * 60 * (i / SR)) * Math.exp(-i / SR / 0.04);
    }
    const ex = new AudioFeatureExtractor(SR, N);
    let beats = 0, tempo = 0;
    for (let s = 0; s + N <= sig.length; s += hop) {
      const fr = sig.subarray(s, s + N);
      const f = ex.process(magnitudeSpectrum(fr), fr, s / SR);
      if (f.beat) beats++;
      tempo = f.tempo || tempo;
    }
    expect(beats).toBeGreaterThanOrEqual(16);
    expect(beats).toBeLessThanOrEqual(24);
    expect(tempo).toBeGreaterThan(112);
    expect(tempo).toBeLessThan(128);
  });
});
