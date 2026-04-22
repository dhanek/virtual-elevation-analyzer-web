---
phase: 04-gps-and-out-and-back-shell-extraction
verified: 2026-04-19T20:00:00Z
status: passed
score: 4/4 must-haves verified
---

# Phase 04: GPS and Out-and-Back Shell Extraction Verification Report

**Phase Goal:** Extract GPS-lap and out-and-back shell behavior into dedicated modules while preserving in-place updates, tab/scroll retention, and GPS calibration correctness.
**Verified:** 2026-04-19T20:00:00Z
**Status:** passed

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | GPS-lap shell render, plot, update, and screenshot behavior lives outside `frontend/src/main.ts` behind narrower module boundaries under `frontend/src/shell/gpsLap/`. | ✓ VERIFIED | `frontend/src/shell/gpsLap/renderGpsLap.ts`, `gpsLapPlots.ts`, `updateGpsLap.ts`, `gpsLapScreenshot.ts`, `types.ts`, and `index.ts` exist and own `showGpsLapVEAnalysis`, `showGpsLapVEPlot`, `updateGpsLapVEPlots`, and `saveGpsLapScreenshot`; `main.ts` imports these binders rather than embedding inline GPS-lap plot/update code. (See `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-01-SUMMARY.md`.) |
| 2 | Out-and-back shell render, plot, update, and screenshot behavior lives outside `frontend/src/main.ts` behind narrower module boundaries under `frontend/src/shell/outAndBack/`. | ✓ VERIFIED | `frontend/src/shell/outAndBack/renderOutAndBack.ts`, `outAndBackPlots.ts`, `updateOutAndBack.ts`, `outAndBackScreenshot.ts`, `types.ts`, and `index.ts` exist and own `showOutAndBackVEAnalysis`, `showOutAndBackVEPlot`, `updateOutAndBackVEPlots`, and `saveOutAndBackScreenshot`; `main.ts` imports `showOutAndBackVEAnalysis` from `./shell/outAndBack` and wires it through `createModeRenderCallbacks`. (See `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-02-SUMMARY.md`.) |
| 3 | GPS in-place updates preserve active tab and scroll position during auto-adjust and slider changes, and GPS-based air-speed calibration remains correct across GPS-lap, GPS gate one-way, and out-and-back modes after shell extraction. | ✓ VERIFIED | `updateGpsLapVEPlots` and `updateOutAndBackVEPlots` lifted tab/scroll save-restore verbatim (`updateGpsLap.ts` uses `setupTabSwitching`; `updateOutAndBack.ts` performs direct tab-state read/restore per 04-03 automated findings); `buildAutoCalibrationSegmentsFromRanges` is reachable from both `shell/gpsLap/renderGpsLap.ts` and `shell/outAndBack/renderOutAndBack.ts` via `analysis/MultiSegmentSettings.ts`, matching the `## GPS calibration behavior` and `## GPS in-place update behavior` contract sections in `docs/testing/ui-shell-regression-contract.md`. (See `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-03-SUMMARY.md`.) |

