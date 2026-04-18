---
phase: 04-gps-and-out-and-back-shell-extraction
reviewed: 2026-04-18T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - frontend/src/analysis/MultiSegmentSettings.ts
  - frontend/src/main.ts
  - frontend/src/shell/gpsLap/gpsLapPlots.ts
  - frontend/src/shell/gpsLap/gpsLapScreenshot.ts
  - frontend/src/shell/gpsLap/index.ts
  - frontend/src/shell/gpsLap/renderGpsLap.ts
  - frontend/src/shell/gpsLap/types.ts
  - frontend/src/shell/gpsLap/updateGpsLap.ts
  - frontend/src/shell/multiSegment/shared.ts
  - frontend/src/shell/outAndBack/index.ts
  - frontend/src/shell/outAndBack/outAndBackPlots.ts
  - frontend/src/shell/outAndBack/outAndBackScreenshot.ts
  - frontend/src/shell/outAndBack/renderOutAndBack.ts
  - frontend/src/shell/outAndBack/types.ts
  - frontend/src/shell/outAndBack/updateOutAndBack.ts
findings:
  critical: 0
  warning: 3
  info: 6
  total: 9
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-04-18
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Phase 4 extracts GPS-lap and out-and-back multi-segment shell code from `main.ts` into dedicated `shell/gpsLap/` and `shell/outAndBack/` modules plus a shared `shell/multiSegment/` helper, and consolidates multi-segment persistence into `analysis/MultiSegmentSettings.ts`. The diff is dominated by verbatim lifts (~2600 lines removed from `main.ts`, ~3000 added across the new modules).

Overall the extraction is well-scoped: each module has a clear barrel (`index.ts`), types are colocated, and closure-captured services from `main.ts` are now passed explicitly as `ShellServices` / `ParameterStorage` / `ResultsStorage`. `main.ts` wiring (lines 31–32, 2145–2166) looks correct and consistent between the two modes.

No Critical issues were found. Three Warnings concern behavioural regressions or latent bugs that are likely verbatim carry-overs but now live in cleanly-identified modules where they should be fixed:

1. `updateOutAndBackVEPlots` targets a DOM element that no longer exists (`oabVeMetrics`) and fails to refresh two header values that the template renders (`oabRmseValue`, `oabSectionCountValue`), so RMSE and the section count go stale after every slider-driven recalculation.
2. `renderOutAndBack.ts` asserts `veSection` as `HTMLElement` and guards the first use but then dereferences it unguarded at the final `scrollIntoView` — a legitimate NPE risk. The GPS-lap sibling uses `?.scrollIntoView` and is safe.
3. `MultiSegmentSettings.buildAutoCalibrationSegmentsFromRanges` accepts `any` for `fitData` and three untyped callback signatures, erasing type information at a shared module boundary used by both shells.

The remaining Info items cover duplicated color palettes, dead assignments, and stylistic inconsistencies the phase chose not to fix during the verbatim lift. They are safe to defer but worth tracking.

## Warnings

### WR-01: Out-and-back update writes to non-existent element and skips two header updates

**File:** `frontend/src/shell/outAndBack/updateOutAndBack.ts:215-228`
**Issue:** `updateOutAndBackVEPlots` tries to update a metrics line via `document.getElementById('oabVeMetrics')`, but no element with that id is rendered by `renderOutAndBack.ts`'s template (the template uses the compact header `ve-metrics-compact` with children `oabRmseValue`, `oabVeGainValue`, `oabActualGainValue`, `oabSectionCountValue`; see `renderOutAndBack.ts:401-407`). The `metricsDiv` lookup silently returns null, so the combined metrics text is never written — dead code.

More importantly, when CdA/Crr/calibration change, only `oabVeGainValue` and `oabActualGainValue` get refreshed. `oabRmseValue` and `oabSectionCountValue` are set once at render time and then never updated, so the RMSE value and the section count shown in the header become stale as soon as the user moves a slider. The sibling GPS-lap renderer updates all four stat spans from inside `renderGpsLapVEPlots` (`gpsLapPlots.ts:335-342`), so this is a consistency bug between the two modes.

**Fix:**
```ts
// frontend/src/shell/outAndBack/updateOutAndBack.ts, replace lines 215-228
const rmseSpan = document.getElementById('oabRmseValue');
const veGainValueSpan = document.getElementById('oabVeGainValue');
const actualGainValueSpan = document.getElementById('oabActualGainValue');
const sectionCountSpan = document.getElementById('oabSectionCountValue');
if (rmseSpan) rmseSpan.textContent = `${stats.rmse.toFixed(2)}m`;
if (veGainValueSpan) veGainValueSpan.textContent = `${stats.avgVeGain.toFixed(2)}m`;
if (actualGainValueSpan) actualGainValueSpan.textContent = `${stats.avgActualGain.toFixed(2)}m`;
if (sectionCountSpan) sectionCountSpan.textContent = profiles.length.toString();
// Drop the `oabVeMetrics` lookup entirely — no such element exists.
```

