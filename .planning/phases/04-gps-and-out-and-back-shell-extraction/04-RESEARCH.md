# Phase 4: GPS and Out-and-Back Shell Extraction - Research

**Researched:** 2026-04-17
**Domain:** Frontend UI shell extraction (TypeScript, vanilla DOM, Plotly.js)
**Confidence:** HIGH

## Summary

Phase 4 extracts ~2500 lines of GPS-lap shell (lines 2250-3515) and out-and-back shell (lines 3517-4750) from `frontend/src/main.ts` into dedicated modules under `frontend/src/shell/gpsLap/` and `frontend/src/shell/outAndBack/`, mirroring the Phase 3 `shell/ve/` extraction pattern. The code is a verbatim lift-and-shift: no new abstractions, no behavior changes.

The primary risk surfaces are BEHV-03 (tab/scroll preservation during in-place updates) and BEHV-04 (air-speed calibration correctness across GPS lap, GPS gate one-way, and out-and-back modes). Both are preserved by the D-08/D-09 decision to lift update functions verbatim without DRY-abstracting the tab/scroll save-restore logic.

**Primary recommendation:** Extract GPS-lap shell first (04-01), then out-and-back shell (04-02), then validate both behavioral invariants at checkpoint depth (04-03). Each extraction follows the established render/bind/plot file split from Phase 3.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Parallel per-mode directories: `shell/gpsLap/` and `shell/outAndBack/`, each with render, bind, update, plot, and screenshot files. Mirrors Phase 3 `shell/ve/` pattern.
- D-02: Thin `shell/multiSegment/shared.ts` for truly shared helpers (e.g., `getMultiSegmentColor`, `interpolateElevation`, mean-elevation calculation) if duplication emerges.
- D-04: Plot renderers stay co-located inside each shell mode directory as `gpsLapPlots.ts` and `outAndBackPlots.ts`.
- D-05: Existing `plots/MultiSegmentPlotBuilders.ts` keeps current scope (shared trace-builder helpers). Does not absorb full plot render functions.
- D-06: `resolveMultiSegmentAnalysisParams`, `saveCurrentMultiSegmentSettings`, `saveMapTrimSettings`, and `buildAutoCalibrationSegmentsFromRanges` consolidate into `analysis/MultiSegmentSettings.ts`.
- D-07: Both shell modules import persistence helpers from `analysis/MultiSegmentSettings.ts`.
- D-08: Verbatim lift of `updateGpsLapVEPlots` and `updateOutAndBackVEPlots` into their respective shell modules.
- D-09: Correctness over DRY for BEHV-03. Duplication between update functions is acceptable.
- D-10: Keep `AppState` state-only. Use `ShellServices` DI pattern.
- D-11: Treat `MapVisualization.ts` as secondary only.
- D-12: Preserve existing analysis math, WASM interfaces, plot builders, and mode-handler architecture.
- D-13: CI parity: `cargo test --lib`, `wasm-pack build`, `npm run check`, `npm run lint`, `npm run test`, `npm run build`.
- D-14: `bash scripts/validate-ui-shell-guardrails.sh` must remain green.
- D-15: Manual browser checklist authoritative for BEHV-03 and BEHV-04.

