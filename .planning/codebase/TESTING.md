# TESTING

**Project:** `virtual-elevation-analyzer-web`  
**Mapped:** 2026-04-12

## Current validation stack

The repo has a real validation baseline across Rust, wasm build, frontend typecheck, lint, unit tests, and production build.

Primary validation commands:

```bash
cd backend && cargo test --lib
cd backend && wasm-pack build --target web --out-dir ../frontend/pkg
cd frontend && npm run check
cd frontend && npm run lint
cd frontend && npm run test
cd frontend && npm run build
```

These commands are reflected in `.github/workflows/deploy.yml`.

## Frontend testing

### Tooling

- test runner: Vitest via `frontend/vitest.config.ts`
- environment: `node`
- test file pattern: `frontend/src/**/*.test.ts`
- linting: ESLint via `frontend/eslint.config.js`
- typecheck: `tsc --noEmit` via `frontend/package.json`

### Current frontend test files

The current frontend automated tests are all unit-style tests colocated with source:

- `frontend/src/analysis/WindSourceResolver.test.ts`
- `frontend/src/analysis/AirSpeedCalibration.test.ts`
- `frontend/src/analysis/MultiSegmentSettings.test.ts`
- `frontend/src/analysis/SegmentSupplementarySeries.test.ts`
- `frontend/src/utils/FileValidation.test.ts`

Observed footprint during mapping:

- 5 frontend test files
- 354 total test-file lines

### What frontend tests cover well today

The strongest tested frontend areas are extracted helper logic, especially:

- wind source resolution and offsets in `frontend/src/analysis/WindSourceResolver.ts`
- air-speed calibration helpers in `frontend/src/analysis/AirSpeedCalibration.ts`
- multi-segment settings behavior in `frontend/src/analysis/MultiSegmentSettings.ts`
- supplementary-series construction in `frontend/src/analysis/SegmentSupplementarySeries.ts`
- basic activity file validation in `frontend/src/utils/FileValidation.ts`

### What frontend tests do **not** cover yet

There are no browser-level or UI-integration tests for:

- `frontend/src/main.ts`
- `frontend/src/components/MapVisualization.ts`
- `frontend/src/components/AnalysisParameters.ts`
- Plotly rendering integration
- Leaflet map behavior
- full file-upload -> analyze -> render workflows

That means the most complex UI shell behavior is still primarily protected by manual testing plus CI build/type/lint checks.

## Backend testing

### Tooling

- runner: Rust built-in test harness via `cargo test --lib`
- test style: inline `#[cfg(test)]` modules inside source files
- wasm build validation: `wasm-pack build --target web --out-dir ../frontend/pkg`

### Backend modules with tests

During mapping, test markers were found in:

- `backend/src/virtual_elevation.rs`
- `backend/src/air_density.rs`
- `backend/src/dem_processor.rs`
- `backend/src/security.rs`

### Backend modules without meaningful dedicated tests

No inline test blocks were found in:

- `backend/src/fit_parser.rs`
- `backend/src/fitparser_wrapper.rs`
- `backend/src/utils.rs`
- `backend/src/dem_processor/tiff_loader.rs`
- `backend/src/dem_processor/geotransform.rs`
- `backend/src/dem_processor/projection.rs`
- `backend/src/dem_processor/sampler.rs`

Some of that functionality is indirectly exercised, but the coverage is uneven.

### Backend tests that look strongest

`backend/src/virtual_elevation.rs` is the best-covered backend module.

The file contains a substantial set of golden/unit tests around the VE math and calculator behavior, which is important because it is the algorithmic center of the product.

`backend/src/air_density.rs` also has a useful set of numeric tests for atmospheric calculations.

### Backend test caveat already visible in code

`backend/src/air_density.rs` contains ignored tests with an explicit comment explaining that host-target error-path tests panic when constructing `JsValue` on non-wasm targets.

That means some error-path coverage exists in source but is not part of normal `cargo test --lib` host execution.

## Build verification

### Frontend build

- `frontend/package.json` provides `npm run build` via Vite
- `frontend/vite.config.ts` outputs to `../dist`
- production build depends on the wasm package already existing in `frontend/pkg/`

### WASM build

- `backend/Cargo.toml` is configured as `crate-type = ["cdylib"]`
- wasm-pack build output is written into `frontend/pkg/`
- frontend TS aliasing depends on this build step completing first

### Convenience script

- `build.sh` builds WASM, runs `npm install`, and builds the frontend

Important nuance: `build.sh` is a convenience script, not full CI parity. It does **not** run `cargo test`, `npm run check`, `npm run lint`, or `npm run test`.

## CI coverage

`.github/workflows/deploy.yml` currently validates:

1. Rust unit tests
2. wasm-pack build
3. frontend dependency install with `npm ci`
4. frontend typecheck
5. frontend lint
6. frontend unit tests
7. frontend production build
8. GitHub Pages deploy

This is a healthy baseline for a static browser/WASM app.

## Practical testing takeaways

### Strengths

- CI is materially better than “build only”
- extracted helper logic is getting unit tests
- core VE math in `backend/src/virtual_elevation.rs` has real test coverage
- linting and typecheck are part of normal validation now

### Weak spots

- no browser/e2e coverage
- limited tests around the biggest remaining files:
  - `frontend/src/main.ts`
  - `frontend/src/components/MapVisualization.ts`
- sparse direct tests for FIT parsing and DEM submodules
- no visual regression coverage for Plotly/Leaflet UI behavior

## Related non-test verification tooling

There is also a performance/profiling script:

- `frontend/scripts/profile-slider-recompute.ts`

It is not a correctness test, but it is part of the repo’s current engineering discipline around worker/offload decisions.
