# STRUCTURE

**Project:** `virtual-elevation-analyzer-web`  
**Mapped:** 2026-04-19

## Top-level layout

```text
.
├── backend/                    # Rust/WASM source
├── frontend/                   # TypeScript/Vite app
├── dist/                       # built static output (generated)
├── docs/                       # architecture + testing docs
├── scripts/                    # validation/report scripts
├── .planning/                  # roadmap, requirements, phase artifacts
├── .github/workflows/          # CI + GitHub Pages deploy
├── README.md
├── ARCHITECTURE.md
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

## Frontend structure

```text
frontend/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── eslint.config.js
├── vitest.config.ts
├── pkg/                        # active wasm-pack output used by app
└── src/
    ├── main.ts                 # composition root bootstrap
    ├── activity/
    ├── analysis/
    ├── components/
    ├── modes/analysis/
    ├── plots/
    ├── shell/
    │   ├── app/
    │   ├── analysis/
    │   ├── dem/
    │   ├── dom/
    │   ├── fileLoad/
    │   ├── gpsLap/
    │   ├── multiSegment/
    │   ├── outAndBack/
    │   ├── section3/
    │   └── ve/
    ├── state/
    ├── styles/
    └── utils/
```

### `frontend/src/` subdirectories

| Path | Purpose |
| --- | --- |
| `frontend/src/main.ts` | composition-root wiring (DOM capture, service construction, bootstrap dispatch) |
| `frontend/src/shell/` | UI-shell ownership modules extracted from legacy `main.ts` |
| `frontend/src/activity/` | FIT/CSV normalization helpers |
| `frontend/src/analysis/` | VE input prep, wind resolution, calibration and segment helpers |
| `frontend/src/components/` | stateful UI helpers (map, FIT loader, parameter form) |
| `frontend/src/modes/analysis/` | standard / GPS-lap / out-and-back mode handlers |
| `frontend/src/plots/` | Plotly figure builders and plot context helpers |
| `frontend/src/state/` | typed frontend state model |
| `frontend/src/styles/` | stylesheet(s) |
| `frontend/src/utils/` | persistence, DEM/weather clients, GPS detection, logging, validation |

## Notable frontend files (current)

- `frontend/src/main.ts` — 103 lines
- `frontend/src/components/MapVisualization.ts` — 1171 lines
- `frontend/src/components/AnalysisParameters.ts` — 409 lines
- `frontend/src/styles/index.css` — 1717 lines
- `frontend/src/state/AppState.ts` — 570 lines
- `frontend/src/activity/ActivityLoader.ts` — 251 lines

## Test file layout

Frontend unit tests are colocated with source files (e.g. `src/analysis/*.test.ts`, `src/shell/dom/*.test.ts`, `src/utils/*.test.ts`).

Backend tests are inline in Rust source modules (notably `virtual_elevation.rs`, `air_density.rs`, `dem_processor.rs`, `security.rs`).

## Build / generated directories

Generated or build-oriented directories in the workspace include:

- `dist/`
- `frontend/pkg/`
- `frontend/pk/`
- `backend/pkg/`
- `backend/target/`

`.gitignore` treats `dist/`, `frontend/pkg/`, `backend/pkg/`, and `backend/target/` as generated outputs.