### Claude's Discretion
- Exact file names and internal structure within `shell/gpsLap/` and `shell/outAndBack/`
- Whether borderline-similar functions become shared or stay per-mode
- Whether to add targeted unit tests for extracted persistence/calibration logic
- How to stage the 3 plans for optimal risk reduction

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SHEL-05 | Maintainer can change GPS-lap shell behavior without editing unrelated standard VE or out-and-back shell code in `main.ts` | GPS-lap code (lines 2250-3515) extracted to `shell/gpsLap/`; function inventory and dependency map documented below |
| SHEL-06 | Maintainer can change out-and-back shell behavior without editing unrelated standard VE or GPS-lap shell code in `main.ts` | Out-and-back code (lines 3517-4750) extracted to `shell/outAndBack/`; function inventory and dependency map documented below |
| BEHV-03 | User keeps active tab and scroll position during in-place GPS auto-adjust and slider updates | Tab/scroll preservation lives in `updateGpsLapVEPlots` and `updateOutAndBackVEPlots`; verbatim lift per D-08/D-09 preserves this; detailed mechanism documented in Pitfall 1 |
| BEHV-04 | User gets correct GPS-based air-speed calibration behavior across all GPS modes after extraction | Calibration flows through `appState.airSpeedCalibrationPercent`, `calculateAutoAirSpeedCalibrationPercent`, and `buildAutoCalibrationSegmentsFromRanges`; dependency chain documented below |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| GPS-lap shell render (HTML template + DOM) | Browser / Client | -- | Vanilla DOM manipulation, template literals |
| GPS-lap slider/calibration binding | Browser / Client | -- | DOM event listeners on slider/input elements |
| GPS-lap VE calculation | Browser / Client (WASM) | -- | WASM calculator invoked client-side |
| GPS-lap plot rendering | Browser / Client | -- | Plotly.js client-side plots |
| Out-and-back shell render | Browser / Client | -- | Same pattern as GPS-lap |
| Out-and-back VE calculation | Browser / Client (WASM) | -- | Same WASM calculator |
| Multi-segment settings persistence | Browser / Client (IndexedDB) | -- | `ParameterStorage` uses IndexedDB via `idb-keyval` |
| Air-speed calibration math | Browser / Client | -- | Pure functions in `analysis/AirSpeedCalibration.ts` |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ^6.0.2 | Type safety | Project standard [VERIFIED: package.json] |
| Vite | ^8.0.7 | Build tool | Project standard [VERIFIED: package.json] |
| Vitest | ^3.2.4 | Unit tests | Project standard [VERIFIED: package.json] |
| Plotly.js | global (CDN) | Plot rendering | Existing project choice, loaded via `waitForPlotly()` [VERIFIED: main.ts] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| wasm-pack | system | WASM build | Backend VE calculator compilation [VERIFIED: validate script] |

### Alternatives Considered
None -- this is a verbatim extraction phase with no new library decisions.

## Architecture Patterns

### System Architecture Diagram

```
main.ts (composition root)
  |
  +-- handleAnalyze()
  |     |
  |     +-- modeHandler.render() --> ModeRenderCallbacks
  |           |
  |           +-- gpsLap callback ---------> shell/gpsLap/renderGpsLap.ts
  |           |                                  +-- showGpsLapVEAnalysis()
  |           |                                  +-- showGpsLapVEPlot()
  |           |                                  +-- setupGpsLapSliderHandlers()
  |           |                                  +-- bindActionFooter()
  |           |                                  +-- setupTabSwitching()
  |           |                                  |
  |           |                                  +-- shell/gpsLap/gpsLapPlots.ts
  |           |                                  |     +-- renderGpsLapVEPlots()
  |           |                                  |     +-- renderGpsLapWindPlot()
  |           |                                  |     +-- renderGpsLapPowerPlot()
  |           |                                  |     +-- renderGpsLapVdPlot()
  |           |                                  |
  |           |                                  +-- shell/gpsLap/updateGpsLap.ts
  |           |                                        +-- updateGpsLapVEPlots()
  |           |                                        +-- recalculateGpsLapVE()
  |           |
  |           +-- outAndBack callback -----> shell/outAndBack/renderOutAndBack.ts
  |                                              +-- showOutAndBackVEAnalysis()
  |                                              +-- showOutAndBackVEPlot()
  |                                              +-- setupOutAndBackSliderSync()
  |                                              +-- bindActionFooter()
  |                                              +-- setupTabSwitching()
  |                                              |
  |                                              +-- shell/outAndBack/outAndBackPlots.ts
  |                                              |     +-- renderOutAndBackPlots()
  |                                              |     +-- renderOutAndBackWindPlot()
  |                                              |     +-- renderOutAndBackPowerPlot()
  |                                              |     +-- renderOutAndBackVdPlot()
  |                                              |
  |                                              +-- shell/outAndBack/updateOutAndBack.ts
  |                                                    +-- updateOutAndBackVEPlots()
  |                                                    +-- recalculateOutAndBackVE()
  |
  +-- analysis/MultiSegmentSettings.ts (consolidated)
  |     +-- resolveMultiSegmentAnalysisParams()
  |     +-- saveCurrentMultiSegmentSettings()
  |     +-- saveMapTrimSettings()
  |     +-- buildAutoCalibrationSegmentsFromRanges()
  |     +-- resolveMultiSegmentSettings() (existing)
  |     +-- sameSelection() (existing)
  |
  +-- shell/multiSegment/shared.ts (if duplication emerges)
        +-- getMultiSegmentColor()
        +-- interpolateElevation()
        +-- calculateMeanElevationProfile()
        +-- MULTI_SEGMENT_COLORS
```

