# Silent Abyss

A browser-based tactical submarine sonar simulation with 2D acoustic displays, a 3D tactical view, and real-time audio synthesis.

## Features

- LOFAR, DEMON, BTR, and Waterfall acoustic displays
- Passive detection plus active ping scanning
- Track/classification state progression (`UNDETECTED` to `CONFIRMED`)
- Three.js tactical rendering with 2D/3D view modes
- WebAudio + AudioWorklet pipeline backed by Rust/Wasm DSP
- WebGPU FFT path with CPU fallback when WebGPU is unavailable

## Tech Stack

- Core: HTML + JavaScript (ES modules), Vite
- Rendering: Three.js
- Styling: Tailwind utility classes via CDN in `index.html` plus custom CSS in `src/style.css`
- Audio: Web Audio API + AudioWorklet + Rust/Wasm (`src/audio/dsp-core/pkg`)
- Testing/Quality: Vitest, ESLint, Prettier

## Requirements

- Node.js 18+ (Node.js 20 verified)
- npm
- A modern Chromium-based browser is recommended for best WebGPU support

## Quick Start

```bash
npm install
npm run dev
```

App URL: `http://localhost:5173`

## Scripts

- `npm run dev`: start dev server
- `npm run build`: create production build in `dist/`
- `npm run preview`: serve production build locally
- `npm test`: run Vitest suite
- `npm run lint`: run ESLint
- `npm run lint:fix`: auto-fix lint issues where possible
- `npm run format`: format with Prettier
- `npm run format:check`: check formatting only

## Repository Health (Reviewed 2026-02-17)

- Tests: passing (`31/31`)
- Lint: passing
- Build: passing (`npm run build`)
- CI: GitHub Actions workflow present at `.github/workflows/ci.yml`

## Project Layout

- `index.html`: shell UI and panel layout
- `src/main.js`: app bootstrap and subsystem wiring
- `src/world-model.js`: detection/classification and ping logic
- `src/simulation.js`: target simulation engine
- `src/tactical-renderer-3d.js`: 3D tactical renderer
- `src/tactical-renderer-2d.js`: 2D tactical renderer
- `src/sonar-visuals.js`: LOFAR/DEMON/BTR/Waterfall drawing
- `src/audio/`: AudioWorklet manager and Rust/Wasm DSP assets
- `src/campaign-manager.js`: mission progression and campaign persistence
- `src/data/missions.js`: campaign mission definitions
- `tests/`: Vitest coverage for simulation, environment, classification
- `documents/The_Silent_Abyss_GDD.md`: game design document (Korean)
- `documents/SCENARIO_MISSION_AUTHORING.md`: developer guide for scenario/mission data
- `documents/PLAYER_CONTACT_WORKFLOW.md`: player/operator workflow guide

## License

No `LICENSE` file is currently present in this repository.
