---
phase: 04-gps-and-out-and-back-shell-extraction
fixed_at: 2026-04-18T00:00:00Z
review_path: .planning/phases/04-gps-and-out-and-back-shell-extraction/04-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 4: Code Review Fix Report

**Fixed at:** 2026-04-18
**Source review:** .planning/phases/04-gps-and-out-and-back-shell-extraction/04-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (WR-01, WR-02, WR-03)
- Fixed: 3
- Skipped: 0

Scope excluded the 6 Info findings (IN-01 through IN-06) per `fix_scope: critical_warning`.

## Fixed Issues

### WR-01: Out-and-back update writes to non-existent element and skips two header updates

**Files modified:** `frontend/src/shell/outAndBack/updateOutAndBack.ts`
**Commit:** `23c9b6f`
**Applied fix:** Removed the dead `document.getElementById('oabVeMetrics')` lookup (no such element is rendered) and extended the header refresh to also update `oabRmseValue` and `oabSectionCountValue`, so all four header spans (`oabRmseValue`, `oabVeGainValue`, `oabActualGainValue`, `oabSectionCountValue`) stay in sync with the latest stats whenever CdA/Crr/calibration change. This brings the out-and-back update path in line with the GPS-lap sibling's behaviour.

### WR-02: Unguarded `veSection.scrollIntoView` can throw when the section is missing

**Files modified:** `frontend/src/shell/outAndBack/renderOutAndBack.ts`
**Commit:** `f43c353`
**Applied fix:** Changed `veSection.scrollIntoView(...)` on the final line of `renderOutAndBackPlotsWithControls` to `veSection?.scrollIntoView(...)`, matching the safe pattern already used in the GPS-lap sibling (`renderGpsLap.ts:400`). If `#veAnalysisSection` is absent for any reason the call becomes a no-op instead of throwing a TypeError.

### WR-03: `buildAutoCalibrationSegmentsFromRanges` uses `any` for `fitData` and untyped callbacks

**Files modified:** `frontend/src/analysis/MultiSegmentSettings.ts`, `frontend/src/shell/gpsLap/renderGpsLap.ts`, `frontend/src/shell/outAndBack/renderOutAndBack.ts`
**Commit:** `1e0771c`
**Applied fix:** Added type-only imports of `getNormalizedActivityArrays`, `resolveWindSeries`, and `extractSegmentData` in `MultiSegmentSettings.ts` and introduced three `typeof`-derived function type aliases (`GetNormalizedActivityArraysFn`, `ResolveWindSeriesFn`, `ExtractSegmentDataFn`). The three callback parameters of `buildAutoCalibrationSegmentsFromRanges` now reference the real source signatures rather than duplicated inline shapes with `any` for `fitData`. Both shell call sites (`renderGpsLap.ts` and `renderOutAndBack.ts`) now pass `resolveWindSeries` directly, dropping the `(opts) => resolveWindSeries(opts as any)` wrapper that was only needed because of the old type mismatch. Full-project `tsc --noEmit` passes cleanly with the tightened signatures. No circular-import risk was introduced: the three `typeof` imports are type-only, and `ActivityArrayCache`/`WindSourceResolver`/`SegmentExtractor` do not import from `MultiSegmentSettings`.

---

_Fixed: 2026-04-18_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
