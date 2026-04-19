---
created: 2026-04-19T15:27:47Z
title: Unify calculation and plot update pipeline across analysis modes
area: ui
files:
  - frontend/src/shell/ve/bindStandardSliders.ts
  - frontend/src/shell/ve/renderStandardVe.ts
  - frontend/src/shell/gpsLap/updateGpsLap.ts
  - frontend/src/shell/gpsLap/renderGpsLap.ts
  - frontend/src/shell/outAndBack/updateOutAndBack.ts
  - frontend/src/shell/outAndBack/renderOutAndBack.ts
  - frontend/src/analysis/WindSourceResolver.ts
  - frontend/src/analysis/SegmentSupplementarySeries.ts
  - frontend/src/analysis/VeCalculatorFactory.ts
  - frontend/src/plots/StandardPlotBuilders.ts
---

## Problem

The three analysis modes — "None" (Standard VE), "GPS based lap splitting" / "GPS gate one way" (GPS lap), and "GPS based out and back" — each ship their own implementation of slider handlers, wind-series resolution, VE recalculation, and plot refresh. Phase 5 stabilization intentionally preserved this divergence (D-04: structural-only lifts), so Standard, GPS-lap, and Out-and-back paths evolved with subtly different coverage of the calibration/offset pipeline.

Concrete symptom observed on 2026-04-19: in Standard VE mode, the Air Speed Calibration slider and Auto Adjust button updated `appState.airSpeedCalibrationPercent` but did not propagate to any plot, while the same UI worked correctly in GPS lap mode. Root cause was three separate omissions on the Standard-VE side that didn't exist in GPS lap mode:
  1. `updateVEPlotsWithWindSource` fit-branch ignored offset + calibration (compare-branch had them).
  2. `updateSecondaryPlots` wind-tab series applied offset but not calibration.
  3. Calibration handlers called `updateVEPlots` but never `updateSecondaryPlots`.

GPS lap mode was bug-free because `updateGpsLapVEPlots` funnels every change through one centralized path: `resolveWindSeries({ airSpeedCalibrationPercent })` → `buildSegmentSupplementarySeries` → re-render all plots. One choke point means calibration can't be forgotten by any downstream consumer.

This divergence is the bug factory: any future parameter (new calibration, new offset, new wind source) has to be wired into three places correctly, and drift is invisible until a user reports "works in mode X but not mode Y".

## Solution

TBD — evaluation + design task. Sketch of likely direction:

- Lift the GPS-lap pipeline shape (single `updateModeVEPlots(appState, params, windSource, cda, crr)` entry point that resolves a calibrated wind series once, rebuilds VE, Wind, Power, VD via shared builders) into a mode-agnostic primitive.
- Express per-mode differences as inputs to that primitive: segment list (single segment vs lap list vs out-and-back sections), wind resolution granularity, per-segment vs whole-activity metrics.
- Migrate Standard and Out-and-back mode render+update files to consume the shared primitive. Keep per-mode `render*` files only for mode-specific DOM shell.
- Shared primitives already exist: `resolveWindSeries`, `buildSegmentSupplementarySeries`, `createVeCalculator`, `buildVirtualDistanceFigure`. The unification is about the orchestrating layer above them, not the math.

Open questions before committing to this:
- Is the per-mode divergence actually intentional anywhere (e.g., does Standard really want offset+calibration applied outside the WASM calculator while GPS lap wants it inside the wind resolver)? Audit the three paths for semantic — not just structural — differences first.
- Does Out-and-back mode have the same latent bugs as Standard did? Worth spot-checking with the same calibration-slider test before deciding scope.
- Unification vs. minimally replicating GPS lap's centralization into Standard+Out-and-back — the latter is cheaper and still removes the bug surface.
