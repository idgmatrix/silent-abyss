# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
The Silent Abyss is a web-based simulation of a tactical submarine sonar and command system. It provides real-time acoustic analysis visualizations and a 3D tactical viewport.

## Tech Stack
- **Frontend**: Vanilla HTML5, JavaScript (ES modules), CSS3.
- **Styling**: Tailwind CSS (loaded via CDN) for layout, custom CSS for CRT/retro effects.
- **3D Engine**: Three.js (v128) for the tactical sonar viewport.
- **Audio Processing**: Web Audio API with `AudioWorklet` for real-time propeller sound simulation and FFT analysis.

## Development Commands
This project is a static site with no build system.
- **Run**: Open `index.html` in a web browser.
- **Test/Lint**: No automated testing or linting framework is currently configured.

## Architecture & Structure
- `index.html`: Main entry point and layout definition.
- `main.js`: Main logic file.
    - **Audio Engine**: Contains the `AudioWorklet` code (as a string/blob) for high-performance sound synthesis. Manages the `AudioContext`, `AnalyserNode`, and synthesis nodes.
    - **Simulation**: Uses `SimulationEngine` and `SimulationTarget` (defined in `simulation.js`) to track and update multiple targets.
    - **Rendering**:
        - **3D**: `initThreeJS` and `renderLoop` manage the Three.js scene (terrain, contacts, pings).
        - **2D Canvas**: Dedicated functions (`drawLOFAR`, `drawDEMON`, `drawBTR`, `drawWaterfall`) render sonar visualizations using requestAnimationFrame.
- `style.css`: Custom styling for UI panels and the CRT overlay effect.

## Key Concepts
- **Passive vs. Active Sonar**: The system defaults to passive tracking. "Active Pulse" (Ping) triggers a 3D scan visualization and can "detect" targets in range.
- **Acoustic Fidelity**: LOFAR (frequency over time) and DEMON (envelope modulation) are core to the simulation's intent.
- **Communication**: The main thread communicates with the `SoundEngineProcessor` via `postMessage` on `engineNode.port` (e.g., setting RPM).
