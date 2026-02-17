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
- optional fields: `type`, `classId`, `speed`, `rpm`, `bladeCount`, `isPatrolling`, `patrolRadius`

Validation rules are enforced by `validateScenarioDefinition(...)` in `src/data/scenario-loader.js`.

## Class Defaults

Ship/subclass defaults and signatures live in:
- `src/data/ship-signatures.js`

If a target has `classId`, class defaults are merged before creating `SimulationTarget`.

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
