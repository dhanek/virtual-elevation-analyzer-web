# CONCERNS

**Project:** `virtual-elevation-analyzer-web`  
**Mapped:** 2026-04-12

## Summary

The codebase is functional and materially cleaner than earlier refactor reports describe, but the remaining risk is concentrated rather than evenly distributed.

The biggest issues are:

1. the UI shell is still heavily concentrated in `frontend/src/main.ts`
2. automated test coverage is still small relative to the size of the codebase
3. a few integrations and docs are only partially aligned with the current implementation

## High-priority structural concerns

### 1. `frontend/src/main.ts` is still the main architectural risk

Current observed metrics for `frontend/src/main.ts`:

- 7642 lines
- 230 `document.getElementById(...)` calls
- 85 `addEventListener(...)` calls
- 12 `innerHTML = \`` template blocks
- 142 inline `style="..."` attributes embedded in TypeScript-rendered HTML
- 22 direct `: any` annotations
- 0 raw `console.*` calls outside the logger policy

Representative large functions still living there include:

- `setupVESliders` — 601 lines
- `calculateAutoRho` — 250 lines
- `showVirtualElevationAnalysisInline` — 244 lines
- `handleAnalyze` — 226 lines
- `initializeMapTrimControlsForSelectedLaps` — 223 lines
- `updateOutAndBackVEPlots` — 212 lines
- `showOutAndBackVEAnalysis` — 206 lines
- `updateVEPlotsWithWindSource` — 201 lines
- `updateGpsLapVEPlots` — 194 lines
- `initializeSection3` — 176 lines

The repo already extracted `activity/`, `analysis/`, `modes/analysis/`, `plots/`, and `state/`, so the remaining problem is not missing architecture primitives; it is unfinished UI-shell decomposition.

### 2. `frontend/src/components/MapVisualization.ts` is a second large stateful hotspot

Observed size:

- `frontend/src/components/MapVisualization.ts` — 1171 lines

This file owns a lot of stateful behavior in one class:

- Leaflet startup
- route drawing
- trim markers
- GPS gate markers
- out-and-back markers
- lap highlighting
- wind indicator rendering
- map click mode switching

It is a useful wrapper, but still large enough that small behavior changes can have broad side effects.

### 3. CSS and UI markup are not fully separated yet

Observed size:

- `frontend/src/styles/index.css` — 1717 lines

The shell stylesheet has already been extracted from `frontend/index.html`, which is good, but a lot of inline styling still exists in TypeScript-generated HTML.

That shows up most clearly in:

- `frontend/src/main.ts`
- `frontend/src/components/AnalysisParameters.ts`

This is a maintainability issue more than a functional one.

## Quality and correctness concerns

### 4. Test coverage is still modest relative to code size

Observed size snapshot:

- frontend source total — 19049 lines
- backend source total — 4016 lines
- frontend tests — 5 files / 354 lines

Coverage shape is uneven:

- good coverage in `backend/src/virtual_elevation.rs`
- useful numeric tests in `backend/src/air_density.rs`
- useful unit coverage in a handful of extracted frontend helper modules
- limited direct coverage for:
  - `frontend/src/main.ts`
  - `frontend/src/components/MapVisualization.ts`
  - `backend/src/fit_parser.rs`
  - `backend/src/fitparser_wrapper.rs`
  - `backend/src/dem_processor/*`

This means refactors in the remaining UI shell are still regression-prone even though CI is much better than before.

### 5. Type looseness remains around interop-heavy files

Observed counts in `frontend/src/`:

- 34 direct `: any` annotations
- 15 `as any` casts

Some of the remaining looseness sits in important boundary files:

- `frontend/src/components/FitFileProcessor.ts`
- `frontend/src/components/MapVisualization.ts`
- `frontend/src/modes/analysis/types.ts`
- `frontend/src/main.ts`

This is understandable at Plotly/WASM/DOM boundaries, but it is still a code-health concern because these are exactly the files where many workflows meet.