### Recommended Project Structure
```
frontend/src/shell/
  gpsLap/
    renderGpsLap.ts          # showGpsLapVEAnalysis, showGpsLapVEPlot, slider setup, calibration binding
    gpsLapPlots.ts           # renderGpsLapVEPlots, Wind/Power/Vd plot renderers, calculateGpsLapStats
    updateGpsLap.ts          # updateGpsLapVEPlots (verbatim), recalculateGpsLapVE
    gpsLapScreenshot.ts      # saveGpsLapScreenshot
    index.ts                 # re-exports
  outAndBack/
    renderOutAndBack.ts      # showOutAndBackVEAnalysis, showOutAndBackVEPlot, slider setup, calibration binding
    outAndBackPlots.ts       # renderOutAndBackPlots, Wind/Power/Vd plot renderers, calculateOutAndBackStats
    updateOutAndBack.ts      # updateOutAndBackVEPlots (verbatim), recalculateOutAndBackVE
    outAndBackScreenshot.ts  # saveOutAndBackScreenshot
    index.ts                 # re-exports
  multiSegment/
    shared.ts                # getMultiSegmentColor, interpolateElevation, MULTI_SEGMENT_COLORS, calculateMeanElevationProfile (if duplication threshold met)
```

### Pattern 1: Verbatim Lift with ShellServices DI
**What:** Move functions out of main.ts into shell module files. Replace direct `appState` and `parameterStorage` closure references with explicit parameters passed via `ShellServices` or function arguments.
**When to use:** Every function extracted in this phase.
**Example:**
```typescript
// Source: established in shell/ve/renderStandardVe.ts [VERIFIED: codebase]
// Before (in main.ts): function uses closure-captured appState, parameterStorage
async function showGpsLapVEAnalysis(lapIndexRanges, fitData, params, ...) {
    // uses appState directly
    const resolvedParams = await resolveMultiSegmentAnalysisParams(analyzedLapNumbers, params, reuseCurrentSettings);
    // ...
}

// After (in shell/gpsLap/renderGpsLap.ts): receives dependencies as parameters
export async function showGpsLapVEAnalysis(
    services: ShellServices,
    parameterStorage: ParameterStorage,
    lapIndexRanges: LapIndexRange[],
    fitData: ActivityDataLike,
    params: AnalysisParameters,
    defaultAirSpeedOffset: number,
    reuseCurrentSettings: boolean = false,
) {
    services.showLoading('Calculating VE for each lap...');
    // ... same logic, but appState comes from services.appState
}
```

