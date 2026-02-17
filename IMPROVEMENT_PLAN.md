# The Silent Abyss: Development Roadmap & Improvement Plan

This document outlines the prioritized improvements for the Silent Abyss simulation based on codebase reviews on 2026-02-16 and 2026-02-17.

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
- [ ] **Lint Clean State**: Resolve current `no-unused-vars` errors in `src/world-model.js` and `src/audio/worklets/wasm-engine.worklet.js`.
- [ ] **CI/CD Baseline**: (Optional) Add GitHub Actions for automated linting and testing.

## Phase 5: Realism & Technical Modernization (Completed)
- [x] **Acoustic Foundation**: Depth-dependent sound propagation and environment noise.
- [x] **Wasm Audio Core**: High-performance Rust/Wasm DSP for engine synthesis.
- [x] **WebGPU Compute**: GPU-accelerated FFT processing for LOFAR/Waterfall.
- [x] **Classification Gameplay**: Data-driven target identification and harmonic matching.
- [x] **UI & Systems Integration**: Command interface completion and platform health components.
- [x] **Optimization**: Implemented acoustic physics normalization and WebGPU FFT stabilization.

## Phase 6: Polish & Expansion (Execution Plan)

### 6.1 Foundation: Data-Driven Scenario Architecture
- [x] Add a scenario data layer so target spawns are not hardcoded in `src/world-model.js`.
- [x] Define a target schema (`id`, `type`, `classId`, spawn data, behavior profile, optional overrides).
- [x] Add loader + validation for scenario files and fail-fast errors for invalid data.
- [x] Normalize class defaults from data (ship/sub classes, acoustic defaults, behavior defaults) before constructing `SimulationTarget`.
- [x] Add unit tests for scenario parsing/validation and deterministic spawn behavior.

Acceptance criteria:
- `seedTargets()` consumes scenario data instead of inline arrays.
- Invalid scenario entries produce clear errors.
- Existing baseline scenario behavior remains reproducible.

### 6.2 Multi-Contact Management
- [x] Implement contact registry with stable tactical labels (`S1`, `S2`, ...), sorting, and filtering.
- [x] Add manual target management actions: focus, pin, relabel, and clear-lost.
- [x] Add manual solution entry workflow (bearing/range/course/speed estimates) with confidence scoring.
- [x] Add split/merge handling for ambiguous tracks and recovery flow for lost tracks.
- [x] Add UI/UX tests for selection persistence and label stability under updates.

Acceptance criteria:
- Operators can manage multiple concurrent contacts without label churn.
- Manual solutions persist while tracks are maintained.
- Lost/reacquired tracks follow deterministic lifecycle rules.

### 6.3 Environmental Effects
- [x] Extend `EnvironmentModel` with surface duct and convergence zone modifiers.
- [x] Apply new modifiers to passive detection and active ping return consistently.
- [x] Add operator-facing indicators for current acoustic conditions and expected detection impact.
- [x] Add deterministic tests for each environmental effect and combined edge cases.

Acceptance criteria:
- Detection outcomes change predictably by depth/range/environment profile.
- Effects are visible both in detection math and operator UI indicators.
- Regression tests cover baseline and effect-enabled scenarios.

### 6.4 Campaign Vertical Slice
- [x] Define mission schema (objectives, triggers, scripted events, win/loss conditions).
- [x] Implement campaign state persistence (progress, mission outcomes, unlock flow).
- [x] Deliver 1-2 missions that exercise multi-contact workflows and environmental mechanics.
- [x] Add tests for mission transitions and save/load integrity.

Acceptance criteria:
- Users can complete at least one full mission loop with persistent progress.
- Mission outcomes are reproducible from saved state.
- Scenario/mission data can be extended without engine code changes.

### 6.5 Hardening & Delivery
- [ ] Resolve current lint failures and restore clean ESLint baseline.
- [ ] Add CI pipeline (`lint`, `test`, and build smoke check).
- [ ] Add scenario snapshot tests and one campaign smoke test.
- [ ] Update docs for developers (scenario/mission authoring) and players (contact-management workflow).

Acceptance criteria:
- CI is green on `main`.
- Docs match implemented systems.
- Phase 6 scope is playable, testable, and maintainable.

## Current Snapshot (2026-02-17)

- `npm test`: passing (3 test files, 15 tests)
- `npm run lint`: failing (2 errors, both unused symbols)
- No `.github/workflows` pipeline currently exists
- Repository contains generated Rust `target/` artifacts under `src/audio/dsp-core/` and should keep them ignored from source control
