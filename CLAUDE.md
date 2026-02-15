# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
The Silent Abyss is a web-based simulation of a tactical submarine sonar and command system. It provides real-time acoustic analysis visualizations (LOFAR, DEMON, BTR, Waterfall) and a 3D tactical viewport.

## Tech Stack
- **Frontend**: Vanilla HTML5, JavaScript (ES modules), CSS3.
- **Styling**: Tailwind CSS (CDN) + Custom CSS (`style.css`) for CRT/retro overlays.
- **3D Engine**: Three.js r128 (CDN) for the tactical viewport.
- **Audio**: Web Audio API with `AudioWorklet` for real-time synthesis and FFT analysis.

## Development Lifecycle
- **Run**: Open `index.html` in a modern web browser.
- **Dependencies**: Requires internet access to load Tailwind and Three.js from CDNs.
- **Build**: No build step required; serves raw static files.
- **Tests**: No automated testing framework. Manual verification via browser.

## Architecture & Structure
- **Entry Point**: `index.html` loads `main.js` as an ES module (`type="module"`).
- **Core Logic** (`main.js`):
    - **Audio Engine**: `SoundEngineProcessor` defined as an inline string/Blob and loaded as an `AudioWorklet`. Handles propeller noise and cavitation.
    - **Visualization Loop**: `renderLoop` (rAF) handles both 3D scene updates and 2D canvas drawing.
    - **State**: Manages `audioCtx`, `analyser`, and `scene` global state.
- **Simulation** (`simulation.js`):
    - **SimulationEngine**: Time-based tick loop using `performance.now()` to update targets.
    - **SimulationTarget**: Physics model for targets (distance, bearing, velocity).
- **Visualizations**:
    - **3D**: Three.js scene with custom shader material for sonar ping rings on terrain.
    - **2D Sonars**: `drawBTR` and `drawWaterfall` use the "draw-copy-draw" technique (shift existing canvas content) to create time-history scrolling effects.

## Key Implementation Details
- **AudioWorklet**: Implemented via `URL.createObjectURL(new Blob(...))` to avoid separate file requirements for the worklet processor.
- **Communication**: Main thread controls audio engine via `port.postMessage` (e.g., `SET_RPM`).
- **Styling**: `.crt-overlay` in `style.css` creates the scanline/vignette effect. Tailwind handles grid/flex layouts.
- **Coordinate System**: Measurements in meters/degrees. 3D Viewport centers on own-ship (0,0,0).
