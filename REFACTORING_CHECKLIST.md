# Refactoring Checklist

Based on the revised refactoring plan validated against the current codebase.

| Step | Status | Summary | Notes |
|---|---|---|---|
| 5 | ✅ Done | Introduce typed `AppState` + unified `LoadedActivity` model | Added `frontend/src/state/AppState.ts`, moved frontend state behind `appState`, added `LoadedActivity`, `ActivityData`, `SelectedSlice`, and normalized CSV activity loading. |
| 6 | ✅ Done | Extract `ActivityLoader`, `WindSourceResolver`, and `SegmentExtractor` | Added `frontend/src/activity/ActivityLoader.ts`, `frontend/src/analysis/WindSourceResolver.ts`, and `frontend/src/analysis/SegmentExtractor.ts`; rewired `frontend/src/main.ts` to use them. |
| 7 | ✅ Done | Extract `AnalysisInput` / `PlotContext` + pure plot modules | Added `frontend/src/analysis/AnalysisInput.ts`, `frontend/src/plots/PlotContext.ts`, and `frontend/src/plots/StandardPlotBuilders.ts`; rewired standard VE/wind/power/VD plotting in `frontend/src/main.ts` to use typed inputs and pure builders. |
| 8 | ✅ Done | Replace mode branching with mode modules (`standard`, `gpsLap`, `outAndBack`) | Added `frontend/src/modes/analysis/*` mode handlers and rewired `handleAnalyze()` to dispatch through them instead of hard-coded branching. |
| 9 | ✅ Done | Cache normalized arrays and centralize VE calculator creation | Added `frontend/src/analysis/ActivityArrayCache.ts` and `frontend/src/analysis/VeCalculatorFactory.ts`; cached normalized activity arrays/Float64Array wrappers and replaced repeated calculator wiring in `frontend/src/main.ts`. |
| 10 | ✅ Done | Collapse backend VE duplication in `backend/src/virtual_elevation.rs` | Merged duplicated scalar/array VE paths behind shared internal helpers, centralized calculator construction, and added backend regression tests for uniform CdA/rho-array equivalence. |
| 11 | ✅ Done | Implement GPS-lap and out-and-back wind / power / VD tabs | Added segment supplementary-series helpers and multi-segment plot builders; replaced the placeholder GPS-lap/out-and-back wind, power, and VD tabs with real plots and hid VD when FIT wind data is not the active source. |
| 12 | ✅ Done | Add a frontend lint + test baseline | Added ESLint + Vitest to `frontend/`, introduced baseline scripts/config (`lint`, `test`, `eslint.config.js`, `vitest.config.ts`), added initial unit tests for wind/supplementary-series helpers, and wired lint/tests into `.github/workflows/deploy.yml`. |
| 13 | ✅ Done | Introduce a leveled `log.ts` and remove raw debug spam | Added `frontend/src/utils/log.ts`, replaced raw `console.*` across `frontend/src` with leveled logger calls, and enforced `no-console` via ESLint outside the logger implementation. |
| 14 | ✅ Done | Simplify the misleading security layer | Replaced the misleading frontend `DataProtection` security wrapper with explicit file-validation helpers, removed runtime CSP injection and unload-time “secure memory wipe”, and reduced backend FIT validation to a small internal helper instead of an exported `SecurityValidator` API. |
| 15 | ✅ Done | Split `backend/src/dem_processor.rs` into focused modules | Kept the public `DEMProcessor` API intact while splitting the large backend DEM module into `backend/src/dem_processor/{tiff_loader,geotransform,projection,sampler}.rs` plus a thin root file with shared types/tests. |
| 16 | ✅ Done | Move CSS out of `frontend/index.html` | Extracted the large inline stylesheet into `frontend/src/styles/index.css`, linked it from `frontend/index.html`, and removed remaining inline `style` attributes from the HTML file. |
| 17 | ✅ Done | Split and modernize the docs | Rewrote the stale top-level docs, added `ARCHITECTURE.md` and `ROADMAP.md`, refreshed `README.md` / `PROJECT_STATUS.md` / `DEPLOYMENT.md`, and converted `README-IMPLEMENTATION.md` into an explicit historical archive note. |
| 18 | ✅ Done | Replace magic numbers with named, local constants | Replaced repeated hidden thresholds with named constants in `frontend/src/main.ts`, `frontend/src/utils/GpsLapDetection.ts`, `frontend/src/components/MapVisualization.ts`, `frontend/src/utils/GeoCalculations.ts`, and `backend/src/dem_processor.rs` (trim window size, air-speed calibration bounds, lap-detection thresholds, map paddings/marker sizes, earth radius, and affine epsilon). |
| 19 | ✅ Done | Remove lifecycle guard flags and write-only globals once mode lifecycle is encapsulated | Removed the GPS-lap / out-and-back handler-init guard flags and their mutable handler globals from `frontend/src/main.ts`, switched those slider controls to idempotent `oninput` / `onchange` bindings, dropped the reset logic in `initializeSection3()`, and deleted the write-only `window.__gpsLap*` / `window.__outAndBack*` globals. |
| 20 | ✅ Done | Profile slider recompute; only then add a Web Worker if it is still needed | Added `frontend/scripts/profile-slider-recompute.ts` plus `npm run profile:slider`, benchmarked the cached recompute core (roughly low-single-digit millisecond medians on this machine across standard, compare, GPS-lap, and out-and-back scenarios), and decided **not** to add a Web Worker yet. Removed the unused `comlink` dependency and Vite worker config.

## Pipeline Consistency Check (Phase 1 verification)

- [x] air_speed_offset changes trigger VE recalculation in Standard mode (via orchestrator)
- [x] airSpeedCalibrationPercent changes trigger VE recalculation in Standard mode (via local call)
- [x] GPS-lap mode updates work independently (uses mode handler)
- [x] Out-and-back mode updates work independently (uses mode handler)
- [x] No duplicate triggers when parameters change (orchestrator handles air_speed_offset, local removed)


### Parameter Update Paths by Mode

**Standard VE Mode:**
- trim sliders → dispatchEvent → handleParametersChange → orchestrator → updateVEPlots
- CdA/Crr sliders → local updateVEPlots call
- air_speed_offset → setParameters → handleParametersChange → dispatchEvent → updateVEPlots
- airSpeedCalibrationPercent → local updateVEPlots call (AppState-level, not persisted)

**GPS-Lap Mode:**
- CdA/Crr sliders → mode handler → recalculateGpsLapVE → showGpsLapVEAnalysis
- Independent from orchestrator

**Out-and-Back Mode:**
- CdA/Crr sliders → mode handler → recalculateOutAndBackVE → showOutAndBackVEAnalysis
- Independent from orchestrator |
