# The Silent Abyss: Development Roadmap & Improvement Plan

This document outlines the prioritized improvements for the Silent Abyss simulation based on a comprehensive codebase review (2026-02-16).

## Phase 1: Architectural Refactoring & State Management (Completed)
- [x] **Extract WorldModel**: Move target lists, environment state, and detection orchestration out of `main.js`.
- [x] **Unified Contact Tracking**: Replace ad-hoc flags (`detected`, `isPassivelyDetected`, `passiveSNR`) with a formal track state machine (`UNDETECTED`, `AMBIGUOUS`, `TRACKED`, `LOST`).
- [x] **Deterministic Tick**: Decouple simulation updates from `setInterval` and render frames to use a fixed-step accumulator.

## Phase 2: Acoustic Realism & Advanced Simulation (Completed)
- [x] **Bathymetric Occlusion**: Tie the procedural terrain height to sonar visibility (Line-of-Sight checks).
- [x] **Acoustic Environment**: Implement simplified sound-speed profiles and multi-path attenuation.
- [x] **AI Behavior States**: Upgrade targets to react to player pings (evasion, intercept, masking).

## Phase 3: Visual & UX Polish (Completed)
- [x] **Modular Renderers**: Split `TacticalView` into specialized `Tactical3DRenderer` and `Tactical2DRenderer`.
- [x] **Sensor Persistence**: Add phosphor trail effects to BTR and Waterfall displays.
- [x] **Track Uncertainty**: Display uncertainty ellipses on maps based on SNR.

## Phase 4: Maintainability & Tools (In Progress)
- [x] **Build Pipeline**: Implement Vite for local dependency management and bundling.
- [x] **Testing Suite**: Add Vitest unit tests for core physics, acoustics, and state logic.
- [x] **Directory Reorganization**: Move all source files to `src/` and tests to `tests/`.
- [x] **Linter/Formatter**: Add ESLint and Prettier for code consistency.
- [ ] **CI/CD Baseline**: (Optional) Add GitHub Actions for automated linting and testing.
