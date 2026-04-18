---
phase: 04-gps-and-out-and-back-shell-extraction
plan: 01
status: complete
requirements: [SHEL-05, BEHV-03, BEHV-04]
commits: [5159f5a, 6678703]
---

## What was built

Extracted the GPS-lap shell (~1300 lines) from `main.ts` into `shell/gpsLap/`, and established the shared multi-segment infrastructure that plan 04-02 will reuse for out-and-back.

### New modules under `shell/gpsLap/`
- `types.ts` — `LapVEProfile` interface
- `gpsLapPlots.ts` — `renderGpsLapVEPlots`, `renderGpsLapWindPlot`, `renderGpsLapPowerPlot`, `renderGpsLapVdPlot`, `calculateGpsLapStats`, `calculateMeanElevationProfile`
- `renderGpsLap.ts` — `showGpsLapVEAnalysis`, `showGpsLapVEPlot`, `setupGpsLapSliderHandlers`, `getGpsLapNumberForRange`
- `updateGpsLap.ts` — `updateGpsLapVEPlots` (verbatim tab/scroll save-restore preserved), `recalculateGpsLapVE`
- `gpsLapScreenshot.ts` — `saveGpsLapScreenshot`
- `index.ts` — barrel re-exports

### New shared module under `shell/multiSegment/`
- `shared.ts` — `MULTI_SEGMENT_COLORS`, `getMultiSegmentColor`, `interpolateElevation`

### Expanded `analysis/MultiSegmentSettings.ts` (42 → 199 lines)
Consolidated persistence helpers, each taking explicit `appState` and `parameterStorage` parameters instead of closure captures:
- `resolveMultiSegmentAnalysisParams`
- `saveCurrentMultiSegmentSettings`
- `saveMapTrimSettings`
- `buildAutoCalibrationSegmentsFromRanges`

### `main.ts` changes
- Removed all GPS-lap function definitions
- Removed `buildAutoCalibrationSegmentsFromRanges`, `MULTI_SEGMENT_COLORS`, `getMultiSegmentColor`, `interpolateElevation` definitions
- Added imports from the new shell/gpsLap and shell/multiSegment modules
- Rewired the `gpsLap` callback in `createModeRenderCallbacks` to pass `{ appState, showLoading, hideLoading, showError }`, `parameterStorage`, and `resultsStorage` as explicit DI parameters
- Kept imports of `getMultiSegmentColor`, `interpolateElevation`, `resolveMultiSegmentAnalysisParams`, etc. so that the remaining out-and-back code (to be extracted in 04-02) still compiles

**Line count:** `main.ts` 4776 → 3459 (−1317 lines).

## Key files
- Created: `frontend/src/shell/multiSegment/shared.ts`
- Created: `frontend/src/shell/gpsLap/{types,gpsLapPlots,renderGpsLap,updateGpsLap,gpsLapScreenshot,index}.ts`
- Modified: `frontend/src/analysis/MultiSegmentSettings.ts`
- Modified: `frontend/src/main.ts`

## Deviations

- `updateGpsLapVEPlots` signature takes `parameterStorage` per the plan, but the current lifted implementation doesn't reference it (parameter is prefixed `_parameterStorage` to silence `noUnusedParameters`). The DI slot is preserved for the out-and-back mirror and future use (e.g., if update ever needs to persist settings).
- Removed a stray `// eslint-disable-next-line no-unsanitized/property` directive from `renderGpsLap.ts` because this project's ESLint config does not register the `no-unsanitized` plugin (rule name would have caused lint error).

## Verification

- `npm run check` — exits 0
- `npm run lint` — exits 0
- `npm run test` — 9 files, 43 tests pass
- `npm run build` — exits 0

## Self-Check: PASSED

All acceptance criteria met. CI green. Shared infrastructure in place for plan 04-02.