### 6. Host-target air-density error-path testing is incomplete

`backend/src/air_density.rs` contains ignored tests with an explicit note that `JsValue` construction on error paths panics on non-wasm targets.

That is not a production bug by itself, but it means:

- some error paths are not exercised by normal `cargo test --lib`
- wasm-boundary error typing is still a little awkward internally

## Integration concerns

### 7. OpenTopography support is only partially wired through the current app shell

Evidence across files:

- integration client exists in `frontend/src/utils/RemoteDEMService.ts`
- settings storage exists in `frontend/src/utils/RemoteDEMConfig.ts`
- current selector in `frontend/index.html` only exposes:
  - `aws-terrain`
  - `none`
  - `local`
- `frontend/src/main.ts` only drives `aws-terrain` as the active remote source from the current UI
- `frontend/index.html` CSP `connect-src` does **not** include `https://portal.opentopography.org`

This suggests a dormant or incomplete integration path rather than a fully supported live feature.

### 8. Runtime depends on several live third-party endpoints and CDNs

Current runtime dependencies include:

- Plotly CDN via `frontend/src/main.ts`
- Leaflet CSS via `frontend/src/components/MapVisualization.ts`
- OpenStreetMap tiles
- Open-Meteo forecast/archive APIs
- AWS Terrain Tiles on S3

Consequences:

- the app is privacy-first, but not fully offline
- CSP and network allowlists matter for functionality
- failures in third-party services can affect user experience even when the local compute core is healthy

### 9. Multiple storage schemas increase migration surface area

The frontend uses several separate IndexedDB databases plus `localStorage`.

Key files:

- `frontend/src/utils/ParameterStorage.ts`
- `frontend/src/utils/ResultsStorage.ts`
- `frontend/src/utils/WeatherCache.ts`
- `frontend/src/utils/DEMManager.ts`
- `frontend/src/utils/RemoteDEMConfig.ts`

This is a reasonable design for a browser-local app, but it increases:

- migration complexity
- debugging complexity
- risk of subtle stale-state behavior across versions

## Documentation and workflow concerns

### 10. `ROADMAP.md` is already stale relative to the checklist

Current mismatch:

- `REFACTORING_CHECKLIST.md` marks steps 18, 19, and 20 as done
- `ROADMAP.md` still describes those items as remaining near-term work

This is not a runtime bug, but it is a planning risk for future contributors.

### 11. `REFACTORING_REPORT.md` is historical context, not current truth

The report still contains useful rationale, but many of its concrete findings are no longer current.

Examples already improved since the report:

- CI now runs typecheck/lint/test/build
- raw frontend `console.*` usage is cleaned up behind `frontend/src/utils/log.ts`
- `backend/Cargo.lock` is committed
- DEM processor internals are split into submodules
- GPS multi-segment tabs are implemented instead of placeholder-only

Contributors should treat the live codebase and current checklist/docs as the source of truth.

## Lower-priority cleanup concerns

### 12. Convenience build and CI are not identical

`build.sh` is useful, but it only does:

- wasm-pack build
- `npm install`
- frontend build

It does **not** run:

- `cargo test --lib`
- `npm run check`
- `npm run lint`
- `npm run test`

That difference is worth remembering when using the local build script as a confidence signal.

### 13. Workspace clutter / leftovers exist

During mapping, a few low-priority leftovers stood out:

- empty top-level `src/helpers/`
- multiple generated wasm package directories in the workspace:
  - `frontend/pkg/`
  - `frontend/pk/`
  - `backend/pkg/`

These are not urgent, but they make navigation slightly noisier.

## Practical takeaway

The repo is not in a “rewrite me” state.

It is in a “protect the working core, then keep shrinking the UI shell carefully” state.

If future work stays module-local, the codebase is workable now. If future work is UI/workflow-heavy, the main risk remains concentrated in:

- `frontend/src/main.ts`
- `frontend/src/components/MapVisualization.ts`
- the still-limited browser-level test surface
