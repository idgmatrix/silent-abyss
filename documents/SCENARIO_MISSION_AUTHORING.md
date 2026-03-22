# Scenario and Mission Authoring

This project uses data-driven scenario and campaign definitions.

## Scenario Data

Primary files:
- `src/data/scenarios/default-scenario.js`
- `src/data/scenario-loader.js`

Scenario shape:
- `id`: unique scenario id
- `name`: display name
- `coreTargets`: fixed target list
- `procedural`: generator settings for additional contacts

Each `coreTargets` entry requires:
- `id`
- position via either `(x, z)` or `(distance, angle)`
- optional fields: `type`, `classId`, `speed`, `rpm`, `bladeCount`, `shaftRate`, `isPatrolling`, `patrolRadius`, `bioType`, `bioRate`

Propulsion audio fields for `SHIP`, `SUBMARINE`, and `TORPEDO` targets:
- `rpm`: number in `[0, 2000]`
- `bladeCount`: integer in `[0, 12]`
- `shaftRate`: number in `[0, 120]`
- `load`: number in `[0.0, 1.0]`
- `rpmJitter`: number in `[0.0, 1.0]`
- `cavitationLevel`: number in `[0.0, 1.0]`
- `classProfile`: integer in `[0, 4]`

These propulsion fields are optional:
- if omitted, the runtime uses class presets from `src/data/ship-signatures.js`
- if provided, the scenario value overrides the preset for that target
- validation happens before normalization, so out-of-range values are rejected rather than clamped silently

`classProfile` meanings:
- `0`: generic surface contact
- `1`: submarine
- `2`: merchant / large surface ship
- `3`: small craft / trawler
- `4`: torpedo / fast propulsor

What the propulsion fields do:
- `shaftRate`: decouples shaft family from blade-pass family
- `load`: increases machinery-tone drive and helps push cavitation onset
- `rpmJitter`: adds low-rate wander to tonal families
- `cavitationLevel`: directly increases cavitation regime/intensity
- `classProfile`: selects the broad propulsion/acoustic family in the WASM DSP

Biological audio fields:
- `bioType`: `"chirp" | "snapping_shrimp" | "whale_moan" | "dolphin_whistle" | "echolocation_click" | "humpback_song"`
- `bioRate`: number in `[0.0, 1.0]`
- These are optional and default to existing behavior when omitted.

Validation rules are enforced by `validateScenarioDefinition(...)` in `src/data/scenario-loader.js`.

Example target with propulsion overrides:

```js
{
    id: 'target-merchant-01',
    distance: 85,
    angle: Math.PI * 0.4,
    type: 'SHIP',
    classId: 'cargo-vessel',
    speed: 0.9,
    rpm: 132,
    bladeCount: 4,
    shaftRate: 2.2,
    load: 0.74,
    rpmJitter: 0.12,
    cavitationLevel: 0.58,
    classProfile: 2,
    isPatrolling: true,
    patrolRadius: 75
}
```

Authoring guidance:
- Prefer `classId` plus defaults for most targets.
- Add propulsion overrides only when a scenario needs a contact to sound or analyze differently from its normal class behavior.
- If you want a quieter submarine, reduce `cavitationLevel` and `rpmJitter` first.
- If you want a rougher merchant or fishing contact, increase `load` and `cavitationLevel`.
- Keep `shaftRate` aligned with `rpm / 60` unless you intentionally want unusual propulsion behavior.

## Class Defaults

Ship/subclass defaults and signatures live in:
- `src/data/ship-signatures.js`

If a target has `classId`, class defaults are merged before creating `SimulationTarget`.
Those signatures also define propulsion acoustic presets used by the WebAssembly DSP.

## Mission Data

Primary file:
- `src/data/missions.js`

Mission shape:
- `id`
- `name`
- `briefing`
- `objectives[]`

Objective types currently supported:
- `TRACK_CONTACTS_MIN`
- `CONFIRM_CLASSIFICATION`
- `SAVE_MANUAL_SOLUTION`
- `HAS_ENVIRONMENTAL_ADVANTAGE`

Runtime evaluation lives in `src/campaign-manager.js`.

## Testing Guidance

Use these tests after editing scenario/mission data:
- `tests/scenario-loader.test.js`
- `tests/scenario-snapshot.test.js`
- `tests/campaign.test.js`
- `tests/campaign-smoke.test.js`
