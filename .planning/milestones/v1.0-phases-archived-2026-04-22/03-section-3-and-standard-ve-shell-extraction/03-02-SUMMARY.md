# Phase 3, Plan 02 Summary: Extract Standard VE Shell

**Completed:** 2026-04-16
**Goal:** Extract standard VE panel render, bind, and update shell behavior from `main.ts` into dedicated shell modules.

## Artifacts Created

- `frontend/src/shell/ve/autoRho.ts`: `calculateAutoRho` extracted (weather fetch + air density calculation).
- `frontend/src/shell/ve/bindStandardSliders.ts`: `setupVESliders`, `updateVEPlots`, `updateVEPlotsWithWindSource` extracted.
- `frontend/src/shell/ve/renderStandardVe.ts`: `showVirtualElevationAnalysisInline` and `initializeVEAnalysis` extracted.
- `frontend/src/shell/ve/index.ts`: Barrel export for the new VE shell modules.
- `frontend/src/shell/dom/notifications.ts`: `showNotification` helper extracted.
- `frontend/src/shell/analysis/storageHandlers.ts`: `handleSaveScreenshot`, `handleStoreResult`, `handleExportAllResults`, `saveCurrentLapSettings` extracted.

## Files Modified

- `frontend/src/main.ts`:
  - Removed `calculateAutoRho`, `setupVESliders`, `updateVEPlots`, `updateVEPlotsWithWindSource`, `showVirtualElevationAnalysisInline`, `initializeVEAnalysis`, `showNotification`, and the save/export/screenshot handlers.
  - Deleted dead code from pre-extraction era (`createVirtualElevationPlots`, `updateCdaValidationPlots`, `updateVEMetrics`, `updateVEMetricsComparison`, `createVirtualElevationPlotsComparison` — replaced by the figure builders used inside the new shell modules).
  - Cleaned up unused imports following the extraction.
  - Updated all `calculateAutoRho` call sites to pass `(appState, parametersComponent, { appState, showLoading, hideLoading, showError })`.

## Notable Changes

- **Dependency injection:** New shell modules accept `appState`, `parametersComponent`, `mapVisualization`, and a `ShellServices` container as explicit arguments — no hidden globals.
- **Scope expansion:** Plan scope grew slightly to also move notification + storage handlers so the shell boundary is clean; both were incidental coupling to the extracted render path.
- **Dead-code cleanup:** The pre-extraction duplicates in `main.ts` (old plot-creation helpers) were removed since the shell-side figure builders supersede them. This is a net reduction of ~2300 lines in `main.ts`.

## Verification Results

- `npm run check`: PASSED (TypeScript type-check)
- `npm run test`: PASSED (43/43 tests)
- `npm run build`: PASSED (Vite build, 412 kB bundle)
