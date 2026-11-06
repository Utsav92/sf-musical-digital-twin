/** Pure audio DSP: FFT, band energies, spectral features, beat + tempo detection. No Web Audio dependency, so it is unit-testable and reusable for offline pre-analysis. */

export interface BandRange { lo: number; hi: number }
export const DEFAULT_BANDS = {
  bass: { lo: 20, hi: 250 } as BandRange,
  mid: { lo: 250, hi: 2000 } as BandRange,
  treble: { lo: 2000, hi: 12000 } as BandRange,
};

export interface AudioFeatures {
  /** Normalised 0..1 (adaptive peak normalisation). */
  bass: number; mid: number; treble: number; rms: number;
  /** Spectral centroid in Hz and a 0..1 log-scaled version (100 Hz..8 kHz). */
  centroid: number; centroidNorm: number;
  /** Spectral flux, normalised by its running mean. */
  flux: number;
  beat: boolean; beatStrength: number;
  /** BPM estimate from recent inter-beat intervals; 0 until enough beats seen. */
  tempo: number;
}

export const ZERO_FEATURES: AudioFeatures = {
  bass: 0, mid: 0, treble: 0, rms: 0, centroid: 0, centroidNorm: 0, flux: 0, beat: false, beatStrength: 0, tempo: 0,
};

/** In-place radix-2 FFT. Length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n & (n - 1)) throw new Error("fft: length must be a power of two");
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/** Hann-windowed magnitude spectrum, scaled so a sine of amplitude A peaks at ~A. Returns n/2 bins. */
export function magnitudeSpectrum(samples: ArrayLike<number>): Float32Array {
  const n = samples.length;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = samples[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  fft(re, im);
  const out = new Float32Array(n / 2);
  const scale = 4 / n; // hann coherent gain 0.5, one-sided 0.5
  for (let k = 0; k < out.length; k++) out[k] = Math.hypot(re[k], im[k]) * scale;
  return out;
}

export function bandPower(mags: ArrayLike<number>, sampleRate: number, fftSize: number, r: BandRange): number {
  const binHz = sampleRate / fftSize;
  const lo = Math.max(1, Math.floor(r.lo / binHz)), hi = Math.min(mags.length - 1, Math.ceil(r.hi / binHz));
  let p = 0;
  for (let k = lo; k <= hi; k++) p += mags[k] * mags[k];
  return p;
}

export function spectralCentroid(mags: ArrayLike<number>, sampleRate: number, fftSize: number): number {
  const binHz = sampleRate / fftSize;
  const lo = Math.max(1, Math.floor(20 / binHz)), hi = Math.min(mags.length - 1, Math.ceil(12000 / binHz));
  let num = 0, den = 0;
  for (let k = lo; k <= hi; k++) { num += k * binHz * mags[k]; den += mags[k]; }
  return den > 1e-9 ? num / den : 0;
}

export function rmsOf(samples: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
  return Math.sqrt(s / Math.max(1, samples.length));
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Stateful extractor. Feed it one spectrum + time-domain frame per call, with an explicit clock so offline analysis is deterministic. */
export class AudioFeatureExtractor {
  private prev: Float32Array | null = null;
  private peaks = { bass: 1e-4, mid: 1e-4, treble: 1e-4, rms: 1e-4 };
  private fluxHist: { t: number; v: number }[] = [];
  private fluxMean = 1e-6;
  private lastBeat = -Infinity;
  private beatTimes: number[] = [];
  private lastT = 0;
  private prevFlux = 0;
  tempo = 0;

  constructor(
    public sampleRate: number,
    public fftSize: number,
    public bands = DEFAULT_BANDS,
    /** Minimum seconds between beats (cooldown to avoid double triggers). */
    public beatCooldown = 0.2,
    /** Threshold = mean + k * std of flux over the last second. */
    public beatSensitivity = 1.4,
  ) {}

  reset(): void {
    this.prev = null; this.fluxHist = []; this.beatTimes = []; this.lastBeat = -Infinity; this.tempo = 0; this.prevFlux = 0;
    this.peaks = { bass: 1e-4, mid: 1e-4, treble: 1e-4, rms: 1e-4 };
  }

  private norm(key: keyof AudioFeatureExtractor["peaks"], value: number, dt: number): number {
    const decay = Math.exp(-dt / 6); // peak envelope forgets with ~6 s time constant
    this.peaks[key] = Math.max(value, this.peaks[key] * decay, 1e-4);
    return Math.pow(clamp01(value / this.peaks[key]), 0.8);
  }

  process(mags: Float32Array, timeDomain: ArrayLike<number>, t: number): AudioFeatures {
    const dt = Math.max(1e-3, t - this.lastT);
    this.lastT = t;
    const { sampleRate: sr, fftSize: n } = this;
    const bass = this.norm("bass", Math.sqrt(bandPower(mags, sr, n, this.bands.bass)), dt);
    const mid = this.norm("mid", Math.sqrt(bandPower(mags, sr, n, this.bands.mid)), dt);
    const treble = this.norm("treble", Math.sqrt(bandPower(mags, sr, n, this.bands.treble)), dt);
    const rms = this.norm("rms", rmsOf(timeDomain), dt);
    const centroid = spectralCentroid(mags, sr, n);
    const centroidNorm = centroid > 0 ? clamp01(Math.log2(centroid / 100) / Math.log2(80)) : 0;

    // Spectral flux (positive differences up to ~4 kHz).
    let flux = 0;
    if (this.prev) {
      const hi = Math.min(mags.length, Math.ceil(4000 / (sr / n)));
      for (let k = 1; k < hi; k++) flux += Math.max(0, mags[k] - this.prev[k]);
    }
    this.prev = Float32Array.from(mags);

    // Adaptive-threshold beat detection on a 1 s flux history.
    this.fluxHist.push({ t, v: flux });
    while (this.fluxHist.length && t - this.fluxHist[0].t > 1) this.fluxHist.shift();
    let mean = 0;
    for (const h of this.fluxHist) mean += h.v;
    mean /= this.fluxHist.length;
    let varr = 0;
    for (const h of this.fluxHist) varr += (h.v - mean) ** 2;
    const std = Math.sqrt(varr / this.fluxHist.length);
    this.fluxMean = this.fluxMean * 0.98 + flux * 0.02;
    const thr = Math.max(mean + this.beatSensitivity * std, this.fluxMean * 1.5, 1e-3);
    let beat = false, beatStrength = 0;
    if (flux > thr && flux >= this.prevFlux && t - this.lastBeat >= this.beatCooldown) {
      beat = true; beatStrength = clamp01((flux - thr) / (thr * 2) + 0.4);
      if (this.lastBeat > -Infinity) this.beatTimes.push(t);
      else this.beatTimes.push(t);
      this.lastBeat = t;
      if (this.beatTimes.length > 16) this.beatTimes.shift();
      this.tempo = this.estimateTempo();
    }
    this.prevFlux = flux;
    return { bass, mid, treble, rms, centroid, centroidNorm, flux: flux / Math.max(this.fluxMean, 1e-6), beat, beatStrength, tempo: this.tempo };
  }

  private estimateTempo(): number {
    if (this.beatTimes.length < 5) return 0;
    const iv: number[] = [];
    for (let i = 1; i < this.beatTimes.length; i++) {
      const d = this.beatTimes[i] - this.beatTimes[i - 1];
      if (d >= 0.25 && d <= 1.2) iv.push(d);
    }
    if (iv.length < 3) return 0;
    iv.sort((a, b) => a - b);
    let bpm = 60 / iv[iv.length >> 1];
    while (bpm < 70) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    return bpm;
  }
}
