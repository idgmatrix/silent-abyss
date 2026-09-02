# 2D Terrain Performance Plan: Shader Height-Band Rendering

## Goal
Remove the current 2D isoline generation bottleneck (CPU marching squares) by replacing it with GPU fragment-shader height-band coloring.

## Decision
- Do not optimize by frame skipping.
- Do not prioritize 2D Canvas draw-path optimizations first.
- Replace marching-squares isoline generation with shader-based terrain bands.

## Why
- Current bottleneck is isoline generation, not drawing.
- Disabling contour drawing while keeping generation still causes stalls.
- Shader banding moves terrain visualization cost from CPU path generation to GPU rasterization.

## Proposed Architecture
1. Add a new terrain layer renderer path for 2D tactical view (WebGL/WebGPU-backed).
2. Render a screen-aligned quad (or orthographic plane) covering tactical viewport.
3. In fragment shader:
- Map fragment coordinates to world X/Z using current tactical camera transform.
- Sample terrain height via terrain function/texture source.
- Convert height to depth bands using thresholds.
- Output band color with optional smoothing at band edges.
4. Keep contacts, symbols, labels, and HUD in existing 2D overlay layer.
5. Add runtime toggle to compare legacy contours vs shader bands.

## Visual Strategy
- Use depth bands to preserve tactical readability.
- Add subtle edge emphasis near thresholds (e.g., `smoothstep`) to mimic contour boundaries.
- Keep palette aligned with existing `render-style-tokens` visual modes.

## Implementation Phases
1. **Prototype path**
- Add optional shader terrain layer behind current 2D overlay.
- Hardcode a small set of depth thresholds and colors for validation.
2. **Integration**
- Wire thresholds/colors to existing visual mode tokens.
- Connect world/camera transform so panning/zoom/head-up remain correct.
3. **Migration**
- Add feature flag:
  - `legacy-contours` (current)
  - `shader-bands` (new)
- Keep both for A/B profiling.
4. **Cleanup**
- Remove/retire marching-squares contour generation after acceptance.

## Risks and Mitigations
- Risk: Banding may reduce contour precision.
  - Mitigation: edge emphasis and carefully tuned thresholds.
- Risk: Coordinate mismatch between 2D overlay and shader layer.
  - Mitigation: shared transform utilities and visual alignment test cases.
- Risk: Browser/GPU compatibility differences.
  - Mitigation: fallback to legacy mode via feature flag.

## Acceptance Criteria
- No visible main-thread stalls from terrain layer on camera movement.
- Tactical readability is at least equivalent to current contours.
- Overlay tracks/HUD alignment remains correct at all zoom/orientation states.
- Feature can be toggled at runtime for comparison.

## Deferred Work
- Exact isoline geometry in GPU pass (if needed later).
- Additional terrain stylization and animation polish.
