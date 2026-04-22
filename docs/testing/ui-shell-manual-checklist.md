# UI Shell Manual Checklist

Use this checklist for the browser-only flows that are not fully covered by node-only tests. Keep this file aligned with `docs/testing/ui-shell-regression-contract.md`.

Default entry point before manual browser checks:

```bash
bash scripts/validate-ui-shell-guardrails.sh
bash scripts/validate-ui-shell-guardrails.sh --ci-only
```

Run `bash scripts/validate-ui-shell-guardrails.sh` first so the automated checks finish before you perform the browser-only steps below.

## Prerequisites

- Start from a clean page load before each run.
- Reuse the same local GPS-enabled ride file across runs so the visible behavior is comparable.
- Keep one local CSV file available for the CSV path.
- Read the matching contract sections in `docs/testing/ui-shell-regression-contract.md` before validating changes.

## File Load
**Anchor:** `frontend/src/shell/fileLoad.ts`
Reference contract section: `docs/testing/ui-shell-regression-contract.md` → `## File-load Navigation`

### FIT load
1. Load a local FIT file successfully.
2. Confirm the Analysis Parameters section becomes visible immediately after the file finishes loading.
3. Confirm this happened without manual scrolling.
4. Confirm the behavior still follows the `processFitFile(...)` → `activateSection(2)` → `scrollToSection('parametersSection')` expectation from the contract.

### CSV load
1. Reload from a clean page state if needed.
2. Load a local CSV file successfully.
3. Confirm the Analysis Parameters section becomes visible immediately after the file finishes loading.
4. Confirm this happened without manual scrolling.
5. Confirm the behavior still follows the `processCsvFile(...)` → `activateSection(2)` → `scrollToSection('parametersSection')` expectation from the contract.

## Analysis Orchestration
**Anchor:** `frontend/src/shell/analysis.ts`
(Note: Current manual checks primarily focus on visual results of orchestration)

1. Confirm that analysis results are routed to the correct visual sections.
2. Confirm that section activation follows the expected sequence for standard VE.

## GPS Behavior
**Anchor:** `frontend/src/shell/gps.ts` / `frontend/src/shell/section3.ts`
Reference contract section: `docs/testing/ui-shell-regression-contract.md` → `## GPS In-Place Update Behavior`

### GPS lap in-place update checks
1. Open a GPS lap analysis result.
2. Switch away from the default VE tab before changing anything.
3. Trigger an auto-adjust or slider-driven recalculation.
4. Confirm the active tab remains unchanged.
5. Confirm the scroll position stays near the current VE panel.
6. Confirm the page does not jump back to the top of the analysis flow.
7. Confirm the update still behaves like an in-place refresh rather than a full shell reset.

### Out-and-back in-place update checks
1. Open an out-and-back analysis result.
2. Switch away from the default VE tab before changing anything.
3. Trigger an auto-adjust or slider-driven recalculation.
4. Confirm the active tab remains unchanged.
5. Confirm the scroll position stays near the current VE panel.
6. Confirm the page does not jump back to the top of the analysis flow.
7. Confirm the update still behaves like an in-place refresh rather than a full shell reset.

## Calibration Checks
**Anchor:** `frontend/src/analysis/AirSpeedCalibration.ts` / `frontend/src/analysis/MultiSegmentSettings.ts`
Reference contract section: `docs/testing/ui-shell-regression-contract.md` → `## GPS Calibration Behavior`

1. Validate GPS lap mode and note the displayed calibration value.
2. Re-run a same-selection recalculation and confirm the displayed calibration value updates without reverting saved CDA/CRR values when the selection is unchanged.
3. Validate `GPS gate one-way` through the same GPS-lap path and confirm it remains aligned with the contract.
4. Validate out-and-back mode and confirm its calibration behavior remains aligned with the contract.
5. Confirm GPS lap, GPS gate one-way, and out-and-back remain aligned with `calculateAutoAirSpeedCalibrationPercent(...)`, `resolveMultiSegmentSettings(...)`, and `AnalysisModes` semantics described in the contract.

## General Shell
**Anchor:** `frontend/src/shell/app.ts`

1. Confirm overall app shell state and layout remain consistent across page loads.
2. Confirm basic navigation between major shell sections remains functional.

## Recording results

For each run, record:
- commit or branch under test
- FIT result: pass/fail
- CSV result: pass/fail
- GPS lap in-place update: pass/fail
- Out-and-back in-place update: pass/fail
- Calibration checks: pass/fail
- any visible regressions or ambiguities

If the implementation changes but the expected behavior does not, update the source anchors in `docs/testing/ui-shell-regression-contract.md` without weakening the expected outcomes.
