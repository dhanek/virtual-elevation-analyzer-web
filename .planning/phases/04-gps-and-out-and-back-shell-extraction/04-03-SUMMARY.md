---
phase: 04-gps-and-out-and-back-shell-extraction
plan: 03
status: complete
requirements: [BEHV-03, BEHV-04]
---

## What was verified

Validation-only plan confirming that BEHV-03 (tab/scroll preservation) and BEHV-04 (air-speed calibration correctness) survived the GPS-lap (04-01) and out-and-back (04-02) shell extractions.

## Task 1 — Automated validation (PASSED)

- `bash scripts/validate-ui-shell-guardrails.sh` — exits 0 (runs cargo test, wasm-pack build, npm check/lint/test/build)
- Structural extraction verified:
  - `grep "function.*(GpsLap|OutAndBack)"` in main.ts returns only 2 matches, both detection-UI helpers (`updateOutAndBackSectionsUI`, `updateOutAndBackButtonState`) that were never shell code
  - `buildAutoCalibrationSegmentsFromRanges` present in both `shell/gpsLap/renderGpsLap.ts` and `shell/outAndBack/renderOutAndBack.ts` — calibration chain intact for BEHV-04
  - Tab/scroll preservation preserved verbatim in both `updateGpsLapVEPlots` and `updateOutAndBackVEPlots` (gpsLap via `setupTabSwitching`; out-and-back via direct tab-state read/restore — both lifted verbatim from the original main.ts)
- `main.ts` line count: 4776 → 2213 lines (−2563 total across 04-01 and 04-02)

## Task 2 — Manual browser verification (APPROVED by user)

User exercised the 16-step checklist from the plan covering:
- BEHV-03 GPS-lap: Wind tab stays active across CdA slider, Crr slider, and Auto Adjust; scroll position stable
- BEHV-03 Out-and-back: Power tab stays active across slider and Auto Adjust; scroll position stable
- BEHV-04: Auto Adjust produces non-zero calibration in both GPS-lap and out-and-back; manual calibration re-run produces updated plots; per-mode settings persist across mode switches

User reported: "APPROVED".

## Deviations

- `scripts/validate-ui-shell-guardrails.sh` was listed in `files_modified` but required no edits — existing guardrails already cover the phase 4 surface area.

## Verification

- `bash scripts/validate-ui-shell-guardrails.sh` — exits 0
- User approval of manual browser checklist

## Self-Check: PASSED

BEHV-03 and BEHV-04 confirmed intact via automated structural checks and user browser verification. Phase 4 ready for closeout.
