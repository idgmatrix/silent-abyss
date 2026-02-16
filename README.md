# Silent Abyss

A tactical submarine sonar and command system simulation built with modern web technologies.

## Overview

The Silent Abyss is a web-based simulation of a tactical submarine interface. It provides real-time acoustic analysis visualizations and a 3D tactical viewport with procedural terrain, allowing for the simulation of submarine detection and navigation.

### Key Features

- **Acoustic Analysis Displays**:
  - **LOFAR** (Low Frequency Analysis and Recording): Spectrographic display for narrowband frequency analysis.
  - **DEMON** (Detection of Envelope Modulation on Noise): Analysis of propeller cavitation and engine turn rates.
  - **BTR** (Bearing Time Recorder): Wideband detection and tracking of noise sources across all bearings.
  - **Waterfall**: Historical display of acoustic signals.
- **Tactical Viewport**:
  - 3D visualization using Three.js.
  - Procedural terrain generation.
  - Unified 2D/3D interaction for target selection and tracking.
- **Acoustic Realism**:
  - Signal-to-Noise Ratio (SNR) calculations based on target distance, speed, and environment.
  - Bathymetric occlusion and shadow zones.
  - Real-time engine noise synthesis using Web Audio API.

## Tech Stack

- **Core**: Vanilla HTML5, JavaScript (ES modules).
- **Styling**: CSS3 with Tailwind CSS and custom CRT/retro overlays.
- **3D Engine**: [Three.js](https://threejs.org/)
- **Audio**: Web Audio API with `AudioWorklet`.
- **Tooling**: [Vite](https://vitejs.dev/) (Build/Dev), [Vitest](https://vitest.dev/) (Testing), ESLint, Prettier.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [npm](https://www.npmjs.com/)

### Installation

```bash
git clone https://github.com/idgmatrix/silent-abyss.git
cd silent-abyss
npm install
```

### Development

Run the development server:

```bash
npm run dev
```

The application will be available at `http://localhost:5173`.

### Production Build

Create a production build in the `dist` directory:

```bash
npm run build
```

## Project Structure

- `index.html`: Main entry point and layout.
- `src/`: Source code.
  - `main.js`: Core simulation orchestration.
  - `simulation.js`: Physics engine and target logic.
  - `world-model.js`: Detection logic and state management.
  - `tactical-renderer-3d.js` & `tactical-renderer-2d.js`: Three.js and Canvas rendering logic.
  - `sonar-visuals.js`: Implementation of acoustic displays.
- `tests/`: Unit tests using Vitest.

## License

MIT