### Pattern 2: Persistence Helper Consolidation (D-06)
**What:** Move `resolveMultiSegmentAnalysisParams`, `saveCurrentMultiSegmentSettings`, `saveMapTrimSettings`, and `buildAutoCalibrationSegmentsFromRanges` from main.ts into `analysis/MultiSegmentSettings.ts`.
**When to use:** Plan 04-01 (first extraction, since GPS-lap needs these helpers).
**Example:**
```typescript
// Source: main.ts lines 3240-3312 [VERIFIED: codebase]
// These functions currently depend on closure-captured appState and parameterStorage.
// After extraction, they take explicit parameters:
export async function resolveMultiSegmentAnalysisParams(
    appState: AppState,
    parameterStorage: ParameterStorage,
    analyzedItems: number[],
    params: AnalysisParameters,
    reuseCurrentSettings: boolean,
): Promise<AnalysisParameters> {
    // Same logic, explicit dependencies
}
```

### Anti-Patterns to Avoid
- **Abstracting update functions:** D-09 explicitly forbids DRY-abstracting `updateGpsLapVEPlots` and `updateOutAndBackVEPlots`. The duplication is intentional to protect BEHV-03.
- **Growing AppState:** D-10 forbids adding DOM/service refs to AppState. Use ShellServices or function parameters.
- **Changing analysis math:** D-12 forbids modifying VE calculation, WASM interfaces, or plot builder logic. This is extraction only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tab switching | Custom tab logic | `shell/dom/tabs.ts` `setupTabSwitching()` | Already extracted, used by both GPS-lap and out-and-back [VERIFIED: codebase] |
| Wind source radio binding | Custom radio handlers | `shell/dom/windSource.ts` `bindWindSourceRadios()` | Already extracted [VERIFIED: codebase] |
| Action footer buttons | Custom button wiring | `shell/dom/actionFooter.ts` `bindActionFooter()` | Already extracted [VERIFIED: codebase] |
| Store/Export results | Custom storage logic | `shell/analysis/storageHandlers.ts` `handleStoreResult()`, `handleExportAllResults()` | Already extracted [VERIFIED: codebase] |
| Segment data extraction | Manual array slicing | `analysis/SegmentExtractor.ts` `extractSegmentData()` | Already extracted [VERIFIED: codebase] |
| Multi-segment plot traces | Custom trace builders | `plots/MultiSegmentPlotBuilders.ts` | Already extracted [VERIFIED: codebase] |
| Air-speed calibration math | Custom calibration | `analysis/AirSpeedCalibration.ts` | Already extracted [VERIFIED: codebase] |
| Wind resolution | Custom wind logic | `analysis/WindSourceResolver.ts` `resolveWindSeries()` | Already extracted [VERIFIED: codebase] |
| VE calculator creation | Direct WASM calls | `analysis/VeCalculatorFactory.ts` `createVeCalculator()` | Already extracted [VERIFIED: codebase] |
| Activity data normalization | Manual array access | `analysis/ActivityArrayCache.ts` `getNormalizedActivityArrays()` | Already extracted [VERIFIED: codebase] |
| Supplementary series | Manual construction | `analysis/SegmentSupplementarySeries.ts` `buildSegmentSupplementarySeries()` | Already extracted [VERIFIED: codebase] |

**Key insight:** Most analysis and DOM helper infrastructure is already extracted. The GPS-lap and out-and-back shell code largely wires these existing helpers together with mode-specific HTML templates and event bindings. The extraction is about moving the wiring code, not creating new infrastructure.

## Common Pitfalls

### Pitfall 1: Breaking Tab/Scroll Preservation (BEHV-03)
**What goes wrong:** During in-place updates (`updateGpsLapVEPlots`, `updateOutAndBackVEPlots`), the active tab and scroll position reset to defaults because the update function re-renders HTML or re-initializes tab switching without preserving state.
**Why it happens:** The update functions call `renderGpsLapVEPlots()` / `renderOutAndBackPlots()` which replace plot content, then call `setupTabSwitching()` which resets tab state. The existing code explicitly checks which tab is active after rendering and re-renders the active secondary plot.
**How to avoid:** Verbatim lift per D-08. Do not refactor the update flow. The existing pattern is: (1) re-render VE plot, (2) re-setup tab switching, (3) check which tab is active, (4) re-render that tab's plot.
**Warning signs:** After extraction, if changing CdA slider on the Wind tab causes it to flip back to the VE tab.

