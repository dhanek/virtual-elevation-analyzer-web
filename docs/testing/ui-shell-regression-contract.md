# UI Shell Regression Contract

This document is the committed guardrail contract for later frontend UI-shell extraction work. It exists so later refactors do not rely on chat memory or implicit knowledge when moving code out of `frontend/src/main.ts`.

**Guided Tour: Modular Shell Architecture**
The UI Shell has transitioned from a monolithic `main.ts` to a modular architecture under `frontend/src/shell/`. All behavioral anchors are now distributed across specific shell modules.

## File-load Navigation
**Ownership:** `frontend/src/shell/fileLoad.ts`
**Migration Note:** Behavioral logic for handling FIT and CSV file loads was moved from `main.ts` to `fileLoad.ts` to isolate file processing from core application state.

The current file-load navigation contract is anchored in these functions:
- `processFitFile(...)` in `frontend/src/shell/fileLoad.ts`
- `processCsvFile(...)` in `frontend/src/shell/fileLoad.ts`
- `scrollToSection('parametersSection')` in `frontend/src/shell/fileLoad.ts`

Expected behavior:
1. A successful local FIT file load activates the parameters step.
2. A successful local CSV file load activates the parameters step.
3. Both flows call `scrollToSection('parametersSection')` immediately after `activateSection(2)`.
4. The user-visible result is that the Analysis Parameters section becomes visible without requiring manual scroll.

Regression rule:
- Later refactors must preserve the explicit `processFitFile` and `processCsvFile` auto-scroll behavior.
- Do not treat this as an incidental side effect of section activation alone.
- If `scrollToSection('parametersSection')` moves elsewhere, the new location must preserve the same visible behavior and still be easy to trace from the file-load flow.

## GPS In-Place Update Behavior
**Ownership:** `frontend/src/shell/gps.ts` & `frontend/src/shell/section3.ts`
**Migration Note:** In-place update logic for GPS and Out-and-Back views was moved from `main.ts` to these specialized modules to separate view-rendering from shell orchestration.

The current GPS in-place update contract is anchored in these functions:
- `showGpsLapVEPlot(...)` in `frontend/src/shell/gps.ts`
- `updateGpsLapVEPlots(...)` in `frontend/src/shell/gps.ts`
- `showOutAndBackVEPlot(...)` in `frontend/src/shell/section3.ts`
- `updateOutAndBackVEPlots(...)` in `frontend/src/shell/section3.ts`

Expected behavior:
1. GPS lap mode renders its initial VE shell through `showGpsLapVEPlot(...)`.
2. GPS lap recalculation and slider/auto-adjust refresh happen through `updateGpsLapVEPlots(...)`.
3. Out-and-back mode renders its initial VE shell through `showOutAndBackVEPlot(...)`.
4. Out-and-back recalculation and slider/auto-adjust refresh happen through `updateOutAndBackVEPlots(...)`.
5. Later refactors must **do not reset the active tab or scroll position** during in-place GPS updates.

Regression rule:
- GPS auto-adjust and slider-driven updates must preserve the current tab selection instead of forcing the user back to the default VE tab.
- GPS auto-adjust and slider-driven updates must preserve the user’s current reading position instead of jumping the page back to the top of the VE area or the top of Analysis Parameters.
- Re-render work is allowed only if it still preserves the same visible in-place experience.

## GPS Calibration Behavior
**Ownership:** `frontend/src/analysis/AirSpeedCalibration.ts`, `frontend/src/analysis/MultiSegmentSettings.ts`, & `frontend/src/modes/analysis/AnalysisModes.ts`
**Migration Note:** Calibration math and mode routing remain in the analysis/modes layer, decoupled from the shell's rendering logic.

The current GPS calibration contract is anchored in these shared logic points:
- `calculateAutoAirSpeedCalibrationPercent(...)` in `frontend/src/analysis/AirSpeedCalibration.ts`
- `resolveMultiSegmentSettings(...)` in `frontend/src/analysis/MultiSegmentSettings.ts`
- `AnalysisModes` routing in `frontend/src/modes/analysis/AnalysisModes.ts`

Expected behavior:
1. `calculateAutoAirSpeedCalibrationPercent(...)` remains the shared calibration math used for GPS-based auto-adjust behavior.
2. `resolveMultiSegmentSettings(...)` preserves current settings when the multi-segment selection is unchanged and restores saved settings when the selection changes.
3. `AnalysisModes` continues to route `GPS based lap splitting` and `GPS gate one way` through the GPS-lap frontend path and `GPS based out and back` through the out-and-back path.
4. GPS lap, GPS gate one-way, and out-and-back modes must keep correct calibration semantics.
5. Saved CdA/Crr values must not be unintentionally reverted when the selection is unchanged.

Regression rule:
- GPS-based calibration must stay behaviorally aligned with the standard-mode expectation of stacked sections using virtual distance as proxy.
- Later shell extraction must preserve the mode-specific wiring while keeping the shared calibration math and multi-segment settings semantics intact.

## CI Checkpoint Baseline
**Ownership:** `.github/workflows/deploy.yml` & `scripts/validate-ui-shell-guardrails.sh`
**Migration Note:** The CI chain is the automated baseline. The script serves as the entry point for both CI and local developer verification.

The automated checkpoint contract mirrors `.github/workflows/deploy.yml`, which remains the source of truth for the automated command chain.

Default repo entry point:

```bash
bash scripts/validate-ui-shell-guardrails.sh
bash scripts/validate-ui-shell-guardrails.sh --ci-only
```

The script above mirrors `.github/workflows/deploy.yml` for automated validation and then routes maintainers to `docs/testing/ui-shell-manual-checklist.md` for the browser-only checks.

Current CI parity command chain:

```bash
cd backend
cargo test --lib

cd backend
wasm-pack build --target web --out-dir ../frontend/pkg

cd frontend
npm run check

cd frontend
npm run lint

cd frontend
npm run test

cd frontend
npm run build
```

Regression rule:
- Phase checkpoints must continue to treat this CI parity chain as the default automated baseline.
- Browser-only flows still require the manual checklist in `docs/testing/ui-shell-manual-checklist.md` in addition to the command chain above.

## Source Anchors for Later Phases

When later phases move shell code, keep the new implementation easy to trace from these anchors:
- `processFitFile` (frontend/src/shell/fileLoad.ts)
- `processCsvFile` (frontend/src/shell/fileLoad.ts)
- `scrollToSection('parametersSection')` (frontend/src/shell/fileLoad.ts)
- `showGpsLapVEPlot` (frontend/src/shell/gps.ts)
- `updateGpsLapVEPlots` (frontend/src/shell/gps.ts)
- `showOutAndBackVEPlot` (frontend/src/shell/section3.ts)
- `updateOutAndBackVEPlots` (frontend/src/shell/section3.ts)
- `calculateAutoAirSpeedCalibrationPercent` (frontend/src/analysis/AirSpeedCalibration.ts)
- `resolveLmultiSegmentSettings` (frontend/src/analysis/MultiSegmentSettings.ts)
- `AnalysisModes` (frontend/src/modes/analysis/AnalysisModes.ts)

If any of these are renamed, moved, or replaced, update this contract in the same change so the guardrail stays grep-verifiable.
