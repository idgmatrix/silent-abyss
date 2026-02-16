# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
The Silent Abyss is a web-based simulation of a tactical submarine sonar and command system. It provides real-time acoustic analysis visualizations (LOFAR, DEMON, BTR, Waterfall) and a 3D tactical viewport with procedural terrain.

## Tech Stack
- **Frontend**: Vanilla HTML5, JavaScript (ES modules), CSS3.
- **Styling**: Tailwind CSS (CDN) + Custom CRT/retro overlays.
- **3D Engine**: Three.js (npm dependency) for the tactical viewport.
- **Audio**: Web Audio API with `AudioWorklet` (inline Blob) for real-time engine noise synthesis.
- **Tooling**: Vite (Build/Dev), ESLint (Lint), Prettier (Format), Vitest (Test).

## Development Lifecycle
- **Install**: `npm install`
- **Run**: `npm run dev`
- **Build**: `npm run build`
- **Test**: `npm test`
- **Lint**: `npm run lint`

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
    - `audio-system.js`: Web Audio API management.
- **Tests** (`tests/`):
    - `simulation.test.js`: Core physics and math tests.

## Key Implementation Details
- **Passive Detection**: `world-model.js` calculates Signal-to-Noise Ratio (SNR) for each target.
- **Interaction Model**: Selection is unified via the `targetSelected` custom event.
- **Coordinate System**: North is +Z in 3D, and Up (0°) in North-Up 2D modes.
- **DPR Scaling**: All canvases use `devicePixelRatio` scaling.
