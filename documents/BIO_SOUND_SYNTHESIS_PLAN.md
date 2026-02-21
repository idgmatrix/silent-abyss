# Biological Sound Synthesis Expansion Plan

This document defines a practical, backward-compatible upgrade path for expanding sonar biological synthesis from a single chirp model to multiple sound families.

## Objective

Provide a richer and more realistic acoustic environment by simulating multiple marine-life-like sources while keeping CPU cost predictable and preserving current behavior by default.

## Scope and Non-Goals

- In scope:
  - Multiple biological synthesis modes in Rust DSP core.
  - New controllable DSP parameters for mode selection and event rate.
  - End-to-end parameter plumbing through Wasm and AudioWorklet layers.
  - Scenario schema extensions for selecting biological sound profiles.
- Out of scope (initial rollout):
  - Sample-based playback.
  - Spatialization changes (handled by existing pipeline).

## Proposed Biological Sound Types

| Sound Type | Acoustic Profile | Primary Algorithm |
| :--- | :--- | :--- |
| **Chirp (Existing)** | Rapid downward/upward short sweep | Frequency ramp + fast decay envelope. |
| **Snapping Shrimp** | Dense crackling transients | 1-2ms broadband noise bursts with Poisson-like jitter. |
| **Whale Moan** | Low, resonant, slow-moving tone | Low-frequency oscillator + slow FM + resonant body filter. |
| **Dolphin Whistle** | Tonal, curved high-frequency calls | Multi-oscillator tone with procedural frequency contours. |
| **Echolocation Click** | Sharp, pulse-train clicks | Precision pulse generator with controllable PRF. |
| **Humpback Song** | Structured phrase-like sequence | State-machine sequencing of moan/whistle units. |

## Parameter Spec

Extend DSP parameter IDs in `src/audio/dsp-core/src/lib.rs` from the current set (`PARAM_RPM`..`PARAM_BIO_MIX`) as follows:

- `PARAM_BIO_TYPE` (ID: 6)
  - Type: discrete enum encoded as `f32`
  - Accepted values (rounded/clamped):
    - `0 = Chirp`
    - `1 = SnappingShrimp`
    - `2 = WhaleMoan`
    - `3 = DolphinWhistle`
    - `4 = EcholocationClick`
    - `5 = HumpbackSong`
  - Default: `0`
  - Clamp: `[0, 5]`, then round to nearest integer.

- `PARAM_BIO_RATE` (ID: 7)
  - Type: continuous `f32`
  - Unit: normalized control `[0.0, 1.0]`
  - Meaning: mode-specific event density / phrase tempo control
    - Chirp: trigger interval scaling
    - SnappingShrimp: transient density
    - Whale/Dolphin: contour change speed + phrase pacing
    - Echolocation: pulse repetition frequency scaling
    - Humpback: unit transition rate
  - Default: `0.35`
  - Clamp: `[0.0, 1.0]`

Existing IDs and behavior remain unchanged:
- `PARAM_BIO_MIX` stays ID `5`.

## DSP State Architecture

Use mode-safe enum state instead of unsafe unions:

```rust
#[derive(Clone, Copy)]
enum BioType {
    Chirp = 0,
    SnappingShrimp = 1,
    WhaleMoan = 2,
    DolphinWhistle = 3,
    EcholocationClick = 4,
    HumpbackSong = 5,
}

#[derive(Clone, Copy)]
enum BioModeState {
    Chirp(ChirpState),
    SnappingShrimp(SnappingShrimpState),
    WhaleMoan(WhaleMoanState),
    DolphinWhistle(DolphinWhistleState),
    EcholocationClick(EcholocationClickState),
    HumpbackSong(HumpbackSongState),
}

struct BioState {
    bio_type: BioType,
    bio_rate: f32,
    // Short smoothing for click-free mode transitions
    mode_xfade: f32,
    mode_xfade_step: f32,
    prev_out: f32,
    mode_state: BioModeState,
}
```

Rationale:
- Enum-backed per-mode state is easier to maintain safely in Rust/Wasm.
- Explicit per-mode structs keep parameters and transient state isolated.

## Runtime Switching and Click-Free Behavior

When `PARAM_BIO_TYPE` changes at runtime:

1. Initialize fresh state for new mode.
2. Crossfade from previous mode output to new mode output for 10-20ms.
3. Apply per-sample smoothing to exposed continuous controls (`BIO_RATE`, optional future tone controls).

Rules:
- No hard reset to DC-discontinuous output.
- Preserve deterministic behavior under fixed seed and identical param automation.

## Algorithm Notes by Type

- **Chirp**
  - Preserve existing behavior as baseline.
  - `BIO_RATE` scales mean time between chirps.

- **Snapping Shrimp**
  - Trigger short filtered noise bursts at jittered intervals.
  - Density cap per sample/block to avoid pathological CPU spikes.

- **Whale Moan**
  - Low-band focus with slowly moving target pitch.
  - Add resonant body shaping in ~40-300Hz band.

- **Dolphin Whistle**
  - High-band tonal focus (~3kHz-15kHz).
  - Generate smooth contours with bounded slope to prevent alias-like artifacts.

