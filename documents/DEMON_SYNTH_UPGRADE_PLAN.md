# DEMON Synth Upgrade Plan

## Goal

Upgrade the propulsion synthesis path so DEMON analysis is driven by a more credible synthetic acoustic signal, while preserving the current WebAssembly + AudioWorklet architecture and keeping the DSP real-time safe.

This plan targets **synthetic training realism**, not full hydroacoustic simulation. The intent is to produce signals that:

- lock reliably at the expected blade-pass frequency (BPF),
- expose believable harmonic comb structure,
- vary by target class in a way operators can perceive and DEMON can exploit,
- change with RPM, load, and cavitation regime,
- remain cheap enough for current worklet block sizes and voice counts.

## Current State

The current DSP voice model in `src/audio/dsp-core/src/lib.rs` is:

- `EngineState`: multi-family shaft / blade / machinery tonal model
- `CavState`: regime-based cavitation model with class bias and burstiness
- `BioState`: separate biological synth family

Implemented so far:

- propulsion parameters exposed through JS and WASM:
  - `shaft_rate_hz`
  - `load`
  - `rpm_jitter`
  - `class_profile`
  - `cavitation_level`
- class acoustic presets in `src/data/ship-signatures.js`
- scenario-level propulsion overrides in `src/data/scenario-loader.js`
- real-WASM DEMON lock tests and cavitation-regime regression coverage

Remaining work is primarily tuning and authoring support, not basic signal-model plumbing.

## Acceptance Criteria

The upgrade is complete when the following are true.

### DEMON Lock

- Selected-target DEMON acquires lock on a synthesized propulsion target within a bounded number of frames.
- Estimated BPF is within 10% of the expected value for nominal test cases.
- Harmonic comb strength changes in a stable, explainable way as cavitation regime changes.

### Signal Quality

- Ship classes with different propulsion presets produce visibly different DEMON/LOFAR signatures.
- Submarines present lower broadband cavitation and smoother modulation than surface ships at similar BPF.
- High-load or high-speed targets produce stronger broadband cavitation and potentially less stable comb clarity.

### Runtime Safety

- No per-sample heap allocation in Rust audio code.
- The upgraded voice model remains stable at current worklet block size (`128` frames default).
- The project still passes `npm test`, `npm run lint`, and `npm run build`.

## Constraints

- Keep the current architecture:
  - Rust DSP core in WebAssembly
  - `AudioWorkletProcessor` owns DSP graph
  - JS side sends parameter updates per voice
- Preserve backward compatibility for existing scenarios where possible.
- Existing data that only supplies `rpm`, `bladeCount`, and target `type` must still render usable audio.
- Prioritize deterministic and cheap DSP building blocks:
  - oscillators,
  - one-pole filters,
  - simple envelope generators,
  - bounded random drift.

## Proposed DSP Parameter Additions

Add new voice-level parameters in the Rust DSP core and expose them through JS.

### Required

- `shaft_rate_hz`
  - Decouples shaft family from blade family when needed.
- `load`
  - Controls machinery tone strength and cavitation onset.
- `rpm_jitter`
  - Adds slow stochastic RPM/frequency wander.
- `cavitation_level`
  - Directly drives cavitation regime/intensity.
- `class_profile`
  - Selects a preset weighting/fingerprint family.

### Optional

- `machinery_profile`
  - Selects a tone family or preset sub-profile.
- `tonal_seed`
  - Gives deterministic per-target spectral variation.
- `analysis_bias`
  - Allows analysis voices to be slightly stricter than speaker voices if needed.

## Target Signal Model

Each propulsion voice should be treated as the sum of several families rather than one tonal source plus one noise source.

### 1. Shaft Family

Low-frequency shaft tones:

- shaft fundamental,
- low shaft harmonics,
- slow amplitude drift.

Purpose:

- add low-frequency structure independent from blade-pass harmonics,
- improve realism for slower and quieter targets.

### 2. Blade-Pass Family

Primary DEMON-driving family:

- BPF fundamental,
- multiple harmonics,
- modulation depth controlled by speed/load/cavitation state.

Purpose:

- preserve clear DEMON lock behavior,
- let class presets shape harmonic richness.

### 3. Machinery / Gear Family

Narrowband components not locked strictly to BPF:

- machinery tones,
- mild sidebanding or amplitude drift,
- class-dependent weighting.

Purpose:

- make contacts more identifiable,
- reduce the “single synthetic comb” feel.

### 4. Cavitation Family

Broadband and semi-structured noise with regimes:

- none / low,
- incipient,
- developed,
- heavy.

