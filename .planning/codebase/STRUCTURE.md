# STRUCTURE

**Project:** `virtual-elevation-analyzer-web`  
**Mapped:** 2026-04-12

## Top-level layout

```text
.
├── backend/                    # Rust/WASM source and generated wasm packages
├── frontend/                   # TypeScript/Vite app
├── dist/                       # built static output (generated/ignored)
├── .github/workflows/          # CI + GitHub Pages deploy
├── README.md
├── ARCHITECTURE.md
├── PROJECT_STATUS.md
├── ROADMAP.md
├── REFACTORING_CHECKLIST.md
├── REFACTORING_REPORT.md
├── DEPLOYMENT.md
├── build.sh
└── package.json
```

## Backend structure

```text
backend/
├── Cargo.toml
├── Cargo.lock
├── pkg/                        # generated wasm package output
└── src/
    ├── lib.rs
    ├── fit_parser.rs
    ├── fitparser_wrapper.rs
    ├── virtual_elevation.rs
    ├── air_density.rs
    ├── security.rs
    ├── utils.rs
    ├── dem_processor.rs
    └── dem_processor/
        ├── tiff_loader.rs
        ├── geotransform.rs
        ├── projection.rs
        └── sampler.rs
```

### Backend file roles

- `backend/src/lib.rs` — wasm entry and module re-exports
- `backend/src/fit_parser.rs` — exported FIT DTOs and parse entrypoint
- `backend/src/fitparser_wrapper.rs` — wrapper over the `fitparser` crate and field extraction
- `backend/src/virtual_elevation.rs` — VE calculator + tests
- `backend/src/air_density.rs` — air-density/dew-point helpers + tests
- `backend/src/dem_processor.rs` — thin root for DEM processor type and shared tests
- `backend/src/dem_processor/*` — TIFF loading, transforms, projection, lookup
- `backend/src/security.rs` — FIT header validation helper
- `backend/src/utils.rs` — formatting helpers exported to JS

## Frontend structure

```text
frontend/
├── index.html
├── package.json
├── package-lock.json
├── vite.config.ts
├── tsconfig.json
├── eslint.config.js
├── vitest.config.ts
├── pkg/                       # active wasm-pack output used by the app
├── pk/                        # extra generated wasm package dir present in workspace
├── scripts/
│   └── profile-slider-recompute.ts
└── src/
    ├── main.ts
    ├── activity/
    ├── analysis/
    ├── components/
    ├── modes/analysis/
    ├── plots/
    ├── state/
    ├── styles/
    └── utils/
```

### `frontend/src/` subdirectories

| Path | Purpose |
| --- | --- |
| `frontend/src/main.ts` | application bootstrap, DOM wiring, workflow controller |
| `frontend/src/activity/` | FIT/CSV normalization helpers |
| `frontend/src/analysis/` | VE input prep, wind resolution, segment extraction, calibration helpers |
| `frontend/src/components/` | stateful UI helpers like map, FIT loader, parameter form |
| `frontend/src/modes/analysis/` | standard / GPS-lap / out-and-back mode handlers |
| `frontend/src/plots/` | Plotly figure builders and plot context helpers |
| `frontend/src/state/` | typed frontend state model |
| `frontend/src/styles/` | extracted stylesheet(s) |
| `frontend/src/utils/` | persistence, DEM/weather clients, GPS detection, logging, validation |

## Notable frontend files

### Major controller and UI files

- `frontend/src/main.ts` — 7642 lines
- `frontend/src/components/MapVisualization.ts` — 1171 lines
- `frontend/src/components/AnalysisParameters.ts` — 409 lines
- `frontend/src/styles/index.css` — 1717 lines

### Extracted domain files

- `frontend/src/state/AppState.ts` — 570 lines
- `frontend/src/activity/ActivityLoader.ts` — 251 lines
- `frontend/src/analysis/ActivityArrayCache.ts` — 56 lines
- `frontend/src/analysis/WindSourceResolver.ts` — 141 lines
- `frontend/src/analysis/VeCalculatorFactory.ts` — 89 lines
- `frontend/src/plots/StandardPlotBuilders.ts` — 804 lines
- `frontend/src/plots/MultiSegmentPlotBuilders.ts` — 142 lines
- `frontend/src/utils/GpsLapDetection.ts` — 772 lines
- `frontend/src/utils/ParameterStorage.ts` — 739 lines
- `frontend/src/utils/ResultsStorage.ts` — 569 lines

## Test file layout

### Frontend tests

Current frontend unit tests are colocated with source files:

- `frontend/src/analysis/WindSourceResolver.test.ts`
- `frontend/src/analysis/AirSpeedCalibration.test.ts`
- `frontend/src/analysis/MultiSegmentSettings.test.ts`
- `frontend/src/analysis/SegmentSupplementarySeries.test.ts`
- `frontend/src/utils/FileValidation.test.ts`

### Backend tests

Backend tests currently live inline inside source modules, especially:

- `backend/src/virtual_elevation.rs`
- `backend/src/air_density.rs`
- `backend/src/dem_processor.rs`
- `backend/src/security.rs`

## Build / generated directories present in the workspace

Generated or build-oriented directories currently visible in the repo workspace include:

- `dist/`
- `frontend/pkg/`
- `frontend/pk/`
- `backend/pkg/`
- `backend/target/`

`.gitignore` treats `dist/`, `frontend/pkg/`, `backend/pkg/`, and `backend/target/` as generated outputs.

## Naming patterns

### TypeScript side

Patterns are mixed but mostly understandable:

- class-heavy modules often use PascalCase filenames:
  - `frontend/src/components/MapVisualization.ts`
  - `frontend/src/utils/WeatherCache.ts`
  - `frontend/src/utils/ParameterStorage.ts`
- function/helper modules also use PascalCase noun-style filenames:
  - `frontend/src/analysis/SegmentExtractor.ts`
  - `frontend/src/analysis/WindSourceResolver.ts`
  - `frontend/src/activity/ActivityLoader.ts`
- folders use lowercase names like `activity`, `analysis`, `plots`, `state`, `utils`

### Rust side

Rust files follow conventional snake_case naming:

- `backend/src/fit_parser.rs`
- `backend/src/fitparser_wrapper.rs`
- `backend/src/virtual_elevation.rs`
- `backend/src/dem_processor/tiff_loader.rs`

## Interesting workspace leftovers

Two low-signal items stood out during mapping:

- top-level `src/helpers/` exists but is currently empty
- both `frontend/pk/` and `frontend/pkg/` exist alongside `backend/pkg/`, which makes generated wasm package locations slightly noisier than they need to be

Neither changes runtime behavior, but both are useful to know when navigating the workspace.