**Score:** 3/3 truths verified (expanded in Requirements Coverage matrix below)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `frontend/src/shell/gpsLap/renderGpsLap.ts` | GPS-lap render/bind extraction | ✓ EXISTS + SUBSTANTIVE | Owns `showGpsLapVEAnalysis`, `showGpsLapVEPlot`, `setupGpsLapSliderHandlers`, `getGpsLapNumberForRange` (Plan 04-01). |
| `frontend/src/shell/gpsLap/gpsLapPlots.ts` | GPS-lap plot builders extraction | ✓ EXISTS + SUBSTANTIVE | Owns `renderGpsLapVEPlots`, `renderGpsLapWindPlot`, `renderGpsLapPowerPlot`, `renderGpsLapVdPlot`, `calculateGpsLapStats`, `calculateMeanElevationProfile` (Plan 04-01). |
| `frontend/src/shell/gpsLap/updateGpsLap.ts` | GPS-lap in-place update extraction | ✓ EXISTS + SUBSTANTIVE | Owns `updateGpsLapVEPlots` (verbatim tab/scroll save-restore preserved) and `recalculateGpsLapVE` (Plan 04-01). |
| `frontend/src/shell/gpsLap/gpsLapScreenshot.ts` | GPS-lap screenshot extraction | ✓ EXISTS + SUBSTANTIVE | Owns `saveGpsLapScreenshot` (Plan 04-01). |
| `frontend/src/shell/outAndBack/renderOutAndBack.ts` | Out-and-back render/bind extraction | ✓ EXISTS + SUBSTANTIVE | Owns `showOutAndBackVEAnalysis`, `showOutAndBackVEPlot`, `setupOutAndBackSliderSync` (Plan 04-02). |
| `frontend/src/shell/outAndBack/outAndBackPlots.ts` | Out-and-back plot builders extraction | ✓ EXISTS + SUBSTANTIVE | Owns `renderOutAndBackPlots`, `renderOutAndBackWindPlot`, `renderOutAndBackPowerPlot`, `renderOutAndBackVdPlot`, `calculateOutAndBackStats`, `calculateOutAndBackMeanElevation`, `buildOutAndBackMultiSegmentSeries` (Plan 04-02). |
| `frontend/src/shell/outAndBack/updateOutAndBack.ts` | Out-and-back in-place update extraction | ✓ EXISTS + SUBSTANTIVE | Owns `updateOutAndBackVEPlots` (verbatim tab/scroll save-restore preserved) and `recalculateOutAndBackVE` (Plan 04-02). |
| `frontend/src/shell/outAndBack/outAndBackScreenshot.ts` | Out-and-back screenshot extraction | ✓ EXISTS + SUBSTANTIVE | Owns `saveOutAndBackScreenshot` (Plan 04-02). |
| `frontend/src/shell/multiSegment/shared.ts` | Shared multi-segment color/interpolation helpers | ✓ EXISTS + SUBSTANTIVE | Owns `MULTI_SEGMENT_COLORS`, `getMultiSegmentColor`, `interpolateElevation`; used by both GPS-lap and out-and-back plot builders (Plan 04-01). |
| `frontend/src/analysis/MultiSegmentSettings.ts` | Consolidated multi-segment persistence helpers | ✓ EXISTS + SUBSTANTIVE | Owns `resolveMultiSegmentAnalysisParams`, `saveCurrentMultiSegmentSettings`, `saveMapTrimSettings`, `buildAutoCalibrationSegmentsFromRanges`; expanded from 42 → 199 lines in Plan 04-01 to carry the calibration chain for both GPS-lap and out-and-back. |

