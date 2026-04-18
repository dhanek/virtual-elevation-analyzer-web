---
phase: 04-gps-and-out-and-back-shell-extraction
plan: 02
status: complete
requirements: [SHEL-06, BEHV-03, BEHV-04]
commits: [d919945, 644891a]
---

## What was built

Extracted the out-and-back shell (~1225 lines) from `main.ts` into `shell/outAndBack/`, mirroring the GPS-lap extraction done in plan 04-01 and completing SHEL-06.

### New modules under `shell/outAndBack/`
- `types.ts` — `OutAndBackVEProfile` interface
- `outAndBackPlots.ts` — `renderOutAndBackPlots`, `renderOutAndBackWindPlot`, `renderOutAndBackPowerPlot`, `renderOutAndBackVdPlot`, `calculateOutAndBackStats`, `calculateOutAndBackMeanElevation`, `buildOutAndBackMultiSegmentSeries`
- `renderOutAndBack.ts` — `showOutAndBackVEAnalysis`, `showOutAndBackVEPlot`, `setupOutAndBackSliderSync`
- `updateOutAndBack.ts` — `updateOutAndBackVEPlots` (verbatim preservation), `recalculateOutAndBackVE`
- `outAndBackScreenshot.ts` — `saveOutAndBackScreenshot`
- `index.ts` — barrel re-exports

### `main.ts` changes
- Removed all 14 out-and-back function/interface definitions (lines 2207-3432 in the pre-edit file)
- Added `import { showOutAndBackVEAnalysis } from './shell/outAndBack'`
- Rewired the `outAndBack` callback in `createModeRenderCallbacks` to pass `{ appState, showLoading, hideLoading, showError }`, `parameterStorage`, `resultsStorage`, and `waitForPlotly` as explicit DI parameters
- Removed now-unused imports: `AIR_SPEED_CALIBRATION_*`, `calculateAutoAirSpeedCalibrationPercent`, `clampAirSpeedCalibrationPercent`, `formatAirSpeedCalibrationPercent`, `buildSegmentSupplementarySeries`, `SegmentSupplementarySeries`, `resolveMultiSegmentAnalysisParams`, `saveCurrentMultiSegmentSettings`, `buildAutoCalibrationSegmentsFromRanges`, `extractSegmentData`, `getMultiSegmentColor`, `interpolateElevation`, `createVeCalculator`, `buildMultiSegmentPowerFigure`, `buildMultiSegmentVirtualDistanceFigure`, `buildMultiSegmentWindFigure`, `getSelectedWindSource`, `bindWindSourceRadios`, `setupTabSwitching`, `bindActionFooter`, `OutAndBackSection` type
- Kept `runOutAndBackDetection`, `updateOutAndBackSectionsUI`, `handleOutAndBackSectionSelectionChange`, `updateOutAndBackButtonState` in main.ts (detection UI helpers, not shell code)

**Line count:** `main.ts` 3457 → 2213 (−1244 lines).
**Combined with 04-01:** `main.ts` 4776 → 2213 (−2563 lines).

## Key files
- Created: `frontend/src/shell/outAndBack/{types,outAndBackPlots,renderOutAndBack,updateOutAndBack,outAndBackScreenshot,index}.ts`
- Modified: `frontend/src/main.ts`

## Deviations

- `showOutAndBackVEAnalysis` takes `waitForPlotly` as an explicit parameter and forwards it to `showOutAndBackVEPlot` (GPS-lap does similarly); this propagates down to sliders / recalculate so the shell module does not capture any globals.
- `updateOutAndBack.ts` uses a static import of `showOutAndBackVEAnalysis` from `./renderOutAndBack` (same as GPS-lap); an initial dynamic-import attempt surfaced an `INEFFECTIVE_DYNAMIC_IMPORT` warning from Vite and was converted to static to match GPS-lap pattern.

## Verification

- `npm run check` — exits 0
- `npm run lint` — exits 0
- `npm run test` — 9 files, 43 tests pass
- `npm run build` — exits 0
- `bash scripts/validate-ui-shell-guardrails.sh` — passes
- `grep "function showOutAndBackVEAnalysis" frontend/src/main.ts` — no matches
- `grep "interface OutAndBackVEProfile" frontend/src/main.ts` — no matches
- `grep "showOutAndBackVEAnalysis" frontend/src/shell/outAndBack/renderOutAndBack.ts` — matches

## Self-Check: PASSED

All acceptance criteria met. CI green. SHEL-06 complete. `main.ts` now delegates all multi-segment (GPS-lap and out-and-back) analysis to dedicated shell modules.
