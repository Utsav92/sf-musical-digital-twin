import { AudioFeatureExtractor, ZERO_FEATURES, type AudioFeatures } from "./features";

export type AudioSource = "none" | "file" | "demo" | "mic";

/** Web Audio front-end: file / built-in demo synth / microphone -> AnalyserNode -> AudioFeatureExtractor. */
export class AudioAnalyzer {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  source: AudioSource = "none";
  readonly element = new Audio();
  private extractor: AudioFeatureExtractor | null = null;
  private freqDb = new Float32Array(0);
  private td = new Float32Array(0);
  private mags = new Float32Array(0);
  private mediaNode: MediaElementAudioSourceNode | null = null;
  private micStream: MediaStream | null = null;
  private demoTimer = 0;
  private demoGain: GainNode | null = null;
  private objectUrl: string | null = null;
  features: AudioFeatures = ZERO_FEATURES;
  onError: (msg: string) => void = () => {};

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "interactive" });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0;
      this.analyser.connect(this.ctx.destination);
      this.freqDb = new Float32Array(this.analyser.frequencyBinCount);
      this.mags = new Float32Array(this.analyser.frequencyBinCount);
      this.td = new Float32Array(this.analyser.fftSize);
      this.extractor = new AudioFeatureExtractor(this.ctx.sampleRate, this.analyser.fftSize);
      this.element.crossOrigin = "anonymous";
    }
    return this.ctx;
  }

  get playing(): boolean { return this.source === "file" ? !this.element.paused : this.source === "demo" || this.source === "mic"; }

  async loadFile(file: File): Promise<void> {
    if (!/^audio\//.test(file.type) && !/\.(wav|mp3|m4a|aac|ogg|flac)$/i.test(file.name)) throw new Error(`Unsupported audio file: ${file.name}`);
    this.stop();
    const ctx = this.ensure();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    this.element.src = this.objectUrl;
    this.element.loop = true;
    await new Promise<void>((res, rej) => { this.element.oncanplay = () => res(); this.element.onerror = () => rej(new Error("The browser could not decode this audio file.")); });
    if (!this.mediaNode) { this.mediaNode = ctx.createMediaElementSource(this.element); this.mediaNode.connect(this.analyser!); }
    this.source = "file";
    await ctx.resume();
    await this.element.play();
    this.extractor?.reset();
  }

  async startDemo(): Promise<void> {
    this.stop();
    const ctx = this.ensure(); await ctx.resume();
    this.demoGain = ctx.createGain(); this.demoGain.gain.value = 0.7; this.demoGain.connect(this.analyser!);
    const bpm = 120, beat = 60 / bpm, roots = [55, 43.65, 49, 41.2];
    const noise = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
    const nd = noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    let next = ctx.currentTime + 0.05, step = 0;
    const schedule = () => {
      while (next < ctx.currentTime + 0.25) {
        const bar = Math.floor(step / 16), root = roots[Math.floor(bar / 2) % 4], t = next, g = this.demoGain!;
        if (step % 4 === 0) { // kick
          const o = ctx.createOscillator(), e = ctx.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
          e.gain.setValueAtTime(1, t); e.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(e).connect(g); o.start(t); o.stop(t + 0.32);
        }
        if (step % 4 === 2) { // hat
          const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), e = ctx.createGain(); s.buffer = noise; f.type = "highpass"; f.frequency.value = 7000;
          e.gain.setValueAtTime(0.35, t); e.gain.exponentialRampToValueAtTime(0.001, t + 0.05); s.connect(f).connect(e).connect(g); s.start(t); s.stop(t + 0.06);
        }
        if (step % 2 === 0) { // bass + arp
          const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), e = ctx.createGain(); o.type = "sawtooth"; o.frequency.value = root * (step % 8 === 6 ? 2 : 1);
          f.type = "lowpass"; f.frequency.value = 400; e.gain.setValueAtTime(0.35, t); e.gain.exponentialRampToValueAtTime(0.001, t + beat * 0.45);
          o.connect(f).connect(e).connect(g); o.start(t); o.stop(t + beat * 0.5);
          const a = ctx.createOscillator(), ae = ctx.createGain(); a.type = "square"; a.frequency.value = root * 8 * [1, 1.5, 2, 1.5][(step / 2) % 4];
          ae.gain.setValueAtTime(0.05, t); ae.gain.exponentialRampToValueAtTime(0.001, t + beat * 0.2); a.connect(ae).connect(g); a.start(t); a.stop(t + beat * 0.25);
        }
        next += beat / 4; step++;
      }
    };
    schedule(); this.demoTimer = window.setInterval(schedule, 50);
    this.source = "demo"; this.extractor?.reset();
  }

  async startMic(): Promise<void> {
    this.stop();
    const ctx = this.ensure(); await ctx.resume();
    try { this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
    catch { throw new Error("Microphone access was denied or is unavailable."); }
    const node = ctx.createMediaStreamSource(this.micStream);
    const mute = ctx.createGain(); mute.gain.value = 0; // analyse only; avoid feedback
    node.connect(this.analyser!); this.analyser!.disconnect(); this.analyser!.connect(mute).connect(ctx.destination);
    this.source = "mic"; this.extractor?.reset();
  }

  toggle(): void {
    if (this.source === "file") { if (this.element.paused) void this.element.play(); else this.element.pause(); }
    else if (this.ctx) { if (this.ctx.state === "running") void this.ctx.suspend(); else void this.ctx.resume(); }
  }

  stop(): void {
    this.element.pause();
    if (this.demoTimer) { clearInterval(this.demoTimer); this.demoTimer = 0; }
    this.demoGain?.disconnect(); this.demoGain = null;
    this.micStream?.getTracks().forEach((t) => t.stop()); this.micStream = null;
    if (this.analyser && this.ctx) { this.analyser.disconnect(); this.analyser.connect(this.ctx.destination); }
    this.source = "none";
  }

  /** Call once per frame. Returns zeros when nothing is playing. */
  poll(now: number): AudioFeatures {
    if (!this.analyser || !this.extractor || this.source === "none" || (this.ctx && this.ctx.state !== "running")) return (this.features = { ...ZERO_FEATURES });
    this.analyser.getFloatFrequencyData(this.freqDb);
    this.analyser.getFloatTimeDomainData(this.td);
    for (let i = 0; i < this.mags.length; i++) { const db = this.freqDb[i]; this.mags[i] = Number.isFinite(db) ? Math.pow(10, db / 20) : 0; }
    return (this.features = this.extractor.process(this.mags, this.td, now));
  }

  spectrum(out: Uint8Array): void { this.analyser?.getByteFrequencyData(out as Uint8Array<ArrayBuffer>); }

  dispose(): void {
    this.stop(); if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    void this.ctx?.close(); this.ctx = null; this.analyser = null;
  }
}