### Pitfall 2: Losing Closure-Captured State References
**What goes wrong:** In main.ts, functions like `showGpsLapVEPlot` capture `appState`, `parameterStorage`, `resultsStorage`, `showLoading`, `hideLoading`, `showError`, and `waitForPlotly` via closure. When extracted, these become dangling references.
**Why it happens:** The functions are deeply nested in main.ts and rely on module-scope variables.
**How to avoid:** Each extracted function must receive its dependencies explicitly. Use the ShellServices pattern for `appState`/`showLoading`/`hideLoading`/`showError`. Pass `parameterStorage` and `resultsStorage` as function parameters. Pass `waitForPlotly` through `ShellAnalysisContext`.
**Warning signs:** TypeScript compile errors about missing identifiers. At runtime: `ReferenceError: appState is not defined`.

### Pitfall 3: Breaking the Auto-Adjust Calibration Chain (BEHV-04)
**What goes wrong:** Auto-adjust calibration fails silently or produces wrong results after extraction.
**Why it happens:** `buildAutoCalibrationSegmentsFromRanges` depends on `appState.currentFitData` and `appState.currentGpsLapIndexRanges` (for GPS-lap) or `appState.currentOutAndBackSections` (for out-and-back). If the function is moved but still references the wrong state, calibration breaks.
**How to avoid:** When consolidating into `analysis/MultiSegmentSettings.ts` per D-06, make `appState` an explicit parameter. Ensure the out-and-back auto-adjust correctly builds calibration ranges from both outbound and inbound segments (lines 4062-4065).
**Warning signs:** Auto-adjust button does nothing or returns `null` after extraction.

### Pitfall 4: Inconsistent `resolveMultiSegmentAnalysisParams` Behavior
**What goes wrong:** After extraction, GPS-lap and out-and-back modes resolve analysis parameters differently because the consolidated function doesn't properly handle the different item numbering (GPS laps use lap numbers, out-and-back uses section numbers).
**Why it happens:** Both modes call the same `resolveMultiSegmentAnalysisParams` but pass different "item" arrays. The function is mode-agnostic (it just uses the arrays as keys for saved settings lookup).
**How to avoid:** Keep the function mode-agnostic as it currently is. The calling code is responsible for providing the correct item numbers.
**Warning signs:** Switching between GPS-lap and out-and-back modes causes CdA/Crr values to not restore correctly.

### Pitfall 5: Forgetting to Wire Render Delegates in main.ts
**What goes wrong:** After extraction, clicking "Run Virtual Elevation Analysis" does nothing for GPS-lap or out-and-back modes.
**Why it happens:** The `handleAnalyze` function in main.ts uses `ModeRenderCallbacks` to dispatch to mode-specific render functions. After extraction, the callbacks must point to the new locations.
**How to avoid:** Update the `createModeRenderCallbacks` call in main.ts to import from `shell/gpsLap/` and `shell/outAndBack/` instead of calling the local functions.
**Warning signs:** GPS/out-and-back analysis silently fails or calls undefined functions.

## Code Examples

### GPS-Lap Shell Function Inventory (lines 2250-3515)

Functions to extract, with current line numbers and target files: [VERIFIED: main.ts]

