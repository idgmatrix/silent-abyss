# Repository Guidelines

## Project Structure & Module Organization
- `src/`: application source (ES modules).
  - Core runtime: `main.js`, `world-model.js`, `simulation.js`.
  - Rendering: `tactical-renderer-3d.js`, `tactical-renderer-2d.js`, `tactical-view.js`, `sonar-visuals.js`.
  - Data-driven content: `src/data/` (ship signatures, scenarios, missions).
  - Audio: `src/audio/` (AudioWorklet + Wasm DSP integration).
  - Campaign and operator systems: `contact-manager.js`, `campaign-manager.js`, `depth-profile-display.js`.
- `tests/`: Vitest suites (unit + smoke + snapshot tests).
- `documents/`: developer and player documentation.
- `.github/workflows/ci.yml`: CI pipeline (`lint`, `test`, `build`).

## Build, Test, and Development Commands
- `npm run dev`: start Vite dev server at `http://localhost:5173`.
- `npm run build`: production build to `dist/`.
- `npm run preview`: serve built output locally.
- `npm test`: run all Vitest tests (including snapshots/smoke).
- `npm run lint`: run ESLint across repo.
- `npm run format` / `npm run format:check`: apply/check Prettier formatting.

## Coordinate System
- Detailed in `documents/Technical_Guide_Submarine_Follow_Cam.md`.
- **Model / 2D Space**: `+X` = East, `+Z` = North, `+Y` = Up. Course (in radians): 0 = North, increases clockwise.
- **Three.js 3D View**: The scene space mirrors the model on Z (`sceneZ = -modelZ`) because Three.js uses a right-handed system (-Z is forward).

## Coding Style & Naming Conventions
- Language: modern JavaScript (ESM), browser-first.
- Indentation: 4 spaces; keep code and comments concise.
- Naming:
  - files: kebab-case (e.g., `scenario-loader.js`)
  - classes: PascalCase (e.g., `CampaignManager`)
  - variables/functions: camelCase
  - constants: UPPER_SNAKE_CASE
- Use ESLint + Prettier as source of truth; do not merge with lint errors.

## Testing Guidelines
- Framework: Vitest.
- Test files: `*.test.js` under `tests/`.
- Keep tests deterministic (seeded RNG where applicable).
- Update snapshots intentionally (`tests/__snapshots__/...`) and review diffs carefully.
- Before PR: run `npm test && npm run lint && npm run build`.

## Commit & Pull Request Guidelines
- Commit style in this repo is short, imperative, and scope-focused (e.g., `Add campaign vertical slice...`).
- Prefer small, reviewable commits by feature/fix.
- PRs should include:
  - clear summary of behavior changes
  - affected files/modules
  - validation evidence (test/lint/build results)
  - screenshots or short clips for UI/visual changes
  - notes on data/schema changes (`src/data/*`) and docs updates when relevant.
