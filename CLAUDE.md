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

## Key Implementation Details
- **Passive Detection**: `world-model.js` calculates Signal-to-Noise Ratio (SNR) and manages classification states (`UNDETECTED` to `CONFIRMED`).
- **WebGPU Compute**: `compute/webgpu-fft.js` performs real-time FFT on the GPU, with optimized normalization and smoothing.
- **Acoustic Focus**: `audio-system.js` implements selective gain and focus mechanisms for active target tracking.
- **Interaction Model**: Selection is unified via the `targetSelected` custom event; dashboard updates automatically.
- **Coordinate System**: North is +Z in 3D, and Up (0°) in North-Up 2D modes.
- **DPR Scaling**: All canvases use `devicePixelRatio` scaling for high-resolution displays.
