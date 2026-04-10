# Virtual Elevation Analyzer — Refactoring Report

> Software-engineering review of the project as of 2026-04-10.
> Scope: frontend TypeScript, backend Rust/WASM, build/CI setup.

---

## Refactor To-Do List

Ordered by *leverage / effort*. Items 1–3 unblock everything else and should be done first.

- [x] **1. Fix CI type checking** (~1 h) — Added `npm run check` step to `.github/workflows/deploy.yml` before `npm run build`; moved `typescript` and `vite` from `dependencies` to `devDependencies`. **Correction:** my initial claim that `typescript ^6.0.2` and `vite ^8.0.7` don't exist was wrong — they were released and are the current latest stable versions. Versions left as-is. CI will now fail until item 4 is complete. See [§2](#2-typescript-strict-mode-is-enabled-but-not-actually-being-enforced--critical).
- [x] **2. Commit `Cargo.lock`** (5 min) — Removed `Cargo.lock` from `.gitignore` and committed `backend/Cargo.lock` (1567 lines, 180 packages). Existing on-disk lockfile was already in sync with `Cargo.toml` (verified via `cargo metadata --locked`), so no regeneration was needed. See [§3](#3-commit-cargolock--medium).
- [x] **3. Add golden tests for `virtual_elevation.rs`** (½ day) — Added 10 golden tests in `virtual_elevation::tests`: flat-ride VE ≈ 0 at steady-state power, headwind via params, headwind via data (two paths agree), tailwind, R² ≈ 1 on a synthetic 1% linear climb, metrics branch with empty altitude, sign/monotonicity checks, and VD_air/VD_ground percentage. All golden values derived analytically in the docstrings. Also added `cargo test --lib` as a CI step in `.github/workflows/deploy.yml` and marked three pre-existing broken `air_density` tests as `#[ignore]` (they construct `JsValue` on error paths, which panics on non-wasm32). 19/22 pass, 3 ignored, 0 fail. See [§8](#8-no-test-coverage--medium).
- [x] **4. Fix the 76 existing `tsc --noEmit` errors** (1–2 days) — All 76 errors fixed across 4 phases, real fixes (no `@ts-ignore`, no blanket `any`). **Phase 1** (76→53): easy wins — added `paths` for `@wasm/*` in `tsconfig.json`, fixed `catch (unknown)` in `FitFileProcessor.ts`/`WeatherCache.ts`, removed 3 dead globals in `main.ts` (`_veCalculator`, `isOutAndBackModeActive`, `currentOutAndBackProfiles`), fixed unused vars/params, and fixed a latent `ReferenceError` bug on line 5839 (`defaultAirSpeedOffset` was undefined in scope). **Phase 2** (53→31): aligned TypeScript types with the wasm-bindgen `Float64Array` shape — `VEAnalysisResult` now mirrors `VEResult` exactly, `createVirtualElevationPlots*` accept `Float64Array | number[]`, `create_ve_calculator` call sites wrap `number[]` in `new Float64Array(...)`, `DEMManager.getDEMBounds()` returns `Float64Array`, and the three `Array.from(fitData.air_speed).some/map` clusters were refactored to use typed locals (the TS 6.x `Array.from(Float64Array)` inference issue). **Phase 3** (31→2): added `if (!currentParameters) return;` narrow-headers to 4 functions (`showVirtualElevationAnalysisInline`, `setupVESliders`, `updateVEPlotsWithWindSource`, `createWindSpeedPlot`); `setupVESliders` additionally needed `const params = currentParameters` because its errors were in nested callbacks where top-level narrowing doesn't propagate. **Phase 4** (2→0): declared a `PlotlyHTMLElement` interface for Plotly's monkey-patched `.on()` method on plot divs. `npm run check` and `npm run build` both pass. See [§2](#2-typescript-strict-mode-is-enabled-but-not-actually-being-enforced--critical).
- [ ] **5. Extract `AppState` class** (1 day) — Move the 53 top-level `let`s in `main.ts` into a single typed class. No logic changes. See [§1](#1-frontendsrcmaints-is-a-9015-line-god-module--critical).
- [ ] **6. Extract `AnalysisContext` type + plot modules** (2–3 days) — Collapse 9-arg function signatures to 1; move plot code into `frontend/src/plots/{VePlot,WindPlot,PowerPlot,VirtualDistancePlot}.ts`. See [§1](#1-frontendsrcmaints-is-a-9015-line-god-module--critical).
- [ ] **7. Extract `AnalysisMode` strategy** (1–2 days) — `StandardMode` / `GpsLapMode` / `OutAndBackMode` each implement a common interface. Kills the `if (isGpsLapMode) … else if …` branching. See [§1](#1-frontendsrcmaints-is-a-9015-line-god-module--critical).
- [ ] **8. Extract `FileLoader.ts` and `WindSourceResolver.ts`** (½ day) — Pull FIT/CSV ingestion and the duplicated air-speed/wind-speed/yaw triangulation out of `handleAnalyze`. See [§1](#1-frontendsrcmaints-is-a-9015-line-god-module--critical).
- [ ] **9. Collapse backend duplication** (½ day) — Merge `calculate_virtual_slope` + `_with_cda_array`, `calculate_virtual_elevation` + `_with_cda_array`, `create_ve_calculator` + `_with_rho_array` to take `Option<&[f64]>`. See [§1](#1-frontendsrcmaints-is-a-9015-line-god-module--critical).
- [ ] **10. Split `dem_processor.rs`** (1 day) — Into `dem/{tiff_loader,geotransform,projection,sampler}.rs`. See [§7](#7-dem-processor-needs-internal-decomposition--medium).
- [ ] **11. Cache WASM→JS array copies in `AppState`** (½ day) — Stop re-reading `Float64Array` getters on every plot update. See [§6](#6-wasm--js-data-copying-is-the-real-perf-cost-not-the-math--medium).
- [ ] **12. Move CSS out of `index.html`** (few hours) — 1596-line inline `<style>` → `frontend/src/styles/*.css`. See [§9](#9-frontendindexhtml-is-1744-lines-with-a-1596-line-inline-style--small).
- [ ] **13. Move VE recompute to a Web Worker** (1 day) — `comlink` is already in `package.json` but unused; this fixes slider jank. See [§4](#4-unused--misleading-dependencies--medium).
- [ ] **14. Remove dead `security.rs` + runtime `setupContentSecurityPolicy`** (30 min) — Neither does anything useful; the static `<meta>` CSP in `index.html` is the real protection. See [§5](#5-unsafeineffective-security-layer--medium).
- [ ] **15. Add ESLint/Biome + frontend test runner** (½ day) — `vitest` (already compatible with Vite). Enforce `no-console`. See [§2](#2-typescript-strict-mode-is-enabled-but-not-actually-being-enforced--critical), [§10](#10-156-consolelog-calls-in-maints--small).
- [ ] **16. Replace 156 `console.log`s with a leveled `log.ts`** (few hours) — No-op `debug` in production. See [§10](#10-156-consolelog-calls-in-maints--small).
- [ ] **17. Split `README.md`** (few hours) — Into `README.md` (what/how), `ARCHITECTURE.md` (module layout + WASM boundary), `ROADMAP.md` (pending features). Archive the Phase 1–6 migration plan. See [§11](#11-documentation-overstates-state--small).
- [ ] **18. Resolve the three `TODO: Add stacked … traces per lap`** at `main.ts:4140/4163/4186` — GPS-lap wind/power/VD plots are empty placeholders. See [§12](#12-other-smells-worth-noting--small).
- [ ] **19. Extract magic numbers to `constants.ts` / `constants.rs`** (1 h) — `50_000_000` byte limit, proximity `20`, angle `30`, determinant `1e-10`. See [§12](#12-other-smells-worth-noting--small).
- [ ] **20. Remove `_veCalculator` dead code and the `gpsLapHandlersInitialized` / `outAndBackHandlersInitialized` re-entry flags** — They disappear once `AppState` owns mode lifecycle. See [§12](#12-other-smells-worth-noting--small).

**Total estimated effort for items 1–14: ~2 focused weeks.** Items 15–20 are polish.

---

## TL;DR

**Yes, significant refactoring is warranted.** The project *works* and the build succeeds, but it's in a state where adding any non-trivial feature will keep getting harder. The two biggest problems are **(1) a 9,000-line `main.ts` god module holding ~50 pieces of mutable global state**, and **(2) TypeScript strict mode is enabled but broken — `tsc --noEmit` reports 76 errors that no one is catching because only Vite runs in CI and Vite doesn't type-check**. There are also a handful of smaller, easy wins.

Going from most to least impactful.

---

## 1. `frontend/src/main.ts` is a 9,015-line god module ⚠️ Critical

```
frontend/src/main.ts          9015 lines   ← the problem
frontend/index.html           1744 lines   (1596 lines are inline <style>)
backend/src/dem_processor.rs  1297 lines
frontend/src/components/MapVisualization.ts  1162 lines
backend/src/virtual_elevation.rs  733 lines
```

Concrete numbers for `main.ts`:

| Metric | Count |
|---|---|
| Lines | 9,015 |
| Top-level functions | ~103 |
| Top-level `let` globals (mutable state) | **53** |
| `document.getElementById` calls | 211 (on ~110 distinct IDs) |
| `addEventListener` calls | 92 |
| `console.log` calls | 156 |
| `: any` annotations | 33 |
| References to `currentParameters` alone | 159 |

This is an MVC / state-management problem. The code is basically: one big module that owns the DOM, owns the data, owns the WASM calls, owns IndexedDB persistence, owns plotting, and owns event wiring — all by mutating file-scope `let` variables.

### What's wrong, concretely

- **Temporal coupling everywhere.** `handleAnalyze()` (line 2935, ~430 lines) reads `currentFitData`, `currentFitResult`, `currentLaps`, `currentParameters`, `gpsDetectedLaps`, `outAndBackSections`, `selectedLaps`, `gpsSelectedLaps`, `outAndBackSelectedSections`, `remoteDEMResults`, … all by name. The order in which these get initialized is not expressible in the type system; every new feature adds another `let currentXxx = null`.
- **Parameter threading instead of state object.** Functions like `setupVESliders(timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed, defaultAirSpeedOffset)` and `updateVEPlotsWithWindSource(…same 9 arrays + 2 trim indices + wind source)` thread the same 8–10 arrays around. `createWindSpeedPlot`, `createSpeedPowerPlot`, `createVirtualDistancePlot`, `updateVEPlots` all take the same cluster — a textbook **Data Clump** smell, and one that an `AnalysisContext` / `LapDataset` class would eliminate.
- **Duplicated slider/update code paths.** `updateTrimStart`, `updateTrimEnd`, `updateCdA`, `updateCrr`, `updateTrimStartFromInput`, `updateTrimEndFromInput` all repeat the same block: "read sliders → call updateVEPlots → if wind/power/vd tab is active, call createXxxPlot → fit map bounds → saveCurrentLapSettings". The same pattern exists again for the GPS-lap and Out-and-Back variants (`setupGpsLapSliderHandlers`, `setupOutAndBackSliderSync`). This is 300–500 lines of near-duplicate code.
- **Three parallel analysis code paths.** Standard / GPS-Lap / Out-and-Back each have their own `showXxx`, `renderXxxPlots`, `updateXxxVEPlots`, `renderXxxWindPlot`, `renderXxxPowerPlot`, `renderXxxVdPlot`, `saveXxxScreenshot`, `calculateXxxStats`. These should all share an interface (e.g. `AnalysisStrategy` with `buildSegments / computeVE / renderPlots`) and the differences should be in ~100-line strategy classes, not 3 copies of everything.
- **Backend duplication mirrors this.** `virtual_elevation.rs` has `calculate_virtual_slope` and `calculate_virtual_slope_with_cda_array`, plus `calculate_virtual_elevation` and `calculate_virtual_elevation_with_cda_array`, plus `create_ve_calculator` and `create_ve_calculator_with_rho_array`. In each case the only difference is one parameter. These should collapse to one implementation that takes an `Option<&[f64]>` or iterator.

### Recommended refactor (concrete, do this incrementally)

Don't try to rewrite `main.ts` at once. Do it file by file, behind the current surface:

1. **Introduce an `AppState` class** (or a tiny store) that owns all 53 `let`s as fields with typed accessors, and has a narrow public API (`loadFit`, `setParameters`, `selectLaps`, `runAnalysis`). Start by replacing the globals with `state.currentFitData` etc. — no behaviour change, just visibility.
2. **Extract an `AnalysisContext` type**: `{ timestamps, power, velocity, positionLat, positionLong, altitude, distance, windSpeed, temperature, trimStart, trimEnd, cda, crr }`. Every `setupVESliders`/`updateVEPlots`/`createXxxPlot` signature collapses from 9 args to 1.
3. **Extract plot modules** to `frontend/src/plots/`: `VePlot.ts`, `WindPlot.ts`, `PowerPlot.ts`, `VirtualDistancePlot.ts`. Each takes an `AnalysisContext` and a plot `<div>` id. Today the plot code is interleaved with state management; separating them is almost mechanical.
4. **Extract an `AnalysisMode` strategy** (`StandardMode`, `GpsLapMode`, `OutAndBackMode`) that owns `detectSegments`, `buildSelectedRanges`, `runVE`, `renderPlots`, `saveScreenshot`. All the `if (isGpsLapMode) … else if (isOutAndBackMode) … else …` branches in `handleAnalyze` become a dispatch on `currentMode`.
5. **Extract `FileLoader.ts`** for the FIT/CSV ingestion path (`processFitFile`, `processCsvFile`, `calculateDistanceArray`, `generateLapsFromCsv`, `displayCsvResults`, `initializeSection3Csv` — all currently in `main.ts`).
6. **Extract `WindSourceResolver.ts`** for the `hasAirSpeed / hasWindSpeed / hasWindYaw` triangulation block (duplicated twice inside `handleAnalyze`).

A reasonable target is to get `main.ts` under ~500 lines containing only bootstrapping and wiring. Everything else goes into ~15–25 small, named modules. None of this changes the Rust side or the user-visible behaviour, so it can be done safely.

---

## 2. TypeScript strict mode is enabled but **not actually being enforced** ⚠️ Critical

`frontend/tsconfig.json` has:
```json
"strict": true,
"noUnusedLocals": true,
"noUnusedParameters": true,
```

But `tsc --noEmit` currently fails with **76 errors**:

- `src/main.ts(131,5): error TS6133: '_veCalculator' is declared but its value is never read.`
- `src/main.ts(153,5): error TS6133: 'isOutAndBackModeActive' is declared but its value is never read.` — yet this is actually read downstream; the compiler is right that the initializer branch is dead.
- Dozens of `TS18047: 'currentParameters' is possibly 'null'` — classic symptom of the global-state design above.
- Lots of `TS2345: Float64Array is not assignable to number[]` — WASM returns `Float64Array`, TS code treats it as `number[]`. This silently works at runtime but any `.push()`/`.slice()` chain could blow up.
- `FitFileProcessor.ts(18,33): error TS2307: Cannot find module '@wasm/virtual_elevation_analyzer.js'` — the alias only resolves if the WASM pkg has been built; there's no conditional typing.
- `error TS2339: Property 'on' does not exist on type 'HTMLElement'` — using jQuery-style `.on()` on Plotly elements without typing them.

### Why this happened

- `vite build` does **not** type-check. It transpiles per file via esbuild/rolldown. So CI passes and the site deploys even with 76 TS errors.
- The `check` script (`"check": "tsc --noEmit"`) exists in `frontend/package.json` but the GitHub Actions workflow never calls it.
- `package-lock.json` is committed, but TypeScript is listed in **`dependencies`** (runtime) instead of `devDependencies`. Not harmful per se, but it's a sign that the setup hasn't been reviewed.
- ~~Frontend is on `vite ^8.0.7` and `typescript ^6.0.2` — both don't exist as released versions.~~ **Correction:** these versions do exist and are the current latest stable releases (TypeScript 6.0.2 and Vite 8.0.8). The original report was wrong on this point. `package-lock.json` is committed and CI uses `npm ci`, so builds are reproducible.

### Recommended fix

1. ✅ Add a CI step in `.github/workflows/deploy.yml` before the Vite build (done — see commit on `refactoring` branch):
   ```yaml
   - name: Type Check Frontend
     run: |
       cd frontend
       npm run check
   ```
   This runs **after** WASM build (because `@wasm/...` imports need the `pkg/` directory) and **before** `npm run build`. Fails the deploy on TS errors.
2. ✅ Move TypeScript and Vite to `devDependencies` (done). Versions kept at `^6.0.2` / `^8.0.7` since those are the current latest stable.
3. Fix the real errors instead of silencing them. Most fall into three buckets:
   - **`Float64Array` vs `number[]`** — either add helper `fromWasmArray()` conversions, or update the TS signatures to accept `Float64Array | number[]` (use `ArrayLike<number>`). This is a known friction point with wasm-bindgen and deserves a dedicated type.
   - **`'currentParameters' is possibly 'null'`** — disappears once `AppState` (§1) asserts initialization.
   - **Unused params (`_t`, `timeSeconds`)** — either prefix `_` consistently or actually remove them.
4. Add an `eslint.config.js` with `@typescript-eslint/strict` or `biome check` — there's currently zero linting. For a 20k LOC project that is risky.

---

## 3. Commit `Cargo.lock` 🟡 Medium

`.gitignore` contains:
```
Cargo.lock
```

For a **binary / WASM cdylib** (not a library crate for downstream consumers), you should always commit `Cargo.lock`. The project produces a deployed artifact; not having a lockfile means:

- The nightly CI run picks different patch versions every time.
- Auditability of what's actually in the deployed WASM is lost.
- A supply-chain attack on a minor version bump would land in production silently.

**Action:** Remove `Cargo.lock` from `.gitignore`, run `cargo generate-lockfile`, and commit it.

---

## 4. Unused & misleading dependencies 🟡 Medium

- **`comlink`** is in `frontend/package.json` dependencies but zero references exist in `frontend/src`. The README even has `web workers + comlink` in the architecture section, but no worker exists. Either remove comlink or actually use a worker — and the WASM work is CPU-heavy enough (1.8 MB wasm, synchronous VE recalcs on every slider move) that **offloading VE calculation to a worker is a legitimate next step**, not decoration. Right now every slider drag blocks the main thread.
- **`vite.config.ts`** has `worker: { format: 'es' }` configured for workers that don't exist.
- ~~**`typescript`** is in `dependencies` instead of `devDependencies`.~~ ✅ Fixed in item 1.
- ~~`vite ^8.0.7`, `typescript ^6.0.2` — Vite 8 and TypeScript 6 are future/non-existent versions.~~ **Correction:** they do exist and are current latest stable, see §2.

---

## 5. Unsafe / ineffective security layer 🟡 Medium

`backend/src/security.rs` is mostly decorative:

- `SecurityValidator::sanitize_numeric_input` is defined but **never called anywhere in the codebase** (the VE calculator just uses `max(0.001)` inline). Dead code pretending to be a defence-in-depth layer.
- `validate_fit_data` checks the same things `parse_fit_file` checks again 40 lines later. Two places to keep in sync, no additional value.
- The frontend `DataProtection.setupContentSecurityPolicy()` at runtime is ineffective — CSP has to be delivered as an HTTP header or in the static `<meta>` tag before any script loads. The static `<meta>` in `index.html` is what's actually protecting the app; the runtime `setupContentSecurityPolicy` is a no-op at best and misleading to future contributors.

**Action:** Either make `security.rs` do something meaningful (magic-number sanity on every field, bounded arithmetic checks in the hot path) or delete it and inline the 8 lines of validation. Remove `DataProtection.setupContentSecurityPolicy()` — the real CSP is already in `index.html`.

---

## 6. WASM ↔ JS data copying is the real perf cost, not the math 🟡 Medium

Every getter on `FitData`, `VEData`, `VEResult` calls `.clone()`:

```
backend/src/fit_parser.rs: 24 clones in getters
backend/src/virtual_elevation.rs: 6 clones in getters
```

Every `fit_data.timestamps` call from TypeScript triggers a `Vec<f64>::clone()` on the Rust side and then a `Float64Array` copy across the WASM boundary. `handleAnalyze` reads each of ~12 fields out of `FitData`, then `setupVESliders` threads them around, then each of 4 plots reads them again — potentially 60+ wasm→JS copies per analysis run.

**Fix:** Expose the data once as a single `get_data_view()` that returns a `{ timestamps, power, ... }` JS object built by `serde_wasm_bindgen::to_value`, and cache it on the TS side in `AppState`. Or, keep the struct in Rust and have the calculator be the only thing that reads it — pass indices rather than arrays into the recompute loop.

This is worth doing only after §1 (consolidate state), because without a clear `AppState` owner there's no natural place to cache the decoded data.

---

## 7. DEM processor needs internal decomposition 🟡 Medium

`backend/src/dem_processor.rs` is 1,297 lines in a single file with functions like:

| Function | LOC |
|---|---|
| `new_with_world_file` | 217 |
| `parse_geotiff_tags` | 183 |
| `setup_projection_from_prj` | 123 |
| `setup_projection` | 106 |
| `batch_lookup` | 90 |

The file mixes four distinct responsibilities:
1. **TIFF/GeoTIFF decoding** (`new_with_world_file`, `parse_nodata`, `convert_to_f32`)
2. **Geospatial metadata parsing** (`parse_geotiff_tags`, `parse_world_file`, `parse_srtm_filename`, `parse_usgs_one_meter_filename`)
3. **Projection/CRS setup** (`setup_projection`, `setup_projection_from_prj`, `extract_utm_zone_from_prj`, `extract_transverse_mercator_params`, `estimate_utm_zone_from_coords`)
4. **Sampling** (`batch_lookup`, `get_pixel_value`)

**Action:** Split into a module: `dem/mod.rs`, `dem/tiff_loader.rs`, `dem/geotransform.rs`, `dem/projection.rs`, `dem/sampler.rs`. Each becomes 150–300 lines and independently testable. The existing single `#[test] fn test_geotransform` shows there's intent to test, but you can't easily unit-test a 200-line constructor that takes a TIFF file.

---

## 8. No test coverage 🟡 Medium

```
$ find . -name "*.test.ts" -o -name "*.spec.ts"
(nothing)

$ grep -l "#[test]" backend/src/*.rs
backend/src/air_density.rs      (✓ has tests)
backend/src/dem_processor.rs    (✓ one test)
backend/src/virtual_elevation.rs (✗ none)
backend/src/fit_parser.rs       (✗ none)
backend/src/fitparser_wrapper.rs (✗ none)
```

Zero frontend tests. The core `virtual_elevation.rs` — the actual algorithmic centrepiece of this project — has **no unit tests**. Robert Chung's formula is well-defined; golden tests with ~20 synthetic input rows would catch regressions in CdA/Crr math, trim boundaries, and wind triangulation. This should exist before any of the refactors above.

**Minimum viable test set:**
1. `virtual_elevation.rs`: flat constant-power ride should give VE ≈ 0; pure headwind should increase power requirement; R² calculation on a synthetic linear profile.
2. `GpsLapDetection.ts`: synthetic GPS trace crossing a marker 3 times in the same direction should yield exactly 3 laps.
3. `ParameterStorage.ts`: file-hash identity test (same content → same hash).
4. `air_density.rs`: already has tests; extend coverage.

Vitest (already compatible with Vite) is the cheapest way to add a TS test runner.

---

## 9. `frontend/index.html` is 1744 lines with a 1596-line inline `<style>` 🟢 Small

No sourcemap, no autocompletion, no preprocessor, no reusability. Either:
- Move the styles to `frontend/src/styles/*.css` imported via Vite (recommended, zero behavioural change).
- Or, if keeping inline for single-file simplicity is a hard requirement, at least split into `style-layout.css`, `style-components.css`, `style-plots.css` and concatenate via a build step.

This is cosmetic but it's blocking any future themeability or dark-mode work.

---

## 10. 156 `console.log` calls in main.ts 🟢 Small

Production builds ship with all of them:

```
console.log('Trim Start changed:', { ... });       // fires on every drag
console.log('🌬️ Found air speed data, …');        // UX fine but noisy
console.log('currentFitResult keys:', …);          // debugging leftover
```

Introduce a tiny `log.ts` with levels (`debug`, `info`, `warn`, `error`) that no-ops `debug` in production. Rule out leftover `console.log` via ESLint's `no-console` (allow `warn`/`error`).

---

## 11. Documentation overstates state 🟢 Small

`README.md` still contains the full original migration plan (Phase 1–6 with code snippets, ~1500 lines of planning material) mixed with "Current Status 75% complete". `PROJECT_STATUS.md` duplicates some of that. The codebase has clearly moved past the README (DEM integration, weather API, GPS lap detection, out-and-back mode are all implemented but the README says they're "pending"). This confuses new contributors about what's shipped versus what's planned.

**Action:** Split into `README.md` (what the app does, how to run it), `ARCHITECTURE.md` (actual module layout, data flow, WASM boundary), and `ROADMAP.md` (the leftover todos). Archive the Phase 1–6 migration plan — it's history now.

---

## 12. Other smells worth noting 🟢 Small

- `TODO` markers in `main.ts` (lines 4140, 4163, 4186) — three `// TODO: Add stacked … traces per lap` in the GPS-lap wind/power/VD renderers, meaning those plots are currently empty placeholders in that mode.
- `_veCalculator` is declared with a comment "unused, reserved for future" — exactly the kind of dead code `noUnusedLocals` is supposed to catch, masked by an underscore prefix.
- `gpsLapHandlersInitialized` / `outAndBackHandlersInitialized` booleans are a sign of re-entry bugs; setup functions that guard themselves with "was I already called?" flags usually mean lifecycle ownership is unclear. Once `AppState` owns mode transitions, these flags disappear.
- Magic numbers (`50_000_000` byte limit, `1e-10` determinant threshold, proximity threshold `20`, angle threshold `30`) are scattered across both TS and Rust. Move them to `constants.ts` / `constants.rs`.
- `.gitignore` ignores `backend/target/` (good) but the 1.3 GB `backend/target/` directory is sitting on disk. Consider adding `cargo clean` to the repo's README housekeeping section.

---

## Suggested refactor order (what I would actually do)

Ranked by *leverage/effort*:

1. **Fix CI type checking (§2).** ~1 hour. Unblocks everything else — you need a compiler that actually fails.
2. **Commit Cargo.lock (§3).** 5 minutes. Reproducibility.
3. **Add golden tests for `virtual_elevation.rs` (§8).** Half a day. Safety net for refactor.
4. **Extract `AppState` class (§1, step 1).** 1 day. Just move the 53 `let`s into a class; no logic changes. Enables §2 fixes to stick.
5. **Extract `AnalysisContext` + plot modules (§1, steps 2–3).** 2–3 days. This is where you claw back ~2000 lines from `main.ts`.
6. **Collapse backend duplication (`calculate_virtual_slope_with_cda_array`, etc.) (§1 backend).** Half a day.
7. **Split `dem_processor.rs` (§7).** 1 day.
8. **Move CSS out of `index.html` (§9).** Few hours.
9. **Remove `comlink` or actually use a web worker for VE recompute (§4).** 1 day for the worker path — a real UX win on slider drag.
10. **Remove dead `security.rs` / `setupContentSecurityPolicy` (§5).** 30 minutes.

Everything from #4 down is achievable *without* breaking users, because the external surface is unchanged. You can ship those refactors in small PRs.

---

## What's actually good

To be fair — this is not a bad project, just a project that outgrew its original file layout. Things that are **well done** and shouldn't be touched:

- **The Rust WASM core boundary is the right design** for a privacy-focused tool. Keeping VE math, FIT parsing, DEM sampling and air density in Rust is correct.
- **`ParameterStorage` / `ResultsStorage`** are cleanly encapsulated IndexedDB wrappers with proper migrations (version 1 → 2 → 3). These are the nicest files in the frontend.
- **`AnalysisParameters.ts`**, `GpsLapDetection.ts`, `DEMManager.ts`, `WeatherAPI.ts`, `WeatherCache.ts` are all properly sized (200–750 lines each), use classes with typed public APIs, and don't touch globals. The pattern to replicate for the refactor already exists **inside the same repo** — you just need to pull the rest of `main.ts` into that shape.
- **CSP is correctly set in the static HTML** (`connect-src` whitelist is tight, `'wasm-unsafe-eval'` limited to scripts, no inline scripts). Privacy-by-design claim holds up on inspection.
- **Vite build output is reasonable**: 404 KB JS + 1.8 MB WASM + 48 KB HTML, all under the 5 MB goal from the README.
- **GitHub Actions deployment works** and is simple enough to understand.

The bones are good. The problem is entirely that one file grew to 9000 lines and TypeScript's safety net was disconnected without anyone noticing.

---

## Bottom line

**Refactor is needed, but incrementally — not a rewrite.** Start by re-enabling the type checker in CI (§2) and adding a Cargo lockfile (§3). Then add tests around the VE math (§8) so you have a safety net. Only then start peeling pieces out of `main.ts` using `AppState` + `AnalysisContext` + plot modules (§1). In ~2 weeks of focused work you can bring `main.ts` from 9015 lines to ~500 without changing a single user-visible behaviour, and you'll have a codebase where the TODOs in the README (export features, parameter persistence improvements, optimization) actually become feasible to implement.
