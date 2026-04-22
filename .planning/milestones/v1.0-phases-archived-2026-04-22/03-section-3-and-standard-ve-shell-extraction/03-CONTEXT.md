# Phase 3: Section 3 and Standard VE Shell Extraction - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning
**Source:** Initialization synthesis from prior project questioning and roadmap decisions

<domain>
## Phase Boundary

Phase 3 extracts the massive `showVirtualElevationAnalysisInline`, `setupVESliders` (601 lines alone), and the remainder of `initializeSection3` completely out of `main.ts` and into their own modules. It builds upon the helpers created in Phase 2 to make these moves safer and thinner. This phase covers standard VE behavior and file-load navigation; it leaves GPS-lap and out-and-back extraction for Phase 4.
</domain>

<decisions>
## Implementation Decisions

### Scope and architecture boundaries
- **D-01:** Fully extract Section 3 shell logic (lap selection, GPS detection panel setup).
- **D-02:** Fully extract standard Virtual Elevation panel render, bind, and update logic.
- **D-03:** Keep `AppState` state-only. Use the `ShellServices` dependency injection pattern established in Phase 2.
- **D-04:** Defer GPS-lap and out-and-back shell extraction to Phase 4.

### Regression-sensitive behavior
- **D-05:** Preserve auto-scroll to Analysis Parameters after a successful FIT or CSV file load (BEHV-01).
- **D-06:** Preserve standard virtual elevation analysis with unchanged visible behavior and analysis outputs (BEHV-02).
- **D-07:** Preserve correct standard analysis semantics, math, and plotting logic.

### Validation strategy
- **D-08:** CI parity remains the default checkpoint contract.
- **D-09:** `bash scripts/validate-ui-shell-guardrails.sh` must remain green.

### the agent's Discretion
- Exactly how the standard VE setup logic is structured inside `frontend/src/shell/ve/` (e.g., whether slider setup is one file or broken down).
</decisions>

<canonical_refs>
## Canonical References

### Milestone scope and requirements
- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md` (SHEL-03, SHEL-04, BEHV-01, BEHV-02)
- `.planning/ROADMAP.md` (Phase 3 goal)

### Phase 2 artifacts
- `frontend/src/shell/dom/index.ts`
- `frontend/src/shell/analysis/index.ts`
- `frontend/src/shell/section3/index.ts`

### Primary code boundaries for Phase 3
- `frontend/src/main.ts` (initializeSection3, setupVESliders, showVirtualElevationAnalysisInline, processFitFile, processCsvFile)
</canonical_refs>

<deferred>
## Deferred Ideas
- GPS-lap and out-and-back extraction (Phase 4).
</deferred>