| Function | Lines | Target File | Dependencies |
|----------|-------|-------------|--------------|
| `showGpsLapVEAnalysis` | 2250-2417 | renderGpsLap.ts | appState, resolveMultiSegmentAnalysisParams, getNormalizedActivityArrays, resolveWindSeries, createVeCalculator, buildSegmentSupplementarySeries |
| `calculateMeanElevationProfile` | 2422-2490 | shared.ts or gpsLapPlots.ts | pure function |
| `showGpsLapVEPlot` | 2495-2751 | renderGpsLap.ts | appState, setupTabSwitching, bindWindSourceRadios, bindActionFooter, calculateAutoAirSpeedCalibrationPercent, buildAutoCalibrationSegmentsFromRanges, saveCurrentMultiSegmentSettings |
| `calculateGpsLapStats` | 2756-2854 | gpsLapPlots.ts | pure function |
| `setupGpsLapSliderHandlers` | 2859-2897 | renderGpsLap.ts | updateGpsLapVEPlots, saveCurrentMultiSegmentSettings |
| `recalculateGpsLapVE` | 2902-2948 | updateGpsLap.ts | appState, showGpsLapVEAnalysis |
| `saveGpsLapScreenshot` | 2953-2969 | gpsLapScreenshot.ts | waitForPlotly |
| `getMultiSegmentColor` | 2971-2973 | shared.ts | MULTI_SEGMENT_COLORS |
| `renderGpsLapWindPlot` | 2978-2995 | gpsLapPlots.ts | buildMultiSegmentWindFigure, getMultiSegmentColor |
| `renderGpsLapPowerPlot` | 3000-3017 | gpsLapPlots.ts | buildMultiSegmentPowerFigure, getMultiSegmentColor |
| `renderGpsLapVdPlot` | 3022-3039 | gpsLapPlots.ts | buildMultiSegmentVirtualDistanceFigure, getMultiSegmentColor |
| `renderGpsLapVEPlots` | 3044-3228 | gpsLapPlots.ts | Plotly, calculateGpsLapStats |
| `getGpsLapNumberForRange` | 3233-3238 | renderGpsLap.ts | appState.gpsDetectedLaps |
| `resolveMultiSegmentAnalysisParams` | 3240-3259 | analysis/MultiSegmentSettings.ts (D-06) | appState, parameterStorage |
| `saveCurrentMultiSegmentSettings` | 3261-3290 | analysis/MultiSegmentSettings.ts (D-06) | appState, parameterStorage |
| `saveMapTrimSettings` | 3293-3312 | analysis/MultiSegmentSettings.ts (D-06) | appState, parameterStorage |
| `updateGpsLapVEPlots` | 3318-3514 | updateGpsLap.ts | appState, getNormalizedActivityArrays, resolveWindSeries, extractSegmentData, createVeCalculator, renderGpsLapVEPlots, setupTabSwitching |

### Out-and-Back Shell Function Inventory (lines 3517-4750)

| Function | Lines | Target File | Dependencies |
|----------|-------|-------------|--------------|
| `showOutAndBackVEAnalysis` | 3541-3744 | renderOutAndBack.ts | appState, resolveMultiSegmentAnalysisParams, getNormalizedActivityArrays, resolveWindSeries, extractSegmentData, createVeCalculator, buildSegmentSupplementarySeries |
| `calculateOutAndBackMeanElevation` | 3753-3825 | shared.ts or outAndBackPlots.ts | interpolateElevation |
| `interpolateElevation` | 3830-3842 | shared.ts | pure function |
| `showOutAndBackVEPlot` | 3847-4099 | renderOutAndBack.ts | appState, setupTabSwitching, bindWindSourceRadios, bindActionFooter, calculateAutoAirSpeedCalibrationPercent, buildAutoCalibrationSegmentsFromRanges, saveCurrentMultiSegmentSettings |
| `recalculateOutAndBackVE` | 4101-4125 | updateOutAndBack.ts | appState, showOutAndBackVEAnalysis |
| `setupOutAndBackSliderSync` | 4130-4168 | renderOutAndBack.ts | updateOutAndBackVEPlots, saveCurrentMultiSegmentSettings |
| `buildOutAndBackMultiSegmentSeries` | 4170-4199 | outAndBackPlots.ts | getMultiSegmentColor |
| `renderOutAndBackWindPlot` | 4204-4217 | outAndBackPlots.ts | buildMultiSegmentWindFigure |
| `renderOutAndBackPowerPlot` | 4222-4235 | outAndBackPlots.ts | buildMultiSegmentPowerFigure |
| `renderOutAndBackVdPlot` | 4240-4253 | outAndBackPlots.ts | buildMultiSegmentVirtualDistanceFigure |
| `saveOutAndBackScreenshot` | 4258-4274 | outAndBackScreenshot.ts | waitForPlotly |
| `calculateOutAndBackStats` | 4279-4360 | outAndBackPlots.ts | interpolateElevation |
| `renderOutAndBackPlots` | 4365-4535 | outAndBackPlots.ts | interpolateElevation, Plotly |
| `updateOutAndBackVEPlots` | 4540-4750 | updateOutAndBack.ts | appState, getNormalizedActivityArrays, resolveWindSeries, extractSegmentData, createVeCalculator, renderOutAndBackPlots, setupTabSwitching |

