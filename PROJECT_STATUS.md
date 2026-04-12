# Project Status

Snapshot updated: 2026-04-12

## Overall state

The application is functional, deployable, and under active internal cleanup.

### User-facing capabilities already in place

- FIT file loading and parsing in Rust/WASM
- CSV activity loading and normalization into the same frontend activity model
- Standard VE workflow for a selected activity slice
- GPS-lap workflow with multi-lap VE, wind, power, and virtual-distance views
- Out-and-back workflow with section-based VE, wind, power, and virtual-distance views
- Map-based ride visualization and trim selection for GPS activities
- Constant-wind and FIT-air-speed-driven analysis paths
- Elevation correction via remote terrain tiles and local DEM files
- Local persistence for parameters and stored analysis results
- Screenshot/result export features in the UI
- GitHub Pages deployment pipeline with backend tests and frontend check/lint/test/build

## Quality gates currently enforced

CI and local validation now cover:

```bash
cd backend && cargo test --lib
cd backend && wasm-pack build --target web --out-dir ../frontend/pkg
cd frontend && npm run check
cd frontend && npm run lint
cd frontend && npm run test
cd frontend && npm run build
```

## Current architecture snapshot

### Frontend

The frontend has been partially decomposed from a single god-module into focused areas:

- `frontend/src/state/AppState.ts` — typed application state
- `frontend/src/activity/ActivityLoader.ts` — FIT/CSV normalization
- `frontend/src/analysis/*` — slice extraction, wind resolution, cached arrays, VE helpers
- `frontend/src/modes/analysis/*` — standard / GPS-lap / out-and-back mode handlers
- `frontend/src/plots/*` — pure figure/trace builders
- `frontend/src/utils/*` — storage, DEM, weather, logging, validation helpers
- `frontend/src/styles/index.css` — extracted stylesheet for the static shell

The main remaining frontend structural issue is that `frontend/src/main.ts` still owns a large amount of DOM composition, HTML-string templating, and event wiring.

### Backend

The backend is organized around a small number of focused Rust/WASM modules:

- `fit_parser.rs` — FIT parsing
- `virtual_elevation.rs` — VE calculations and result types
- `air_density.rs` — air-density calculations
- `dem_processor.rs` + `dem_processor/*` — DEM loading, projection, and sampling
- `security.rs` — small internal FIT validation helper

The recent backend refactors already removed major duplication from `virtual_elevation.rs` and split the large DEM module into submodules.

## Known gaps / active cleanup areas

These are the main remaining engineering issues, not blockers for using the app:

1. `frontend/src/main.ts` is still too large and UI-heavy.
2. Some generated HTML in TypeScript still uses inline styling even though `index.html` styling was extracted.
3. Web-worker offloading is **not** implemented yet and is intentionally deferred until profiling justifies it.
4. Frontend automated test coverage exists, but it is still small relative to the codebase.

## Current priorities

Short-term priorities are tracked in:

- [REFACTORING_CHECKLIST.md](REFACTORING_CHECKLIST.md)
- [ROADMAP.md](ROADMAP.md)

For architecture details, see [ARCHITECTURE.md](ARCHITECTURE.md).
