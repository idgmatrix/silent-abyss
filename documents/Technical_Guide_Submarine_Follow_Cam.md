# Technical Guide: Submarine Follow Cam and Coordinate System

This document describes the current tactical-view coordinate model and 3D follow-cam implementation in `silent-abyss`.

## 1. Canonical Coordinate Contract

All gameplay-space math (simulation, world model, 2D tactical) follows this contract:

- World axes:
  - `+X` = East
  - `+Z` = North
  - `+Y` = Up
- Course (`rad`):
  - `0` = North (`+Z`)
  - `+PI/2` = East (`+X`)
  - increases clockwise on a north-up chart

Shared helpers live in `src/coordinate-system.js`:

- `normalizeCourseRadians(course)`
- `forwardFromCourse(course)`
- `rightFromCourse(course)`
- `shipLocalToWorld(local, shipPosition, course)`
- `worldToShipLocal(world, shipPosition, course)`
- `bearingDegFromDelta(dx, dz)`

## 2. 3D Scene Mapping

Three.js scene usage is intentionally mirrored on Z for consistent visual orientation with tactical displays.

Model space -> scene space:

- `sceneX = modelX`
- `sceneZ = -modelZ`
- `sceneCourse = PI - modelCourse`

This mapping is implemented in `src/tactical-renderer-3d.js`:

- `modelToScenePosition(x, z)`
- `sceneCourseFromModelCourse(course)`
- `getTerrainHeightAtScene(sceneX, sceneZ)`

Targets, own ship, scan ring, marine snow, and terrain sampling all use this same conversion.

## 3. Follow Cam

3D camera is decoupled from ship hierarchy (camera is not parented to ship).

Per frame:

1. Compute ship world/scene pose.
2. Compute ideal camera and look-at points from ship-local offsets.
3. Smooth with exponential lerp.

Core offsets:

- `followCameraOffsetLocal = (0, 16, -42)`
- `followLookAtOffsetLocal = (0, 6, 45)`

Benefits:

- Stable rotation center on own ship.
- No violent camera swing when turning.
- Smooth lag with tunable responsiveness.

## 4. 3D Terrain Rendering

Terrain now has two overlays for readability and parity with 2D:

1. Orthogonal terrain grid lines (X/Z only), no triangle diagonals.
2. Marching-squares contour isolines.

Notes:

- The old triangle `wireframe` mode is disabled.
- Grid/contours update whenever the terrain chunk rec enters around own ship.
- Terrain chunk is snapped to a fixed grid to reduce shimmer.

## 5. 2D View Frames

2D rendering uses a shared frame conversion path:

- North-up (`grid`): world-relative, `+Z` appears up on screen.
- Head-up (`radial`): world points are transformed into ship local frame and then projected.

Target plotting, picking, and contour sampling all use consistent frame transforms.

## 6. Debug and Verification Overlay (Dev)

Coordinate debug tools are available in development builds.

Enable:

- URL query: `?debugCoords=1`
- or localStorage: `silentAbyss.debugCoords = "1"`

What is shown:

- HUD text (mode/course/speed/position/forward vector/selected target bearing+range)
- 3D arrows:
  - ship forward/right axes
  - world north/east axes
- 2D center vectors:
  - `N` (north), `E` (east), `F` (ship forward)

## 7. View Switching Behavior

3D renderer continues updating while hidden in 2D mode.

Reason:

- prevents state/camera catch-up jumps when switching from 2D to 3D.