### Persistence Functions for D-06 Consolidation

| Function | Lines | Current Home | Dependencies to Make Explicit |
|----------|-------|--------------|-------------------------------|
| `buildAutoCalibrationSegmentsFromRanges` | 84-118 | main.ts (top) | appState.currentFitData, getNormalizedActivityArrays, resolveWindSeries, extractSegmentData |
| `resolveMultiSegmentAnalysisParams` | 3240-3259 | main.ts | appState (currentFileHash, currentAnalyzedLaps, airSpeedCalibrationPercent), parameterStorage |
| `saveCurrentMultiSegmentSettings` | 3261-3290 | main.ts | appState (currentFileHash, selectedFile, currentAnalyzedLaps, airSpeedCalibrationPercent), parameterStorage |
| `saveMapTrimSettings` | 3293-3312 | main.ts | appState (currentFileHash, selectedFile, presetTrimStart, presetTrimEnd, selectedLaps), parameterStorage |

### Shared Helpers Candidates for `shell/multiSegment/shared.ts`

| Function | Used By GPS-Lap | Used By Out-and-Back | Recommendation |
|----------|-----------------|----------------------|----------------|
| `getMultiSegmentColor` | Yes (3 plots) | Yes (3 plots) | Extract to shared |
| `MULTI_SEGMENT_COLORS` | Yes (via getMultiSegmentColor) | Yes | Extract to shared |
| `interpolateElevation` | No (uses inline loop) | Yes (4 call sites) | Extract to shared; GPS-lap uses inline loops for same purpose |
| `calculateMeanElevationProfile` | Yes | No | Keep in gpsLapPlots.ts |
| `calculateOutAndBackMeanElevation` | No | Yes | Keep in outAndBackPlots.ts |

### Types to Export

| Type | Lines | Target | Used By |
|------|-------|--------|---------|
| `LapVEProfile` | 2230-2245 | shell/gpsLap/types.ts | renderGpsLap, gpsLapPlots, updateGpsLap |
| `OutAndBackVEProfile` | 3519-3533 | shell/outAndBack/types.ts | renderOutAndBack, outAndBackPlots, updateOutAndBack |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| All shell code in main.ts | Shell modules under shell/ | Phase 2-3 (2026-04) | Pattern established for Phase 4 to follow |
| Direct appState mutation everywhere | ShellServices DI pattern | Phase 2 (2026-04) | Shell modules receive dependencies explicitly |
| Inline storage handlers | Extracted storageHandlers.ts | Phase 2 (2026-04) | GPS-lap/out-and-back can import directly |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | GPS-lap and out-and-back modes share the same `resolveMultiSegmentAnalysisParams` without mode-specific logic | Persistence Functions | Low -- function is mode-agnostic by design, uses item arrays as opaque keys |
| A2 | `calculateMeanElevationProfile` (GPS-lap) and `calculateOutAndBackMeanElevation` are different enough to stay per-mode rather than sharing | Shared Helpers | Low -- GPS-lap uses lap profiles while out-and-back uses outbound/inbound profiles with mirroring |

