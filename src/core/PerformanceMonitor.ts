import type { WebGLRenderer } from "three";

/** Rolling FPS / frame-time stats plus renderer resource counters. */
export class PerformanceMonitor {
  private times: number[] = [];
  private last = performance.now();
  fps = 0; frameMs = 0; worstMs = 0;
  tick(): void {
    const now = performance.now(); const dt = now - this.last; this.last = now;
    this.times.push(dt); if (this.times.length > 120) this.times.shift();
    const sum = this.times.reduce((a, b) => a + b, 0);
    this.frameMs = sum / this.times.length; this.fps = 1000 / Math.max(this.frameMs, 0.001); this.worstMs = Math.max(...this.times);
  }
  report(r: WebGLRenderer, extra = ""): string {
    const i = r.info, mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return `${this.fps.toFixed(0)} fps  ${this.frameMs.toFixed(1)} ms (worst ${this.worstMs.toFixed(0)})\n` +
      `draw calls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(0)}k\n` +
      `geometries ${i.memory.geometries}  textures ${i.memory.textures}` + (mem ? `\nJS heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : "") + (extra ? `\n${extra}` : "");
  }
}
