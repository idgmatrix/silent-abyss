# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
The Silent Abyss is a web-based simulation of a tactical submarine sonar and command system. It provides real-time acoustic analysis visualizations (LOFAR, DEMON, BTR, Waterfall) and a 3D tactical viewport with procedural terrain.

## Tech Stack
- **Frontend**: Vanilla HTML5, JavaScript (ES modules), CSS3.
- **Styling**: Tailwind CSS (CDN) + Custom CRT/retro overlays.
- **3D Engine**: Three.js r128 (CDN) for the tactical viewport.
- **Audio**: Web Audio API with `AudioWorklet` (inline Blob) for real-time engine noise synthesis.

## Development Lifecycle
- **Run**: Open `index.html` in a modern browser.
- **Dependencies**: Loads Tailwind and Three.js from CDNs; requires internet access.
- **Build/Lint/Test**: No build step, linting, or automated tests implemented. Manual browser verification is used.

## Architecture & Structure
- **Entry Point**: `index.html` loads `main.js` as an ES module.
- **Core Orchestration** (`main.js`): Coordinates simulation state, audio engine updates, and visualization loops. Handles global interaction events like `targetSelected`.
- **Simulation** (`simulation.js`):
    - `SimulationEngine`: Fixed-interval tick loop for physics updates.
    - `SimulationTarget`: Cartesian-based physics model (x, z). Includes `getAcousticSignature()` for passive sonar modeling.
- **Tactical Display** (`tactical-view.js`):
    - Manages Three.js scene (3D) and a shared 2D overlay for 'RADAR' and 'GRID' modes.
    - Implements procedural Perlin-noise seabed terrain via `ShaderMaterial`.
    - Handles map-based target selection.
- **Sonar Visuals** (`sonar-visuals.js`):
    - Renders acoustic displays (LOFAR, DEMON, BTR, Waterfall).
    - `ScrollingDisplay`: Helper class using "draw-copy-draw" for time-history falls.
    - Implements BTR-based bearing selection logic.
- **Audio System** (`audio-system.js`): Wraps Web Audio API and AudioWorklet management.

## Key Implementation Details
- **Passive Detection**: `main.js` calculates Signal-to-Noise Ratio (SNR) for each target based on acoustic signatures and distance.
- **Interaction Model**: Selection is unified via the `targetSelected` custom event. Selecting a target focuses LOFAR/DEMON analysis on that contact's profile.
- **Coordinate System**: Measurements in meters/degrees. 3D Viewport centers on own-ship (0,0,0). North is +Z in 3D, and Up (0°) in North-Up 2D modes.
- **DPR Scaling**: All canvases use `devicePixelRatio` scaling to ensure visual clarity on high-density displays.
