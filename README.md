# SF Musical Digital Twin

Phase 1 (interactive Three.js app) + the 60 s video pipeline that lives in `~/sf_twin`.

## Run the app (macOS, Apple Silicon)
Node 22 is installed at `~/.local/node` (no Homebrew on this Mac).
```bash
export PATH=$HOME/.local/node/bin:$PATH
cd ~/sf-musical-digital-twin
npm install
npm run dev        # http://127.0.0.1:5173
npm test           # 9 unit tests (audio DSP, traffic IDM/signals)
npm run build      # typecheck + production build
```
Versions: three 0.170.0, vite 5, typescript 5, vitest 2.

## Implemented (Phase 1)
- Procedural sample city (original geometry, NOT San Francisco), instanced audio-reactive towers (GLSL), streetlights, glowing road lines, bloom.
- Audio: file upload, built-in demo beat, microphone; FFT, bass/mid/treble, RMS, centroid, flux, beat + tempo (`src/audio/features.ts`, tested on synthetic sines and a kick train).
- Mappings with gain/attack/release/slew limiting, editable gains in the panel.
- Traffic: IDM car-following, fixed-phase signals, 160 vehicles (cars/buses/bikes), headlamps + brake lights, density/speed controls. Deterministic, fixed 60 Hz step.
- Orbit and fly cameras, 4 saved viewpoints, GLB import (unit scale is reported, not assumed), FPS/draw-call/heap monitor.
## Not implemented yet
Gaussian splat rendering, point-cloud mode (C), particles/physics (Rapier), spatial/vehicle audio, browser video export, WebGPU, ML modules, reconstruction pipeline. Not measured: FPS on the Mac mini; the app has been type-checked and built but not visually inspected by the author.

## 60 s video (Blender, in ~/sf_twin)
```bash
cd ~/sf_twin
TRACK=/path/song.mp3 ./src/cine/render_film60.sh audio   # optional; placeholder track otherwise
./src/cine/render_film60.sh render                        # resumable, 1800 frames @1080p
./src/cine/render_film60.sh encode                        # -> renders/film60/SF_Musical_Digital_Twin_60s.mp4 + verification
```
Loading your own Blender twin into the web app: export a GLB from Blender (Y-up, metres) and use *Load GLB*.
