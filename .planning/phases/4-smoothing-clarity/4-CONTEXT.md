# Phase 4: Smoothing Clarity - Context

**Gathered:** 2026-05-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Clarify and implement consistent elevation smoothing ownership so maintainers know exactly where smoothing is applied, and users get consistent smoothing behavior across Standard, GPS-lap, and Out-and-back modes.

</domain>

<decisions>
## Implementation Decisions

### Smoothing ownership boundary

- **D-01:** Elevation smoothing ownership is in the **data layer**.
- **D-02:** **Raw FIT elevation is never smoothed** in this phase.
- **D-03:** Smoothing is applied on **DEM-derived elevation** during DEM loading/correction.
- **D-04:** Keep two DEM profiles available: **original DEM elevation** and **smoothed DEM elevation**.

### Source + mode coverage

- **D-05:** Smoothing applies to **all DEM sources** (local and remote).
- **D-06:** Smoothing behavior is enforced consistently across **Standard, GPS-lap, and Out-and-back** modes.
- **D-07:** When no DEM elevation is active, analysis/plots use **raw FIT elevation unchanged**.

### Smoothing parameter contract

- **D-08:** v1.1 exposes **no user-facing smoothing tuning controls** (window/weights are internal).
- **D-09:** Implement **two explicit methods side-by-side** for comparison (not stacked):
  1. moving-average smoothing over DEM nearest profile,
  2. DEM grid interpolation from neighboring raster cells.

### Plot behavior

- **D-10:** Plots show **one elevation line at a time** (not always-on dual traces).
- **D-11:** When DEM is active, provide 3 display states: **raw**, **smoothing**, **interpolated**.
- **D-12:** UI control cycles **raw -> smoothing -> interpolated** in all analysis modes.
- **D-13:** Control is available in all analysis modes when DEM data is active.
- **D-14:** Control is hidden/disabled when no DEM elevation is active.

### Method comparison addendum (2026-05-09)

- **D-15:** Keep distinct DEM profiles in state for comparison:
  - `dem-raw-nearest`
  - `dem-smoothed-moving-average`
  - `dem-interpolated`
- **D-16:** `dem-smoothed-moving-average` must be derived from `dem-raw-nearest` only.
- **D-17:** `dem-interpolated` must be computed independently from raster-neighbor interpolation (no smoothing pass on top).
- **D-18:** During comparison, when DEM is active, default display profile starts at **raw**.
- **D-19:** Do not remove either method in this phase; cleanup happens only after real-world winner decision.

### Folded Todos

- **Check elevation smoothing strategy** (`.planning/todos/pending/2026-04-13-check-elevation-smoothing-strategy.md`): folded into this phase to lock ownership, placement, and consistency rules.

### the agent's Discretion

- Internal data structures for storing the three DEM profiles
- Exact control UI placement/styling as long as cycle behavior is preserved
- Edge-case handling details for nodata neighbors during interpolation (must remain deterministic)

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase contract and requirements

- `.planning/ROADMAP.md` (Phase 4: Smoothing Clarity) - goal, requirements, success criteria, key decisions
- `.planning/REQUIREMENTS.md` (`SMOOTH-01`, `SMOOTH-02`) - requirement-level acceptance intent
- `.planning/PROJECT.md` (Current Milestone + Constraints) - no VE math breaking changes, browser-local constraints

### Prior research and known pitfalls

- `.planning/research/ARCHITECTURE.md` - smoothing ownership options and recommendation context
- `.planning/research/PITFALLS.md` - smoothing layer ambiguity risk and single-owner guidance
- `.planning/research/SUMMARY.md` - phase sequencing and smoothing clarification context
- `.planning/todos/pending/2026-04-13-check-elevation-smoothing-strategy.md` - original problem framing and candidate ownership points

### Current implementation touchpoints

- `frontend/src/utils/DEMManager.ts` - local DEM elevation correction path (candidate smoothing/interpolation owner seam)
- `frontend/src/shell/fileLoad/fileLoadOrchestration.ts` - local/remote DEM application flow into fit_data altitude
- `backend/src/dem_processor/sampler.rs` - nearest-neighbor DEM sampling path to extend with 4-neighbor interpolation
- `frontend/src/shell/analysis/prepareAnalysisPayload.ts` - analysis input preparation consuming final elevation series
- `frontend/src/plots/StandardPlotBuilders.ts` - elevation rendering behavior to align with one-line + profile-cycle requirement
- `frontend/src/components/AnalysisParameters.ts` - confirms no current smoothing UI controls in parameter panel

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `DEMManager.correctElevation(...)` already centralizes local DEM correction output and is a natural seam for DEM-profile smoothing ownership.
- `fileLoadOrchestration.ts` already controls when DEM-corrected altitude replaces FIT altitude for both local and remote flows.
- Existing plot builders already accept explicit elevation arrays, enabling raw/smoothed curve swapping without introducing parallel plotting ownership.

### Established Patterns

- Analysis modes consume prepared arrays through shared orchestration paths; consistency should be enforced before mode-specific rendering.
- App architecture prefers clear single ownership boundaries (state-only AppState, shell orchestration, extracted helpers).
- Prior phases favored explicit mode semantics with shared orchestration contracts.

### Integration Points

- DEM ingestion/correction (local + remote)
- Final elevation series selection before analysis payload construction
- Plot-layer toggle wiring for raw vs smoothed display mode

</code_context>

<specifics>
## Specific Ideas

- "fit elevation should not be smoothed"
- "after loading we have side-by-side DEM profiles for raw-nearest, moving-average smoothing, and interpolated"
- "show only one line at a time"
- "control cycles raw -> smoothing -> interpolated for direct visual comparison"
- "yes, when no DEM elevation is loaded, simply take raw fit file elevation"

</specifics>

<deferred>
## Deferred Ideas

### Reviewed Todos (not folded)

- **Move GPS mode selection to section 3 lap selection** (`.planning/todos/pending/2026-04-13-move-gps-mode-selection-to-section-3-lap-selection.md`) - Phase 2 scope.
- **Unify calculation and plot update pipeline across analysis modes** (`.planning/todos/pending/2026-04-19-unify-mode-calculation-and-plot-update-pipeline.md`) - Phase 1/7 scope.
- **Consider worker offload for multi-lap VE** (`.planning/todos/pending/2026-04-13-consider-worker-offload-for-multi-lap-ve.md`) - Phase 3 scope.

</deferred>

---

_Phase: 04-smoothing-clarity_
_Context gathered: 2026-05-09_
