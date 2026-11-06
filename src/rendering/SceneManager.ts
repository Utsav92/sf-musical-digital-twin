import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/** Owns the renderer, scene, bloom composer and resize handling. */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  bloomEnabled = true;
  private renderPass: RenderPass;
  private ro: ResizeObserver;

  constructor(readonly canvas: HTMLCanvasElement, private camera: THREE.PerspectiveCamera, private onResize: (w: number, h: number) => void) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.background = new THREE.Color(0x0b1020);
    this.renderPass = new RenderPass(this.scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.6, 0.85);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(this.renderPass); this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
  }

  resize(): void {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(2, el.clientWidth), h = Math.max(2, el.clientHeight);
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h); this.onResize(w, h);
  }

  render(): void { if (this.bloomEnabled) this.composer.render(); else this.renderer.render(this.scene, this.camera); }

  /** Frees GPU resources for everything under `root` (geometries, materials, textures). */
  disposeObject(root: THREE.Object3D): void {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) { for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose(); mat.dispose(); }
    });
  }

  dispose(): void { this.ro.disconnect(); this.composer.dispose(); this.renderer.dispose(); }
}
