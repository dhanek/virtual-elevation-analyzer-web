---
created: 2026-04-13T21:32:41Z
title: Move GPS mode selection to section 3 lap selection
area: ui
files:
  - frontend/src/components/AnalysisParameters.ts:172-177
  - frontend/src/main.ts:2452-2468
  - frontend/src/main.ts:2550-2620
---

## Problem

The GPS analysis mode selector (`auto_lap_detection`) still lives in the generic Analysis Parameters form, even though the user-facing behavior for GPS lap splitting, GPS out-and-back, and GPS one-way is expressed inside Section 3's lap-selection / map workflow. That separation makes the workflow harder to discover and makes the mode feel disconnected from the lap-selection UI that it directly controls.

## Solution

Move the GPS mode selection control into Section 3 near the lap-selection / GPS detection panels so users choose the splitting mode where they select and inspect segments. Keep the underlying `AnalysisParameters.auto_lap_detection` state in sync, and update the Section 3 re-render flow so mode changes still show the correct GPS gate / out-and-back UI without duplicating state. Revisit whether the old control in `AnalysisParameters` should be removed entirely or replaced with a read-only summary.