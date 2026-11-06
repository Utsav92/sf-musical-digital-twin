import * as THREE from "three";
import { SceneManager } from "./rendering/SceneManager";
import { buildSampleCity, SAMPLE_LAYOUT, type SampleCity } from "./rendering/SampleCity";
import { VehicleRenderer } from "./rendering/VehicleRenderer";
import { RealTwin } from "./rendering/RealTwin";
import { CameraController } from "./cameras/CameraController";
import { AudioAnalyzer } from "./audio/AudioAnalyzer";
import { AudioReactiveController } from "./audio/AudioReactiveController";
import { TrafficSimulator } from "./traffic/TrafficSimulator";
import { PerformanceMonitor } from "./core/PerformanceMonitor";
import { loadGLB } from "./core/AssetLoader";
import { section, slider, button, buttonRow, fileInput, hint, select } from "./ui/panel";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $("status");
function status(msg: string, err = false) { statusEl.textContent = msg; statusEl.className = err ? "err" : ""; }

const canvas = $<HTMLCanvasElement>("view");
const cam = new CameraController(canvas);
const sm = new SceneManager(canvas, cam.camera, (w, h) => cam.resize(w, h));
const audio = new AudioAnalyzer();
const reactive = new AudioReactiveController();
const perf = new PerformanceMonitor();
let city: SampleCity = buildSampleCity(); sm.scene.add(city.group);
let userModel: THREE.Group | null = null;
let sim = new TrafficSimulator(SAMPLE_LAYOUT, { maxVehicles: 160 });
let vehicles = new VehicleRenderer(sim); sm.scene.add(vehicles.group);
sim.setDensity(0.5);
let twin: RealTwin | null = null;

const state = { mode: "musical" as "realistic" | "musical", timeOfDay: 0.75, simSpeed: 1, paused: false, trafficSpeed: 1, density: 0.5, signals: true, gain: 1, bloom: 0.7 };
const daySky = new THREE.Color(0x6f8fb8), nightSky = new THREE.Color(0x070a14), fog = new THREE.Color();

// ---------------------------------------------------------------- UI
const panel = $("panel");
const header = document.createElement("header"); header.innerHTML = "<span>SF MUSICAL TWIN</span><span aria-hidden='true'>▾</span>"; header.tabIndex = 0; header.setAttribute("role", "button");
const body = document.createElement("div"); body.className = "body"; panel.append(header, body);
const toggle = () => panel.classList.toggle("collapsed"); header.addEventListener("click", toggle); header.addEventListener("keydown", (e) => { if (e.key === "Enter") toggle(); });

const sScene = section(body, "Scene");
select(sScene, "Visual mode", [["musical", "B · Musical City"], ["realistic", "A · Realistic (static lights)"]], state.mode, (v) => { state.mode = v as typeof state.mode; });
hint(sScene, "Mode C (point-cloud metropolis) is planned, not implemented.");
fileInput(sScene, ".glb,.gltf", "Load GLB city model", async (f) => {
  try { status(`Loading ${f.name}…`); const g = await loadGLB(f); if (userModel) { sm.scene.remove(userModel); sm.disposeObject(userModel); } userModel = g; sm.scene.add(g);
    city.group.visible = false; const s = g.userData.sizeMetres as number[]; status(`Loaded ${f.name}: ${s.map((v) => v.toFixed(0)).join(" × ")} scene units (unit scale not verified)`); }
  catch (e) { status((e as Error).message, true); }
});
button(sScene, "Real SF twin (Blender LOD1)", () => void loadTwin());
async function loadTwin() {
  if (twin) { twin.group.visible = true; city.group.visible = false; vehicles.group.visible = false; return; }
  const t = new RealTwin();
  try {
    await t.load("/twin", (n, total, msg) => status(`Loading real SF twin ${n}/${total} (${msg})…`));
    twin = t; sm.scene.add(t.group); city.group.visible = false; vehicles.group.visible = false;
    cam.camera.position.set(t.centre.x + 500, 260, t.centre.z + 600); cam.orbit.target.set(t.centre.x, 30, t.centre.z); cam.orbit.update();
    status(`Real SF twin loaded: ${t.tiles.length} tiles, ${(t.totalTris / 1e6).toFixed(1)}M triangles (pilot district at Blender LOD1). Simulated traffic is hidden: it needs the real road graph.`);
  } catch (e) { t.dispose(); status(`Could not load the real twin: ${(e as Error).message}`, true); }
}
button(sScene, "Use sample city", () => { twin && (twin.group.visible = false); vehicles.group.visible = true; if (userModel) { sm.scene.remove(userModel); sm.disposeObject(userModel); userModel = null; } city.group.visible = true; status("Sample city"); });
slider(sScene, "Time of day", 0, 1, 0.01, state.timeOfDay, (v) => (state.timeOfDay = v), (v) => (v < 0.3 ? "day" : v > 0.7 ? "night" : "dusk"));
slider(sScene, "Bloom", 0, 1.5, 0.05, state.bloom, (v) => { state.bloom = v; sm.bloom.strength = v; sm.bloomEnabled = v > 0; });

const sAudio = section(body, "Audio");
const row = buttonRow(sAudio);
const playBtn = button(row, "Demo beat", () => audio.startDemo().then(() => status("Playing built-in demo beat")).catch((e) => status(e.message, true)));
button(row, "Mic", () => audio.startMic().then(() => status("Listening to microphone")).catch((e) => status(e.message, true)));
button(row, "Play/Pause", () => audio.toggle());
fileInput(sAudio, "audio/*,.wav,.mp3,.m4a,.flac,.ogg", "Upload music", (f) => audio.loadFile(f).then(() => status(`Playing ${f.name}`)).catch((e) => status((e as Error).message, true)));
const spec = document.createElement("canvas"); spec.id = "spectrum"; spec.width = 290; spec.height = 54; sAudio.appendChild(spec);
slider(sAudio, "Reactivity", 0, 2, 0.05, 1, (v) => (reactive.intensity = v));
for (const key of ["bass-glow", "mid-wave", "treble-neon", "beat-pulse", "rms-atmo"]) {
  const m = reactive.mappings.find((x) => x.id === key)!;
  slider(sAudio, key.replace("-", " → "), 0, 2, 0.05, m.gain, (v) => (m.gain = v));
}

