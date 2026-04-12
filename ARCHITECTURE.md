# Architecture

## Stack

- **Frontend:** TypeScript + Vite
- **Computation/parsing:** Rust compiled to WebAssembly via `wasm-pack`
- **Charts:** Plotly loaded in the browser
- **Map:** Leaflet
- **Persistence:** IndexedDB + localStorage
- **Deployment:** GitHub Pages via GitHub Actions

## High-level design

The project is a browser application with a clear runtime split:

- **Rust/WASM** owns numerical and parsing-heavy work
- **TypeScript** owns UI state, DOM updates, map/plot orchestration, and browser persistence

There is no application server for ride processing. The browser loads static assets, runs the WASM module locally, and optionally fetches third-party resources such as map tiles, weather data, or remote DEM tiles.

## Repository layout

```text
backend/
  src/
    air_density.rs
    dem_processor.rs
    dem_processor/
      geotransform.rs
      projection.rs
      sampler.rs
      tiff_loader.rs
    fit_parser.rs
    fitparser_wrapper.rs
    lib.rs
    security.rs
    utils.rs
    virtual_elevation.rs

frontend/
  src/
    activity/
    analysis/
    components/
    modes/analysis/
    plots/
    state/
    styles/
    utils/
    main.ts
  index.html
  package.json
  vite.config.ts
```

## Frontend architecture

### 1. Bootstrapping and UI orchestration

- `frontend/src/main.ts`

This file still initializes the application, wires DOM events, renders major HTML fragments, coordinates the map and plots, and connects the browser UI to the extracted modules.

It is smaller and more structured than before the refactor, but it remains the biggest frontend architectural debt.

### 2. State

- `frontend/src/state/AppState.ts`

`AppState` centralizes typed application state. It owns data/state slices such as:
- loaded activity
- current selection
- VE analysis state
- DEM state
- UI state

Important design choice: it owns **state only**, not DOM nodes or service singletons.

### 3. Activity loading and normalization

- `frontend/src/activity/ActivityLoader.ts`

This module normalizes FIT and CSV data into shared frontend types so downstream analysis code can work against one activity model instead of separate ad hoc shapes.

### 4. Analysis helpers

- `frontend/src/analysis/AnalysisInput.ts`
- `frontend/src/analysis/ActivityArrayCache.ts`
- `frontend/src/analysis/SegmentExtractor.ts`
- `frontend/src/analysis/WindSourceResolver.ts`
- `frontend/src/analysis/VeCalculatorFactory.ts`
- `frontend/src/analysis/SegmentSupplementarySeries.ts`

These modules handle:
- building typed analysis inputs
- extracting the currently selected slice/segment
- resolving wind sources and air-speed offsets
- caching normalized arrays used by VE recompute paths
- preparing supplementary series for GPS-lap and out-and-back visualizations

### 5. Analysis modes

- `frontend/src/modes/analysis/standardMode.ts`
- `frontend/src/modes/analysis/gpsLapMode.ts`
- `frontend/src/modes/analysis/outAndBackMode.ts`
- `frontend/src/modes/analysis/AnalysisModes.ts`

Mode handlers encapsulate the differences between standard, GPS-lap, and out-and-back workflows. This removed a large amount of direct branching from `handleAnalyze()`.

### 6. Plot builders

- `frontend/src/plots/StandardPlotBuilders.ts`
- `frontend/src/plots/MultiSegmentPlotBuilders.ts`
- `frontend/src/plots/PlotContext.ts`

These modules build Plotly-ready figures/traces/layouts. The intent is to keep plotting logic testable and separate from DOM lookups and tab wiring.

### 7. Components and browser services

Key modules include:
- `frontend/src/components/FitFileProcessor.ts`
- `frontend/src/components/MapVisualization.ts`
- `frontend/src/components/AnalysisParameters.ts`
- `frontend/src/utils/ParameterStorage.ts`
- `frontend/src/utils/ResultsStorage.ts`
- `frontend/src/utils/DEMManager.ts`
- `frontend/src/utils/MultiDEMManager.ts`
- `frontend/src/utils/RemoteDEMService.ts`
- `frontend/src/utils/WeatherAPI.ts`
- `frontend/src/utils/log.ts`
- `frontend/src/utils/FileValidation.ts`

These wrap browser APIs, persistence, weather/DEM integration, logging, and UI-adjacent helpers.

## Backend architecture

### FIT and analysis core

- `backend/src/fit_parser.rs`
- `backend/src/virtual_elevation.rs`
- `backend/src/air_density.rs`

These modules expose the WASM-facing computational core used by the frontend.

### DEM processing

- `backend/src/dem_processor.rs`
- `backend/src/dem_processor/tiff_loader.rs`
- `backend/src/dem_processor/geotransform.rs`
- `backend/src/dem_processor/projection.rs`
- `backend/src/dem_processor/sampler.rs`

Responsibilities are now split into:
- TIFF/GeoTIFF loading
- georeferencing and filename/world-file parsing
- CRS/projection setup
- elevation sampling

### Validation boundary

- `backend/src/security.rs`

This is now a small internal helper used for FIT validation. It is no longer presented as a broader security abstraction.

## Runtime flow

1. The browser loads `frontend/index.html` and starts `frontend/src/main.ts`.
2. The frontend initializes the WASM package from `frontend/pkg`.
3. A FIT or CSV file is loaded and normalized into shared frontend activity state.
4. The user selects a mode/slice/laps/sections and adjusts analysis parameters.
5. Frontend analysis helpers prepare arrays and calculator inputs.
6. Rust/WASM computes VE results.
7. Plot builders produce Plotly figures for the active mode.
8. Parameters and results may be saved locally via IndexedDB.

## Build and deployment flow

### Local build/validation

```bash
cd backend && cargo test --lib
cd backend && wasm-pack build --target web --out-dir ../frontend/pkg
cd frontend && npm run check
cd frontend && npm run lint
cd frontend && npm run test
cd frontend && npm run build
```

### CI / GitHub Pages

`.github/workflows/deploy.yml` performs the same sequence on pushes to `main`, then publishes `dist/` to GitHub Pages.

## Architectural constraints and current debt

### What is intentionally deferred

- **Web Worker offloading:** not currently used; should only be added after profiling shows recompute/jank remains a real problem.
- **Full UI decomposition:** still in progress; much of the remaining complexity is in template generation and event wiring in `main.ts`.

### Current pressure points

- `frontend/src/main.ts` remains large
- test coverage is still modest compared with the codebase size
- some UI fragments are still built from large HTML strings

These are known and tracked in [REFACTORING_CHECKLIST.md](REFACTORING_CHECKLIST.md).
