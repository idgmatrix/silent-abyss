# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
The Silent Abyss is a web-based simulation of a tactical submarine sonar and command system. It provides real-time acoustic analysis visualizations (LOFAR, DEMON, BTR, Waterfall) and a 3D tactical viewport with procedural terrain.

## Tech Stack
- **Frontend**: Vanilla HTML5, JavaScript (ES modules), CSS3.
- **Styling**: Tailwind CSS (CDN) + Custom CRT/retro overlays.
- **3D Engine**: Three.js (npm dependency) for the tactical viewport.
- **Audio**: Web Audio API with `AudioWorklet` + WebAssembly DSP core for real-time engine noise synthesis.
- **Tooling**: Vite (Build/Dev), ESLint (Lint), Prettier (Format), Vitest (Test).

## Development Lifecycle
- **Install**: `npm install`
- **Run**: `npm run dev`
- **Build**: `npm run build`
- **Test**: `npm test` (single run) / `npm run test:watch` (watch mode)
- **Single test file**: `npx vitest run tests/<file>.test.js`
- **Lint**: `npm run lint` / `npm run lint:fix`
- **Format**: `npm run format` / `npm run format:check`
- **Preview**: `npm run preview` (serve production build locally)

## Architecture & Structure
- **Entry Point**: `index.html` loads `src/main.js` as an ES module.
- **Source Code** (`src/`):
    - `main.js`: Core orchestration.
    - `simulation.js`: `SimulationEngine` and `SimulationTarget` physics.
    - `world-model.js`: State management and detection logic.
    - `tactical-view.js`: Unified tactical display controller.
    - `tactical-renderer-3d.js`: Three.js 3D renderer.
    - `tactical-renderer-2d.js`: Canvas 2D overlay renderer.
    - `sonar-visuals.js`: Acoustic displays (LOFAR, DEMON, BTR, Waterfall).
    - `scrolling-display.js`: Waterfall helpers.
    - `audio-system.js`: Web Audio API management (legacy entry point).
    - `audio/wasm-audio-manager.js`: WebAssembly DSP audio manager.
    - `audio/worklets/`: AudioWorklet processors (engine, wasm-engine, polyfill).
    - `audio/dsp-core/pkg/`: Compiled Wasm DSP binaries.
    - `acoustics/environment-model.js`: Acoustic propagation and environmental modelling.
    - `contact-manager.js`: Contact tracking and lifecycle management.
    - `campaign-manager.js`: Campaign/mission progression logic.
    - `depth-profile-display.js`: Depth profile visualization.
    - `effects/cavitation-particles.js`: Visual cavitation particle effects.
    - `data/ship-signatures.js`: Acoustic signature database.
    - `data/missions.js`: Mission definitions.
    - `data/scenarios/`: Scenario data files.
    - `data/scenario-loader.js`: Scenario loading and parsing.
    - `compute/webgpu-fft.js`: WebGPU compute orchestration.
- **Tests** (`tests/`):
    - `simulation.test.js`: Core physics and math tests.
    - `classification.test.js`: Classification state machine tests.
    - `contact-manager.test.js`: Contact lifecycle tests.
    - `environment.test.js`: Acoustic environment model tests.
    - `scenario-loader.test.js` / `scenario-snapshot.test.js`: Scenario data integrity.
    - `campaign.test.js` / `campaign-smoke.test.js`: Campaign progression tests.
    - `demon-tracker.test.js` / `demon-self-noise-mask.test.js`: DEMON algorithm tests.
    - `sonar-integration.test.js`: End-to-end sonar pipeline integration.
- **Documentation** (`documents/`):
    - `The_Silent_Abyss_GDD.md`: Game design document (Korean).
    - `SCENARIO_MISSION_AUTHORING.md`: Scenario/mission authoring guide.
    - `SONAR_ANALYSIS_PIPELINE.md`: Sonar analysis pipeline documentation.
    - `PLAYER_CONTACT_WORKFLOW.md`: Player workflow guide.

## Key Implementation Details
- **Passive Detection**: `world-model.js` calculates Signal-to-Noise Ratio (SNR) and manages classification states (`UNDETECTED` to `CONFIRMED`).
- **WebGPU Compute**: `compute/webgpu-fft.js` performs real-time FFT on the GPU, with optimized normalization and smoothing.
- **Acoustic Focus**: `audio-system.js` implements selective gain and focus mechanisms for active target tracking.
- **Interaction Model**: Selection is unified via the `targetSelected` custom event; dashboard updates automatically.
- **Coordinate System**:
  - **World/Model Space**: `+X` = East, `+Z` = North, `+Y` = Up. Course (`rad`): `0` = North, increases clockwise.
  - **3D Scene Space**: Mirrored on Z (`sceneZ = -modelZ`) because Three.js uses right-handed coordinates.
- **DPR Scaling**: All canvases use `devicePixelRatio` scaling for high-resolution displays.
- **AudioWorklet**: Low-latency audio processing with WebAssembly DSP integration.
- **Data-Driven Architecture**: Scenarios, missions, and ship signatures loaded from data files.
- **Browser Compatibility**: Modern browsers with WebGPU support (Chrome/Edge recommended).

## Data-Driven Architecture
- **Scenario System**: Data-driven scenarios in `src/data/scenarios/` loaded by `scenario-loader.js`.
- **Mission System**: Campaign progression defined in `src/data/missions.js` managed by `campaign-manager.js`.
- **Ship Signatures**: Acoustic database in `src/data/ship-signatures.js` with class-based inheritance.

## Audio Pipeline
- **Real-time Synthesis**: WebAssembly DSP core for engine noise and cavitation effects.
- **Analysis Buses**: Separate audio analysis paths for composite vs selected target modes.
- **DEMON Tracking**: Real-time harmonic analysis with lock state machine (`SEARCHING` → `TENTATIVE` → `LOCKED` → `LOST`).
- **Self-Noise Suppression**: Own-ship harmonic masking in DEMON analysis.
- **AudioWorklet**: Low-latency audio processing with WebAssembly DSP integration.

## Testing Strategy
- **Unit Tests**: Physics, classification, contact lifecycle, environment modeling.
- **Integration Tests**: Sonar pipeline, scenario loading, campaign progression.
- **Algorithm Tests**: DEMON tracking, self-noise masking, FFT normalization.
- **Test Commands**: `npm test` (single run) / `npm run test:watch` (watch mode) / `npx vitest run tests/<file>.test.js` (single file).

## Browser Compatibility
- Modern browsers with WebGPU support (Chrome/Edge recommended).
- Fallback to CPU-based FFT when WebGPU unavailable.
- Web Audio API with AudioWorklet for low-latency audio processing.
- DPR scaling for high-resolution displays.
- All canvases use `devicePixelRatio` scaling for high-resolution displays.