- **Echolocation Click**
  - Pulse-train generator with stable timing.
  - `BIO_RATE` maps to PRF range (document final mapped Hz in code constants).

- **Humpback Song**
  - Phrase state machine selecting among predefined unit templates.
  - Unit sequence selection uses deterministic RNG per voice.

## Integration Pipeline

1. Rust core (`src/audio/dsp-core/src/lib.rs`):
   - Add `PARAM_BIO_TYPE` and `PARAM_BIO_RATE` constants.
   - Extend `set_param` handling with clamp/round rules.
   - Implement `BioType` and mode-dispatched `tick`.

2. Wasm exports:
   - Add `param_bio_type()` and `param_bio_rate()` export functions.

3. AudioWorklet (`src/audio/worklets/wasm-engine.worklet.js`):
   - No protocol change needed beyond sending numeric param IDs/values.
   - Keep failed set-param reporting for invalid values/voice IDs.

4. JS manager (`src/audio/wasm-audio-manager.js`):
   - Add param IDs:
     - `BIO_TYPE: 6`
     - `BIO_RATE: 7`
   - Add helpers:
     - `setBioType(value, voiceId)`
     - `setBioRate(value, voiceId)`

5. Scenario integration:
   - Extend ambient/contact config with optional bio profile fields (see schema section).

## Scenario Schema Changes

Add optional fields to scenario sound emitters/zones that already drive ambient audio:

- `bioType`: string enum
  - Allowed: `"chirp" | "snapping_shrimp" | "whale_moan" | "dolphin_whistle" | "echolocation_click" | "humpback_song"`
  - Default: `"chirp"`

- `bioRate`: number in `[0.0, 1.0]`
  - Default: `0.35`

Example:

```json
{
    "ambient": {
        "biological": {
            "enabled": true,
            "bioType": "snapping_shrimp",
            "bioRate": 0.8,
            "bioMix": 0.3
        }
    }
}
```

Mapping rule (JS side):
- Convert `bioType` string to `PARAM_BIO_TYPE` integer.
- Clamp `bioRate` before sending to DSP.

## Backward Compatibility

- Existing scenarios with no new fields must sound unchanged.
- Default voice initialization:
  - `bio_type = Chirp`
  - `bio_rate = 0.35`
- Existing `BIO_MIX` behavior and ID (`5`) remain unchanged.
- Unknown scenario `bioType` values fall back to `chirp` with a warning.

## Performance Budget and Guardrails

Target budget (desktop baseline):
- Biological synthesis contribution should stay within practical real-time limits for the current worklet block size (`128` frames default).
- Avoid unbounded per-sample inner loops.

Guardrails:
- Cap maximum events per block for bursty modes (especially snapping shrimp).
- Prefer simple filters/oscillators first; add lookup tables only if profiling shows benefit.
- Keep all synthesis in Wasm memory; avoid per-sample JS/Wasm chatter.

## Testing and Acceptance Criteria

Required before merge:

1. Unit tests (Rust DSP):
   - Param clamp/round behavior for new params.
   - Mode-switch behavior does not produce NaN/Inf.
   - Deterministic output under fixed seed and fixed automation.

2. Integration tests (JS/Worklet boundary):
   - `setBioType` and `setBioRate` route correct IDs/values.
   - Invalid voice ID/param paths keep current failure signaling.

3. No-regression checks:
   - Chirp mode waveform envelope/frequency behavior remains consistent with current baseline.
   - Existing scenarios without new fields preserve current audible behavior.

4. Performance sanity:
   - Stress test with maximum active voices configured in project defaults.
   - Confirm no audible dropouts on representative dev hardware.

## Phased Rollout

Phase 1 (lowest risk):
- Add framework + params + `Chirp` + `SnappingShrimp`.
- Land tests for param handling and deterministic scheduling.

Phase 2:
- Add `WhaleMoan`, `DolphinWhistle`, `EcholocationClick`.
- Validate tonal quality and CPU impact.

Phase 3:
- Add `HumpbackSong` state-machine mode.
- Tune phrase sequencing and scenario authoring guidance.

## Implementation Status

- Status: Implemented
- Delivered modes (`PARAM_BIO_TYPE`):
  - `0 = Chirp`
  - `1 = SnappingShrimp`
  - `2 = WhaleMoan`
  - `3 = DolphinWhistle`
  - `4 = EcholocationClick`
  - `5 = HumpbackSong`
- Delivered controls:
  - `PARAM_BIO_TYPE` (ID `6`)
  - `PARAM_BIO_RATE` (ID `7`)
- Scenario fields delivered:
  - `bioType` and `bioRate` on targets (validated and normalized)

## Implementation Checklist

- [x] Add new param constants in DSP core.
- [x] Extend `Voice/BioState` with mode and rate.
- [x] Implement mode dispatcher and per-mode state structs.
- [x] Add crossfade-on-mode-switch logic.
- [x] Export new param ID accessors from Wasm.
- [x] Update `wasm-audio-manager.js` param map and helper methods.
- [x] Extend scenario schema + parser/mapping.
- [x] Add/extend tests for DSP + integration + regression.
- [x] Verify `npm test && npm run lint && npm run build`.

---
*Revised: 2026-02-21 (implemented through Phase 3)*
