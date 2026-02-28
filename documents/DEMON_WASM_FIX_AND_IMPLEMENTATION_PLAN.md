# DEMON Fix And Rust/WASM Implementation Plan

## Scope
- Stabilize current DEMON behavior first (correctness fixes).
- Then migrate DEMON DSP-heavy stages from JavaScript to Rust/WASM.
- Keep lock-state/UI behavior stable during migration.

## Current Issues To Fix First

### 1) Per-target history contamination on selection switch
- Problem:
  - DEMON per-target cache snapshots spectrum/peaks/lock metadata, but does not snapshot or reset the sample ring buffer consistently.
  - Switching targets can allow prior target audio history to influence the restored target analysis window.
- Fix:
  - On target switch, clear DEMON sample ring buffer state (`_demonSampleBuffer`, `_demonSampleWriteIndex`, `_demonSampleCount`) unless we explicitly add per-target sample-buffer snapshots.
  - Keep this as deterministic reset behavior in phase 1.
- Validation:
  - Add a target-switch regression test (`A -> B -> A`) verifying no lock contamination and bounded re-acquisition.

### 2) Ping-transient suppression applied in selected mode
- Problem:
  - DEMON suppression currently triggers on ping activity regardless of analysis source mode.
  - Selected analysis bus excludes own-ship ping feed, so suppression can unnecessarily degrade selected-target DEMON.
- Fix:
  - Gate ping suppression to composite-source analysis only.
  - Keep existing suppression behavior for composite mode.
- Validation:
  - Add test proving selected mode is not damped during ping transient while composite mode remains damped.

### 3) BPF readout behavior mismatch in auto mode
- Problem:
  - Auto-mode BPF readout path relies on a display harmonic score that is currently tied to selected-target lock path.
  - In non-selected mode, readout may never surface.
- Fix:
  - Split selected-target lock score vs auto-mode spectral estimate score.
  - Use dedicated auto-mode confidence metric for auto BPF readout.
- Validation:
  - Add test for non-selected mode BPF readout trigger under synthetic comb signal.

### 4) Clarify terminology
- Problem:
  - `BPF` in the panel means Blade Passing Frequency, not Band-Pass Filter.
- Fix:
  - Update DEMON panel/docs to use explicit labels:
    - `Blade Rate (BPF)` for propeller frequency.
    - `Input Band` for filter range.
- Validation:
  - UI text and docs check.

## Rust/WASM Migration Strategy

## Phase 0: Baseline and parity harness
- Add deterministic DEMON fixtures:
  - clean comb, noisy comb, own-ship-dominated clutter, ping transient, target-switch cases.
- Freeze expected output metrics:
  - peak set near expected harmonics,
  - BPF estimate tolerance,
  - lock state progression bounds,
  - frame time budget.

Deliverables:
- New Vitest fixture helpers and parity assertions.

## Phase 1: Move DEMON DSP core to Rust/WASM
- Move the following from `SonarVisuals._computeDemonSpectrum(...)` into Rust:
  - machinery/cavitation input band filtering path,
  - rectification,
  - decimation,
  - envelope HP detrend,
  - low-frequency envelope spectrum generation.
- Keep these in JS for now:
  - smoothing,
  - peak tracking,
  - comb scoring,
  - lock state machine,
  - drawing/UI.

WASM API proposal:
- `compute_demon_spectrum(input_f32, sample_rate, max_freq_hz, config) -> Float32Array`
- `config` includes:
  - `input_band_low_hz`,
  - `input_band_high_hz`,
  - `envelope_hp_hz`,
  - `decimated_rate_target_hz`.

Deliverables:
- Rust module under `src/audio/dsp-core/src/` with wasm-bindgen export.
- JS adapter in `src/audio/` or `src/compute/`.
- Feature flag in sonar visuals to switch `js` vs `wasm` backend.

## Phase 2: Optional move of peak + comb scoring to Rust/WASM
- Port:
  - peak candidate extraction,
  - local prominence scoring,
  - harmonic comb scoring.
- Keep lock state transitions in JS initially for easier tuning.

Deliverables:
- Extended WASM API returning:
  - enhanced/normalized spectrum (optional),
  - candidate peaks,
  - comb scores for provided BPF candidates.

## Phase 3: Performance polish and defaults
- Add runtime backend selection:
  - `wasm` preferred,
  - `js` fallback on failure.
- Add instrumentation:
  - per-frame DEMON compute time,
  - dropped-frame counters.
- Tune default input band for cavitation-capable analysis:
  - introduce presets (for example `Machinery` vs `Cavitation`).

Deliverables:
- Stable default preset and fallback behavior.
- Updated docs and operator-facing controls.

## File-Level Implementation Plan
- `src/sonar-visuals.js`
  - apply correctness fixes (cache reset, ping gating, auto BPF score split),
  - add backend switch for DEMON compute path.
- `src/audio/dsp-core/src/lib.rs`
  - add exported DEMON compute function(s).
- `src/audio/wasm-audio-manager.js` (if needed) or new DEMON-specific wasm bridge
  - load and invoke DEMON wasm exports.
- `tests/demon-*.test.js` and integration tests
  - add regressions and parity checks.
- `documents/SONAR_ANALYSIS_PIPELINE.md`
  - update pipeline, terminology, and backend notes.

## Acceptance Criteria
- Correctness:
  - No target-switch contamination.
  - Selected-mode DEMON unaffected by ping suppression gating.
  - Auto-mode BPF readout works under valid comb evidence.
- Parity:
  - WASM DEMON spectrum aligns with JS baseline within agreed tolerance.
- Performance:
  - Equal or better frame-time impact vs JS implementation under same fixture load.
- Reliability:
  - Graceful fallback to JS path if WASM load/init fails.

## Execution Order
1. Implement correctness fixes in JS + tests.
2. Build parity harness and freeze baseline.
3. Implement Phase 1 Rust/WASM DSP core and wire behind feature flag.
4. Run parity and perf checks; set WASM as default when stable.
5. Optionally migrate peak/comb scoring after stability window.