## Open Questions

1. **Should `LapVEProfile` and `OutAndBackVEProfile` interfaces live in the shell modules or in a shared types file?**
   - What we know: They are only used within their respective shell module hierarchies.
   - What's unclear: Whether `shell/multiSegment/shared.ts` should also export these types for consistency.
   - Recommendation: Keep per-mode in `shell/gpsLap/types.ts` and `shell/outAndBack/types.ts` -- they have no overlap.

2. **How many lines will `analysis/MultiSegmentSettings.ts` grow to after D-06 consolidation?**
   - What we know: Currently 42 lines. The 4 functions being moved total ~110 lines of logic.
   - What's unclear: Whether the dependency injection refactoring will add significant parameter plumbing.
   - Recommendation: Expect ~200-250 lines. Acceptable for a focused persistence module.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.4 |
| Config file | frontend/vitest.config.ts (assumed) |
| Quick run command | `cd frontend && npm run test` |
| Full suite command | `bash scripts/validate-ui-shell-guardrails.sh` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SHEL-05 | GPS-lap shell isolated from other modes | Structural (typecheck + build) | `cd frontend && npm run check && npm run build` | N/A (structural) |
| SHEL-06 | Out-and-back shell isolated from other modes | Structural (typecheck + build) | `cd frontend && npm run check && npm run build` | N/A (structural) |
| BEHV-03 | Tab/scroll preserved during in-place updates | Manual browser check | N/A (manual-only -- requires browser interaction with GPS data) | Manual checklist exists |
| BEHV-04 | Correct calibration across GPS modes | Manual browser check + unit test | `cd frontend && npm run test` (MultiSegmentSettings.test.ts) | Partial (settings logic tested, calibration chain not) |

### Sampling Rate
- **Per task commit:** `cd frontend && npm run check && npm run lint && npm run test && npm run build`
- **Per wave merge:** `bash scripts/validate-ui-shell-guardrails.sh`
- **Phase gate:** Full suite green + manual browser checklist for BEHV-03 and BEHV-04

### Wave 0 Gaps
- None -- existing test infrastructure (Vitest, MultiSegmentSettings.test.ts, guardrail script) covers all automated requirements. Manual checklist covers behavioral requirements. Whether to add targeted unit tests for extracted modules is at Claude's discretion per D-16.

## Security Domain

No security-relevant changes in this phase. This is a pure structural refactoring of frontend shell code with no authentication, session management, input validation, or cryptography changes. All data stays client-side. [VERIFIED: codebase -- no network calls in extracted code]

## Sources

### Primary (HIGH confidence)
- Codebase inspection: main.ts lines 80-118, 2226-4776 (full GPS-lap and out-and-back code)
- Codebase inspection: shell/ve/ (Phase 3 extraction pattern)
- Codebase inspection: shell/dom/, shell/analysis/ (existing shell infrastructure)
- Codebase inspection: analysis/MultiSegmentSettings.ts, analysis/AirSpeedCalibration.ts
- Codebase inspection: modes/analysis/types.ts (ModeRenderCallbacks interface)
- Codebase inspection: state/AppState.ts (state shape)
- Codebase inspection: scripts/validate-ui-shell-guardrails.sh
- package.json (library versions)

### Secondary (MEDIUM confidence)
- 04-CONTEXT.md (user decisions)
- 04-UI-SPEC.md (visual/interaction invariants)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all verified from package.json
- Architecture: HIGH -- follows established Phase 3 pattern, all code inspected
- Pitfalls: HIGH -- derived from actual code analysis of update/calibration flows

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (stable -- internal codebase, no external API changes)
