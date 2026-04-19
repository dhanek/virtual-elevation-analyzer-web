# ARCHITECTURE

**Project:** `virtual-elevation-analyzer-web`  
**Mapped:** 2026-04-19

## High-level architecture

Browser-first virtual elevation analysis app with a split runtime:

- **TypeScript frontend**: UI shell, DOM/events, persistence, map/chart integration, orchestration
- **Rust/WASM backend**: FIT parsing, VE calculations, DEM processing, air-density math

No server-side ride processing is required; the deployed app is static and runs client-side.

## Entry points

### Frontend
- `frontend/index.html`
- `frontend/src/main.ts`

`main.ts` is now a **composition root**: it captures DOM references, constructs services/state, and dispatches to `initializeApplicationShell(...)`.

### Backend/WASM
- `backend/src/lib.rs`

`lib.rs` re-exports public wasm-bindgen modules and sets up panic logging.

## Runtime module graph

```text
frontend/index.html
  -> frontend/src/main.ts
       -> frontend/src/shell/app/initializeApplication.ts
            -> frontend/src/shell/fileLoad/*
            -> frontend/src/shell/analysis/*
            -> frontend/src/shell/section3/*
            -> frontend/src/shell/dem/*
            -> frontend/src/shell/ve/*
            -> frontend/src/shell/gpsLap/*
            -> frontend/src/shell/outAndBack/*
       -> frontend/src/state/AppState.ts
       -> frontend/src/components/*
       -> frontend/src/activity/*
       -> frontend/src/analysis/*
       -> frontend/src/modes/analysis/*
       -> frontend/src/plots/*
       -> frontend/src/utils/*
       -> frontend/pkg/virtual_elevation_analyzer.js
            -> backend/src/lib.rs
                 -> fit_parser.rs / fitparser_wrapper.rs
                 -> virtual_elevation.rs
                 -> air_density.rs
                 -> dem_processor.rs + dem_processor/*
```

## Frontend architecture boundaries

### 1) Composition root + shell bootstrap

- `frontend/src/main.ts`
- `frontend/src/shell/app/initializeApplication.ts`

Responsibilities:
- create `AppState`, storage/services, DEM services
- capture static DOM references
- call `initializeApplicationShell(...)`

`main.ts` no longer owns large mode/file-load/DEM orchestration functions.

### 2) Shell modules (UI ownership)

- `frontend/src/shell/fileLoad/` — FIT/CSV load orchestration and file info rendering
- `frontend/src/shell/analysis/` — analyze orchestration, payload prep, delegate wiring
- `frontend/src/shell/section3/` — detection/lap-selection/trim wiring
- `frontend/src/shell/dem/` — DEM source/file handling + results display seams
- `frontend/src/shell/ve/` — standard VE shell render/update behavior
- `frontend/src/shell/gpsLap/` — GPS-lap shell render/update behavior
- `frontend/src/shell/outAndBack/` — out-and-back shell render/update behavior
- `frontend/src/shell/dom/` — shared DOM helper utilities

### 3) State boundary

- `frontend/src/state/AppState.ts`

`AppState` remains **state-only**. DOM nodes and service instances are passed through typed seams instead of being embedded into state.

### 4) Domain helpers + mode handlers

- `frontend/src/activity/*` — activity normalization
- `frontend/src/analysis/*` — pure analysis helpers/calibration/series prep
- `frontend/src/modes/analysis/*` — standard/gpsLap/out-and-back mode abstractions
- `frontend/src/plots/*` — Plotly figure builders

### 5) Components and utilities

- `frontend/src/components/MapVisualization.ts` — still large and stateful; secondary hotspot (MAP-01 deferred to v2)
- `frontend/src/components/AnalysisParameters.ts` — parameter form component
- `frontend/src/utils/*` — persistence, DEM/weather APIs, logging, validation, viewport helpers

## Backend/WASM architecture

### FIT parsing
- `backend/src/fit_parser.rs`
- `backend/src/fitparser_wrapper.rs`
- `backend/src/security.rs`

### VE calculator
- `backend/src/virtual_elevation.rs`

### Air-density calculations
- `backend/src/air_density.rs`

### DEM processing
- `backend/src/dem_processor.rs`
- `backend/src/dem_processor/*`

## End-to-end flow (simplified)

1. `index.html` loads `main.ts`
2. `main.ts` constructs services/state and calls `initializeApplicationShell`
3. shell modules handle file load + UI orchestration
4. mode handlers + analysis helpers prepare VE inputs
5. WASM calculator computes results
6. shell modules render plots/map updates and persist settings/results

## Current architectural hotspots

- `frontend/src/components/MapVisualization.ts` (secondary, deferred for MAP-01)
- `frontend/src/styles/index.css` (large stylesheet)
- `backend/src/virtual_elevation.rs` (large but domain-focused)

`frontend/src/main.ts` is no longer a primary hotspot after Phase 5 closeout.
