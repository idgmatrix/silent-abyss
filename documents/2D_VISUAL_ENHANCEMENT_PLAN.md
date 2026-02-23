# 2D Visual Enhancement Plan

## Objective
Enhance the visual quality and readability of both 2D views (`tactical-renderer-2d.js` and `sonar-visuals.js`) while preserving behavior, performance, and fallback safety.

## Scope Summary
- Introduce shared visual tokens and mode presets.
- Refactor both renderers into clear layered draw passes.
- Add tactical and sonar-specific visual upgrades.
- Improve interaction feedback and labeling clarity.
- Roll out behind a feature flag with full test/lint/build validation.

## Task Breakdown

### 1) Add shared 2D visual tokens (Priority: P0)
Files:
- `src/render-style-tokens.js` (new)
- `src/main.js` or central config source

Work:
- Define tactical palette, sonar palette, and neutral HUD colors.
- Define line weights, alpha levels, glow strengths, and animation timings.
- Add mode presets: `stealth`, `engagement`, `alarm`.
- Wire selected visual mode and feature flag: `enhanced2DVisuals`.

### 2) Refactor Tactical 2D into layered render passes (Priority: P0)
Files:
- `src/tactical-renderer-2d.js`

Work:
- Extract render flow into:
  - `drawBackground`
  - `drawReferenceGeometry`
  - `drawTracks`
  - `drawContacts`
  - `drawLabels`
  - `drawFx`
  - `drawHud`
- Preserve current behavior first, then replace hardcoded style values with tokens.
- Cache static background/grid rendering for performance.

### 3) Refactor Sonar 2D into layered render passes (Priority: P0)
Files:
- `src/sonar-visuals.js`

Work:
- Apply the same layered pass structure adapted for sonar rendering.
- Tokenize sweep, ring, echo, and label styling.
- Add hooks for ping pulse and decay-based visuals.

### 4) Tactical visual upgrades (Priority: P1)
Files:
- `src/tactical-renderer-2d.js`

Work:
- Improve plotting-table background and reference grid styling.
- Add contact glyph mapping by class.
- Add confidence-driven styling (sharp vs soft/jittered rendering).
- Add threat rings, predicted dashed path, last-known ghost marker, and trail decay.

### 5) Sonar visual upgrades + sync events (Priority: P1)
Files:
- `src/sonar-visuals.js`
- `src/simulation.js` (or event source)

Work:
- Add radial sweep pulse, echo fade, and subtle noise layer.
- Add active sonar ping flash timing cues.
- Sync ping cue with tactical FX trigger.

### 6) Interaction polish (Priority: P2)
Files:
- `src/tactical-view.js`
- Relevant renderer files

Work:
- Add hover/selected states (ring/bracket treatment).
- Add compact tooltip card for key metrics.
- Add label collision nudging to reduce overlap.
- Add pan/zoom easing and optional snap-to-contact behavior.

### 7) Feature-flag fallback path (Priority: P0)
Files:
- `src/main.js`
- `src/tactical-view.js`
- Renderer entry points

Work:
- Gate old/new rendering path behind `enhanced2DVisuals`.
- Keep fallback path available for quick rollback and comparison.

### 8) Tests + snapshots (Priority: P0)
Files:
- `tests/` (new/updated)

Work:
- Add/update tests for:
  - mode selection
  - confidence style selection
  - trail decay behavior
- Update snapshots intentionally for both 2D views.
- Validate with:
  - `npm test`
  - `npm run lint`
  - `npm run build`

### 9) Docs + visual evidence (Priority: P1)
Files:
- `documents/` (new short implementation note or update this file)

Work:
- Document token schema, mode behavior, and fallback flag usage.
- Capture before/after screenshots for tactical and sonar views.

## Priority Guidance
- `P0`: Foundation and safety-critical work needed for stable rollout.
- `P1`: Core visual improvements that deliver the main quality gains.
- `P2`: Nice-to-have polish that can be deferred without blocking release.
- Scope-trimmed path:
  - Defer tooltip card (`P2`).
  - Defer snap-to-contact behavior (`P2`).
  - Defer sonar noise layer (part of `P1` visual polish).

## Recommended Execution Order
1. Shared tokens and mode config
2. Tactical layering refactor
3. Sonar layering refactor
4. Feature flag wiring
5. Tactical visual upgrades
6. Sonar visual upgrades and event sync
7. Interaction polish
8. Tests/snapshots/lint/build validation
9. Final docs and screenshot evidence

## Validation Checklist Before Merge
- `npm test` passes
- `npm run lint` passes
- `npm run build` passes
- Feature flag fallback path verified
- Visual diffs reviewed and accepted