### WR-02: Unguarded `veSection.scrollIntoView` can throw when the section is missing

**File:** `frontend/src/shell/outAndBack/renderOutAndBack.ts:306-309, 544`
**Issue:** `veSection` is obtained with `as HTMLElement` on line 306 (not `HTMLElement | null`), but the code correctly guards the classList mutation on lines 307-309 with `if (veSection)`. On line 544 the same variable is then dereferenced without any guard: `veSection.scrollIntoView({ behavior: 'smooth', block: 'start' });`. If the `#veAnalysisSection` element is ever missing (e.g., template change, partial DOM, test environment), this throws a `TypeError: Cannot read properties of null (reading 'scrollIntoView')` right after the plots have already been rendered, leaving the UI in a half-initialized state. The GPS-lap sibling uses `veSection?.scrollIntoView(...)` on `renderGpsLap.ts:400` and is safe.

**Fix:**
```ts
// frontend/src/shell/outAndBack/renderOutAndBack.ts, line 544
veSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
```

### WR-03: `buildAutoCalibrationSegmentsFromRanges` uses `any` for `fitData` and untyped callbacks

**File:** `frontend/src/analysis/MultiSegmentSettings.ts:133-199`
**Issue:** This helper is a newly-introduced shared entry point called from both `shell/gpsLap/renderGpsLap.ts:362-369` and `shell/outAndBack/renderOutAndBack.ts:507-514`. Its signature declares `fitData: any` and three callbacks (`getNormalizedActivityArraysFn`, `resolveWindSeriesFn`, `extractSegmentDataFn`) whose parameters are duplicated shapes rather than imported types. That means:

- Changes to `getNormalizedActivityArrays`, `resolveWindSeries`, or `extractSegmentData` (return shape or parameter names) will not produce compile errors here.
- Callers at the shell sites pass `(opts) => resolveWindSeries(opts as any)` specifically because of this mismatch (see `renderGpsLap.ts:366` and `renderOutAndBack.ts:511`), silently casting away the real `applyOffset` vs `params` difference between the two overloads.
- `appState.currentFitData` (which is passed through here via `appState` then handed to `getNormalizedActivityArraysFn`) is `any`-typed at this boundary.

Since this function was extracted specifically to be shared, the boundary should carry real types to prevent downstream regressions.

**Fix:** Import the types directly from their source modules and use them here instead of re-declaring the shapes. For example:
```ts
import { getNormalizedActivityArrays } from './ActivityArrayCache';
import { resolveWindSeries } from './WindSourceResolver';
import { extractSegmentData } from './SegmentExtractor';

type GetNormalizedActivityArraysFn = typeof getNormalizedActivityArrays;
type ResolveWindSeriesFn = typeof resolveWindSeries;
type ExtractSegmentDataFn = typeof extractSegmentData;

export function buildAutoCalibrationSegmentsFromRanges(
    appState: AppState,
    indexRanges: Array<{ startIdx: number; endIdx: number }>,
    getNormalizedActivityArraysFn: GetNormalizedActivityArraysFn,
    resolveWindSeriesFn: ResolveWindSeriesFn,
    extractSegmentDataFn: ExtractSegmentDataFn,
): AutoCalibrationSegment[] { ... }
```
Callers can then drop the `opts as any` cast. If a direct import would introduce a circular dependency, keep parameters but widen `fitData: any` to the real WASM type declared in `ActivityArrayCache`.

## Info

### IN-01: Duplicated color palette between `multiSegment/shared.ts` and `outAndBackPlots.ts`

**File:** `frontend/src/shell/outAndBack/outAndBackPlots.ts:278`; also `frontend/src/shell/gpsLap/gpsLapPlots.ts:205-214`
**Issue:** `shell/multiSegment/shared.ts` was introduced specifically to consolidate the `MULTI_SEGMENT_COLORS` palette, and `outAndBackPlots.ts` does use `getMultiSegmentColor` in `buildOutAndBackMultiSegmentSeries` (line 97). However, `renderOutAndBackPlots` re-declares an inline 7-color palette on line 278 (`const colors = ['#4363d8', '#e6194b', ...]`) instead of using the shared 8-color palette. Similarly, `gpsLapPlots.ts:205-214` has its own 8-color inline palette. The two inline palettes drift from the shared one (the out-and-back palette is missing `#bcf60c`), so Section N will use a different color in the VE plot than in the Wind/Power/VD plots for large enough N.
**Fix:** Replace both inline palettes with `getMultiSegmentColor(index)` from `shell/multiSegment/shared.ts`.

