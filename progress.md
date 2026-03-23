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
