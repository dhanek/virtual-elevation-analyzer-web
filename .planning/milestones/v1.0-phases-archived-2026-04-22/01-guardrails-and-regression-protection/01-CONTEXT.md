# Phase 1: Guardrails and Regression Protection - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning
**Source:** Initialization synthesis from prior project questioning and roadmap decisions

<domain>
## Phase Boundary

Phase 1 exists to make the fragile frontend UI-shell behavior explicit, lock in the repeatable verification path, and document the first safe extraction seams before larger `frontend/src/main.ts` moves begin. It does **not** do the main shell extraction yet; it prepares the project so later extraction phases can move faster without relying on memory or re-discovering the same risks.

</domain>

<decisions>
## Implementation Decisions

### Regression-sensitive behavior
- **D-01:** Preserve auto-scroll to Analysis Parameters after a successful FIT or CSV file load. This behavior must be explicitly named in the guardrails, not treated as an implied side effect.
- **D-02:** Preserve in-place GPS auto-adjust and slider updates without resetting the active tab or scroll position.
- **D-03:** Preserve correct GPS-based air-speed calibration behavior across GPS lap, GPS gate one-way, and out-and-back modes.

### Scope and architecture boundaries
- **D-04:** Keep this phase focused on guardrails, verification, and extraction inventory. Do **not** turn Phase 1 into the main `main.ts` extraction wave.
- **D-05:** Keep `AppState` state-only. Do not move DOM nodes or service singletons into it while preparing shell seams.
- **D-06:** Keep existing analysis math, WASM interfaces, plot builders, and mode-handler architecture stable unless a very thin seam absolutely requires a change.
- **D-07:** Treat `frontend/src/components/MapVisualization.ts` as secondary only. Touch it in this milestone only when it clearly supports the main shell stabilization path.

### Validation strategy
- **D-08:** CI parity remains the default checkpoint contract: `cargo test --lib`, `wasm-pack build`, `npm run check`, `npm run lint`, `npm run test`, and `npm run build`.
- **D-09:** A lightweight, repeatable regression path is preferred over a large new testing subsystem in Phase 1. Browser smoke coverage is allowed later if the manual/scripted path proves too brittle.

### the agent's Discretion
- Exact naming and placement of guardrail/inventory documents
- Whether the repeatable regression path is best expressed as docs only, docs plus scripts, or docs plus very lightweight helper tooling
- How to present the first shell extraction inventory so later phases can consume it cleanly

</decisions>

<specifics>
## Specific Ideas

- The highest-value guardrails should point directly at the fragile code paths rather than describing behavior in abstract terms.
- The verification path should be cheap enough that it actually gets run during refactors.
- The first extraction inventory should name concrete `frontend/src/main.ts` hotspots, not just say "main.ts is too big".
- The user has already indicated this milestone is primarily structural, with only the occasional small behavior adjustment if it directly enables or de-risks the refactor.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone scope and requirements
- `.planning/PROJECT.md` - milestone purpose, constraints, and locked architectural boundaries
- `.planning/REQUIREMENTS.md` - Phase 1 requirements `STAB-01` and `STAB-02`
- `.planning/ROADMAP.md` - Phase 1 goal, success criteria, and plan slots
- `.planning/STATE.md` - current milestone position and recent decisions

### Research and hotspot analysis
- `.planning/research/SUMMARY.md` - high-level recommended approach and major pitfalls for this milestone
- `.planning/codebase/CONCERNS.md` - quantified `main.ts` / `MapVisualization.ts` hotspots and testing risks
- `.planning/codebase/ARCHITECTURE.md` - current frontend/WASM split and where shell logic still lives

### Regression-sensitive frontend behavior
- `frontend/src/main.ts` - current orchestration file and the fragile browser flow implementations to protect
- `frontend/src/analysis/AirSpeedCalibration.ts` - shared GPS calibration math that must remain correct
- `frontend/src/analysis/MultiSegmentSettings.ts` - saved-setting reuse logic for GPS-based multi-segment modes
- `frontend/src/modes/analysis/AnalysisModes.ts` - mode selection boundary for standard vs GPS-based flows
- `frontend/src/state/AppState.ts` - state-only boundary that must not regress during shell prep
- `frontend/src/components/MapVisualization.ts` - secondary hotspot; useful for context, but not the primary Phase 1 target

### Validation baseline
- `frontend/package.json` - current frontend validation and profiling scripts
- `package.json` - current root script surface
- `build.sh` - existing non-CI build convenience script
- `.github/workflows/deploy.yml` - actual CI parity sequence the guardrails must preserve

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `frontend/src/analysis/AirSpeedCalibration.ts` and `frontend/src/analysis/MultiSegmentSettings.ts`: already isolate part of the GPS-sensitive behavior, so the guardrail docs can point to concrete shared logic instead of describing calibration abstractly.
- `frontend/scripts/profile-slider-recompute.ts`: existing example of lightweight engineering instrumentation; useful precedent for adding small stabilization helper scripts rather than a whole subsystem.

### Established Patterns
- Extracted logic already lives in `activity/`, `analysis/`, `modes/analysis/`, and `plots/`. Phase 1 should prepare shell seams that fit this direction instead of inventing a new architecture.
- The repo already uses CI parity as a serious confidence bar. Phase 1 should wrap or document that path, not replace it with a weaker local-only shortcut.
- Logging is already centralized through `frontend/src/utils/log.ts`; Phase 1 does not need new logging infrastructure.

### Integration Points
- Guardrail documentation should anchor directly to `processFitFile`, `processCsvFile`, `scrollToSection`, `handleAnalyze`, `showGpsLapVEPlot`, `showVirtualElevationAnalysisInline`, `updateGpsLapVEPlots`, and `updateOutAndBackVEPlots` in `frontend/src/main.ts`.
- Any repeatable validation command should live at the repo/script layer so later refactor phases can run it before and after shell moves.
- Any hotspot inventory should be consumable by later phases that extract Section 3, standard VE, GPS-lap, and out-and-back shell logic.

</code_context>

<deferred>
## Deferred Ideas

- Browser-level smoke coverage with Playwright or Vitest Browser Mode if the lightweight Phase 1 regression path proves insufficient
- Real `frontend/src/main.ts` shell extraction work (reserved for later phases)
- Larger `MapVisualization.ts` cleanup unless Phase 1 discovers a very small change that clearly unlocks later extraction work
- Broad docs sync across `ARCHITECTURE.md` / `ROADMAP.md` beyond what Phase 1 needs to make guardrails usable

</deferred>

---
*Phase: 01-guardrails-and-regression-protection*
*Context gathered: 2026-04-12*
