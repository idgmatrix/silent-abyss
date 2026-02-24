# 2D Terrain/Isoline Profiling Notes (2026-02-24)

## Context
- Issue: periodic shutter/stutter in 2D tactical view while own-ship moves.
- Profiling toggles used:
  - `profile2dTerrain=1`
  - `profileTerrain=1`

## Captured Evidence

### 2D contour profiler (`[perf][2d-contours]`)
Observed samples (from console screenshots):
- `avgLookup`: ~`1.6ms` on warm cache, up to ~`7.6ms` during churn.
- `avgGenMiss`: repeatedly ~`89ms` to `93ms`.
- `avgStroke`: ~`0.0ms` to `0.01ms`.
- Cache miss rate: varies (`~1.7%` to `~8.3%`) but misses still occur continuously.
- `cacheSize`: stable at `28` (cache cap), indicating evictions/churn.

Interpretation:
- Expensive part is contour generation on miss, not canvas stroke.
- Even modest miss rates cause visible hitches because each miss is very expensive.

### 3D terrain profiler (`[perf][3d-terrain]`)
Observed samples:
- `maxTerrain`: frequently ~`25ms` to `33ms`.
- One large spike around `175ms`.
- `recenter`: often `0` or `1` per interval.
- `skipped=0` during capture.

Interpretation:
- Terrain recenter/update path causes periodic spikes.
- Hidden 3D work is still active while in 2D (`skipped=0`), competing with 2D frame budget.

## Conclusion
Primary stutter source:
1. 2D isoline cache misses causing ~90ms generation spikes.

Secondary stutter source:
2. Hidden 3D terrain recenter/update spikes (25-33ms typical, occasional very large spike).

## Recommended Patch Order (when resuming)
1. In 2D mode, stop or strongly throttle hidden 3D terrain updates.
2. Coarsen 2D contour cache key and remove camera-offset from key (apply offset as draw transform).
3. Move contour generation off main thread (Worker). Consider WASM after Worker path if needed.

## Quick Re-Profile Checklist
After each patch step:
1. Run with same toggles.
2. Perform same own-ship maneuver pattern for 60-90s.
3. Compare:
   - `avgGenMiss`, miss rate, and max spikes in `[perf][2d-contours]`
   - `maxTerrain`, `avgRender`, and `skipped` in `[perf][3d-terrain]`
4. Keep logs/screenshots with timestamp.

