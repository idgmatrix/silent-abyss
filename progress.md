Original prompt: Please add a developer/test panel for auditioning and verifying acoustic source synthesis. The panel should allow easy selection and real-time playback of any source from the full inventory without cluttering the sonar displays with all contacts at once.

Notes:
- Using a dev-only audition mode that swaps the active contact set with panel-managed debug sources while preserving a snapshot of normal gameplay contacts for restoration on close.
- Key integration points: `GameOrchestrator`, `WorldModel`, `AudioSystem`, `TacticalView`, and a new dev panel module.
- Added a fixed overlay panel toggled by `F9` and auto-opened by `?debugAudio=1`. Added `?autostart=1` for deterministic browser validation.

TODO:
- Consider adding a dedicated global environment profile selector inside the panel instead of only driving it through test presets.
- Consider exposing explicit own-ship depth/duct controls if deeper propagation experiments are needed.

Completed:
- Added live target add/remove/update hooks for audio and tactical rendering.
- Added a dev-only acoustic source panel with grouped browser, isolate mode, presets, source controls, and parameter sweep.
- Verified browser behavior with Playwright screenshots:
  - `output/dev-audio-panel/full-page.png`
  - `output/dev-audio-panel/whale-merchant-isolate.png`
- Validation commands:
  - `npm test`
  - `npm run lint`

2026-03-24:
- Auditing DEMON/synthesis integration for passive-sonar validation.
- Updated the Rust cavitation path to build per-blade pulse envelopes from shaft phase so cavitation broadband is explicitly blade-pass AM encoded.
- Replaced the DEMON static trace renderer with a rolling 0-50 Hz waterfall buffer in `src/sonar-visuals.js`; pending validation/tuning.

2026-03-25:
- Root-caused persistent LOFAR/Broadband freeze to the frontend analysis gate in `src/sonar-visuals.js`: if one async LOFAR FFT promise wedges, `_lofarPending` stays set and the 30 Hz scheduler stops dispatching new analysis work.
- Added explicit capture/dispatch/resolve/render debug logging, per-stage draw exception traps, and a 250 ms LOFAR watchdog that clears the stuck pending state, drops stale `lofarSpectrum`, and falls back to live analyser bins / CPU FFT.
- Added regression coverage in `tests/sonar-integration.test.js` for a never-resolving LOFAR compute promise.