const sTraffic = section(body, "Traffic");
slider(sTraffic, "Density", 0, 1, 0.01, state.density, (v) => { state.density = v; sim.setDensity(v); });
slider(sTraffic, "Speed ×", 0.3, 2, 0.05, 1, (v) => { sim.speedMultiplier = v; });
button(sTraffic, "Signals on/off", function (this: void) { sim.signalsEnabled = !sim.signalsEnabled; status(`Traffic signals ${sim.signalsEnabled ? "on" : "off"}`); });

const sSim = section(body, "Simulation", false);
slider(sSim, "Sim speed", 0, 3, 0.05, 1, (v) => (state.simSpeed = v));
button(sSim, "Pause / resume", () => { state.paused = !state.paused; });

const sCam = section(body, "Camera");
const camRow = buttonRow(sCam);
const orbitBtn = button(camRow, "Orbit", () => setCam("orbit"), true);
const flyBtn = button(camRow, "Fly (WASD+drag)", () => setCam("fly"), false);
function setCam(m: "orbit" | "fly") { cam.setMode(m); orbitBtn.setAttribute("aria-pressed", String(m === "orbit")); flyBtn.setAttribute("aria-pressed", String(m === "fly")); status(m === "fly" ? "Fly: WASD move, Q/E down/up, Shift fast, drag to look" : "Orbit camera"); }
slider(sCam, "Fly speed", 10, 300, 5, cam.flySpeed, (v) => (cam.flySpeed = v), (v) => v.toFixed(0));
hint(sCam, "Keys 1-4 jump to saved views, Shift+1-4 saves the current view. F toggles fly, Space plays/pauses audio.");

const sExp = section(body, "Export", false);
hint(sExp, "Offline 1080p export is not in the browser app yet. For a synchronized video use the Blender pipeline: src/cine/render_film60.sh (see README).");

window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
  if (e.code === "Space") { e.preventDefault(); audio.toggle(); }
  else if (e.code === "KeyF") setCam(cam.mode === "fly" ? "orbit" : "fly");
  else if (/^Digit[1-4]$/.test(e.code)) { const i = Number(e.code.slice(5)) - 1; if (e.shiftKey) { cam.saveViewpoint(i); status(`Saved view ${i + 1}`); } else if (!cam.gotoViewpoint(i)) status(`View ${i + 1} is empty (Shift+${i + 1} to save)`); }
});

// ---------------------------------------------------------------- loop
const FIXED = 1 / 60; let acc = 0, last = performance.now(), simTime = 0;
const specCtx = spec.getContext("2d")!; const bins = new Uint8Array(1024);
function drawSpectrum() {
  specCtx.clearRect(0, 0, spec.width, spec.height); audio.spectrum(bins);
  const n = 72, w = spec.width / n; specCtx.fillStyle = "#5ad1ff";
  for (let i = 0; i < n; i++) { const k = Math.floor(Math.pow(i / n, 2) * 400) + 1; const v = bins[k] / 255; specCtx.fillRect(i * w, spec.height * (1 - v), w - 1, spec.height * v); }
}
function frame(nowMs: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (nowMs - last) / 1000); last = nowMs; perf.tick();
  const f = audio.poll(nowMs / 1000);
  const p = reactive.update(f, dt);
  if (!state.paused) { acc += dt * state.simSpeed; let n = 0; while (acc >= FIXED && n++ < 5) { sim.step(FIXED); acc -= FIXED; simTime += FIXED; } if (n >= 5) acc = 0; }
  const night = 0.15 + 0.85 * state.timeOfDay, reactivity = state.mode === "musical" ? 1 : 0.0;
  fog.copy(daySky).lerp(nightSky, state.timeOfDay).multiplyScalar(1 + 0.4 * p.atmosphere * reactivity);
  (sm.scene.background as THREE.Color).copy(fog);
  sm.renderer.toneMappingExposure = 1.1 - 0.3 * state.timeOfDay;
  city.update(p, simTime, night, reactivity, fog, 0.0009 + 0.0007 * p.atmosphere * reactivity);
  if (twin?.group.visible) { twin.update(p, simTime, night, reactivity, fog, 0.0003 + 0.0004 * p.atmosphere * reactivity); twin.cull(cam.camera.position); }
  vehicles.update(); cam.update(dt); sm.render(); drawSpectrum();
  if ((nowMs | 0) % 10 < 2) $("stats").textContent = perf.report(sm.renderer, `vehicles ${sim.activeCount}/${sim.maxVehicles}  sim t=${simTime.toFixed(1)}s\nbass ${f.bass.toFixed(2)} mid ${f.mid.toFixed(2)} treble ${f.treble.toFixed(2)}\n${f.tempo ? "tempo ~" + f.tempo.toFixed(0) + " BPM" : "tempo —"}  src ${audio.source}`);
}
status("Ready. Press “Demo beat” (or Space) to start audio.");
void loadTwin();
requestAnimationFrame(frame);
window.addEventListener("beforeunload", () => { audio.dispose(); vehicles.dispose(); city.dispose(); cam.dispose(); sm.dispose(); });
void playBtn;
