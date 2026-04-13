---
created: 2026-04-13T21:33:24Z
title: Check elevation smoothing strategy
area: general
files:
  - frontend/src/main.ts:506-607
  - frontend/src/utils/DEMManager.ts:93-162
  - frontend/src/plots/StandardPlotBuilders.ts:52-117
---

## Problem

Corrected elevation can look noisy or stepped after DEM application, and it is not yet clear whether that should be solved as a data-processing concern or only as a visualization concern. If smoothing belongs in the DEM correction path, every downstream calculation and plot would use the smoothed series. If it belongs only in the final graph, the underlying analysis data should remain untouched and only the rendered elevation trace should change.

## Solution

Evaluate where elevation smoothing should live by comparing the current DEM-corrected altitude pipeline with the actual elevation traces rendered in VE plots. Decide whether smoothing should be applied during DEM correction/loading (for example in `DEMManager.correctElevation(...)` or immediately after DEM data is applied in `main.ts`) or only in the final plotting layer. Document the chosen ownership and keep the behavior consistent across local and remote DEM sources.