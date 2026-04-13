# CONVENTIONS

**Project:** `virtual-elevation-analyzer-web`  
**Mapped:** 2026-04-12

## Overall style

This codebase is in an incremental-cleanup state rather than a perfectly uniform style state.

There are clear conventions already in use, but older files and newer refactor files do not always match each other exactly.

## Frontend coding conventions

### 1. Keep the browser shell framework-free

The frontend uses direct browser APIs rather than React/Vue/Svelte.

Typical patterns:

- `document.getElementById(...)` and DOM event registration in `frontend/src/main.ts`
- class-based wrappers around stateful browser concerns in:
  - `frontend/src/components/MapVisualization.ts`
  - `frontend/src/components/AnalysisParameters.ts`
  - `frontend/src/utils/ParameterStorage.ts`
  - `frontend/src/utils/ResultsStorage.ts`

This means UI composition is explicit, but also makes DOM wiring a major maintenance concern.

### 2. Keep `AppState` state-only

`frontend/src/state/AppState.ts` shows an explicit project convention:

- application state belongs in `AppState`
- service instances and DOM nodes stay outside it

Examples of services intentionally kept outside `AppState` are visible in `frontend/src/main.ts`:

- `FitFileProcessor`
- `MapVisualization`
- `ParameterStorage`
- `ResultsStorage`
- `DEMManager`
- `MultiDEMManager`
- `RemoteDEMService`

### 3. Prefer extracted function modules for domain logic

Recent refactors use small function-oriented modules instead of large OO hierarchies.

Examples:

- `frontend/src/analysis/WindSourceResolver.ts`
- `frontend/src/analysis/SegmentExtractor.ts`
- `frontend/src/analysis/ActivityArrayCache.ts`
- `frontend/src/plots/StandardPlotBuilders.ts`
- `frontend/src/modes/analysis/standardMode.ts`
- `frontend/src/modes/analysis/gpsLapMode.ts`
- `frontend/src/modes/analysis/outAndBackMode.ts`

The mode layer in `frontend/src/modes/analysis/*` is especially important: the code prefers function-object handlers over class-heavy “strategy” objects.

### 4. Normalize data early

The code increasingly normalizes FIT and CSV into shared shapes before analysis.

Primary files:

- `frontend/src/activity/ActivityLoader.ts`
- `frontend/src/state/AppState.ts`

Shared types include:

- `LoadedActivity`
- `ActivityData`
- `ActivityResult`
- `SelectedSlice`

This is one of the clearest newer conventions in the repo.

### 5. Plot builders should return figure definitions, not own DOM lookups

A newer pattern is visible in `frontend/src/plots/*`:

- builders return Plotly `data` / `layout` / `config`
- DOM lookup and `Plotly.newPlot(...)` calls remain in `frontend/src/main.ts`

Relevant files:

- `frontend/src/plots/PlotContext.ts`
- `frontend/src/plots/StandardPlotBuilders.ts`
- `frontend/src/plots/MultiSegmentPlotBuilders.ts`

This convention is not complete across the whole app yet, but it is the intended direction.

### 6. Logging goes through `log.ts`

The codebase now expects frontend logging to use:

- `frontend/src/utils/log.ts`

`frontend/eslint.config.js` enforces `no-console` for `frontend/src/**/*.ts` except `frontend/src/utils/log.ts`.

In practice this means:

- call `log.debug(...)`, `log.info(...)`, `log.warn(...)`, `log.error(...)`
- avoid raw `console.*` in feature code

### 7. Persistence is wrapped in promise-based service classes

Persistence code typically:

- opens IndexedDB directly
- wraps callbacks in `Promise`
- exposes higher-level save/load methods

Examples:

- `frontend/src/utils/ParameterStorage.ts`
- `frontend/src/utils/ResultsStorage.ts`
- `frontend/src/utils/WeatherCache.ts`
- `frontend/src/utils/DEMManager.ts`

## Frontend naming conventions

### TypeScript object names

- local variables and methods: `camelCase`
- classes/interfaces/types: `PascalCase`
- constants: `UPPER_SNAKE_CASE` or file-local `const` names