**Artifacts:** 10/10 verified (expanded view in Requirements Coverage matrix below)

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `frontend/src/main.ts` → `createModeRenderCallbacks` (gpsLap callback) | `frontend/src/shell/gpsLap/renderGpsLap.ts` | `showGpsLapVEAnalysis(...)` import + call with explicit DI (`appState`, `showLoading`, `hideLoading`, `showError`, `parameterStorage`, `resultsStorage`) | ✓ WIRED | Replaces inline GPS-lap rendering previously in `main.ts` (Plan 04-01). Source: `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-01-SUMMARY.md` (`main.ts changes` → "Rewired the `gpsLap` callback"). |
| `frontend/src/main.ts` → `createModeRenderCallbacks` (outAndBack callback) | `frontend/src/shell/outAndBack/renderOutAndBack.ts` | `showOutAndBackVEAnalysis(...)` import + call with explicit DI (`appState`, `showLoading`, `hideLoading`, `showError`, `parameterStorage`, `resultsStorage`, `waitForPlotly`) | ✓ WIRED | Replaces inline out-and-back rendering previously in `main.ts` (Plan 04-02). Source: `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-02-SUMMARY.md` (`main.ts changes` → "Rewired the `outAndBack` callback"). |
| `frontend/src/shell/gpsLap/updateGpsLap.ts` | `frontend/src/shell/dom/tabs.ts` | `setupTabSwitching(...)` call during in-place update preserves active tab (BEHV-03) | ✓ WIRED | GPS-lap in-place updates pass through `setupTabSwitching` so the active tab is not reset during auto-adjust / slider updates. Source: Plan 04-03 automated checks and `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-03-SUMMARY.md` (`Task 1 — Automated validation`). |
| `frontend/src/shell/outAndBack/updateOutAndBack.ts` | active-tab/scroll state | Direct tab-state read/restore lifted verbatim from the original `main.ts` implementation (BEHV-03) | ✓ WIRED | Out-and-back in-place updates preserve current tab/scroll by reading the active tab before re-render and re-applying it after, identical semantics to the pre-extraction implementation. Source: `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-03-SUMMARY.md` (`Task 1 — Automated validation`). |
| `frontend/src/shell/gpsLap/renderGpsLap.ts` | `frontend/src/analysis/MultiSegmentSettings.ts` | `buildAutoCalibrationSegmentsFromRanges` imported for auto-adjust calibration (BEHV-04) | ✓ WIRED | GPS-lap auto-adjust calibration chain reaches the consolidated calibration helpers in `MultiSegmentSettings.ts`. Source: Plan 04-03 automated checks and `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-03-SUMMARY.md`. |
| `frontend/src/shell/outAndBack/renderOutAndBack.ts` | `frontend/src/analysis/MultiSegmentSettings.ts` | `buildAutoCalibrationSegmentsFromRanges` imported for auto-adjust calibration (BEHV-04) | ✓ WIRED | Out-and-back auto-adjust calibration chain reaches the same consolidated calibration helpers as GPS-lap, keeping BEHV-04 mode-parity intact. Source: `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-03-SUMMARY.md`. |
| `frontend/src/shell/gpsLap/gpsLapPlots.ts` and `frontend/src/shell/outAndBack/outAndBackPlots.ts` | `frontend/src/shell/multiSegment/shared.ts` | `getMultiSegmentColor` and `interpolateElevation` imported by both shell plot builders | ✓ WIRED | Shared multi-segment helpers keep GPS-lap and out-and-back visual behavior consistent without duplicated colors/interpolation logic. Source: `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-01-SUMMARY.md`. |

#### BEHV-03 / BEHV-04 parity-depth references

The in-place-update (BEHV-03) and calibration (BEHV-04) parity surfaces are anchored to the same evidence quality as BEHV-02 in `03-VERIFICATION.md`. The full parity chain for Phase 4 is:

- **Regression contract anchor (BEHV-03):** `docs/testing/ui-shell-regression-contract.md` → `## GPS in-place update behavior` governs `showGpsLapVEPlot`, `updateGpsLapVEPlots`, `showOutAndBackVEPlot`, `updateOutAndBackVEPlots`, and explicitly forbids resetting the active tab or scroll position during in-place GPS updates.
- **Regression contract anchor (BEHV-04):** `docs/testing/ui-shell-regression-contract.md` → `## GPS calibration behavior` governs `calculateAutoAirSpeedCalibrationPercent` and `resolveMultiSegmentSettings`, and requires that GPS-lap, GPS gate one-way, and out-and-back modes retain correct calibration semantics.
- **Regression contract anchor (CI baseline):** `docs/testing/ui-shell-regression-contract.md` → `## CI checkpoint baseline` defines the canonical CI parity command chain that BEHV-03 and BEHV-04 parity claims rely on.
- **Manual checklist anchor:** `docs/testing/ui-shell-manual-checklist.md` provides the user-visible walkthroughs for GPS-lap and out-and-back tab/scroll preservation (BEHV-03) and for verifying Auto Adjust calibration produces non-zero, mode-specific results (BEHV-04). Plan 04-03 executed the 16-step checklist covering both invariants, and the user recorded "APPROVED".
- **Project parity validation chain (run during Plan 04-02 and Plan 04-03):**
  ```bash
  bash scripts/validate-ui-shell-guardrails.sh --ci-only
  cd frontend && npm run build
  ```
  Expected outcomes per command:
  - `bash scripts/validate-ui-shell-guardrails.sh --ci-only` → exit 0 (full CI parity chain: `cargo test --lib`, `wasm-pack build`, `npm run check`, `npm run lint`, `npm run test`, `npm run build`). Proof: Plan 04-03 `Task 1 — Automated validation` records this script PASSED end-of-phase; Plan 04-02 also records full-chain PASSED end-of-plan.
  - `cd frontend && npm run build` → exit 0 (Vite production build succeeds post-extraction, confirming GPS-lap and out-and-back shell modules compile and bundle correctly). Proof: Plan 04-01 and Plan 04-02 both record `npm run build` PASSED; `npm run check` PASSED; `npm run test` PASSED 43/43.
  - Manual approval evidence: Plan 04-03 `Task 2 — Manual browser verification` records the 16-step checklist (covering both BEHV-03 tab/scroll preservation and BEHV-04 Auto Adjust / manual calibration / per-mode persistence) and the user response "APPROVED" in `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-03-SUMMARY.md`. Checklist coverage anchor: `docs/testing/ui-shell-manual-checklist.md`.
- **Behavioral preservation evidence:** `updateGpsLapVEPlots` and `updateOutAndBackVEPlots` were lifted from `main.ts` verbatim — tab/scroll save-restore logic is byte-identical to the pre-extraction implementation. The calibration chain (`buildAutoCalibrationSegmentsFromRanges` → `calculateAutoAirSpeedCalibrationPercent`) was consolidated in `analysis/MultiSegmentSettings.ts` and is reachable from both `shell/gpsLap/renderGpsLap.ts` and `shell/outAndBack/renderOutAndBack.ts`, so GPS-lap, GPS gate one-way, and out-and-back continue to share the same calibration math.

**Wiring:** 7/7 connections verified (plus BEHV-03/BEHV-04 parity-depth chain above)

## Requirements Coverage

