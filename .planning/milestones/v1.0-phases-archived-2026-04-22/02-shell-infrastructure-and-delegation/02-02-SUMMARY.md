---
requirements-completed: ["SHEL-01"]
phase: 02-shell-infrastructure-and-delegation
plan: 02
---

# Phase 02 Plan 02: Shell Analysis Interfaces and Delegation Wiring Summary

Pure payload-preparation function with injected dependencies and named render delegate factories extracted from handleAnalyze into shell/analysis/.

## Tasks Completed

| # | Name | Commit | Files |
| 1 | Define shell dependency types and pure payload-preparation function | `47ab5b9` | types.ts, prepareAnalysisPayload.ts, prepareAnalysisPayload.test.ts |
| 2 | Create named render delegate factories and barrel export | `c9ec703` | renderDelegates.ts, index.ts |

## What Was Built

### Shell Dependency Types (`types.ts`)
- `ShellServices`: wiring container with AppState reference and UI feedback callbacks (showLoading, hideLoading, showError). Per D-05: no DOM nodes, Plotly containers, or service singletons.
- `ShellAnalysisContext`: extends ShellServices with `waitForPlotly()` for Plotly-dependent rendering paths.

### Pure Payload Preparation (`prepareAnalysisPayload.ts`)
- `PayloadPreparationInput`: input interface with fitData, selection, params, cda, crr, and two injected dependencies (getNormalizedActivityArrays, calculateRhoArray).
- `PreparedPayload`: output interface with filteredData, initialResult, selectedIndices, defaultAirSpeedOffset, rhoArray.
- `prepareAnalysisPayload(input)`: pure function replicating handleAnalyze steps 4-10 (normalize arrays, resolve wind, select indices, filter arrays, compute rho, run VE calculator). No AppState mutation, no DOM dependency.

### Unit Tests (`prepareAnalysisPayload.test.ts`)
- 5 tests: filtering correctness, wind resolution offset, null rho fallback, rho-by-index selection, empty-data guard.
- Uses vi.mock for VeCalculatorFactory (WASM avoidance) and AnalysisModes (dependency isolation).

### Render Delegates (`renderDelegates.ts`)
- `createStandardRenderDelegate`: wraps StandardRenderArgs callback with debug logging.
- `createGpsLapRenderDelegate`: wraps GPS-lap callback (typed via ModeRenderCallbacks['gpsLap']).
- `createOutAndBackRenderDelegate`: wraps out-and-back callback (typed via ModeRenderCallbacks['outAndBack']).
- `createModeRenderCallbacks`: convenience factory producing a ModeRenderCallbacks object from raw render functions.

### Barrel Export (`index.ts`)
- Re-exports types, prepareAnalysisPayload, and renderDelegates.

## Decisions Made

1. **Added params/cda/crr to PayloadPreparationInput** — The plan's interface was missing required inputs for createVeCalculator and calculate_virtual_elevation. Added AnalysisParameters, cda, and crr fields.
2. **Typed getNormalizedActivityArrays with NormalizedActivityArrays** — The plan suggested `any`, but importing the actual type from ActivityArrayCache provides compile-time safety with no testability cost.
3. **Used ModeRenderCallbacks method type extraction** — Instead of importing LapIndexRange, ActivityDataLike, OutAndBackSection, AnalysisParameters separately, used `ModeRenderCallbacks['gpsLap']` for clean type derivation.
4. **Mocked VeCalculatorFactory and AnalysisModes** — Tests mock these modules to avoid WASM runtime dependency and transitive module loading issues.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added missing VE calculator inputs to PayloadPreparationInput**
- **Found during:** Task 1 implementation
- **Issue:** Plan's PayloadPreparationInput lacked params, cda, crr needed by createVeCalculator
- **Fix:** Added params: AnalysisParameters, cda, crr fields to the interface
- **Files modified:** prepareAnalysisPayload.ts
- **Commit:** 47ab5b9

**2. [Rule 1 - Bug] Fixed unused parameter TS6133 in test mock**
- **Found during:** Task 1 verification
- **Issue:** `crr` parameter in mock calculate_virtual_elevation was unused, causing TS6133
- **Fix:** Prefixed with underscore: `_crr`
- **Files modified:** prepareAnalysisPayload.test.ts
- **Commit:** 47ab5b9

## Verification Results

| Check | Result |
| `vitest run src/shell/analysis/` | ✅ 5/5 tests pass |
| `tsc --noEmit` | ✅ No type errors |
| `npm run check` | ✅ Clean |
| `npm run lint` | ✅ Clean (0 warnings) |
| `npm run test` | ✅ 43/43 tests pass (all suites) |
| `npm run build` | ✅ Production build succeeds |
| No `console.` in shell/analysis/ | ✅ Clean |
| No DOM imports in shell/analysis/ | ✅ Clean |
| No AppState mutation in prepareAnalysisPayload | ✅ Clean |
| main.ts not modified | ✅ Confirmed |

## Requirement Completion

- **SHEL-01**: Shell dependency types exist as separate interfaces from AppState. Analysis payload preparation is a named, testable function. Named render delegates exist as importable functions satisfying ModeRenderCallbacks.

## Self-Check: PASSED

- [x] frontend/src/shell/analysis/types.ts — FOUND
- [x] frontend/src/shell/analysis/prepareAnalysisPayload.ts — FOUND
- [x] frontend/src/shell/analysis/prepareAnalysisPayload.test.ts — FOUND
- [x] frontend/src/shell/analysis/renderDelegates.ts — FOUND
- [x] frontend/src/shell/analysis/index.ts — FOUND
- [x] Commit 47ab5b9 — FOUND
- [x] Commit c9ec703 — FOUND
- [x] 02-02-SUMMARY.md — FOUND