Behavior should vary with:

- RPM,
- load,
- cavitation control parameter,
- blade/shaft modulation depth.

Purpose:

- provide realistic broadband contribution,
- alter DEMON clarity in a believable way rather than acting as static shaped noise.

## Proposed Class Profiles

Initial class profiles should be simple enums or numeric IDs, with weights defined in Rust.

### Surface Merchant

- strong low machinery lines,
- moderate to high cavitation at load,
- broader, rougher acoustic footprint.

### Fishing Vessel / Small Craft

- higher apparent RPM,
- lighter machinery structure,
- sharper tonal family,
- faster cavitation onset.

### Submarine

- weaker machinery exposure,
- lower cavitation under nominal speed,
- smoother modulation and more restrained broadband energy.

### Torpedo / Fast Propulsor

- strong tonal drive,
- aggressive cavitation growth,
- less subtle broadband behavior.

## Recommended Rust Refactor Scope

### `EngineState`

Replace the current fixed harmonic recipe with a multi-family tonal generator:

- shaft oscillator group,
- blade-pass oscillator group,
- machinery oscillator group,
- slow drift state,
- preset-controlled weights.

Implementation rules:

- no heap allocation in `tick()`,
- use a small fixed number of oscillators per family,
- keep math bounded and deterministic.

### `CavState`

Replace the current single shaped-noise path with a regime-based model:

- broadband base,
- brightness control,
- modulation depth,
- irregular burstiness,
- regime transitions based on load/speed/cavitation.

Implementation rules:

- use low-cost filtering,
- no dynamic memory,
- no expensive spectral processing in the audio callback.

## JS / WASM Integration Plan

### `src/audio/dsp-core/src/lib.rs`

- add new parameter IDs,
- extend `Voice`,
- add profile defaults,
- update `set_param`,
- preserve existing defaults for older callers.

### `src/audio/wasm-audio-manager.js`

- expose new setters for added params,
- extend `paramIds`.

### `src/audio/worklets/wasm-engine.worklet.js`

- no major structural change expected,
- continue forwarding `SET_PARAM` messages.

### `src/audio-system.js`

- map target data and class profiles to new DSP params,
- configure both speaker and analysis voices,
- preserve current focus/ducking behavior.

### `src/data/ship-signatures.js`

- define class-to-profile mappings,
- optionally add preset overrides for realism tuning.

## Testing Plan

Current DEMON tests use hand-built synthetic carriers. That remains useful for isolating tracker logic, but the upgraded synth needs truth-path tests using actual DSP output.

### Keep

- existing tracker tests using synthetic carriers,
- masking and suppression tests,
- source-mode transition tests.

### Add

#### Real-Synth DEMON Lock Test

Use actual WASM-generated propulsion audio and verify:

- lock acquisition,
- BPF estimate accuracy,
- bounded convergence time.

#### Class Differentiation Test

Render two or more class presets at similar BPF and verify:

- spectra differ measurably,
- DEMON quality metrics are not identical.

#### Cavitation Regime Test

Sweep cavitation level / load and verify:

- broadband energy rises,
- comb clarity shifts in a controlled way,
- lock confidence changes predictably rather than randomly.

## Rollout Phases

### Phase 1

- add new params and defaults,
- upgrade `EngineState`,
- add one real-synth DEMON lock test.

Target result:

- richer tonal structure with minimal integration risk.

Status:

- complete

### Phase 2

- upgrade `CavState`,
- add class profiles and JS wiring,
- add cavitation and class differentiation tests.

Target result:

- propulsion contacts sound and analyze more like distinct target families.

Status:

- complete for initial implementation
- further preset balancing may still be needed after browser listen checks

### Phase 3

- tune performance and balancing,
- validate selected/composite behavior,
- refine presets and thresholds.

Target result:

- stable gameplay behavior with credible synthetic analysis signals.

## Risks

- Overcomplicating the synth can make DEMON less stable instead of more realistic.
- Excess broadband cavitation can swamp comb clarity and reduce operator readability.
- Too many oscillators per voice can increase CPU cost at higher voice counts.
- If class presets are too strong, contacts may feel gamey in a different way.

## Non-Goals

- full physical propeller simulation,
- fluid dynamics modeling,
- ray-traced or propagation-accurate underwater acoustics,
- replacing the current DEMON algorithm.

## Immediate Next Step

Implement Phase 1:

- add propulsion realism parameter IDs,
- refactor `EngineState` into multi-family tonal synthesis,
- add one DEMON test that uses real WASM-generated propulsion output.