Examples:

- `createVeCalculator` in `frontend/src/analysis/VeCalculatorFactory.ts`
- `AnalysisParametersComponent` in `frontend/src/components/AnalysisParameters.ts`
- `DEFAULT_PARAMETERS` in `frontend/src/components/AnalysisParameters.ts`

### Snake_case when mirroring FIT / WASM data

A very specific convention appears in shared data types:

- frontend business logic mostly uses `camelCase`
- fields that mirror parsed FIT/WASM payloads often stay `snake_case`

Examples in `frontend/src/state/AppState.ts`:

- `position_lat`
- `position_long`
- `air_speed`
- `wind_speed`
- `air_density_data`
- `cda_reference`

This is deliberate and reduces friction at the WASM boundary.

## Error-handling conventions

### TypeScript

Patterns in the frontend:

- throw `Error` or domain-specific errors such as `WeatherAPIError` and `CsvParseError`
- catch near UI boundaries in `frontend/src/main.ts`
- convert lower-level errors into human-readable strings for notifications / error panels

Examples:

- `frontend/src/utils/WeatherAPI.ts`
- `frontend/src/utils/CsvParser.ts`
- `frontend/src/main.ts`

### Rust

Patterns in the backend:

- internal parsing helpers use `Result<_, String>` or normal Rust return types
- wasm-facing exports commonly use `Result<_, JsValue>`
- public WASM structs expose `#[wasm_bindgen(getter)]` accessors

Examples:

- `backend/src/fit_parser.rs`
- `backend/src/virtual_elevation.rs`
- `backend/src/air_density.rs`
- `backend/src/dem_processor/tiff_loader.rs`

## Rust/WASM conventions

### 1. Use `#[wasm_bindgen]` on public boundary types

The public Rust API is explicitly designed for JS interop.

Common patterns:

- structs annotated with `#[wasm_bindgen]`
- constructor methods on exported structs
- explicit getter methods returning cloned `Vec<f64>`

Relevant files:

- `backend/src/fit_parser.rs`
- `backend/src/virtual_elevation.rs`
- `backend/src/air_density.rs`
- `backend/src/dem_processor.rs`

### 2. Keep backend modules domain-oriented

Backend files are grouped by domain responsibility rather than by technical layer.

Examples:

- `backend/src/virtual_elevation.rs`
- `backend/src/air_density.rs`
- `backend/src/fit_parser.rs`
- `backend/src/dem_processor/*`

### 3. Tests are colocated with implementation

Rust tests are currently inline in module files under `#[cfg(test)]`.

Examples:

- `backend/src/virtual_elevation.rs`
- `backend/src/air_density.rs`
- `backend/src/dem_processor.rs`
- `backend/src/security.rs`

## Testing and validation conventions

The repo expects real validation commands rather than relying on “it builds in dev.”

Primary commands:

- `cd backend && cargo test --lib`
- `cd backend && wasm-pack build --target web --out-dir ../frontend/pkg`
- `cd frontend && npm run check`
- `cd frontend && npm run lint`
- `cd frontend && npm run test`
- `cd frontend && npm run build`

These same checks are wired into `.github/workflows/deploy.yml`.

## Areas where conventions are still mixed

### Style is not fully uniform yet

A few examples of inconsistency that are worth knowing up front:

- semicolon usage is mixed between older and newer TypeScript files
- some older files still lean on `any` at JS/Plotly/WASM boundaries
- large HTML template strings still live in `frontend/src/main.ts`
- some runtime assets are loaded dynamically (`Plotly`, Leaflet CSS) instead of through a single bundling convention

### Important boundary files are looser than newer modules

Files still carrying more type looseness or interop-specific flexibility include:

- `frontend/src/components/FitFileProcessor.ts`
- `frontend/src/components/MapVisualization.ts`
- `frontend/src/modes/analysis/types.ts`
- `frontend/src/main.ts`

That is consistent with the repo’s refactor-in-progress state, but contributors should expect stricter typing in extracted helper modules than in the remaining UI shell.