| ID | Requirement | Status | Evidence | Blocking Issue |
|----|-------------|--------|----------|----------------|
| SHEL-05 | Maintainer can change GPS-lap shell behavior without editing unrelated standard VE or out-and-back shell code in `frontend/src/main.ts` | ✓ SATISFIED | `frontend/src/shell/gpsLap/renderGpsLap.ts`, `gpsLapPlots.ts`, `updateGpsLap.ts`, `gpsLapScreenshot.ts`, `types.ts`, and `index.ts` own GPS-lap render/plot/update/screenshot behavior; `main.ts` invokes them through the `gpsLap` callback in `createModeRenderCallbacks` with explicit DI and contains no GPS-lap plot/update implementations post-extraction (`main.ts` 4776 → 3459 in Plan 04-01). Plan: `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-01-PLAN.md`. Summary: `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-01-SUMMARY.md`. Verification commands: `cd frontend && npm run check && npm run lint && npm run test && npm run build` (PASSED in Plan 04-01). | - |
| SHEL-06 | Maintainer can change out-and-back shell behavior without editing unrelated standard VE or GPS-lap shell code in `frontend/src/main.ts` | ✓ SATISFIED | `frontend/src/shell/outAndBack/renderOutAndBack.ts`, `outAndBackPlots.ts`, `updateOutAndBack.ts`, `outAndBackScreenshot.ts`, `types.ts`, and `index.ts` own out-and-back render/plot/update/screenshot behavior; `main.ts` invokes them through the `outAndBack` callback in `createModeRenderCallbacks` with explicit DI and contains no out-and-back plot/update implementations post-extraction (`main.ts` 3457 → 2213 in Plan 04-02, −2563 lines combined with Plan 04-01). Plan: `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-02-PLAN.md`. Summary: `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-02-SUMMARY.md`. Verification commands: `cd frontend && npm run check && npm run lint && npm run test && npm run build` + `bash scripts/validate-ui-shell-guardrails.sh` (PASSED in Plan 04-02). | - |
| BEHV-03 | User keeps active tab and scroll position during in-place GPS auto-adjust and slider updates after shell extraction | ✓ SATISFIED | `updateGpsLapVEPlots` (uses `setupTabSwitching`) and `updateOutAndBackVEPlots` (direct tab-state read/restore) preserve active tab/scroll verbatim from the pre-extraction implementation. Regression contract anchor: `docs/testing/ui-shell-regression-contract.md` `## GPS in-place update behavior`. Manual parity surface: `docs/testing/ui-shell-manual-checklist.md` (Plan 04-03 16-step checklist → user APPROVED). Plan: `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-03-PLAN.md`. Summary: `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-03-SUMMARY.md`. Verification commands: `bash scripts/validate-ui-shell-guardrails.sh --ci-only` and `cd frontend && npm run build` (PASSED in Plan 04-03). See `### Key Link Verification → BEHV-03 / BEHV-04 parity-depth references` for the full chain. | - |
| BEHV-04 | User gets correct GPS-based air-speed calibration behavior across GPS lap, GPS gate one-way, and out-and-back modes after shell extraction | ✓ SATISFIED | `buildAutoCalibrationSegmentsFromRanges` + `calculateAutoAirSpeedCalibrationPercent` reachable from both `shell/gpsLap/renderGpsLap.ts` and `shell/outAndBack/renderOutAndBack.ts` through consolidated helpers in `analysis/MultiSegmentSettings.ts`; `AnalysisModes` routing continues to send GPS-lap / GPS gate one-way through the GPS-lap frontend path and GPS-based out-and-back through the out-and-back path. Regression contract anchor: `docs/testing/ui-shell-regression-contract.md` `## GPS calibration behavior`. Manual parity surface: `docs/testing/ui-shell-manual-checklist.md` (Plan 04-03 Auto Adjust / manual calibration / per-mode persistence checks → user APPROVED). Plan: `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-03-PLAN.md`. Summary: `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-03-SUMMARY.md`. Verification commands: `bash scripts/validate-ui-shell-guardrails.sh --ci-only` and `cd frontend && npm run build` (PASSED in Plan 04-03). See `### Key Link Verification → BEHV-03 / BEHV-04 parity-depth references` for the full chain. | - |

**Coverage:** 4/4 requirements satisfied

## Verification Metadata

**Verification date:** 2026-04-19
**Verification approach:** Goal-backward against Phase 4 ROADMAP success criteria; cross-referenced 04-01/04-02/04-03 plan + summary artifacts; aligned requirement evidence rows with `docs/testing/ui-shell-regression-contract.md` (`## GPS in-place update behavior`, `## GPS calibration behavior`) and `docs/testing/ui-shell-manual-checklist.md` per the milestone audit's 3-source closure policy.

**Evidence sources:**
- `.planning/REQUIREMENTS.md` (canonical requirement IDs SHEL-05, SHEL-06, BEHV-03, BEHV-04)
- `.planning/ROADMAP.md` Phase 4 entry (success criteria, requirement mapping)
- `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-01-PLAN.md`
- `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-02-PLAN.md`
- `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-03-PLAN.md`
- `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-01-SUMMARY.md`
- `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-02-SUMMARY.md`
- `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-03-SUMMARY.md`
- `docs/testing/ui-shell-regression-contract.md`
- `docs/testing/ui-shell-manual-checklist.md`

