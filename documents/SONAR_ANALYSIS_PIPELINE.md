# Sonar Analysis Pipeline (DEMON/LOFAR)

This document summarizes the current analysis path used by LOFAR/DEMON, lock behavior, suppression model, and runtime controls.

## 1. End-to-End Data Flow

1. `src/main.js` render loop chooses analysis mode:
   - `selected` when a target is selected
   - `composite` otherwise
2. `src/audio-system.js` provides analyser buffers:
   - `getAnalysisFrequencyData(mode)`
   - `getAnalysisTimeDomainData(mode)`
3. `src/main.js` calls:
   - `sonarVisuals.draw(..., selectedTarget, timeDomainData, options)`
   - options include `sourceMode`, `ownShipSignature`, `pingTransient`
4. `src/sonar-visuals.js` updates and draws:
   - LOFAR
   - DEMON
   - BTR
   - Waterfall

## 2. Analysis Buses (`src/audio-system.js`)

Internal analysis buses:
- `analysisOwnShipGain`
- `analysisContactsGain`
- `analysisMixGain`
- `analysisSelectedGain`
- `analysisCompositeAnalyser`
- `analysisSelectedAnalyser`

Current wiring:
- Contact analysis voices -> `analysisContactsGain`
- Own-ship analysis voice -> `analysisOwnShipGain`
- Both summed into `analysisMixGain`
- `analysisMixGain` -> `analysisCompositeAnalyser`
- `analysisMixGain` is also routed to `analysisSelectedGain` -> `analysisSelectedAnalyser`

Important note:
- `selected` mode currently uses a dedicated analyser, but it is still fed by the same mixed bus.
- Practical separation comes from per-target focus gains/mixes in `updateTargetVolume(...)` and own-ship ducking in `updateOwnShipFocusGain(...)`.

## 3. DEMON Tracker and Lock States (`src/sonar-visuals.js`)

DEMON preprocessing:
- Update cadence: every 3rd frame (`_demonFrameCounter % 3`).
- Analysis window: 8192 or 16384 recent samples (`_getDemonAnalysisWindow`).
- Envelope chain (`_computeDemonSpectrum`):
  - HP filter (~20 Hz)
  - LP filter (~1800 Hz)
  - full-wave rectification
  - envelope HP filter (~1 Hz)
  - low-frequency spectrum build (1..120 Hz bins)
- Whitening/enhancement: `_enhanceDemonSpectrum(...)`
- Temporal smoothing: `_smoothDemonSpectrum(...)`
- Peak tracking: `_detectDemonPeaks(...)`

Per-target lock object:
- `bpfEstimateHz`
- `confidence`
- `harmonicHits`
- `harmonicCount`
- `state`
- `lastUpdateTime`

State machine:
- `SEARCHING`
- `TENTATIVE`
- `LOCKED`
- `LOST`

Comb scoring:
- `_scoreDemonComb(...)` evaluates harmonics `k=1..maxHarmonics` around `k * bpf`.
- Uses tolerance window (`combToleranceHz`), local prominence, and weighted hit score.
- Confidence blends comb evidence + signal quality and applies hysteresis thresholds.

## 4. Suppression Model

### 4.1 Own-Ship Suppression

DEMON self-noise mask (`_applyOwnShipMask(...)`):
- Uses own-ship `bpfHz` from `AudioSystem.getOwnShipSignature()`.
- Applies attenuation around own-ship harmonic bins.
- Selected-target mode uses stronger masking than no-selection mode.

UI overlay:
- LOFAR: dashed blue own-ship harmonics with `S1..` labels.
- DEMON: dashed blue own-ship harmonic guides with `S1..` labels.
- Target harmonics use a separate green style.

### 4.2 Ping/Transient Rejection

`WorldModel.getPingTransientState(recentWindowSec)` reports:
- `active`
- `recent`
- `sinceLastPing`

When ping transient is active/recent, DEMON:
- skips normal update
- decays smoothed spectrum/peak tracks
- reduces signal quality

This prevents lock jitter during and shortly after ping.

## 5. Operator Controls

UI controls are in `index.html` and bound in `src/main.js` via `bindDemonControlUiHandlers()`.

- `Focus Width` (`#demon-focus-width-slider`, 0.6..3.0 Hz)
  - Calls `sonarVisuals.setDemonFocusWidth(valueHz)`
  - Updates comb tolerance (`combToleranceHz`)

- `Self-Noise Suppression` (`#demon-self-noise-toggle`)
  - Calls `sonarVisuals.setSelfNoiseSuppressionEnabled(enabled)`

- `Stability/Responsiveness` (`#demon-stability-slider`, 0..100)
  - Normalized to 0..1 and passed to `setDemonResponsiveness(value01)`
  - Adjusts confidence attack/release and lock/unlock hysteresis thresholds

## 6. Runtime Metadata in DEMON Panel

DEMON panel reports:
- `SOURCE`: `SELECTED` or `COMPOSITE`
- `DEMON TRACK`: `SEARCHING/TENTATIVE/LOCKED/LOST`
- `BPF`
- `HARMONIC MATCH`
- `SELF MASK` and own-ship BPF

This metadata is generated in `drawDEMON(...)`.

## 7. Test Coverage

Signal/tracker tests:
- `tests/demon-tracker.test.js`
- `tests/demon-self-noise-mask.test.js`

Integration smoke:
- `tests/sonar-integration.test.js`
  - verifies selection-driven source mode metadata and tracker state transitions

