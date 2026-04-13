# STACK

**Project:** `virtual-elevation-analyzer-web`  
**Mapped:** 2026-04-12

## Runtime summary

This codebase is a static browser application with a Rust/WebAssembly computation core.

- Browser UI and orchestration live in `frontend/`
- Numerical work, FIT parsing, DEM sampling, and air-density calculations live in `backend/`
- The deployed artifact is static output in `dist/`
- There is no application server for ride processing

## Languages and runtimes

| Area | Language / runtime | Key files |
| --- | --- | --- |
| Frontend app | TypeScript running in the browser | `frontend/src/main.ts`, `frontend/index.html` |
| Frontend build | Vite + Node.js | `frontend/package.json`, `frontend/vite.config.ts` |
| Frontend styles | CSS | `frontend/src/styles/index.css` |
| Test/lint/typecheck | Vitest + ESLint + `tsc --noEmit` | `frontend/vitest.config.ts`, `frontend/eslint.config.js`, `frontend/tsconfig.json` |
| Compute core | Rust 2021 compiled to WebAssembly | `backend/Cargo.toml`, `backend/src/lib.rs` |
| Deploy | GitHub Actions + GitHub Pages | `.github/workflows/deploy.yml` |

## Frontend stack

### Core frontend tooling

- `vite` `^8.0.7` in `frontend/package.json`
- `typescript` `^6.0.2` in `frontend/package.json`
- `eslint` `^9.39.1` + `typescript-eslint` `^8.46.2` in `frontend/package.json`
- `vitest` `^3.2.4` in `frontend/package.json`

### Frontend runtime libraries

- `leaflet` `^1.9.4` in `frontend/package.json`
- `@types/leaflet` `^1.9.21` in `frontend/package.json`
- `browser-fs-access` `^0.38.0` in `frontend/package.json`
- Plotly is **not** bundled from npm; it is loaded dynamically from CDN in `frontend/src/main.ts`

### Frontend build configuration

- `frontend/vite.config.ts`
  - sets GitHub Pages base path when `VITE_GITHUB_PAGES=true`
  - aliases `@wasm/*` to `frontend/pkg/*`
  - isolates wasm-pack output into a `wasm-core` chunk
- `frontend/tsconfig.json`
  - `strict: true`
  - `moduleResolution: "bundler"`
  - path alias for `@wasm/*`
- `frontend/eslint.config.js`
  - lints `frontend/src/**/*.ts`
  - enforces `no-console` outside `frontend/src/utils/log.ts`
- `frontend/vitest.config.ts`
  - runs `src/**/*.test.ts`
  - uses `environment: 'node'`

## Browser platform APIs used directly

The frontend relies on standard browser APIs rather than a UI framework.

- DOM APIs in `frontend/src/main.ts` and `frontend/src/components/AnalysisParameters.ts`
- IndexedDB in:
  - `frontend/src/utils/ParameterStorage.ts`
  - `frontend/src/utils/ResultsStorage.ts`
  - `frontend/src/utils/WeatherCache.ts`
  - `frontend/src/utils/DEMManager.ts`
- `localStorage` in `frontend/src/utils/RemoteDEMConfig.ts` and `frontend/src/main.ts`
- File APIs in `frontend/src/components/FitFileProcessor.ts` and `frontend/src/main.ts`
- `fetch()` in `frontend/src/utils/WeatherAPI.ts` and `frontend/src/utils/RemoteDEMService.ts`

## Rust / WASM stack

### WASM boundary libraries

- `wasm-bindgen` `0.2.95` in `backend/Cargo.toml`
- `js-sys` `0.3.72` in `backend/Cargo.toml`
- `web-sys` `0.3.72` with `console`, `File`, `FileReader`, and `Blob` features in `backend/Cargo.toml`
- `console_error_panic_hook` `0.1.7` in `backend/Cargo.toml`

### Data / parsing / numerical crates

- `fitparser` `0.10.0` in `backend/Cargo.toml`
- `serde` + `serde_json` in `backend/Cargo.toml`
- `chrono` with serde support in `backend/Cargo.toml`
- `proj4rs` `0.1` in `backend/Cargo.toml`
- `tiff` `0.11` in `backend/Cargo.toml`
- `byteorder` `1.5` in `backend/Cargo.toml`
- `uuid` with `v4` + `js` features in `backend/Cargo.toml`

### Rust module split

Primary backend modules:

- `backend/src/fit_parser.rs` — wasm-facing FIT DTOs and parse entrypoint
- `backend/src/fitparser_wrapper.rs` — wrapper over the `fitparser` crate and developer-field extraction
- `backend/src/virtual_elevation.rs` — VE parameters, calculators, and result generation
- `backend/src/air_density.rs` — air-density and dew-point calculations
- `backend/src/dem_processor.rs` plus:
  - `backend/src/dem_processor/tiff_loader.rs`
  - `backend/src/dem_processor/geotransform.rs`
  - `backend/src/dem_processor/projection.rs`
  - `backend/src/dem_processor/sampler.rs`
- `backend/src/security.rs` — small FIT header validation helper
- `backend/src/utils.rs` — formatting helpers exposed to JS

## Build and packaging flow

### Local scripts

- Root scripts in `package.json`:
  - `npm run build`
  - `npm run dev`
  - `npm run build:wasm`
  - `npm run build:frontend`
- Frontend scripts in `frontend/package.json`:
  - `npm run dev`
  - `npm run build`
  - `npm run check`
  - `npm run lint`
  - `npm run test`
  - `npm run profile:slider`
- Convenience build script: `build.sh`

### Generated package locations

- wasm-pack output used by the app: `frontend/pkg/`
- additional generated package directories present in the workspace:
  - `backend/pkg/`
  - `frontend/pk/`

## CI / deployment stack

`.github/workflows/deploy.yml` currently runs:

1. `cd backend && cargo test --lib`
2. `cd backend && wasm-pack build --target web --out-dir ../frontend/pkg`
3. `cd frontend && npm ci`
4. `cd frontend && npm run check`
5. `cd frontend && npm run lint`
6. `cd frontend && npm run test`
7. `cd frontend && npm run build`
8. publish `dist/` to GitHub Pages

## Notable workspace facts

- `backend/Cargo.lock` is committed for reproducible WASM builds
- `frontend/src/main.ts` is still the dominant frontend integration file
- `frontend/src/main.ts` dynamically loads Plotly and imports the wasm package directly
- The repo also contains generated/ignored outputs such as `dist/`, `frontend/pkg/`, and `backend/target/`
