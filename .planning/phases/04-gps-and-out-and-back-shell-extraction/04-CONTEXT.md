# Phase 4: GPS and Out-and-Back Shell Extraction - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 extracts the GPS-lap and out-and-back shell behavior (~2500 lines, main.ts lines 2250-4776) into dedicated per-mode modules under `frontend/src/shell/`. It preserves in-place update tab/scroll retention (BEHV-03) and GPS air-speed calibration correctness (BEHV-04). It builds on the `ShellServices` DI pattern and shell/ve/ extraction approach from Phase 3. It does **not** touch standard VE shell, Section 3 shell, or MapVisualization.ts beyond thin wiring seams.

</domain>

<decisions>
## Implementation Decisions

### Module layout
- **D-01:** Parallel per-mode directories: `shell/gpsLap/` and `shell/outAndBack/`, each with render, bind, update, plot, and screenshot files. Mirrors the Phase 3 `shell/ve/` pattern.
- **D-02:** A thin `shell/multiSegment/shared.ts` for truly shared helpers (e.g., `getMultiSegmentColor`, `interpolateElevation`, mean-elevation calculation) if duplication emerges during execution.
- **D-03:** Duplication threshold for shared extraction is at Claude's discretion. If obviously shared, extract; if borderline, keep per-mode.

### Plot rendering home
- **D-04:** Plot renderers (`renderGpsLapVEPlots`, VE/wind/power/Vd sub-plots for GPS-lap; `renderOutAndBackPlots` and sub-plots for out-and-back) stay co-located inside each shell mode directory as `gpsLapPlots.ts` and `outAndBackPlots.ts`.
- **D-05:** The existing `plots/MultiSegmentPlotBuilders.ts` keeps its current scope (shared trace-builder helpers). It does not absorb the full plot render functions.

### Persistence helpers
- **D-06:** `resolveMultiSegmentAnalysisParams`, `saveCurrentMultiSegmentSettings`, `saveMapTrimSettings`, and `buildAutoCalibrationSegmentsFromRanges` consolidate into the existing `analysis/MultiSegmentSettings.ts` (currently 42 lines, expected ~200 after).
- **D-07:** Both `shell/gpsLap/` and `shell/outAndBack/` import persistence helpers from `analysis/MultiSegmentSettings.ts`. Shell modules stay focused on DOM/render/bind.

### In-place update seam
- **D-08:** Verbatim lift: move `updateGpsLapVEPlots` and `updateOutAndBackVEPlots` as-is into their respective shell modules. Preserve the exact tab/scroll save-restore code in each function. No new abstraction layer.
- **D-09:** Correctness over DRY for BEHV-03. The duplication between the two update functions is acceptable; the in-place update invariant is too important to risk with a shared wrapper.

### Scope and architecture boundaries (carried forward)
- **D-10:** Keep `AppState` state-only. Use the `ShellServices` DI pattern established in Phase 2/3.
- **D-11:** Treat `MapVisualization.ts` as secondary only. Touch it only when a thin wiring seam clearly supports the GPS/out-and-back extraction.
- **D-12:** Preserve existing analysis math, WASM interfaces, plot builders, and mode-handler architecture. Thin seams only.

### Validation strategy
- **D-13:** CI parity remains the default checkpoint contract: `cargo test --lib`, `wasm-pack build`, `npm run check`, `npm run lint`, `npm run test`, `npm run build`.
- **D-14:** `bash scripts/validate-ui-shell-guardrails.sh` must remain green.
- **D-15:** Manual browser checklist remains authoritative for BEHV-03 (tab/scroll) and BEHV-04 (calibration).
- **D-16:** Whether to add targeted unit tests for extracted modules (calibration param resolution, multi-segment settings save/load) is at Claude's discretion based on what looks risky during extraction.

### Claude's Discretion
- Exact file names and internal structure within `shell/gpsLap/` and `shell/outAndBack/`
- Whether borderline-similar functions become shared or stay per-mode
- Whether to add targeted unit tests for extracted persistence/calibration logic
- How to stage the 3 plans (04-01, 04-02, 04-03) for optimal risk reduction

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone scope and requirements
- `.planning/PROJECT.md` — active stabilization scope, constraints, locked architectural boundaries
- `.planning/REQUIREMENTS.md` — Phase 4 requirements `SHEL-05`, `SHEL-06`, `BEHV-03`, `BEHV-04`
- `.planning/ROADMAP.md` — Phase 4 goal, success criteria, and plan slots
- `.planning/STATE.md` — current project position after Phase 3 completion

### Prior phase artifacts
- `.planning/phases/01-guardrails-and-regression-protection/01-CONTEXT.md` — guardrail decisions still constraining shell work
- `.planning/phases/02-shell-infrastructure-and-delegation/02-CONTEXT.md` — ShellServices DI pattern and delegation seams
- `.planning/phases/03-section-3-and-standard-ve-shell-extraction/03-CONTEXT.md` — Phase 3 extraction pattern (shell/ve/ structure)