### IN-02: Dead initializer `outboundLastVE = endElev` in `calculateOutAndBackStats`

**File:** `frontend/src/shell/outAndBack/outAndBackPlots.ts:198-203`
**Issue:** `endElev` is declared on line 198 but is only used as the initial value of `outboundLastVE` (line 203). `outboundLastVE` is always overwritten inside the `if (profile.outboundVE.length > 0 ...)` branch (line 210) before it is read on line 231. If the outbound branch doesn't execute but the inbound branch does, `outboundLastVE` will still be `endElev`, which calibrates the inbound curve against the *last* mean-elevation sample — that is semantically wrong for inbound-only sections (which start at gate B, so the meaningful anchor is also `endElev`, but only by coincidence of the mirrored geometry). This is fine in practice but is confusing and mirrors a pattern that could silently break if the mean-elevation geometry changes.
**Fix:** Either drop the `endElev` fallback (and require both branches to be present, matching the earlier-in-function guard on `profiles.length === 0`) or add a comment explaining why `endElev` is the correct anchor for an inbound-only section. Preferred: add a brief comment matching the one already on `renderOutAndBackPlots` line 314.

### IN-03: `calculateGpsLapStats` walks the mean-elevation distance array twice per lap

**File:** `frontend/src/shell/gpsLap/gpsLapPlots.ts:130-165`
**Issue:** The function interpolates mean elevation at each lap distance twice — once to compute `sumSquaredResiduals` and `meanMeanElev` (lines 130-149), and again to compute `sumSquaredTotal` (lines 152-165). Both loops use the same nested `for (let k ...)` bracket search already available via `interpolateElevation` in `shell/multiSegment/shared.ts`. The duplicated logic is a maintenance risk: if one bracket search is changed (e.g., to binary search), the other might silently diverge. Note that performance is explicitly out-of-scope for this review; this item is flagged for maintainability only.
**Fix:** Replace both nested loops with calls to `interpolateElevation(dist, meanElevation.distances, meanElevation.elevation)` from `shell/multiSegment/shared.ts`. Cache per-distance values in a pre-pass if the second-pass variance calculation needs them.

### IN-04: `temperature[i] || 0` falsy-coerces valid zero readings

**File:** `frontend/src/shell/gpsLap/updateGpsLap.ts:191-193`
**Issue:** `if (appState.currentFitData.temperature) { combinedTemperature.push(appState.currentFitData.temperature[i] || 0); }` — a valid 0 °C temperature reading will fall through the `||` short-circuit and be replaced by `0`, which happens to produce the same value so there is no observable bug. The pattern is still brittle: if the series ever gains sub-zero magic sentinels or is ported to Kelvin, `||` will misbehave. This is a verbatim lift from `main.ts`, not a new defect.
**Fix:** Use `?? 0` instead of `|| 0`.

### IN-05: `calculateMeanElevationProfile` inner bracket-search silently defaults to `lowIdx = 0`

**File:** `frontend/src/shell/gpsLap/gpsLapPlots.ts:52-69`
**Issue:** Inside the per-lap interpolation, when no bracketing pair is found, `lowIdx` stays at its initial value of `0`. The outer guard on line 50 (`if (targetDist > lap.distances[last]) continue`) filters the upper-bound miss, but nothing filters the lower-bound miss when `targetDist < lap.distances[0]` (possible because `referenceDistances` starts at 0 while `lap.distances` may not). In that case `d0 = lap.distances[0]`, `d1 = lap.distances[1]`, and the interpolation extrapolates backwards, producing values slightly off from the true first sample. `shell/multiSegment/shared.ts:interpolateElevation` handles both edges correctly — using it here would remove the edge-case ambiguity. This is a verbatim lift from `main.ts`; listing it so a future correctness pass catches it.
**Fix:** Replace the inner loop (lines 52-68) with `const elevAtDist = interpolateElevation(targetDist, lap.distances, lap.actualElevation); if (!isNaN(elevAtDist)) { ... }`.

### IN-06: Two independent `getSelectedDataTimeRange` / `findDataIndexAtTimeOffset` call chains

**File:** `frontend/src/main.ts:1084-1113, 1240-1267`
**Issue:** `runGpsLapDetection` and `runOutAndBackDetection` both compute `trimStart`/`trimEnd` from selected FIT laps with identical logic (lines 1088-1113 vs 1247-1267). The two copies are now the only callers; neither was extracted into `shell/section3` or a helper during this phase. This was also noted in the phase summaries. Consolidating would eliminate a ~25-line copy-paste.
**Fix:** Extract a `computeTrimRangeFromSelectedFitLaps(appState): { trimStart: number; trimEnd: number }` helper (probably in `shell/section3/` or `activity/`) and call it from both detection functions.

---

_Reviewed: 2026-04-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
