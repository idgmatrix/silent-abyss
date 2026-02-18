# DEMON/LOFAR Improvement Backlog

## 1. Analysis Bus Split
- File: `src/audio-system.js`
- Add internal analysis gains/nodes:
  - `analysisOwnShipGain`
  - `analysisContactsGain`
  - `analysisSelectedGain`
  - `analysisMixGain`
- Keep speaker output path unchanged.
- Add methods:
  - `getAnalysisTimeDomainData(mode = 'composite' | 'selected')`
  - `getAnalysisFrequencyData(mode = 'composite' | 'selected')`
- Acceptance: DEMON/LOFAR can request `selected` source independent of speaker loudness.

## 2. Per-Target Analysis Routing
- File: `src/audio-system.js`
- In `createTargetAudio`, split each target voice to:
  - speaker mix gain
  - analysis gain
- In `setFocusedTarget`, ramp analysis gains:
  - selected target up
  - others down (analysis only)
- Acceptance: with selected target, analysis stream dominated by selected contact while speaker mix still usable.

## 3. Own-Ship Analysis Mask
- Files: `src/audio-system.js`, `src/sonar-visuals.js`
- Route own-ship voice to separate analysis channel and expose own-ship RPM/blade params.
- Add self-noise suppression toggle + notch/line mask around known own-ship BPF harmonics before DEMON.
- Acceptance: own-ship lines reduced in selected-target DEMON and marked in UI.

## 4. DEMON Input Selection + State
- Files: `src/main.js`, `src/sonar-visuals.js`
- Pass selected/composite analysis mode into `sonarVisuals.draw(...)`.
- Add DEMON source state:
  - `sourceMode`: `SELECTED` or `COMPOSITE`
  - `trackState`: `SEARCHING/TENTATIVE/LOCKED/LOST`
- Acceptance: DEMON header clearly shows source and lock state.

## 5. BPF Lock Tracker
- File: `src/sonar-visuals.js`
- Implement per-target lock object:
  - `bpfEstimateHz`
  - `confidence`
  - `harmonicHits`
  - `lastUpdateTime`
- Add comb-scoring around `k * bpf` bins (`k = 1..8`) with tolerance window.
- Add hysteresis for lock/unlock thresholds.
- Acceptance: BPF and harmonic markers stop jumping; confidence evolves smoothly.

## 6. Per-Target DEMON History Cache
- File: `src/sonar-visuals.js`
- Cache tracker state by `targetId` and restore on reselect.
- Expire stale trackers after timeout.
- Acceptance: switching back to prior target restores near-instant stable DEMON.

## 7. Ping/Transient Rejection
- Files: `src/main.js`, `src/sonar-visuals.js`
- Add flag from world model when ping active/recent.
- Skip/discount DEMON update frames during ping window.
- Acceptance: no large DEMON instability during/just after active ping.

## 8. UI Controls
- Files: `index.html`, `src/main.js`, `src/sonar-visuals.js`
- Add DEMON controls:
  - `Focus Width`
  - `Self-Noise Suppression`
  - `Stability/Responsiveness`
- Wire controls to `sonarVisuals` setters.
- Apply params in tracker/suppression logic.
- Acceptance: operator can tune behavior in runtime.

## 9. LOFAR/DEMON Self-Noise Overlays
- File: `src/sonar-visuals.js`
- Draw own-ship expected harmonics as labeled dashed lines.
- Use distinct color/style from target harmonics.
- Acceptance: clear visual distinction between self and target lines.

## 10. Data Model Cleanup
- Files: `src/simulation.js`, `src/data/ship-signatures.js`, `src/data/scenario-loader.js`
- Ensure every acoustic target has explicit:
  - `rpm`
  - `bladeCount`
  - optional `shaftRate`
- Add defaults consistently and validate ranges.
- Acceptance: no missing blade/rpm values in DEMON panel for valid contacts.

## 11. Automated Tests (Signal/Tracker)
- Files: `tests/demon-tracker.test.js`, `tests/demon-self-noise-mask.test.js`
- Add synthetic envelope fixtures (known BPF + interference).
- Acceptance:
  - BPF error within tolerance
  - lock acquired in bounded frames
  - false lock below threshold in self-noise case

## 12. Integration Smoke Tests
- Files: `tests/campaign-smoke.test.js` or `tests/sonar-integration.test.js`
- Verify selected-target path changes analysis mode and tracker state transitions.
- Acceptance: end-to-end target selection updates DEMON source/lock metadata.

## 13. Documentation
- File: `documents/` sonar docs (new or existing)
- Document:
  - analysis buses
  - lock states
  - suppression model
  - operator controls
- Acceptance: developer can trace full pipeline quickly.

## Execution Order
1. Items 1-4 (foundation + wiring)
2. Items 5-7 (stability + lock quality)
3. Items 8-9 (operator UX)
4. Items 10-13 (data hardening + tests + docs)
