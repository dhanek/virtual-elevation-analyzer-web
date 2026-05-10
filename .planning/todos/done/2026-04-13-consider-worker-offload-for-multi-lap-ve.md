---
created: 2026-04-13T21:35:12Z
title: Consider worker offload for multi-lap VE
area: general
files:
  - frontend/scripts/profile-slider-recompute.ts:1-84
  - frontend/src/main.ts:5641-5710
  - frontend/src/main.ts:6909-6976
  - PROJECT_STATUS.md:68-70
  - REFACTORING_CHECKLIST.md:22
---

## Problem

Step 20 profiling concluded that the cached recompute core was fast enough on the profiling machine to defer Web Worker complexity, and the docs/checklist currently reflect that decision. However, real interactive use with larger multi-segment analyses (roughly 15+ laps) still feels sluggish when dragging sliders. That suggests the previous synthetic benchmark may not fully represent the user-perceived cost of GPS-lap / out-and-back updates, especially once repeated segment recomputation, Plotly updates, and UI work are combined.

## Solution

Re-evaluate worker or threaded offload specifically for multi-lap VE analysis. Start by profiling the real browser path for GPS-lap / out-and-back slider interaction with higher lap counts, then decide whether VE calculation should move into a worker (or wasm thread-backed worker setup) while keeping the main thread focused on UI and Plotly rendering. If adopted, scope it to the heavy multi-segment paths first rather than reworking the whole app at once.