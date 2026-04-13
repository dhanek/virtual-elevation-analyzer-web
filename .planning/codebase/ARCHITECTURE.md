# ARCHITECTURE

**Project:** `virtual-elevation-analyzer-web`  
**Mapped:** 2026-04-12

## High-level architecture

This is a browser-first virtual elevation analysis application with a split runtime:

- **TypeScript** owns UI composition, DOM events, persistence, map/chart integration, and workflow orchestration
- **Rust/WASM** owns FIT parsing, VE calculations, DEM processing, and air-density math

There is no application backend for ride processing. The deployed app is static and runs client-side.

## Entry points

### Frontend entry

- `frontend/index.html`
- `frontend/src/main.ts`

`frontend/index.html` provides the static shell and workflow sections. `frontend/src/main.ts` bootstraps the app, initializes WASM, wires DOM events, and connects the extracted frontend modules.

### Backend/WASM entry

- `backend/src/lib.rs`

`backend/src/lib.rs` re-exports the public wasm-bindgen modules and sets up panic logging via `console_error_panic_hook`.

## Runtime module graph

```text
frontend/index.html
  -> frontend/src/main.ts
       -> frontend/src/state/AppState.ts
       -> frontend/src/components/FitFileProcessor.ts
       -> frontend/src/components/MapVisualization.ts
       -> frontend/src/components/AnalysisParameters.ts
       -> frontend/src/activity/ActivityLoader.ts
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

## Frontend architecture

### 1. UI shell / controller

- `frontend/src/main.ts`

This file is still the central controller. It does all of the following:

- application bootstrap
- DOM lookup and event registration
- workflow section activation and scrolling
- file-load flow
- DEM/weather integration orchestration
- analysis dispatch
- Plotly tab wiring and redraw orchestration

The codebase has been partially extracted away from it, but `main.ts` remains the architectural center of gravity.

### 2. State boundary

- `frontend/src/state/AppState.ts`

`AppState` is the typed frontend state container. It groups state into slices such as:

- `activity`
- `selection`
- `analysis`
- `dem`
- `ui`

Important constraint already reflected in code: `AppState` owns **state only**. Service instances like `FitFileProcessor`, `MapVisualization`, `DEMManager`, `ParameterStorage`, and `ResultsStorage` stay outside it.

### 3. Activity load / normalization layer

- `frontend/src/components/FitFileProcessor.ts`
- `frontend/src/activity/ActivityLoader.ts`
- `frontend/src/utils/CsvParser.ts`
- `frontend/src/utils/DataInterpolation.ts`

This layer turns uploaded FIT or CSV files into a common frontend activity model.

- FIT path: browser file -> wasm parse -> `ActivityResult` / `LoadedActivity`
- CSV path: parse -> optional interpolation -> `ActivityResult` / `LoadedActivity`

### 4. Analysis domain helpers

Key files:

- `frontend/src/analysis/ActivityArrayCache.ts`
- `frontend/src/analysis/AnalysisInput.ts`
- `frontend/src/analysis/SegmentExtractor.ts`
- `frontend/src/analysis/WindSourceResolver.ts`
- `frontend/src/analysis/VeCalculatorFactory.ts`
- `frontend/src/analysis/AirSpeedCalibration.ts`
- `frontend/src/analysis/MultiSegmentSettings.ts`
- `frontend/src/analysis/SegmentSupplementarySeries.ts`

Responsibilities include:

- normalizing activity arrays
- extracting selected segments
- resolving wind source and air-speed offsets
- centralizing VE calculator creation
- multi-segment calibration/settings helpers
- building derived series for wind/power/virtual-distance plots

These modules are mostly function-oriented rather than class-heavy.

### 5. Mode abstraction

- `frontend/src/modes/analysis/types.ts`
- `frontend/src/modes/analysis/standardMode.ts`
- `frontend/src/modes/analysis/gpsLapMode.ts`
- `frontend/src/modes/analysis/outAndBackMode.ts`
- `frontend/src/modes/analysis/AnalysisModes.ts`

The app now has an explicit analysis-mode layer.

- `standard` mode works from selected FIT laps or CSV slices
- `gpsLap` mode works from GPS-detected lap ranges
- `outAndBack` mode works from GPS gate sections

These handlers reduce branching in `handleAnalyze()`, but the actual DOM rendering and much of the event lifecycle still live in `frontend/src/main.ts`.

### 6. Presentation layer

#### Plot builders

- `frontend/src/plots/PlotContext.ts`
- `frontend/src/plots/StandardPlotBuilders.ts`
- `frontend/src/plots/MultiSegmentPlotBuilders.ts`

These files build Plotly-ready trace/layout/config objects. The intent is to keep figure construction reusable and comparatively pure.

#### Map UI

- `frontend/src/components/MapVisualization.ts`

This is a large class that owns:

- Leaflet map initialization
- route drawing
- selected-lap highlighting
- trim markers
- GPS gate markers
- out-and-back marker workflows
- wind indicator display

#### Parameter UI

- `frontend/src/components/AnalysisParameters.ts`

This component renders and reads the parameter form, then notifies `main.ts` through a callback.

### 7. Browser services / persistence layer

Key files:

- `frontend/src/utils/ParameterStorage.ts`
- `frontend/src/utils/ResultsStorage.ts`
- `frontend/src/utils/WeatherAPI.ts`
- `frontend/src/utils/WeatherCache.ts`
- `frontend/src/utils/DEMManager.ts`
- `frontend/src/utils/MultiDEMManager.ts`
- `frontend/src/utils/RemoteDEMService.ts`
- `frontend/src/utils/RemoteDEMConfig.ts`
- `frontend/src/utils/ViewportAdapter.ts`
- `frontend/src/utils/log.ts`
- `frontend/src/utils/FileValidation.ts`

These wrap browser APIs, storage, remote integrations, and utility behavior.

## Backend / WASM architecture

### 1. FIT parsing pipeline

- `backend/src/fit_parser.rs`
- `backend/src/fitparser_wrapper.rs`
- `backend/src/security.rs`

Pipeline shape:

1. `fit_parser.rs` validates header bytes through `security::validate_fit_data`
2. `fit_parser.rs` constructs `FitParserWrapper`
3. `fitparser_wrapper.rs` uses the `fitparser` crate to decode records and laps
4. decoded records are converted into wasm-bindgen DTOs such as `FitData`, `LapData`, and `ParsedFitFile`

### 2. VE calculator pipeline

- `backend/src/virtual_elevation.rs`

This module contains:

- `VEParameters`
- `VEData`
- `VEResult`
- `VirtualElevationCalculator`
- exported helpers `create_ve_calculator` and `create_ve_calculator_with_rho_array`

The module is also where backend golden/unit tests for VE behavior currently live.

### 3. Air-density calculations

- `backend/src/air_density.rs`

This module exposes a small `AirDensityCalculator` wasm surface for:

- saturation vapor pressure
- dew point
- air density from dew point
- air density from humidity

### 4. DEM processing pipeline

- `backend/src/dem_processor.rs`
- `backend/src/dem_processor/tiff_loader.rs`
- `backend/src/dem_processor/geotransform.rs`
- `backend/src/dem_processor/projection.rs`
- `backend/src/dem_processor/sampler.rs`

Responsibilities are split across:

- TIFF/GeoTIFF loading and decoding
- embedded/world-file georeferencing
- projection setup via `proj4rs`
- batch sampling / bounds / metadata

The public wasm surface still appears as one `DEMProcessor` type.

## End-to-end runtime flow

### File-load and analysis flow

1. `frontend/index.html` loads `frontend/src/main.ts`
2. `frontend/src/main.ts` initializes wasm from `frontend/pkg/`
3. user uploads a FIT or CSV file
4. FIT parsing happens through `frontend/src/components/FitFileProcessor.ts` -> WASM -> `backend/src/fit_parser.rs`
5. CSV parsing happens in `frontend/src/activity/ActivityLoader.ts` + `frontend/src/utils/CsvParser.ts`
6. normalized data is stored in `frontend/src/state/AppState.ts`
7. user picks laps, GPS gates, or sections
8. `frontend/src/modes/analysis/*` prepares the selected analysis shape
9. `frontend/src/analysis/WindSourceResolver.ts` and related helpers prepare calculator inputs
10. `frontend/src/analysis/VeCalculatorFactory.ts` creates a WASM calculator
11. `backend/src/virtual_elevation.rs` computes results
12. plot builders in `frontend/src/plots/*` create figures
13. `frontend/src/main.ts` calls Plotly and updates the UI shell
14. optional persistence flows save settings/results/weather caches in browser storage

## Architectural hotspots

The remaining hotspots are concentrated in the UI shell:

- `frontend/src/main.ts` — still very large and event-heavy
- `frontend/src/components/MapVisualization.ts` — large, stateful map controller
- `frontend/src/styles/index.css` — large stylesheet with shell + workflow + plot styles
- `backend/src/virtual_elevation.rs` — large but domain-focused algorithm module

## Practical architecture takeaways

- The repo already has a clear **WASM core + browser shell** split
- The frontend is mid-transition from one giant controller to a more modular structure
- The extracted analysis/mode/plot modules are real and useful
- The main remaining architectural risk is not missing infrastructure; it is the concentration of DOM/template/event logic in `frontend/src/main.ts`
