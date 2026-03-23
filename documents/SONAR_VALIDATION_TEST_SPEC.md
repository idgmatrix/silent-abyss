# Sonar Validation Test Spec

This document defines the executable validation spec for LOFAR/DEMON realism and maps it to the current test harness in `tests/sonar-validation-regression.test.js`.

## Goal

Keep sonar realism regressions measurable at the display level:

- LOFAR must preserve expected tonal evidence and broadband regime shifts.
- DEMON must recover blade-pass structure from synthesized contacts.
- Environment state must contribute measurable masking or gain budgets for scenario scoring.

The test target is not "sounds good." The test target is "produces tactically meaningful evidence on the operator displays."

## Current Executable Coverage

Current regression scenarios are defined in [tests/fixtures/sonar-validation-scenarios.js](/home/kaswan/silent-abyss/tests/fixtures/sonar-validation-scenarios.js) and exercised by [tests/sonar-validation-regression.test.js](/home/kaswan/silent-abyss/tests/sonar-validation-regression.test.js).

Implemented now:

- merchant cruise tonal stability
- cavitation baseline vs heavy-cavitation comparison
- submarine vs merchant high-band cleanliness comparison
- environment masking-budget hook check

The analysis helper lives in [tests/support/sonar-validation-harness.js](/home/kaswan/silent-abyss/tests/support/sonar-validation-harness.js).

## Scenario Spec

Each validation scenario should be represented as a deterministic object with these fields:

```js
{
    name: 'merchant-cruise',
    sampleRate: 4096,
    frameSize: 1024,
    frames: 96,
    synthConfig: {
        rpm: 216,
        bladeCount: 5,
        shaftRate: 216 / 60,
        load: 0.66,
        rpmJitter: 0.07,
        classProfile: 2,
        cavitationLevel: 0.18
    },
    target: {
        id: 'merchant-01',
        type: 'SHIP',
        rpm: 216,
        bladeCount: 5,
        shaftRate: 216 / 60
    }
}
```

Required fields:

- `name`: stable identifier used in tests and future artifact names
- `sampleRate`, `frameSize`, `frames`: deterministic render settings
- `synthConfig`: Rust/WASM voice parameters
- `target`: DEMON lock expectations for the selected-contact path

Planned extension fields:

- `environment`: sea state, thermocline crossing, CZ band, precipitation
- `expected`: metric thresholds stored with the fixture instead of hardcoded in tests
- `artifacts`: optional PNG/JSON outputs for review workflows

## Metric Definitions

The harness currently uses simple deterministic metrics that are cheap enough for CI.

LOFAR metrics:

- `measureLocalContrast(spectrum, hz)`: target-bin magnitude divided by nearby-bin baseline
- `countVisibleHarmonics(spectrum, fundamentalHz, harmonicCount, minContrast)`: counts harmonic bins that remain locally prominent
- `measureBandEnergy(spectrum, startHz, endHz)`: mean energy across a frequency band
- `measureSpectralSlope(spectrum, startHz, endHz)`: linear fit of `log(magnitude)` over `log(frequency)`

DEMON metrics:

- `computeDemonMetrics(...)`: runs the same WASM DEMON spectrum function used by runtime code
- `runSelectedTargetDemonLock(...)`: runs the selected-target tracker through `SonarVisuals`
- lock acceptance is based on bounded acquisition time, final state, and BPF error tolerance

Environment hook metrics:

- `getAmbientNoise(...)`: provides a masking proxy for scenario difficulty
- `getAcousticModifiers(...)`: provides positive duct/CZ recovery terms that can be folded into future scenario scoring

## Initial Acceptance Thresholds

The current regression suite enforces these initial thresholds:

- Merchant cruise:
  - LOFAR BPF local contrast > `2.0`
  - at least `3` visible harmonics in the first `4`
  - DEMON local BPF evidence recoverable within `3 Hz`
  - DEMON local contrast at the expected BPF > `1.3`
  - selected-target lock within `120` frames
  - tracker BPF error within `12%`

- Heavy cavitation:
  - high-band LOFAR energy > baseline by at least `25%`
  - spectral slope must flatten relative to baseline
  - DEMON local BPF evidence still recoverable within `4 Hz`

- Submarine vs merchant:
  - submarine high-band energy < merchant by at least `10%`
  - submarine slope remains steeper than merchant in the same band

These are deliberately conservative starting gates. They should be tightened after more source classes and propagation effects are wired in.

## Execution Model

Tests use the real Rust/WASM DSP voice path:

1. Render deterministic sample blocks through `DspGraph`.
2. Analyze LOFAR using a reference offline spectrum helper.
3. Analyze DEMON using the production WASM DEMON function.
4. Drive the selected-target lock tracker through `SonarVisuals`.

This gives two useful guarantees:

- source changes in Rust are exercised directly
- tracker/display regressions are visible separately from raw-source regressions

## Known Gaps

This spec is ahead of the current runtime in a few places:

- thermocline and convergence-zone effects are not yet applied to synthesized analysis audio
- there is no artifact-emission pipeline for spectrogram snapshots yet
- biologics and aircraft are not covered by the executable suite yet
- LOFAR testing currently uses a deterministic reference analyzer, not the WebGPU LOFAR path

Those gaps are intentional for now. The current suite is meant to lock down the core propulsion-signature path before propagation and mixed-contact cases are added.
