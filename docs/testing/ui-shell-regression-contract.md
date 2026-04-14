# UI Shell Regression Contract

This document is the committed guardrail contract for later frontend UI-shell extraction work. It exists so later refactors do not rely on chat memory or implicit knowledge when moving code out of `frontend/src/main.ts`.

Scope for this contract:
- `frontend/src/main.ts`
- `frontend/src/analysis/AirSpeedCalibration.ts`
- `frontend/src/analysis/MultiSegmentSettings.ts`
- `frontend/src/modes/analysis/AnalysisModes.ts`
- `.github/workflows/deploy.yml`

## File-load navigation

The current file-load navigation contract is anchored in these functions:
- `processFitFile(...)` in `frontend/src/main.ts`
- `processCsvFile(...)` in `frontend/src/main.ts`
- `scrollToSection('parametersSection')` in `frontend/src/main.ts`

Expected behavior:
1. A successful local FIT file load activates the parameters step.
2. A successful local CSV file load activates the parameters step.
3. Both flows call `scrollToSection('parametersSection')` immediately after `activateSection(2)`.
4. The user-visible result is that the Analysis Parameters section becomes visible without requiring manual scroll.

Regression rule:
- Later refactors must preserve the explicit `processFitFile` and `processCsvFile` auto-scroll behavior.
- Do not treat this as an incidental side effect of section activation alone.
- If `scrollToSection('parametersSection')` moves elsewhere, the new location must preserve the same visible behavior and still be easy to trace from the file-load flow.

## GPS in-place update behavior

The current GPS in-place update contract is anchored in these functions:
- `showGpsLapVEPlot(...)`
- `updateGpsLapVEPlots(...)`
- `showOutAndBackVEPlot(...)`
- `updateOutAndBackVEPlots(...)`

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

## GPS calibration behavior

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

## CI checkpoint baseline

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

## Source anchors for later phases

When later phases move shell code, keep the new implementation easy to trace from these anchors:
- `processFitFile`
- `processCsvFile`
- `scrollToSection('parametersSection')`
- `showGpsLapVEPlot`
- `updateGpsLapVEPlots`
- `showOutAndBackVEPlot`
- `updateOutAndBackVEPlots`
- `calculateAutoAirSpeedCalibrationPercent`
- `resolveMultiSegmentSettings`
- `AnalysisModes`

If any of these are renamed, moved, or replaced, update this contract in the same change so the guardrail stays grep-verifiable.