### Regression contract and validation
- `docs/testing/ui-shell-regression-contract.md` — regression-sensitive behaviors that Phase 4 must not break
- `docs/testing/ui-shell-manual-checklist.md` — browser checks for GPS in-place updates and calibration
- `docs/architecture/frontend-ui-shell-extraction-inventory.md` — hotspot ownership map (GPS-lap shell and out-and-back shell buckets)
- `scripts/validate-ui-shell-guardrails.sh` — validation entry point
- `scripts/report-ui-shell-hotspots.sh` — regeneratable hotspot baseline

### Primary code boundaries for Phase 4
- `frontend/src/main.ts` — GPS-lap shell (lines ~2250-3540) and out-and-back shell (lines ~3541-4776)
- `frontend/src/shell/ve/` — Phase 3 extraction pattern to mirror (renderStandardVe.ts, bindStandardSliders.ts, autoRho.ts)
- `frontend/src/shell/section3/` — Section 3 extraction pattern (bindGpsDetection.ts, bindOutAndBackDetection.ts)
- `frontend/src/shell/dom/` — shared DOM helpers (tabs.ts, selectableCards.ts, rangeNumberPair.ts, windSource.ts)
- `frontend/src/shell/analysis/` — analysis delegation (renderDelegates.ts, storageHandlers.ts, prepareAnalysisPayload.ts)
- `frontend/src/modes/analysis/gpsLapMode.ts` — GPS-lap mode handler (selection, validation, render callback)
- `frontend/src/modes/analysis/outAndBackMode.ts` — out-and-back mode handler (selection, validation, render callback)
- `frontend/src/analysis/AirSpeedCalibration.ts` — shared GPS calibration math
- `frontend/src/analysis/MultiSegmentSettings.ts` — multi-segment saved-setting logic (target for persistence helper consolidation)
- `frontend/src/analysis/MultiSegmentSettings.test.ts` — existing tests for multi-segment settings
- `frontend/src/plots/MultiSegmentPlotBuilders.ts` — shared trace-builder helpers (scope unchanged)
- `frontend/src/utils/GpsLapDetection.ts` — GPS lap detection logic (not extracted, already separate)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `frontend/src/shell/ve/` — established extraction pattern: render + bind + focused helper files
- `frontend/src/shell/dom/tabs.ts` — tab management helpers already used by shell modules
- `frontend/src/shell/dom/windSource.ts` — wind source DOM helpers
- `frontend/src/shell/dom/rangeNumberPair.ts` — range/number input pair helpers
- `frontend/src/shell/dom/actionFooter.ts` — action footer rendering
- `frontend/src/shell/analysis/renderDelegates.ts` — analysis render delegation pattern
- `frontend/src/shell/analysis/storageHandlers.ts` — existing storage handler pattern
- `frontend/src/analysis/MultiSegmentSettings.ts` — existing multi-segment settings (target for growth)
- `frontend/src/analysis/AirSpeedCalibration.ts` — calibration math (stable, import only)
- `frontend/src/plots/MultiSegmentPlotBuilders.ts` — shared trace-builder helpers

### Established Patterns
- Shell modules follow render/bind/update separation with co-located plot rendering
- `ShellServices` DI pattern passes dependencies without `AppState` absorbing DOM/services
- Function-oriented modules preferred over class hierarchies
- Analysis math and persistence stay in `analysis/`; shell stays in `shell/`
- Mode handlers in `modes/analysis/` provide selection + validation + render callback; they don't own shell DOM

### Integration Points
- `handleAnalyze` in `main.ts` dispatches to GPS-lap and out-and-back render callbacks via mode handlers
- `shell/analysis/renderDelegates.ts` wires mode render callbacks to shell render functions
- Both GPS-lap and out-and-back update functions are called from slider handlers wired during initial render
- `shell/section3/bindGpsDetection.ts` and `bindOutAndBackDetection.ts` wire the Section 3 detection triggers that feed into the GPS/out-and-back analysis paths

</code_context>

<specifics>
## Specific Ideas

- The GPS-lap shell extraction (~1300 lines) and out-and-back shell extraction (~1200 lines) are comparably sized. The roadmap already splits them across 04-01 (GPS-lap) and 04-02 (out-and-back), which aligns with the parallel per-mode decision.
- `showGpsLapVEAnalysis` and `showOutAndBackVEAnalysis` are the entry points that orchestrate data extraction, VE calculation, and plot rendering. These are the natural top-level exports from each shell module.
- `recalculateGpsLapVE` and `recalculateOutAndBackVE` re-enter the full analysis path after parameter changes. They must preserve tab/scroll state — this is where BEHV-03 lives.
- Plan 04-03 validates that BEHV-03 and BEHV-04 survived the extraction. The manual browser checklist is the primary tool; additional unit tests are at executor discretion.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-gps-and-out-and-back-shell-extraction*
*Context gathered: 2026-04-17*