**Commands used for proof capture (referenced from Phase 4 plan/summary evidence):**
- `bash scripts/validate-ui-shell-guardrails.sh --ci-only` (Plan 04-03 closeout) — PASSED
- `bash scripts/validate-ui-shell-guardrails.sh` (Plan 04-02 and Plan 04-03 closeout) — PASSED
- `cd frontend && npm run check` (Plan 04-01, 04-02) — PASSED
- `cd frontend && npm run lint` (Plan 04-01, 04-02) — PASSED
- `cd frontend && npm run test` (Plan 04-01, 04-02) — PASSED 43/43
- `cd frontend && npm run build` (Plan 04-01, 04-02) — PASSED

**Manual checks:** BEHV-03 and BEHV-04 parity surfaces were exercised by the Plan 04-03 16-step browser checklist covering GPS-lap tab preservation (Wind tab across CdA slider, Crr slider, Auto Adjust), out-and-back tab preservation (Power tab across slider and Auto Adjust), Auto Adjust producing non-zero calibration in both GPS-lap and out-and-back, manual calibration re-run producing updated plots, and per-mode settings persistence across mode switches. User reported "APPROVED" (`.planning/phases/04-gps-and-out-and-back-shell-extraction/04-03-SUMMARY.md` `Task 2 — Manual browser verification`). Reference: `docs/testing/ui-shell-manual-checklist.md`.

**Requirement ID traceability cross-check:**
- `SHEL-05` / `SHEL-06` → ROADMAP Phase 4 success criterion 3 ("GPS-lap and out-and-back shell logic live outside `frontend/src/main.ts` behind narrower module boundaries"). Token-exact match confirmed against `.planning/REQUIREMENTS.md` (SHEL-05, SHEL-06) and `.planning/ROADMAP.md` Phase 4 `Requirements: [SHEL-05, SHEL-06, BEHV-03, BEHV-04]`.
- `BEHV-03` → ROADMAP Phase 4 success criterion 1 ("GPS in-place updates preserve active tab and scroll position during auto-adjust and slider changes"). Token-exact match confirmed against `.planning/REQUIREMENTS.md` and Phase 4 summary frontmatter (`04-01-SUMMARY.md`, `04-02-SUMMARY.md`, `04-03-SUMMARY.md` all list BEHV-03 in `requirements`).
- `BEHV-04` → ROADMAP Phase 4 success criterion 2 ("GPS lap, GPS gate one-way, and out-and-back modes retain correct air-speed calibration behavior after shell extraction"). Token-exact match confirmed against `.planning/REQUIREMENTS.md` and Phase 4 summary frontmatter (`04-01-SUMMARY.md`, `04-02-SUMMARY.md`, `04-03-SUMMARY.md` all list BEHV-04 in `requirements`).
- No ID drift: the canonical IDs above are the only forms used anywhere in this artifact; hyphen-padded numeric suffixes and underscore-delimited variants are deliberately absent (verified by the plan's acceptance grep).

**Verification time:** ~10 min (artifact + traceability backfill)

## Gaps

**No gaps found.** Requirement IDs SHEL-05, SHEL-06, BEHV-03, and BEHV-04 each have explicit evidence rows in `## Requirements Coverage` with concrete shell-module artifacts, regression-contract anchors, and validation commands. BEHV-03 and BEHV-04 parity evidence is at the same depth as BEHV-02 in `03-VERIFICATION.md`: each cites the regression-contract command chain (`bash scripts/validate-ui-shell-guardrails.sh --ci-only` + `cd frontend && npm run build`), the manual-checklist anchor (`docs/testing/ui-shell-manual-checklist.md`), and the user-approved browser verification recorded in `04-03-SUMMARY.md`.

- SHEL-05: None
- SHEL-06: None
- BEHV-03: None
- BEHV-04: None

---
*Verified: 2026-04-19T20:00:00Z*
*Verifier: Phase 6 verification-artifact backfill (inline execution)*
